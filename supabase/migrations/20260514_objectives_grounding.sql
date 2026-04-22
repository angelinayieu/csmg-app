-- Wave A — Ground the decomposed KG in the user's detected objectives.
--
-- Why: today the intake pipeline detects "preliminary objectives" via
-- epistemic_classification, stores them as floating JSONB inside
-- spaces.synthesis_data.preliminary_objectives, and never materializes
-- them as improvement_goals rows. Entities have no way to declare which
-- objectives they serve. The Lab / Apps / Synthesis surfaces therefore
-- can't ground their reasoning in what the user is actually trying to
-- achieve.
--
-- This migration closes three gaps:
--
--   1. Lets improvement_goals rows exist in a 'proposed' state with
--      status='proposed' + source='auto_detected' — carrying the LLM's
--      rationale + confidence — BEFORE the user has picked a metric.
--   2. Relaxes NOT NULL on metric_name + target_value so proposed goals
--      can land without them. Approve flow enforces them later.
--   3. Adds entity_objectives(entity_id, goal_id, confidence, source,
--      rationale) so each entity declares which objectives it serves.
--      Populated by the decompose route via a new LLM tagging step.
--
-- Existing path (user manually creates a goal with metric + target via
-- /api/goals POST with status='active') is unchanged — the relaxed
-- NOT NULLs are permissive, and that endpoint still supplies the fields.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Extend the status enum + add audit columns for auto-detection
-- ──────────────────────────────────────────────────────────────────────

alter table public.improvement_goals
  drop constraint if exists improvement_goals_status_check;

alter table public.improvement_goals
  add constraint improvement_goals_status_check
    check (status in (
      'proposed',    -- auto-detected, awaiting user review (NEW)
      'active',      -- user-approved, being pursued
      'achieved',    -- hit target
      'abandoned',   -- user gave up (kept for history)
      'paused',      -- temporarily inactive
      'rejected'     -- user explicitly declined a proposal (NEW, for audit)
    ));

-- Relax metric fields so proposed goals can land without them.
-- Approve flow (api/goals/[id]/approve) enforces not-null before flipping
-- status from 'proposed' → 'active'.
alter table public.improvement_goals
  alter column metric_name drop not null,
  alter column target_value drop not null;

-- Audit fields for auto-detected goals — the LLM's reason for proposing
-- this objective + its confidence + what input-type triggered it. These
-- show up on the review UI so the user can decide with context.
alter table public.improvement_goals
  add column if not exists auto_detection_rationale text,
  add column if not exists auto_detection_confidence text
    check (auto_detection_confidence is null
           or auto_detection_confidence in ('high', 'moderate', 'low')),
  add column if not exists auto_detection_input_type text,
  add column if not exists proposed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid
    references auth.users(id) on delete set null;

-- Ensure resolved_at auto-sets when status transitions out of 'proposed'.
create or replace function public.tg_touch_goal_resolved_at()
returns trigger language plpgsql as $$
begin
  if new.status <> 'proposed'
     and (old.status = 'proposed' or old.status is null)
     and new.resolved_at is null then
    new.resolved_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_touch_goal_resolved_at on public.improvement_goals;
create trigger trg_touch_goal_resolved_at
  before insert or update on public.improvement_goals
  for each row execute function public.tg_touch_goal_resolved_at();

-- ──────────────────────────────────────────────────────────────────────
-- 2. Indexes for the proposed-queue query
-- ──────────────────────────────────────────────────────────────────────

create index if not exists idx_improvement_goals_user_status
  on public.improvement_goals(user_id, status);

-- Partial index for the fast "show me the proposed objectives on this
-- space" query the review UI runs on mount.
create index if not exists idx_improvement_goals_space_proposed
  on public.improvement_goals(space_id)
  where status = 'proposed';

create index if not exists idx_improvement_goals_proposed_at
  on public.improvement_goals(proposed_at desc)
  where status = 'proposed';

-- ──────────────────────────────────────────────────────────────────────
-- 3. entity_objectives junction — the structural fix
-- ──────────────────────────────────────────────────────────────────────
--
-- Each row: "this entity serves this objective with this confidence,
-- because [rationale]." Confidence is useful because the LLM tagger can
-- be uncertain — a proposed link with confidence=0.4 is a hint, not a
-- commitment. The review UI can visibly grade links.
--
-- RLS: indirect via goal_id (goals are user-owned); the entity side is
-- also user-owned via its space, but gating through goal_id is simpler
-- and covers the access check.

create table if not exists public.entity_objectives (
  id uuid primary key default gen_random_uuid(),

  entity_id uuid not null references public.entities(id) on delete cascade,
  goal_id uuid not null references public.improvement_goals(id) on delete cascade,

  -- How sure the LLM (or user) is that this entity actually serves
  -- this objective. 0 = implausible, 1 = textbook match.
  confidence float not null default 0.7
    check (confidence >= 0 and confidence <= 1),

  -- Why this link was created. 'auto_detected' = LLM tagger during
  -- decompose. 'manual' = user added in the review UI. 'refined' =
  -- user adjusted an LLM proposal. Lets us audit which links survived
  -- human review.
  source text not null default 'auto_detected'
    check (source in ('auto_detected', 'manual', 'refined')),

  -- 1-sentence LLM justification, shown on hover in the review UI.
  rationale text,

  created_at timestamptz not null default now(),

  -- One entity can serve a goal via exactly one row. Re-tagging updates.
  unique(entity_id, goal_id)
);

create index if not exists idx_entity_objectives_entity
  on public.entity_objectives(entity_id);
create index if not exists idx_entity_objectives_goal
  on public.entity_objectives(goal_id);
create index if not exists idx_entity_objectives_source
  on public.entity_objectives(source);

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────

alter table public.entity_objectives enable row level security;

drop policy if exists "owner_all_entity_objectives" on public.entity_objectives;
create policy "owner_all_entity_objectives" on public.entity_objectives
  for all using (
    goal_id in (
      select id from public.improvement_goals where user_id = auth.uid()
    )
  )
  with check (
    goal_id in (
      select id from public.improvement_goals where user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────────
-- 5. Backfill marker — set proposed_at for any existing proposed goals
-- (there shouldn't be any yet; this is a safety net for re-runs).
-- ──────────────────────────────────────────────────────────────────────
update public.improvement_goals
  set proposed_at = created_at
  where status = 'proposed' and proposed_at is null;

comment on table public.entity_objectives is
  'Junction: which KG entities serve which user objectives. Populated '
  'by the decompose LLM tagging step (source=auto_detected) and by '
  'manual user edits in the objective review UI (source=manual or '
  'refined). Consumed by the Lab simulator, Apps, and Synthesis to '
  'ground reasoning in what the user actually wants to achieve.';

comment on column public.improvement_goals.status is
  'proposed = auto-detected, awaiting user review. active = approved + '
  'being pursued. rejected = user declined (kept for audit). Other '
  'values are lifecycle outcomes.';
