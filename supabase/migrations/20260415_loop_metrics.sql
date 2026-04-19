-- Self-Improving Loop: metrics snapshots + cycle records

CREATE TABLE IF NOT EXISTS public.kg_metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  cycle_id TEXT,
  captured_at TIMESTAMPTZ DEFAULT now(),
  metrics JSONB NOT NULL,
  trigger_type TEXT DEFAULT 'loop_cycle'
);

CREATE INDEX IF NOT EXISTS idx_metrics_space_time
  ON public.kg_metrics_snapshots(space_id, captured_at);

CREATE TABLE IF NOT EXISTS public.loop_cycle_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  cycle_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',
  trigger_type TEXT DEFAULT 'cron',
  depth_used TEXT DEFAULT 'standard',
  phases JSONB DEFAULT '[]',
  delta JSONB DEFAULT '{}',
  error_message TEXT,
  credits_used INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_loop_cycles_space
  ON public.loop_cycle_records(space_id, started_at);

-- RLS
ALTER TABLE public.kg_metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loop_cycle_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own metrics" ON public.kg_metrics_snapshots
  FOR ALL USING (
    space_id IN (SELECT id FROM public.spaces WHERE user_id = auth.uid())
  );

CREATE POLICY "Users see own loop cycles" ON public.loop_cycle_records
  FOR ALL USING (user_id = auth.uid());
