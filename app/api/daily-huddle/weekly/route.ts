import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, formatLabel, lastCompletedMonSun, inRange, toNum, ymd } from "@/lib/date-helpers";

export const dynamic = "force-dynamic";

const SHEET_ID = process.env.DAILY_HUDDLE_SPREADSHEET_ID ?? "1JFHHe3vkqJk_kpONnO9myupvZ7-ssNXtEDJ0CRVQjqk";

// BizOps Metrics columns
const BO = {
  DATE: 0,           // A
  TOTAL_VERIFIED: 8, // I
  TOTAL_PAYOUT: 12,  // M
  INTERCOM_RE: 18,   // S
};

// CR Metrics columns
const CR = {
  DATE: 0,             // A
  CONVERSATION_CLOSED: 2, // C
  OUTBOUND_EMAIL: 3,   // D
  SAVINGS_AMOUNT: 11,  // L
};

type DailyPoint = { date: string; value: number };
type BizOpsSeries = {
  totalPayoutCount: DailyPoint[];
  totalKycChecked: DailyPoint[];
  intercomSolved: DailyPoint[];
};
type CrSeries = {
  outboundEmail: DailyPoint[];
  conversationClosed: DailyPoint[];
  savingsAmount: DailyPoint[];
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from"); // YYYY-MM-DD
    const toParam = url.searchParams.get("to");

    let start: Date, end: Date;
    if (fromParam && toParam) {
      const s = parseSheetDate(fromParam);
      const e = parseSheetDate(toParam);
      if (!s || !e) {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      start = s;
      end = e;
    } else {
      const w = lastCompletedMonSun(new Date());
      start = w.start;
      end = w.end;
    }

    const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!credsRaw) throw new Error("missing google creds");
    const credentials = JSON.parse(credsRaw);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth: await auth.getClient() as never });
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: ["BizOps Metrics!A2:S", "CR Metrics!A2:L"],
      valueRenderOption: "FORMATTED_VALUE",
    });

    const bizopsRows = res.data.valueRanges?.[0]?.values ?? [];
    const crRows = res.data.valueRanges?.[1]?.values ?? [];

    // Build a date-keyed map for each metric so we can emit per-day points in order.
    // Days with no row return 0 (cleaner than gaps in the chart).
    type Bucket = Record<string, number>;
    const emptyBucket = (): Bucket => ({});

    const boPayoutByDay: Bucket = emptyBucket();
    const boVerifiedByDay: Bucket = emptyBucket();
    const boIntercomByDay: Bucket = emptyBucket();

    for (const row of bizopsRows) {
      const d = parseSheetDate(String(row[BO.DATE] ?? ""));
      if (!d) continue;
      if (!inRange(d, start, end)) continue;
      const k = ymd(d);
      boVerifiedByDay[k] = (boVerifiedByDay[k] ?? 0) + toNum(row[BO.TOTAL_VERIFIED]);
      boPayoutByDay[k] = (boPayoutByDay[k] ?? 0) + toNum(row[BO.TOTAL_PAYOUT]);
      boIntercomByDay[k] = (boIntercomByDay[k] ?? 0) + toNum(row[BO.INTERCOM_RE]);
    }

    const crOutboundByDay: Bucket = emptyBucket();
    const crClosedByDay: Bucket = emptyBucket();
    const crSavingsByDay: Bucket = emptyBucket();

    for (const row of crRows) {
      const d = parseSheetDate(String(row[CR.DATE] ?? ""));
      if (!d) continue;
      if (!inRange(d, start, end)) continue;
      const k = ymd(d);
      crOutboundByDay[k] = (crOutboundByDay[k] ?? 0) + toNum(row[CR.OUTBOUND_EMAIL]);
      crClosedByDay[k] = (crClosedByDay[k] ?? 0) + toNum(row[CR.CONVERSATION_CLOSED]);
      crSavingsByDay[k] = (crSavingsByDay[k] ?? 0) + toNum(row[CR.SAVINGS_AMOUNT]);
    }

    // Build the full Mon-Sun (or custom range) date axis so missing days still render.
    const days: Date[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const project = (bucket: Bucket): DailyPoint[] =>
      days.map(d => ({ date: formatLabel(d), value: bucket[ymd(d)] ?? 0 }));

    const bizops: BizOpsSeries = {
      totalPayoutCount: project(boPayoutByDay),
      totalKycChecked: project(boVerifiedByDay),
      intercomSolved: project(boIntercomByDay),
    };
    const cr: CrSeries = {
      outboundEmail: project(crOutboundByDay),
      conversationClosed: project(crClosedByDay),
      savingsAmount: project(crSavingsByDay),
    };

    return NextResponse.json({
      window: { from: ymd(start), to: ymd(end), fromLabel: formatLabel(start), toLabel: formatLabel(end) },
      bizops,
      cr,
    });
  } catch (err) {
    console.error("daily-huddle/weekly error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
