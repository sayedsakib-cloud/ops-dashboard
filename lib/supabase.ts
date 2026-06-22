import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only client (service role). Returns null when env is missing, so every
// helper degrades gracefully and the route falls back to a live compute.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null | undefined;
function client(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  _client = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
    : null;
  return _client;
}

// ── Diagnostics ────────────────────────────────────────────────────────────
// These do NOT swallow errors -- they report them, so we can see exactly why
// the cache is (or isn't) working in production instead of failing silently.
export function supabaseEnvPresent() {
  return {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_KEY,
  };
}

// Probes each table for read + write access and returns the precise error.
// A "__healthcheck__" probe row is written then deleted, so it leaves no trace.
export async function supabaseHealthcheck() {
  const c = client();
  if (!c) return { connected: false, reason: "env-missing", tables: {} as Record<string, unknown> };

  const probes: Array<{ name: string; pk: string; row: Record<string, unknown> }> = [
    { name: "teep_cache", pk: "period_key",
      row: { period_key: "__healthcheck__", result: { ok: true }, computed_at: new Date().toISOString() } },
    { name: "teep_base", pk: "period_key",
      row: { period_key: "__healthcheck__", base: { ok: true }, created_at: new Date().toISOString() } },
    { name: "teep_conv", pk: "conv_id",
      row: { conv_id: "__healthcheck__", closes: [], cached_at: new Date().toISOString() } },
  ];

  const tables: Record<string, { read: unknown; write: unknown }> = {};
  for (const p of probes) {
    const entry: { read: unknown; write: unknown } = { read: null, write: null };
    try {
      const { error, count } = await c.from(p.name).select("*", { count: "exact", head: true });
      entry.read = error ? { ok: false, error: error.message } : { ok: true, rows: count ?? 0 };
    } catch (e) {
      entry.read = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      const { error } = await c.from(p.name).upsert(p.row);
      entry.write = error ? { ok: false, error: error.message } : { ok: true };
      if (!error) await c.from(p.name).delete().eq(p.pk, "__healthcheck__");
    } catch (e) {
      entry.write = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    tables[p.name] = entry;
  }
  return { connected: true, tables };
}

// Definitive persistence test: write a known value to teep_conv, read it back,
// compare, then delete. "persisted: true" proves writes actually land (catches
// the case where upsert returns no error but RLS silently drops the row).
export async function supabaseRoundtrip() {
  const c = client();
  if (!c) return { ok: false, reason: "env-missing" };
  const probe = { conv_id: "__roundtrip__", closes: [{ adminId: "rt", closedAt: 4242 }], cached_at: new Date().toISOString() };
  try {
    const { error: wErr } = await c.from("teep_conv").upsert(probe);
    if (wErr) return { ok: false, stage: "write", error: wErr.message };
    const { data, error: rErr } = await c
      .from("teep_conv").select("closes").eq("conv_id", "__roundtrip__").maybeSingle();
    if (rErr) return { ok: false, stage: "read", error: rErr.message };
    const persisted = !!(data && Array.isArray(data.closes) && data.closes[0]?.closedAt === 4242);
    await c.from("teep_conv").delete().eq("conv_id", "__roundtrip__");
    return { ok: persisted, persisted, readBack: data?.closes ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── teep_cache: finished results per period_key ────────────────────────────
export async function readTeepCache(key: string): Promise<any | null> {
  const c = client(); if (!c) return null;
  try {
    const { data, error } = await c
      .from("teep_cache").select("result").eq("period_key", key).maybeSingle();
    if (error || !data) return null;
    return data.result ?? null;
  } catch { return null; }
}
export async function writeTeepCache(key: string, result: any): Promise<void> {
  const c = client(); if (!c) return;
  try {
    await c.from("teep_cache").upsert({
      period_key: key, result, computed_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}

// ── teep_base: in-progress base (search + Pass 1/2) per period_key ─────────
export async function readTeepBase(key: string): Promise<any | null> {
  const c = client(); if (!c) return null;
  try {
    const { data, error } = await c
      .from("teep_base").select("base").eq("period_key", key).maybeSingle();
    if (error || !data) return null;
    return data.base ?? null;
  } catch { return null; }
}
export async function writeTeepBase(key: string, base: any): Promise<void> {
  const c = client(); if (!c) return;
  try {
    await c.from("teep_base").upsert({
      period_key: key, base, created_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}

// ── teep_conv: per-conversation close events (immutable once closed) ───────
export async function readTeepConvs(
  ids: string[],
): Promise<Record<string, Array<{ adminId: string; closedAt: number }>>> {
  const c = client(); if (!c || ids.length === 0) return {};
  const out: Record<string, Array<{ adminId: string; closedAt: number }>> = {};
  try {
    const CHUNK = 300; // keep each .in() filter well under URL/row limits
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data, error } = await c
        .from("teep_conv").select("conv_id, closes").in("conv_id", slice);
      if (error || !data) continue;
      for (const row of data) out[row.conv_id] = row.closes ?? [];
    }
  } catch { /* ignore */ }
  return out;
}
export async function writeTeepConvs(
  records: Array<{ convId: string; closes: any }>,
): Promise<void> {
  const c = client(); if (!c || records.length === 0) return;
  try {
    const now = new Date().toISOString();
    const rows = records.map(r => ({ conv_id: r.convId, closes: r.closes, cached_at: now }));
    await c.from("teep_conv").upsert(rows);
  } catch { /* ignore */ }
}

// ── teep_day: LEGACY (no longer used by the route). Kept for compatibility. ─
export async function readTeepDays(days: string[]): Promise<Record<string, any>> {
  const c = client(); if (!c || days.length === 0) return {};
  const out: Record<string, any> = {};
  try {
    const { data, error } = await c
      .from("teep_day").select("day, payload").in("day", days);
    if (!error && data) for (const row of data) out[row.day] = row.payload;
  } catch { /* ignore */ }
  return out;
}
export async function writeTeepDay(day: string, payload: any): Promise<void> {
  const c = client(); if (!c) return;
  try {
    await c.from("teep_day").upsert({
      day, payload, computed_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}
