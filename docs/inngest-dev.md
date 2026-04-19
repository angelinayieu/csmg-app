# Inngest Dev Setup

This project uses [Inngest](https://www.inngest.com/) as a durable job queue for the analysis pipeline.
Local development uses the Inngest Dev Server (no account required). Production uses Inngest Cloud.

## Local development

Run three things in parallel:

```bash
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — Inngest Dev Server
npx inngest-cli@latest dev

# Terminal 3 — anything else (tests, typecheck, etc.)
```

Open:

- Next.js app: http://localhost:3000
- Inngest dashboard: http://localhost:8288

The Inngest Dev Server auto-discovers functions via `http://localhost:3000/api/inngest`. No env vars required locally.

### Enabling the new pipeline path

Set in `.env.local`:

```bash
NEXT_PUBLIC_USE_INNGEST=true
```

With this flag:

- `use-orchestrate.ts` POSTs to `/api/orchestrate/enqueue` instead of the legacy SSE route
- `/api/orchestrate/enqueue` creates an `analysis_jobs` row, reserves credits, and fires
  the `analysis/orchestrate.requested` Inngest event
- The `orchestrateAnalysis` Inngest function runs the full pipeline (decompose → synthesize → strategy → twin → probability) with durable steps
- Client polls `/api/job/:id` every 1 second (or subscribes to `job_events` via Supabase Realtime using `useJobStream`)

Turn the flag off to fall back to the legacy `/api/orchestrate` SSE route — useful for rollback.

## Database migration

Apply the migration `supabase/migrations/20260417_analysis_jobs.sql` before enabling the flag.

Via Supabase CLI:
```bash
npx supabase db push
```

Via dashboard: paste the migration SQL into the SQL Editor and run.

The migration:
- Creates `analysis_jobs` and `job_events` tables
- Sets up RLS policies (users see only their own jobs/events)
- Enables the `supabase_realtime` publication on both tables

## Production setup

1. Create an Inngest account at https://www.inngest.com/
2. Add the app and copy:
   - `INNGEST_EVENT_KEY` — from the Event Keys section
   - `INNGEST_SIGNING_KEY` — from the Signing Key section
3. Add both to Vercel env vars (production + preview scopes)
4. Deploy — Inngest Cloud will auto-detect the functions at `<your-domain>/api/inngest`

## Troubleshooting

- **Function not firing**: confirm the Inngest Dev Server is running and the Next.js app has loaded at least once (so `/api/inngest` has been registered)
- **"Event not found" error**: ensure the event name in `events.ts` matches the `inngest.send({ name })` call exactly
- **Realtime events not arriving on the client**: verify the migration's `alter publication supabase_realtime add table job_events` ran successfully; check the Supabase dashboard → Database → Replication
- **Credits double-charged**: check that `onFailure` handler ran to cancel the reservation; a nightly cron can clean up stuck reservations older than 24h

## Architecture

```
Client
  │
  │ POST /api/orchestrate/enqueue { text, tier }
  ▼
Next.js route
  │ reserveCredits() → analysis_jobs INSERT
  │ inngest.send({ name: "analysis/orchestrate.requested", data: { jobId, ... } })
  │ return { jobId }
  ▼
Inngest
  │ Invokes orchestrateAnalysis function with durable steps:
  │   1. mark-running
  │   2. run-pipeline (decompose + structure + critique + synthesize + ...)
  │   3. persist-core (spaces, entities, edges, cycles, claims)
  │   4. persist-external-knowledge (research + bridges)
  │   5. commit-credits
  │   6. mark-complete
  │
  │ Each step writes events to job_events (via job-writer.ts).
  ▼
Supabase Realtime
  │ postgres_changes subscription on job_events + analysis_jobs
  ▼
Client (useJobStream hook)
  │ Renders progressive state
  │ Redirects to /app/space/:id when job.space_id is set
```
