-- ── Phase 3 subscriptions: persist Stripe identifiers on profile ──
-- Lets the billing portal route resolve `auth.user` → Stripe customer,
-- and lets the webhook idempotently update the subscription row.

alter table public.profiles
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text;

create index if not exists profiles_stripe_customer_idx
  on public.profiles(stripe_customer_id)
  where stripe_customer_id is not null;
