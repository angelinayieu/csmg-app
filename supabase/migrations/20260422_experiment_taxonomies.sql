-- ── Experiment Taxonomies (Phase 3 — VP Project report + variant coverflow) ──
--
-- The VP Project design template treats the input situation as an
-- "experiment": the user is manipulating some artifact (a prompt, a
-- routine, a recipe, a workout plan, a negotiation script, …) and
-- wants to see it decomposed into its independent-variable slots and
-- explored across multiple specialized variants.
--
-- Why taxonomy-as-data (not hardcoded slots in the widget):
-- Prompt-engineering experiments have 5 natural slots (Role / Task /
-- Context / Constraint / Rubric). A recipe experiment has Ingredients /
-- Method / Equipment / Timing / Tasting-notes. A routine experiment
-- has Trigger / Actions / Duration / Measure / Adjustment. The widget
-- must render any of these without code changes; the `slots` JSONB
-- stores the schema for the current space's experiment.
--
-- Three tables because:
--   • `experiment_taxonomies` — inferred ONCE per space by the
--     domain-inferrer agent at end-of-intake. Slow path. Immutable
--     snapshot of "how we chose to decompose this situation".
--   • `experiment_variants` — the flashcards. Multiple per space.
--     Writer-path agents materialize new rows as lab iterations
--     discover specialized configurations for different situations
--     (e.g., "for pharma patients" vs "for retail customers").
--   • `experiment_variant_slots` — per-variant, per-slot fill-in +
--     score + lift + spark history. The grid that powers the
--     DecomposedPromptViz inside the VP template.
--
-- Wiring order:
--   intake → domain_inferrer → INSERT experiment_taxonomies + emit
--     TaxonomyInferredEvent (painter spawns a taxonomy-card shape)
--   proposal → variant_factory → INSERT experiment_variants
--     (one per niche/situation) + emit VariantProposedEvent
--   lab → iv_extractor + iv_scorer → UPDATE experiment_variant_slots
--     (fills value_full, score, lift, spark_points incrementally)
--
-- RLS: own-only via space_id → spaces.user_id. All per-user; nothing
-- is shared cross-user because taxonomy inference is grounded in the
-- user's actual input text.

create table if not exists experiment_taxonomies (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,

  -- ── Domain classification ──
  -- Short machine slug chosen by the inferrer. Examples: "prompt",
  -- "recipe", "routine", "script", "plan", "generic". Free-text so new
  -- domains land without a migration; the widget palette picks a
  -- default accent from `domain_key` when none is specified.
  domain_key text not null,

  -- ── Display nouns ──
  -- What we call the thing being experimented on in this space's UI.
  -- The VP template is specifically "the prompt" / "variants" / "for
  -- these situations" — all three flex per domain.
  artifact_noun text not null default 'artifact', -- "prompt", "recipe"
  variant_noun text not null default 'variant',   -- "variant", "version"
  situation_noun text not null default 'situation', -- "situation", "cohort"

  -- ── The IV schema itself ──
  -- Array of { id, label, color, description, default_weight,
  -- ordering }. Rendered as the 5 (or N) rings in the decomposed-
  -- prompt visualization. Each variant's experiment_variant_slots
  -- rows hang off these slot ids.
  slots jsonb not null default '[]'::jsonb,

  -- ── Status + outcome vocabularies ──
  -- Which lifecycle tags make sense for this domain's variants.
  -- Prompts: ["CHAMPION", "DEPLOYED", "CANDIDATE", "ARCHIVED"].
  -- Recipes: ["WINNER", "DRAFT", "SHELVED"]. Custom per domain; the
  -- variant carousel picks colors from `status_vocabulary[i].accent`.
  status_vocabulary jsonb not null default '[]'::jsonb,

  -- Outcome axes the widgets score variants on. Prompts: tokens,
  -- quality (0..1), lift (%). Recipes: cost, health-score, prep-time.
  -- The carousel header reads this to decide which 3 KPI pills to
  -- render, and what units to format.
  outcome_axes jsonb not null default '[]'::jsonb,

  -- Audit trail for the inference itself.
  inferred_by text not null default 'domain_inferrer_v1',
  inference_confidence numeric(4, 3),
  inferred_at timestamptz not null default now(),

  -- One taxonomy per space. If a user re-runs intake on the same
  -- space we overwrite the row (taxonomy can only change if the
  -- situation changes — a new intake *is* a new situation).
  unique (space_id)
);

create index if not exists idx_experiment_taxonomies_space
  on experiment_taxonomies(space_id);

-- ── Variants (the flashcards) ────────────────────────────────────────

create table if not exists experiment_variants (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,

  -- Optional: a variant may be tied to a specific App (one per
  -- intervention-cluster). When null, the variant lives at the
  -- space level (the champion template).
  app_id uuid references apps(id) on delete set null,

  -- ── Presentation ──
  label text not null,                    -- "Comprehensive Multi-Stage"
  accent_color text not null default '#1a7aff',
  status text not null default 'CANDIDATE', -- matches status_vocabulary
  summary text,                            -- 1-line headline

  -- Short readable id shown on the card spine: "V-1", "V-2"…
  short_id text,

  -- ── Signature ──
  -- Stable hash of the concatenated slot fills, used by the ranker to
  -- detect "this is the same variant we already saw last week".
  signature text,

  -- ── Aggregate scores (denormalized for card headers) ──
  -- Cached from experiment_variant_slots; recomputed by iv_scorer
  -- whenever a slot updates. Saves the carousel from having to join
  -- and average 5-10 rows per card on every render.
  aggregate_quality numeric(5, 4),  -- 0..1
  aggregate_lift numeric(6, 3),     -- % vs. baseline
  aggregate_tokens int,             -- sum (for prompt-domain); generic N for others
  usage_count int not null default 0,

  -- Whether this variant is the currently-selected champion for its
  -- situation. Enforced per situation-key via the partial unique below.
  is_active boolean not null default false,
  situation_key text,               -- optional cohort tag like "pharma"

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_experiment_variants_space
  on experiment_variants(space_id);
create index if not exists idx_experiment_variants_app
  on experiment_variants(app_id);

-- Only one active variant per (space, situation). NULL situation_key
-- means "space-wide champion" — only one of those too.
create unique index if not exists uq_experiment_variants_active_per_situation
  on experiment_variants(space_id, coalesce(situation_key, '__space__'))
  where is_active = true;

-- ── Variant slots (the IV decomposition grid rows) ──────────────────

create table if not exists experiment_variant_slots (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references experiment_variants(id) on delete cascade,

  -- Slot id from experiment_taxonomies.slots[*].id (e.g., "role",
  -- "ingredients", "trigger"). Free-text, validated at write time.
  slot_id text not null,

  -- The actual content for this slot on this variant. `value_preview`
  -- is a 1-line teaser rendered on the carded view; `value_full` is
  -- shown on expand.
  value_preview text,
  value_full text,

  -- ── Per-slot scores ──
  -- Rendered on the DecomposedPromptViz ring labels + callouts.
  score numeric(5, 4),              -- 0..1 quality on this slot
  lift numeric(6, 3),               -- % lift from including this slot
  token_count int,                  -- domain-specific unit count
  iterations_touching int not null default 0, -- how many lab runs edited this slot
  heat numeric(4, 3),               -- 0..1 heat for the heatmap overlay
  proposal_count int not null default 0, -- # proposals that modified this slot

  -- 8-point sparkline of this slot's score over recent iterations.
  -- Array of numbers 0..1. The carousel dashboard plots these as
  -- per-slot mini-lines under each card.
  spark_points jsonb not null default '[]'::jsonb,

  -- Whether this slot is "turned on" for this variant. Some variants
  -- intentionally omit a slot (e.g., a concise prompt has no rubric);
  -- the widget dims those rings.
  is_active boolean not null default true,

  updated_at timestamptz not null default now(),

  unique (variant_id, slot_id)
);

create index if not exists idx_variant_slots_variant
  on experiment_variant_slots(variant_id);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table experiment_taxonomies enable row level security;
alter table experiment_variants enable row level security;
alter table experiment_variant_slots enable row level security;

create policy taxonomy_select_own on experiment_taxonomies for select
  using (exists (
    select 1 from spaces s
    where s.id = experiment_taxonomies.space_id
      and s.user_id = auth.uid()
  ));
create policy taxonomy_insert_own on experiment_taxonomies for insert
  with check (exists (
    select 1 from spaces s
    where s.id = experiment_taxonomies.space_id
      and s.user_id = auth.uid()
  ));
create policy taxonomy_update_own on experiment_taxonomies for update
  using (exists (
    select 1 from spaces s
    where s.id = experiment_taxonomies.space_id
      and s.user_id = auth.uid()
  ));
create policy taxonomy_delete_own on experiment_taxonomies for delete
  using (exists (
    select 1 from spaces s
    where s.id = experiment_taxonomies.space_id
      and s.user_id = auth.uid()
  ));

create policy variants_select_own on experiment_variants for select
  using (exists (
    select 1 from spaces s
    where s.id = experiment_variants.space_id
      and s.user_id = auth.uid()
  ));
create policy variants_insert_own on experiment_variants for insert
  with check (exists (
    select 1 from spaces s
    where s.id = experiment_variants.space_id
      and s.user_id = auth.uid()
  ));
create policy variants_update_own on experiment_variants for update
  using (exists (
    select 1 from spaces s
    where s.id = experiment_variants.space_id
      and s.user_id = auth.uid()
  ));
create policy variants_delete_own on experiment_variants for delete
  using (exists (
    select 1 from spaces s
    where s.id = experiment_variants.space_id
      and s.user_id = auth.uid()
  ));

create policy variant_slots_select_own on experiment_variant_slots for select
  using (exists (
    select 1 from experiment_variants v
    join spaces s on s.id = v.space_id
    where v.id = experiment_variant_slots.variant_id
      and s.user_id = auth.uid()
  ));
create policy variant_slots_insert_own on experiment_variant_slots for insert
  with check (exists (
    select 1 from experiment_variants v
    join spaces s on s.id = v.space_id
    where v.id = experiment_variant_slots.variant_id
      and s.user_id = auth.uid()
  ));
create policy variant_slots_update_own on experiment_variant_slots for update
  using (exists (
    select 1 from experiment_variants v
    join spaces s on s.id = v.space_id
    where v.id = experiment_variant_slots.variant_id
      and s.user_id = auth.uid()
  ));
create policy variant_slots_delete_own on experiment_variant_slots for delete
  using (exists (
    select 1 from experiment_variants v
    join spaces s on s.id = v.space_id
    where v.id = experiment_variant_slots.variant_id
      and s.user_id = auth.uid()
  ));

-- ── updated_at trigger for variants + slots ─────────────────────────

create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_experiment_variants_updated_at on experiment_variants;
create trigger trg_experiment_variants_updated_at
  before update on experiment_variants
  for each row execute procedure touch_updated_at();

drop trigger if exists trg_experiment_variant_slots_updated_at on experiment_variant_slots;
create trigger trg_experiment_variant_slots_updated_at
  before update on experiment_variant_slots
  for each row execute procedure touch_updated_at();
