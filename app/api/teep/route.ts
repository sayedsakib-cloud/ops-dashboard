import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";
import { unstable_cache }   from "next/cache";
import { readTeepCache, writeTeepCache, readTeepDays, writeTeepDay } from "@/lib/supabase";

const INTERCOM_API  = "https://api.intercom.io";
const SLA_SECS      = 24 * 3600;

// Large uncached computes page through many Intercom results. Give the function
// the Hobby-plan maximum (60s). Day buckets keep individual computes small, so
// this is ample; only a cold multi-day range computes several days in one call.
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

// ── OR-batched multi-team conversation search ─────────────────────────────
// KEY OPTIMISATION: replaces 14 separate per-team API calls with 3 parallel
// OR-query batches (groups of 5 teams), reducing concurrent connections from
// 28 to 6 and eliminating Intercom rate-limit throttling.
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
  const BATCH_SIZE = 5;  // teams per OR clause -- safe below Intercom query depth limit
  // Real stop condition is cursor === null. PAGE_CAP is only a runaway safety
  // bound -- high enough to never truncate a real day/range. With day buckets,
  // a single day rarely exceeds a couple pages, but keep headroom for busy days.
  const PAGE_CAP   = 1000;

  // Split team IDs into groups of 5
  const batches: string[][] = [];
  for (let i = 0; i < teamIds.length; i += BATCH_SIZE) {
    batches.push(teamIds.slice(i, i + BATCH_SIZE));
  }

  // Run all batches concurrently (3 batches for 14 teams)
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

  // Merge results from all batches, deduplicating by conversation ID
  const merged: any[] = [];
  const seen = new Set<string>();
  for (const batch of batchResults) {
    for (const c of batch) {
      if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
    }
  }
  return merged;
}

// ── Parts fetch for unattributed / re-closed conversations ────────────────
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
      part.part_type   === "close"  &&
      part.author?.type === "admin" &&
      part.created_at  >= uAfter   &&
      part.created_at  <= uBefore
    ) {
      events.push({ adminId: String(part.author.id), closedAt: part.created_at });
    }
  }
  return events;
}

// ── Raw per-agent accumulator type (the additive building block) ──────────
type RawAcc = {
  name: string;
  assigned: number; repliedTo: number; closed: number;
  frtSum: number; frtN: number; handlingSum: number; handlingN: number;
  atfSum: number; atfN: number; slaMet: number; slaTotal: number;
};
// Raw payload for a day/range: agentId -> RawAcc. Fully additive across days.
type RawPayload = Record<string, RawAcc>;

function emptyRaw(name: string): RawAcc {
  return { name, assigned:0, repliedTo:0, closed:0,
           frtSum:0, frtN:0, handlingSum:0, handlingN:0,
           atfSum:0, atfN:0, slaMet:0, slaTotal:0 };
}

// ── RAW accumulation for a single window (the expensive Intercom work) ─────
// Returns per-agent additive accumulators (sums + counts), NOT finalized
// averages. Used both for single-day buckets and (via wrapper) full ranges.
async function computeRaw(uAfter: number, uBefore: number): Promise<RawPayload> {
    const token = process.env.INTERCOM_ACCESS_TOKEN!;

    const [crTeams, { admins }] = await Promise.all([getCRTeams(), getAdmins()]);
    if (!crTeams.length) throw new Error("No CR teams found");

    const teepAdmins = admins.filter((a: any) =>
      TEEP_AGENT_NAMES.some(n =>
        normName(a.name).includes(normName(n)) || normName(n).includes(normName(a.name))
      )
    );
    if (!teepAdmins.length) throw new Error("No TEEP agents matched");

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

    // Pass 3: batch-fetch parts for unattributed + re-close events
    if (needsParts.size > 0) {
      const ids   = [...needsParts];
      const BATCH = 30;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch   = ids.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(id => fetchCloseParts(token, id, uAfter, uBefore))
        );
        for (let j = 0; j < batch.length; j++) {
          const convId = batch[j];
          const events = results[j];
          const already = closeCounted.has(convId);
          for (let k = 0; k < events.length; k++) {
            const { adminId } = events[k];
            if (!teepAdminIdSet.has(adminId)) continue;
            if (!already || k > 0) agentMap.get(adminId)!.closed++;
          }
        }
      }
    }

    // Return raw accumulators keyed by agent id (serializable, additive)
    const payload: RawPayload = {};
    for (const [id, acc] of agentMap.entries()) payload[id] = acc;
    return payload;
}

// ── Merge raw payloads (component-wise add) -- the heart of additivity ─────
function mergeRaw(payloads: RawPayload[]): RawPayload {
  const out: RawPayload = {};
  for (const p of payloads) {
    for (const [id, acc] of Object.entries(p)) {
      if (!out[id]) out[id] = emptyRaw(acc.name);
      const o = out[id];
      o.assigned += acc.assigned; o.repliedTo += acc.repliedTo; o.closed += acc.closed;
      o.frtSum += acc.frtSum; o.frtN += acc.frtN;
      o.handlingSum += acc.handlingSum; o.handlingN += acc.handlingN;
      o.atfSum += acc.atfSum; o.atfN += acc.atfN;
      o.slaMet += acc.slaMet; o.slaTotal += acc.slaTotal;
      if (!o.name && acc.name) o.name = acc.name;
    }
  }
  return out;
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

// ── Full-range compute (legacy path): raw over the whole window, then finalize.
// Used as the period-key cache fill and the Supabase-down fallback.
async function computeTeep(uAfter: number, uBefore: number): Promise<any> {
  const raw = await computeRaw(uAfter, uBefore);
  return finalize(raw, uAfter, uBefore);
}

// ── Period key: stable identifier for a closed date range ─────────────────
// Uses the UTC calendar dates of the window bounds, so the same period always
// maps to the same Supabase row regardless of the exact second requested.
function periodKey(uAfter: number, uBefore: number): string {
  // Use +06 (Dhaka) calendar dates so the key matches the user's selected range
  // (toISOString() would shift to UTC and roll the start date back a day).
  const a = new Date(uAfter * 1000 + 6 * 3600 * 1000).toISOString().slice(0, 10);
  const b = new Date(uBefore * 1000 + 6 * 3600 * 1000).toISOString().slice(0, 10);
  return `${a}_${b}`;
}

// ── Day helpers for the bucket model ──────────────────────────────────────
// List the +06 (Dhaka) calendar day strings covered by [uAfter, uBefore].
function listDays(uAfter: number, uBefore: number): string[] {
  const days: string[] = [];
  // Convert bounds to Dhaka day strings.
  const startMs = uAfter * 1000;
  const endMs   = uBefore * 1000;
  const d = new Date(startMs + 6 * 3600 * 1000);
  let cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const endD = new Date(endMs + 6 * 3600 * 1000);
  const endDay = Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate());
  while (cur <= endDay) {
    days.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400 * 1000;
  }
  return days;
}

// Compute one day's raw accumulator and cache it. day = "YYYY-MM-DD" (Dhaka).
async function computeAndCacheDay(day: string): Promise<RawPayload> {
  const uAfter  = toUnixStart(day);
  const uBefore = toUnixEnd(day);
  const raw = await computeRaw(uAfter, uBefore);
  await writeTeepDay(day, raw);
  return raw;
}

// Assemble a range from per-day buckets. Reads cached days, computes missing
// ones (bounded so a cold large range doesn't exceed the function timeout),
// merges, finalizes. Returns { result, complete } -- complete=false means some
// days couldn't be computed in this request and will fill in on a later load.
async function getTeepByDays(
  uAfter: number, uBefore: number,
): Promise<{ result: any; complete: boolean }> {
  const startedAt = Date.now();
  // Stop launching new day computes once we approach the function limit, leaving
  // headroom to merge/finalize/return valid JSON. maxDuration is 60s; budget 42s
  // for fetching so a slow day can finish and we still respond cleanly.
  const TIME_BUDGET_MS = 42_000;

  const days = listDays(uAfter, uBefore);
  const cachedMap = await readTeepDays(days);

  const missing = days.filter(d => !cachedMap[d]);
  const payloads: RawPayload[] = [];

  // Use cached days first (free)
  for (const d of days) {
    if (cachedMap[d]) payloads.push(cachedMap[d] as RawPayload);
  }

  // Compute missing days until the time budget is spent. Whatever doesn't fit
  // fills in on the next load (cached days are skipped) or via the nightly cron.
  let complete = missing.length === 0;
  for (const d of missing) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { complete = false; break; }
    try {
      const raw = await computeAndCacheDay(d);
      payloads.push(raw);
    } catch {
      complete = false;
    }
  }

  const merged = mergeRaw(payloads);
  const result = finalize(merged, uAfter, uBefore);
  result.partial = !complete;            // UI can show "still computing -- reload"
  result.daysTotal = days.length;        // how many days the range spans
  result.daysReady = payloads.length;    // how many are included so far
  return { result, complete };
}

// ── Cache-first wrapper ───────────────────────────────────────────────────
// Strategy:
//   1. Try the exact period-key cache (fastest for repeated identical queries).
//   2. Otherwise assemble from per-day buckets (additive, never truncates).
//   3. If a range is fully assembled from days, also store it under its
//      period-key so the next identical query is a one-read hit.
//   4. If Supabase is unconfigured/unreachable, fall back to a live full compute.
// Exported so the cron warmer can call it directly (no HTTP / no auth needed).
export async function getTeepCached(uAfter: number, uBefore: number): Promise<any> {
  const key = periodKey(uAfter, uBefore);

  // 1. Exact period-key cache (only trust it for COMPLETE results)
  const cached = await readTeepCache(key);
  if (cached) return cached;

  // 2. Assemble from day buckets
  try {
    const { result, complete } = await getTeepByDays(uAfter, uBefore);
    // 3. Cache complete ranges under the period key for instant repeat hits
    if (complete) await writeTeepCache(key, result);
    return result;
  } catch {
    // 4. Fallback: live full-range compute (Supabase down or day path failed)
    const fresh = await computeTeep(uAfter, uBefore);
    await writeTeepCache(key, fresh);
    return fresh;
  }
}

// ── Cron helper: compute & cache yesterday's single day bucket ────────────
export async function warmYesterdayDay(): Promise<void> {
  const dhakaNow = new Date(Date.now() + 6 * 3600 * 1000);
  const y = new Date(Date.UTC(
    dhakaNow.getUTCFullYear(), dhakaNow.getUTCMonth(), dhakaNow.getUTCDate() - 1
  )).toISOString().slice(0, 10);
  await computeAndCacheDay(y);
}

// ── Default precompute windows (used by the cron warmer) ──────────────────
// All windows END YESTERDAY in +06 (Dhaka), since we never view today.
// Returns unix-second [after, before] pairs for: yesterday (1d), last 7d, last 30d.
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

    // Default (no params) = last 7 completed days ending yesterday, matching the
    // cron's "last7" window so the default view is always a pre-warmed cache hit.
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
