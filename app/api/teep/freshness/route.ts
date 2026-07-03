import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { teepLastSync } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { updatedAt } = await teepLastSync();
    const ageMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : null;
    const ageHours = ageMs != null ? ageMs / 3_600_000 : null;
    return NextResponse.json({ updatedAt, ageHours });
  } catch (err: any) {
    console.error("teep/freshness error:", err?.message ?? err);
    return NextResponse.json({ updatedAt: null, ageHours: null }, { status: 200 });
  }
}
