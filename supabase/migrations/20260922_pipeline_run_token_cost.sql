-- Phase 1 (credit metering): attach real token usage + $ cost to each run.
--
-- A pipeline_run is the natural billing unit — one user-initiated operation
-- (decompose / research / synthesize / …) maps 1:1 to a run. Until now the
-- token usage the provider returns (OpenAI response.usage / Anthropic usage)
-- was extracted-and-discarded in src/lib/llm.ts, so we had NO ground-truth
-- cost. These columns are populated by the AsyncLocalStorage usage-meter
-- (src/lib/llm/usage-meter.ts): startPipelineRun opens a metering context,
-- every nested llmJSON/llmGenerate call accumulates into it, and
-- completePipelineRun flushes the aggregate here.
--
-- This is METERING only (observability + price-tuning input). It does NOT
-- charge credits — that's Phase 2 (the withCharge chokepoint). Additive,
-- all defaults 0, so existing rows + in-flight runs are unaffected.

alter table public.pipeline_runs
  add column if not exists tokens_prompt integer not null default 0,
  add column if not exists tokens_completion integer not null default 0,
  add column if not exists tokens_total integer not null default 0,
  add column if not exists cost_usd numeric(12, 6) not null default 0,
  add column if not exists llm_call_count integer not null default 0;

comment on column public.pipeline_runs.tokens_total is
  'Sum of prompt+completion tokens across every LLM call made during this run. Populated by src/lib/llm/usage-meter.ts via completePipelineRun. Ground-truth cost basis for tuning per-operation credit prices.';
comment on column public.pipeline_runs.cost_usd is
  'Estimated provider $ cost of this run, computed from per-model pricing in src/lib/llm/pricing.ts. Approximate — for internal cost visibility, not user billing.';
