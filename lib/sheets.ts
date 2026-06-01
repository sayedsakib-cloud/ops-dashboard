/**
 * lib/sheets.ts
 *
 * Google Sheets client using a Service Account.
 *
 * Required Vercel environment variables (set ALL of these with real values):
 *
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   → service account JSON → "client_email"
 *   GOOGLE_PRIVATE_KEY             → service account JSON → "private_key"
 *                                    (paste the full value including -----BEGIN/END-----)
 *   GOOGLE_PRIVATE_KEY_ID          → service account JSON → "private_key_id"
 *   GOOGLE_CLOUD_PROJECT_ID        → service account JSON → "project_id"
 *   SHEETS_SPREADSHEET_ID          → Google Sheet URL → .../spreadsheets/d/<THIS>/edit
 *   KPI_TAB_NAMES                  → comma-separated tab names e.g. "Individual KPI,Team KPI"
 *   TASKS_TAB_NAMES                → comma-separated tab names e.g. "Regular Tasks,Hireflix"
 *
 * Share the Google Sheet with the service account email (Viewer access).
 */

import { sheets_v4, google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let sheetsClient: sheets_v4.Sheets | null = null;

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const privateKeyId = process.env.GOOGLE_PRIVATE_KEY_ID;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

  if (!email || !rawKey || !privateKeyId || !projectId) {
    const missing = [
      !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      !rawKey && "GOOGLE_PRIVATE_KEY",
      !privateKeyId && "GOOGLE_PRIVATE_KEY_ID",
      !projectId && "GOOGLE_CLOUD_PROJECT_ID",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Google Sheets: missing Vercel env vars: ${missing}. ` +
        `Go to Vercel → Settings → Environment Variables and paste the actual values from your service account JSON.`
    );
  }

  // Vercel sometimes stores \n literally — convert to real newlines
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      type: "service_account",
      project_id: projectId,
      private_key_id: privateKeyId,
      private_key: privateKey,
      client_email: email,
    },
    scopes: SCOPES,
  });
}

function getSheetsClient(): sheets_v4.Sheets {
  if (!sheetsClient) {
    const auth = getAuthClient();
    sheetsClient = google.sheets({ version: "v4", auth });
  }
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

  // First row = column headers
  const columns = rawRows[0].map((c) => String(c ?? ""));
  const rows = rawRows.slice(1);

  return { tab: tabName, columns, rows };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns all KPI sheet tabs defined in KPI_TAB_NAMES.
 * Imported as getKPIData by app/api/test/sheets/route.ts
 */
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
    throw new Error(
      `Missing Vercel env vars: ${missing}. ` +
        `Set SHEETS_SPREADSHEET_ID to the ID in your Google Sheet URL, ` +
        `and KPI_TAB_NAMES to comma-separated tab names (e.g. "Individual KPI,Team KPI").`
    );
  }

  const tabNames = tabNamesRaw.split(",").map((t) => t.trim()).filter(Boolean);

  return Promise.all(tabNames.map((tab) => fetchTab(spreadsheetId, tab)));
}

/**
 * Returns all Tasks sheet tabs defined in TASKS_TAB_NAMES.
 * Imported as getTasksData by app/api/test/sheets/route.ts
 */
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
    throw new Error(
      `Missing Vercel env vars: ${missing}. ` +
        `Set TASKS_TAB_NAMES to comma-separated tab names (e.g. "Regular Tasks,Hireflix").`
    );
  }

  const tabNames = tabNamesRaw.split(",").map((t) => t.trim()).filter(Boolean);

  return Promise.all(tabNames.map((tab) => fetchTab(spreadsheetId, tab)));
}

/**
 * Fetches any single tab by name.
 */
export async function fetchSheet(tabName: string): Promise<SheetData> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error(
      "SHEETS_SPREADSHEET_ID is not set in Vercel environment variables."
    );
  }

  return fetchTab(spreadsheetId, tabName);
}
