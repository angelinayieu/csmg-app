-- ── Honest schema comments on `mechanisms` ──────────────────────────
--
-- The `mechanisms` table + its `kind` enum were audited during the
-- computational-substance pass and flagged: the NAME implies executable
-- causal logic, but the ROWS are widget-routing hints. A row with
-- `kind='simulation'` does NOT itself run a simulation — it tags the
-- linked infrastructure proposal so `buildDefaultManifest` can inject
-- the matching simulation widget (via `HINT_TO_CAPABILITY` map in
-- `src/lib/pipeline/app-manifest-builder.ts`).
--
-- This migration doesn't change any data. It adds column/table COMMENTs
-- so future readers (human or LLM) don't assume the rows are executable
-- primitives. If we later wire `kind='simulation'` to actually stamp an
-- MC distribution at materialization time, the comments should be
-- updated to reflect the new contract.
--
-- See also: docs/COMPUTATIONAL_SUBSTANCE_ROADMAP.md §R4.

comment on table public.mechanisms is
  'Widget-routing hints materialized from an InfrastructureProposal''s mechanism_hints[]. Each row tells the app-manifest-builder which widget (simulation_lab, prediction_panel, validation_lab, …) to inject on the linked app. These rows are NOT executable mechanisms — they are declarative records used for UI composition. The actual MC / prediction / validation work happens in src/lib/simulation/ and friends, called from app state transitions and agent actions.';

comment on column public.mechanisms.kind is
  'Widget-routing hint, NOT an execution mode. kind=''simulation'' means this row will surface a simulation widget on the linked app (via HINT_TO_CAPABILITY in app-manifest-builder.ts); it does not mean this row itself runs simulations. Enum values are parallel to WidgetCapability in src/types/app-manifest.ts so adding a new hint requires adding the matching widget first.';

comment on column public.mechanisms.rationale is
  'Human-readable explanation of what surfacing this row will give the user (which widget, attached to which proposal). Written to be accurate about scope — "Surfaces a simulation widget" not "Runs simulations". See rationaleForMechanism() in materialize-mechanisms.ts.';
