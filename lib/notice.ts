// lib/notice.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null | undefined;
function client(): SupabaseClient {
  if (_client === undefined) {
    _client = (SUPABASE_URL && SUPABASE_KEY)
      ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
      : null;
  }
  if (!_client) throw new Error("Supabase not configured");
  return _client;
}

export type Attachment = { type: "image" | "link"; url: string; label?: string };
export type Notice = {
  id: string; title: string; description: string; tags: string[];
  attachments: Attachment[]; authorName: string; authorEmail: string;
  createdAt: string; likeCount: number; likedByMe: boolean;
};

type NoticeRow = {
  id: string; title: string; description: string; tags: string[];
  attachments: Attachment[]; author_name: string; author_email: string;
  created_at: string;
};

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean)));
}

export async function listNotices(opts: {
  keyword?: string; from?: string; to?: string; tags?: string[];
  cursor?: { createdAt: string; id: string } | null;
  viewerEmail: string; limit?: number;
}): Promise<{ items: Notice[]; nextCursor: { createdAt: string; id: string } | null }> {
  const c = client();
  const limit = opts.limit ?? 20;

  let query = c.from("notices").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);

  if (opts.keyword) query = query.or(`title.ilike.%${opts.keyword}%,description.ilike.%${opts.keyword}%`);
  if (opts.from) query = query.gte("created_at", opts.from);
  if (opts.to) query = query.lte("created_at", opts.to);
  if (opts.tags && opts.tags.length > 0) query = query.overlaps("tags", normalizeTags(opts.tags));
  if (opts.cursor) {
    query = query.or(
      `created_at.lt.${opts.cursor.createdAt},and(created_at.eq.${opts.cursor.createdAt},id.lt.${opts.cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error("notices select: " + error.message);
  const rows = (data ?? []) as NoticeRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map(r => r.id);

  const likeCounts: Record<string, number> = {};
  const likedSet = new Set<string>();
  if (ids.length > 0) {
    const { data: likeRows, error: likeErr } = await c
      .from("notice_likes").select("notice_id, user_email").in("notice_id", ids);
    if (likeErr) throw new Error("notice_likes select: " + likeErr.message);
    for (const row of likeRows ?? []) {
      likeCounts[row.notice_id] = (likeCounts[row.notice_id] ?? 0) + 1;
      if (row.user_email === opts.viewerEmail) likedSet.add(row.notice_id);
    }
  }

  const items: Notice[] = page.map(r => ({
    id: r.id, title: r.title, description: r.description, tags: r.tags,
    attachments: r.attachments, authorName: r.author_name, authorEmail: r.author_email,
    createdAt: r.created_at, likeCount: likeCounts[r.id] ?? 0, likedByMe: likedSet.has(r.id),
  }));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { createdAt: last.created_at, id: last.id } : null;

  return { items, nextCursor };
}

export async function createNotice(input: {
  title: string; description: string; tags: string[]; attachments: Attachment[];
  authorName: string; authorEmail: string;
}): Promise<Notice> {
  const c = client();
  const { data, error } = await c.from("notices").insert({
    title: input.title,
    description: input.description,
    tags: normalizeTags(input.tags),
    attachments: input.attachments,
    author_name: input.authorName,
    author_email: input.authorEmail,
  }).select("*").single();
  if (error) throw new Error("notices insert: " + error.message);
  const row = data as NoticeRow;
  return {
    id: row.id, title: row.title, description: row.description, tags: row.tags,
    attachments: row.attachments, authorName: row.author_name, authorEmail: row.author_email,
    createdAt: row.created_at, likeCount: 0, likedByMe: false,
  };
}

export async function deleteNotice(id: string, requesterEmail: string): Promise<{ ok: boolean; reason?: "not-found" | "forbidden" }> {
  const c = client();
  const { data, error } = await c.from("notices").select("author_email").eq("id", id).maybeSingle();
  if (error) throw new Error("notices select: " + error.message);
  if (!data) return { ok: false, reason: "not-found" };
  if (data.author_email !== requesterEmail) return { ok: false, reason: "forbidden" };
  const { error: delErr } = await c.from("notices").delete().eq("id", id);
  if (delErr) throw new Error("notices delete: " + delErr.message);
  return { ok: true };
}

export async function toggleLike(noticeId: string, userEmail: string, userName: string): Promise<{ liked: boolean; likeCount: number }> {
  const c = client();
  const { data: existing, error: selErr } = await c
    .from("notice_likes").select("notice_id").eq("notice_id", noticeId).eq("user_email", userEmail).maybeSingle();
  if (selErr) throw new Error("notice_likes select: " + selErr.message);

  if (existing) {
    const { error } = await c.from("notice_likes").delete().eq("notice_id", noticeId).eq("user_email", userEmail);
    if (error) throw new Error("notice_likes delete: " + error.message);
  } else {
    const { error } = await c.from("notice_likes").insert({ notice_id: noticeId, user_email: userEmail, user_name: userName });
    if (error) throw new Error("notice_likes insert: " + error.message);
  }

  const { count, error: countErr } = await c
    .from("notice_likes").select("*", { count: "exact", head: true }).eq("notice_id", noticeId);
  if (countErr) throw new Error("notice_likes count: " + countErr.message);

  return { liked: !existing, likeCount: count ?? 0 };
}

export async function listLikers(noticeId: string): Promise<{ userEmail: string; userName: string }[]> {
  const c = client();
  const { data, error } = await c
    .from("notice_likes").select("user_email, user_name").eq("notice_id", noticeId).order("created_at", { ascending: false });
  if (error) throw new Error("notice_likes select: " + error.message);
  return (data ?? []).map(r => ({ userEmail: r.user_email, userName: r.user_name }));
}
