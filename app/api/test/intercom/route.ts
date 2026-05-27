import { getAllInboxCounts } from "@/lib/intercom";

export async function GET() {
  // Temporarily allow unauthenticated access for testing
  // import { getServerSession } from "next-auth";
  // import { authOptions } from "@/lib/auth";
  // const session = await getServerSession(authOptions);
  // if (!session) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  // }

  if (!process.env.INTERCOM_API_KEY) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_KEY not set in env" }), { status: 500 });
  }

  try {
    const inboxes = await getAllInboxCounts();
    return new Response(JSON.stringify({ success: true, inboxes }), { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Intercom API error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
