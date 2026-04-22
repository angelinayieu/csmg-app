-- ── Signup credit grant (launch-gate #4) ──
--
-- New users get 20 credits on account creation. Enough for roughly:
--   - 20 quick runs (1 credit each)
--   - 6 standard runs (3 credits each)
--   - 2 deep runs (8 credits each)
--   - 1 comprehensive run (15 credits) + a little breathing room
--
-- This is a TRIAL bonus, not a recurring free tier — the urgency to
-- buy remains once the bonus is spent. Pricing strategy:
-- credit-based with one-time free trial, no subscription, no recurring
-- free monthly quota.
--
-- Design notes:
--   - Trigger on `auth.users` INSERT so the grant happens atomically
--     with signup; no race where a user exists in auth.users but
--     profiles.credit_balance is NULL.
--   - ON CONFLICT DO NOTHING so re-running this migration is safe
--     and so existing users aren't double-credited if the row
--     already exists.
--   - Uses SECURITY DEFINER so the trigger can write to public tables
--     regardless of who triggered the auth event.
--   - `reason = 'signup_bonus'` in the ledger so billing analytics can
--     distinguish trial credits from purchased credits — useful later
--     for cohort analysis (did trial users who spent all 20 convert?).
--   - The INSERT ... ON CONFLICT on profiles preserves any pre-existing
--     row (e.g., if a different trigger already created it) but still
--     grants the 20 credits into credit_ledger via a separate check.

CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_balance int;
BEGIN
  -- Upsert profile with 20 starting credits. If the profile row
  -- already exists (another trigger got there first), we update only
  -- when the existing balance is 0 or NULL — never stomp a user who
  -- somehow already has credits.
  INSERT INTO public.profiles (id, credit_balance)
  VALUES (new.id, 20)
  ON CONFLICT (id) DO UPDATE
    SET credit_balance = CASE
      WHEN public.profiles.credit_balance IS NULL OR public.profiles.credit_balance = 0
        THEN 20
      ELSE public.profiles.credit_balance
    END
  RETURNING credit_balance INTO existing_balance;

  -- Log the grant in credit_ledger for audit + analytics.
  -- If the profile already existed with a non-zero balance, we skip
  -- the ledger write — that user isn't getting a NEW bonus.
  IF existing_balance = 20 THEN
    INSERT INTO public.credit_ledger (user_id, amount, reason, balance_after)
    VALUES (new.id, 20, 'signup_bonus', 20);
  END IF;

  RETURN new;
END;
$$;

-- Replace any existing trigger with the same name so this migration
-- is idempotent. The trigger fires AFTER INSERT on auth.users — we
-- only care about new signups, not updates to existing auth rows.
DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_credits();

-- Document the intent on the function itself so pgAdmin / supabase
-- dashboard readers see the why without git-blaming.
COMMENT ON FUNCTION public.handle_new_user_credits() IS
  'Grants new users 20 trial credits + logs the grant in credit_ledger.'
  ' Idempotent: existing users with a non-zero balance are untouched.'
  ' Installed by 20260522_signup_credit_grant.sql.';
