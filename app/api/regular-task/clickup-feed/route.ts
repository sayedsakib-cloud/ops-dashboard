import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const CLICKUP_API = "https://api.clickup.com/api/v3";
const WORKSPACE_ID = process.env.CLICKUP_WORKSPACE_ID ?? "3480971";
const CHANNEL_ID   = process.env.CLICKUP_CHANNEL_ID ?? "3a7cb-362458";
const TOKEN        = process.env.CLICKUP_API_TOKEN ?? "pk_48287545_6RHQ5A3CZ00GEB3Y9XWK4N4CMOK4L0HH";

type FeedMessage = {
  id: string;
  content: string;         // markdown / text
  date: number;            // epoch ms
  authorName: string;
  authorAvatar: string | null;
  authorInitials: string;
  authorColor: string | null;
};

async function cuFetch(path: string, params?: Record<string, string>) {
  const url = new URL(`${CLICKUP_API}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: TOKEN, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (!r.ok) {
    throw new Error(`ClickUp ${r.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

// Defensive: ClickUp's experimental Chat API may key things a few ways.
function normalizeMessage(m: any): FeedMessage {
  const user = m?.user ?? m?.author ?? m?.created_by ?? {};
  const name =
    user?.username ?? user?.name ?? user?.display_name ??
    user?.email ?? (m?.userid ? `User ${m.userid}` : "Team member");
  const rawDate = m?.date ?? m?.date_created ?? m?.created_at ?? m?.ts ?? 0;
  const date = typeof rawDate === "string" ? parseInt(rawDate, 10) || 0 : Number(rawDate) || 0;
  const initials =
    user?.initials ??
    String(name).split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();
  return {
    id: String(m?.id ?? m?.message_id ?? crypto.randomUUID()),
    content: String(m?.content ?? m?.text ?? m?.message ?? m?.comment_text ?? ""),
    date,
    authorName: String(name),
    authorAvatar: user?.profilePicture ?? user?.avatar ?? user?.profile_picture ?? null,
    authorInitials: initials || "?",
    authorColor: user?.color ?? null,
  };
}

// Cached once per day (86400s). Returns newest-first.
const getFeedCached = unstable_cache(
  async (): Promise<FeedMessage[]> => {
    const j = await cuFetch(
      `/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
      { limit: "50", content_format: "text/md" },
    );
    const arr: any[] = j?.data ?? j?.messages ?? (Array.isArray(j) ? j : []);
    const msgs = arr.map(normalizeMessage).filter(m => m.content.trim().length > 0);
    msgs.sort((a, b) => b.date - a.date); // newest first
    return msgs;
  },
  ["clickup-ops-feed", WORKSPACE_ID, CHANNEL_ID],
  { revalidate: 86400 },
);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!TOKEN) {
    return NextResponse.json({ error: "CLICKUP_API_TOKEN not set" }, { status: 500 });
  }

  const url = new URL(req.url);

  try {
    // --- debug: list channels so we can confirm the right channel id/name ---
    if (url.searchParams.get("channels") === "1") {
      const j = await cuFetch(`/workspaces/${WORKSPACE_ID}/chat/channels`, { limit: "100" });
      const arr: any[] = j?.data ?? j?.channels ?? (Array.isArray(j) ? j : []);
      return NextResponse.json(
        arr.map((c: any) => ({ id: c?.id, name: c?.name ?? c?.title })),
      );
    }

    // --- debug: raw shape of the first messages (bypasses cache) ---
    if (url.searchParams.get("debug") === "1") {
      const j = await cuFetch(
        `/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
        { limit: "2", content_format: "text/md" },
      );
      return NextResponse.json({ raw: j });
    }

    const messages = await getFeedCached();
    return NextResponse.json({ channelId: CHANNEL_ID, count: messages.length, messages });
  } catch (err: any) {
    console.error("clickup-feed error:", err?.message ?? err);
    return NextResponse.json({ error: String(err?.message ?? "Something went wrong") }, { status: 502 });
  }
}
