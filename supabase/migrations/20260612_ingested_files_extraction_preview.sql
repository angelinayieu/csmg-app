-- ── HITL extraction checklist substrate ──────────────────────────────
--
-- Today's intake flow auto-extracts 3-8 entities from every uploaded
-- asset and writes them straight to the KG via asset-preextractor.ts.
-- That works for casual decompose, but for research workflows the user
-- needs to control WHAT gets extracted (effect sizes vs methodology vs
-- claims, etc.) before commitment. Per the docs/KG_DEPTH_CRITIQUE.md
-- input-side gap analysis: HITL extraction checklist is the single
-- highest-leverage input-side fix for "research workflow" use cases.
--
-- This migration adds the substrate for a two-phase intake:
--
--   Phase 1 (preview):  /api/ingest/[id]/preview generates 15-30
--                       candidate entities with evidence quotes,
--                       category tags, and a 'suggested' flag — but
--                       does NOT write to the entities table. Result
--                       is cached in ingested_files.extraction_preview.
--
--   Phase 2 (commit):   /api/ingest/[id]/extract takes the user's
--                       selected_candidate_ids[] + focus_level,
--                       filters the cached preview, and commits only
--                       the chosen candidates as entities (existing
--                       persistPreExtractedEntities path).
--
-- New columns on ingested_files:
--
--   extraction_status   text   Lifecycle: pending_preview (default
--                              for new uploads) → previewed (preview
--                              ran, awaiting user review) →
--                              extracting (commit in flight) →
--                              extracted (entities materialized) |
--                              skipped (user dismissed) |
--                              auto_extracted (legacy path: ran
--                              without preview, e.g. from situation-
--                              analyzer auto-call). Allows the UI to
--                              render the right asset-card badge:
--                              "Review N candidates" / "Extracting…"
--                              / "N entities extracted".
--
--   extraction_preview  jsonb  Cached ExtractionPreview shape. Key
--                              fields: candidates[] (15-30 items
--                              each with id, name, description,
--                              category, entity_category, confidence,
--                              evidence_quote, suggested), generated_at,
--                              category_counts, suggested_count.
--                              See src/types/extraction-preview.ts
--                              for the canonical TS shape. Cached so
--                              the user can revisit / re-open the
--                              drawer without paying the LLM cost
--                              again.
--
--   extraction_target_count int  User-set target count from the focus
--                                slider (shallow ≈ 5, moderate ≈ 12,
--                                deep ≈ 25, exhaustive = all).
--                                Persisted alongside the commit so
--                                future re-runs of the same asset
--                                can default to the user's prior
--                                choice. Null until first commit.
--
-- Indexes: partial on extraction_status to support the "what assets
-- are awaiting review" query the canvas chrome needs to badge cards.
--
-- Backward compatibility: all columns nullable (or default to legacy
-- value). Existing pre-D1 / pre-this-migration ingested_files rows
-- keep working: situation-analyzer's auto-extract path is preserved
-- and stamps extraction_status = 'auto_extracted' on completion. The
-- new HITL flow is opt-in via the new /preview + /extract routes.

alter table public.ingested_files
  add column if not exists extraction_status text;

alter table public.ingested_files
  add column if not exists extraction_preview jsonb;

alter table public.ingested_files
  add column if not exists extraction_target_count int;

alter table public.ingested_files
  drop constraint if exists ingested_files_extraction_status_check;

alter table public.ingested_files
  add constraint ingested_files_extraction_status_check
  check (
    extraction_status is null
    or extraction_status in (
      'pending_preview',
      'previewed',
      'extracting',
      'extracted',
      'skipped',
      'auto_extracted'
    )
  );

alter table public.ingested_files
  drop constraint if exists ingested_files_extraction_target_count_check;

alter table public.ingested_files
  add constraint ingested_files_extraction_target_count_check
  check (
    extraction_target_count is null
    or extraction_target_count > 0
  );

-- "Assets awaiting review" — the canvas chrome can render a global
-- badge "3 assets need review" by counting this index without a full
-- scan. Same partial index helps the per-space asset-card badge query.
create index if not exists ingested_files_extraction_status_pending_idx
  on public.ingested_files (space_id, extraction_status)
  where extraction_status = 'previewed';

-- GIN on the preview blob so we can later query "find every asset
-- with a finding-category candidate above 0.8 confidence" without
-- parsing JSON on every read.
create index if not exists ingested_files_extraction_preview_gin_idx
  on public.ingested_files using gin (extraction_preview)
  where extraction_preview is not null;

comment on column public.ingested_files.extraction_status is
  'HITL extraction lifecycle: pending_preview → previewed → extracting → extracted | skipped | auto_extracted (legacy path). Drives the asset-card badge state. See src/lib/pipeline/asset-preextractor.ts.';

comment on column public.ingested_files.extraction_preview is
  'Cached ExtractionPreview from /api/ingest/[id]/preview. JSONB shape mirrors src/types/extraction-preview.ts. Persisted so reopening the review drawer doesn''t re-pay the LLM cost.';

comment on column public.ingested_files.extraction_target_count is
  'User-chosen target count from the focus slider (shallow≈5, moderate≈12, deep≈25, exhaustive=all). Defaults future re-runs to the user''s prior choice.';
