-- ═══════════════════════════════════════════════════════════════════
-- Migration: Add "conceptual" knowledge layer
--
-- Extends the knowledge_layer enum from 3 to 4 values:
--   internal    → KG 1: User Assets
--   conceptual  → KG 2: Concept Model (expansion-derived mechanisms)
--   external    → KG 3: Deep Research
--   bridge      → Cross-layer connections
--
-- Also reclassifies existing expansion-materialized entities/edges.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Extend CHECK constraint on entities table
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_knowledge_layer_check;
ALTER TABLE entities ADD CONSTRAINT entities_knowledge_layer_check
  CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge'));

-- 2. Extend CHECK constraint on edges table
ALTER TABLE edges DROP CONSTRAINT IF EXISTS edges_knowledge_layer_check;
ALTER TABLE edges ADD CONSTRAINT edges_knowledge_layer_check
  CHECK (knowledge_layer IN ('internal', 'conceptual', 'external', 'bridge'));

-- 3. Backfill: Reclassify existing SC_ entities as "conceptual"
--    Uses both entity_id prefix AND provenance check for safety
UPDATE entities
SET knowledge_layer = 'conceptual'
WHERE entity_id LIKE 'SC\_%'
  AND knowledge_layer = 'internal'
  AND (
    provenance->>'source_type' = 'expansion_materialization'
    OR provenance IS NULL
  );

-- 4. Backfill: Reclassify internal_pathway / dynamic edges as "conceptual"
--    These are edges BETWEEN SC_ entities within the same expansion
UPDATE edges
SET knowledge_layer = 'conceptual'
WHERE knowledge_layer = 'internal'
  AND provenance->>'source_type' = 'expansion_materialization'
  AND relationship_type != 'has_component';

-- 5. Backfill: Reclassify has_component edges as "bridge"
--    These connect parent (internal) → child (conceptual) = cross-layer
UPDATE edges
SET knowledge_layer = 'bridge'
WHERE knowledge_layer = 'internal'
  AND relationship_type = 'has_component'
  AND provenance->>'source_type' = 'expansion_materialization';
