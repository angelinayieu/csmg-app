-- ── Room v2 — adaptive lane labels ──
--
-- The layered generator now picks domain-specific names for the 4
-- room lanes (e.g. "Frictions / Bets / Wins / Goal" for strategy
-- contexts, "Symptoms / Mechanisms / Functional gains / Recovery"
-- for clinical contexts). Persisted on the sub-objective so the
-- room page can render them in place of the canonical
-- Pain/Features/Outcomes/Objective labels.

alter table public.improvement_goals
  add column if not exists room_lane_labels jsonb;

comment on column public.improvement_goals.room_lane_labels is
  'LLM-picked domain-specific lane labels for the sub-objective room. Shape: { pain, features, outcomes, objective }. Each value is a short noun phrase (≤2 words) appropriate to the room''s domain. Null falls back to the canonical Pain/Features/Outcomes/Objective names.';
