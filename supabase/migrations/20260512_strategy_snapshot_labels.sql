-- ── Arc 4 Phase A — Strategy snapshot labels ──────────────────────────
--
-- Strategies are already versioned (strategy_snapshots.version, auto-incrementing,
-- insert-only). What's missing is a human-readable label the user can edit.
--
-- Default UI rendering = "v{version}". Once a user types a custom label
-- ("Pre-user-feedback", "Post-Phase-2 pivot", etc.) it persists here.
--
-- Why nullable, not NOT NULL with a default:
--   The label is an optional annotation. A NULL means "use the auto label".
--   We don't want to backfill existing rows with generated strings — they'd
--   look indistinguishable from user-authored ones.
--
-- Why no uniqueness constraint:
--   Users may reuse labels across spaces, or even within one lineage
--   (e.g. two "draft" versions they later clean up). Enforcement is social.

ALTER TABLE public.strategy_snapshots
  ADD COLUMN user_label text;

COMMENT ON COLUMN public.strategy_snapshots.user_label IS
  'Optional human-readable label (e.g. "Pre-feedback"). NULL ⇒ UI renders "v{version}".';
