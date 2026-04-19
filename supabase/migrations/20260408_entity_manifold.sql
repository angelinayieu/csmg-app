-- Add manifold sub-dimensions to entities
-- Decomposes entity attributes into multi-dimensional profiles
ALTER TABLE public.entities ADD COLUMN manifold JSONB;

COMMENT ON COLUMN public.entities.manifold IS 'Sub-dimensional entity profile: {strategic?, operational?, epistemic?}';
