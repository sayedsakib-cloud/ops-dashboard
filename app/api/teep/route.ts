import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { unstable_cache }   from "next/cache";
import {
  readTeepCache, writeTeepCache,
  readTeepBase,  writeTeepBase,
  readTeepConvs, writeTeepConvs,
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
    const countReopens= stats.count_reopens        ?? 0;

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
        agentMap.get(closerIds[0])!.closed++;
        closeCounted.add(c.id);
        if (countReopens > 0) needsParts.add(c.id);
      } else {
        needsParts.add(c.id);
      }
    }
  }

  // Pass 2: closed-only extras (closed then reopened, missed by updated_at)
  for (const c of closedOnlyConvs) {
    const countReopens = c.statistics?.count_reopens ?? 0;
    const closerIds    = resolveAgent(c, teepAdminIdSet, "single");
    if (closerIds.length > 0) {
      agentMap.get(closerIds[0])!.closed++;
      closeCounted.add(c.id);
      if (countReopens > 0) needsParts.add(c.id);
    } else {
      needsParts.add(c.id);
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

  // Count in-window close events. Mirrors the original windowed Pass-3 logic:
  // k indexes ALL admin close events in window (chronological); non-teep are
  // skipped but still advance k; the first close of an already-counted
  // conversation is the one Pass 1/2 attributed, so it is exempted (k===0).
  for (const convId of needs) {
    const events = allParts[convId];
    if (!events) continue;                                 // not resolved yet
    const windowEvents = events.filter(e => e.closedAt >= uAfter && e.closedAt <= uBefore);
    const already = closeCountedSet.has(convId);
    for (let k = 0; k < windowEvents.length; k++) {
      const adminId = windowEvents[k].adminId;
      if (!teepAdminIdSet.has(adminId)) continue;
      if (!already || k > 0) {
        const acc = agentMap.get(adminId);
        if (acc) acc.closed++;
      }
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

// ── Live fallback: full compute in one pass (no caching layer) ─────────────
async function computeTeepLive(uAfter: number, uBefore: number): Promise<any> {
  const base = await computeBase(uAfter, uBefore);
  const teepAdmins = await getTeepAdmins();
  const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));
  const { agents } = await applyParts(base, uAfter, uBefore, teepAdminIdSet, { useCache: false });
  return finalize(agents, uAfter, uBefore);
}

// ── Resumable range compute: cached base + incremental per-conv parts ──────
async function getTeepByConvs(
  uAfter: number, uBefore: number,
): Promise<{ result: any; complete: boolean }> {
  const started   = Date.now();
  const BUDGET_MS = 45000;                 // return before the 60s cap
  const key       = periodKey(uAfter, uBefore);

  // 1. Base (search + Pass 1/2): reuse cached, else compute once and cache.
  let base = (await readTeepBase(key)) as BaseState | null;
  if (!base) {
    base = await computeBase(uAfter, uBefore);
    await writeTeepBase(key, base);
  }

  // 2. Pass 3 from the per-conversation parts cache, within the time budget.
  const teepAdmins     = await getTeepAdmins();
  const teepAdminIdSet = new Set(teepAdmins.map((a: any) => String(a.id)));
  const { agents, complete, ready, total } = await applyParts(
    base, uAfter, uBefore, teepAdminIdSet,
    { useCache: true, budgetMs: BUDGET_MS, startedAt: started },
  );

  const result = finalize(agents, uAfter, uBefore);
  result.partial = !complete;
  result.ready   = ready;   // conversations whose close attribution is resolved
  result.total   = total;   // conversations needing parts-level attribution
  return { result, complete };
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
  // No Supabase configured -> live compute (no caching; slower for big ranges).
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return await computeTeepLive(uAfter, uBefore);
  }

  const key = periodKey(uAfter, uBefore);

  // 1. Finished range cached -> instant. Ignore empty/poisoned rows and recompute.
  const cached = await readTeepCache(key);
  if (isUsableResult(cached)) return cached;

  // 2. Build incrementally from cached base + per-conversation parts.
  try {
    const { result, complete } = await getTeepByConvs(uAfter, uBefore);
    // Only freeze a finished range that actually has data -- never cache an empty.
    if (complete && isUsableResult(result)) await writeTeepCache(key, result);
    return result;
  } catch {
    // 3. Pipeline/Supabase failure -> degrade to a live full compute.
    return await computeTeepLive(uAfter, uBefore);
  }
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
    const startDate = searchParams.get("startDate") ?? "";
    const endDate   = searchParams.get("endDate")   ?? "";

    if (!process.env.INTERCOM_ACCESS_TOKEN)
      throw new Error("INTERCOM_ACCESS_TOKEN not set");

    // Default (no params) = last 7 completed days ending yesterday.
    const last7 = defaultWindows().find(w => w.label === "last7")!;
    const uAfter  = startDate ? toUnixStart(startDate) : last7.uAfter;
    const uBefore = endDate   ? toUnixEnd(endDate)     : last7.uBefore;

    const data = await getTeepCached(uAfter, uBefore);
    return NextResponse.json(data);

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
