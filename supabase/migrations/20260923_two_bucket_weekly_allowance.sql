-- Phase 3 (credit metering): two-bucket balance + weekly plan allowance.
--
-- Bucket 1 = WEEKLY ALLOWANCE (from the monthly plan; resets every 7 days, NO
--            rollover). profiles.weekly_allowance is the plan's quota,
--            allowance_remaining is what's left this window, week_anchor is the
--            start of the current 7-day window.
-- Bucket 2 = PURCHASED CREDITS (profiles.credit_balance; Stripe packs; rolls
--            over, never expires). Unchanged.
--
-- Spend order: drain the weekly allowance FIRST, then fall back to credits.
-- Refill is LAZY (computed on read/spend) so no cron is needed and a missed
-- tick self-heals. plans.ts is the source of the per-plan weekly quotas
-- (free 10 / standard 50 / pro 150).

-- ── profiles columns (additive; existing rows backfilled by the DEFAULT) ──
alter table public.profiles
  add column if not exists plan text not null default 'free',
  add column if not exists weekly_allowance integer not null default 10,
  add column if not exists allowance_remaining integer not null default 10,
  add column if not exists week_anchor timestamptz not null default now();

-- Distinguish allowance vs credit spend in the audit trail.
alter table public.credit_ledger
  add column if not exists bucket text;

comment on column public.profiles.weekly_allowance is
  'The plan''s weekly round quota (free 10 / standard 50 / pro 150 — see plans.ts). Set by set_user_plan() from the Stripe subscription webhook.';
comment on column public.profiles.allowance_remaining is
  'Rounds left in the current 7-day window. Lazily refilled to weekly_allowance by spend_credits_v2 / get_spendable when the window rolls.';
comment on column public.profiles.week_anchor is
  'Start of the current 7-day allowance window. Advances by whole 7-day periods on refill (no drift, no stacking).';

-- ── get_spendable: effective spendable = lazily-refilled allowance + credits ──
-- Pure READ (does not persist the refill) so reserve-time pre-checks and the
-- balance API agree with what spend_credits_v2 will actually do.
create or replace function public.get_spendable(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when week_anchor is null or now() - week_anchor >= interval '7 days'
        then coalesce(weekly_allowance, 0)          -- a window has rolled → full quota
      else coalesce(allowance_remaining, 0)
    end, 0)
    + coalesce(credit_balance, 0)
  from public.profiles
  where id = p_user_id;
$$;

-- ── spend_credits_v2: atomic two-bucket spend with lazy weekly refill ──
-- Allowance first, then credits. Returns a JSON result; success=false (with no
-- mutation to the balances) when the user can't afford p_amount.
create or replace function public.spend_credits_v2(p_user_id uuid, p_amount integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow   integer;
  v_anchor  timestamptz;
  v_weekly  integer;
  v_credits integer;
  v_from_allow   integer;
  v_from_credits integer;
begin
  select allowance_remaining, week_anchor, weekly_allowance, credit_balance
    into v_allow, v_anchor, v_weekly, v_credits
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    return json_build_object('success', false, 'error', 'no_profile');
  end if;

  -- Lazy weekly refill: advance the anchor by whole 7-day periods.
  if v_anchor is null then
    v_anchor := now();
    v_allow  := coalesce(v_weekly, 0);
  elsif now() - v_anchor >= interval '7 days' then
    v_allow  := coalesce(v_weekly, 0);
    v_anchor := v_anchor
      + (floor(extract(epoch from (now() - v_anchor)) / 604800)::int) * interval '7 days';
  end if;

  v_allow   := coalesce(v_allow, 0);
  v_credits := coalesce(v_credits, 0);

  if p_amount <= 0 then
    update public.profiles
      set allowance_remaining = v_allow, week_anchor = v_anchor
      where id = p_user_id;
    return json_build_object('success', true, 'from_allowance', 0, 'from_credits', 0,
      'allowance_remaining', v_allow, 'credit_balance', v_credits);
  end if;

  v_from_allow   := least(v_allow, p_amount);
  v_from_credits := p_amount - v_from_allow;

  if v_credits < v_from_credits then
    -- Can't afford. Persist the refill (so the window state is current) but do
    -- NOT spend anything.
    update public.profiles
      set allowance_remaining = v_allow, week_anchor = v_anchor
      where id = p_user_id;
    return json_build_object('success', false, 'error', 'insufficient',
      'allowance_remaining', v_allow, 'credit_balance', v_credits, 'required', p_amount);
  end if;

  update public.profiles
    set allowance_remaining = v_allow - v_from_allow,
        credit_balance      = v_credits - v_from_credits,
        week_anchor         = v_anchor
    where id = p_user_id;

  return json_build_object('success', true,
    'from_allowance', v_from_allow, 'from_credits', v_from_credits,
    'allowance_remaining', v_allow - v_from_allow,
    'credit_balance', v_credits - v_from_credits);
end;
$$;

-- ── set_user_plan: assign a plan + (re)seed the weekly allowance ──
-- Called from the Stripe subscription webhook on create/update. Resets the
-- window so the new quota is immediately available.
create or replace function public.set_user_plan(
  p_user_id uuid, p_plan text, p_weekly integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set plan = p_plan,
        weekly_allowance = greatest(0, p_weekly),
        allowance_remaining = greatest(0, p_weekly),
        week_anchor = now()
    where id = p_user_id;
end;
$$;

grant execute on function public.get_spendable(uuid) to authenticated, service_role;
grant execute on function public.spend_credits_v2(uuid, integer) to authenticated, service_role;
grant execute on function public.set_user_plan(uuid, text, integer) to service_role;
