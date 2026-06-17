import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, formatLabel, toNum } from "@/lib/date-helpers";

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

type Chart = {
  date: string;
  series: Array<{ name: string; value: number; key: string }>;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const requestedDate = url.searchParams.get("date"); // YYYY-MM-DD optional

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

    // Pick row: requested date if provided, otherwise last row with parseable date.
    const pickRow = (rows: string[][], dateIdx: number): { row: string[] | null; date: Date | null } => {
      if (requestedDate) {
        // Match by YYYY-MM-DD
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          const d = parseSheetDate(String(r[dateIdx] ?? ""));
          if (!d) continue;
          const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
          if (k === requestedDate) return { row: r, date: d };
        }
        return { row: null, date: null };
      }
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const d = parseSheetDate(String(r[dateIdx] ?? ""));
        if (d) return { row: r, date: d };
      }
      return { row: null, date: null };
    };

    const bo = pickRow(bizopsRows, COL.DATE);
    const cr = pickRow(crRows, CR.DATE);
    const dateLabel = bo.date ? formatLabel(bo.date) : (cr.date ? formatLabel(cr.date) : "");

    const charts: Record<string, Chart> = {
      kyc: {
        date: dateLabel,
        series: [
          { key: "bd",   name: "Manual KYC check by BD", value: toNum(bo.row?.[COL.KYC_BD]) },
          { key: "sl",   name: "Manual KYC check by SL", value: toNum(bo.row?.[COL.KYC_SL]) },
          { key: "auto", name: "Automation FN Processed", value: toNum(bo.row?.[COL.KYC_AUTO]) },
        ],
      },
      payout: {
        date: dateLabel,
        series: [
          { key: "bd",   name: "Payout by BD", value: toNum(bo.row?.[COL.PAYOUT_BD]) },
          { key: "sl",   name: "Payout by SL", value: toNum(bo.row?.[COL.PAYOUT_SL]) },
          { key: "auto", name: "Payout by Automation",
            value: toNum(bo.row?.[COL.PAYOUT_AUTO_1]) + toNum(bo.row?.[COL.PAYOUT_AUTO_2]) },
        ],
      },
      intercom: {
        date: dateLabel,
        series: [
          { key: "bd", name: "Intercom by BD", value: toNum(bo.row?.[COL.INTERCOM_BD]) },
          { key: "sl", name: "Intercom by SL", value: toNum(bo.row?.[COL.INTERCOM_SL]) },
        ],
      },
      clickup: {
        date: dateLabel,
        series: [
          { key: "bd", name: "ClickUp by BD", value: toNum(bo.row?.[COL.CLICKUP_BD]) },
          { key: "sl", name: "ClickUp by SL", value: toNum(bo.row?.[COL.CLICKUP_SL]) },
        ],
      },
      instantKyc: {
        date: dateLabel,
        series: [
          { key: "bd", name: "Instant KYC BD", value: toNum(bo.row?.[COL.INSTANT_KYC_BD]) },
          { key: "sl", name: "Instant KYC SL", value: toNum(bo.row?.[COL.INSTANT_KYC_SL]) },
        ],
      },
      crEmail: {
        date: dateLabel,
        series: [
          { key: "bd",      name: "BD Email Contribution", value: toNum(cr.row?.[CR.BD_EMAIL]) },
          { key: "sl",      name: "SL Email Contribution", value: toNum(cr.row?.[CR.SL_EMAIL]) },
          { key: "repFin",  name: "Replies from Fin",       value: toNum(cr.row?.[CR.REPLIES_FIN]) },
        ],
      },
    };

    return NextResponse.json({ date: dateLabel, charts });
  } catch (err) {
    console.error("daily-huddle/bd-sl error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
