-- ── improvement_goals.annotations ─────────────────────────────────
--
-- Stores LLM-extracted phrase annotations on the core objective
-- text. The Objective Canvas's main canvas renders the user's typed
-- objective with these phrases highlighted (soft dotted underline
-- in the layer color) and reveals the AI's interpretation on hover.
--
-- Shape:
--   [
--     {
--       "phrase": "vivid experiences",
--       "start_offset": 56,
--       "end_offset": 73,
--       "note": "Read as: sensory-rich + immediately compelling.",
--       "linked_sub_objective_id": "<uuid> | null",
--       "layer_tag": "features" | "outcomes" | "pain" | "objective" | null
--     },
--     ...
--   ]
--
-- Generated lazily on first main-canvas load (when the user reaches
-- stage="main") and cached thereafter. Regenerated only when the
-- core objective text itself changes or the user explicitly asks.
--
-- Defaults to '[]' so existing rows render the card without
-- highlights (the component checks length).

alter table public.improvement_goals
  add column if not exists annotations jsonb not null default '[]'::jsonb;

comment on column public.improvement_goals.annotations is
  'LLM-extracted phrase annotations on the goal''s text — used by the Objective Canvas main view to highlight keywords with hover-revealed AI interpretation. Array of {phrase, start_offset, end_offset, note, linked_sub_objective_id, layer_tag}. Empty array = not yet generated.';
