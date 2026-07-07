# AGENTS.md — working in this repo

Guidance for anyone (human or AI coding agent) editing ops-dashboard. Read this
first; a few things here are non-obvious and have caused real bugs.

## Build & verify (always before committing)
```bash
npx tsc --noEmit     # must pass
npx next build       # must succeed
```
Never push an unverified change — Vercel deploys `main` automatically.

## Layout
- `app/` — routes & pages. API routes live in `app/api/**/route.ts`.
- `components/dashboard/tabs/` — one component per dashboard tab.
- `lib/` — `supabase.ts` (server client + RPC helpers), `auth.ts` (NextAuth),
  `date-helpers.ts`.

## Conventions
- App Router + server components by default; `"use client"` only when needed.
- UI: Tailwind + shadcn/ui. Reuse `components/dashboard/DateRangeControls.tsx`
  for date filters (shared look; each tab keeps its own fetch logic).
- Data fetching happens **server-side** in `route.ts` handlers.

## Gotchas (these have bitten us)
- **`route.ts` files are API only — NO JSX.** If you see `<div>` in a `route.ts`,
  wrong content was pasted. (This exact mistake broke a build.)
- **Secrets only via `process.env`** — never hard-code tokens/keys. Supabase
  service-role key and all tokens are server-side only; never expose to the client.
- **TEEP reads from Supabase, not live Intercom.** The tab calls the SQL RPCs
  `teep_report` / `teep_hourly`. A BI-server cron fills Supabase every 6h.
- **⚠️ Single source of truth:** the CR-team filter, the 12 agent names, the 24h
  SLA, and the "what counts as a reply" rule are defined in **both**
  `app/api/teep/route.ts` (TS) and `teep-sync.py` (Python, on the BI server).
  Change one → change the other, or the dashboard and the data diverge.
  See MAINTENANCE.md → "Single source of truth."
- **Don't blind-edit large working files.** Make surgical changes and build.

## Data sources at a glance
Supabase (TEEP) · Google Sheets (Daily Huddle / BD-SL / KPI) · Intercom · ClickUp
Chat API (Process Updates feed, cached 24h). Details in MAINTENANCE.md.
