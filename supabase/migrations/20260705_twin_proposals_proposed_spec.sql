-- Add proposed_spec snapshot to twin_proposals so we can diff what was
-- claimed at approval time against what eventually materialized.
--
-- Until now, the workflow display's "X new · Y amplified · Z baseline" pill
-- read its counts from the LATEST strategy's infrastructure_map status — an
-- honest projection of the current proposal, but it lost the audit trail
-- when the strategy was regenerated or only partially materialized. This
-- column persists a frozen snapshot of the proposal at approval time so the
-- materialized twin can be diffed against the original promise.
--
-- Shape mirrors src/types/twin.ts → ProposedTwinSpec. JSONB so the renderer
-- and diff helpers can evolve the schema without migrations.
--
-- Idempotent so it's safe to re-run.

alter table public.twin_proposals
  add column if not exists proposed_spec jsonb;

comment on column public.twin_proposals.proposed_spec is
  'Frozen snapshot of what the strategy claimed at proposal/approval time '
  '(entity_intents, channel_intents, loop_intents, app_intents, '
  'promised_counts, twin_state_at_proposal). Diffed against current twin '
  'state to drive the proposed-vs-actual chip strip on the workflow display. '
  'Shape: src/types/twin.ts → ProposedTwinSpec.';

-- Optional partial index for proposals where the spec is set — useful for
-- the diff renderer's "do we have a snapshot to compare against?" probe.
create index if not exists idx_twin_proposals_with_spec
  on public.twin_proposals(space_id, generated_at desc)
  where proposed_spec is not null;
