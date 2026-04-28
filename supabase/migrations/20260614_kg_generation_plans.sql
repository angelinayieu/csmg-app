-- ── KG Generation Plans — the contract surface ─────────────────────
--
-- This is the user-reviewable PLAN that describes everything the
-- pipeline is about to do BEFORE it runs. The plan is a contract:
-- the user reviews + approves (or edits + approves), and downstream
-- stages read their config from the approved plan rather than from
-- silent defaults.
--
-- Why this exists (the "Drift 3" fix):
--   The pipeline currently auto-fires on whiteboard input. ~12 silent
--   decisions get made (lens selection, axis catalog defaults, depth
--   tier, layer-gate bypass, situation-analyzer skip, …). Researchers
--   need agency over those decisions — that's the difference between
--   a tool they trust and a black box.
--
-- Relationship to existing infrastructure:
--   • spaces.situation_frame (JSONB) — already holds the 4×5 cell
--     grid + AxisProposal[] + divergences + gate_status. The PLAN
--     INCLUDES the resolved situation_frame in `resolved_situation_frame`
--     when approved; pre-approval the planner-agent's draft frame
--     lives in `situation_frame_draft`.
--   • spaces.reasoning_settings (JSONB) — already holds depth, lenses,
--     toggles. The PLAN OVERRIDES these on approval (snapshot-then-
--     freeze: approved plan's settings become the active settings).
--
-- The plan adds what situation_frame does NOT cover:
--   1. Custom per-space LAYER ONTOLOGY (replacing the hardcoded
--      4-value knowledge_layer enum). For mind-body cognition you
--      want Molecular → Circuit → Cognitive → Behavioral → Performance;
--      for sleep optimization you want Circadian → Autonomic →
--      Cognitive → Behavioral. Per-space configurable.
--   2. Custom topic-adaptive AXES (replacing the 8 generic catalog
--      axes financial/timeline/actors/etc.). For "cognitive
--      performance optimization" the planner proposes axes like
--      Methodology / Cognitive Domains / Bell-Curve Dynamics /
--      Statistical Techniques.
--   3. RESEARCH PLAN — per-paper coverage map (which paper covers
--      which conceptual region, extraction order, gaps).
--   4. METHODOLOGY DISCLOSURE — parser versions, trust-boundary
--      explanation, prior selection strategy, dose-response model
--      defaults, heterogeneity layers active. Researcher mode shows
--      this; consumer mode hides it.
--   5. CONCEPTUAL SKELETON preview — anticipated node clusters +
--      counts so the user knows what they're about to get.
--   6. LIMITATIONS — what won't be extractable with current parsers,
--      known coverage gaps, where the planner itself is uncertain.
--
-- Lifecycle:
--   draft     → planner-agent generated, not yet shown to user
--   proposed  → shown in Plan Review Card, awaiting user
--   edited    → user modified one or more sections
--   approved  → user approved; pipeline gate releases; plan becomes
--               the contract that drives downstream stages
--   rejected  → user discarded; pipeline halts
--   superseded → a newer plan version replaces this one (supersedes_id
--                links the old plan)
--
-- Multiple plans per space:
--   The user can iterate. Each iteration creates a new row with a
--   bumped `version` and `supersedes_id` pointing at the prior plan.
--   `spaces.active_plan_id` always points at the most recently
--   approved plan; older plans stay for audit + comparison.
--
-- Domain-agnostic discipline (matches evidence_registries):
--   • No domain-specific column names (no "cognitive_layers",
--     "intervention_protocols"). Generic structure that works for
--     any KG generation problem.
--   • Section payloads are JSONB — TS types in src/types/
--     kg-generation-plan.ts are the source of truth.
--   • Soft enums (text + check) so future statuses can be added
--     without DDL changes.

-- ──────────────────────────────────────────────────────────────────
-- Pre-flight dependency guards
-- ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='spaces') then
    raise exception 'kg_generation_plans migration requires spaces table';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='ingested_files') then
    raise exception 'kg_generation_plans migration requires ingested_files table';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 1. kg_generation_plans — the comprehensive plan
-- ──────────────────────────────────────────────────────────────────

create table if not exists public.kg_generation_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- ── Versioning ──
  -- Plans are iterable. version 1 is the initial proposal; subsequent
  -- versions land when the user re-runs planning (e.g. after adding
  -- new papers). supersedes_id chains them so we can reconstruct the
  -- plan history for a space.
  version integer not null default 1,
  supersedes_id uuid references public.kg_generation_plans(id) on delete set null,

  -- ── Lifecycle ──
  status text not null default 'draft',
  -- The mode the plan was generated for. Drives which sections render
  -- in the Plan Review Card (consumer hides methodology disclosure;
  -- researcher shows everything; clinician sits between).
  mode text not null default 'researcher',

  -- ── Approval audit ──
  proposed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,

  -- ── Plan body — sections (all JSONB; TS types canonical) ──

  -- Section A: Scope & objectives
  -- {goal_verbatim, goal_parsed: {primary_objective, target_outcomes[],
  --   constraints[], domain_classification: {label, confidence,
  --   alternatives[]}}, success_criteria}
  scope_and_objectives jsonb,

  -- Section B: Layer ontology proposal
  -- {layers: [{ordinal, label, slug, description, color, why_included,
  --   typical_node_kinds[]}], ontology_source: "starter" | "research_agent"
  --   | "user_authored", source_metadata: {...starter_id or research_trace}}
  -- On approval, materialized into the layer_ontology table.
  layer_ontology_proposal jsonb,

  -- Section C: Custom axes (replaces hardcoded catalog defaults)
  -- {axes: [{name, slug, definition, rationale, target_cells[],
  --   generator_strategy, dimension_hint, instrument_kind_hint,
  --   output_shape_hint, estimated_token_cost}],
  --   axis_source: "plan_generated" | "catalog_extension" | "hybrid"}
  axis_proposals jsonb,

  -- Section D: Conceptual skeleton — what KG to expect
  -- {anticipated_clusters: [{layer_slug, label, expected_node_count,
  --   expected_node_kinds[], example_nodes[]}],
  --   estimated_total_nodes, estimated_total_edges,
  --   estimated_cycles, estimated_communities}
  conceptual_skeleton jsonb,

  -- Section E: Research plan — per-paper coverage map
  -- {papers: [{ingested_file_id, title, anticipated_coverage_layers[],
  --   anticipated_coverage_axes[], expected_effect_size_count,
  --   extractable_with_current_parsers: bool, parser_match_reasoning,
  --   flagged_for_manual_review: bool, extraction_priority}],
  --   coverage_gaps: [{layer, axis, why_uncovered, suggested_paper_kinds}],
  --   extraction_order_rationale}
  research_plan jsonb,

  -- Section F: Methodology disclosure (researcher-mode focus)
  -- {active_parsers: [{module, version, handles_metrics[], known_limits}],
  --   trust_boundary_explanation,
  --   prior_selection_strategy: {default_tier, per_node_overrides},
  --   dose_response_defaults: {[edge_kind]: model_id},
  --   heterogeneity_handling: {layers_active[], pooling_method, tau_squared_estimator},
  --   consensus_profile_selection: {profiles_used[], disagreement_handling}}
  methodology_disclosure jsonb,

  -- Section G: Limitations + honest caveats
  -- {known_weak_parsers[], coverage_gaps_acknowledged[],
  --   what_wont_be_extractable[], planner_uncertainties[],
  --   downstream_stage_caveats: {[stage]: caveat_text}}
  limitations jsonb,

  -- ── Linkage to existing situation_frame ──
  -- Pre-approval: planner-agent's draft frame proposal.
  -- Post-approval: copied to spaces.situation_frame (the resolved frame
  -- the pipeline actually runs against).
  situation_frame_draft jsonb,
  resolved_situation_frame jsonb,

  -- ── Reasoning settings snapshot ──
  -- The reasoning_settings the plan recommends. On approval, copied to
  -- spaces.reasoning_settings (or merged, with plan-level overrides
  -- winning for fields the plan explicitly set).
  reasoning_settings_proposed jsonb,

  -- ── Compute estimate ──
  -- {tokens_estimate, wall_clock_seconds_estimate, credits_estimate,
  --   parallelizable_stages[], expensive_stages_flagged[]}
  cost_estimate jsonb,

  -- ── Confidence ──
  -- 0..1 self-rated by the planner. Surfaces in the Plan Review Card
  -- so the user knows whether to scrutinize harder.
  planner_confidence numeric check (
    planner_confidence is null
    or (planner_confidence >= 0 and planner_confidence <= 1)
  ),

  -- ── Audit ──
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Constraints ──

alter table public.kg_generation_plans
  drop constraint if exists kg_generation_plans_status_check;
alter table public.kg_generation_plans
  add constraint kg_generation_plans_status_check
  check (status in (
    'draft',
    'proposed',
    'edited',
    'approved',
    'rejected',
    'superseded'
  ));

alter table public.kg_generation_plans
  drop constraint if exists kg_generation_plans_mode_check;
alter table public.kg_generation_plans
  add constraint kg_generation_plans_mode_check
  check (mode in ('consumer', 'clinician', 'researcher'));

alter table public.kg_generation_plans
  drop constraint if exists kg_generation_plans_version_check;
alter table public.kg_generation_plans
  add constraint kg_generation_plans_version_check
  check (version >= 1);

-- One ACTIVE (approved + not superseded) plan per space at a time.
-- Implemented via partial unique index on (space_id) where status='approved'
-- and supersedes_id reverse-link is null. Multiple draft/proposed/rejected
-- plans can coexist.
create unique index if not exists kg_generation_plans_one_active_per_space
  on public.kg_generation_plans (space_id)
  where status = 'approved';

-- ── Indexes ──

create index if not exists kg_generation_plans_space_id_idx
  on public.kg_generation_plans (space_id, created_at desc);

create index if not exists kg_generation_plans_status_idx
  on public.kg_generation_plans (space_id, status);

create index if not exists kg_generation_plans_proposed_unblocked_idx
  on public.kg_generation_plans (space_id, proposed_at desc)
  where status in ('proposed', 'edited');

-- ── updated_at trigger ──

create or replace function public.kg_generation_plans_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kg_generation_plans_set_updated_at on public.kg_generation_plans;
create trigger kg_generation_plans_set_updated_at
  before update on public.kg_generation_plans
  for each row execute function public.kg_generation_plans_set_updated_at();

-- ── RLS ──

alter table public.kg_generation_plans enable row level security;

create policy "kg_generation_plans select own space"
  on public.kg_generation_plans for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = kg_generation_plans.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "kg_generation_plans insert own space"
  on public.kg_generation_plans for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.spaces s
      where s.id = kg_generation_plans.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "kg_generation_plans update own space"
  on public.kg_generation_plans for update
  using (
    exists (
      select 1 from public.spaces s
      where s.id = kg_generation_plans.space_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = kg_generation_plans.space_id
        and s.user_id = auth.uid()
    )
  );

create policy "kg_generation_plans delete own space"
  on public.kg_generation_plans for delete
  using (
    exists (
      select 1 from public.spaces s
      where s.id = kg_generation_plans.space_id
        and s.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- 2. kg_generation_plan_decisions — per-edit audit log
-- ──────────────────────────────────────────────────────────────────
--
-- Every user edit to a plan section gets a row here. This makes the
-- plan transparently accountable: we can show "the user changed
-- the layer ontology from the planner's proposal of X to Y" in the
-- review history.
--
-- Inserts are append-only (no updates). RLS allows space-owner only.

create table if not exists public.kg_generation_plan_decisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.kg_generation_plans(id) on delete cascade,

  -- Which section was edited.
  section text not null,
  -- JSONPath-ish location within the section (e.g. "layers[2].label",
  -- "axes[0].rationale"). Free-text; consumer code interprets.
  field_path text,

  -- What was there before vs after the user's edit.
  before_value jsonb,
  after_value jsonb,

  -- Optional reason the user gave for the edit. Surfaced in the
  -- review history.
  reason text,

  changed_by uuid not null references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.kg_generation_plan_decisions
  drop constraint if exists kg_generation_plan_decisions_section_check;
alter table public.kg_generation_plan_decisions
  add constraint kg_generation_plan_decisions_section_check
  check (section in (
    'scope_and_objectives',
    'layer_ontology_proposal',
    'axis_proposals',
    'conceptual_skeleton',
    'research_plan',
    'methodology_disclosure',
    'limitations',
    'situation_frame_draft',
    'reasoning_settings_proposed',
    'mode',
    'cost_estimate',
    'other'
  ));

create index if not exists kg_generation_plan_decisions_plan_idx
  on public.kg_generation_plan_decisions (plan_id, changed_at desc);

alter table public.kg_generation_plan_decisions enable row level security;

create policy "plan_decisions select own plan"
  on public.kg_generation_plan_decisions for select
  using (
    exists (
      select 1 from public.kg_generation_plans p
      join public.spaces s on s.id = p.space_id
      where p.id = kg_generation_plan_decisions.plan_id
        and s.user_id = auth.uid()
    )
  );

create policy "plan_decisions insert own plan"
  on public.kg_generation_plan_decisions for insert
  with check (
    changed_by = auth.uid()
    and exists (
      select 1 from public.kg_generation_plans p
      join public.spaces s on s.id = p.space_id
      where p.id = kg_generation_plan_decisions.plan_id
        and s.user_id = auth.uid()
    )
  );

-- No update / delete policies — decisions are append-only audit log.

-- ── Comments ──

comment on table public.kg_generation_plans is
  'User-reviewable plan describing everything the KG-generation pipeline is about to do. Plan is a contract: user approves and downstream stages read config from the approved plan rather than silent defaults. Wraps + extends the existing situation_frame on spaces with: custom per-space layer ontology, topic-adaptive axes, research plan, methodology disclosure, conceptual skeleton preview, limitations.';

comment on column public.kg_generation_plans.layer_ontology_proposal is
  'Per-space layer ontology proposed by planner. Replaces hardcoded knowledge_layer enum (internal/conceptual/external/bridge). For mind-body cognition: Molecular → Circuit → Cognitive → Behavioral → Performance. For sleep: Circadian → Autonomic → Cognitive → Behavioral. On approval, materialized into layer_ontology table.';

comment on column public.kg_generation_plans.axis_proposals is
  'Topic-adaptive axes replacing hardcoded catalog (financial/timeline/actors/...). For "cognitive performance" topic: Methodology / Cognitive Domains / Measurement / Interventions / Bell-Curve Dynamics / Baseline Calibration / Statistical Techniques.';

comment on column public.kg_generation_plans.research_plan is
  'Per-paper coverage map — which paper covers which conceptual region, extraction order, gaps where no paper is available, suggested additional sources to fill gaps.';

comment on column public.kg_generation_plans.methodology_disclosure is
  'Researcher-mode disclosure: active parser versions, trust-boundary explanation, prior selection strategy, dose-response model defaults, heterogeneity layers, consensus profile selection. Hidden in consumer mode.';

comment on column public.kg_generation_plans.resolved_situation_frame is
  'Snapshot of the SituationFrame as approved. On approval this gets copied to spaces.situation_frame, freezing the framing decisions the pipeline will run against.';

comment on column public.kg_generation_plans.reasoning_settings_proposed is
  'Reasoning settings the plan proposes. On approval, merged into spaces.reasoning_settings with plan-level overrides winning for fields the plan explicitly set.';

comment on table public.kg_generation_plan_decisions is
  'Append-only audit log of every user edit to a plan section. Makes the plan transparently accountable in the review history.';
