-- ── Synergy strategy share tokens (Tier-2 polish 2.4) ──
--
-- Mints unguessable URLs that grant read-only access to a strategy
-- doc without the viewer being authenticated. Anticipated by the
-- 20260803_synergy_strategies migration comment ("Share read-only
-- link (Phase 5+) which mints a separate share_tokens row").
--
-- Public read happens via the service-role client in
-- /api/synergy/shared/[token] — RLS only protects owner-side CRUD
-- (issue / list / revoke). The route enforces freshness (not
-- revoked, not expired) before serving the doc.

create table if not exists public.synergy_strategy_share_tokens (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.synergy_strategies(id) on delete cascade,
  -- 32-char URL-safe random string, generated client-side at insert
  -- time. Index-backed unique to prevent collisions on retry.
  token text not null unique,
  -- Owner who minted the link. RLS pins ops to this user; deleting
  -- the auth user cascades the row (keeps storage tidy).
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Optional TTL. NULL means "never expires" (until revoked).
  expires_at timestamptz,
  -- When the owner clicks "Revoke". Soft-delete style so analytics
  -- can attribute past views after the link goes dark.
  revoked_at timestamptz,
  -- Updated by the public read endpoint on each hit.
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  -- Human label so the owner can keep multiple links straight
  -- ("draft for Alex", "investor preview", etc.). Optional.
  label text
);

create index if not exists synergy_strategy_share_tokens_strategy_idx
  on public.synergy_strategy_share_tokens(strategy_id);

create index if not exists synergy_strategy_share_tokens_token_idx
  on public.synergy_strategy_share_tokens(token);

alter table public.synergy_strategy_share_tokens enable row level security;

drop policy if exists "synergy_strategy_share_tokens_owner_all"
  on public.synergy_strategy_share_tokens;
create policy "synergy_strategy_share_tokens_owner_all"
  on public.synergy_strategy_share_tokens for all
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

comment on table public.synergy_strategy_share_tokens is
  'Synergy Tier-2 polish 2.4: tokens granting unauthenticated read-only '
  'access to a strategy doc. Public reads happen via service-role bypass; '
  'RLS only governs owner CRUD.';

-- ── Atomic view-counter bump ──
--
-- The /shared/[token] reader calls this RPC fire-and-forget on each
-- hit so concurrent reads don't clobber each other's UPDATE. Marked
-- SECURITY DEFINER so the service-role doesn't need column-level
-- privileges; the function only touches a single row by id.

create or replace function public.synergy_bump_share_view(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.synergy_strategy_share_tokens
    set view_count = view_count + 1,
        last_viewed_at = now()
    where id = p_share_id;
end;
$$;

revoke all on function public.synergy_bump_share_view(uuid) from public;
grant execute on function public.synergy_bump_share_view(uuid) to service_role;
