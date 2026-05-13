-- ── Synergy email preferences + unsubscribe tokens (Phase 4d+2) ──
--
-- Adds:
--   synergy_profiles.email_notifications  — per-event opt-in jsonb
--   synergy_profiles.notification_email   — optional delivery override
--                                           (defaults to auth.users.email)
--   email_unsubscribe_tokens              — one-click unsubscribe links
--
-- Idempotent DDL throughout. The columns default to opt-in for
-- transactional events (new_request + request_accepted) and opt-out
-- for the weekly digest — matches typical UX expectations.

alter table public.synergy_profiles
  add column if not exists email_notifications jsonb not null default
    '{"new_request": true, "request_accepted": true, "weekly_digest": false}'::jsonb;

alter table public.synergy_profiles
  add column if not exists notification_email text;

alter table public.synergy_profiles
  drop constraint if exists synergy_profiles_notification_email_len_check;
alter table public.synergy_profiles
  add constraint synergy_profiles_notification_email_len_check
  check (notification_email is null or char_length(notification_email) between 3 and 320);

-- ── Unsubscribe tokens ──
--
-- One-time tokens minted when an email is sent. The user can hit the
-- unsubscribe link without logging in; the token validates them as
-- the recipient and flips the corresponding email_notifications key
-- to false. notification_key='all' is a fast-path that turns
-- everything off in one click.

create table if not exists public.email_unsubscribe_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  -- 90-day TTL — tokens stale after that. UI surfaces a "click again
  -- in the latest email" hint if redemption fails.
  expires_at timestamptz not null default (now() + interval '90 days')
);

alter table public.email_unsubscribe_tokens
  drop constraint if exists email_unsubscribe_tokens_key_check;
alter table public.email_unsubscribe_tokens
  add constraint email_unsubscribe_tokens_key_check
  check (notification_key in ('new_request', 'request_accepted', 'weekly_digest', 'all'));

create index if not exists email_unsubscribe_tokens_user_idx
  on public.email_unsubscribe_tokens(user_id, used_at);

-- ── RLS ──
-- Tokens are read/written through the unsubscribe endpoint via the
-- service-role client (since the user is unauthenticated when they
-- click the link). RLS denies anon access by default.

alter table public.email_unsubscribe_tokens enable row level security;

drop policy if exists "email_unsubscribe_tokens_owner_read" on public.email_unsubscribe_tokens;
create policy "email_unsubscribe_tokens_owner_read"
  on public.email_unsubscribe_tokens for select
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies for authenticated users — only
-- the service-role can mint/redeem tokens.

comment on column public.synergy_profiles.email_notifications is
  'Per-event email opt-in. Keys: new_request | request_accepted | weekly_digest.';
comment on column public.synergy_profiles.notification_email is
  'Optional override for the email destination. NULL falls back to auth.users.email.';
comment on table public.email_unsubscribe_tokens is
  'One-time tokens for unauthenticated unsubscribe. 90-day TTL.';
