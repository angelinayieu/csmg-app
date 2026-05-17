-- ── D-track Phase α — layer dependency cascades ─────────────────────
--
-- Records inter-layer propagation patterns within a space's ontology
-- hierarchy. Each row is a durable claim of the form:
--   "If you intervene on layer A in this space, the effect propagates
--    to layer B via {mechanism}, with strength {strength}, on lag
--    {lag_label}."
--
-- DISTINCT FROM:
--   • bridges (schema.sql:182-196) — entity↔entity / space↔space
--     coupling. Output of the weaver pass. Operates at entity
--     granularity, not layer granularity.
--   • cross_layer_analysis on synthesis_data — DETECTS layer tensions
--     (e.g. internal vs external claim mismatch) but doesn't model
--     propagation dynamics.
--   • strategy_layers on StrategicRecommendation — L1-L4 REASONING
--     hierarchy (outcomes/methods/reasoning/insights). Orthogonal to
--     the ontology layers this table references.
--
-- Source: emitted by cross-layer-analysis.ts during synthesize after
-- the new cascade-prediction LLM pass (D2, lands separately). Each
-- row aggregates over many entity edges into a layer-level cascade.
--
-- Bidirectional cascades allowed (feedback loops are legitimate —
-- cognitive load can hit behaviors which loop back to cognitive
-- load). Each direction is a separate row; the unique constraint
-- below allows (A→B) and (B→A) to coexist.
--
-- Idempotent: safe to re-run.

create table if not exists public.layer_dependencies (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- FKs to layer_ontology rows. on delete cascade because dropping
  -- an ontology row should drop its dependencies — they're meaningless
  -- without their endpoints.
  from_layer_id uuid not null references public.layer_ontology(id) on delete cascade,
  to_layer_id   uuid not null references public.layer_ontology(id) on delete cascade,

  -- Propagation semantics. Closed enum so the strategy engine can
  -- branch on kind without parsing free text.
  --   causal       — A causes B (one-way mechanistic propagation)
  --   modulatory   — A scales the response of B (A doesn't drive B
  --                  alone but changes how strongly B reacts)
  --   inhibitory   — A suppresses B (negative propagation)
  --   compensatory — A buffers B against perturbation
  --   reinforcing  — A and B form a positive feedback (use with B→A
  --                  as a sibling row to fully encode the loop)
  kind text not null check (kind in (
    'causal',
    'modulatory',
    'inhibitory',
    'compensatory',
    'reinforcing'
  )),

  -- Strength of propagation, 0..1. The strategy engine multiplies
  -- this against the intervention magnitude when projecting cascades.
  strength numeric not null check (strength >= 0 and strength <= 1),

  -- Temporal — how long does a change in from_layer take to register
  -- in to_layer? Both fields nullable because the LLM can be honest
  -- about unknown lag without guessing.
  --   lag_label — human-readable: "minutes", "weeks", "months",
  --               "unclear", "varies by individual"
  --   lag_hours — machine-readable estimate when the LLM is confident
  --               enough to commit a number (used by trajectory-fan
  --               projection math)
  lag_label text,
  lag_hours numeric check (lag_hours is null or lag_hours >= 0),

  -- LLM-emitted reasoning + evidence (free-text by design — structured
  -- citations are a future ticket).
  mechanism text not null,
  evidence_summary text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),

  -- Provenance
  --   llm_inferred     — from synthesize-stage cascade prompt (default)
  --   user_authored    — user manually added via editor (future ticket)
  --   evidence_derived — derived from evidence_registries rows (future)
  --   hybrid           — llm_inferred row subsequently edited by user
  source text not null check (source in (
    'llm_inferred',
    'user_authored',
    'evidence_derived',
    'hybrid'
  )),
  source_synthesis_step text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A layer can't cascade to itself at this aggregation level.
  -- Intra-layer feedback exists at the entity level and is encoded in
  -- the edges/cycles tables — this table is strictly inter-layer.
  constraint distinct_endpoints check (from_layer_id <> to_layer_id),

  -- One row per (space, from_layer, to_layer) direction. Allows
  -- bidirectional cascades as two rows (A→B and B→A) without
  -- requiring a separate "loop" record.
  unique (space_id, from_layer_id, to_layer_id)
);

create index if not exists idx_layer_dependencies_space
  on public.layer_dependencies(space_id);
create index if not exists idx_layer_dependencies_from
  on public.layer_dependencies(from_layer_id);
create index if not exists idx_layer_dependencies_to
  on public.layer_dependencies(to_layer_id);

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.layer_dependencies enable row level security;

drop policy if exists "layer_dependencies_owner" on public.layer_dependencies;
create policy "layer_dependencies_owner" on public.layer_dependencies
  for all using (auth.uid() = user_id);

-- ── updated_at trigger ─────────────────────────────────────────────
create or replace function public.set_layer_dependencies_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_layer_dependencies_updated_at on public.layer_dependencies;
create trigger trg_layer_dependencies_updated_at
  before update on public.layer_dependencies
  for each row execute function public.set_layer_dependencies_updated_at();

comment on table public.layer_dependencies is
  'Inter-layer propagation cascades within a space ontology. Each row aggregates many entity-level edges into one layer→layer relationship with cascade semantics (mechanism, strength, lag, confidence). Distinct from the bridges table which operates at entity granularity. Emitted by the synthesize-stage cascade-prediction LLM pass; consumed by the strategy engine to condition variant generation on cross-layer effects and by the LayerStackShape to render dependency arrows on canvas.';
