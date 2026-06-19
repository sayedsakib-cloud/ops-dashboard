import { NextResponse } from "next/server";
import { getTeepCached, warmYesterdayDay } from "@/app/api/teep/route";

// Called by Vercel Cron once daily (2 AM UTC = 8 AM Dhaka). Computes YESTERDAY's
// single day-bucket (fast, well within the 60s limit) and writes it to Supabase.
// Over time the day buckets accumulate, so any range (week/month/quarter) is
// assembled instantly by summing cached days -- no truncation, no double-count.
//
// It then warms the common default ranges (last 7 / last 30) which, because the
// days are now cached, assemble in milliseconds.
//
// Called DIRECTLY (same process) -- no HTTP, so it bypasses auth middleware.

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby plan max

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // 1. The important nightly task: compute yesterday's day bucket.
  try {
    const t0 = Date.now();
    await warmYesterdayDay();
    results["yesterday-day"] = `ok (${Math.round((Date.now() - t0) / 1000)}s)`;
  } catch (e) {
    results["yesterday-day"] = `failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 2. Warm common ranges (assemble from now-cached days -- should be fast).
  for (const w of [{ label: "last7", days: 7 }, { label: "last30", days: 30 }]) {
    try {
      const t0 = Date.now();
      const { uAfter, uBefore } = rangeEndingYesterday(w.days);
      await getTeepCached(uAfter, uBefore);
      results[w.label] = `ok (${Math.round((Date.now() - t0) / 1000)}s)`;
    } catch (e) {
      results[w.label] = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ warmed: results, at: new Date().toISOString() });
}

// Range of `days` ending yesterday (Dhaka), as unix-second bounds.
function rangeEndingYesterday(days: number): { uAfter: number; uBefore: number } {
  const dhakaNow = new Date(Date.now() + 6 * 3600 * 1000);
  const Y = dhakaNow.getUTCFullYear(), M = dhakaNow.getUTCMonth(), D = dhakaNow.getUTCDate();
  const startStr = new Date(Date.UTC(Y, M, D - days)).toISOString().slice(0, 10);
  const endStr   = new Date(Date.UTC(Y, M, D - 1)).toISOString().slice(0, 10);
  return {
    uAfter:  Math.floor(new Date(startStr + "T00:00:00+06:00").getTime() / 1000),
    uBefore: Math.floor(new Date(endStr   + "T23:59:59+06:00").getTime() / 1000),
  };
}
