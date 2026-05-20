-- ── Synergy Phase 5 — tighten function grants ──
--
-- Two follow-up REVOKEs to silence the security_definer_function
-- advisor warnings from the initial Phase 5 deploy:
--
-- 1. plan_step_checkins_set_updated_at — trigger function only;
--    nobody should call it via /rest/v1/rpc. Revoke ALL execute.
--
-- 2. synergy_match_strategies — granted to authenticated +
--    service_role by intent, but PUBLIC's default execute means anon
--    inherits access. Revoke from public to block anon; explicit
--    grants to authenticated + service_role remain.

revoke execute on function public.plan_step_checkins_set_updated_at()
  from public, anon, authenticated;

revoke execute on function public.synergy_match_strategies(
  source_strategy uuid,
  match_limit integer,
  stale_days integer
) from public;

-- Supabase's default privileges grant EXECUTE to anon explicitly,
-- so revoking from `public` alone isn't enough — anon retains the
-- explicit grant. Drop it.
revoke execute on function public.synergy_match_strategies(
  source_strategy uuid,
  match_limit integer,
  stale_days integer
) from anon;
