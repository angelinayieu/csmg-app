-- Credit Reservation System for Atomic Analysis Submission
-- Prevents race condition: credits deducted even if database inserts fail
-- 
-- New flow:
-- 1. Reserve credits (creates record, can be cancelled)
-- 2. Run pipeline + insert all data
-- 3. Commit reservation (moves from reserved → committed)
-- 4. If any error, cancel reservation (reverses credit hold)

CREATE TABLE IF NOT EXISTS public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  -- Status: 'reserved' (temporary hold), 'committed' (final), 'cancelled' (reversed)
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  committed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  
  reason TEXT DEFAULT NULL,
  CONSTRAINT valid_status CHECK (status IN ('reserved', 'committed', 'cancelled')),
  CONSTRAINT amount_positive CHECK (amount > 0)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user_status 
  ON public.credit_reservations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires 
  ON public.credit_reservations(expires_at) 
  WHERE status = 'reserved';

-- Enable RLS
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own reservations
CREATE POLICY "Users can view their own reservations"
  ON public.credit_reservations FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: System can manage reservations (via service role)
CREATE POLICY "Service role can manage all reservations"
  ON public.credit_reservations FOR ALL
  USING (true) WITH CHECK (true);

-- Helper function to cleanup expired reservations (call via cron job)
CREATE OR REPLACE FUNCTION public.cleanup_expired_reservations()
RETURNS TABLE(cancelled_count INTEGER) AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.credit_reservations
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE status = 'reserved' AND expires_at < NOW();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_reservations TO service_role;
