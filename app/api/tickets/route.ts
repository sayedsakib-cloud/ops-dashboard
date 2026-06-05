import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const INTERCOM_API = "https://api.intercom.io";
const INBOX: Record<string, string> = {
  cr:     "6547584",
  bizops: "8314220",
};
const SLA_SECS = 24 * 3600;

// Hardcoded ticket types per section (fallback + base list)
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

/** Is this Unix timestamp within 9:00 AM – 5:00 PM GMT+6? */
function isOfficeHours(ts: number): boolean {
  const d     = new Date(ts * 1000);
  const gmt6h = (d.getUTCHours() + 6) % 24;
  const mins  = gmt6h * 60 + d.getUTCMinutes();
  return mins >= 540 && mins < 1020;
}

/** Seconds → "4h 23m" / "1d 2h" / "35m" */
function fmt(secs: number): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.round(secs / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24)  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

// ── Fetch from Intercom (only created_at in query; resolved filtered client-side) ──
async function fetchConversations(
  inboxId: string,
  cAfter: number,
  cBefore: number,
): Promise<any[]> {
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) throw new Error("INTERCOM_ACCESS_TOKEN env var not set");

  const filters: any[] = [
    { field: "team_assignee_id", operator: "=",  value: inboxId  },
    { field: "created_at",       operator: ">",  value: cAfter   },
    { field: "created_at",       operator: "<",  value: cBefore  },
  ];

  const all: any[] = [];
  let cursor: string | null = null;

  for (let p = 0; p < 10; p++) {           // max 1,500 conversations
    const body: any = {
      query:      { operator: "AND", value: filters },
      pagination: { per_page: 150 },
    };
    if (cursor) body.pagination.starting_after = cursor;

    const res = await fetch(`${INTERCOM_API}/conversations/search`, {
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
    const data = await res.json();
    all.push(...(data.conversations ?? []));
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

    const now    = Math.floor(Date.now() / 1000);
    const d30    = now - 30 * 86400;
    const cAfter  = createdFrom ? toUnixStart(createdFrom) : d30;
    const cBefore = createdTo   ? toUnixEnd(createdTo)     : now;

    const inboxId = INBOX[section] ?? INBOX.cr;

    // Fetch — only created_at used in Intercom query
    const convs = await fetchConversations(inboxId, cAfter, cBefore);

    // ── Client-side resolved date filter ──────────────────────────────────
    let filtered = convs;
    if (resolvedFrom || resolvedTo) {
      const rAfter  = resolvedFrom ? toUnixStart(resolvedFrom) : 0;
      const rBefore = resolvedTo   ? toUnixEnd(resolvedTo)     : Infinity;
      filtered = filtered.filter(c => {
        const closeTs = c.statistics?.first_close_at;
        if (!closeTs) return false;
        if (rAfter  && closeTs < rAfter)  return false;
        if (rBefore && closeTs > rBefore) return false;
        return true;
      });
    }

    // ── Ticket type filter ────────────────────────────────────────────────
    if (typeFilter) {
      filtered = filtered.filter(c => {
        const tags = (c.tags?.tags ?? []).map((t: any) => t.name);
        return tags.includes(typeFilter) || c.ticket_type?.name === typeFilter;
      });
    }

    // ── Merge hardcoded types with any found dynamically ──────────────────
    const dynamicTypes = new Set<string>();
    convs.forEach(c => {
      (c.tags?.tags ?? []).forEach((t: any) => { if (t.name) dynamicTypes.add(t.name); });
      if (c.ticket_type?.name) dynamicTypes.add(c.ticket_type.name);
    });
    const base    = TICKET_TYPES[section] ?? [];
    const extra   = [...dynamicTypes].filter(t => !base.includes(t)).sort();
    const ticketTypes = [...base, ...extra];

    // ── Metrics ───────────────────────────────────────────────────────────
    const resolved = filtered.filter(c => c.statistics?.first_close_at);
    const open     = filtered.filter(c => !c.statistics?.first_close_at);

    type Stat = { secs: number; officeHours: boolean; agentName: string; slaMet: boolean };
    const stats: Stat[] = resolved.map(c => {
      const secs =
        c.statistics.time_to_first_close ??
        (c.statistics.first_close_at - c.created_at);
      const agentName =
        !c.assignee || c.assignee.type === "nobody_admin"
          ? "Unassigned"
          : (c.assignee.name ?? "Unknown");
      return {
        secs,
        officeHours: isOfficeHours(c.created_at),
        agentName,
        slaMet: secs <= SLA_SECS,
      };
    });

    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const allSecs     = stats.map(s => s.secs);
    const officeSecs  = stats.filter(s =>  s.officeHours).map(s => s.secs);
    const outsideSecs = stats.filter(s => !s.officeHours).map(s => s.secs);
    const slaMet      = stats.filter(s =>  s.slaMet);
    const slaBreached = stats.filter(s => !s.slaMet);

    // By agent
    type Acc = { resolved: number; totalSecs: number; slaMet: number; slaBreached: number };
    const agentMap = new Map<string, Acc>();
    stats.forEach(({ agentName, secs, slaMet: met }) => {
      if (!agentMap.has(agentName))
        agentMap.set(agentName, { resolved: 0, totalSecs: 0, slaMet: 0, slaBreached: 0 });
      const a = agentMap.get(agentName)!;
      a.resolved++;
      a.totalSecs += secs;
      if (met) a.slaMet++; else a.slaBreached++;
    });

    const byAgent = [...agentMap.entries()]
      .map(([name, a]) => ({
        name,
        resolved:         a.resolved,
        avgResolutionFmt: fmt(a.totalSecs / a.resolved),
        slaMet:           a.slaMet,
        slaBreaches:      a.slaBreached,
        slaRate:          +((a.slaMet / a.resolved) * 100).toFixed(1),
      }))
      .sort((a, b) => b.resolved - a.resolved);

    return NextResponse.json({
      summary: {
        total:                  filtered.length,
        resolved:               resolved.length,
        open:                   open.length,
        slaMetCount:            slaMet.length,
        slaBreachCount:         slaBreached.length,
        slaComplianceRate:      resolved.length
                                  ? +((slaMet.length / resolved.length) * 100).toFixed(1)
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
