import { sheets_v4, google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let sheetsClient: sheets_v4.Sheets | null = null;

function getAuthClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: "service_account",
      project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    } as any,
    scopes: SCOPES,
  });
  return auth;
}

function getSheetsClient() {
  if (!sheetsClient) {
    sheetsClient = google.sheets({
      version: "v4",
      auth: getAuthClient(),
    });
  }
  return sheetsClient;
}

export interface SheetData {
  tab: string;
  rows: unknown[][];
  columns?: string[];
}

export async function readSheet(
  spreadsheetId: string,
  range: string
): Promise<SheetData> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const values = response.data.values || [];
  const columns = values.length > 0 ? (values[0] as string[]) : [];
  const rows = values.slice(1);

  return {
    tab: range.split("!")[0] || "Unknown",
    rows,
    columns,
  };
}

export async function readMultipleTabs(
  spreadsheetId: string,
  tabNames: string[]
): Promise<SheetData[]> {
  const results = await Promise.all(
    tabNames.map(async (tab) => {
      try {
        // Format: 'Tab Name'!A:Z to read all columns
        const range = `'${tab}'!A:Z`;
        return await readSheet(spreadsheetId, range);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read tab "${tab}":`, msg);
        return {
          tab,
          rows: [],
          columns: [],
        };
      }
    })
  );

  return results;
}

export async function getKPIData(): Promise<SheetData[]> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const kpiTabNames = (process.env.KPI_TAB_NAMES || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!spreadsheetId || kpiTabNames.length === 0) {
    throw new Error("SHEETS_SPREADSHEET_ID or KPI_TAB_NAMES not configured");
  }

  return readMultipleTabs(spreadsheetId, kpiTabNames);
}

export async function getTasksData(): Promise<SheetData[]> {
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
  const taskTabNames = (process.env.TASKS_TAB_NAMES || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!spreadsheetId || taskTabNames.length === 0) {
    throw new Error("SHEETS_SPREADSHEET_ID or TASKS_TAB_NAMES not configured");
  }

  return readMultipleTabs(spreadsheetId, taskTabNames);
}

export const Sheets = {
  readSheet,
  readMultipleTabs,
  getKPIData,
  getTasksData,
};
