# ops-dashboard — Maintenance & Architecture

Internal operations dashboard for FundedNext CR/BizOps. Next.js (App Router,
React 19, Tailwind, shadcn) on Vercel, Google OAuth (@nextventures.io only),
data from Supabase, Intercom, Google Sheets, and ClickUp.

## Tabs & data sources

| Tab | Source | Freshness |
| --- | --- | --- |
| Daily Huddle / BD-SL | Google Sheets (BizOps + CR Metrics) | live per request |
| KPI, Tickets | Google Sheets / Intercom | live per request |
| Trading Ethics (TEEP) | **Supabase** (filled by a BI-server cron) | every 6 h |
| Teammate Performance (TEEP sub-tab) | Supabase RPC `teep_hourly` | every 6 h |
| Regular Task → Process Updates | ClickUp Chat API | cached 24 h |

## TEEP pipeline (the important one)

Intercom → **BI server sync** (`teep-sync.py`) → **Supabase** → dashboard reads
via SQL RPCs. This exists because live Intercom fetches timed out on Vercel and
drifted; storing immutable events in Supabase fixed both.

- **BI server:** `172.16.110.170`, `/srv/samba/myshare/supabase-ops-dashboard`,
  venv at `.venv`, secrets in `.env` (raw Intercom token, Supabase URL + service key).
- **Tables:** `teep_events` (close/comment facts), `teep_conversations` (per-conv
  stats), `teep_teammates` (admin_id → name, is_teep), `teep_sync_state` (cursors).
- **RPCs:** `teep_report(start,end)` (per-agent overview), `teep_hourly(start,end,agent)`
  (day-of-week × hour grid).
- **Cron:** `0 */6 * * *` runs `teep-sync.py` (delta). Freshness badge on the TEEP
  tab reads `teep_sync_state.cursor.updated_at`; amber/red there = cron likely down.

### Sync commands (run from the BI-server folder, in tmux for long jobs)
```
.venv/bin/python teep-sync.py                 # delta (what the cron runs)
.venv/bin/python teep-sync.py --day 2026-06-21
.venv/bin/python teep-sync.py --backfill 180  # full history, resumable
```
Long runs: `tmux new -s teep` … `Ctrl+B D` to detach; `tmux attach -t teep`.

### Validation queries
```
select sum(closed), sum(replies_sent)
from teep_report('2026-05-20T00:00:00+06:00','2026-05-21T00:00:00+06:00'); -- ~424 / ~340
```

## ⚠️ Single source of truth (drift risk)

The TEEP filter is defined in **TWO** places and must be kept identical, or the
dashboard and the sync will disagree:

1. `teep-sync.py` (Python, on the BI server)
2. `app/api/teep/route.ts` (TypeScript)

Keep these in sync across both files:
- **CR teams:** `/teams` where name starts with `"CR"` and != `"CR - Ticket Dependencies"`
- **Channel:** `source.type == "email"`
- **12 agents:** the `TEEP_AGENT_NAMES` list (fuzzy-matched, `&#39;`→`'`)
- **SLA:** 24h (`86400`)
- **Reply definition:** any admin part with a non-empty body that is NOT a note
  (covers `comment` + reply-and-`assignment`/`close`) — this was the fix that made
  reply counts match internal. If you change it in one file, change the other.

## Deployment
- **Dashboard:** push to `main` on GitHub → Vercel auto-deploys.
- **BI sync:** edit files on the server; cron picks up the current file each run.

## Runbook — "the numbers look wrong"
1. Check the TEEP freshness badge. Amber/red → the cron stopped; SSH in,
   `pgrep -af teep-sync`, re-run a delta, check `sync.log`.
2. Compare a **settled** past weekday to internal via `teep_report` (weekends are
   genuinely lower — that's real, not a bug).
3. Recent day short on replies → run `--backfill 3` (recent days settle over ~1–2 days).

## Going-private checklist
- [ ] Confirm no secret was ever committed: `git log -p | grep -iE "pk_|service_role|CLIENT_SECRET"`
      (going private does NOT scrub history — rotate any exposed key).
- [ ] `.env*` and `.venv` are gitignored.
- [ ] Rotate the Supabase service-role key and Intercom/ClickUp tokens if the repo
      was public while any were committed (they shouldn't have been).
