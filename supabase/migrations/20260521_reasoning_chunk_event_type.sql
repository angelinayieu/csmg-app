-- ── Phase 1 Step 19 follow-up: allow reasoning_chunk event type ──
--
-- The original `pipeline_run_events` table (20260520_pipeline_event_bus.sql)
-- declared a CHECK constraint pinning event_type to the 8 known structural
-- artifact types. Phase 1 Step 19 added `reasoning_chunk` events for the
-- live streaming reasoning trace panel — carrying accumulated Pass 1
-- token output so users see the AI's thinking in real time.
--
-- Without this migration:
--   • Every reasoning_chunk INSERT attempt is rejected by the constraint.
--   • emitStructuralEvent catches the error silently (soft-fail by design).
--   • Canvas reasoning trace panel receives zero events — stays blank.
--   • High-frequency DB write attempts on every 1s tick during Pass 1.
--
-- This migration drops the old constraint and recreates it with the new
-- event type added. Existing rows are unaffected.

alter table public.pipeline_run_events
  drop constraint if exists pipeline_run_events_event_type_check;

alter table public.pipeline_run_events
  add constraint pipeline_run_events_event_type_check
  check (event_type in (
    'stage_boundary',
    'entity_added',
    'edge_added',
    'cycle_detected',
    'bridge_formed',
    'proposal_ready',
    'source_cited',
    'prediction_recorded',
    'reasoning_chunk'
  ));
