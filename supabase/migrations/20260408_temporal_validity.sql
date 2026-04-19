-- Add temporal validity to entities and edges
-- Tracks when concepts/relationships are valid and how they decay
ALTER TABLE public.entities ADD COLUMN temporal_validity JSONB;
ALTER TABLE public.edges ADD COLUMN temporal_validity JSONB;

COMMENT ON COLUMN public.entities.temporal_validity IS 'JSON: {valid_from?, valid_until?, decay_rate?, temporal_scope?}';
COMMENT ON COLUMN public.edges.temporal_validity IS 'JSON: {valid_from?, valid_until?, decay_rate?, temporal_scope?}';
