# Notice Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Notice" tab to ops-dashboard — a Facebook-style post feed (create post with title/description/tags/attachments, infinite-scroll feed, like/unlike with likers list, keyword+date+tag search) backed by Supabase.

**Architecture:** Client-rendered tab (`"use client"`) following the existing per-tab state-isolation pattern (`TicketsTab`/`KPITab`). Data lives in two new Supabase tables (`notices`, `notice_likes`). Five new API routes under `app/api/notice/**` do all reads/writes server-side using the existing service-role Supabase client. Fetch-on-demand filtering + cursor-based infinite scroll (no client-side re-filtering of already-loaded data).

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (`@supabase/supabase-js`), NextAuth (session-based identity), shadcn/ui + Tailwind, `radix-ui` (Dialog primitive), `lucide-react` icons.

## Global Constraints

- Run `npx tsc --noEmit` and `npx next build` before every commit that touches `.ts`/`.tsx` — both must pass (AGENTS.md).
- Secrets only via `process.env` — never hard-code tokens/keys (AGENTS.md).
- `route.ts` files are API-only, no JSX (AGENTS.md).
- Author identity always comes from the NextAuth session (`getServerSession(authOptions)`), never from client-supplied name/email fields.
- Tags are lowercased + trimmed server-side on write.
- Pagination cursor is the composite `(created_at, id)`, not `created_at` alone.
- No RBAC/moderation beyond "author can delete own post" in this phase — do not build role checks.
- Follow existing UI conventions: Card/Badge/Avatar/Input/Select/Button from `components/ui/*`, `cn()` from `lib/utils`.

---

## File Structure

```
Create:
  supabase/notice_schema.sql                          — SQL migration (tables, indexes, storage bucket note)
  lib/notice.ts                                        — Supabase helpers for notices/likes (server-only)
  components/ui/textarea.tsx                           — shadcn-style Textarea primitive (doesn't exist yet)
  components/ui/dialog.tsx                             — shadcn-style Dialog primitive (doesn't exist yet, radix-ui already installed)
  app/api/notice/route.ts                              — GET (list, cursor+filters), POST (create)
  app/api/notice/[id]/route.ts                         — DELETE (author-only delete)
  app/api/notice/[id]/like/route.ts                    — POST (toggle like)
  app/api/notice/upload/route.ts                       — POST (image upload to Supabase Storage)
  components/dashboard/notice/NoticeCard.tsx           — single post card (author, timestamp, tags, attachments, likes)
  components/dashboard/notice/NoticeFilters.tsx        — keyword + date range + tag filter bar
  components/dashboard/notice/NoticeFeed.tsx           — infinite-scroll list wrapper
  components/dashboard/notice/NoticeCreateModal.tsx    — create-post dialog + form
  components/dashboard/tabs/NoticeTab.tsx               — orchestrator (state, fetch, wiring)

Modify:
  components/dashboard/Sidebar.tsx                      — add "notice" nav entry
  app/page.tsx                                           — register NoticeTab in TAB_LABELS + render slot
```

---

## Task 1: Supabase schema + storage bucket

**Files:**
- Create: `supabase/notice_schema.sql`

**Interfaces:**
- Produces: tables `notices(id, title, description, tags, attachments, author_name, author_email, created_at)` and `notice_likes(notice_id, user_email, user_name, created_at)`, both consumed by `lib/notice.ts` in Task 2.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/notice_schema.sql
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  attachments jsonb not null default '[]', -- [{type: "image"|"link", url: string, label?: string}]
  author_name text not null,
  author_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists notice_likes (
  notice_id uuid not null references notices(id) on delete cascade,
  user_email text not null,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_email)
);

create index if not exists notices_created_at_idx on notices (created_at desc, id desc);
create index if not exists notices_tags_idx on notices using gin (tags);

-- Run once manually in the Supabase dashboard (Storage tab), not via SQL:
--   Create a public bucket named "notice-attachments" for uploaded images.
```

- [ ] **Step 2: Apply the migration**

Run this SQL against the project's Supabase instance (via the Supabase SQL editor or CLI — this repo has no local Supabase CLI workflow configured, so apply it through the dashboard SQL editor).

- [ ] **Step 3: Create the storage bucket**

In the Supabase dashboard → Storage → New bucket → name `notice-attachments` → Public bucket: on. This is a manual one-time step (no SQL/API call in this repo automates bucket creation).

- [ ] **Step 4: Commit**

```bash
git add supabase/notice_schema.sql
git commit -m "feat(notice): add notices/notice_likes schema"
```

---

## Task 2: Supabase helper functions (`lib/notice.ts`)

**Files:**
- Create: `lib/notice.ts`

**Interfaces:**
- Consumes: `lib/supabase.ts` internal `client()` pattern is private — this file makes its own client the same way (copy the same env-var-based lazy client, matching the existing file's isolation style; no exported `client()` to import).
- Produces (consumed by API routes in Tasks 4-7):
  - `type Attachment = { type: "image" | "link"; url: string; label?: string }`
  - `type Notice = { id: string; title: string; description: string; tags: string[]; attachments: Attachment[]; authorName: string; authorEmail: string; createdAt: string; likeCount: number; likedByMe: boolean }`
  - `listNotices(opts: { keyword?: string; from?: string; to?: string; tags?: string[]; cursor?: { createdAt: string; id: string } | null; viewerEmail: string; limit?: number }): Promise<{ items: Notice[]; nextCursor: { createdAt: string; id: string } | null }>`
  - `createNotice(input: { title: string; description: string; tags: string[]; attachments: Attachment[]; authorName: string; authorEmail: string }): Promise<Notice>`
  - `deleteNotice(id: string, requesterEmail: string): Promise<{ ok: boolean; reason?: "not-found" | "forbidden" }>`
  - `toggleLike(noticeId: string, userEmail: string, userName: string): Promise<{ liked: boolean; likeCount: number }>`
  - `listLikers(noticeId: string): Promise<{ userEmail: string; userName: string }[]>`

- [ ] **Step 1: Write the file**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/notice.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/notice.ts
git commit -m "feat(notice): add Supabase helper functions"
```

---

## Task 3: UI primitives — Textarea and Dialog

**Files:**
- Create: `components/ui/textarea.tsx`
- Create: `components/ui/dialog.tsx`

**Interfaces:**
- Produces: `Textarea` (props: `React.ComponentProps<"textarea">`), and `Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose` — consumed by `NoticeCreateModal.tsx` in Task 9.

- [ ] **Step 1: Write `components/ui/textarea.tsx`**

```typescript
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 2: Write `components/ui/dialog.tsx`**

```typescript
"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 max-h-[85vh] overflow-y-auto",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none disabled:pointer-events-none">
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg leading-none font-semibold", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export {
  Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: succeeds (these files aren't imported anywhere yet, but must type-check standalone)

- [ ] **Step 4: Commit**

```bash
git add components/ui/textarea.tsx components/ui/dialog.tsx
git commit -m "feat(notice): add Textarea and Dialog UI primitives"
```

---

## Task 4: API route — list + create (`GET /api/notice`, `POST /api/notice`)

**Files:**
- Create: `app/api/notice/route.ts`

**Interfaces:**
- Consumes: `listNotices`, `createNotice`, `type Notice`, `type Attachment` from `lib/notice.ts` (Task 2); `authOptions` from `lib/auth.ts`.
- Produces: `GET` returns `{ items: Notice[]; nextCursor: {createdAt:string;id:string} | null }`; `POST` returns `{ notice: Notice }` — consumed by `NoticeTab.tsx` (Task 11) and `NoticeCreateModal.tsx` (Task 9).

- [ ] **Step 1: Write the route**

```typescript
// app/api/notice/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listNotices, createNotice, type Attachment } from "@/lib/notice";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const keyword = sp.get("keyword") || undefined;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const tagsParam = sp.get("tags");
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const cursorCreatedAt = sp.get("cursorCreatedAt");
  const cursorId = sp.get("cursorId");
  const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : null;

  try {
    const result = await listNotices({
      keyword, from, to, tags, cursor, viewerEmail: session.user.email, limit: 20,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load notices" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string; description?: string; tags?: string[]; attachments?: Attachment[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
  if (tags.filter(t => t.trim()).length === 0) return NextResponse.json({ error: "At least one tag is required" }, { status: 400 });

  try {
    const notice = await createNotice({
      title, description, tags, attachments,
      authorName: session.user.name ?? "Unknown",
      authorEmail: session.user.email,
    });
    return NextResponse.json({ notice }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create notice" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/api/notice/route.ts
git commit -m "feat(notice): add list/create API route"
```

---

## Task 5: API route — delete (`DELETE /api/notice/[id]`)

**Files:**
- Create: `app/api/notice/[id]/route.ts`

**Interfaces:**
- Consumes: `deleteNotice` from `lib/notice.ts` (Task 2).
- Produces: `DELETE` returns `{ ok: true }` or `{ error: string }` — consumed by `NoticeCard.tsx` (Task 8).

- [ ] **Step 1: Write the route**

```typescript
// app/api/notice/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteNotice } from "@/lib/notice";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const result = await deleteNotice(id, session.user.email);
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : 403;
      return NextResponse.json({ error: result.reason === "not-found" ? "Notice not found" : "You can only delete your own notices" }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete notice" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/api/notice/[id]/route.ts"
git commit -m "feat(notice): add delete API route"
```

---

## Task 6: API route — toggle like (`POST /api/notice/[id]/like`)

**Files:**
- Create: `app/api/notice/[id]/like/route.ts`

**Interfaces:**
- Consumes: `toggleLike`, `listLikers` from `lib/notice.ts` (Task 2).
- Produces: `POST` returns `{ liked: boolean; likeCount: number }`; `GET` returns `{ likers: {userEmail:string;userName:string}[] }` — consumed by `NoticeCard.tsx` (Task 8).

- [ ] **Step 1: Write the route**

```typescript
// app/api/notice/[id]/like/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { toggleLike, listLikers } from "@/lib/notice";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const result = await toggleLike(id, session.user.email, session.user.name ?? "Unknown");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to toggle like" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const likers = await listLikers(id);
    return NextResponse.json({ likers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load likers" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "app/api/notice/[id]/like/route.ts"
git commit -m "feat(notice): add like toggle + likers API route"
```

---

## Task 7: API route — image upload (`POST /api/notice/upload`)

**Files:**
- Create: `app/api/notice/upload/route.ts`

**Interfaces:**
- Consumes: raw `@supabase/supabase-js` client (same lazy-init pattern as `lib/notice.ts`) targeting the `notice-attachments` bucket created in Task 1.
- Produces: `POST` returns `{ url: string }` or `{ error: string }` — consumed by `NoticeCreateModal.tsx` (Task 9).

- [ ] **Step 1: Write the route**

```typescript
// app/api/notice/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "notice-attachments";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const ext = file.name.split(".").pop() || "bin";
  const path = `${session.user.email}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/api/notice/upload/route.ts
git commit -m "feat(notice): add attachment upload API route"
```

---

## Task 8: `NoticeCard` component

**Files:**
- Create: `components/dashboard/notice/NoticeCard.tsx`

**Interfaces:**
- Consumes: `type Notice, type Attachment` from `lib/notice.ts` (re-exported client-safe — Task 2's types are plain TS types, safe to import in a client component since only the type is used, not the server functions); `Card, CardContent, CardHeader` from `components/ui/card`; `Badge` from `components/ui/badge`; `Avatar, AvatarFallback, AvatarImage` from `components/ui/avatar`; `Button` from `components/ui/button`.
- Produces: `export default function NoticeCard(props: { notice: Notice; currentUserEmail: string; onDeleted: (id: string) => void }): JSX.Element` — consumed by `NoticeFeed.tsx` (Task 10).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/notice/NoticeCard.tsx
"use client";
import { useState } from "react";
import { Heart, Trash2, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Notice } from "@/lib/notice";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NoticeCard({
  notice, currentUserEmail, onDeleted,
}: {
  notice: Notice;
  currentUserEmail: string;
  onDeleted: (id: string) => void;
}) {
  const [liked, setLiked] = useState(notice.likedByMe);
  const [likeCount, setLikeCount] = useState(notice.likeCount);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState<{ userEmail: string; userName: string }[] | null>(null);
  const [likersLoading, setLikersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleLike() {
    const prevLiked = liked; const prevCount = likeCount;
    setLiked(!prevLiked); setLikeCount(prevLiked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await fetch(`/api/notice/${notice.id}/like`, { method: "POST" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setLiked(json.liked); setLikeCount(json.likeCount);
    } catch {
      setLiked(prevLiked); setLikeCount(prevCount);
    }
  }

  async function openLikers() {
    setLikersOpen(true);
    if (likers) return;
    setLikersLoading(true);
    try {
      const res = await fetch(`/api/notice/${notice.id}/like`);
      const json = await res.json();
      setLikers(json.likers ?? []);
    } catch {
      setLikers([]);
    } finally {
      setLikersLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this notice?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notice/${notice.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(notice.id);
    } finally {
      setDeleting(false);
    }
  }

  const initial = notice.authorName.charAt(0).toUpperCase();
  const isOwner = notice.authorEmail === currentUserEmail;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold text-foreground">{notice.authorName}</p>
            <p className="text-xs text-muted-foreground">{relativeTime(notice.createdAt)}</p>
          </div>
        </div>
        {isOwner ? (
          <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} aria-label="Delete notice">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{notice.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{notice.description}</p>
        </div>

        {notice.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {notice.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
        ) : null}

        {notice.attachments.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {notice.attachments.map((a, i) =>
              a.type === "image" ? (
                <img key={i} src={a.url} alt="" className="h-24 w-full rounded-md border border-border object-cover" />
              ) : (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"
                  className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/40 p-2 text-center text-xs text-muted-foreground hover:bg-muted">
                  <LinkIcon className="h-4 w-4" />
                  <span className="truncate w-full">{a.label ?? a.url}</span>
                </a>
              )
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={toggleLike} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <Heart className={cn("h-4 w-4", liked && "fill-red-500 text-red-500")} />
          </button>
          <button onClick={openLikers} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            {likeCount} {likeCount === 1 ? "like" : "likes"}
          </button>
        </div>

        {likersOpen ? (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
            {likersLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : likers && likers.length > 0 ? (
              <ul className="space-y-1">
                {likers.map(l => <li key={l.userEmail} className="text-foreground">{l.userName}</li>)}
              </ul>
            ) : (
              <p className="text-muted-foreground">No likes yet.</p>
            )}
            <button onClick={() => setLikersOpen(false)} className="mt-1 text-muted-foreground hover:underline">Hide</button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors (component isn't wired up yet, but must type-check standalone)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/notice/NoticeCard.tsx
git commit -m "feat(notice): add NoticeCard component"
```

---

## Task 9: `NoticeCreateModal` component

**Files:**
- Create: `components/dashboard/notice/NoticeCreateModal.tsx`

**Interfaces:**
- Consumes: `Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter` from `components/ui/dialog` (Task 3); `Textarea` from `components/ui/textarea` (Task 3); `Input, Label, Button, Badge` from existing `components/ui/*`; `type Attachment, type Notice` from `lib/notice.ts`.
- Produces: `export default function NoticeCreateModal(props: { onCreated: (notice: Notice) => void }): JSX.Element` — consumed by `NoticeTab.tsx` (Task 11).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/notice/NoticeCreateModal.tsx
"use client";
import { useState } from "react";
import { X, Loader2, Plus, Image as ImageIcon, Link as LinkIcon } from "lucide-react";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Attachment, Notice } from "@/lib/notice";

export default function NoticeCreateModal({ onCreated }: { onCreated: (notice: Notice) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setTitle(""); setDescription(""); setTagInput(""); setTags([]);
    setAttachments([]); setLinkInput(""); setError("");
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  function addLink() {
    const url = linkInput.trim();
    if (!url) return;
    setAttachments(prev => [...prev, { type: "link", url, label: url }]);
    setLinkInput("");
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/notice/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
        setAttachments(prev => [...prev, { type: "image", url: json.url }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setError("");
    if (!title.trim()) return setError("Title is required");
    if (!description.trim()) return setError("Description is required");
    if (tags.length === 0) return setError("At least one tag is required");

    setSubmitting(true);
    try {
      const res = await fetch("/api/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), tags, attachments }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create notice");
      onCreated(json.notice as Notice);
      resetForm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create notice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5"><Plus className="h-4 w-4" /> New Notice</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Notice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Notice title" />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="What's this notice about?" />
          </div>

          <div className="space-y-1.5">
            <Label>Tags <span className="text-muted-foreground font-normal">(at least 1 required)</span></Label>
            <div className="flex gap-2">
              <Input
                value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                placeholder="Type a tag, press Enter"
              />
              <Button type="button" variant="secondary" onClick={addTag}>Add</Button>
            </div>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map(t => (
                  <Badge key={t} variant="secondary" className="gap-1">
                    {t}
                    <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Attachments <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
                <ImageIcon className="h-4 w-4" /> Upload image
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={handleFileUpload} disabled={uploading} />
              </label>
              <Input value={linkInput} onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addLink())}
                placeholder="Paste a link" className="w-48" />
              <Button type="button" variant="secondary" onClick={addLink}><LinkIcon className="h-4 w-4" /></Button>
            </div>
            {uploading ? <p className="text-xs text-muted-foreground">Uploading...</p> : null}
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                    {a.type === "image" ? <ImageIcon className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
                    <span className="max-w-32 truncate">{a.label ?? a.url}</span>
                    <button onClick={() => removeAttachment(i)} aria-label="Remove attachment"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting</> : "Post Notice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/notice/NoticeCreateModal.tsx
git commit -m "feat(notice): add NoticeCreateModal component"
```

---

## Task 10: `NoticeFilters` and `NoticeFeed` components

**Files:**
- Create: `components/dashboard/notice/NoticeFilters.tsx`
- Create: `components/dashboard/notice/NoticeFeed.tsx`

**Interfaces:**
- Consumes: `DateRangeControls` (default export) from `components/dashboard/DateRangeControls.tsx`; `Input, Button` from `components/ui/*`; `NoticeCard` (default export) from Task 8; `type Notice` from `lib/notice.ts`.
- Produces:
  - `export default function NoticeFilters(props: { keyword: string; onKeyword: (v: string) => void; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; tagFilter: string; onTagFilter: (v: string) => void; onApply: () => void; loading: boolean }): JSX.Element`
  - `export default function NoticeFeed(props: { notices: Notice[]; currentUserEmail: string; onLoadMore: () => void; hasMore: boolean; loading: boolean; onDeleted: (id: string) => void }): JSX.Element` — both consumed by `NoticeTab.tsx` (Task 11).

- [ ] **Step 1: Write `NoticeFilters.tsx`**

```tsx
// components/dashboard/notice/NoticeFilters.tsx
"use client";
import { Search } from "lucide-react";
import DateRangeControls from "@/components/dashboard/DateRangeControls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NoticeFilters({
  keyword, onKeyword, from, to, onFrom, onTo, tagFilter, onTagFilter, onApply, loading,
}: {
  keyword: string; onKeyword: (v: string) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  tagFilter: string; onTagFilter: (v: string) => void;
  onApply: () => void; loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Search</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword} onChange={e => onKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onApply()}
            placeholder="Search title or description" className="h-9 w-56 pl-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Tag</Label>
        <Input
          value={tagFilter} onChange={e => onTagFilter(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onApply()}
          placeholder="Filter by tag" className="h-9 w-40"
        />
      </div>
      <DateRangeControls from={from} to={to} onFrom={onFrom} onTo={onTo} onApply={onApply} loading={loading} />
    </div>
  );
}
```

- [ ] **Step 2: Write `NoticeFeed.tsx`**

```tsx
// components/dashboard/notice/NoticeFeed.tsx
"use client";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import NoticeCard from "@/components/dashboard/notice/NoticeCard";
import type { Notice } from "@/lib/notice";

export default function NoticeFeed({
  notices, currentUserEmail, onLoadMore, hasMore, loading, onDeleted,
}: {
  notices: Notice[]; currentUserEmail: string;
  onLoadMore: () => void; hasMore: boolean; loading: boolean;
  onDeleted: (id: string) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !loading) onLoadMore();
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (notices.length === 0 && !loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No notices yet.</p>;
  }

  return (
    <div className="space-y-4">
      {notices.map(n => (
        <NoticeCard key={n.id} notice={n} currentUserEmail={currentUserEmail} onDeleted={onDeleted} />
      ))}
      {hasMore ? <div ref={sentinelRef} className="h-4" /> : null}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/notice/NoticeFilters.tsx components/dashboard/notice/NoticeFeed.tsx
git commit -m "feat(notice): add NoticeFilters and NoticeFeed components"
```

---

## Task 11: `NoticeTab` orchestrator

**Files:**
- Create: `components/dashboard/tabs/NoticeTab.tsx`

**Interfaces:**
- Consumes: `NoticeFilters` (Task 10), `NoticeFeed` (Task 10), `NoticeCreateModal` (Task 9), all default exports; `type Notice` from `lib/notice.ts`; `useSession` from `next-auth/react`; `Card` from `components/ui/card`.
- Produces: `export default function NoticeTab(): JSX.Element` — consumed by `app/page.tsx` (Task 13).

- [ ] **Step 1: Write the component**

```tsx
// components/dashboard/tabs/NoticeTab.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import NoticeFilters from "@/components/dashboard/notice/NoticeFilters";
import NoticeFeed from "@/components/dashboard/notice/NoticeFeed";
import NoticeCreateModal from "@/components/dashboard/notice/NoticeCreateModal";
import type { Notice } from "@/lib/notice";

type Cursor = { createdAt: string; id: string } | null;

export default function NoticeTab() {
  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? "";

  const [notices, setNotices] = useState<Notice[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const fetchPage = useCallback(async (reset: boolean) => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams();
      if (keyword) p.set("keyword", keyword);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (tagFilter) p.set("tags", tagFilter);
      const useCursor = reset ? null : cursor;
      if (useCursor) { p.set("cursorCreatedAt", useCursor.createdAt); p.set("cursorId", useCursor.id); }

      const res = await fetch(`/api/notice?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load notices");

      setNotices(prev => reset ? json.items : [...prev, ...json.items]);
      setCursor(json.nextCursor);
      setHasMore(!!json.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notices");
    } finally {
      setLoading(false);
    }
  }, [keyword, from, to, tagFilter, cursor]);

  useEffect(() => {
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApplyFilters() {
    setCursor(null);
    fetchPage(true);
  }

  function handleLoadMore() {
    if (!loading && hasMore) fetchPage(false);
  }

  function handleCreated(notice: Notice) {
    setNotices(prev => [notice, ...prev]);
  }

  function handleDeleted(id: string) {
    setNotices(prev => prev.filter(n => n.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NoticeFilters
          keyword={keyword} onKeyword={setKeyword}
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          tagFilter={tagFilter} onTagFilter={setTagFilter}
          onApply={handleApplyFilters} loading={loading}
        />
        <NoticeCreateModal onCreated={handleCreated} />
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchPage(true)}>Retry</Button>
        </div>
      ) : null}

      <NoticeFeed
        notices={notices} currentUserEmail={currentUserEmail}
        onLoadMore={handleLoadMore} hasMore={hasMore} loading={loading}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/tabs/NoticeTab.tsx
git commit -m "feat(notice): add NoticeTab orchestrator"
```

---

## Task 12: Wire into Sidebar and page.tsx

**Files:**
- Modify: `components/dashboard/Sidebar.tsx:1-13`
- Modify: `app/page.tsx:1-86`

**Interfaces:**
- Consumes: `NoticeTab` (default export) from Task 11.

- [ ] **Step 1: Add nav entry to Sidebar**

In `components/dashboard/Sidebar.tsx`, update the icon import and `NAV` array:

```typescript
import { Users, BarChart3, CheckSquare, Inbox, Mail, Megaphone, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
```

```typescript
const NAV = [
  { id: "daily-huddle",   label: "Daily Huddle",         icon: Users       },
  { id: "kpi",            label: "KPI",                  icon: BarChart3   },
  { id: "regular-task",   label: "Regular Task",         icon: CheckSquare },
  { id: "tickets",        label: "Tickets",              icon: Inbox       },
  { id: "trading-ethics", label: "Trading Ethics Email", icon: Mail        },
  { id: "notice",         label: "Notice",               icon: Megaphone   },
];
```

(Alignment intentionally not added here — it's a separate phase per the spec.)

- [ ] **Step 2: Register the tab in `app/page.tsx`**

Add the import:

```typescript
import NoticeTab from "@/components/dashboard/tabs/NoticeTab";
```

Update `TAB_LABELS`:

```typescript
const TAB_LABELS: Record<string, string> = {
  "daily-huddle": "Daily Huddle",
  "kpi": "KPI",
  "regular-task": "Regular Task",
  "tickets": "Tickets",
  "trading-ethics": "Trading Ethics Email Performance",
  "notice": "Notice",
};
```

Add the render slot right after the `trading-ethics` block (around line 78-80):

```tsx
            <div style={vis("notice")}>
              {mounted["notice"] ? <NoticeTab /> : null}
            </div>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: both succeed

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, sign in, click "Notice" in the sidebar, and verify:
- Feed loads (empty state shown if no data)
- "New Notice" opens the modal; submitting without a tag shows the tag-required error
- Create a notice with a tag and an image attachment; it appears at the top of the feed
- Click the heart to like/unlike; click the like count to see the likers list
- Type a keyword and click Apply; feed refetches filtered results
- Scroll to the bottom of a long feed (if enough data exists) to confirm infinite scroll fires
- As the author, delete your own notice; as a non-author, confirm no delete button shows

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/Sidebar.tsx app/page.tsx
git commit -m "feat(notice): wire Notice tab into sidebar and page"
```

---

## Self-Review Notes

- **Spec coverage:** nav entry (Task 12), post feed with author/timestamp/tags/likes (Tasks 8, 10), search+date+tag filters (Task 10), create button with title/description/attachment/tags (Task 9), infinite scroll (Task 10), Supabase storage (Tasks 1, 7), cursor `(created_at, id)` (Tasks 2, 4), tag normalization (Task 2), author-only delete (Tasks 2, 5, 8). Alignment explicitly out of scope, matches spec.
- **Type consistency:** `Notice`/`Attachment` types defined once in `lib/notice.ts` (Task 2) and imported everywhere else — no redefinition drift.
- **No placeholders:** every step has complete, runnable code.
