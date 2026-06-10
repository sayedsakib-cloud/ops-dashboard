import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { unstable_cache }   from "next/cache";

const INTERCOM_API = "https://api.intercom.io";
const SLA_SECS     = 24 * 3600;

// Base agent list — new agents in CR teams are auto-discovered
const TEEP_AGENT_NAMES = [
  "john ferguson", "camellia warren", "anna linhart",
  "nina sterling", "eliana zahra", "natalie carter",
  "liam wilson",   "joshua o'brian", "allison peiris",
  "grace morgan",  "rosie dunn", "samael",
];

// ── Helpers ────────────────────────────────────────────────────────────────
function toUnixStart(d: string) {
  return Math.floor(new Date(d + "T00:00:00+06:00").getTime() / 1000);
}
function toUnixEnd(d: string) {
  return Math.floor(new Date(d + "T23:59:59+06:00").getTime() / 1000);
}
function fmt(secs: number): string {
  if (!secs || secs <= 0) return "--";
  const m = Math.round(secs / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24)  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

/** Normalize names for comparison — lowercase + decode HTML apostrophe */
function normName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&#39;/g, "'")   // Intercom HTML-encodes apostrophes
    .replace(/\u2019/g, "'"); // curly apostrophe
}

/** Decode HTML entities in display names (Intercom stores "O&#39;Brian") */
function decodeName(s: string): string {
  return (s ?? "").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// ── Cached: CR teams (1-hour TTL) ─────────────────────────────────────────
const getCRTeams = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const res   = await fetch(`${INTERCOM_API}/teams`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    return (data.teams ?? [])
      .filter((t: any) => (t.name ?? "").startsWith("CR"))
      .map((t: any) => ({ id: String(t.id), name: t.name }));
  },
  ["intercom-cr-teams"],
  { revalidate: 3600 }
);

// ── Cached: admins (1-hour TTL) ───────────────────────────────────────────
const getAdmins = unstable_cache(
  async (): Promise<{ nameMap: Record<string, string>; admins: any[] }> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const res   = await fetch(`${INTERCOM_API}/admins`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
      next: { revalidate: 3600 },
    });
    const data  = await res.json();
    const list  = (data.admins ?? []) as any[];
    const nameMap: Record<string, string> = {};
    list.forEach((a: any) => { nameMap[String(a.id)] = a.name ?? a.email ?? `Admin ${a.id}`; });
    return { nameMap, admins: list };
  },
  ["intercom-admins-teep"],
  { revalidate: 3600 }
);

// ── Conversations fetch with parallel pagination ───────────────────────────
async function fetchConversations(
  token:         string,
  teepAdminIds:  string[],
  cAfter:        number,
  cBefore:       number,
): Promise<any[]> {
  if (!teepAdminIds.length) return [];

  // Search by individual admin IDs — team-queue conversations have null assignee
  // so searching by team would return 0 agent-attributed conversations
  const adminClauses = teepAdminIds.map(id => ({
    field: "admin_assignee_id", operator: "=", value: parseInt(id),
  }));

  const query = {
    operator: "AND",
    value: [
      { field: "source.type", operator: "=", value: "email" },
      adminClauses.length > 1 ? { operator: "OR", value: adminClauses } : adminClauses[0],
      { field: "created_at", operator: ">", value: cAfter  },
      { field: "created_at", operator: "<", value: cBefore },
    ],
  };

  const HDRS = {
    Authorization:      `Bearer ${token}`,
    "Content-Type":     "application/json",
    "Intercom-Version": "2.11",
  };

  async function fetchPage(pageNum: number): Promise<any> {
    const pagination: any = { per_page: 150 };
    if (pageNum > 1) pagination.page = pageNum;
    const res = await fetch(`${INTERCOM_API}/conversations/search`, {
      method: "POST", headers: HDRS,
      body: JSON.stringify({ query, pagination }),
      next: { revalidate: 300 },
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Intercom ${res.status}: ${t}`); }
    return res.json();
  }

  const page1      = await fetchPage(1);
  const totalPages = Math.min(page1.pages?.total_pages ?? 1, 15);
  const restData   = totalPages > 1
    ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2)))
    : [];

  const all: any[] = [];
  const seen = new Set<string>();
  for (const c of [
    ...(page1.conversations ?? []),
    ...restData.flatMap((d: any) => d.conversations ?? []),
  ]) {
    if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
  }
  return all;
}

// ── Route ──────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") ?? "";
    const endDate   = searchParams.get("endDate")   ?? "";

    const token = process.env.INTERCOM_ACCESS_TOKEN;
    if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not set");

    const now     = Math.floor(Date.now() / 1000);
    const d7      = now - 7 * 86400;
    const cAfter  = startDate ? toUnixStart(startDate) : d7;
    const cBefore = endDate   ? toUnixEnd(endDate)     : now;
    const periodDays = Math.max(1, Math.round((cBefore - cAfter) / 86400));

    const [crTeams, { nameMap, admins }] = await Promise.all([
      getCRTeams(),
      getAdmins(),
    ]);

    if (!crTeams.length)
      return NextResponse.json({ error: "No CR teams found in workspace" }, { status: 404 });

    // Resolve TEEP admin IDs before fetching conversations
    const teepAdmins = admins.filter((a: any) =>
      TEEP_AGENT_NAMES.some(n =>
        normName(a.name).includes(normName(n)) ||
        normName(n).includes(normName(a.name))
      )
    );
    const teepAdminIds = teepAdmins.map((a: any) => String(a.id));

    if (!teepAdminIds.length)
      return NextResponse.json({ error: "No TEEP agents matched in workspace" }, { status: 404 });

    const convs = await fetchConversations(token, teepAdminIds, cAfter, cBefore);

    // ── Per-agent accumulator ─────────────────────────────────────────────

    type Acc = {
      name: string;
      assigned: number; repliedTo: number; repliesSent: number; closed: number;
      frtSum: number;      frtN:      number;
      handlingSum: number; handlingN: number;
      atfSum: number;      atfN:      number;
      slaMet: number; slaTotal: number;
    };

    function emptyAcc(name: string): Acc {
      return {
        name, assigned: 0, repliedTo: 0, repliesSent: 0, closed: 0,
        frtSum: 0, frtN: 0, handlingSum: 0, handlingN: 0,
        atfSum: 0, atfN: 0, slaMet: 0, slaTotal: 0,
      };
    }

    const agentMap = new Map<string, Acc>();

    // Pre-populate all matched TEEP agents
    teepAdmins.forEach((a: any) => {
      const id = String(a.id);
      if (!agentMap.has(id)) agentMap.set(id, emptyAcc(decodeName(a.name ?? id)));
    });

    // Process every conversation
    for (const c of convs) {
      // Only process conversations assigned to a human admin (not a team or unassigned)
      if (c.assignee?.type !== "admin" || !c.assignee?.id) continue;
      const adminId = String(c.assignee.id);

      if (!agentMap.has(adminId)) {
        // Auto-discover new agents in CR teams not in the base TEEP list
        agentMap.set(adminId, emptyAcc(decodeName(nameMap[adminId] ?? c.assignee?.name ?? `Admin ${adminId}`)));
      }

      const a     = agentMap.get(adminId)!;
      const stats = c.statistics ?? {};
      const frt         = stats.first_response_time   ?? 0;
      const adminReply  = stats.time_to_admin_reply   ?? 0;
      const handling    = stats.time_to_first_close   ?? 0;
      const assignment  = stats.time_to_assignment    ?? 0;
      const parts       = stats.count_conversation_parts ?? 0;

      a.assigned++;

      if (adminReply > 0) {
        a.repliedTo++;
        a.repliesSent += Math.max(1, Math.floor(parts / 2));
        a.slaTotal++;
        if (adminReply <= SLA_SECS) a.slaMet++;
        a.atfSum += Math.max(0, adminReply - assignment);
        a.atfN++;
      }

      if (c.state === "closed" || c.state === "resolved") a.closed++;

      if (frt > 0)      { a.frtSum      += frt;      a.frtN++; }
      if (handling > 0) { a.handlingSum += handling; a.handlingN++; }
    }

    // ── Build agent rows ──────────────────────────────────────────────────
    const activeHours = periodDays * 8;

    type AgentRow = {
      name: string;
      assigned: number; repliedTo: number; repliesSent: number; closed: number;
      avgFrtFmt: string; avgHandlingFmt: string; avgAtfFmt: string;
      repliedPerHour: string; closedPerHour: string;
      slaMet: number; slaTotal: number; slaRate: number;
    };

    const rows: AgentRow[] = [...agentMap.values()]
      .filter(a => a.assigned > 0 || a.repliedTo > 0 || a.closed > 0)
      .map(a => ({
        name:           a.name,
        assigned:       a.assigned,
        repliedTo:      a.repliedTo,
        repliesSent:    a.repliesSent,
        closed:         a.closed,
        avgFrtFmt:      a.frtN > 0      ? fmt(a.frtSum / a.frtN)           : "--",
        avgHandlingFmt: a.handlingN > 0  ? fmt(a.handlingSum / a.handlingN) : "--",
        avgAtfFmt:      a.atfN > 0       ? fmt(a.atfSum / a.atfN)           : "--",
        repliedPerHour: activeHours > 0  ? (a.repliedTo / activeHours).toFixed(1) : "--",
        closedPerHour:  activeHours > 0  ? (a.closed    / activeHours).toFixed(1) : "--",
        slaMet:         a.slaMet,
        slaTotal:       a.slaTotal,
        slaRate:        a.slaTotal > 0 ? +((a.slaMet / a.slaTotal) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.closed - a.closed);

    // ── Summary row (totals / weighted averages) ──────────────────────────
    const totalAssigned    = rows.reduce((s, r) => s + r.assigned, 0);
    const totalRepliedTo   = rows.reduce((s, r) => s + r.repliedTo, 0);
    const totalRepliesSent = rows.reduce((s, r) => s + r.repliesSent, 0);
    const totalClosed      = rows.reduce((s, r) => s + r.closed, 0);
    const totalSlaMet      = rows.reduce((s, r) => s + r.slaMet, 0);
    const totalSlaTotal    = rows.reduce((s, r) => s + r.slaTotal, 0);

    // Weighted avg FRT and handling
    let wFrtSum = 0, wFrtN = 0, wHandlingSum = 0, wHandlingN = 0;
    for (const a of agentMap.values()) {
      wFrtSum      += a.frtSum;      wFrtN      += a.frtN;
      wHandlingSum += a.handlingSum; wHandlingN += a.handlingN;
    }

    const summaryRow: AgentRow = {
      name:           "Summary",
      assigned:       totalAssigned,
      repliedTo:      totalRepliedTo,
      repliesSent:    totalRepliesSent,
      closed:         totalClosed,
      avgFrtFmt:      wFrtN > 0      ? fmt(wFrtSum / wFrtN)           : "--",
      avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
      avgAtfFmt:      "--",
      repliedPerHour: activeHours > 0 ? (totalRepliedTo / activeHours).toFixed(1) : "--",
      closedPerHour:  activeHours > 0 ? (totalClosed    / activeHours).toFixed(1) : "--",
      slaMet:         totalSlaMet,
      slaTotal:       totalSlaTotal,
      slaRate:        totalSlaTotal > 0 ? +((totalSlaMet / totalSlaTotal) * 100).toFixed(1) : 0,
    };

    const top3 = rows.slice(0, 3).map(r => ({ name: r.name, closed: r.closed }));

    return NextResponse.json({
      summary: {
        totalClosed,
        avgHandlingFmt:  wHandlingN > 0 ? fmt(wHandlingSum / wHandlingN) : "--",
        slaRate:         summaryRow.slaRate,
        slaMetCount:     totalSlaMet,
        slaTotalCount:   totalSlaTotal,
        top3,
      },
      periodDays,
      summaryRow,
      agents: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
