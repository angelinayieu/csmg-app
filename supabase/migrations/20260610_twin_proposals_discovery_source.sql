-- ── D2 · Closing the simulation→KG loop ──────────────────────────────
--
-- D2 in docs/KG_DEPTH_CRITIQUE.md: today simulations consume the KG
-- read-only — convergent points, what-if results, combination panel
-- findings all materialize as auxiliary rows but never write back to
-- entities/edges. This migration adds the substrate for the FIRST
-- structural change: high-confidence simulation outputs are auto-
-- proposed into the existing `twin_proposals` queue (NOT a new table —
-- per docs/KG_DEPTH_CRITIQUE.md and the audit, parallel proposal
-- subsystems are exactly the kind of structure-creep we're avoiding).
--
-- Two new columns on twin_proposals:
--
--   discovery_source  text  Discriminator for "where did this
--                           proposal originate?" Today's strategy
--                           proposals leave it null. D2 sets it to
--                           one of:
--                             - convergent_point  (interactor → focal
--                               relationships promoted to edges)
--                             - what_if           (high-impact
--                               affected entities promoted to edges)
--                             - combination       (panel-discovered
--                               emergent reactions promoted to edges
--                               or new entities)
--                             - interaction_probe (D4 follow-up;
--                               multi-way interaction-effect
--                               discoveries)
--
--   convergent_point_id  uuid  Optional FK to convergent_points(id)
--                              when discovery_source =
--                              "convergent_point". ON DELETE SET
--                              NULL so deleting a stale convergent
--                              point doesn't cascade-nuke the
--                              approval history.
--
-- Why no new table:
--   The audit (docs/KG_DEPTH_CRITIQUE.md §2) confirmed that
--   twin_proposals already has the lifecycle (proposed | refined |
--   approved | rejected), audit fields (generated_at, approved_at,
--   rejected_at), RLS, and JSONB justification flexibility we need.
--   A separate `kg_discovery_proposals` table would create exactly
--   the parallel subsystem the user has explicitly flagged as
--   structure-rot. Proposed entities + edges live inside the
--   `justification` JSONB blob:
--
--     {
--       "discovery_source": "convergent_point",
--       "convergent_point_id": "<uuid>",
--       "confidence": 0.87,
--       "probability": 0.72,
--       "rationale": "<prose>",
--       "proposed_action_list": [<ScenarioAction>...],
--       "generated_at": "<ISO>"
--     }
--
--   When the user approves, a follow-up route (D2 phase 2) takes
--   `proposed_action_list`, creates a `scenarios` row, and runs
--   commit-scenario.ts to apply it to live KG. This first cut just
--   ships the propose path.
--
-- Indexes:
--   - Partial on (space_id, discovery_source) WHERE discovery_source
--     IS NOT NULL — for "show me all the discovery proposals" queries
--     without scanning strategy proposals.
--   - On convergent_point_id WHERE NOT NULL — for the back-reference
--     "did this convergent point already get proposed?" idempotency
--     check the materializer needs.

alter table public.twin_proposals
  add column if not exists discovery_source text;

alter table public.twin_proposals
  add column if not exists convergent_point_id uuid
    references public.convergent_points(id) on delete set null;

-- Constrain discovery_source to the canonical set. Null is allowed
-- (preserves back-compat for existing strategy proposals).
alter table public.twin_proposals
  drop constraint if exists twin_proposals_discovery_source_check;

alter table public.twin_proposals
  add constraint twin_proposals_discovery_source_check
  check (
    discovery_source is null
    or discovery_source in (
      'convergent_point',
      'what_if',
      'combination',
      'interaction_probe'
    )
  );

create index if not exists twin_proposals_discovery_source_idx
  on public.twin_proposals (space_id, discovery_source)
  where discovery_source is not null;

create index if not exists twin_proposals_convergent_point_id_idx
  on public.twin_proposals (convergent_point_id)
  where convergent_point_id is not null;

comment on column public.twin_proposals.discovery_source is
  'D2 · null for strategy-derived proposals, set to one of {convergent_point, what_if, combination, interaction_probe} when this proposal originated from a simulation discovery being promoted to live KG. See src/lib/pipeline/discovery-materializer.ts.';

comment on column public.twin_proposals.convergent_point_id is
  'D2 · back-ref to the convergent_points row that triggered this proposal. ON DELETE SET NULL so stale convergent points don''t orphan approval history. Used for idempotency: discovery-materializer skips convergent points that already have a proposal row.';
