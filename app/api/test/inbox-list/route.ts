import { getTeams } from "@/lib/intercom";

export async function GET() {
  try {
    const teamsRes = await getTeams();
    const teams = teamsRes.teams || [];

    // Format for easy reading - only show CR, BO, and other relevant teams
    const formattedTeams = teams
      .filter(
        (team: { name: string }) =>
          team.name.includes("CR") ||
          team.name.includes("Business Operations") ||
          team.name.includes("Case Resolution") ||
          team.name.includes("Platform Operations")
      )
      .map((team: { id: string; name: string }) => ({
        id: team.id,
        name: team.name,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        totalTeams: teams.length,
        relevantTeams: formattedTeams.length,
        teams: formattedTeams,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Inbox list error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
