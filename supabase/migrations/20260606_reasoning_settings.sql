-- ── Reasoning settings on spaces ─────────────────────────────────────
--
-- User-controllable reasoning customization captured at intake time
-- and persisted on the space. Read by:
--   - frame-panel:    lenses[] gate which personas run (skip non-
--                     selected lenses to save ~500 tokens each)
--   - frame-extractor: lenses bias axis selection
--   - synthesize:     askClarifyingQuestions changes prompt tone;
--                     showAlternatives controls variant fan-out
--   - clarifying-questions route: enabled when askClarifyingQuestions
--                                 is true
--
-- Shape (TypeScript: ReasoningSettings in src/types/reasoning-settings.ts):
--   {
--     lenses: ("systems_analyst"|"skeptic"|"operator"|"engineer"|"historian")[],
--     depth: "quick"|"standard"|"deep",
--     askClarifyingQuestions: boolean,
--     buildBaselineFirst: boolean,
--     showAlternatives: boolean
--   }
--
-- Null on legacy rows; downstream stages soft-fall to the default
-- bundle (3 lenses on, standard depth, askQuestions off, baseline
-- on auto, alternatives on) when the column is null.

alter table public.spaces
  add column if not exists reasoning_settings jsonb;

comment on column public.spaces.reasoning_settings is
  'User-set reasoning customization captured at intake. See src/types/reasoning-settings.ts for the typed shape. Null = default behavior (frame-panel runs all 3 default lenses, standard depth, no clarifier, baseline runs on auto, alternatives on).';
