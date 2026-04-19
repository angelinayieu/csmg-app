-- Sprint 2 — add source_canvas_id to memory_items
--
-- Why: when notes are reindexed on canvas save, we need to prune rows
-- for notes that were deleted from the canvas. A universal canvas has
-- scope_ref_id=null, so scope alone can't disambiguate "which canvas
-- did this note come from." We carry the originating canvas explicitly
-- for note + canvas kinds.
--
-- Only populated for:
--   kind='note'   → the canvas whose snapshot the note lives in
--   kind='canvas' → the canvas itself (ref_id == source_canvas_id)
-- Other kinds (entity, bridge, objective, app) stay null.

alter table public.memory_items
  add column if not exists source_canvas_id uuid
    references public.canvases(id) on delete cascade;

create index if not exists idx_memory_items_source_canvas
  on public.memory_items(source_canvas_id)
  where source_canvas_id is not null;

comment on column public.memory_items.source_canvas_id is
  'For kind=note or kind=canvas: the canvas this row originated from. '
  'Enables per-canvas prune on reindex without a scope-level scan.';
