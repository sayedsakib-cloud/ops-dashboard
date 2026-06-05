import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const INBOX: Record<string, string> = { cr: "6547584", bizops: "8314220" };

async function intercomSearch(token: string, body: object) {
  const res = await fetch("https://api.intercom.io/conversations/search", {
    method: "POST",
    headers: {
      Authorization:      `Bearer ${token}`,
      "Content-Type":     "application/json",
      "Intercom-Version": "2.11",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const token   = process.env.INTERCOM_ACCESS_TOKEN!;
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section") ?? "cr";
    const inboxId = INBOX[section];

    const now = Math.floor(Date.now() / 1000);
    const d7  = now - 7 * 86400;

    // Test A: With team_assignee_id filter
    const testA = await intercomSearch(token, {
      query: {
        operator: "AND",
        value: [
          { field: "team_assignee_id", operator: "=", value: inboxId },
          { field: "created_at",       operator: ">", value: d7      },
        ],
      },
      pagination: { per_page: 3 },
    });

    // Test B: Without team filter (last 7 days)
    const testB = await intercomSearch(token, {
      query: {
        operator: "AND",
        value: [{ field: "created_at", operator: ">", value: d7 }],
      },
      pagination: { per_page: 3 },
    });

    const summarise = (data: any) => ({
      total_count: data.total_count ?? data.conversations?.length ?? 0,
      errors:      data.errors ?? null,
      sample: (data.conversations ?? []).slice(0, 3).map((c: any) => ({
        id:                c.id,
        state:             c.state,
        team_assignee_id:  c.team_assignee_id,
        assignee_name:     c.assignee?.name ?? null,
        assignee_type:     c.assignee?.type ?? null,
        created_at:        c.created_at,
        first_close_at:    c.statistics?.first_close_at ?? null,
        time_to_close:     c.statistics?.time_to_first_close ?? null,
      })),
    });

    return NextResponse.json({
      inbox_id_tested: inboxId,
      section,
      test_A_with_team_filter:    summarise(testA),
      test_B_without_team_filter: summarise(testB),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
