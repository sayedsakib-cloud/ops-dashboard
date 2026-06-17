import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, formatLabel, inRange } from "@/lib/date-helpers";

export const dynamic = "force-dynamic";

const SHEET_ID = process.env.DAILY_HUDDLE_SPREADSHEET_ID ?? "1JFHHe3vkqJk_kpONnO9myupvZ7-ssNXtEDJ0CRVQjqk";
// Read the whole column range; we self-detect data rows by date-parseability,
// so header rows (row 3) and the blank gap before the real data are skipped safely.
const RANGE = "Alignment Huddle !A:I";

type Row = { date: string; achievement: string; focus: string };
type Payload = {
  bdBizOps: Row[];
  bdCR: Row[];
  slBizOps: Row[];
  slCR: Row[];
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const start = fromParam ? parseSheetDate(fromParam) : null;
    const end = toParam ? parseSheetDate(toParam) : null;

    const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!credsRaw) throw new Error("missing google creds");
    const credentials = JSON.parse(credsRaw);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = res.data.values ?? [];
    const out: Payload = { bdBizOps: [], bdCR: [], slBizOps: [], slCR: [] };

    const push = (bucket: Row[], dateLabel: string, ach: unknown, foc: unknown) => {
      const a = String(ach ?? "").trim();
      const f = String(foc ?? "").trim();
      if (!a && !f) return;
      bucket.push({ date: dateLabel, achievement: a, focus: f });
    };

    for (const row of rows) {
      const dateRaw = row[0];
      if (!dateRaw) continue;
      const d = parseSheetDate(String(dateRaw));
      if (!d) continue;
      // Apply date range when provided.
      if (start && end && !inRange(d, start, end)) continue;
      const dateLabel = formatLabel(d);
      push(out.bdBizOps, dateLabel, row[1], row[2]); // B, C
      push(out.bdCR,     dateLabel, row[3], row[4]); // D, E
      push(out.slBizOps, dateLabel, row[5], row[6]); // F, G
      push(out.slCR,     dateLabel, row[7], row[8]); // H, I
    }

    // Most recent first per bucket.
    out.bdBizOps.reverse();
    out.bdCR.reverse();
    out.slBizOps.reverse();
    out.slCR.reverse();

    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("daily-huddle/alignment error:", msg);
    // TEMP DEBUG: surface the real reason so we can see why it 500s.
    // Remove the `detail` field once the tab loads correctly.
    return NextResponse.json({ error: "Something went wrong", detail: msg }, { status: 500 });
  }
}
