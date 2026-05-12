-- ── Edges causal_status (Schema dep #5 from environment-definition.ts) ──
--
-- Adds an explicit causal-validity tag to every edge so the simulator
-- and the environment page can distinguish:
--
--   established_causal  — supported by RCT, IV, or strong mechanistic
--                         evidence; the simulator can propagate at
--                         full strength.
--   plausible_causal    — biologically/structurally plausible but
--                         identified from observational designs only;
--                         simulator should propagate but with
--                         reduced trust weight.
--   correlational_only  — measured association without causal
--                         identification; propagating as if causal
--                         is a category error. Simulator should
--                         either skip or apply stiff downweight, and
--                         the UI should warn.
--
-- Rationale:
--   The Pearl causal hierarchy (association → intervention →
--   counterfactual) is not enforced by the codebase today. Every
--   edge that carries an effect_size gets propagated as if it were
--   causal, regardless of how the effect_size was derived. For a
--   medical/cognitive domain where observational and RCT evidence
--   are mixed, this systematically overstates predicted causal
--   effects and obscures the real fidelity of the model. This
--   column is the load-bearing fix.
--
-- Backfill heuristic:
--   Existing rows get classified based on their (dimension, confidence,
--   temporal_evidence_count) tuple. The heuristic is conservative —
--   when in doubt, leaves causal_status NULL so the aggregator
--   falls back to its documented default rather than mislabeling.
--
--   dimension='causal' AND confidence >= 0.75 AND
--     temporal_evidence_count >= 2          → established_causal
--   dimension='causal' AND confidence >= 0.5 → plausible_causal
--   dimension='causal' AND lower confidence  → plausible_causal
--   dimension='correlational'                → correlational_only
--   dimension IN ('structural','temporal','functional','logical',
--                 'epistemic','comparative','agentive')
--                                            → NULL (not classified;
--                                              these are not first-
--                                              order causal claims)
--
-- A separate research pass can refine these labels over time by
-- examining evidence_registries.study_design and effect_metric.
--
-- Read by:
--   - src/lib/environment/aggregate-environment-definition.ts
--     (TransitionDynamics.by_causal_status counter)
--   - Future simulator-side downweight at
--     src/lib/simulation/monte-carlo.ts when correlational_only
--     edges are encountered

-- ── Add column ──
alter table public.edges
  add column if not exists causal_status text;

-- ── Constraint ──
alter table public.edges
  drop constraint if exists edges_causal_status_check;

alter table public.edges
  add constraint edges_causal_status_check
  check (
    causal_status is null
    or causal_status in (
      'established_causal',
      'plausible_causal',
      'correlational_only'
    )
  );

-- ── Comment ──
comment on column public.edges.causal_status is
  'Causal-validity tier per the Pearl hierarchy. Drives simulator '
  'trust weighting and UI causal-vs-correlational badging. Spec: '
  'src/types/environment-definition.ts schema dep #5.';

-- ── Backfill — conservative heuristic ──
update public.edges
set causal_status = case
  when dimension = 'causal'
       and confidence >= 0.75
       and temporal_evidence_count >= 2
       and is_low_confidence = false
    then 'established_causal'
  when dimension = 'causal'
       and confidence >= 0.5
       and is_low_confidence = false
    then 'plausible_causal'
  when dimension = 'causal'
    then 'plausible_causal'
  when dimension = 'correlational'
    then 'correlational_only'
  else null
end
where causal_status is null;

-- ── Indexes ──
-- Cheap "give me only causal edges" filter for simulator + page.
create index if not exists edges_causal_status_idx
  on public.edges (space_id, causal_status)
  where causal_status is not null;

-- Targeted "find correlational edges flagged as warning candidates"
-- query for the strategy / lab UIs.
create index if not exists edges_correlational_warning_idx
  on public.edges (space_id)
  where causal_status = 'correlational_only';
