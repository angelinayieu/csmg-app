-- ── Intervention combination support (Phase 4 §5.3) ───────────────────
--
-- The strategizer (src/lib/pipeline/space-strategizer/index.ts) gained a
-- new candidate kind, `intervention_combination`, which pairs two
-- user-controllable drivers and asks "what if both are pulled?". This
-- migration:
--
--   1. Extends the `space_work_kind` enum with the new value so
--      space_work_queue rows of this kind insert without a 22P02 error.
--
--   2. Creates `space_combination_results` — one row per executed
--      combination work item, holding the LLM's interpretation of the
--      pair (title, implication, novelty, mechanism, probes). The
--      executor (src/lib/pipeline/space-executor-drain.ts) writes here
--      when it completes a `combo:{a}+{b}` item; the calibration sweep
--      and downstream UI surfaces (plan drawer, canvas painter) read
--      from here.
--
-- Soft-fail compatible: the executor wraps the insert in a try/catch
-- and continues if this table is missing, so existing deploys keep
-- working until the migration runs. Once it lands the results
-- materialize.

-- 1. Enum extension. ALTER TYPE ... ADD VALUE IF NOT EXISTS is the
-- canonical idempotent path. Postgres ≥ 12 supports it.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'space_work_kind'
      and e.enumlabel = 'intervention_combination'
  ) then
    alter type space_work_kind add value 'intervention_combination';
  end if;
end $$;

-- 2. Combination results table.
--
-- Keyed on (plan_id, work_item_id) so the calibration sweep can join
-- back from a work_queue row in one read. We don't FK work_item_id to
-- space_work_queue because the queue row may be cancelled / deleted
-- separately and we still want to keep the result for audit.

create table if not exists public.space_combination_results (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.space_plans(id) on delete cascade,
  work_item_id uuid,
  candidate_id text not null,

  -- The two paired entities. Stored separately (rather than as
  -- jsonb[]) so we can index either side cheaply for "what
  -- combinations involve entity X" lookups.
  entity_a_id uuid references public.entities(id) on delete set null,
  entity_b_id uuid references public.entities(id) on delete set null,

  -- LLM interpretation
  title text not null,
  implication text not null,
  novelty text not null check (novelty in ('emergent', 'reinforcing', 'tension', 'trivial')),
  mechanism text not null,
  probes jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists space_combination_results_space_created_idx
  on public.space_combination_results (space_id, created_at desc);

create index if not exists space_combination_results_plan_idx
  on public.space_combination_results (plan_id);

create index if not exists space_combination_results_entity_a_idx
  on public.space_combination_results (entity_a_id);

create index if not exists space_combination_results_entity_b_idx
  on public.space_combination_results (entity_b_id);

alter table public.space_combination_results enable row level security;

drop policy if exists "space_combination_results own" on public.space_combination_results;
create policy "space_combination_results own"
  on public.space_combination_results
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
