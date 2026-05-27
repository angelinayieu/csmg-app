-- Phase 11.4 — Causal Chain Enrichment.
--
-- Adds one new decision-log action: `chains_enriched`.
--
-- The action fires from POST /api/brainstorm/room/[subId]/enrich-chains
-- (also triggered automatically during canvas autopilot's enrichment
-- step). One event per room per enrichment run. Metadata carries:
--   • chain_count          — chains enriched in this run
--   • new_chains_count     — complementary chains created for orphans
--   • avg_chain_strength   — mean of chain_strength across enriched
--                            chains (the key signal for "how good is
--                            this room's causal scaffolding")
--   • orphans_closed       — count of previously-unaddressed items now
--                            touched by a chain
--
-- All chain enrichment data (narrative, mediators, chain_strength,
-- causal_flow_rationale, outcome_closes_loop, weak_points) lives on
-- the existing `edges.agent_feedback` JSONB column — no new columns,
-- no migration on the edges table itself. agent_feedback was already
-- JSONB and already carried `mechanism` strings; this phase just
-- adds more keys to the same dictionary per row.
--
-- Why no per-edge structural columns: the enrichment fields are
-- inherently soft-shape (narrative paragraphs, mediator arrays). JSONB
-- is the right home. Querying on chain_strength when needed uses
-- jsonb path operators — slower than a real column but acceptable at
-- the scale of one room (typically <20 chains).

alter table public.sub_objective_decisions
  drop constraint if exists sub_objective_decisions_action_check;

alter table public.sub_objective_decisions
  add constraint sub_objective_decisions_action_check
  check (action in (
    -- Phase 1+ — picker / variant lab.
    'elect',
    'reject',
    'defer',
    'clear',
    'generate_batch',
    'confirm',
    -- Phase 9 — Lab Notebook event types (per-room work).
    'rd_iterate',
    'score',
    'approve_bet',
    'compose',
    'autopilot_run',
    'autopilot_iteration',
    -- Phase 10a — system events + cross-room curation.
    'room_generated',
    'item_expanded',
    'expansion_spawned',
    'prototype_status_changed',
    'finding_acknowledged',
    'finding_dismissed',
    'finding_resolved',
    'theme_distilled',
    'concept_branched',
    'constraints_set',
    'stage_transitioned',
    -- Phase 11.4 — causal chain enrichment.
    'chains_enriched'
  ));
