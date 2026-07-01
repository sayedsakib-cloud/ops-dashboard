import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, toNum } from "@/lib/date-helpers";

export const dynamic = "force-dynamic";

const SHEET_ID = process.env.DAILY_HUDDLE_SPREADSHEET_ID ?? "1JFHHe3vkqJk_kpONnO9myupvZ7-ssNXtEDJ0CRVQjqk";

// Column letter -> 0-based index. A=0, B=1, ..., Z=25, AA=26, AB=27, ...
// BizOps Metrics
const COL = {
  DATE: 0,        // A
  KYC_BD: 23,     // X  - Manual KYC by BD
  KYC_SL: 26,     // AA - Manual KYC by SL
  PAYOUT_BD: 24,  // Y  - Payout by BD
  PAYOUT_SL: 27,  // AB - Payout by SL
  CLICKUP_BD: 25, // Z  - ClickUp by BD
  CLICKUP_SL: 28, // AC - ClickUp by SL
  INTERCOM_BD: 31,// AF
  INTERCOM_SL: 32,// AG
  KYC_AUTO: 34,   // AI
  PAYOUT_AUTO_1: 38, // AM
  PAYOUT_AUTO_2: 39, // AN
  INSTANT_KYC_BD: 41, // AP
  INSTANT_KYC_SL: 42, // AQ
};

// CR Metrics
const CR = {
  DATE: 0, // A
  REPLIES_FIN: 9, // J
  SL_EMAIL: 10,   // K
  BD_EMAIL: 12,   // M
};

type SeriesMeta = { key: string; name: string };
type DayRow = { date: string; [k: string]: number | string };
type Chart = { series: SeriesMeta[]; rows: DayRow[] };

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const keyOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const shortLabel = (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
const parseYMD = (s: string | null): Date | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    // Accept from/to (range) with start/end and legacy `date` as fallbacks.
    const fromStr = url.searchParams.get("from") || url.searchParams.get("start") || url.searchParams.get("date");
    const toStr   = url.searchParams.get("to")   || url.searchParams.get("end")   || url.searchParams.get("date");

    const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!credsRaw) throw new Error("missing google creds");
    const credentials = JSON.parse(credsRaw);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: ["BizOps Metrics!A2:AQ", "CR Metrics!A2:M"],
      valueRenderOption: "FORMATTED_VALUE",
    });

    const bizopsRows = res.data.valueRanges?.[0]?.values ?? [];
    const crRows = res.data.valueRanges?.[1]?.values ?? [];

    // Index each sheet's rows by YYYY-MM-DD for O(1) per-day lookup.
    const indexRows = (rows: string[][], dateIdx: number) => {
      const m = new Map<string, string[]>();
      for (const r of rows) {
        const d = parseSheetDate(String(r[dateIdx] ?? ""));
        if (d) m.set(keyOf(d), r);
      }
      return m;
    };
    const boIdx = indexRows(bizopsRows, COL.DATE);
    const crIdx = indexRows(crRows, CR.DATE);

    // Build the ordered list of days to render.
    let fromD = parseYMD(fromStr);
    let toD   = parseYMD(toStr);
    let days: Date[] = [];
    if (fromD && toD) {
      if (fromD > toD) { const t = fromD; fromD = toD; toD = t; }
      for (let t = new Date(fromD); t <= toD; t.setUTCDate(t.getUTCDate() + 1)) days.push(new Date(t));
    } else {
      // No range: fall back to the latest available BizOps day.
      let latest: Date | null = null;
      for (const r of bizopsRows) {
        const d = parseSheetDate(String(r[COL.DATE] ?? ""));
        if (d && (!latest || d > latest)) latest = d;
      }
      if (latest) days = [latest];
    }

    // For a source index + column getters, emit one row per day that has data.
    const buildRows = (
      idx: Map<string, string[]>,
      cols: Array<{ key: string; get: (r: string[]) => number }>,
    ): DayRow[] => {
      const out: DayRow[] = [];
      for (const d of days) {
        const r = idx.get(keyOf(d));
        if (!r) continue; // skip days with no row for this source (no fake zeros)
        const row: DayRow = { date: shortLabel(d) };
        for (const c of cols) row[c.key] = c.get(r);
        out.push(row);
      }
      return out;
    };

    const charts: Record<string, Chart> = {
      kyc: {
        series: [
          { key: "bd",   name: "Manual KYC check by BD" },
          { key: "sl",   name: "Manual KYC check by SL" },
          { key: "auto", name: "Automation FN Processed" },
        ],
        rows: buildRows(boIdx, [
          { key: "bd",   get: r => toNum(r[COL.KYC_BD]) },
          { key: "sl",   get: r => toNum(r[COL.KYC_SL]) },
          { key: "auto", get: r => toNum(r[COL.KYC_AUTO]) },
        ]),
      },
      payout: {
        series: [
          { key: "bd",   name: "Payout by BD" },
          { key: "sl",   name: "Payout by SL" },
          { key: "auto", name: "Payout by Automation" },
        ],
        rows: buildRows(boIdx, [
          { key: "bd",   get: r => toNum(r[COL.PAYOUT_BD]) },
          { key: "sl",   get: r => toNum(r[COL.PAYOUT_SL]) },
          { key: "auto", get: r => toNum(r[COL.PAYOUT_AUTO_1]) + toNum(r[COL.PAYOUT_AUTO_2]) },
        ]),
      },
      intercom: {
        series: [
          { key: "bd", name: "Intercom by BD" },
          { key: "sl", name: "Intercom by SL" },
        ],
        rows: buildRows(boIdx, [
          { key: "bd", get: r => toNum(r[COL.INTERCOM_BD]) },
          { key: "sl", get: r => toNum(r[COL.INTERCOM_SL]) },
        ]),
      },
      clickup: {
        series: [
          { key: "bd", name: "ClickUp by BD" },
          { key: "sl", name: "ClickUp by SL" },
        ],
        rows: buildRows(boIdx, [
          { key: "bd", get: r => toNum(r[COL.CLICKUP_BD]) },
          { key: "sl", get: r => toNum(r[COL.CLICKUP_SL]) },
        ]),
      },
      instantKyc: {
        series: [
          { key: "bd", name: "Instant KYC BD" },
          { key: "sl", name: "Instant KYC SL" },
        ],
        rows: buildRows(boIdx, [
          { key: "bd", get: r => toNum(r[COL.INSTANT_KYC_BD]) },
          { key: "sl", get: r => toNum(r[COL.INSTANT_KYC_SL]) },
        ]),
      },
      crEmail: {
        series: [
          { key: "bd",     name: "BD Email Contribution" },
          { key: "sl",     name: "SL Email Contribution" },
          { key: "repFin", name: "Replies from Fin" },
        ],
        rows: buildRows(crIdx, [
          { key: "bd",     get: r => toNum(r[CR.BD_EMAIL]) },
          { key: "sl",     get: r => toNum(r[CR.SL_EMAIL]) },
          { key: "repFin", get: r => toNum(r[CR.REPLIES_FIN]) },
        ]),
      },
    };

    const dateLabel = days.length === 0 ? ""
      : days.length === 1 ? `${shortLabel(days[0])}, ${days[0].getUTCFullYear()}`
      : `${shortLabel(days[0])} - ${shortLabel(days[days.length - 1])}, ${days[days.length - 1].getUTCFullYear()}`;

    return NextResponse.json({ dateLabel, charts });
  } catch (err) {
    console.error("daily-huddle/bd-sl error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
