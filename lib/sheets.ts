/**
 * lib/sheets.ts
 *
 * Google Sheets client using a Service Account.
 *
 * Required Vercel environment variables:
 *
 *   GOOGLE_CREDENTIALS_JSON   → paste the ENTIRE service account JSON file content
 *   SHEETS_SPREADSHEET_ID     → Google Sheet URL → .../spreadsheets/d/<THIS>/edit
 *   KPI_TAB_NAMES             → comma-separated tab names e.g. "Individual KPI Database,Team KPI Database"
 *   TASKS_TAB_NAMES           → comma-separated tab names e.g. "Regular Tasks Report,Hireflix Count"
 *
 * Share the Google Sheet with the service account email (Viewer access).
 */

import { sheets_v4, google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!credsRaw) {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is not set in Vercel environment variables. " +
        "Paste your entire service account JSON file content as the value."
    );
  }

  let credentials: object;
  try {
    credentials = JSON.parse(credsRaw);
  } catch {
    throw new Error(
      "GOOGLE_CREDENTIALS_JSON is not valid JSON. " +
        "Make sure you pasted the entire service account JSON file without any modifications."
    );
  }

  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SheetData = {
  tab: string;
  columns: string[];
  rows: unknown[][];
};

// ─── Core fetch helper ────────────────────────────────────────────────────────

async function fetchTab(
  spreadsheetId: string,
  tabName: string
): Promise<SheetData> {
  const client = getSheetsClient();

  const response = await client.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });

  const rawRows = (response.data.values as unknown[][]) ?? [];

  if (rawRows.length === 0) {
    return { tab: tabName, columns: [], rows: [] };
  }

  const columns = rawRows[0].map((c) => String(c ?? ""));
  const rows = rawRows.slice(1);

  return { tab: tabName, columns, rows };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getKPIData(): Promise<SheetData[]> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const tabNamesRaw = process.env.KPI_TAB_NAMES;

  if (!spreadsheetId || !tabNamesRaw) {
    const missing = [
      !spreadsheetId && "SHEETS_SPREADSHEET_ID",
      !tabNamesRaw && "KPI_TAB_NAMES",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing Vercel env vars: ${missing}`);
  }

  const tabNames = tabNamesRaw.split(",").map((t) => t.trim()).filter(Boolean);
  return Promise.all(tabNames.map((tab) => fetchTab(spreadsheetId, tab)));
}

export async function getTasksData(): Promise<SheetData[]> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const tabNamesRaw = process.env.TASKS_TAB_NAMES;

  if (!spreadsheetId || !tabNamesRaw) {
    const missing = [
      !spreadsheetId && "SHEETS_SPREADSHEET_ID",
      !tabNamesRaw && "TASKS_TAB_NAMES",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing Vercel env vars: ${missing}`);
  }

  const tabNames = tabNamesRaw.split(",").map((t) => t.trim()).filter(Boolean);
  return Promise.all(tabNames.map((tab) => fetchTab(spreadsheetId, tab)));
}

export async function fetchSheet(tabName: string): Promise<SheetData> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("SHEETS_SPREADSHEET_ID is not set in Vercel environment variables.");
  }
  return fetchTab(spreadsheetId, tabName);
}
