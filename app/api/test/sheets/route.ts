import { getKPIData, getTasksData } from "@/lib/sheets";
// TODO: Re-enable session check after org approval
// import { getServerSession } from "next-auth";
// import { authOptions } from "@/lib/auth";

export async function GET() {
  // Temporarily allow unauthenticated access for testing
  // const session = await getServerSession(authOptions);
  // if (!session) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  // }

  try {
    const [kpiData, tasksData] = await Promise.all([getKPIData(), getTasksData()]);

    return new Response(
      JSON.stringify({
        success: true,
        kpi: kpiData,
        tasks: tasksData,
      }),
      { status: 200 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Sheet access error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
