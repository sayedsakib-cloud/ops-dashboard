import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { teepHourly, teepAgents } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Dhaka day boundaries -> unix -> ISO (UTC) for the RPC.
function dhakaBounds(from: string, to: string) {
  const startIso = new Date(`${from}T00:00:00+06:00`).toISOString();
  // inclusive end day -> add a day to the "to" date
  const endUnix = new Date(`${to}T00:00:00+06:00`).getTime() + 24 * 3600 * 1000;
  const endIso = new Date(endUnix).toISOString();
  return { startIso, endIso };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const agent = url.searchParams.get("agent"); // admin_id or null

    // Default range = yesterday (Dhaka).
    const now = new Date(Date.now() + 6 * 3600 * 1000); // shift to Dhaka
    const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const from = url.searchParams.get("from") || ymd(y);
    const to   = url.searchParams.get("to")   || from;

    const { startIso, endIso } = dhakaBounds(from, to);
    const [grid, agents] = await Promise.all([
      teepHourly(startIso, endIso, agent),
      teepAgents(),
    ]);

    agents.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ from, to, agent: agent ?? null, grid, agents });
  } catch (err: any) {
    console.error("teep/hourly error:", err?.message ?? err);
    return NextResponse.json({ error: String(err?.message ?? "Something went wrong") }, { status: 500 });
  }
}
