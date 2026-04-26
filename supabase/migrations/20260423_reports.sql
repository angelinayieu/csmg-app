-- ── Reports (Phase 3 — VP Project report finalization) ─────────────────
--
-- A `report` is a frozen, point-in-time snapshot of everything the VP
-- Project widgets need in order to render. Produced when the user clicks
-- "Generate Report" at pipeline completion: the API route gathers the
-- current synthesis_data, taxonomy, variants, latent dimensions + scores,
-- causal chains, ranked strategies, and improvement_goals, bundles them
-- into `payload` (jsonb), and writes a row.
--
-- Why freeze instead of re-query: once the user treats a report as the
-- "final answer", letting later pipeline runs or direct DB edits mutate
-- the numbers retroactively breaks trust. The frozen resolver reads from
-- payload so the report page renders the exact same grid / carousel /
-- heatmap the user accepted.
--
-- RLS: own-only via user_id. space_id and app_id are denormalized for
-- convenient filtering in the reports history list.

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  -- App is optional — we support both per-app and per-space reports.
  -- When null the report is a whole-space VP Project snapshot.
  app_id uuid references apps(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Human-readable title. Defaulted to the app's name (or "Space report")
  -- by the API route when the caller doesn't supply one.
  title text not null,
  -- One-paragraph summary the generator agent writes at freeze time.
  -- Optional — null when the caller opts out of LLM summarization.
  summary text,

  -- The frozen data bundle. Shape matches `ReportPayload` in
  -- src/types/report.ts; the frozen resolver factory reads keys out of
  -- this without joining back to source tables.
  payload jsonb not null default '{}'::jsonb,

  -- The manifest the report should render with. When null the page
  -- falls back to the app's live manifest — useful for legacy reports
  -- written before we started freezing the manifest alongside data.
  manifest jsonb,

  -- Provenance — pipeline version at freeze time + who triggered it.
  pipeline_version integer,
  generated_by text not null default 'user',

  generated_at timestamptz not null default now()
);

create index if not exists idx_reports_space on reports(space_id, generated_at desc);
create index if not exists idx_reports_app on reports(app_id, generated_at desc);
create index if not exists idx_reports_user on reports(user_id, generated_at desc);

alter table reports enable row level security;

create policy reports_select_own on reports for select
  using (user_id = auth.uid());
create policy reports_insert_own on reports for insert
  with check (user_id = auth.uid());
create policy reports_update_own on reports for update
  using (user_id = auth.uid());
create policy reports_delete_own on reports for delete
  using (user_id = auth.uid());
