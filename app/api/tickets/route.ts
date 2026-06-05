import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const INTERCOM_API = "https://api.intercom.io";
const INBOX: Record<string, string> = {
  cr:     "6547584",
  bizops: "8314220",
};
const SLA_SECS = 24 * 3600;

const TICKET_TYPES: Record<string, string[]> = {
  cr: [
    "CR - Account Got Flagged But Email Was Not Sent",
    "CR - Need to Respond to Client's Email / Client Missed the Interview",
    "CR - Case Requires Review",
  ],
  bizops: [
    "BO - Change of Payout Address & Method",
    "BO - Client facing RISE Work Issue",
    "BO - Competition KYC",
    "BO - Competition Payout address",
    "BO - Complaint About Discrepancy in Profit Share",
    "BO - KYC/Agreement Sign Done, Yet to Receive FundedNext Account/Unable to Sign Agreement",
    "BO - Max Allocation Issue",
    "BO - Need Update of KYC",
    "BO - Veriff Doesn't Accept KYC Documents / Unable to Submit KYC Documents",
    "BO - Need An Update Of Current Payout",
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────
function toUnixStart(d: string) {
  return Math.floor(new Date(d + "T00:00:00+06:00").getTime() / 1000);
}
function toUnixEnd(d: string) {
  return Math.floor(new Date(d + "T23:59:59+06:00").getTime() / 1000);
}
function isOfficeHours(ts: number): boolean {
  const d     = new Date(ts * 1000);
  const gmt6h = (d.getUTCHours() + 6) % 24;
  const mins  = gmt6h * 60 + d.getUTCMinutes();
  return mins >= 540 && mins < 1020;
}
function fmt(secs: number): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.round(secs / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24)  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}
function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ── Fetch admins (to map admin_assignee_id → name) ─────────────────────────
async function fetchAdminMap(token: string): Promise<Map<string, string>> {
  try {
    const res  = await fetch(`${INTERCOM_API}/admins`, {
      headers: {
        Authorization:      `Bearer ${token}`,
        Accept:             "application/json",
        "Intercom-Version": "2.11",
      },
    });
    const data = await res.json();
    const map  = new Map<string, string>();
    (data.admins ?? []).forEach((a: any) => {
      map.set(String(a.id), a.name ?? a.email ?? `Admin ${a.id}`);
    });
    return map;
  } catch {
    return new Map();
  }
}

// ── Fetch tickets with pagination ─────────────────────────────────────────
async function fetchTickets(
  token: string,
  inboxId: string,
  cAfter: number,
  cBefore: number,
): Promise<any[]> {
  const filters: any[] = [
    { field: "team_assignee_id", operator: "=", value: parseInt(inboxId) },
    { field: "created_at",       operator: ">", value: cAfter            },
    { field: "created_at",       operator: "<", value: cBefore           },
  ];

  const all: any[] = [];
  let cursor: string | null = null;

  for (let p = 0; p < 10; p++) {
    const body: any = {
      query:      { operator: "AND", value: filters },
      pagination: { per_page: 150 },
    };
    if (cursor) body.pagination.starting_after = cursor;

    const res = await fetch(`${INTERCOM_API}/tickets/search`, {
      method: "POST",
      headers: {
        Authorization:      `Bearer ${token}`,
        "Content-Type":     "application/json",
        Accept:             "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Intercom ${res.status}: ${txt}`);
    }

    const data  = await res.json();
    const items = data.tickets ?? data.data ?? [];
    all.push(...items);
    cursor = data.pages?.next?.starting_after ?? null;
    if (!cursor) break;
  }
  return all;
}

// ── Route ──────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const section      = searchParams.get("section")      ?? "cr";
    const createdFrom  = searchParams.get("createdFrom")  ?? "";
    const createdTo    = searchParams.get("createdTo")    ?? "";
    const resolvedFrom = searchParams.get("resolvedFrom") ?? "";
    const resolvedTo   = searchParams.get("resolvedTo")   ?? "";
    const typeFilter   = searchParams.get("type")         ?? "";

    const token   = process.env.INTERCOM_ACCESS_TOKEN;
    if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not set");

    const now    = Math.floor(Date.now() / 1000);
    const d30    = now - 30 * 86400;
    const cAfter  = createdFrom ? toUnixStart(createdFrom) : d30;
    const cBefore = createdTo   ? toUnixEnd(createdTo)     : now;

    const inboxId = INBOX[section] ?? INBOX.cr;

    // Fetch tickets + admins in parallel
    const [tickets, adminMap] = await Promise.all([
      fetchTickets(token, inboxId, cAfter, cBefore),
      fetchAdminMap(token),
    ]);

    // ── Resolved date filter (client-side) ──────────────────────────────
    let filtered = tickets;
    if (resolvedFrom || resolvedTo) {
      const rAfter  = resolvedFrom ? toUnixStart(resolvedFrom) : 0;
      const rBefore = resolvedTo   ? toUnixEnd(resolvedTo)     : Infinity;
      filtered = filtered.filter(t => {
        if (t.open !== false && t.ticket_state !== "resolved") return false;
        const closeTs = t.updated_at ?? 0;
        if (!closeTs) return false;
        if (rAfter  && closeTs < rAfter)  return false;
        if (rBefore && closeTs > rBefore) return false;
        return true;
      });
    }

    // ── Ticket type filter ───────────────────────────────────────────────
    if (typeFilter) {
      filtered = filtered.filter(t => t.ticket_type?.name === typeFilter);
    }

    // ── Merge hardcoded + dynamic ticket types ───────────────────────────
    const dynamicTypes = new Set<string>();
    tickets.forEach(t => { if (t.ticket_type?.name) dynamicTypes.add(t.ticket_type.name); });
    const base  = TICKET_TYPES[section] ?? [];
    const extra = [...dynamicTypes].filter(n => !base.includes(n)).sort();
    const ticketTypes = [...base, ...extra];

    // ── Resolved vs open ────────────────────────────────────────────────
    // open === false means resolved/closed in Intercom Tickets
    const resolved = filtered.filter(t => t.open === false || t.ticket_state === "resolved");
    const open     = filtered.filter(t => t.open !== false && t.ticket_state !== "resolved");

    // ── Per-ticket metrics ───────────────────────────────────────────────
    type Stat = {
      secs: number; officeHours: boolean;
      agentName: string; slaMet: boolean;
    };

    const stats: Stat[] = resolved.map(t => {
      // Resolution time: updated_at is the last state change timestamp
      // (ticket_state_updated_at doesn't exist in the API response)
      const closeTs   = t.updated_at ?? 0;
      const secs      = (closeTs > 0 && closeTs > t.created_at)
                          ? (closeTs - t.created_at)
                          : 0;

      // Agent name: tickets use admin_assignee_id (integer), not assignee.name
      const adminId   = String(t.admin_assignee_id ?? 0);
      const agentName = (adminId === "0" || !t.admin_assignee_id)
                          ? "Unassigned"
                          : (adminMap.get(adminId) ?? `Admin ${adminId}`);

      return {
        secs,
        officeHours: isOfficeHours(t.created_at),
        agentName,
        slaMet: secs > 0 && secs <= SLA_SECS,
      };
    });

    // Only include tickets with valid resolution time in SLA + avg calculations
    const withTime    = stats.filter(s => s.secs > 0);
    const allSecs     = withTime.map(s => s.secs);
    const officeSecs  = withTime.filter(s =>  s.officeHours).map(s => s.secs);
    const outsideSecs = withTime.filter(s => !s.officeHours).map(s => s.secs);
    const slaMet      = withTime.filter(s =>  s.slaMet);
    const slaBreached = withTime.filter(s => !s.slaMet);

    // ── By agent ─────────────────────────────────────────────────────────
    type Acc = { resolved: number; totalSecs: number; slaMet: number; slaBreached: number };
    const agentMap2 = new Map<string, Acc>();

    stats.forEach(({ agentName, secs, slaMet: met }) => {
      if (!agentMap2.has(agentName))
        agentMap2.set(agentName, { resolved: 0, totalSecs: 0, slaMet: 0, slaBreached: 0 });
      const a = agentMap2.get(agentName)!;
      a.resolved++;
      if (secs > 0) {
        a.totalSecs += secs;
        if (met) a.slaMet++; else a.slaBreached++;
      }
    });

    const byAgent = [...agentMap2.entries()]
      .map(([name, a]) => {
        const timedCount = a.slaMet + a.slaBreached;
        return {
          name,
          resolved:         a.resolved,
          avgResolutionFmt: timedCount > 0 ? fmt(a.totalSecs / timedCount) : "—",
          slaMet:           a.slaMet,
          slaBreaches:      a.slaBreached,
          slaRate:          timedCount > 0
                              ? +((a.slaMet / timedCount) * 100).toFixed(1)
                              : 0,
        };
      })
      .sort((a, b) => b.resolved - a.resolved);

    const slaBase = withTime.length;

    return NextResponse.json({
      summary: {
        total:                  filtered.length,
        resolved:               resolved.length,
        open:                   open.length,
        slaMetCount:            slaMet.length,
        slaBreachCount:         slaBreached.length,
        slaComplianceRate:      slaBase > 0
                                  ? +((slaMet.length / slaBase) * 100).toFixed(1)
                                  : 0,
        avgResolutionFmt:       fmt(avg(allSecs)),
        avgOfficeHoursFmt:      officeSecs.length  ? fmt(avg(officeSecs))  : "—",
        avgOfficeHoursCount:    officeSecs.length,
        avgOutsideHoursFmt:     outsideSecs.length ? fmt(avg(outsideSecs)) : "—",
        avgOutsideHoursCount:   outsideSecs.length,
      },
      byAgent,
      ticketTypes,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
