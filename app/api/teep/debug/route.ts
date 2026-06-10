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
      // STEP 5: Conversations updated (not created) in last 7 days — email, first CR team
      conv_updated_in_period: await (async () => {
        const b = {
          query: {
            operator: "AND",
            value: [
              { field: "source.type", operator: "=", value: "email"       },
              { field: "team_assignee_id", operator: "=", value: 6813596  },
              { field: "updated_at",  operator: ">", value: d7            },
            ],
          },
          pagination: { per_page: 3 },
        };
        const r = await fetch(`${INTERCOM_API}/conversations/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Intercom-Version": "2.11" },
          body: JSON.stringify(b),
        });
        const d = await r.json();
        return {
          total: d.total_count ?? 0,
          sample: (d.conversations ?? []).slice(0, 3).map((c: any) => ({
            id:              c.id,
            state:           c.state,
            created_at:      c.created_at,
            updated_at:      c.updated_at,
            assignee_type:   c.assignee?.type,
            assignee_id:     c.assignee?.id,
            assignee_name:   c.assignee?.name,
          })),
        };
      })(),

      // STEP 6: Search by admin_assignee_id for Samael, no date filter
      conv_samael_no_date: await (async () => {
        const b = {
          query: {
            operator: "AND",
            value: [
              { field: "source.type",       operator: "=", value: "email"   },
              { field: "admin_assignee_id",  operator: "=", value: 6609254  },
            ],
          },
          pagination: { per_page: 3 },
        };
        const r = await fetch(`${INTERCOM_API}/conversations/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Intercom-Version": "2.11" },
          body: JSON.stringify(b),
        });
        const d = await r.json();
        return {
          total: d.total_count ?? 0,
          errors: d.errors ?? null,
          sample: (d.conversations ?? []).slice(0, 3).map((c: any) => ({
            id:            c.id,
            state:         c.state,
            created_at:    c.created_at,
            updated_at:    c.updated_at,
            assignee_type: c.assignee?.type,
            assignee_id:   c.assignee?.id,
          })),
        };
      })(),

      // STEP 8: CLOSED convs in first CR team — does assignee come back?
      conv_closed_with_assignee: await (async () => {
        const b = {
          query: {
            operator: "AND",
            value: [
              { field: "source.type",      operator: "=", value: "email"    },
              { field: "team_assignee_id", operator: "=", value: 6813596    },
              { field: "state",            operator: "=", value: "closed"   },
              { field: "updated_at",       operator: ">", value: d7         },
            ],
          },
          pagination: { per_page: 5 },
        };
        const r = await fetch(`${INTERCOM_API}/conversations/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Intercom-Version": "2.11" },
          body: JSON.stringify(b),
        });
        const d = await r.json();
        return {
          total: d.total_count ?? 0,
          sample: (d.conversations ?? []).slice(0, 5).map((c: any) => ({
            id:                  c.id,
            state:               c.state,
            // top-level separate fields (like team_assignee_id)
            admin_assignee_id:   c.admin_assignee_id,    // ← KEY TEST
            team_assignee_id:    c.team_assignee_id,
            // nested object (not returned in search results usually)
            assignee_obj_type:   c.assignee?.type,
            assignee_obj_id:     c.assignee?.id,
            // all top-level keys to see everything returned
            all_keys:            Object.keys(c),
            updated_at:          c.updated_at,
            stats_last_close:    c.statistics?.last_close_at,
            stats_admin_reply:   c.statistics?.time_to_admin_reply,
          })),
        };
      })(),

      // STEP 7: Any conversations (no filters)
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
