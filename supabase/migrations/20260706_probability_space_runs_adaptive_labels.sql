-- Adaptive axis labels — make probability-space shells self-documenting
-- by carrying an LLM-generated, domain-adapted display name + a per-prompt
-- rationale alongside the canonical axis slug.
--
-- Why: the canonical axis slugs (financial / timeline / actors / ... ) are
-- internal routing keys that pick which hand-authored prompt vocabulary
-- the generator should use (CFO vocab on financial, Popperian on
-- assumptions, etc.). They are NOT the right label for the user. A user
-- working on a personal habit-tracker shouldn't see a generic "FINANCIAL"
-- shell — they should see "COST OF FAILING" or whatever the LLM
-- generates that actually maps to their situation.
--
-- This is the same separation we already use for cascade perspectives:
-- the palette slot stays as an internal classifier; the user-visible
-- label is LLM-generated and adapts to the space's domain.
--
-- Both columns are nullable for backward-compat; the painter falls back
-- to the catalog label/tagline when these are absent (legacy spaces).
--
-- Idempotent. Safe to re-run.

alter table public.probability_space_runs
  add column if not exists display_name text,
  add column if not exists adaptive_rationale text;

comment on column public.probability_space_runs.display_name is
  'LLM-generated, domain-adapted label for this axis IN THIS SPACE. '
  '2-5 words, headline-cased. What the user reads on the shell header. '
  'The canonical `axis` column stays in place as the routing key for '
  'hand-authored per-axis prompt vocabulary. NULL for legacy rows; the '
  'painter falls back to AXIS_CATALOG[axis].label when this is absent.';

comment on column public.probability_space_runs.adaptive_rationale is
  'One-sentence explanation of WHY this axis was selected for this '
  'specific prompt. The existing `rationale` column was already meant '
  'for this purpose but the field is being formalized here so future '
  'prompts can require an adaptive sentence vs a generic restatement.';

-- Speed up "give me the latest run's adaptive labels" queries the
-- shell-painter and the proposal-gate page will run.
create index if not exists idx_probability_space_runs_with_display_name
  on public.probability_space_runs(space_id, run_id, order_index)
  where display_name is not null;
