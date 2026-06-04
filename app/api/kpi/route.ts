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

// Individual KPI col indices (after slicing header, 0-based from col B)
const I = {
  weekStart: 0, weekEnd: 1, quarter: 2, name: 3,
  complexityGroup: 4, frtSpeed: 5, frtCount: 6,
  complexity: 7, emailCount: 8, quality: 9,
  qcErrors: 10, remarks: 11,
};

// Team KPI col indices
const T = {
  weekStart: 0, weekEnd: 1, quarter: 2,
  negReviewPct: 3, totalReviews: 4,
  stakeholderMgmt: 5, remarks: 6,
};

function safe(row: string[], idx: number): string {
  return row?.[idx]?.trim() ?? "";
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const agentFilter = searchParams.get("agent") ?? "all";
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID not set");

    const sheets = await sheetsClient();

    const [indivRes, teamRes, qtrRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Individual KPI Database!B2:M",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Team KPI Database!B2:H",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "Quarterly Average Points!A1:D",
      }),
    ]);

    // Row 0 = header, Row 1+ = data
    const indivAll = (indivRes.data.values ?? []).slice(1)
      .filter(r => safe(r as string[], I.weekStart)) as string[][];
    const teamAll = (teamRes.data.values ?? []).slice(1)
      .filter(r => safe(r as string[], T.weekStart)) as string[][];
    const qtrRows = (qtrRes.data.values ?? []) as string[][];
    const qtrHeader = qtrRows[0] ?? [];
    const qtrData = qtrRows.slice(1).filter(r => r[0]?.trim());

    // Unique week ranges (for date picker hints)
    const weekSet = new Set<string>();
    indivAll.forEach(r => {
      const s = safe(r, I.weekStart), e = safe(r, I.weekEnd);
      if (s && e) weekSet.add(`${s}|${e}`);
    });
    const weekRanges = [...weekSet]
      .sort()
      .map(k => { const [start, end] = k.split("|"); return { start, end }; });

    // Resolve effective date range (default to most recent week)
    let filterStart = startDate ?? weekRanges[weekRanges.length - 1]?.start ?? null;
    let filterEnd   = endDate   ?? weekRanges[weekRanges.length - 1]?.end   ?? null;

    // Filter
    const inRange = (row: string[], startIdx: number, endIdx: number) => {
      if (!filterStart || !filterEnd) return true;
      return safe(row, startIdx) >= filterStart && safe(row, endIdx) <= filterEnd;
    };

    let indivFiltered = indivAll.filter(r => inRange(r, I.weekStart, I.weekEnd));
    if (agentFilter !== "all") {
      indivFiltered = indivFiltered.filter(r => safe(r, I.name) === agentFilter);
    }
    const teamFiltered = teamAll.filter(r => inRange(r, T.weekStart, T.weekEnd));

    // Unique agents
    const allAgents = [...new Set(indivAll.map(r => safe(r, I.name)).filter(Boolean))].sort();

    // Summary
    const totalEmailVolume = indivFiltered.reduce(
      (s, r) => s + (parseInt(safe(r, I.emailCount)) || 0), 0
    );
    const agentsActive = new Set(indivFiltered.map(r => safe(r, I.name)).filter(Boolean)).size;

    const negPctValues = teamFiltered
      .map(r => parseFloat(safe(r, T.negReviewPct).replace("%", "")))
      .filter(n => !isNaN(n));
    const avgNegReview = negPctValues.length
      ? +(negPctValues.reduce((a, b) => a + b, 0) / negPctValues.length).toFixed(2)
      : null;
    const tpReviewsCount = teamFiltered.reduce(
      (s, r) => s + (parseInt(safe(r, T.totalReviews)) || 0), 0
    );

    // Available quarters (only those with ≥1 non-empty value)
    const availableQuarters = qtrHeader.slice(1).filter((q, qi) =>
      qtrData.some(r => r[qi + 1]?.trim())
    );

    return NextResponse.json({
      filterStart,
      filterEnd,
      weekRanges,
      allAgents,
      summary: { totalEmailVolume, avgNegReview, tpReviewsCount, agentsActive },
      individualPerformance: indivFiltered.map(r => ({
        weekStart:       safe(r, I.weekStart),
        weekEnd:         safe(r, I.weekEnd),
        quarter:         safe(r, I.quarter),
        name:            safe(r, I.name),
        complexityGroup: safe(r, I.complexityGroup),
        frtSpeed:        safe(r, I.frtSpeed),
        frtCount:        safe(r, I.frtCount),
        complexity:      safe(r, I.complexity),
        emailCount:      safe(r, I.emailCount),
        quality:         safe(r, I.quality),
        qcErrors:        safe(r, I.qcErrors),
        remarks:         safe(r, I.remarks),
      })),
      teamKPI: teamFiltered.map(r => ({
        weekStart:       safe(r, T.weekStart),
        weekEnd:         safe(r, T.weekEnd),
        quarter:         safe(r, T.quarter),
        negReviewPct:    safe(r, T.negReviewPct),
        totalReviews:    safe(r, T.totalReviews),
        stakeholderMgmt: safe(r, T.stakeholderMgmt),
        remarks:         safe(r, T.remarks),
      })),
      quarterly: {
        availableQuarters,
        agents: qtrData.map(r => ({
          name: r[0]?.trim() ?? "",
          Q2: r[1]?.trim() ? parseFloat(r[1]) : null,
          Q3: r[2]?.trim() ? parseFloat(r[2]) : null,
          Q4: r[3]?.trim() ? parseFloat(r[3]) : null,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
