import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, formatLabel } from "@/lib/date-helpers";

export const dynamic = "force-dynamic";

const SHEET_ID = process.env.DAILY_HUDDLE_SPREADSHEET_ID ?? "1JFHHe3vkqJk_kpONnO9myupvZ7-ssNXtEDJ0CRVQjqk";
const RANGE = "Alignment Huddle!A2:I";

type Row = { date: string; achievement: string; focus: string };
type Payload = {
  bdBizOps: Row[];
  bdCR: Row[];
  slBizOps: Row[];
  slCR: Row[];
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
    if (!credsRaw) throw new Error("missing google creds");
    const credentials = JSON.parse(credsRaw);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth: await auth.getClient() as never });
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
    console.error("daily-huddle/alignment error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
