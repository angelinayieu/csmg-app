-- ============================================
-- CSMG v3b Migration: Rich Synthesis Data
-- Run this in Supabase SQL Editor AFTER migration-v3.sql
-- ============================================

-- Store rich synthesis output (leverage reasoning, risk mechanisms, bottleneck analysis, etc.)
-- This is the full structured output from Pass 2 that doesn't fit in normalized tables.
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS synthesis_data JSONB;
