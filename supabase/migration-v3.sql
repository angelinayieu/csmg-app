-- ============================================
-- CSMG v3 Migration: Action Items Enhancement
-- Run this in Supabase SQL Editor
-- ============================================

-- Add path_label for conditional action plans (Builder/Team/Pivot paths)
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS path_label TEXT DEFAULT 'default';

-- Add why_text for reasoning behind each action
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS why_text TEXT;

-- Add tags for categorizing actions (e.g., "fixes bottleneck", "starts flywheel")
ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';
