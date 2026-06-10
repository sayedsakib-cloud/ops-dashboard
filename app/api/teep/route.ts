import { NextResponse }     from "next/server";
import { getServerSession }  from "next-auth";
import { authOptions }       from "@/lib/auth";
import { unstable_cache }    from "next/cache";

const INTERCOM_API = "https://api.intercom.io";
const SLA_SECS     = 24 * 3600;

const TEEP_AGENT_NAMES = [
  "john ferguson", "camellia warren", "anna linhart",
  "nina sterling",  "eliana zahra",   "natalie carter",
  "liam wilson",    "joshua o'brian", "allison peiris",
  "grace morgan",   "rosie dunn",     "samael",
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
function normName(s: string): string {
  return (s ?? "").toLowerCase().replace(/&#39;/g, "'").replace(/\u2019/g, "'");
}
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

// ── Fetch all pages for ONE admin (parallel pagination) ────────────────────
// Cursor-based sequential pagination per agent.
// Page-number offset (pagination.page) is silently ignored by Intercom search —
// every call without a cursor returns page 1, capping results at 150.
// Each of the 12 agents runs this loop in parallel with the others.
async function fetchConvsForAdmin(
  token:   string,
  adminId: string,
  uAfter:  number,
  uBefore: number,
): Promise<any[]> {
  const HDRS = {
    Authorization:      `Bearer ${token}`,
    "Content-Type":     "application/json",
    "Intercom-Version": "2.11",
  };

  const query = {
    operator: "AND",
    value: [
      { field: "source.type",        operator: "=", value: "email"            },
      { field: "admin_assignee_id",   operator: "=", value: parseInt(adminId)  },
      { field: "updated_at",         operator: ">", value: uAfter             },
      { field: "updated_at",         operator: "<", value: uBefore            },
    ],
  };

  const all: any[] = [];
  const seen        = new Set<string>();
  let   cursor: string | null = null;

  for (let p = 0; p < 20; p++) {          // safety cap: 20 pages × 150 = 3,000 per agent
    const pagination: any = { per_page: 150 };
    if (cursor) pagination.starting_after = cursor;

    const res = await fetch(`${INTERCOM_API}/conversations/search`, {
      method: "POST", headers: HDRS,
      body: JSON.stringify({ query, pagination }),
      next: { revalidate: 300 },
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Intercom ${res.status}: ${t}`); }
    const data = await res.json();

    for (const c of (data.conversations ?? [])) {
      if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
    }

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
    const startDate = searchParams.get("startDate") ?? "";
    const endDate   = searchParams.get("endDate")   ?? "";

    const token = process.env.INTERCOM_ACCESS_TOKEN;
    if (!token) throw new Error("INTERCOM_ACCESS_TOKEN not set");

    const now     = Math.floor(Date.now() / 1000);
    const d7      = now - 7 * 86400;
    const uAfter  = startDate ? toUnixStart(startDate) : d7;
    const uBefore = endDate   ? toUnixEnd(endDate)     : now;
    const periodDays = Math.max(1, Math.round((uBefore - uAfter) / 86400));

    const [crTeams, { nameMap, admins }] = await Promise.all([
      getCRTeams(),
      getAdmins(),
    ]);

    if (!crTeams.length)
      return NextResponse.json({ error: "No CR teams found" }, { status: 404 });

    // Match TEEP agents from the workspace admin list
    const teepAdmins = admins.filter((a: any) =>
      TEEP_AGENT_NAMES.some(n =>
        normName(a.name).includes(normName(n)) ||
        normName(n).includes(normName(a.name))
      )
    );

    if (!teepAdmins.length)
      return NextResponse.json({ error: "No TEEP agents matched" }, { status: 404 });

    // ── Per-agent accumulator ─────────────────────────────────────────────
    type Acc = {
      name: string;
      assigned: number; repliedTo: number; repliesSent: number; closed: number;
      frtSum: number;      frtN:      number;
      handlingSum: number; handlingN: number;
      atfSum: number;      atfN:      number;
      slaMet: number;      slaTotal:  number;
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

    // ── Fetch conversations per agent IN PARALLEL ─────────────────────────
    // Each search is scoped to ONE admin — so we know exactly who each conv belongs to.
    // This avoids relying on c.assignee which is NOT returned by the search API.
    const agentResults = await Promise.all(
      teepAdmins.map(async (a: any) => ({
        adminId: String(a.id),
        convs:   await fetchConvsForAdmin(token, String(a.id), uAfter, uBefore),
      }))
    );

    // ── Process each agent's conversations ────────────────────────────────
    for (const { adminId, convs } of agentResults) {
      const acc = agentMap.get(adminId);
      if (!acc) continue;

      for (const c of convs) {
        const stats      = c.statistics ?? {};
        const adminReply = stats.time_to_admin_reply      ?? 0;
        const handling   = stats.time_to_first_close      ?? 0;
        const assignment = stats.time_to_assignment       ?? 0;
        const parts      = stats.count_conversation_parts ?? 0;

        acc.assigned++;

        if (adminReply > 0) {
          acc.repliedTo++;
          acc.repliesSent += Math.max(1, Math.floor(parts / 2));
          acc.slaTotal++;
          if (adminReply <= SLA_SECS) acc.slaMet++;

          // FRT = time_to_admin_reply: time from creation to first HUMAN reply
          // (first_response_time = FIN AI bot reply, near-instant, useless here)
          acc.frtSum += adminReply;
          acc.frtN++;

          // ATF = human reply time minus team-assignment time (best available proxy)
          const atf = adminReply - Math.max(0, assignment);
          if (atf > 0) { acc.atfSum += atf; acc.atfN++; }
        }

        if (c.state === "closed" || c.state === "resolved") acc.closed++;

        // Handling = first human reply → close  (removes queue-wait before agent picked up)
        // Matches Intercom's "Teammate handling time" more closely than time_to_first_close alone
        if (handling > 0 && adminReply > 0 && handling > adminReply) {
          acc.handlingSum += handling - adminReply;
          acc.handlingN++;
        } else if (handling > 0 && adminReply === 0) {
          // No reply recorded — fall back to full close time
          acc.handlingSum += handling;
          acc.handlingN++;
        }
      }
    }

    // ── Build rows — only agents with activity ────────────────────────────
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
        avgFrtFmt:      a.frtN > 0       ? fmt(a.frtSum / a.frtN)           : "--",
        avgHandlingFmt: a.handlingN > 0   ? fmt(a.handlingSum / a.handlingN) : "--",
        avgAtfFmt:      a.atfN > 0        ? fmt(a.atfSum / a.atfN)           : "--",
        repliedPerHour: activeHours > 0   ? (a.repliedTo / activeHours).toFixed(1) : "--",
        closedPerHour:  activeHours > 0   ? (a.closed    / activeHours).toFixed(1) : "--",
        slaMet:         a.slaMet,
        slaTotal:       a.slaTotal,
        slaRate:        a.slaTotal > 0 ? +((a.slaMet / a.slaTotal) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.closed - a.closed);

    // ── Summary row ───────────────────────────────────────────────────────
    const totalAssigned    = rows.reduce((s, r) => s + r.assigned,    0);
    const totalRepliedTo   = rows.reduce((s, r) => s + r.repliedTo,   0);
    const totalRepliesSent = rows.reduce((s, r) => s + r.repliesSent, 0);
    const totalClosed      = rows.reduce((s, r) => s + r.closed,      0);
    const totalSlaMet      = rows.reduce((s, r) => s + r.slaMet,      0);
    const totalSlaTotal    = rows.reduce((s, r) => s + r.slaTotal,    0);

    let wFrtSum = 0, wFrtN = 0, wHandlingSum = 0, wHandlingN = 0, wAtfSum = 0, wAtfN = 0;
    for (const a of agentMap.values()) {
      wFrtSum      += a.frtSum;      wFrtN      += a.frtN;
      wHandlingSum += a.handlingSum; wHandlingN += a.handlingN;
      wAtfSum      += a.atfSum;      wAtfN      += a.atfN;
    }

    const summaryRow: AgentRow = {
      name:           "Summary",
      assigned:       totalAssigned,
      repliedTo:      totalRepliedTo,
      repliesSent:    totalRepliesSent,
      closed:         totalClosed,
      avgFrtFmt:      wFrtN > 0      ? fmt(wFrtSum / wFrtN)           : "--",
      avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
      avgAtfFmt:      wAtfN > 0 ? fmt(wAtfSum / wAtfN) : "--",
      repliedPerHour: activeHours > 0 ? (totalRepliedTo / activeHours).toFixed(1) : "--",
      closedPerHour:  activeHours > 0 ? (totalClosed    / activeHours).toFixed(1) : "--",
      slaMet:         totalSlaMet,
      slaTotal:       totalSlaTotal,
      slaRate:        totalSlaTotal > 0 ? +((totalSlaMet / totalSlaTotal) * 100).toFixed(1) : 0,
    };

    const top3 = rows.slice(0, 3).map(r => ({ name: r.name, closed: r.closed }));

    return NextResponse.json({
      return NextResponse.json({
      summary: {
        totalClosed,
        avgFrtFmt:      wFrtN > 0      ? fmt(wFrtSum / wFrtN)           : "--",
        avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
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
