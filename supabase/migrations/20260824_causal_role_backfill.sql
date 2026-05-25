-- Backfill entities.causal_role using the same deterministic heuristic
-- as src/lib/decomposition/infer-causal-role.ts. Used both to fix the
-- ~4317 existing rows where the structurer omitted the [ROLE: ...] tag,
-- AND as a safety net for any future row that slips past the TS
-- fallback (e.g., admin-tool inserts that bypass sanitize.ts).
--
-- Precedence (matches TS):
--   1. goal       — name-pattern match OR fundamental + optimization signals
--   2. evidence   — "Sub-component of …" or external + atomic shape
--   3. application — framework/protocol/ritual/… keywords
--   4. deliverable — process category or verb-noun name shape
--   5. outcome    — metric/measurement signals
--   6. truth      — default

CREATE OR REPLACE FUNCTION infer_causal_role(
  p_name text,
  p_description text,
  p_entity_category text,
  p_importance text,
  p_knowledge_layer text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  name_lc text := lower(coalesce(p_name, ''));
  desc_lc text := lower(coalesce(p_description, ''));
  cat_lc  text := lower(coalesce(p_entity_category, ''));
  imp_lc  text := lower(coalesce(p_importance, ''));
  kl_lc   text := lower(coalesce(p_knowledge_layer, ''));
BEGIN
  -- 1. Goal
  IF name_lc ~ '\m(north[- ]?star|optimization (target|point|goal)|primary (goal|objective)|problem statement)\M'
  THEN
    RETURN 'goal';
  END IF;
  IF imp_lc = 'fundamental' AND (
       name_lc LIKE '%goal%'
    OR name_lc LIKE '%objective%'
    OR desc_lc LIKE '%optimization point%'
    OR desc_lc LIKE '%north star%'
  ) THEN
    RETURN 'goal';
  END IF;

  -- 2. Evidence
  IF desc_lc LIKE 'sub-component of%' OR desc_lc LIKE '%fundamental unit of%' THEN
    RETURN 'evidence';
  END IF;
  IF kl_lc = 'external' AND cat_lc IN ('concrete', 'epistemic') THEN
    RETURN 'evidence';
  END IF;

  -- 3. Application
  IF name_lc ~ '\m(framework|protocol|ritual|platform|playbook|checklist|regimen|standard)\M' THEN
    RETURN 'application';
  END IF;
  IF cat_lc = 'abstract' AND desc_lc ~ '\m(framework|protocol|ritual|platform|playbook|checklist|regimen|standard)\M' THEN
    RETURN 'application';
  END IF;

  -- 4. Deliverable
  IF cat_lc = 'process' THEN
    RETURN 'deliverable';
  END IF;
  IF name_lc ~ '\m(analysis|testing|collection|calibration|modeling|design|training|review|evaluation|validation|implementation|monitoring|auditing|tracking|scoring|logging|scheduling)\M' THEN
    RETURN 'deliverable';
  END IF;

  -- 5. Outcome
  IF name_lc ~ '\m(metric|score|rate|ratio|level|percentage|index|indicator|performance|throughput|latency|yield|conversion|retention|engagement)\M'
     OR desc_lc ~ '\m(metric|score|rate|ratio|level|percentage|index|indicator|performance|throughput|latency|yield|conversion|retention|engagement)\M'
  THEN
    RETURN 'outcome';
  END IF;
  IF cat_lc = 'relational' AND imp_lc IN ('critical', 'important') THEN
    RETURN 'outcome';
  END IF;

  -- 6. Default
  RETURN 'truth';
END;
$$;

-- Backfill existing nulls in one shot.
UPDATE entities
SET causal_role = infer_causal_role(
  name, description, entity_category, importance, knowledge_layer
)
WHERE causal_role IS NULL;
