import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { google }           from "googleapis";

// ── Column indices (0-based) ───────────────────────────────────────────────
const B = {
  date: 0,
  totalVerified:    8,   // FN Processed
  totalPayoutCount: 12,  // Payout Approved
  highestPayoutTime: 13, // Max Approved Time (hrs)
  eligibleKYC:      29,  // Today's eligible KYC
  eligiblePayout:   30,  // Today's Eligible Payout So Far
  intercomTickets:  33,  // Intercom Ticket Solved
  payoutByTech:     39,  // Payout by Tech Automation
  manualPayout:     40,  // Manual Payout
  intercomMaxTime:  43,  // Max Resolved Duration (ticket)
};
const C = {
  date: 0,
  remainingEmail:      1,
  conversationClosed:  2,
  outboundEmail:       3,
  refundCount:         6,
  refundAmount:        7,
  repliesFromFin:      9,
  savingsAmount:       11,
};

// ── Helpers ────────────────────────────────────────────────────────────────
function toIso(raw: string): string | null {
  if (!raw?.trim()) return null;
  const MONTHS: Record<string, string> = {
    jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
    jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
  };
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? `${m[3]}-${mon}-${m[1].padStart(2,"0")}` : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return null;
}

function parseNum(v: string | undefined): number | null {
  if (!v?.trim()) return null;
  const n = parseFloat(v.replace(/[$,]/g,"").replace(/\s*hr[s]?\s*$/i,"").trim());
  return isNaN(n) ? null : n;
}
function pct(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return +(((cur - prev) / Math.abs(prev)) * 100).toFixed(1);
}

type Fmt    = "number" | "hrs" | "currency";
type Metric = { label: string; value: number|null; change: number|null; format: Fmt };

function metric(label: string, cur: number|null, prev: number|null, format: Fmt): Metric {
  return { label, value: cur, change: pct(cur, prev), format };
}

/** Aggregate a column across an array of data rows */
function agg(
  days: string[],
  map:  Map<string, string[]>,
  idx:  number,
  mode: "sum" | "max" | "last" = "sum",
): number | null {
  const vals = days
    .map(d => parseNum(map.get(d)?.[idx]))
    .filter((n): n is number => n !== null);
  if (!vals.length) return null;
  if (mode === "max")  return Math.max(...vals);
  if (mode === "last") return vals[vals.length - 1];
  return vals.reduce((a, b) => a + b, 0);
}

async function sheetsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS_JSON not set");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

// ── Route ──────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    // Accept both date-range params and legacy single-date param
    const startParam = searchParams.get("startDate") ?? searchParams.get("date");
    const endParam   = searchParams.get("endDate")   ?? searchParams.get("date");

    const spreadsheetId = process.env.DAILY_HUDDLE_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("DAILY_HUDDLE_SPREADSHEET_ID not set");

    const sheets = await sheetsClient();
    const [bizRes, crRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "BizOps Metrics!A:AR" }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: "CR Metrics!A:M" }),
    ]);

    const bizRows = bizRes.data.values ?? [];
    const crRows  = crRes.data.values  ?? [];

    // Build date → row maps (skip header row 0)
    const bizMap      = new Map<string, string[]>();
    const orderedDates: string[] = [];

    for (let i = 1; i < bizRows.length; i++) {
      const row = bizRows[i] as string[];
      const key = toIso(row?.[0] ?? "");
      if (key && !bizMap.has(key)) { bizMap.set(key, row); orderedDates.push(key); }
    }
    const crMap = new Map<string, string[]>();
    for (let i = 1; i < crRows.length; i++) {
      const row = crRows[i] as string[];
      const key = toIso(row?.[0] ?? "");
      if (key && !crMap.has(key)) crMap.set(key, row);
    }

    // Filter to dates that have actual BizOps data
    const datesWithData = orderedDates.filter(d => {
      const row = bizMap.get(d)!;
      return Object.values(B).slice(1).some(idx => row[idx]?.trim());
    });
    if (!datesWithData.length)
      return NextResponse.json({ error: "No data available" }, { status: 404 });

    // Resolve range
    const lastDate   = datesWithData[datesWithData.length - 1];
    const rangeEnd   = (endParam   && datesWithData.includes(endParam))   ? endParam   : lastDate;
    const rangeStart = (startParam && datesWithData.includes(startParam)) ? startParam : rangeEnd;

    const startIdx  = datesWithData.indexOf(rangeStart);
    const endIdx    = datesWithData.indexOf(rangeEnd);
    const rangeDays = datesWithData.slice(startIdx, endIdx + 1);
    const rangeLen  = rangeDays.length;

    // Previous period of same length (for % change)
    const prevEnd   = startIdx > 0           ? datesWithData[startIdx - 1]        : null;
    const prevStart = startIdx >= rangeLen    ? datesWithData[startIdx - rangeLen] : null;
    const prevDays  = prevStart && prevEnd
      ? datesWithData.slice(datesWithData.indexOf(prevStart), datesWithData.indexOf(prevEnd) + 1)
      : [];

    // Convenience wrappers
    const bAgg = (idx: number, mode: "sum"|"max"|"last" = "sum") => agg(rangeDays, bizMap, idx, mode);
    const cAgg = (idx: number, mode: "sum"|"max"|"last" = "sum") => agg(rangeDays, crMap,  idx, mode);
    const bPrev = (idx: number, mode: "sum"|"max"|"last" = "sum") => agg(prevDays, bizMap, idx, mode);
    const cPrev = (idx: number, mode: "sum"|"max"|"last" = "sum") => agg(prevDays, crMap,  idx, mode);

    return NextResponse.json({
      date:          rangeEnd,           // legacy compat
      prevDate:      prevEnd,
      rangeStart,
      rangeEnd,
      rangeDays:     rangeLen,
      availableDates: datesWithData,

      bizops: [
        metric("Payout Approved",               bAgg(B.totalPayoutCount),         bPrev(B.totalPayoutCount),         "number"),
        metric("Manual Payout",                 bAgg(B.manualPayout),             bPrev(B.manualPayout),             "number"),
        metric("Payout by Tech Automation",     bAgg(B.payoutByTech),             bPrev(B.payoutByTech),             "number"),
        metric("Max Approved Time",             bAgg(B.highestPayoutTime, "max"), bPrev(B.highestPayoutTime, "max"), "hrs"),
        metric("Intercom Ticket Solved",        bAgg(B.intercomTickets),          bPrev(B.intercomTickets),          "number"),
        metric("Max Resolved Duration (ticket)",bAgg(B.intercomMaxTime,  "max"), bPrev(B.intercomMaxTime,  "max"), "hrs"),
      ],
      bizopsEligible: {
        fnProcessed:    metric("FN Processed",                   bAgg(B.totalVerified,  "last"), bPrev(B.totalVerified,  "last"), "number"),
        eligibleKYC:    metric("Today's Eligible KYC",           bAgg(B.eligibleKYC,    "last"), bPrev(B.eligibleKYC,    "last"), "number"),
        eligiblePayout: metric("Today's Eligible Payout So Far", bAgg(B.eligiblePayout, "last"), bPrev(B.eligiblePayout, "last"), "number"),
      },
      cr: [
        metric("Remaining Email",     cAgg(C.remainingEmail,    "last"), cPrev(C.remainingEmail,    "last"), "number"),
        metric("Conversation Closed", cAgg(C.conversationClosed),       cPrev(C.conversationClosed),       "number"),
        metric("Outbound Email",      cAgg(C.outboundEmail),            cPrev(C.outboundEmail),            "number"),
        metric("Replies from Fin",    cAgg(C.repliesFromFin),           cPrev(C.repliesFromFin),           "number"),
        metric("Refund Count",        cAgg(C.refundCount),              cPrev(C.refundCount),              "number"),
        metric("Refund Amount",       cAgg(C.refundAmount),             cPrev(C.refundAmount),             "currency"),
      ],
      crSavings: metric("Savings Amount", cAgg(C.savingsAmount), cPrev(C.savingsAmount), "currency"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
