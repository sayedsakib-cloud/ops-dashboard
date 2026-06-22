import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { unstable_cache }   from "next/cache";
import {
  readTeepCache, writeTeepCache,
  readTeepBase,  writeTeepBase,
  readTeepConvs, writeTeepConvs,
  readTeepDays,  writeTeepDay,
  supabaseEnvPresent, supabaseHealthcheck, supabaseRoundtrip,
} from "@/lib/supabase";

const INTERCOM_API  = "https://api.intercom.io";
const SLA_SECS      = 24 * 3600;

// Hobby-plan max. The full-range search + a budgeted slice of parts fit here;
// remaining parts finish on subsequent (auto-fill) requests.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
function parseTeammates(c: any): string[] {
  const raw = c.teammates;
  if (!raw) return [];
  const list: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.admins)    ? raw.admins
    : Array.isArray(raw.teammates) ? raw.teammates
    : [];
  return list.map((m: any) => String(m.id ?? m)).filter(Boolean);
}
function resolveAgent(c: any, teepSet: Set<string>, mode: "single"|"all"): string[] {
  if (c.admin_assignee_id && teepSet.has(String(c.admin_assignee_id))) {
    return [String(c.admin_assignee_id)];
  }
  const teepMates = parseTeammates(c).filter(id => teepSet.has(id));
  if (mode === "single") return teepMates.length > 0 ? [teepMates[0]] : [];
  return teepMates;
}
function countWorkdays(afterSecs: number, beforeSecs: number): number {
  let count = 0;
  const cur = new Date(afterSecs * 1000);
  const end = new Date(beforeSecs * 1000);
  cur.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

// ── Cached: CR teams (1h) ─────────────────────────────────────────────────
const getCRTeams = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const res   = await fetch(`${INTERCOM_API}/teams`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
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

// ── Cached: admins (1h) ───────────────────────────────────────────────────
const getAdmins = unstable_cache(
  async (): Promise<{ nameMap: Record<string, string>; admins: any[] }> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const res   = await fetch(`${INTERCOM_API}/admins`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
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

// TEEP-matched admins (used in several places).
async function getTeepAdmins(): Promise<any[]> {
  const { admins } = await getAdmins();
  const matched = admins.filter((a: any) =>
    TEEP_AGENT_NAMES.some(n =>
      normName(a.name).includes(normName(n)) || normName(n).includes(normName(a.name))
    )
  );
  if (!matched.length) throw new Error("No TEEP agents matched");
  return matched;
}

// ── OR-batched multi-team conversation search ─────────────────────────────
async function fetchConvsAllTeams(
  token: string,
  teamIds: string[],
  dateField: string,
  uAfter: number,
  uBefore: number,
): Promise<any[]> {
  const HDRS = {
    Authorization:      `Bearer ${token}`,
    "Content-Type":     "application/json",
    "Intercom-Version": "2.11",
  };
  const BATCH_SIZE = 5;     // teams per OR clause
  const PAGE_CAP   = 1000;  // runaway safety; real stop is cursor === null

  const batches: string[][] = [];
  for (let i = 0; i < teamIds.length; i += BATCH_SIZE) {
    batches.push(teamIds.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map(async (bTeams) => {
      const all: any[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;

      for (let p = 0; p < PAGE_CAP; p++) {
        const query = {
          operator: "AND",
          value: [
            { field: "source.type", operator: "=", value: "email" },
            {
              operator: "OR",
              value: bTeams.map(id => ({
                field: "team_assignee_id", operator: "=", value: parseInt(id),
              })),
            },
            { field: dateField, operator: ">", value: uAfter  },
            { field: dateField, operator: "<", value: uBefore },
          ],
        };
        const pagination: any = { per_page: 150 };
        if (cursor) pagination.starting_after = cursor;

        const res = await fetch(`${INTERCOM_API}/conversations/search`, {
          method:  "POST",
          headers: HDRS,
          body:    JSON.stringify({ query, pagination }),
          next:    { revalidate: 300 },
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Intercom ${res.status}: ${t}`);
        }
        const data = await res.json();
        for (const c of (data.conversations ?? [])) {
          if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
        }
        cursor = data.pages?.next?.starting_after ?? null;
        if (!cursor) break;
      }
      return all;
    })
  );

  const merged: any[] = [];
  const seen = new Set<string>();
  for (const batch of batchResults) {
    for (const c of batch) {
      if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
    }
  }
  return merged;
}

// ── ALL admin close events for one conversation (no window filter) ─────────
// Cached per conversation in Supabase; window filtering happens at aggregation.
type CloseEvent = { adminId: string; closedAt: number };
async function fetchAllCloseEvents(token: string, convId: string): Promise<CloseEvent[]> {
  const res = await fetch(`${INTERCOM_API}/conversations/${convId}`, {
    headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const data  = await res.json();
  const parts = data.conversation_parts?.conversation_parts ?? [];
  const events: CloseEvent[] = [];
  for (const part of parts) {
    if (part.part_type === "close" && part.author?.type === "admin") {
      events.push({ adminId: String(part.author.id), closedAt: part.created_at });
    }
  }
  return events; // chronological, as Intercom returns them
}

// ── Per-agent accumulator ─────────────────────────────────────────────────
type RawAcc = {
  name: string;
  assigned: number; repliedTo: number; closed: number;
  frtSum: number; frtN: number; handlingSum: number; handlingN: number;
  atfSum: number; atfN: number; slaMet: number; slaTotal: number;
};
type RawPayload = Record<string, RawAcc>;

function emptyRaw(name: string): RawAcc {
  return { name, assigned:0, repliedTo:0, closed:0,
           frtSum:0, frtN:0, handlingSum:0, handlingN:0,
           atfSum:0, atfN:0, slaMet:0, slaTotal:0 };
}

// ── Base state: search + Pass 1/2 over the FULL range (no parts) ───────────
// `agents` already includes attributed (parts-free) closes. `needsParts` are
// the conversations whose close attribution requires a parts fetch (Pass 3).
type BaseState = { agents: RawPayload; needsParts: string[]; closeCounted: string[] };

async function computeBase(uAfter: number, uBefore: number): Promise<BaseState> {
  const token = process.env.INTERCOM_ACCESS_TOKEN!;
  const [crTeams, teepAdmins] = await Promise.all([getCRTeams(), getTeepAdmins()]);
  if (!crTeams.length) throw new Error("No CR teams found");

  const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));
  const teamIds        = crTeams.map(t => t.id);

  const [activityConvs, closedOnlyRaw] = await Promise.all([
    fetchConvsAllTeams(token, teamIds, "updated_at",               uAfter, uBefore),
    fetchConvsAllTeams(token, teamIds, "statistics.last_close_at", uAfter, uBefore),
  ]);

  const activityIds     = new Set(activityConvs.map((c: any) => c.id));
  const closedOnlyConvs = closedOnlyRaw.filter((c: any) => !activityIds.has(c.id));

  const agentMap = new Map<string, RawAcc>();
  teepAdmins.forEach((a: any) =>
    agentMap.set(String(a.id), emptyRaw(decodeName(a.name ?? String(a.id))))
  );

  const closeCounted = new Set<string>();
  const needsParts   = new Set<string>();

  // Pass 1: activity conversations -- full metrics
  for (const c of activityConvs) {
    const stats       = c.statistics ?? {};
    const adminReply  = stats.time_to_admin_reply ?? 0;
    const handling    = stats.time_to_first_close ?? 0;
    const assignment  = stats.time_to_assignment  ?? 0;
    const lastCloseAt = stats.last_close_at        ?? 0;

    if (c.admin_assignee_id && teepAdminIdSet.has(String(c.admin_assignee_id))) {
      agentMap.get(String(c.admin_assignee_id))!.assigned++;
    }

    const replierIds = resolveAgent(c, teepAdminIdSet, "all");
    for (const rid of replierIds) {
      const acc = agentMap.get(rid)!;
      if (adminReply > 0) {
        acc.repliedTo++;
        acc.slaTotal++;
        if (adminReply <= SLA_SECS) acc.slaMet++;
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

    const closedInPeriod = lastCloseAt > 0
      ? (lastCloseAt >= uAfter && lastCloseAt <= uBefore)
      : (c.state === "closed" || c.state === "resolved");

    if (closedInPeriod) {
      const closerIds = resolveAgent(c, teepAdminIdSet, "single");
      if (closerIds.length > 0) {
        // Attributed: count this conversation ONCE. Intercom's metric counts
        // unique conversations closed, not each reopen->reclose event, so we do
        // NOT fetch parts or add per-reopen tallies here.
        agentMap.get(closerIds[0])!.closed++;
        closeCounted.add(c.id);
      } else {
        // Unattributed: need parts to find which teep admin actually closed it.
        needsParts.add(c.id);
      }
    }
  }

  // Pass 2: closed-only extras (closed then reopened, missed by updated_at)
  for (const c of closedOnlyConvs) {
    const closerIds = resolveAgent(c, teepAdminIdSet, "single");
    if (closerIds.length > 0) {
      agentMap.get(closerIds[0])!.closed++;   // count once
      closeCounted.add(c.id);
    } else {
      needsParts.add(c.id);                    // unattributed: resolve closer via parts
    }
  }

  const agents: RawPayload = {};
  for (const [id, acc] of agentMap.entries()) agents[id] = acc;
  return { agents, needsParts: [...needsParts], closeCounted: [...closeCounted] };
}

// ── Pass 3: apply parts-level close events over the FULL range ─────────────
// useCache=true  -> read/write teep_conv and honour a wall-clock budget
// useCache=false -> live fallback: fetch everything, no budget, no cache
async function applyParts(
  base: BaseState,
  uAfter: number,
  uBefore: number,
  teepAdminIdSet: Set<string>,
  opts: { useCache: boolean; budgetMs?: number; startedAt?: number },
): Promise<{ agents: RawPayload; complete: boolean; ready: number; total: number }> {
  // Clone base (it is pre-Pass-3, so applying Pass 3 here is idempotent).
  const agentMap = new Map<string, RawAcc>();
  for (const [id, acc] of Object.entries(base.agents)) agentMap.set(id, { ...acc });

  const closeCountedSet = new Set(base.closeCounted);
  const needs           = base.needsParts;
  const total           = needs.length;
  const token           = process.env.INTERCOM_ACCESS_TOKEN!;

  const allParts: Record<string, CloseEvent[]> = {};
  if (opts.useCache) {
    const cached = await readTeepConvs(needs);
    for (const id of needs) if (cached[id]) allParts[id] = cached[id];
  }

  const uncached = needs.filter(id => allParts[id] === undefined);
  const BATCH    = 30;
  const budgetMs = opts.budgetMs ?? Infinity;
  const started  = opts.startedAt ?? Date.now();

  for (let i = 0; i < uncached.length; i += BATCH) {
    if (Date.now() - started > budgetMs) break;            // time guard (no-op when Infinity)
    const batch   = uncached.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(id => fetchAllCloseEvents(token, id)));
    for (let j = 0; j < batch.length; j++) allParts[batch[j]] = results[j];
    if (opts.useCache) {
      await writeTeepConvs(batch.map((id, j) => ({ convId: id, closes: results[j] })));
    }
  }

  const ready    = needs.filter(id => allParts[id] !== undefined).length;
  const complete = ready >= total;

  // Count each conversation ONCE. Intercom's "Closed conversations" counts
  // unique conversations closed in the range, not individual close events, so a
  // reopened-and-reclosed conversation must not be tallied twice. needsParts now
  // holds only UNATTRIBUTED conversations (Pass 1/2 already counted the
  // attributed ones once); for each, attribute a single close to the teep admin
  // who performed the most recent close inside the window.
  for (const convId of needs) {
    const events = allParts[convId];
    if (!events) continue;                                 // not resolved yet
    if (closeCountedSet.has(convId)) continue;             // safety: already counted in Pass 1/2
    const teepWindowCloses = events.filter(
      e => e.closedAt >= uAfter && e.closedAt <= uBefore && teepAdminIdSet.has(e.adminId),
    );
    if (teepWindowCloses.length > 0) {
      const closerId = teepWindowCloses[teepWindowCloses.length - 1].adminId; // last closer in window
      const acc = agentMap.get(closerId);
      if (acc) acc.closed++;
    }
  }

  const agents: RawPayload = {};
  for (const [id, acc] of agentMap.entries()) agents[id] = acc;
  return { agents, complete, ready, total };
}

// ── Finalize raw accumulators into the API result shape ───────────────────
function finalize(raw: RawPayload, uAfter: number, uBefore: number): any {
  const periodDays  = Math.max(1, Math.round((uBefore - uAfter) / 86400));
  const workingDays = countWorkdays(uAfter, uBefore);

  type AgentRow = {
    name: string; assigned: number; repliedTo: number; closed: number;
    avgFrtFmt: string; avgHandlingFmt: string; avgAtfFmt: string;
    repliedPerHour: string; closedPerHour: string;
    slaMet: number; slaTotal: number; slaRate: number;
  };

  const accs = Object.values(raw);
  const rows: AgentRow[] = accs
    .filter(a => a.assigned > 0 || a.repliedTo > 0 || a.closed > 0)
    .map(a => ({
      name:           a.name,
      assigned:       a.assigned,
      repliedTo:      a.repliedTo,
      closed:         a.closed,
      avgFrtFmt:      a.frtN > 0       ? fmt(a.frtSum / a.frtN)           : "--",
      avgHandlingFmt: a.handlingN > 0  ? fmt(a.handlingSum / a.handlingN) : "--",
      avgAtfFmt:      a.atfN > 0       ? fmt(a.atfSum / a.atfN)           : "--",
      repliedPerHour: workingDays > 0  ? (a.repliedTo / workingDays).toFixed(1) : "--",
      closedPerHour:  workingDays > 0  ? (a.closed    / workingDays).toFixed(1) : "--",
      slaMet:         a.slaMet,
      slaTotal:       a.slaTotal,
      slaRate:        a.slaTotal > 0 ? +((a.slaMet / a.slaTotal) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.closed - a.closed);

  const totalAssigned  = rows.reduce((s, r) => s + r.assigned,  0);
  const totalRepliedTo = rows.reduce((s, r) => s + r.repliedTo, 0);
  const totalClosed    = rows.reduce((s, r) => s + r.closed,    0);
  const totalSlaMet    = rows.reduce((s, r) => s + r.slaMet,    0);
  const totalSlaTotal  = rows.reduce((s, r) => s + r.slaTotal,  0);

  let wFrtSum = 0, wFrtN = 0, wHandlingSum = 0, wHandlingN = 0, wAtfSum = 0, wAtfN = 0;
  for (const a of accs) {
    wFrtSum += a.frtSum; wFrtN += a.frtN;
    wHandlingSum += a.handlingSum; wHandlingN += a.handlingN;
    wAtfSum += a.atfSum; wAtfN += a.atfN;
  }

  const summaryRow: AgentRow = {
    name:           "Summary",
    assigned:       totalAssigned,
    repliedTo:      totalRepliedTo,
    closed:         totalClosed,
    avgFrtFmt:      wFrtN > 0       ? fmt(wFrtSum / wFrtN)           : "--",
    avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
    avgAtfFmt:      wAtfN > 0       ? fmt(wAtfSum / wAtfN)           : "--",
    repliedPerHour: workingDays > 0 ? (totalRepliedTo / workingDays).toFixed(1) : "--",
    closedPerHour:  workingDays > 0 ? (totalClosed    / workingDays).toFixed(1) : "--",
    slaMet:         totalSlaMet,
    slaTotal:       totalSlaTotal,
    slaRate:        totalSlaTotal > 0 ? +((totalSlaMet / totalSlaTotal) * 100).toFixed(1) : 0,
  };

  return {
    summary: {
      totalClosed,
      avgFrtFmt:      wFrtN > 0       ? fmt(wFrtSum / wFrtN)           : "--",
      avgHandlingFmt: wHandlingN > 0  ? fmt(wHandlingSum / wHandlingN) : "--",
      slaRate:        summaryRow.slaRate,
      slaMetCount:    totalSlaMet,
      slaTotalCount:  totalSlaTotal,
      top3:           rows.slice(0, 3).map(r => ({ name: r.name, closed: r.closed })),
    },
    periodDays,
    summaryRow,
    agents: rows,
  };
}

// ── Period key (Dhaka calendar dates, matches the user's selected range) ───
function periodKey(uAfter: number, uBefore: number): string {
  const a = new Date(uAfter * 1000 + 6 * 3600 * 1000).toISOString().slice(0, 10);
  const b = new Date(uBefore * 1000 + 6 * 3600 * 1000).toISOString().slice(0, 10);
  return `${a}_${b}`;
}

// ── Measured single-day diagnostic ─────────────────────────────────────────
// Times the search (computeBase) and ONE parts batch for a single day, so it
// can never itself exceed 60s. From these numbers we can tell exactly which
// operation is the bottleneck and extrapolate to multi-day ranges.
async function measureDay(dateStr: string) {
  const uAfter  = toUnixStart(dateStr);
  const uBefore = toUnixEnd(dateStr);

  const t0 = Date.now();
  const base = await computeBase(uAfter, uBefore);
  const baseMs = Date.now() - t0;

  const teepAdmins     = await getTeepAdmins();
  const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));
  const token          = process.env.INTERCOM_ACCESS_TOKEN!;

  // Time ONE batch of up to 30 per-conversation parts fetches.
  const sample = base.needsParts.slice(0, 30);
  const t1 = Date.now();
  await Promise.all(sample.map(id => fetchAllCloseEvents(token, id)));
  const batchMs = sample.length > 0 ? Date.now() - t1 : 0;

  const totalNeeds   = base.needsParts.length;
  const perConvMs    = sample.length > 0 ? Math.round(batchMs / sample.length) : 0;
  const estPartsMs    = perConvMs * totalNeeds; // rough; batches of 30 run in parallel
  const attributed   = Object.values(base.agents).reduce((s, a) => s + a.closed, 0);

  return {
    date: dateStr,
    search:    { ms: baseMs, activityConvs: Object.keys(base.agents).length },
    closedAttributedSoFar: attributed,
    needsParts: totalNeeds,
    partsBatch: { sampled: sample.length, ms: batchMs, perConvMs },
    estimatedFullPartsMs: estPartsMs,
    verdict:
      baseMs > 45000 ? "SEARCH is the bottleneck (one day's search alone is too slow)"
      : totalNeeds * perConvMs > 35000 ? "PARTS volume is the bottleneck for this day"
      : "this single day fits comfortably; multi-day ranges are the problem -> chunk by day",
    at: new Date().toISOString(),
  };
}

// ── Per-day helpers ────────────────────────────────────────────────────────
// List the Dhaka (+06) calendar days covered by a range, inclusive.
function listDays(uAfter: number, uBefore: number): string[] {
  const days: string[] = [];
  const startShift = new Date(uAfter  * 1000 + 6 * 3600 * 1000);
  const endShift   = new Date(uBefore * 1000 + 6 * 3600 * 1000);
  let cur = new Date(Date.UTC(startShift.getUTCFullYear(), startShift.getUTCMonth(), startShift.getUTCDate()));
  const end = new Date(Date.UTC(endShift.getUTCFullYear(), endShift.getUTCMonth(), endShift.getUTCDate()));
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

// Component-wise sum of per-agent accumulators (the metrics are stored as
// sums + counts, so summing across days is exact -- no double counting).
function mergeRaw(target: RawPayload, src: RawPayload): void {
  for (const [id, a] of Object.entries(src)) {
    const t = target[id] ?? (target[id] = emptyRaw(a.name));
    if (!t.name && a.name) t.name = a.name;
    t.assigned    += a.assigned;    t.repliedTo += a.repliedTo;  t.closed += a.closed;
    t.frtSum      += a.frtSum;      t.frtN      += a.frtN;
    t.handlingSum += a.handlingSum; t.handlingN += a.handlingN;
    t.atfSum      += a.atfSum;      t.atfN      += a.atfN;
    t.slaMet      += a.slaMet;      t.slaTotal  += a.slaTotal;
  }
}

// Compute (or read) ONE day's post-parts accumulator. A completed day is cached
// in teep_day and never recomputed (closed days are immutable). A heavy day whose
// parts don't finish in budget returns complete=false and resumes via teep_conv
// on the next request (its already-fetched parts are cached, so it speeds up).
async function computeDayRaw(
  day: string, teepAdminIdSet: Set<string>,
  useCache: boolean, budgetMs: number, startedAt: number,
): Promise<{ agents: RawPayload; complete: boolean }> {
  const uA = toUnixStart(day), uB = toUnixEnd(day);
  const dayKey = periodKey(uA, uB);

  // Per-day base (small single-day search): reuse cached, else compute + cache.
  let base: BaseState | null = useCache ? ((await readTeepBase(dayKey)) as BaseState | null) : null;
  if (!base) {
    base = await computeBase(uA, uB);
    if (useCache) await writeTeepBase(dayKey, base);
  }

  const { agents, complete } = await applyParts(
    base, uA, uB, teepAdminIdSet, { useCache, budgetMs, startedAt },
  );
  if (complete && useCache) await writeTeepDay(day, agents); // freeze the finished day
  return { agents, complete };
}

// ── Resumable RANGE compute: sum of per-day accumulators ───────────────────
// Wide ranges never run one giant multi-day search (that is what hit the 60s
// cap). Instead each day is computed once (small search) and summed. Cached days
// are free; missing days are computed within a wall-clock budget; the rest fill
// in on auto-reload. useCache=false (no Supabase) still works for a single day
// and stays budgeted for wider ones (just cannot resume across requests).
async function getTeepByDays(
  uAfter: number, uBefore: number, useCache: boolean = true,
): Promise<{ result: any; complete: boolean }> {
  const started   = Date.now();
  const BUDGET_MS = 42000;                       // return before the 60s cap
  const days      = listDays(uAfter, uBefore);

  const teepAdmins     = await getTeepAdmins();
  const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));

  // 1. Pull every already-cached complete day in one batch (cheap).
  const cached: Record<string, RawPayload> = useCache
    ? (await readTeepDays(days)) as Record<string, RawPayload>
    : {};

  const merged: RawPayload = {};
  const missing: string[] = [];
  for (const d of days) {
    if (cached[d]) mergeRaw(merged, cached[d]);
    else missing.push(d);
  }

  // 2. Compute missing days within the budget (oldest first).
  let daysDone = days.length - missing.length;
  let allComplete = missing.length === 0;
  for (const d of missing) {
    if (Date.now() - started > BUDGET_MS) { allComplete = false; break; }
    const { agents, complete } = await computeDayRaw(d, teepAdminIdSet, useCache, BUDGET_MS, started);
    mergeRaw(merged, agents);
    if (complete) daysDone++; else allComplete = false;
  }

  const result = finalize(merged, uAfter, uBefore);
  result.partial = !allComplete;
  result.ready   = daysDone;       // days fully resolved
  result.total   = days.length;    // days in range
  return { result, complete: allComplete };
}

// ── Self-healing guard ─────────────────────────────────────────────────────
// A cached row is only honoured if it actually has data. This makes an empty /
// poisoned cache row (which previously pinned a range to "no data" forever)
// self-correct: it is ignored on read and recomputed, and never written.
function isUsableResult(r: any): boolean {
  return !!(
    r &&
    r.summary &&
    typeof r.summary.totalClosed === "number" &&
    r.summary.totalClosed > 0 &&
    Array.isArray(r.agents) &&
    r.agents.length > 0
  );
}

// ── Cache-first entry point (exported for the cron warmer) ─────────────────
export async function getTeepCached(uAfter: number, uBefore: number): Promise<any> {
  const haveSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const key = periodKey(uAfter, uBefore);

  // 1. Finished range cached -> instant. Ignore empty/poisoned rows and recompute.
  if (haveSupabase) {
    const cached = await readTeepCache(key);
    if (isUsableResult(cached)) return cached;
  }

  // 2. Budgeted per-day compute. Wide ranges are summed from per-day pieces, so
  //    no single request ever runs a giant multi-day search past the 60s cap.
  const { result, complete } = await getTeepByDays(uAfter, uBefore, haveSupabase);
  if (haveSupabase && complete && isUsableResult(result)) {
    await writeTeepCache(key, result);
  }

  // If a range is stuck partial, tell the client WHETHER persistence works, so a
  // broken cache surfaces as a clear message instead of an endless retry loop.
  if (result.partial && haveSupabase) {
    const rt = await supabaseRoundtrip();
    result.cacheHealthy = rt.ok === true;
  }
  return result;
}

// ── Cron helper: warm yesterday's range ───────────────────────────────────
export async function warmYesterdayDay(): Promise<void> {
  const y = defaultWindows().find(w => w.label === "yesterday")!;
  await getTeepCached(y.uAfter, y.uBefore);
}

// ── Default precompute windows (used by the cron warmer) ───────────────────
// All windows END YESTERDAY in +06 (Dhaka), since we never view today.
export function defaultWindows(): Array<{ label: string; uAfter: number; uBefore: number }> {
  const dhakaNow = new Date(Date.now() + 6 * 3600 * 1000);
  const Y = dhakaNow.getUTCFullYear();
  const M = dhakaNow.getUTCMonth();
  const D = dhakaNow.getUTCDate();
  const dStr = (offset: number) =>
    new Date(Date.UTC(Y, M, D - offset)).toISOString().slice(0, 10);

  const yesterday = dStr(1);
  return [
    { label: "yesterday", uAfter: toUnixStart(dStr(1)),  uBefore: toUnixEnd(yesterday) },
    { label: "last7",     uAfter: toUnixStart(dStr(7)),  uBefore: toUnixEnd(yesterday) },
    { label: "last30",    uAfter: toUnixStart(dStr(30)), uBefore: toUnixEnd(yesterday) },
  ];
}

// ── Route handler ─────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);

    // ── Diagnostics ─────────────────────────────────────────────────────────
    // ?diag=1                  -> cache health + persistence round-trip (no Intercom).
    // ?diag=2&date=YYYY-MM-DD  -> measured single-day timing (safe, < 60s).
    const diag = searchParams.get("diag");
    if (diag === "1") {
      return NextResponse.json({
        env: supabaseEnvPresent(),
        intercomTokenPresent: !!process.env.INTERCOM_ACCESS_TOKEN,
        supabase: await supabaseHealthcheck(),
        persistenceRoundtrip: await supabaseRoundtrip(),
        at: new Date().toISOString(),
      });
    }
    if (diag === "2") {
      if (!process.env.INTERCOM_ACCESS_TOKEN)
        throw new Error("INTERCOM_ACCESS_TOKEN not set");
      const dateStr = searchParams.get("date")
        || new Date(Date.now() + 6 * 3600 * 1000 - 86400000).toISOString().slice(0, 10); // yesterday (Dhaka)
      return NextResponse.json(await measureDay(dateStr));
    }

    // Shared: count conversations matching a search, via total_count (instant, no pagination).
    const countConvs = async (
      field: string, uA: number, uB: number, emailOnly: boolean,
    ): Promise<number> => {
      const token   = process.env.INTERCOM_ACCESS_TOKEN!;
      const crTeams = await getCRTeams();
      const teamIds = crTeams.map(t => t.id);
      const HDRS = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Intercom-Version": "2.11" };
      const teamBatches: string[][] = [];
      for (let i = 0; i < teamIds.length; i += 5) teamBatches.push(teamIds.slice(i, i + 5));
      const perBatch = await Promise.all(teamBatches.map(async (bTeams) => {
        const value: any[] = [];
        if (emailOnly) value.push({ field: "source.type", operator: "=", value: "email" });
        value.push({ operator: "OR", value: bTeams.map(id => ({ field: "team_assignee_id", operator: "=", value: parseInt(id) })) });
        value.push({ field, operator: ">", value: uA });
        value.push({ field, operator: "<", value: uB });
        const res = await fetch(`${INTERCOM_API}/conversations/search`, {
          method: "POST", headers: HDRS, body: JSON.stringify({ query: { operator: "AND", value }, pagination: { per_page: 1 } }),
        });
        const data = await res.json();
        return data.total_count ?? 0;
      }));
      return perBatch.reduce((s, n) => s + n, 0);
    };

    // ?diag=3&date=YYYY-MM-DD -> raw VOLUME for a day (instant; safe even for heavy days).
    if (diag === "3") {
      if (!process.env.INTERCOM_ACCESS_TOKEN) throw new Error("INTERCOM_ACCESS_TOKEN not set");
      const dateStr = searchParams.get("date")
        || new Date(Date.now() + 6 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
      const uA = toUnixStart(dateStr), uB = toUnixEnd(dateStr);
      const [updEmail, closeEmail, closeAll] = await Promise.all([
        countConvs("updated_at", uA, uB, true),
        countConvs("statistics.last_close_at", uA, uB, true),
        countConvs("statistics.last_close_at", uA, uB, false),
      ]);
      return NextResponse.json({
        date: dateStr,
        updated_at_count_email: updEmail,         // activity volume (the search that times out when huge)
        last_close_at_count_email: closeEmail,    // closed-search volume, EMAIL only (TEEP's scope)
        last_close_at_count_allChannels: closeAll,// closed-search volume, ALL channels in CR teams
        note: "Compare last_close_at_count_email to your internal dashboard's number for this day.",
        at: new Date().toISOString(),
      });
    }

    // ?diag=4&date=YYYY-MM-DD -> full CLOSED-COUNT breakdown (safe on light days; may
    // time out on a heavy day like 2026-06-16 -- use diag=3 for those).
    if (diag === "4") {
      if (!process.env.INTERCOM_ACCESS_TOKEN) throw new Error("INTERCOM_ACCESS_TOKEN not set");
      const dateStr = searchParams.get("date")
        || new Date(Date.now() + 6 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
      const uA = toUnixStart(dateStr), uB = toUnixEnd(dateStr);

      const [closeEmail, closeAll] = await Promise.all([
        countConvs("statistics.last_close_at", uA, uB, true),
        countConvs("statistics.last_close_at", uA, uB, false),
      ]);

      const base = await computeBase(uA, uB);
      const attributedBeforeParts = Object.values(base.agents).reduce((s, a) => s + a.closed, 0);
      const needsParts = base.needsParts.length;

      const teepAdmins     = await getTeepAdmins();
      const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));
      const { agents } = await applyParts(base, uA, uB, teepAdminIdSet, { useCache: false });
      const finalClosed = Object.values(agents).reduce((s, a) => s + a.closed, 0);

      return NextResponse.json({
        date: dateStr,
        searchFinds: {
          last_close_at_email: closeEmail,        // convs TEEP's email+CR search finds closed this day
          last_close_at_allChannels: closeAll,    // same, but all channels (scope check)
        },
        teepCredits: {
          attributedBeforeParts,                  // closes credited to a TEEP agent before parts
          needsPartsUnattributed: needsParts,     // closed convs with no obvious TEEP closer
          finalClosed,                            // the number the dashboard shows
        },
        interpretation:
          `Search found ${closeEmail} email closes in CR teams; TEEP credited ${finalClosed}. ` +
          `Unexplained gap (found-but-not-credited) = ${closeEmail - finalClosed}. ` +
          `All-channels closes = ${closeAll} (if this >> email, the internal number counts non-email).`,
        at: new Date().toISOString(),
      });
    }

    // ?diag=6&date=YYYY-MM-DD -> REPLIES probe. Counts teammate comment replies
    // (part_type "comment", admin author) sent inside the window, on conversations
    // a customer participated in. Budgeted; reports coverage so we know if a heavy
    // day was only partially scanned. Mirrors internal "teammate replies sent".
    if (diag === "6") {
      if (!process.env.INTERCOM_ACCESS_TOKEN) throw new Error("INTERCOM_ACCESS_TOKEN not set");
      const dateStr = searchParams.get("date")
        || new Date(Date.now() + 6 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
      const uA = toUnixStart(dateStr), uB = toUnixEnd(dateStr);
      const token   = process.env.INTERCOM_ACCESS_TOKEN!;
      const started = Date.now();
      const BUDGET  = 42000;

      const crTeams = await getCRTeams();
      const { nameMap } = await getAdmins();
      const teepAdmins  = await getTeepAdmins();
      const teepIdSet   = new Set(teepAdmins.map((a: any) => String(a.id)));

      // Conversations whose last admin reply landed in the window (proxy for
      // "conversations with a reply this day"; a reply followed by a later reply
      // outside the window is the same drift caveat as closes).
      const convs = await fetchConvsAllTeams(
        token, crTeams.map((t: any) => t.id), "statistics.last_admin_reply_at", uA, uB,
      );

      const perId: Record<string, { name: string; isTeep: boolean; replies: number }> = {};
      let convsProcessed = 0, convsWithCustomer = 0, totalReplies = 0, teepReplies = 0;
      let budgetHit = false;

      for (let i = 0; i < convs.length; i += 20) {
        if (Date.now() - started > BUDGET) { budgetHit = true; break; }
        const slice = convs.slice(i, i + 20);
        const detailed = await Promise.all(slice.map(async (c: any) => {
          const r = await fetch(`${INTERCOM_API}/conversations/${c.id}`, {
            headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
            next: { revalidate: 300 },
          });
          if (!r.ok) return null;
          return r.json();
        }));
        for (const d of detailed) {
          if (!d) continue;
          convsProcessed++;
          const parts = d.conversation_parts?.conversation_parts ?? [];
          const hadCustomer =
            d.source?.author?.type === "user" || d.source?.author?.type === "contact" ||
            parts.some((p: any) => p.author?.type === "user" || p.author?.type === "contact");
          if (hadCustomer) convsWithCustomer++;
          for (const p of parts) {
            if (p.part_type === "comment" && p.author?.type === "admin"
                && p.created_at > uA && p.created_at < uB) {
              const id = String(p.author.id);
              const isTeep = teepIdSet.has(id);
              perId[id] ??= { name: nameMap[id] ?? `Admin ${id}`, isTeep, replies: 0 };
              perId[id].replies++;
              totalReplies++;
              if (isTeep) teepReplies++;
            }
          }
        }
      }

      const perAgent = Object.values(perId).sort((a, b) => b.replies - a.replies);
      return NextResponse.json({
        date: dateStr,
        convsWithReplyInWindow: convs.length,   // universe found by the search
        convsProcessed,                         // how many we actually scanned (budget)
        budgetHit,                              // true => heavy day, only partial scan
        convsWithCustomer,
        totalTeammateReplies: totalReplies,     // compare to internal "replies sent"
        teepAgentReplies: teepReplies,          // subset by your 12 agents
        perAgent,
        note: budgetHit
          ? "Partial scan (heavy day) -- totals are a floor, not the full count."
          : "Full scan of conversations whose last reply was in-window.",
        at: new Date().toISOString(),
      });
    }

    // ?diag=7&date=YYYY-MM-DD -> DAY TRACE. Times computeBase vs the parts pass for
    // one day so we can see why a day (e.g. 2026-06-16) will not finish. Cold, no
    // cache, but honours the same 42s budget the real per-day path uses.
    if (diag === "7") {
      if (!process.env.INTERCOM_ACCESS_TOKEN) throw new Error("INTERCOM_ACCESS_TOKEN not set");
      const dateStr = searchParams.get("date")
        || new Date(Date.now() + 6 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
      const uA = toUnixStart(dateStr), uB = toUnixEnd(dateStr);
      const started = Date.now();

      const t0 = Date.now();
      const base = await computeBase(uA, uB);
      const baseMs = Date.now() - t0;
      const needsParts = base.needsParts.length;
      const attributedBeforeParts = Object.values(base.agents).reduce((s, a) => s + a.closed, 0);

      const teepAdmins = await getTeepAdmins();
      const teepIdSet  = new Set(teepAdmins.map((a: any) => String(a.id)));
      const t1 = Date.now();
      const { agents, complete } = await applyParts(
        base, uA, uB, teepIdSet, { useCache: false, budgetMs: 42000, startedAt: started },
      );
      const partsMs = Date.now() - t1;
      const finalClosed = Object.values(agents).reduce((s, a) => s + a.closed, 0);

      return NextResponse.json({
        date: dateStr,
        baseMs,                       // time just to fetch+attribute the base searches
        needsParts,                   // conversations that still need a parts fetch
        attributedBeforeParts,
        partsMs,                      // time spent in the (budgeted) parts pass
        complete,                     // false => one fresh pass cannot finish this day
        finalClosed,
        diagnosis:
          baseMs > 25000
            ? "Base alone eats most of the 42s budget; parts get starved -> day never completes in one pass."
            : (!complete
                ? `Base is fine (${baseMs}ms) but ${needsParts} parts can't finish in one pass; needs cached resume.`
                : "Day completes in a single cold pass; stall is elsewhere (frontend retry or cache write)."),
        at: new Date().toISOString(),
      });
    }

    const startDate = searchParams.get("startDate") ?? "";
    const endDate   = searchParams.get("endDate")   ?? "";

    if (!process.env.INTERCOM_ACCESS_TOKEN)
      throw new Error("INTERCOM_ACCESS_TOKEN not set");

    // Default (no params) = YESTERDAY only. A single day's search is small and
    // returns fast; the previous 7-day default ran one giant search that the
    // 60s Hobby limit kills on tab open. Users pick wider ranges explicitly.
    const yest = defaultWindows().find(w => w.label === "yesterday")!;
    const uAfter  = startDate ? toUnixStart(startDate) : yest.uAfter;
    const uBefore = endDate   ? toUnixEnd(endDate)     : yest.uBefore;

    const data = await getTeepCached(uAfter, uBefore);
    return NextResponse.json(data);

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
