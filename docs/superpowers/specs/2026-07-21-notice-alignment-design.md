# Notice & Alignment — Design Spec

**Date:** 2026-07-21
**Scope:** Phase 1 only — Notice feed. Alignment (3 sub-tabs: Ops/BizOps/CR) is a follow-up phase, not built here.

## Overview

New sidebar section "Notice & Alignment" with two separate nav items:
- **Notice** — flat, Facebook-style post feed. All posts shown regardless of type.
- **Alignment** (future phase) — same post mechanics but with 3 internal tabs (Ops Alignment, BizOps Alignment, CR Alignment). Posts are routed to a tab based on a type selected at creation time (OpsNotice / BizOps Notice / CR Notice). Access control for who can post to which tab is deferred to a later phase.

This spec covers **Notice only**.

## Navigation

- Two new items added to `Sidebar.tsx` NAV array: `notice`, `alignment` (alignment placeholder/disabled or stub page until Phase 2).
- Registered in `app/page.tsx` TAB_LABELS and tab-switch rendering, following the existing lazy-mount pattern (`mounted` state, `display: none` toggling).

## Component Architecture

```
components/dashboard/tabs/NoticeTab.tsx       — state orchestrator (filters, posts, cursor)
components/dashboard/notice/NoticeFilters.tsx — keyword input, date range (reuse DateRangeControls), tag filter
components/dashboard/notice/NoticeFeed.tsx    — infinite-scroll list, IntersectionObserver at bottom
components/dashboard/notice/NoticeCard.tsx    — single post: avatar, name, timestamp, tags, attachments, like button/count
components/dashboard/notice/NoticeCreateModal.tsx — create post form
```

State lives in `NoticeTab`, following the per-tab state isolation pattern used by `TicketsTab`/`KPITab`. Session-storage cache (5 min TTL) on the initial unfiltered feed load only — filtered/paginated queries always hit network.

## Data Model (Supabase)

```sql
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  attachments jsonb not null default '[]', -- [{type: "image"|"link", url, thumbnail?}]
  author_name text not null,
  author_email text not null,
  created_at timestamptz not null default now()
);

create table notice_likes (
  notice_id uuid references notices(id) on delete cascade,
  user_email text not null,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, user_email)
);

create index notices_created_at_idx on notices (created_at desc);
create index notices_tags_idx on notices using gin (tags);
```

- Author identity comes from the NextAuth session (`session.user.email`/`name`) — no manual author picker.
- Attachments: images uploaded to a Supabase Storage bucket (`notice-attachments`); links stored as plain URL + shown as a link card (no OG-image thumbnail fetch in v1 — extra failure surface, skip it).
- Likes: one row per (notice, user) — natural dedupe; join to get "who liked" names.

## API Routes

```
GET  /api/notice              — cursor-paginated list; query params: keyword, from, to, tags[]
POST /api/notice               — create notice (title, description, tags[], attachments[])
POST /api/notice/[id]/like     — toggle like for current user (insert or delete row)
POST /api/notice/upload        — upload image to Storage, return public URL
```

Keyword search uses Postgres `ilike` on title + description — sufficient at expected volume, no need for full-text search infra.

Search/filter is fetch-on-demand (not client-side real-time filtering) — keeps large feeds efficient and matches cursor-based pagination.

## UI Details

**NoticeCreateModal fields:**
- Title (text, required)
- Description (textarea, required)
- Tags — free-text, chip input (enter/comma to add), **at least 1 tag required**
- Attachments — optional; multiple images (upload) and/or link entries (rendered as link-card, no thumbnail fetch)

**NoticeCard:**
- Avatar (initial-badge fallback, matching existing avatar pattern) + author name + relative timestamp
- Title + description
- Tag badges
- Attachment thumbnails (image grid) or link cards
- Like button + count; click toggles (optimistic update, rollback on failure)
- Clicking the like count opens a popover listing likers' names (fetch on demand if count is large)

**Pagination:** infinite scroll via cursor, not offset — page loads append to the list as the user scrolls near the bottom.

## Error Handling

- Feed fetch failure → inline error banner + retry button (matches KPITab/TicketsTab pattern)
- Create-post failure → inline error inside modal; modal stays open
- Like toggle failure → optimistic UI update rolled back
- Upload failure → per-file error shown; user can retry or remove that file

## Access Control

Deferred. For Phase 1, any authenticated user can create and view Notice posts. Role-based posting permissions (via an admin access panel) are explicitly out of scope here and will be designed in a later phase — this applies to both Notice and the future Alignment type-routing.

## Testing / Verification

Per `AGENTS.md`:
```bash
npx tsc --noEmit
npx next build
```
Manual verification: create a post (with/without attachments), keyword search, date-range filter, tag filter, infinite scroll load-more, like/unlike, view likers list.

## Out of Scope (this phase)

- Alignment tabs (Ops/BizOps/CR) and type-based routing
- Role-based access control / admin permission panel
- Link OG-image thumbnail fetching
- Full-text search
- Real-time feed updates (new posts appearing live without refresh)
