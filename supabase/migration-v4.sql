-- ============================================
-- CSMG v4 Migration: Tiered Reasoning + Credits
-- Run this in Supabase SQL Editor
-- ============================================

-- Credit ledger for usage tracking
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  space_id UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON public.credit_ledger(user_id);
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own credits" ON public.credit_ledger
  FOR ALL USING (auth.uid() = user_id);

-- Add credit balance to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credit_balance INTEGER DEFAULT 10;

-- Add tier tracking to spaces
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS analysis_tier TEXT DEFAULT 'quick';
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0;
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS agent_count INTEGER DEFAULT 2;
