# ops-dashboard

Internal operations dashboard for FundedNext CR / BizOps — agent KPIs, ticket &
email performance, task tracking, and automation contribution — in one place.

**Stack:** Next.js (App Router, React 19) · Tailwind + shadcn/ui · NextAuth
(Google OAuth, @nextventures.io only) · Supabase · Vercel. Data comes from
Supabase, Intercom, Google Sheets, and ClickUp.

## Quick start
```bash
git clone <repo-url> && cd ops-dashboard
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```

## Verify before pushing
```bash
npx tsc --noEmit             # type-check
npx next build               # full production build
```

## Deploy
Push to `main` → Vercel auto-deploys. Set the same env vars from `.env.example`
in Vercel → Settings → Environment Variables.

## Documentation
- **[MAINTENANCE.md](./MAINTENANCE.md)** — architecture, the TEEP data pipeline,
  sync commands, validation queries, and the runbook.
- **[AGENTS.md](./AGENTS.md)** — conventions & gotchas for anyone (or any AI tool)
  editing this repo. **Read this before making changes.**
- **[.env.example](./.env.example)** — required environment variables.

## Tabs
Daily Huddle · KPI · Regular Task (incl. ClickUp Process Updates) · Tickets ·
Trading Ethics Email Performance (incl. Teammate Performance heatmaps).
