import { NextResponse }    from "next/server";
import { getServerSession } from "next-auth";
import { authOptions }      from "@/lib/auth";

const INTERCOM_API = "https://api.intercom.io";

const TEEP_AGENT_NAMES = [
  "john ferguson", "camellia warren", "anna linhart",
  "nina sterling", "eliana zahra", "natalie carter",
  "liam wilson",   "joshua o'brian", "allison peiris",
  "grace morgan",  "rosie dunn",     "samael",
];

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const token = process.env.INTERCOM_ACCESS_TOKEN!;
    const now   = Math.floor(Date.now() / 1000);
    const d7    = now - 7 * 86400;

    // ── 1. Fetch ALL teams ─────────────────────────────────────────────────
    const teamsRes  = await fetch(`${INTERCOM_API}/teams`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
    });
    const teamsData = await teamsRes.json();
    const allTeams  = (teamsData.teams ?? []) as any[];
    const crTeams   = allTeams.filter(t => (t.name ?? "").startsWith("CR"));

    // ── 2. Fetch ALL admins ────────────────────────────────────────────────
    const adminsRes  = await fetch(`${INTERCOM_API}/admins`, {
      headers: { Authorization: `Bearer ${token}`, "Intercom-Version": "2.11" },
    });
    const adminsData = await adminsRes.json();
    const allAdmins  = (adminsData.admins ?? []) as any[];

    // Which admins match TEEP names?
    const matchedAdmins = allAdmins.filter(a =>
      TEEP_AGENT_NAMES.some(n =>
        (a.name ?? "").toLowerCase().includes(n) ||
        n.includes((a.name ?? "").toLowerCase())
      )
    ).map(a => ({ id: a.id, name: a.name, email: a.email }));

    // ── 3. Try conversation search WITHOUT team filter ─────────────────────
    const testBody = {
      query: {
        operator: "AND",
        value: [
          { field: "source.type", operator: "=", value: "email" },
          { field: "created_at",  operator: ">", value: d7      },
        ],
      },
      pagination: { per_page: 3 },
    };

    const convNoTeamRes  = await fetch(`${INTERCOM_API}/conversations/search`, {
      method: "POST",
      headers: {
        Authorization:      `Bearer ${token}`,
        "Content-Type":     "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify(testBody),
    });
    const convNoTeam = await convNoTeamRes.json();

    // ── 4. Try conversation search WITH first CR team (if any) ─────────────
    let convWithTeam: any = null;
    if (crTeams.length > 0) {
      const withTeamBody = {
        query: {
          operator: "AND",
          value: [
            { field: "source.type",      operator: "=", value: "email"                  },
            { field: "team_assignee_id", operator: "=", value: parseInt(crTeams[0].id)  },
            { field: "created_at",       operator: ">", value: d7                       },
          ],
        },
        pagination: { per_page: 3 },
      };
      const r = await fetch(`${INTERCOM_API}/conversations/search`, {
        method: "POST",
        headers: {
          Authorization:      `Bearer ${token}`,
          "Content-Type":     "application/json",
          "Intercom-Version": "2.11",
        },
        body: JSON.stringify(withTeamBody),
      });
      convWithTeam = await r.json();
    }

    // ── 5. Try ALL conversations (no source filter) ────────────────────────
    const anyConvRes = await fetch(`${INTERCOM_API}/conversations/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify({
        query: { operator: "AND", value: [
          { field: "created_at", operator: ">", value: d7 },
        ]},
        pagination: { per_page: 3 },
      }),
    });
    const anyConv = await anyConvRes.json();

    return NextResponse.json({
      // STEP 1: Teams
      teams_total:     allTeams.length,
      teams_starting_CR: crTeams.map(t => ({ id: t.id, name: t.name })),

      // STEP 2: Admins
      admins_total:    allAdmins.length,
      admins_matched:  matchedAdmins,
      admins_all_names: allAdmins.map(a => ({ id: a.id, name: a.name })),

      // STEP 3: Conversations (no team filter, email only, last 7 days)
      conv_no_team_filter: {
        total: convNoTeam.total_count ?? 0,
        errors: convNoTeam.errors ?? null,
        sample: (convNoTeam.conversations ?? []).slice(0, 3).map((c: any) => ({
          id:              c.id,
          source_type:     c.source?.type,
          team_assignee_id: c.team_assignee_id,
          assignee_name:   c.assignee?.name,
          state:           c.state,
          created_at:      c.created_at,
        })),
      },

      // STEP 4: Conversations (with first CR team)
      conv_with_first_cr_team: crTeams.length > 0 ? {
        team_used: crTeams[0],
        total: convWithTeam?.total_count ?? 0,
        errors: convWithTeam?.errors ?? null,
        sample: (convWithTeam?.conversations ?? []).slice(0, 2).map((c: any) => ({
          id:              c.id,
          source_type:     c.source?.type,
          team_assignee_id: c.team_assignee_id,
          assignee_name:   c.assignee?.name,
          state:           c.state,
        })),
      } : "No CR teams found",

      // STEP 5: Any conversations (no filters)
      conv_any_last_7_days: {
        total: anyConv.total_count ?? 0,
        sample: (anyConv.conversations ?? []).slice(0, 3).map((c: any) => ({
          id:               c.id,
          source_type:      c.source?.type,
          team_assignee_id: c.team_assignee_id,
          assignee_name:    c.assignee?.name,
          state:            c.state,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
