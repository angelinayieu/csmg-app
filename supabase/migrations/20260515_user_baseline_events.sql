-- Wave C — persistent user baseline + pattern memory.
--
-- Why: the Lab's simulator priors, the dashboard's orientation panel, and
-- strategy-regen's "what does this user usually accept?" loop all need a
-- persistent, per-user state row AND a unified event stream.
--
-- Currently:
--   - profiles has only display_name/tier/credits (minimal auth ext).
--   - Behaviour signals live in 6+ tables: concept_proposals.status,
--     bridges.status, improvement_goals.status (Wave A added proposed/
--     rejected), app_versions.changed_by, space_changelog, etc.
--   - No cross-surface aggregation. No persona readout.
--
-- This migration closes two gaps:
--
--   1. Extend profiles with baseline fields the digest agent (Wave C
--      cron) writes + every downstream surface reads.
--   2. Add user_events — append-only log the notify* hooks (Wave B)
--      dump into. Indexed for the digest agent's "recent events for
--      user X" query.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Extend profiles with baseline fields
-- ──────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists persona_tags text[] not null default '{}',
  -- 1-paragraph LLM summary of the user's recent behaviour. Refreshed
  -- daily by the digest cron; regeneratable on-demand via
  -- POST /api/user-baseline/regenerate.
  add column if not exists behavior_summary text,
  -- Structured hints the digest extracts — e.g. { "lean": "retention-
  -- skeptical", "cadence": "weekly", "reject_patterns": ["cognition-load"] }.
  -- Consumed by the Lab's prior-setter and strategy-refresh prompts.
  add column if not exists goal_preferences jsonb not null default '{}'::jsonb,
  -- Point-in-time snapshot of the user's baseline metrics aggregated
  -- across all their spaces. Populated by the digest cron.
  add column if not exists baseline_metrics jsonb not null default '{}'::jsonb,
  -- Digest bookkeeping — when was the behavior_summary last refreshed,
  -- and how many events have been seen since?
  add column if not exists behavior_summary_updated_at timestamptz,
  add column if not exists events_since_last_digest int not null default 0;

comment on column public.profiles.persona_tags is
  'Short tags extracted by the Wave C digest agent (e.g. "retention-focused", '
  '"early-adopter", "evidence-first"). Read by Lab prior-setter and strategy '
  'refresh prompts.';
comment on column public.profiles.behavior_summary is
  '1-paragraph natural-language summary of recent user behaviour. Updated '
  'daily by /api/cron/digest-user-behavior; regeneratable on-demand.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. user_events — the append-only telemetry stream
-- ──────────────────────────────────────────────────────────────────────
--
-- One row per user action that moves the product's state in a way the
-- digest agent should know about: goal approved/rejected, proposal
-- accepted, bridge confirmed, app refreshed, strategy applied, etc.
--
-- Write sites (Wave C wiring): the Wave B notify* hooks + a handful of
-- status-change routes (accept/reject). All writes go through
-- lib/user-events/record.ts so event_type values stay consistent.
--
-- Retention: append-only, no automatic pruning. Digest cron reads the
-- last 30d window. Manual archiving can come later when volume warrants.

create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Canonical event type. Kept as text (not enum) so new types can
  -- land without a migration — the lib's EVENT_TYPE_REGISTRY is the
  -- soft source of truth.
  event_type text not null,

  -- Where the mutation came from. Mirrors the `source` string that
  -- Wave B notify hooks already pass: "user:approve:<id>",
  -- "pipeline:decompose", "agent:researcher", etc.
  source text not null,

  -- Polymorphic reference to the subject. ref_kind is a soft label
  -- ("goal", "proposal", "bridge", "app", "canvas", "entity"); ref_id
  -- is the target row's UUID when applicable.
  ref_kind text,
  ref_id uuid,

  -- Space scope, if any. Null for cross-space or account-level events.
  space_id uuid references public.spaces(id) on delete set null,

  -- Extra structured context — varies by event_type. Small JSONB.
  payload jsonb not null default '{}'::jsonb,

  at timestamptz not null default now()
);

-- Primary query: "events for user U in last N days, newest first."
create index if not exists idx_user_events_user_at
  on public.user_events(user_id, at desc);

-- Secondary: per-event-type analytics + digest pattern queries.
create index if not exists idx_user_events_user_type_at
  on public.user_events(user_id, event_type, at desc);

-- Space-scoped filtering (e.g. "what did this user do in this space
-- recently" for the synthesis + space-lab baselines).
create index if not exists idx_user_events_space_at
  on public.user_events(space_id, at desc)
  where space_id is not null;

-- For the digest cron's "users with fresh events" query — pull the
-- most recent event per user cheaply.
create index if not exists idx_user_events_at_user
  on public.user_events(at desc, user_id);

-- ──────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.user_events enable row level security;

drop policy if exists "owner_all_user_events" on public.user_events;
create policy "owner_all_user_events" on public.user_events
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- 4. Digest bookkeeping trigger: increment events_since_last_digest on insert
-- ──────────────────────────────────────────────────────────────────────
--
-- The cron picks users by (events_since_last_digest >= threshold OR
-- behavior_summary_updated_at < 24h ago). Keeping the counter in profiles
-- rather than computed on-the-fly means the cron's candidate selection
-- is a single indexed query rather than a join over user_events.

create or replace function public.tg_bump_profile_event_count()
returns trigger language plpgsql security definer as $$
begin
  update public.profiles
    set events_since_last_digest = coalesce(events_since_last_digest, 0) + 1
    where id = new.user_id;
  return new;
end $$;

drop trigger if exists trg_bump_profile_event_count on public.user_events;
create trigger trg_bump_profile_event_count
  after insert on public.user_events
  for each row execute function public.tg_bump_profile_event_count();

comment on table public.user_events is
  'Append-only telemetry stream. Written by Wave C wired hooks (notify*, '
  'proposal resolve, bridge resolve, goal approve/reject, app refresh, etc). '
  'Read by /api/cron/digest-user-behavior to maintain profiles.persona_tags + '
  'behavior_summary + goal_preferences.';
