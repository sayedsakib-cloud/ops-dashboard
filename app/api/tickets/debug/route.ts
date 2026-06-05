import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const INBOX: Record<string, string> = { cr: "6547584", bizops: "8314220" };

async function search(token: string, endpoint: string, body: object) {
  const res = await fetch(`https://api.intercom.io/${endpoint}`, {
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

    const token   = process.env.INTERCOM_ACCESS_TOKEN!;   // ← fixed env var name
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section") ?? "cr";
    const inboxId = INBOX[section];
    const now = Math.floor(Date.now() / 1000);
    const d90 = now - 90 * 86400;                    // wider window to catch data

    const summarise = (data: any, itemKey: string) => {
      const items = data[itemKey] ?? data.data ?? [];
      return {
        total_count: data.total_count ?? items.length,
        errors:      data.errors ?? null,
        sample: items.slice(0, 3).map((c: any) => ({
          id:               c.id,
          ticket_state:     c.ticket_state ?? c.state,
          team_assignee_id: c.team_assignee_id,
          admin_assignee_id:c.admin_assignee_id,
          assignee_name:    c.assignee?.name ?? null,
          ticket_type:      c.ticket_type?.name ?? null,
          created_at:       c.created_at,
          updated_at:       c.updated_at,
          open:             c.open,
        })),
      };
    };

    // Test A — Tickets with team filter (integer ID)
    const ticketsWithTeam = await search(token, "tickets/search", {
      query: { operator: "AND", value: [
        { field: "team_assignee_id", operator: "=", value: parseInt(inboxId) }, // integer
        { field: "created_at",       operator: ">", value: d90 },
      ]},
      pagination: { per_page: 3 },
    });

    // Test B — Tickets without team filter
    const ticketsNoTeam = await search(token, "tickets/search", {
      query: { operator: "AND", value: [
        { field: "created_at", operator: ">", value: d90 },
      ]},
      pagination: { per_page: 3 },
    });

    // Test C — Conversations without filter (sanity check)
    const convsNoFilter = await search(token, "conversations/search", {
      query: { operator: "AND", value: [
        { field: "created_at", operator: ">", value: d90 },
      ]},
      pagination: { per_page: 3 },
    });

    return NextResponse.json({
      inbox_id: inboxId,
      section,
      env_var_present:                  !!token,
      tickets_WITH_team_filter:         summarise(ticketsWithTeam, "tickets"),
      tickets_WITHOUT_team_filter:      summarise(ticketsNoTeam,   "tickets"),
      conversations_without_filter:     summarise(convsNoFilter,   "conversations"),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
