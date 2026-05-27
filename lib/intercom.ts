import axios from "axios";

// Allow self-signed certificates for local development (corporate CA issue)
// TODO: Replace with NODE_EXTRA_CA_CERTS in production
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const INTERCOM_BASE = "https://api.intercom.io";

// INTERCOM_API_KEY may already include "Bearer" prefix, so check and format accordingly
const getAuthHeader = (): string => {
  const key = process.env.INTERCOM_API_KEY || "";
  if (key.startsWith("Bearer ")) {
    return key;
  }
  return `Bearer ${key}`;
};

const HEADERS = {
  Authorization: getAuthHeader(),
  Accept: "application/json",
  "Intercom-Version": "2.11",
  "Content-Type": "application/json",
};

async function intercomFetch(path: string, options: RequestInit = {}) {
  try {
    const url = `${INTERCOM_BASE}${path}`;
    const method = (options.method || "GET").toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
    
    const response = await axios({
      url,
      method,
      headers: HEADERS,
      data: options.body ? JSON.parse(options.body as string) : undefined,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      console.error("Intercom API error:", { status: response.status, data: response.data });
      throw new Error(`Intercom API error (${response.status}): ${JSON.stringify(response.data)}`);
    }

    return response.data;
  } catch (err) {
    console.error("Intercom request error:", err);
    throw err;
  }
}

export async function getTeams(): Promise<{ teams: { id: string; name: string }[] } > {
  return intercomFetch("/teams");
}

export async function getConversationCountForTeam(teamId: string, fromTimestamp?: number): Promise<number> {
  const query: { operator: string; value: Array<Record<string, unknown>> } = {
    operator: "AND",
    value: [{ field: "team_assignee_id", operator: "=", value: String(teamId) }],
  };

  if (fromTimestamp) {
    query.value.push({ field: "created_at", operator: ">", value: fromTimestamp });
  }

  const body: { query: { operator: string; value: Array<Record<string, unknown>> }; pagination: { per_page: number } } = {
    query,
    pagination: { per_page: 1 },
  };

  const res = await intercomFetch("/conversations/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const typed = res as { total_count?: number };
  return typed.total_count ?? 0;
}

export async function getAllInboxCounts(): Promise<{
  teamId: string;
  name: string;
  total: number;
  error?: string;
}[]> {
  const teamsRes = await getTeams();
  const teams = teamsRes.teams || [];

  const results = await Promise.all(
    teams.map(async (t) => {
      try {
        const total = await getConversationCountForTeam(t.id);
        return { teamId: t.id, name: t.name, total };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { teamId: t.id, name: t.name, total: 0, error: msg };
      }
    })
  );

  return results;
}

/**
 * Get total conversation count for specific inboxes in a date range
 */
export async function getConversationCount(
  inboxIds: string[],
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const fromTimestamp = Math.floor(fromDate.getTime() / 1000);
  const toTimestamp = Math.floor(toDate.getTime() / 1000);

  // Create OR conditions for multiple team IDs
  const teamConditions = inboxIds.map((id) => ({
    field: "team_assignee_id",
    operator: "=",
    value: id,
  }));

  const query = {
    operator: "AND",
    value: [
      teamConditions.length === 1
        ? teamConditions[0]
        : { operator: "OR", value: teamConditions },
      { field: "created_at", operator: ">", value: fromTimestamp },
      { field: "created_at", operator: "<", value: toTimestamp },
    ],
  };

  const body = {
    query,
    pagination: { per_page: 1 },
  };

  const res = await intercomFetch("/conversations/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return (res as { total_count?: number }).total_count ?? 0;
}

/**
 * Get new conversations (created in last N hours)
 */
export async function getNewConversations(inboxIds: string[], hours: number = 24): Promise<number> {
  const now = new Date();
  const pastTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

  return getConversationCount(inboxIds, pastTime, now);
}

/**
 * Get reopened conversations in a date range
 */
export async function getReopenedConversations(
  inboxIds: string[],
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const fromTimestamp = Math.floor(fromDate.getTime() / 1000);
  const toTimestamp = Math.floor(toDate.getTime() / 1000);

  // Create OR conditions for multiple team IDs
  const teamConditions = inboxIds.map((id) => ({
    field: "team_assignee_id",
    operator: "=",
    value: id,
  }));

  const query = {
    operator: "AND",
    value: [
      teamConditions.length === 1
        ? teamConditions[0]
        : { operator: "OR", value: teamConditions },
      { field: "updated_at", operator: ">", value: fromTimestamp },
      { field: "updated_at", operator: "<", value: toTimestamp },
      { field: "state", operator: "=", value: "open" },
    ],
  };

  const body = {
    query,
    pagination: { per_page: 1 },
  };

  const res = await intercomFetch("/conversations/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return (res as { total_count?: number }).total_count ?? 0;
}

/**
 * Get average first response time in seconds for conversations
 */
export async function getAverageFirstResponseTime(
  inboxIds: string[],
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const fromTimestamp = Math.floor(fromDate.getTime() / 1000);
  const toTimestamp = Math.floor(toDate.getTime() / 1000);

  // Create OR conditions for multiple team IDs
  const teamConditions = inboxIds.map((id) => ({
    field: "team_assignee_id",
    operator: "=",
    value: id,
  }));

  const query = {
    operator: "AND",
    value: [
      teamConditions.length === 1
        ? teamConditions[0]
        : { operator: "OR", value: teamConditions },
      { field: "created_at", operator: ">", value: fromTimestamp },
      { field: "created_at", operator: "<", value: toTimestamp },
    ],
  };

  const body = {
    query,
    pagination: { per_page: 100 },
  };

  const res = await intercomFetch("/conversations/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const conversations = (res as { conversations?: Array<{ statistics?: { first_contact_reply_at?: number } }> })
    .conversations ?? [];

  if (conversations.length === 0) return 0;

  const responseTimes = conversations
    .filter((conv) => conv.statistics?.first_contact_reply_at)
    .map((conv) => conv.statistics?.first_contact_reply_at ?? 0);

  if (responseTimes.length === 0) return 0;

  const average = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  return Math.round(average);
}

/**
 * Get conversation timeseries data for charting (daily counts)
 */
export async function getConversationTimeseries(
  inboxIds: string[],
  fromDate: Date,
  toDate: Date,
  intervalDays: number = 1
): Promise<Array<{ date: string; count: number }>> {
  const timeseries: Array<{ date: string; count: number }> = [];
  const currentDate = new Date(fromDate);

  while (currentDate <= toDate) {
    const dayStart = new Date(currentDate);
    const dayEnd = new Date(currentDate);
    dayEnd.setDate(dayEnd.getDate() + intervalDays);

    const count = await getConversationCount(inboxIds, dayStart, dayEnd);
    const dateStr = dayStart.toISOString().split("T")[0]; // YYYY-MM-DD format

    timeseries.push({ date: dateStr, count });

    currentDate.setDate(currentDate.getDate() + intervalDays);
  }

  return timeseries;
}

/**
 * Format seconds to human readable time (e.g., "2h 11m", "42s")
 */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export const Intercom = {
  getTeams,
  getConversationCountForTeam,
  getAllInboxCounts,
  getConversationCount,
  getNewConversations,
  getReopenedConversations,
  getAverageFirstResponseTime,
  getConversationTimeseries,
  formatSeconds,
};
