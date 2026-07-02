import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const CLICKUP_V3 = "https://api.clickup.com/api/v3";
const CLICKUP_V2 = "https://api.clickup.com/api/v2";
const WORKSPACE_ID = process.env.CLICKUP_WORKSPACE_ID ?? "3480971";
const CHANNEL_ID   = process.env.CLICKUP_CHANNEL_ID ?? "3a7cb-362458";
const TOKEN        = process.env.CLICKUP_API_TOKEN ?? "pk_48287545_6RHQ5A3CZ00GEB3Y9XWK4N4CMOK4L0HH";

type FeedMessage = {
  id: string;
  content: string;
  date: number;
  authorName: string;
  authorAvatar: string | null;
  authorInitials: string;
  authorColor: string | null;
};

type Member = { name: string; avatar: string | null; initials: string; color: string | null };

async function cuFetch(base: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: { Authorization: TOKEN, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${text.slice(0, 300)}`);
  return json;
}

// workspace members: id -> {name, avatar, initials, color}
const getMembersCached = unstable_cache(
  async (): Promise<Record<string, Member>> => {
    const map: Record<string, Member> = {};
    try {
      const j = await cuFetch(CLICKUP_V2, `/team`);
      const teams: any[] = j?.teams ?? [];
      const team = teams.find((t: any) => String(t?.id) === String(WORKSPACE_ID)) ?? teams[0];
      for (const mem of (team?.members ?? [])) {
        const u = mem?.user ?? mem;
        if (u?.id == null) continue;
        const name = u.username ?? u.email ?? `User ${u.id}`;
        map[String(u.id)] = {
          name: String(name),
          avatar: u.profilePicture ?? null,
          initials: u.initials ?? String(name).split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase(),
          color: u.color ?? null,
        };
      }
    } catch (e) {
      console.error("clickup members fetch failed:", (e as any)?.message);
    }
    return map;
  },
  ["clickup-members", WORKSPACE_ID],
  { revalidate: 86400 },
);

function pickUserId(m: any): string {
  return String(
    m?.userid ?? m?.user_id ?? m?.user?.id ?? m?.author?.id ??
    m?.created_by ?? m?.created_by_id ?? "",
  );
}

function normalizeMessage(m: any, members: Record<string, Member>): FeedMessage {
  const inline = m?.user ?? m?.author ?? {};
  const uid = pickUserId(m);
  const mem = uid ? members[uid] : undefined;

  const name =
    inline?.username ?? inline?.name ?? inline?.display_name ??
    mem?.name ?? inline?.email ?? (uid ? `User ${uid}` : "Team member");
  const rawDate = m?.date ?? m?.date_created ?? m?.created_at ?? m?.ts ?? 0;
  const date = typeof rawDate === "string" ? parseInt(rawDate, 10) || 0 : Number(rawDate) || 0;
  const initials =
    inline?.initials ?? mem?.initials ??
    String(name).split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();

  return {
    id: String(m?.id ?? m?.message_id ?? crypto.randomUUID()),
    content: String(m?.content ?? m?.text ?? m?.message ?? m?.comment_text ?? ""),
    date,
    authorName: String(name),
    authorAvatar: inline?.profilePicture ?? inline?.avatar ?? mem?.avatar ?? null,
    authorInitials: initials || "?",
    authorColor: inline?.color ?? mem?.color ?? null,
  };
}

const getFeedCached = unstable_cache(
  async (): Promise<FeedMessage[]> => {
    const [j, members] = await Promise.all([
      cuFetch(CLICKUP_V3, `/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
        { limit: "50", content_format: "text/md" }),
      getMembersCached(),
    ]);
    const arr: any[] = j?.data ?? j?.messages ?? (Array.isArray(j) ? j : []);
    const msgs = arr.map(m => normalizeMessage(m, members)).filter(m => m.content.trim().length > 0);
    msgs.sort((a, b) => b.date - a.date);
    return msgs;
  },
  ["clickup-ops-feed-v2", WORKSPACE_ID, CHANNEL_ID],
  { revalidate: 86400 },
);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!TOKEN) return NextResponse.json({ error: "CLICKUP_API_TOKEN not set" }, { status: 500 });

  const url = new URL(req.url);
  try {
    if (url.searchParams.get("channels") === "1") {
      const j = await cuFetch(CLICKUP_V3, `/workspaces/${WORKSPACE_ID}/chat/channels`, { limit: "100" });
      const arr: any[] = j?.data ?? j?.channels ?? (Array.isArray(j) ? j : []);
      return NextResponse.json(arr.map((c: any) => ({ id: c?.id, name: c?.name ?? c?.title })));
    }
    if (url.searchParams.get("members") === "1") {
      return NextResponse.json(await getMembersCached());
    }
    if (url.searchParams.get("debug") === "1") {
      const j = await cuFetch(CLICKUP_V3, `/workspaces/${WORKSPACE_ID}/chat/channels/${CHANNEL_ID}/messages`,
        { limit: "2", content_format: "text/md" });
      return NextResponse.json({ raw: j });
    }
    const messages = await getFeedCached();
    return NextResponse.json({ channelId: CHANNEL_ID, count: messages.length, messages });
  } catch (err: any) {
    console.error("clickup-feed error:", err?.message ?? err);
    return NextResponse.json({ error: String(err?.message ?? "Something went wrong") }, { status: 502 });
  }
}
