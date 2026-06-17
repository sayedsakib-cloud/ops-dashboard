import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions } from "@/lib/auth";
import { parseSheetDate, formatLabel } from "@/lib/date-helpers";

export const dynamic = "force-dynamic";

const SHEET_ID = process.env.DAILY_HUDDLE_SPREADSHEET_ID ?? "1JFHHe3vkqJk_kpONnO9myupvZ7-ssNXtEDJ0CRVQjqk";
const RANGE = "CR Metrics!A2:F";

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
    const feedbacks: Array<{ date: string; communityChaos: string; trustpilot: string }> = [];

    for (const row of rows) {
      const dateRaw = row[0]; // col A
      const community = row[4] ?? ""; // col E
      const trustpilot = row[5] ?? ""; // col F
      if (!dateRaw) continue;
      const d = parseSheetDate(String(dateRaw));
      if (!d) continue;
      // Skip rows with no feedback at all.
      if (!community && !trustpilot) continue;
      feedbacks.push({
        date: formatLabel(d),
        communityChaos: String(community),
        trustpilot: String(trustpilot),
      });
    }

    // Most recent first.
    feedbacks.reverse();

    return NextResponse.json({ feedbacks });
  } catch (err) {
    console.error("daily-huddle/cr-metrics error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
