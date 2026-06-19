import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client. Uses the service_role key, so this module must
// NEVER be imported into client components. The service_role key bypasses RLS
// and must stay on the server.

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // not configured -> callers fall back to live compute
  if (_client) return _client;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

const TABLE = "teep_cache";

// Read a cached TEEP result by its period key. Returns null on miss or any error
// (so the route can fall back to a live compute rather than failing).
export async function readTeepCache(periodKey: string): Promise<unknown | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from(TABLE)
      .select("result")
      .eq("period_key", periodKey)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { result: unknown }).result;
  } catch {
    return null;
  }
}

// Upsert (insert or overwrite) a computed TEEP result for a period key.
// Rewrites the single row for that period -- never appends duplicates.
export async function writeTeepCache(periodKey: string, result: unknown): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client
      .from(TABLE)
      .upsert(
        { period_key: periodKey, result, computed_at: new Date().toISOString() },
        { onConflict: "period_key" }
      );
  } catch {
    // Non-fatal: if the write fails, the result was still returned to the user.
  }
}

// True when Supabase env is present (used to decide whether caching is active).
export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
