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

// ── teammates field: { "type":"admin.list", "admins": [{id:"123"}, ...] } ──
function parseTeammates(c: any): string[] {
  const raw = c.teammates;
  if (!raw) return [];
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.admins)    ? raw.admins      // confirmed structure
    : Array.isArray(raw.teammates) ? raw.teammates    // fallback
    : [];
  return list.map((m: any) => String(m.id ?? m)).filter(Boolean);
}

// Primary: admin_assignee_id. Fallback: teammates (unassigned workflow).
function resolveAgent(c: any, teepSet: Set<string>, mode: "single"|"all"): string[] {
  if (c.admin_assignee_id && teepSet.has(String(c.admin_assignee_id))) {
    return [String(c.admin_assignee_id)];
  }
  const teepMates = parseTeammates(c).filter(id => teepSet.has(id));
  if (mode === "single") return teepMates.length > 0 ? [teepMates[0]] : [];
  return teepMates;
}

// ── Cached: CR teams ──────────────────────────────────────────────────────
const getCRTeams = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const res   = await fetch(`${INTERCOM_API}/teams`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    return (data.teams ?? [])
      .filter((t: any) =>
        (t.name ?? "").startsWith("CR") && t.name !== "CR - Ticket Dependencies"
      )
      .map((t: any) => ({ id: String(t.id), name: t.name }));
  },
  ["intercom-cr-teams-v3"],
  { revalidate: 3600 }
);

// ── Cached: admins ────────────────────────────────────────────────────────
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

// ── Cursor-paginated team search ──────────────────────────────────────────
async function fetchConvsForTeamByField(
  token: string, teamId: string, dateField: string,
  after: number, before: number,
): Promise<any[]> {
  const HDRS = {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    "Intercom-Version": "2.11",
  };
  const query = {
    operator: "AND",
    value: [
      { field: "source.type",      operator: "=", value: "email"          },
      { field: "team_assignee_id", operator: "=", value: parseInt(teamId) },
      { field: dateField,          operator: ">", value: after            },
      { field: dateField,          operator: "<", value: before           },
    ],
  };
  const all: any[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let p = 0; p < 20; p++) {
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

// ── Fetch conversation parts to find close events ─────────────────────────
// Used for: (a) unattributed closes (null assignee, not in teammates)
//           (b) conversations with count_reopens > 0 to catch re-close events
async function fetchCloseParts(
  token: string, convId: string, uAfter: number, uBefore: number,
): Promise<Array<{ adminId: string; closedAt: number }>> {
  const res = await fetch(`${INTERCOM_API}/conversations/${convId}`, {
    headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const data  = await res.json();
  const parts = data.conversation_parts?.conversation_parts ?? [];
  const events: Array<{ adminId: string; closedAt: number }> = [];
  for (const part of parts) {
    if (
      part.part_type === "close" &&
      part.author?.type === "admin" &&
      part.created_at >= uAfter &&
      part.created_at <= uBefore
    ) {
      events.push({ adminId: String(part.author.id), closedAt: part.created_at });
    }
  }
  return events;
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

    // Count Mon-Fri days only in the selected range
    let workingDays = 0;
    const _wdCur = new Date(uAfter * 1000);
    const _wdEnd = new Date(uBefore * 1000);
    _wdCur.setHours(0, 0, 0, 0);
    _wdEnd.setHours(23, 59, 59, 999);
    while (_wdCur <= _wdEnd) {
      const _d = _wdCur.getDay();
      if (_d !== 0 && _d !== 6) workingDays++;
      _wdCur.setDate(_wdCur.getDate() + 1);
    }
    workingDays = Math.max(1, workingDays);

    const [crTeams, { admins }] = await Promise.all([getCRTeams(), getAdmins()]);

    if (!crTeams.length)
      return NextResponse.json({ error: "No CR teams found" }, { status: 404 });

    const teepAdmins = admins.filter((a: any) =>
      TEEP_AGENT_NAMES.some(n =>
        normName(a.name).includes(normName(n)) || normName(n).includes(normName(a.name))
      )
    );
    const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));

    if (!teepAdmins.length)
      return NextResponse.json({ error: "No TEEP agents matched" }, { status: 404 });

    // ── Two parallel searches per team ─────────────────────────────────────
    const teamResults = await Promise.all(
      crTeams.map(async (t) => {
        const [ac, cc] = await Promise.all([
          fetchConvsForTeamByField(token, t.id, "updated_at",               uAfter, uBefore),
          fetchConvsForTeamByField(token, t.id, "statistics.last_close_at", uAfter, uBefore),
        ]);
        return { ac, cc };
      })
    );

    // Merge: activity set + closed-only extras
    const activityConvs: any[] = [];
    const activityIds           = new Set<string>();
    const closedOnlyConvs: any[]  = [];
    const closedOnlySeen          = new Set<string>();

    for (const { ac, cc } of teamResults) {
      for (const c of ac) {
        if (!activityIds.has(c.id)) { activityIds.add(c.id); activityConvs.push(c); }
      }
      for (const c of cc) {
        if (!activityIds.has(c.id) && !closedOnlySeen.has(c.id)) {
          closedOnlySeen.add(c.id);
          closedOnlyConvs.push(c);
        }
      }
    }

    // ── Per-agent accumulator ─────────────────────────────────────────────
    type Acc = {
      name: string;
      assigned: number; repliedTo: number; repliesSent: number; closed: number;
      frtSum: number; frtN: number; handlingSum: number; handlingN: number;
      atfSum: number; atfN: number; slaMet: number; slaTotal: number;
    };
    function emptyAcc(name: string): Acc {
      return { name, assigned:0,repliedTo:0,repliesSent:0,closed:0,
               frtSum:0,frtN:0,handlingSum:0,handlingN:0,atfSum:0,atfN:0,slaMet:0,slaTotal:0 };
    }
    const agentMap = new Map<string, Acc>();
    teepAdmins.forEach((a: any) =>
      agentMap.set(String(a.id), emptyAcc(decodeName(a.name ?? String(a.id))))
    );

    // Track which conversation IDs we've counted a close for (for de-dup in basic pass)
    const closeCounted = new Set<string>();
    // Track conversations that need parts (unattributed OR had reopens)
    const needsParts   = new Set<string>();

    // ── Pass 1: activity conversations — full metrics ─────────────────────
    for (const c of activityConvs) {
      const stats       = c.statistics ?? {};
      const adminReply  = stats.time_to_admin_reply      ?? 0;
      const handling    = stats.time_to_first_close      ?? 0;
      const assignment  = stats.time_to_assignment       ?? 0;
      const parts       = stats.count_conversation_parts ?? 0;
      const lastCloseAt = stats.last_close_at ?? 0;

      // Assigned (formal assignment only)
      if (c.admin_assignee_id && teepAdminIdSet.has(String(c.admin_assignee_id))) {
        agentMap.get(String(c.admin_assignee_id))!.assigned++;
      }

      // Replied To — all TEEP agents who participated
      // Replied To — count for ALL TEEP agents who participated
      const replierIds  = resolveAgent(c, teepAdminIdSet, "all");
      // Timing — attributed to ONE primary agent only (avoids diluting averages
      // across multiple teammates who shared the same conversation statistics)
      const primaryId   = resolveAgent(c, teepAdminIdSet, "single")[0] ?? null;

      for (const rid of replierIds) {
        const acc = agentMap.get(rid)!;
        if (adminReply > 0) {
          acc.repliedTo++;
          acc.repliesSent += Math.max(1, Math.floor(parts / (replierIds.length || 1) / 2));
          acc.slaTotal++;
          if (adminReply <= SLA_SECS) acc.slaMet++;
        }
      }

      // Timing metrics: primary agent only
      if (primaryId && agentMap.has(primaryId)) {
        const acc = agentMap.get(primaryId)!;
        if (adminReply > 0) {
          acc.frtSum += adminReply; acc.frtN++;
          const atf = adminReply - Math.max(0, assignment);
          if (atf > 0) { acc.atfSum += atf; acc.atfN++; }
        }
        if (handling > 0 && adminReply > 0 && handling > adminReply) {
          acc.handlingSum += handling - adminReply; acc.handlingN++;
        } else if (handling > 0 && adminReply === 0) {
          acc.handlingSum += handling; acc.handlingN++;
        }
      }

      // Closed count
      const closedInPeriod = lastCloseAt > 0
        ? (lastCloseAt >= uAfter && lastCloseAt <= uBefore)
        : (c.state === "closed" || c.state === "resolved");

      if (closedInPeriod) {
        const closerIds = resolveAgent(c, teepAdminIdSet, "single");
        if (closerIds.length > 0) {
          agentMap.get(closerIds[0])!.closed++;
          closeCounted.add(c.id);
          // If conversation was reopened, fetch parts to count re-close events
          //if (countReopens > 0) needsParts.add(c.id);
        } else {
          // Unattributed — fetch parts to find who closed it
          needsParts.add(c.id);
        }
      }
    }

    // ── Pass 2: closed-only (closed in period, now reopened) ──────────────
    for (const c of closedOnlyConvs) {
      const stats     = c.statistics ?? {};
      const closerIds = resolveAgent(c, teepAdminIdSet, "single");
      if (closerIds.length > 0) {
        agentMap.get(closerIds[0])!.closed++;
        closeCounted.add(c.id);
      } else {
        needsParts.add(c.id);
      }
    }

    // ── Pass 3: batch-fetch parts for unattributed + re-close events ──────
    // This is the key to reaching Intercom's count:
    //   (a) Unattributed: agent closed without being assigned AND without replying
    //   (b) Re-close: conversation closed N times in period → Intercom counts N
    if (needsParts.size > 0) {
      const ids     = [...needsParts];
      const BATCH   = 30;            // 30 concurrent part fetches
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch   = ids.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(id => fetchCloseParts(token, id, uAfter, uBefore))
        );

        for (const events of results) {
          // Count the FIRST close by a TEEP agent in the period (unique conversation = count once)
          const firstTeepClose = events.find((e: any) => teepAdminIdSet.has(e.adminId));
          if (firstTeepClose) {
            agentMap.get(firstTeepClose.adminId)!.closed++;
          }
        }
      }
    }

    // ── Build rows ────────────────────────────────────────────────────────
    type AgentRow = {
      name: string; assigned: number; repliedTo: number; repliesSent: number; closed: number;
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
        repliedPerHour: workingDays > 0  ? (a.repliedTo / workingDays).toFixed(1) : "--",
        closedPerHour:  workingDays > 0  ? (a.closed    / workingDays).toFixed(1) : "--",
        slaMet:         a.slaMet,
        slaTotal:       a.slaTotal,
        slaRate:        a.slaTotal > 0 ? +((a.slaMet / a.slaTotal) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.closed - a.closed);

    // ── Summary ───────────────────────────────────────────────────────────
    const totalAssigned    = rows.reduce((s, r) => s + r.assigned,    0);
    const totalRepliedTo   = rows.reduce((s, r) => s + r.repliedTo,   0);
    const totalRepliesSent = rows.reduce((s, r) => s + r.repliesSent, 0);
    const totalClosed      = rows.reduce((s, r) => s + r.closed,      0);
    const totalSlaMet      = rows.reduce((s, r) => s + r.slaMet,      0);
    const totalSlaTotal    = rows.reduce((s, r) => s + r.slaTotal,    0);

    let wFrtSum = 0, wFrtN = 0, wHandlingSum = 0, wHandlingN = 0, wAtfSum = 0, wAtfN = 0;
    for (const a of agentMap.values()) {
      wFrtSum += a.frtSum; wFrtN += a.frtN;
      wHandlingSum += a.handlingSum; wHandlingN += a.handlingN;
      wAtfSum += a.atfSum; wAtfN += a.atfN;
    }

    const summaryRow: AgentRow = {
      name:           "Summary",
      assigned:       totalAssigned,
      repliedTo:      totalRepliedTo,
      repliesSent:    totalRepliesSent,
      closed:         totalClosed,
      avgFrtFmt:      wFrtN > 0      ? fmt(wFrtSum / wFrtN)           : "--",
      avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
      avgAtfFmt:      wAtfN > 0       ? fmt(wAtfSum / wAtfN)           : "--",
      repliedPerHour: workingDays > 0 ? (totalRepliedTo / workingDays).toFixed(1) : "--",
      closedPerHour:  workingDays > 0 ? (totalClosed    / workingDays).toFixed(1) : "--",
      slaMet:         totalSlaMet,
      slaTotal:       totalSlaTotal,
      slaRate:        totalSlaTotal > 0 ? +((totalSlaMet / totalSlaTotal) * 100).toFixed(1) : 0,
    };

    return NextResponse.json({
      summary: {
        totalClosed,
        avgFrtFmt:     wFrtN > 0      ? fmt(wFrtSum / wFrtN)           : "--",
        avgHandlingFmt: wHandlingN > 0 ? fmt(wHandlingSum / wHandlingN) : "--",
        slaRate:        summaryRow.slaRate,
        slaMetCount:    totalSlaMet,
        slaTotalCount:  totalSlaTotal,
        top3:           rows.slice(0, 3).map(r => ({ name: r.name, closed: r.closed })),
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
