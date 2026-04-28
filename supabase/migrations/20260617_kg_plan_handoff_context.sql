-- ── KG Plan handoff context ─────────────────────────────────────
--
-- When the bootstrap intake creates a plan + holds a credit
-- reservation open while the user reviews, the approve route needs
-- enough context to fire the downstream decompose stage with the
-- right inputs (reservationId, intake runId, prompt text, depth).
--
-- We attach this context to the plan row itself rather than
-- inventing a side table. The shape:
--
--   {
--     reservation_id: string,
--     intake_run_id: string,
--     decompose_input: {
--       text: string,
--       reasoningDepth: "quick" | "standard" | "deep",
--       autoAdvance: boolean
--     }
--   }
--
-- Optional. When null, the approve route assumes there's no pending
-- decompose to fire (e.g. plan was created via direct API call
-- without the bootstrap chain). In that case approval just
-- materializes the layer ontology and stops; downstream pipeline
-- has to be triggered separately.

alter table public.kg_generation_plans
  add column if not exists pipeline_handoff_context jsonb;

comment on column public.kg_generation_plans.pipeline_handoff_context is
  'Captures the bootstrap-time context (reservationId, intake_runId, decompose_input) so the approve route can fire decompose with the right inputs. Null when plan was created outside the bootstrap chain.';
