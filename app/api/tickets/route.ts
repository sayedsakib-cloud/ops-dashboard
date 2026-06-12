import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { unstable_cache }   from "next/cache";

const INTERCOM_API = "https://api.intercom.io";
const APP_ID       = "aphmhtyj";
const SLA_SECS     = 24 * 3600;

const INBOX: Record<string, string> = {
  cr:     "6547584",
  bizops: "8314220",
};

const SECTION_AGENTS: Record<string, string[]> = {
  cr:     ["samael", "camellia warren", "anna linhart"],
  bizops: ["oliver ellison", "luna parker", "paul wilson", "sienna clarke",
           "nauvi becker", "mathew adrian castle", "delilah", "michael anderson"],
};

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

const CACHE_WINDOW = 900; // 15-minute rounding for stable cache keys

// ── Helpers ────────────────────────────────────────────────────────────────
function toUnixStart(d: string) {
  return Math.floor(new Date(d + "T00:00:00+06:00").getTime() / 1000);
}
function toUnixEnd(d: string) {
  return Math.floor(new Date(d + "T23:59:59+06:00").getTime() / 1000);
}
// Rounds `now` to the nearest 15-min boundary so the default (no date params)
// cache key stays stable across all requests in the same window.
// Without this, `now` changes every second → new cache key every second →
// getCachedTickets never hits → full re-fetch on every single page load.
function roundTs(ts: number): number {
  return Math.floor(ts / CACHE_WINDOW) * CACHE_WINDOW;
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

/** Who resolved the ticket — reads ticket_parts history, more accurate than admin_assignee_id */
function getResolver(ticket: any, adminMap: Map<string, string>): string {
  const parts: any[] = ticket.ticket_parts?.ticket_parts ?? [];

  // Pass 1 — find the part that explicitly set state to "resolved"
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (
      p.ticket_state === "resolved" &&
      p.author?.type === "admin" &&
      p.author?.name &&
      p.author.name !== "Deleted Author"
    ) return p.author.name;
  }

  // Pass 2 — last admin who touched the ticket (heuristic: most recent action = resolver)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (
      p.author?.type === "admin" &&
      p.author?.name &&
      p.author.name !== "Deleted Author"
    ) return p.author.name;
  }

  // Pass 3 — admin_assignee_id fallback
  const adminId = String(ticket.admin_assignee_id ?? 0);
  return adminId !== "0"
    ? (adminMap.get(adminId) ?? `Admin ${adminId}`)
    : "Unassigned";
}

// ── Server-side cache: admins (1-hour TTL — rarely change) ────────────────
const getCachedAdmins = unstable_cache(
  async (): Promise<{ nameMap: Record<string, string>; admins: any[] }> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    try {
      const res  = await fetch(`${INTERCOM_API}/admins`, {
        headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
      });
      const data = await res.json();
      const list = (data.admins ?? []) as any[];
      const nameMap: Record<string, string> = {};
      list.forEach(a => { nameMap[String(a.id)] = a.name ?? a.email ?? `Admin ${a.id}`; });
      return { nameMap, admins: list };
    } catch {
      return { nameMap: {}, admins: [] };
    }
  },
  ["intercom-admins"],
  { revalidate: 3600 }
);

// ── Server-side cache: tickets (5-min TTL) ────────────────────────────────
const getCachedTickets = unstable_cache(
  async (
    inboxId:      string,
    agentIdsJson: string,
    cAfter:       number,
    cBefore:      number,
  ): Promise<any[]> => {
    const token    = process.env.INTERCOM_ACCESS_TOKEN!;
    const agentIds = JSON.parse(agentIdsJson) as number[];

    const orClauses: any[] = [
      { field: "team_assignee_id", operator: "=", value: parseInt(inboxId) },
      ...agentIds.map(id => ({ field: "admin_assignee_id", operator: "=", value: id })),
    ];

    const query = {
      operator: "AND",
      value: [
        orClauses.length > 1 ? { operator: "OR", value: orClauses } : orClauses[0],
        { field: "created_at", operator: ">", value: cAfter  },
        { field: "created_at", operator: "<", value: cBefore },
      ],
    };

    const all: any[]       = [];
    const seen             = new Set<string>();
    let cursor: string | null = null;

    for (let p = 0; p < 15; p++) {
      const body: any = { query, pagination: { per_page: 150 } };
      if (cursor) body.pagination.starting_after = cursor;

      const res = await fetch(`${INTERCOM_API}/tickets/search`, {
        method: "POST",
        headers: {
          Authorization:      `Bearer ${token}`,
          "Content-Type":     "application/json",
          "Intercom-Version": "2.11",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Intercom ${res.status}: ${txt}`);
      }

      const data  = await res.json();
      const items = (data.tickets ?? data.data ?? []) as any[];
      for (const t of items) {
        if (!seen.has(t.id)) { seen.add(t.id); all.push(t); }
      }

      cursor = data.pages?.next?.starting_after ?? null;
      if (!cursor) break;
    }
    return all;
  },
  ["intercom-tickets"],
  { revalidate: 900 } // 15-minute cache -- matches TEEP TTL
);

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

    if (!process.env.INTERCOM_ACCESS_TOKEN)
      throw new Error("INTERCOM_ACCESS_TOKEN not set");

    const now    = Math.floor(Date.now() / 1000);
    const d30    = now - 30 * 86400;
    // Use rounded timestamps for default range so cache key stays stable
    // across requests in the same 15-min window (explicit date params stay exact)
    const cAfter  = createdFrom ? toUnixStart(createdFrom) : roundTs(d30);
    const cBefore = createdTo   ? toUnixEnd(createdTo)     : roundTs(now);
    const inboxId = INBOX[section] ?? INBOX.cr;

    // ── Step 1: cached admin list (fast after first call) ──────────────────
    const { nameMap, admins: adminList } = await getCachedAdmins();
    const adminMap = new Map(Object.entries(nameMap));

    // Resolve agent IDs for this section via name matching
    const sectionAgentNames = SECTION_AGENTS[section] ?? [];
    const agentIds = adminList
      .filter((a: any) => {
        const name = (a.name ?? "").toLowerCase();
        return sectionAgentNames.some(n => name.includes(n) || n.includes(name));
      })
      .map((a: any) => parseInt(a.id))
      .filter(Boolean);

    // ── Step 2: cached tickets (fast after first call for same params) ─────
    const tickets = await getCachedTickets(
      inboxId,
      JSON.stringify(agentIds.sort((a, b) => a - b)), // sorted for stable cache key
      cAfter,
      cBefore,
    );

    // ── Resolved date filter (client-side) ─────────────────────────────────
    let filtered = tickets;
    if (resolvedFrom || resolvedTo) {
      const rAfter  = resolvedFrom ? toUnixStart(resolvedFrom) : 0;
      const rBefore = resolvedTo   ? toUnixEnd(resolvedTo)     : Infinity;
      filtered = filtered.filter(t => {
        if (t.open !== false && t.ticket_state !== "resolved") return false;
        const closeTs = t.updated_at ?? 0;
        if (!closeTs)                    return false;
        if (rAfter  && closeTs < rAfter) return false;
        if (rBefore && closeTs > rBefore) return false;
        return true;
      });
    }

    // ── Ticket type filter ─────────────────────────────────────────────────
    if (typeFilter) {
      filtered = filtered.filter(t => t.ticket_type?.name === typeFilter);
    }

    // ── Ticket type stats for chart + dropdown ─────────────────────────────
    const typeCountMap = new Map<string, number>();
    filtered.forEach(t => {
      const name = t.ticket_type?.name;
      if (name) typeCountMap.set(name, (typeCountMap.get(name) ?? 0) + 1);
    });
    const ticketTypeStats = [...typeCountMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const base     = TICKET_TYPES[section] ?? [];
    const dynamic  = [...typeCountMap.keys()].filter(n => !base.includes(n)).sort();
    const ticketTypes = [...base, ...dynamic];

    // ── Resolved vs open ───────────────────────────────────────────────────
    const resolved = filtered.filter(t => t.open === false || t.ticket_state === "resolved");
    const open     = filtered.filter(t => t.open !== false && t.ticket_state !== "resolved");

    // ── Per-ticket metrics ─────────────────────────────────────────────────
    type Stat = {
      secs: number; officeHours: boolean;
      agentName: string; slaMet: boolean; ticket: any;
    };
    const stats: Stat[] = resolved.map(t => {
      const closeTs   = t.updated_at ?? 0;
      const secs      = closeTs > 0 && closeTs > t.created_at ? closeTs - t.created_at : 0;
      const agentName = getResolver(t, adminMap);
      return {
        secs,
        officeHours: isOfficeHours(t.created_at),
        agentName,
        slaMet: secs > 0 && secs <= SLA_SECS,
        ticket: t,
      };
    });

    const withTime    = stats.filter(s => s.secs > 0);
    const allSecs     = withTime.map(s => s.secs);
    const officeSecs  = withTime.filter(s =>  s.officeHours).map(s => s.secs);
    const outsideSecs = withTime.filter(s => !s.officeHours).map(s => s.secs);
    const slaMet      = withTime.filter(s =>  s.slaMet);
    const slaBreached = withTime.filter(s => !s.slaMet);

    // ── By agent ───────────────────────────────────────────────────────────
    type Acc = { resolved: number; totalSecs: number; slaMet: number; slaBreached: number };
    const agentAccMap = new Map<string, Acc>();
    stats.forEach(({ agentName, secs, slaMet: met }) => {
      if (!agentAccMap.has(agentName))
        agentAccMap.set(agentName, { resolved: 0, totalSecs: 0, slaMet: 0, slaBreached: 0 });
      const a = agentAccMap.get(agentName)!;
      a.resolved++;
      if (secs > 0) { a.totalSecs += secs; if (met) a.slaMet++; else a.slaBreached++; }
    });

    const byAgent = [...agentAccMap.entries()]
      .map(([name, a]) => {
        const n = a.slaMet + a.slaBreached;
        return {
          name,
          resolved:         a.resolved,
          avgResolutionFmt: n > 0 ? fmt(a.totalSecs / n) : "—",
          slaMet:           a.slaMet,
          slaBreaches:      a.slaBreached,
          slaRate:          n > 0 ? +((a.slaMet / n) * 100).toFixed(1) : 0,
        };
      })
      .sort((a, b) => b.resolved - a.resolved);

    // ── SLA breach details ─────────────────────────────────────────────────
    const slaBreachDetails = slaBreached
      .sort((a, b) => b.secs - a.secs)
      .slice(0, 100)
      .map(s => {
        const t       = s.ticket;
        const contact = t.contacts?.contacts?.[0];
        return {
          id:                t.id,
          ticketId:          t.ticket_id ?? t.id,
          ticketLink:        `https://app.intercom.com/a/apps/${APP_ID}/inbox/shared/all/ticket/${t.id}`,
          contactRef:        contact?.external_id ?? contact?.id ?? "—",
          ticketType:        t.ticket_type?.name ?? "—",
          createdAt:         t.created_at,
          resolvedAt:        t.updated_at ?? 0,
          resolutionTimeFmt: fmt(s.secs),
          resolvedBy:        s.agentName,
        };
      });

    return NextResponse.json({
      summary: {
        total:                 filtered.length,
        resolved:              resolved.length,
        open:                  open.length,
        slaMetCount:           slaMet.length,
        slaBreachCount:        slaBreached.length,
        slaComplianceRate:     withTime.length > 0
                                 ? +((slaMet.length / withTime.length) * 100).toFixed(1)
                                 : 0,
        avgResolutionFmt:      fmt(avg(allSecs)),
        avgOfficeHoursFmt:     officeSecs.length  ? fmt(avg(officeSecs))  : "—",
        avgOfficeHoursCount:   officeSecs.length,
        avgOutsideHoursFmt:    outsideSecs.length ? fmt(avg(outsideSecs)) : "—",
        avgOutsideHoursCount:  outsideSecs.length,
      },
      byAgent,
      ticketTypes,
      ticketTypeStats,
      slaBreachDetails,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
