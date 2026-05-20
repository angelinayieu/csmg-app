-- ── brainstorm_sessions.clarifier_qa ─────────────────────────────────
--
-- Adds a nullable JSONB column that holds the homepage MCQ answers the
-- user gave before they landed on the synergy whiteboard. Persisted by
-- /app/synergy/new during session creation, read by the autopilot round
-- handlers (/api/synergy/sessions/[id]/autopilot/round) to inject as
-- soft constraints into each round's LLM context.
--
-- Why a new column instead of overloading objective_constraints[]:
--   * `objective_constraints` is a text[] designed for free-form
--     constraint sentences. The MCQ answers have structure
--     (question + answer + optional slot) that would be lossy to
--     flatten into strings.
--   * Wave 2 of the typed-clarifier work uses slots like
--     "target_metric" / "variation_axis" / "system_boundary" /
--     "timeframe". Preserving the slot lets the autopilot route the
--     right answer into the right round (variation_axis → variations
--     round, system_boundary → decompose round, etc).
--   * Nullable + default null = additive, zero-regression for
--     existing sessions.
--
-- Shape (when present):
--   {
--     "pairs": [
--       { "question": "...", "answer": "...", "slot": "target_metric" },
--       { "question": "...", "answer": "...", "slot": "timeframe" },
--       { "question": "...", "answer": "..." }              -- slot optional
--     ],
--     "captured_at": "2026-05-20T...",
--     "mode": "brainstorm_speed"                              -- source mode
--   }

alter table public.brainstorm_sessions
  add column if not exists clarifier_qa jsonb default null;

comment on column public.brainstorm_sessions.clarifier_qa is
  'Optional homepage-MCQ answers from the DashboardClarifyModal: { pairs: [{ question, answer, slot? }], captured_at, mode }. Persisted by /app/synergy/new on session creation, read by autopilot round handlers to inject as soft constraints into each LLM call. Null for sessions created without the clarifier modal.';
