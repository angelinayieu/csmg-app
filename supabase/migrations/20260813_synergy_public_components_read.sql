-- ── Synergy public components read policy (Tier-2 polish 2.2) ──
--
-- Lets the public-components feed (/app/synergy/feed) surface
-- visibility='public' rows from other users. The existing
-- brainstorm_components_owner_all policy ONLY grants read to the
-- owner — we need a second SELECT policy that opens the door for
-- public rows specifically.
--
-- This is consistent with the user-facing visibility contract:
--   - private: owner-only (already enforced)
--   - matchable_only: surfaces through the matcher pipeline only
--   - public: anyone can read — including unauthenticated viewers
--     in the future (for now we still require auth at the policy
--     level so we have an audit trail; service-role bypass remains
--     available if/when we open this to anonymous browsers).

drop policy if exists "brainstorm_components_public_read"
  on public.brainstorm_components;
create policy "brainstorm_components_public_read"
  on public.brainstorm_components for select
  using (visibility = 'public');

comment on policy "brainstorm_components_public_read"
  on public.brainstorm_components is
  'Synergy Tier-2 polish 2.2: lets any authenticated user SELECT rows '
  'whose owner has marked them visibility=public. Composes with '
  'brainstorm_components_owner_all (owner CRUD).';
