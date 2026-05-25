-- ── Room v2 — 3-layer causal chain + influence rank + short titles ──
--
-- For Objective Canvas room cards we need to surface (pain): the
-- pain itself (effect), the negative outcome it leads to, and the
-- root causes underneath. Mirror for features: title, positive
-- outcome, first principles. Per-entity influence_rank (LLM
-- self-assessed centrality) drives the lane sort + Root ⭐ badge.
--
-- All packed into a single jsonb so we don't sprawl new columns.
-- Old entities (pre-v2) stay null and the card falls back to
-- the legacy description.

alter table public.entities
  add column if not exists causal_chain jsonb;

comment on column public.entities.causal_chain is
  'Objective Canvas room v2 — per-entity 3-layer chain. Shape varies by entity_type: pain_point {negative_outcome, root_causes[], influence_rank}; feature {positive_outcome, first_principles[], addresses_pains[]}; outcome {measured_by}; objective_anchor {}. Null for legacy entities.';

-- improvement_goals additions: the LLM-distilled short title for
-- the core objective (shown by default on the main canvas with
-- show-full toggle); the room-level top negative outcome that
-- synthesizes across pains and anchors the room header.

alter table public.improvement_goals
  add column if not exists short_title text;
comment on column public.improvement_goals.short_title is
  'LLM-distilled 4-8 word version of the full objective text. Shown by default on the main canvas; the full description is one click away. Null falls back to the existing title field.';

alter table public.improvement_goals
  add column if not exists top_negative_outcome text;
comment on column public.improvement_goals.top_negative_outcome is
  'Sub-objective room anchor: the single most-impactful downstream consequence of all the room''s pain points, synthesized after stage A. Renders below the sub-objective title as "Counters: {top_negative_outcome}".';
