-- ── Synergy Phase 5 polish — room divergence detector ──
--
-- Adds two nullable timestamp columns to synergy_rooms:
--
--   diverged_at             — set by the strategy matcher when ONE of
--                             the room's strategies has been
--                             regenerated and similarity with the
--                             partner's strategy drops below the
--                             persistence threshold (or the match row
--                             ceases to exist). Triggers a dismissable
--                             banner in the room interior.
--
--   divergence_dismissed_at — set by the user via POST
--                             /api/synergy/rooms/[id]/dismiss-divergence
--                             once they've acknowledged the divergence.
--                             The banner re-appears only if the matcher
--                             flags a NEW divergence after a subsequent
--                             regenerate (we clear dismissed_at when
--                             flagging diverged_at fresh).
--
-- Both nullable, both additive. No backfill needed — every existing
-- room starts with both as NULL (i.e. not diverged, not dismissed).
--
-- RLS on synergy_rooms is owner-aware via the existing
-- synergy_rooms_members_update policy, so members can dismiss without
-- a new policy needed.

alter table public.synergy_rooms
  add column if not exists diverged_at timestamptz,
  add column if not exists divergence_dismissed_at timestamptz;

comment on column public.synergy_rooms.diverged_at is
  'Set by the strategy matcher when this parallel-path room''s '
  'strategy pair similarity has dropped below the persistence floor '
  '(or the strategy_match row no longer exists). Drives the '
  'in-room divergence banner. Cleared when re-convergence is detected.';

comment on column public.synergy_rooms.divergence_dismissed_at is
  'Set by either member via POST /dismiss-divergence after they''ve '
  'acknowledged the divergence banner. The banner hides until the '
  'matcher flags a new divergence after a subsequent regenerate.';
