import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

async function sheetsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS_JSON not set");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

/** Convert M/D/YYYY or MM/DD/YYYY → YYYY-MM-DD for string comparison */
function toISO(val: string): string {
  if (!val) return "";
  val = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return val;
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const tab  = searchParams.get("tab")  ?? "regular";
    const from = searchParams.get("from") ?? "";
    const to   = searchParams.get("to")   ?? "";
    const name = searchParams.get("name") ?? "";

    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID not set");

    const sheets = await sheetsClient();

    // ── Hireflix Count ─────────────────────────────────────────────────────
    if (tab === "hireflix") {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Hireflix Count!A1:I",
      });
      const allRows = (res.data.values ?? []) as string[][];
      // Row 0 = header; skip rows with no content
      const dataRows = allRows.slice(1).filter(r => r.some(c => c?.trim()));
      const total = dataRows.length;

      // Fixed indices: A=0(Email), G=6(Date), H=7(Name), I=8(Final Count)
      let filtered = dataRows;

      if (from || to) {
        filtered = filtered.filter(r => {
          const d = toISO(r[6]?.trim() ?? "");
          if (!d) return false;
          if (from && d < from) return false;
          if (to   && d > to)   return false;
          return true;
        });
      }
      if (name) {
        filtered = filtered.filter(r =>
          (r[7]?.toLowerCase() ?? "").includes(name.toLowerCase())
        );
      }

      return NextResponse.json({
        headers: ["Date", "Email", "Name", "Final Count"],
        rows: filtered.map(r => [
          r[6] ?? "",   // Date
          r[0] ?? "",   // Email
          r[7] ?? "",   // Name
          r[8] ?? "",   // Final Count
        ]),
        total,
        filtered: filtered.length,
      });
    }

    // ── Regular Task Report ────────────────────────────────────────────────
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Regular Task Report!A1:Z",
    });
    const allRows = (res.data.values ?? []) as string[][];
    if (allRows.length === 0) {
      return NextResponse.json({ headers: [], rows: [], total: 0, filtered: 0 });
    }

    const hdrs     = allRows[0] as string[];
    const dataRows = allRows.slice(1).filter(r => r.some(c => c?.trim()));
    const total    = dataRows.length;

    // Detect columns by header name (exact, case-insensitive)
    const dateIdx  = hdrs.findIndex(h => /^date$/i.test(h?.trim() ?? ""));
    const emailIdx = hdrs.findIndex(h => /^email$/i.test(h?.trim() ?? ""));
    const nameIdx  = hdrs.findIndex(h => /^name$/i.test(h?.trim() ?? ""));
    const countIdx = hdrs.findIndex(h => /(initial.*count|email.*count|count)/i.test(h?.trim() ?? ""));

    let filtered = dataRows;

    if (from || to) {
      filtered = filtered.filter(r => {
        const d = toISO(r[dateIdx]?.trim() ?? "");
        if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
    if (name) {
      filtered = filtered.filter(r =>
        (r[nameIdx]?.toLowerCase() ?? "").includes(name.toLowerCase())
      );
    }

    return NextResponse.json({
      headers: ["Date", "Email", "Name", "Initial Email Count"],
      rows: filtered.map(r => [
        r[dateIdx]  ?? "",
        r[emailIdx] ?? "",
        r[nameIdx]  ?? "",
        r[countIdx] ?? "",
      ]),
      total,
      filtered: filtered.length,
    });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
