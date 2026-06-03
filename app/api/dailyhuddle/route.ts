import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

// ── Column indices (0-based) ─────────────────────────────────────────
const B = {
  date: 0,
  totalVerified: 8,       // FN Processed
  totalPayoutCount: 12,   // Payout Approved
  highestPayoutTime: 13,  // Max Approved Time (hrs)
  eligibleKYC: 29,        // Today's eligible KYC
  eligiblePayout: 30,     // Today's Eligible Payout So Far
  intercomTickets: 33,    // Intercom Ticket Solved
  payoutByTech: 39,       // Payout by Tech Automation
  manualPayout: 40,       // Manual Payout
  intercomMaxTime: 43,    // Max Resolved Duration (ticket)
};

const C = {
  date: 0,
  remainingEmail: 1,
  conversationClosed: 2,
  outboundEmail: 3,
  refundCount: 6,
  refundAmount: 7,
  repliesFromFin: 9,
  savingsAmount: 11,
};

// ── Helpers ──────────────────────────────────────────────────────────
function toIso(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  // DD-MMM-YYYY
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
  }
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return null;
}

function parseNum(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const n = parseFloat(v.replace(/[$,]/g, "").replace(/\s*hr[s]?\s*$/i, "").trim());
  return isNaN(n) ? null : n;
}

function pct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return +((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
}

function metric(
  label: string,
  curRaw: string | undefined,
  prevRaw: string | undefined,
  format: "number" | "hrs" | "currency"
) {
  const value = parseNum(curRaw);
  const prev = parseNum(prevRaw);
  return { label, value, change: pct(value, prev), format };
}

// ── Auth ─────────────────────────────────────────────────────────────
async function sheetsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS_JSON not set");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

// ── Route ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID not set");

    const sheets = await sheetsClient();

    const [bizRes, crRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "BizOps Metrics!A:AR" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "CR Metrics!A:M" }),
    ]);

    const bizRows = bizRes.data.values ?? [];
    const crRows = crRes.data.values ?? [];

    // Build date → row maps (skip header at index 0)
    const bizMap = new Map<string, string[]>();
    const orderedDates: string[] = [];

    for (let i = 1; i < bizRows.length; i++) {
      const row = bizRows[i] as string[];
      const key = toIso(row?.[0] ?? "");
      if (key && !bizMap.has(key)) {
        bizMap.set(key, row);
        orderedDates.push(key);
      }
    }

    const crMap = new Map<string, string[]>();
    for (let i = 1; i < crRows.length; i++) {
      const row = crRows[i] as string[];
      const key = toIso(row?.[0] ?? "");
      if (key && !crMap.has(key)) crMap.set(key, row);
    }

    // Only include dates that have actual BizOps data
    const datesWithData = orderedDates.filter((d) => {
      const row = bizMap.get(d)!;
      return Object.values(B).slice(1).some((idx) => row[idx]?.trim());
    });

    // Resolve target date
    let targetDate = dateParam && bizMap.has(dateParam) ? dateParam : null;
    if (!targetDate) targetDate = datesWithData[datesWithData.length - 1] ?? null;
    if (!targetDate) return NextResponse.json({ error: "No data available" }, { status: 404 });

    const tIdx = datesWithData.indexOf(targetDate);
    const prevDate = tIdx > 0 ? datesWithData[tIdx - 1] : null;

    const br = bizMap.get(targetDate) ?? [];
    const bp = prevDate ? (bizMap.get(prevDate) ?? []) : [];
    const cr = crMap.get(targetDate) ?? [];
    const cp = prevDate ? (crMap.get(prevDate) ?? []) : [];

    return NextResponse.json({
      date: targetDate,
      prevDate,
      availableDates: datesWithData,
      bizops: [
        metric("Payout Approved",              br[B.totalPayoutCount],  bp[B.totalPayoutCount],  "number"),
        metric("Manual Payout",                br[B.manualPayout],       bp[B.manualPayout],       "number"),
        metric("Payout by Tech Automation",    br[B.payoutByTech],       bp[B.payoutByTech],       "number"),
        metric("Max Approved Time",            br[B.highestPayoutTime],  bp[B.highestPayoutTime],  "hrs"),
        metric("Intercom Ticket Solved",       br[B.intercomTickets],    bp[B.intercomTickets],    "number"),
        metric("Max Resolved Duration (ticket)", br[B.intercomMaxTime], bp[B.intercomMaxTime],    "hrs"),
      ],
      bizopsEligible: {
        fnProcessed:    metric("FN Processed",                 br[B.totalVerified], bp[B.totalVerified], "number"),
        eligibleKYC:    metric("Today's Eligible KYC",         br[B.eligibleKYC],   bp[B.eligibleKYC],   "number"),
        eligiblePayout: metric("Today's Eligible Payout So Far", br[B.eligiblePayout], bp[B.eligiblePayout], "number"),
      },
      cr: [
        metric("Remaining Email",      cr[C.remainingEmail],      cp[C.remainingEmail],      "number"),
        metric("Conversation Closed",  cr[C.conversationClosed],  cp[C.conversationClosed],  "number"),
        metric("Outbound Email",       cr[C.outboundEmail],       cp[C.outboundEmail],       "number"),
        metric("Replies from Fin",     cr[C.repliesFromFin],      cp[C.repliesFromFin],      "number"),
        metric("Refund Count",         cr[C.refundCount],         cp[C.refundCount],         "number"),
        metric("Refund Amount",        cr[C.refundAmount],        cp[C.refundAmount],        "currency"),
      ],
      crSavings: metric("Savings Amount", cr[C.savingsAmount], cp[C.savingsAmount], "currency"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
