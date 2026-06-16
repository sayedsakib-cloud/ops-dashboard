import { NextResponse } from "next/server";

// This route is called by Vercel Cron every 10 minutes.
// It pre-fetches the default TEEP and Tickets endpoints so the
// unstable_cache is always warm — users never hit a cold start.
//
// Vercel Cron sends a request with the Authorization header containing
// CRON_SECRET. Add that to your Vercel env vars.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Security: only allow Vercel Cron requests
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://ops-dashboard-seven-iota.vercel.app";

  const endpoints = [
    `${base}/api/teep`,
    `${base}/api/tickets?section=cr`,
    `${base}/api/tickets?section=bizops`,
  ];

  const results: Record<string, string> = {};

  await Promise.all(
    endpoints.map(async (url) => {
      const key = url.replace(base, "");
      try {
        const res = await fetch(url, { headers: { "x-internal-warm": "1" } });
        results[key] = res.ok ? `ok (${res.status})` : `error (${res.status})`;
      } catch (e) {
        results[key] = `failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    })
  );
  
  return NextResponse.json({ warmed: results, at: new Date().toISOString() });
}
