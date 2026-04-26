-- ── Critical-path RLS performance pass (2026-06-04) ───────────────────
--
-- Audit of the Supabase advisor flagged ~150 "Auth RLS Initialization
-- Plan" warnings: every policy that calls bare `auth.uid()` re-evaluates
-- the function once per row scanned. On hot paths (rendering a fresh
-- whiteboard reads from `entities`, `edges`, `spaces`, `pipeline_runs`,
-- `pipeline_run_events`) this can multiply query latency 10-50x as the
-- graph grows.
--
-- The transformation, in every case:
--    USING (auth.uid() = <col>)
-- becomes:
--    USING ((SELECT auth.uid()) = <col>)
--
-- Same security semantics, dramatically faster scans (the subquery is
-- evaluated once per query and cached, instead of once per row).
--
-- Each table lives in its own DO block so a column-mismatch on one
-- table doesn't roll back the whole migration. v2 of this file fixes
-- v1's incorrect assumption that `pipeline_runs.user_id` exists — it's
-- actually `pipeline_runs.created_by`.
--
-- Idempotent: every DROP uses IF EXISTS; safe to re-run.

-- ───────────────────────────────────────────────────────────────────
-- spaces  (schema.sql:440 — uses user_id)
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own spaces" ON public.spaces;
  CREATE POLICY "Users see own spaces" ON public.spaces
    FOR ALL USING ((SELECT auth.uid()) = user_id);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'spaces policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- entities
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own entities" ON public.entities;
  CREATE POLICY "Users see own entities" ON public.entities
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'entities policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- edges
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own edges" ON public.edges;
  CREATE POLICY "Users see own edges" ON public.edges
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'edges policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- cycles
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own cycles" ON public.cycles;
  CREATE POLICY "Users see own cycles" ON public.cycles
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cycles policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- propositions
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own propositions" ON public.propositions;
  CREATE POLICY "Users see own propositions" ON public.propositions
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'propositions policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- novel_connections
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own novel_connections" ON public.novel_connections;
  CREATE POLICY "Users see own novel_connections" ON public.novel_connections
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'novel_connections policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- contradictions  (uses space_a_id, not space_id)
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own contradictions" ON public.contradictions;
  CREATE POLICY "Users see own contradictions" ON public.contradictions
    FOR ALL USING (
      space_a_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'contradictions policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- scenarios
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own scenarios" ON public.scenarios;
  CREATE POLICY "Users see own scenarios" ON public.scenarios
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'scenarios policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- action_items
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own action_items" ON public.action_items;
  CREATE POLICY "Users see own action_items" ON public.action_items
    FOR ALL USING (
      space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'action_items policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- bridges  (advisor flagged 4 duplicate permissive policies — drop
--           every variant we know about, then re-create exactly one)
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own bridges" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_select_own" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_select" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_insert" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_update" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_delete" ON public.bridges;
  DROP POLICY IF EXISTS "bridges_owner" ON public.bridges;
  DROP POLICY IF EXISTS "Users can view bridges" ON public.bridges;
  DROP POLICY IF EXISTS "Users can manage bridges" ON public.bridges;
  CREATE POLICY "bridges_owner" ON public.bridges
    FOR ALL USING (
      source_space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
      OR target_space_id IN (
        SELECT id FROM public.spaces WHERE user_id = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'bridges policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- pipeline_runs  (column is `created_by`, NOT `user_id`)
-- Original policies live in 20260520_pipeline_event_bus.sql:
--   "pipeline_runs user can read own"
--   "pipeline_runs user can insert own"
--   "pipeline_runs user can update own"
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "pipeline_runs user can read own" ON public.pipeline_runs;
  DROP POLICY IF EXISTS "pipeline_runs user can insert own" ON public.pipeline_runs;
  DROP POLICY IF EXISTS "pipeline_runs user can update own" ON public.pipeline_runs;
  -- Older / alternate names from prior attempts at this fix:
  DROP POLICY IF EXISTS "pipeline_runs_owner" ON public.pipeline_runs;
  DROP POLICY IF EXISTS "Users see own pipeline_runs" ON public.pipeline_runs;

  CREATE POLICY "pipeline_runs user can read own"
    ON public.pipeline_runs FOR SELECT
    USING (created_by = (SELECT auth.uid()));

  CREATE POLICY "pipeline_runs user can insert own"
    ON public.pipeline_runs FOR INSERT
    WITH CHECK (created_by = (SELECT auth.uid()));

  CREATE POLICY "pipeline_runs user can update own"
    ON public.pipeline_runs FOR UPDATE
    USING (created_by = (SELECT auth.uid()));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pipeline_runs policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- pipeline_run_events  (joins pipeline_runs.created_by)
-- Original policies live in 20260520_pipeline_event_bus.sql:
--   "pipeline_run_events user can read own"
--   "pipeline_run_events user can insert for own run"
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "pipeline_run_events user can read own"
    ON public.pipeline_run_events;
  DROP POLICY IF EXISTS "pipeline_run_events user can insert for own run"
    ON public.pipeline_run_events;
  -- Older / alternate names:
  DROP POLICY IF EXISTS "pipeline_run_events_owner" ON public.pipeline_run_events;
  DROP POLICY IF EXISTS "Users see own pipeline_run_events" ON public.pipeline_run_events;

  CREATE POLICY "pipeline_run_events user can read own"
    ON public.pipeline_run_events FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.pipeline_runs r
        WHERE r.id = pipeline_run_events.run_id
          AND r.created_by = (SELECT auth.uid())
      )
    );

  CREATE POLICY "pipeline_run_events user can insert for own run"
    ON public.pipeline_run_events FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.pipeline_runs r
        WHERE r.id = pipeline_run_events.run_id
          AND r.created_by = (SELECT auth.uid())
      )
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pipeline_run_events policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- profiles  (uses `id`, not `user_id`)
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own profile" ON public.profiles;
  DROP POLICY IF EXISTS "profiles_owner" ON public.profiles;
  DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;

  CREATE POLICY "profiles_owner" ON public.profiles
    FOR ALL USING (id = (SELECT auth.uid()));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'profiles policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- credit_ledger  (uses user_id)
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "Users see own credits" ON public.credit_ledger;
  DROP POLICY IF EXISTS "Users own credits" ON public.credit_ledger;
  DROP POLICY IF EXISTS "credit_ledger_owner" ON public.credit_ledger;

  CREATE POLICY "credit_ledger_owner" ON public.credit_ledger
    FOR ALL USING (user_id = (SELECT auth.uid()));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'credit_ledger policy update skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- Tables flagged "RLS Enabled No Policy" — entity_questions and
-- pairwise_connection_checks. These had RLS enabled with no policy
-- attached, meaning the entire table was effectively unreadable. They
-- aren't referenced from `src/` anymore (only from old migrations), so
-- attach a deny-by-default policy. If you actually need them, swap
-- "false" for the proper predicate.
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  DROP POLICY IF EXISTS "entity_questions_default_deny" ON public.entity_questions;
  CREATE POLICY "entity_questions_default_deny" ON public.entity_questions
    FOR ALL USING (false);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'entity_questions deny-policy skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  DROP POLICY IF EXISTS "pairwise_connection_checks_default_deny"
    ON public.pairwise_connection_checks;
  CREATE POLICY "pairwise_connection_checks_default_deny"
    ON public.pairwise_connection_checks
    FOR ALL USING (false);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pairwise_connection_checks deny-policy skipped: %', SQLERRM;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- Done.
--
-- If you ran v1 of this migration and it failed mid-way: this version
-- is fully idempotent. Just paste and run again — every block is
-- independent (DO/EXCEPTION) so partial successes carry over and
-- failures emit RAISE NOTICE messages without aborting the whole run.
-- ───────────────────────────────────────────────────────────────────
