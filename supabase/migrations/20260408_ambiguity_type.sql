-- Add ambiguity classification to entities
-- Classifies uncertainty as harmful (resolve now), premature (resolve later), or strategic (preserve)
ALTER TABLE public.entities
  ADD COLUMN ambiguity_type TEXT
    CHECK (ambiguity_type IS NULL OR ambiguity_type IN ('harmful', 'premature', 'strategic'));
