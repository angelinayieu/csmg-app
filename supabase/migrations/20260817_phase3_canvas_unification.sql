-- ── Phase 3: Canvas unification — schema additions ──
--
-- Adds the columns + indexes + RLS policy needed to migrate
-- brainstorm_sessions → spaces and brainstorm_components → entities
-- while preserving cross-references for marketplace / rooms.
--
-- Strategy: additive only. No DROP, no destructive ALTER. Legacy
-- columns + tables remain readable; new columns are NULL until the
-- migration script (Inngest: synergy-to-canvas-batch-migration.ts)
-- populates them per user.
--
-- See: UNIFICATION_DATA_MODEL_SPEC.md §5 for the full spec.

-- ── spaces table: distinguish brainstorm vs project vs twin ──
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS kind_state text;

-- Drop and re-add the check constraint to handle re-runs cleanly.
ALTER TABLE public.spaces DROP CONSTRAINT IF EXISTS spaces_kind_check;
ALTER TABLE public.spaces ADD CONSTRAINT spaces_kind_check
  CHECK (kind IN ('project', 'brainstorm', 'twin'));

-- Partial index — only the active (un-archived) spaces matter for
-- the dashboard's "Pick up where you left off" query.
CREATE INDEX IF NOT EXISTS idx_spaces_kind_user
  ON public.spaces (user_id, kind, updated_at DESC)
  WHERE archived = false;

-- ── entities table: extracted-component metadata ──
-- After migration, brainstorm_components rows are dual-written as
-- entities with is_extracted=true. The marketplace + rooms continue
-- reading from brainstorm_components for compatibility; canvas-side
-- features read from entities.
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS is_extracted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_kind text,
  ADD COLUMN IF NOT EXISTS private_description text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_extraction_kind_check;
ALTER TABLE public.entities ADD CONSTRAINT entities_extraction_kind_check
  CHECK (
    extraction_kind IS NULL OR extraction_kind IN (
      'core_idea',
      'upstream_dependency',
      'downstream_output',
      'alternative',
      'polished_product'
    )
  );

ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_visibility_check;
ALTER TABLE public.entities ADD CONSTRAINT entities_visibility_check
  CHECK (visibility IN ('private', 'matchable_only', 'public'));

CREATE INDEX IF NOT EXISTS idx_entities_extracted
  ON public.entities (space_id, extraction_kind)
  WHERE is_extracted = true;

-- ── synergy_strategies: link back to spaces ──
-- Nullable so legacy rows (session_id only, no space_id) remain valid.
-- Migration script populates this column for each migrated session's
-- strategy via:
--   UPDATE synergy_strategies SET space_id = <new_space_id>
--   WHERE session_id = <old_session_id>
ALTER TABLE public.synergy_strategies
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.spaces(id);

CREATE INDEX IF NOT EXISTS idx_synergy_strategies_space_id
  ON public.synergy_strategies (space_id)
  WHERE space_id IS NOT NULL;

-- RLS — let space-owners read strategies linked to their spaces.
-- Existing session-based RLS still covers pre-migration rows
-- (space_id IS NULL).
DROP POLICY IF EXISTS "Users see strategies in own spaces" ON public.synergy_strategies;
CREATE POLICY "Users see strategies in own spaces" ON public.synergy_strategies
  FOR SELECT USING (
    space_id IS NULL
    OR space_id IN (SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid()))
  );

-- ── brainstorm_sessions: track migration ──
-- migrated_to_space_id: when set, the redirect middleware sends
-- traffic from /app/synergy/[id] → /app/space/<migrated_to_space_id>/whiteboard.
-- migrated_at: timestamp so we can compute "migrated in last N days"
-- queries for the dashboard banner.
ALTER TABLE public.brainstorm_sessions
  ADD COLUMN IF NOT EXISTS migrated_to_space_id uuid REFERENCES public.spaces(id),
  ADD COLUMN IF NOT EXISTS migrated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_migration
  ON public.brainstorm_sessions (owner_id, migrated_to_space_id);

CREATE INDEX IF NOT EXISTS idx_brainstorm_sessions_unmigrated
  ON public.brainstorm_sessions (owner_id, updated_at DESC)
  WHERE migrated_to_space_id IS NULL AND archived = false;
