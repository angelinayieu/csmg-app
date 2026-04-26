-- ── Assets + situation baseline ──────────────────────────────────────
--
-- Two architectural additions for the new "situation analysis layer":
--
-- 1. Assets — promote `ingested_files` rows to first-class assets that
--    feed into the pipeline. Adds asset_class (research_pdf /
--    internal_doc / dataset / image_diagram / prior_analysis /
--    spec_sheet) so the pipeline knows what KIND of asset it's
--    consuming, plus preextracted_entity_ids so the asset can pre-
--    populate the KG before decompose runs, and uncertainty_resolved
--    to track which baseline `unknowns` an asset answers.
--
--    Implementation note: ingested_files already stores normalized
--    text + metadata. We extend it rather than create a new `assets`
--    table because the relationship is 1:1 — every asset IS an ingested
--    file with extra semantics, and a duplicate table would force a
--    join on every read.
--
-- 2. spaces.situation_baseline — JSONB capturing the user's CURRENT
--    state. Shape:
--      {
--        inputs:   [{ name, value, unit? }],
--        process:  { steps: [], constraints: [] },
--        outputs:  {
--          current: [{ metric, value, unit }],
--          target:  [{ metric, value, unit }],
--          gap:     [{ metric, delta, direction }]
--        },
--        knowns:    [string],
--        unknowns:  [string],
--        uncertainty_score: number (0..1),
--        analyzed_at: ISO timestamp,
--        skipped_reason: null | "twin_mode_structural" | "no_assets_no_richness"
--      }
--
--    Null when the situation analyzer hasn't run yet (vague intake) or
--    legacy rows. Frame-extractor + research planner can read this to
--    adapt their behavior.
--
-- Both writes are idempotent — the situation analyzer upserts; assets
-- update in place by id.

-- ── Asset extensions to ingested_files ──
alter table public.ingested_files
  add column if not exists asset_class text;

alter table public.ingested_files
  add column if not exists preextracted_entity_ids uuid[] default '{}'::uuid[];

alter table public.ingested_files
  add column if not exists uncertainty_resolved text[] default '{}'::text[];

-- Narrow allowed asset_class values; allow null for legacy rows.
alter table public.ingested_files
  drop constraint if exists ingested_files_asset_class_check;

alter table public.ingested_files
  add constraint ingested_files_asset_class_check
  check (
    asset_class is null
    or asset_class in (
      'research_pdf',
      'internal_doc',
      'dataset',
      'image_diagram',
      'prior_analysis',
      'spec_sheet',
      'web_article',
      'pasted_text'
    )
  );

comment on column public.ingested_files.asset_class is
  'Semantic asset class. Drives whether the situation analyzer treats this as evidence (research_pdf, prior_analysis), structure (spec_sheet, internal_doc), or observation (dataset). null = legacy ingest where class was not classified.';

comment on column public.ingested_files.preextracted_entity_ids is
  'Entity rows pre-extracted from this asset before decompose runs. Lets the conceptual KG include user-provided structure without re-deriving it from text. Empty array = no pre-extraction, asset content folded into intake_text only.';

comment on column public.ingested_files.uncertainty_resolved is
  'Strings from the situation_baseline.unknowns array that THIS asset addresses. Surfaces in UI as "X resolves these gaps" when the user uploads a research PDF answering an explicitly-flagged unknown.';

create index if not exists ingested_files_space_id_asset_class_idx
  on public.ingested_files (space_id, asset_class)
  where space_id is not null;

-- ── Situation baseline column on spaces ──
alter table public.spaces
  add column if not exists situation_baseline jsonb;

comment on column public.spaces.situation_baseline is
  'Structured snapshot of the user''s CURRENT state derived by the situation analyzer. Skipped (null) when twin_mode is null or "structural" — vague inputs go straight to landscape generation. Populated for "observational" and "simulation" modes. See /api/pipeline/analyze-situation for the LLM prompt that produces this and src/types/situation.ts for the typed shape.';
