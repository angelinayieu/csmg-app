-- ── Evidence registry — first L2M-style rigor primitive ─────────────
--
-- This is the foundation for the "scientifically rigorous side" the
-- product needs alongside the consumer-friendly intake. It stores
-- effect sizes (and other quantitative findings) extracted from
-- research artifacts (PDFs, structured CSVs, manually entered trial
-- data) with FULL provenance so downstream Bayesian / heterogeneity
-- pipelines can consume them without re-extraction.
--
-- DESIGN DISCIPLINE — DOMAIN-AGNOSTIC
--
-- This table must work for ANY mind-body modeling domain (CRCI,
-- ADHD, sleep, nutrition, exercise science, …) and any other
-- causal-evidence problem. So:
--
--   1. No CRCI-specific column names. `outcome_label` not
--      `cognitive_score`; `intervention_label` not `chemo_intervention`.
--   2. Categorical fields that vary per domain (study design, effect
--      metric, instrument) are TEXT + a soft check constraint or a
--      separate registry row reference — NEVER hardcoded enums in DDL.
--   3. The L2M trust boundary (LLM labels vs deterministic parsers)
--      is preserved at column granularity:
--        - llm_label_provenance JSONB    — what the LLM SAID
--        - parser_provenance    JSONB    — what the deterministic
--                                          parser EXTRACTED
--      Auditability requires both halves. A reviewer can see "LLM
--      labelled this span as effect_size, parser ran 'cohens_d_v1'
--      and got 0.42 [0.18, 0.66]."
--   4. The processing PLAN that produced this row is referenced via
--      `processing_plan_id` (nullable until the planner ships).
--      Future planner-dispatcher wires this; today it's null.
--
-- LIFECYCLE
--
--   pending  → row created when extraction job kicked off; numeric
--              fields nullable.
--   extracted → primitive completed, numeric fields populated; the
--              evidence is usable downstream but un-reviewed.
--   reviewed → a human (researcher / clinician) has approved the row.
--              Required gate before the row participates in any
--              "rigorous" downstream computation (prior selection,
--              meta-pooling, etc.).
--   rejected → reviewer marked the extraction as wrong; row stays
--              for audit but is excluded from downstream consumers.
--   superseded → newer extraction replaces this one (supersedes_id
--                links the old row).
--
-- BACKWARD-COMPAT / FUTURE
--
-- This is a NEW table. It does not modify existing entities/edges.
-- Downstream consumers (heterogeneity pooling, prior selection,
-- dose-response fitting, etc.) will land in subsequent migrations
-- that add foreign-key columns referencing evidence_registries.id —
-- this table is the substrate they all rest on.
--
-- A separate `instrument_registry` and `intervention_kernel_registry`
-- are referenced by `instrument_id` / `intervention_kernel_id` — both
-- nullable for v1 (we'll add those tables in a follow-up migration so
-- effect-size extraction can ship before the broader registry stack
-- is built out). Today the natural-language `instrument_label` and
-- `intervention_label` carry the human-readable name.

-- ── Table ──

create table if not exists public.evidence_registries (
  id uuid primary key default gen_random_uuid(),
  -- Scoping. evidence is per-space (multi-tenant isolation matches
  -- every other registry-style table in the codebase) and optionally
  -- attaches to a specific ingested_file (the source PDF / CSV / etc.).
  space_id uuid not null references public.spaces(id) on delete cascade,
  ingested_file_id uuid references public.ingested_files(id) on delete set null,
  -- Optional link to an entity in the KG that this evidence
  -- substantiates. Many evidence rows can attach to one entity (e.g.
  -- 5 trials measuring "working memory after CR"). When null, the
  -- evidence is "unattached" — usable but not yet routed into the
  -- entity it bears on.
  attached_entity_id uuid references public.entities(id) on delete set null,

  -- ── Lifecycle ──
  status text not null default 'pending',
  -- The processing plan that produced this row. Null until the
  -- planner-dispatcher ships; once it does, reviewers can trace any
  -- evidence row back to the PRIMITIVES + ARGS that produced it.
  processing_plan_id uuid,

  -- ── What was measured ──
  -- Free-text labels (NOT enums) so any domain can populate without
  -- DDL changes. Future tightening: foreign keys to instrument_registry
  -- + intervention_kernel_registry once those tables land.
  outcome_label text,
  instrument_label text,
  instrument_id uuid,            -- fk → instrument_registry (future)
  intervention_label text,
  intervention_kernel_id uuid,   -- fk → intervention_kernel_registry (future)
  comparator_label text,
  population_label text,         -- "post-chemo BC patients", "older adults", "shift workers"

  -- ── Effect size + uncertainty ──
  effect_size numeric,
  effect_metric text,            -- "cohens_d" | "hedges_g" | "smd" | "rr" | "or" | "raw_mean_diff" | "beta" | …
  ci_lower numeric,
  ci_upper numeric,
  ci_level numeric,              -- 0.95 | 0.99 | …  Stored as a number so non-95% intervals are unambiguous.
  -- p_value is captured but not load-bearing — for Bayesian inference
  -- we use the CI / SE directly. Stored for completeness + reviewer
  -- sanity-checking.
  p_value numeric,
  -- Standard error of the effect, when reported directly. Inferred
  -- from CI when not. Either field lets the heterogeneity pipeline
  -- compute precision weights without re-parsing.
  standard_error numeric,
  n_treatment integer,
  n_control integer,
  -- Followup window the effect was measured at. Critical for
  -- temporal-recovery models — same intervention can have very
  -- different effects at 4 vs 26 weeks. Free text + structured weeks
  -- so the parser can normalize but the original phrasing is kept.
  followup_weeks numeric,
  followup_label text,           -- "8 weeks", "post-treatment", "1 year follow-up"

  -- ── Study design ──
  -- Open-vocabulary so domain-specific designs (e.g. wearable
  -- micro-randomized trials) don't require enum migrations. A check
  -- constraint catches obvious typos; downstream prior-selection
  -- consults a soft-coded mapping.
  study_design text,             -- "RCT" | "meta_analysis" | "observational" | "case_series" | …
  blinding text,                 -- "double_blind" | "single_blind" | "open_label" | "unclear" | null

  -- ── Source provenance (where in the artifact) ──
  source_page integer,
  source_bbox jsonb,             -- {page, x0, y0, x1, y1} when extractable
  source_quote text,             -- verbatim span the LLM labelled
  source_table_html text,        -- when extracted from a table

  -- ── Trust boundary: LLM half ──
  -- What the LLM SAID, separated from what the parser DID. Required
  -- by the L2M extraction discipline — auditors must be able to see
  -- the LLM's claim independently of any deterministic post-parsing.
  llm_label_provenance jsonb,    -- {model, prompt_hash, span_id, raw_label, llm_confidence}

  -- ── Trust boundary: parser half ──
  -- What the deterministic parser EXTRACTED from the LLM-labelled
  -- span. Includes which parser module + version ran, which rule
  -- fired, the raw matched substring, and any flags the parser
  -- raised (unit-ambiguous, n-unclear, metric-inferred, …).
  parser_provenance jsonb,       -- {module, version, rule_fired, raw_match, flags[]}

  -- ── Confidence + flags ──
  -- 0..1, combined LLM × parser confidence. Drives the drawer's
  -- "high confidence" / "needs review" badging. Not a substitute
  -- for the per-half provenance — this is just a roll-up.
  extraction_confidence numeric check (
    extraction_confidence is null
    or (extraction_confidence >= 0 and extraction_confidence <= 1)
  ),
  -- Free-form tags: "unit_ambiguous", "n_inferred", "metric_inferred",
  -- "ci_back_calculated_from_p", "extracted_from_figure_ocr", …
  flags text[] not null default '{}'::text[],

  -- ── Review ──
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_notes text,
  -- When set, this row replaces an older row (e.g. re-extraction with
  -- a better parser). Self-referential nullable FK.
  supersedes_id uuid references public.evidence_registries(id) on delete set null,

  -- ── Audit ──
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Constraints ──

-- Enum-like check on status. Soft (text) so future statuses can be
-- added without rewriting; check enforces the current vocabulary.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_status_check;

alter table public.evidence_registries
  add constraint evidence_registries_status_check
  check (status in (
    'pending',
    'extracted',
    'reviewed',
    'rejected',
    'superseded'
  ));

-- CI bounds sanity (when both present, lower must be <= upper).
alter table public.evidence_registries
  drop constraint if exists evidence_registries_ci_bounds_check;

alter table public.evidence_registries
  add constraint evidence_registries_ci_bounds_check
  check (
    ci_lower is null
    or ci_upper is null
    or ci_lower <= ci_upper
  );

-- ci_level sanity (0 < x <= 1; we accept 0.5..1.0 in practice).
alter table public.evidence_registries
  drop constraint if exists evidence_registries_ci_level_check;

alter table public.evidence_registries
  add constraint evidence_registries_ci_level_check
  check (
    ci_level is null
    or (ci_level > 0 and ci_level <= 1)
  );

-- Sample-size sanity.
alter table public.evidence_registries
  drop constraint if exists evidence_registries_n_check;

alter table public.evidence_registries
  add constraint evidence_registries_n_check
  check (
    (n_treatment is null or n_treatment >= 0)
    and (n_control is null or n_control >= 0)
  );

-- ── Indexes ──

-- Standard space-scoped lookup. The drawer's "list all evidence
-- in this space" query hits this.
create index if not exists evidence_registries_space_id_idx
  on public.evidence_registries (space_id, created_at desc);

-- Per-asset rollup: "show me every effect size extracted from this
-- PDF." Hits this.
create index if not exists evidence_registries_asset_idx
  on public.evidence_registries (ingested_file_id)
  where ingested_file_id is not null;

-- Per-entity rollup: "every piece of evidence attached to entity X."
-- Drives the entity-detail drawer's evidence tab.
create index if not exists evidence_registries_entity_idx
  on public.evidence_registries (attached_entity_id)
  where attached_entity_id is not null;

-- "Needs review" partial index — drives the chrome badge counter.
create index if not exists evidence_registries_pending_review_idx
  on public.evidence_registries (space_id, created_at desc)
  where status = 'extracted' and reviewed_by is null;

-- GIN on flags so "find every row with flag=unit_ambiguous" is fast
-- without sequential scan.
create index if not exists evidence_registries_flags_gin_idx
  on public.evidence_registries using gin (flags);

-- ── updated_at trigger ──

create or replace function public.evidence_registries_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists evidence_registries_set_updated_at on public.evidence_registries;
create trigger evidence_registries_set_updated_at
  before update on public.evidence_registries
  for each row execute function public.evidence_registries_set_updated_at();

-- ── RLS ──

alter table public.evidence_registries enable row level security;

-- Read: any user who owns the parent space.
create policy "evidence_registries select own space"
  on public.evidence_registries for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = evidence_registries.space_id
        and s.user_id = auth.uid()
    )
  );

-- Insert: only the space owner can insert. (Service role bypasses
-- RLS entirely; pipeline writes go through service role like the
-- rest of the registry-side tables.)
create policy "evidence_registries insert own space"
  on public.evidence_registries for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.spaces s
      where s.id = evidence_registries.space_id
        and s.user_id = auth.uid()
    )
  );

-- Update: space owner can update (review, mark rejected, edit
-- numeric values). Audit trail lives in the row itself
-- (reviewed_by / reviewed_at / supersedes_id) plus updated_at.
create policy "evidence_registries update own space"
  on public.evidence_registries for update
  using (
    exists (
      select 1 from public.spaces s
      where s.id = evidence_registries.space_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = evidence_registries.space_id
        and s.user_id = auth.uid()
    )
  );

-- Delete: space owner only. Reviews + supersession are the preferred
-- way to "remove" an extraction (preserves audit trail), but hard
-- delete is allowed for owner.
create policy "evidence_registries delete own space"
  on public.evidence_registries for delete
  using (
    exists (
      select 1 from public.spaces s
      where s.id = evidence_registries.space_id
        and s.user_id = auth.uid()
    )
  );

-- ── Comments ──

comment on table public.evidence_registries is
  'L2M-style evidence registry. Stores effect sizes + uncertainty + study design + full provenance (LLM half + deterministic-parser half) extracted from research artifacts. Domain-agnostic: works for any mind-body modeling domain. Foundation for downstream Bayesian / heterogeneity / prior-selection / dose-response pipelines (each will reference this table via FK).';

comment on column public.evidence_registries.llm_label_provenance is
  'L2M trust boundary, LLM half. JSONB shape: {model, prompt_hash, span_id, raw_label, llm_confidence}. Records what the LLM SAID, separately from what the deterministic parser DID. Required for audit.';

comment on column public.evidence_registries.parser_provenance is
  'L2M trust boundary, parser half. JSONB shape: {module, version, rule_fired, raw_match, flags[]}. Records the deterministic post-parse step that turned the LLM-labelled span into a numeric value. Required for audit.';

comment on column public.evidence_registries.processing_plan_id is
  'Reference to the processing plan that produced this row (planner-dispatcher artifact). Null until the planner ships; once it does, every evidence row traces back to the primitive + args that produced it.';

comment on column public.evidence_registries.status is
  'Lifecycle: pending → extracted → reviewed | rejected | superseded. Only "reviewed" rows participate in rigorous downstream computation (prior selection, meta-pooling, dose-response fitting).';

comment on column public.evidence_registries.flags is
  'Free-form parser flags surfaced for reviewer attention: unit_ambiguous, n_inferred, metric_inferred, ci_back_calculated_from_p, extracted_from_figure_ocr, etc.';
