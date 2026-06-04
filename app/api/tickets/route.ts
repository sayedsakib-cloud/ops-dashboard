import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const INTERCOM_API = "https://api.intercom.io";
const INBOX: Record<string, string> = {
  cr:     "6547584",
  bizops: "8314220",
};
const SLA_SECS = 24 * 3600;

// ── Date helpers ───────────────────────────────────────────────────────────
function toUnixStart(d: string) { return Math.floor(new Date(d + "T00:00:00+06:00").getTime() / 1000); }
function toUnixEnd(d: string)   { return Math.floor(new Date(d + "T23:59:59+06:00").getTime() / 1000); }

/** Is this Unix timestamp within 9:00 AM – 5:00 PM GMT+6? */
function isOfficeHours(ts: number): boolean {
  const d     = new Date(ts * 1000);
  const gmt6h = (d.getUTCHours() + 6) % 24;
  const mins  = gmt6h * 60 + d.getUTCMinutes();
  return mins >= 540 && mins < 1020; // 9*60=540, 17*60=1020
}

/** Format seconds → human-readable (e.g. "4h 23m", "1d 2h") */
function fmt(secs: number): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.round(secs / 60);
  if (m < 60)   return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24)   return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

// ── Intercom search with pagination ───────────────────────────────────────
async function fetchConversations(
  inboxId: string,
  cAfter?: number, cBefore?: number,
  rAfter?: number, rBefore?: number,
): Promise<any[]> {
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) throw new Error("INTERCOM_ACCESS_TOKEN env var not set");

  const filters: any[] = [
    { field: "team_assignee_id", operator: "=", value: inboxId },
  ];
  if (cAfter)  filters.push({ field: "created_at",                operator: ">", value: cAfter  });
  if (cBefore) filters.push({ field: "created_at",                operator: "<", value: cBefore });
  if (rAfter)  filters.push({ field: "statistics.first_close_at", operator: ">", value: rAfter  });
  if (rBefore) filters.push({ field: "statistics.first_close_at", operator: "<", value: rBefore });

  const all: any[] = [];
  let cursor: string | null = null;

  for (let p = 0; p < 10; p++) {          // safety: max 1,500 conversations
    const body: any = {
      query: { operator: "AND", value: filters },
      pagination: { per_page: 150 },
    };
    if (cursor) body.pagination.starting_after = cursor;

    const res  = await fetch(`${INTERCOM_API}/conversations/search`, {
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

// ── Route handler ──────────────────────────────────────────────────────────
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

    const now   = Math.floor(Date.now() / 1000);
    const d30   = now - 30 * 86400;
    const cAfter  = createdFrom  ? toUnixStart(createdFrom)  : d30;
    const cBefore = createdTo    ? toUnixEnd(createdTo)      : now;
    const rAfter  = resolvedFrom ? toUnixStart(resolvedFrom) : undefined;
    const rBefore = resolvedTo   ? toUnixEnd(resolvedTo)     : undefined;

    const inboxId = INBOX[section] ?? INBOX.cr;
    const convs   = await fetchConversations(inboxId, cAfter, cBefore, rAfter, rBefore);

    // ── Extract ticket types from tags + ticket_type field ──
    const typeSet = new Set<string>();
    convs.forEach(c => {
      (c.tags?.tags ?? []).forEach((t: any) => { if (t.name) typeSet.add(t.name); });
      if (c.ticket_type?.name) typeSet.add(c.ticket_type.name);
    });
    const ticketTypes = [...typeSet].sort();

    // ── Apply type filter ──
    const filtered = typeFilter
      ? convs.filter(c => {
          const tags = (c.tags?.tags ?? []).map((t: any) => t.name);
          return tags.includes(typeFilter) || c.ticket_type?.name === typeFilter;
        })
      : convs;

    // ── Resolved vs open ──
    const resolved = filtered.filter(c => c.statistics?.first_close_at);
    const open     = filtered.filter(c => !c.statistics?.first_close_at);

    // ── Resolution stats per ticket ──
    type Stat = {
      secs: number; officeHours: boolean;
      agentName: string; slaMet: boolean;
    };
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

    // ── By agent ──
    type AgentAcc = { resolved: number; totalSecs: number; slaMet: number; slaBreached: number };
    const agentMap = new Map<string, AgentAcc>();
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
        resolved:          a.resolved,
        avgResolutionFmt:  fmt(a.totalSecs / a.resolved),
        avgResolutionSecs: Math.round(a.totalSecs / a.resolved),
        slaMet:            a.slaMet,
        slaBreaches:       a.slaBreached,
        slaRate:           +((a.slaMet / a.resolved) * 100).toFixed(1),
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
