-- LLM telemetry — append-only log of every Claude/GPT call routed
-- through llmJSON(). Powers quality measurement on the Objective
-- Canvas: latency, token cost, success rate, and (via the feedback
-- column) user-rated quality per artifact.
--
-- Schema design notes:
--   • space_id nullable — some calls fire pre-space (auth flows,
--     standalone tools) or with no clear space context.
--   • user_id ON DELETE SET NULL — preserve historical aggregates
--     even after a user wipes their account.
--   • artifact_kind + artifact_id let the feedback endpoint locate
--     the row via (kind, id) without the caller having to remember
--     the log id. Multiple log rows can share an artifact_id
--     (force-regenerations) — the feedback endpoint will target
--     the most-recent matching row.
--   • feedback is TEXT (not boolean) so we can add granular values
--     later ('up_strong' / 'down_strong' / 'mixed') without a
--     migration.

create table public.llm_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  space_id uuid references public.spaces(id) on delete cascade,
  call_site text not null,
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  latency_ms integer not null,
  status text not null check (status in ('success', 'error')),
  error_message text,
  artifact_kind text,
  artifact_id text,
  feedback text check (feedback in ('up', 'down')),
  feedback_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index llm_call_log_user_recency_idx
  on public.llm_call_log(user_id, created_at desc);

create index llm_call_log_site_status_idx
  on public.llm_call_log(call_site, status, created_at desc);

create index llm_call_log_feedback_idx
  on public.llm_call_log(call_site, feedback, created_at desc)
  where feedback is not null;

create index llm_call_log_artifact_idx
  on public.llm_call_log(artifact_kind, artifact_id, created_at desc)
  where artifact_id is not null;

alter table public.llm_call_log enable row level security;

create policy "users read their own llm calls"
  on public.llm_call_log
  for select
  using (user_id = auth.uid());

create policy "users insert their own llm calls"
  on public.llm_call_log
  for insert
  with check (user_id = auth.uid());

create policy "users update their own llm-call feedback"
  on public.llm_call_log
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.llm_call_log is
  'Append-only telemetry for every LLM call routed through llmJSON(). Captures latency, tokens, status, and user feedback (thumbs). Powers quality measurement across the Objective Canvas. See src/lib/objective-canvas/record-llm-call.ts.';
