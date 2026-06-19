import { NextResponse } from "next/server";
import { getTeepCached, defaultWindows } from "@/app/api/teep/route";

// Called by Vercel Cron once daily (2 AM UTC). Precomputes the common CLOSED
// TEEP windows (yesterday, last 7 days, last 30 days) and writes them to the
// Supabase cache, so the first human viewer of those periods gets an instant hit.
//
// We call getTeepCached() DIRECTLY (same process) rather than fetching /api/teep
// over HTTP -- that avoids the auth middleware entirely and is faster/cleaner.
// Closed periods never change, so once written they stay valid indefinitely.

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow up to 5 min for the cold computes

export async function GET(req: Request) {
  // Only allow Vercel Cron (or a caller holding CRON_SECRET).
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};
  const windows = defaultWindows();

  // Run sequentially -- each compute is heavy; parallel would hammer Intercom.
  for (const w of windows) {
    try {
      const t0 = Date.now();
      await getTeepCached(w.uAfter, w.uBefore);
      results[w.label] = `ok (${Math.round((Date.now() - t0) / 1000)}s)`;
    } catch (e) {
      results[w.label] = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ warmed: results, at: new Date().toISOString() });
}
