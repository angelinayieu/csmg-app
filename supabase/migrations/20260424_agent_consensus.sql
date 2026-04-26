-- ── Agent consensus substrate ────────────────────────────────────────
--
-- Adds the storage surfaces for multi-agent consensus:
--
--   1. edges.agent_feedback JSONB
--        Endorsements and disputes from auditor agents, shaped as:
--          {
--            "endorsements": [
--              { "agent": "causal_auditor", "reason": "...", "at": "..." }
--            ],
--            "disputes": [
--              { "agent": "critic", "reason": "...", "suggested": "...", "at": "..." }
--            ]
--          }
--        Shape-free JSONB rather than two typed columns because we
--        expect richer audit metadata over time (evidence links,
--        confidence, counter-arguments) and migrating JSONB is cheap.
--
--   2. entities.proposing_agents TEXT[]
--        Explicit canonical-agent-id list for consensus counting. This
--        is the FUTURE shape — existing rows fall back to the
--        `provenance` inference in agents/registry.ts. Populated
--        going-forward by agents that write entities; a background
--        backfill can populate it for legacy rows without blocking
--        this migration.
--
-- Indexes:
--   - GIN on agent_feedback so queries like "edges disputed by X" are fast
--   - GIN on proposing_agents so "entities proposed by X" is fast
--
-- Safety:
--   - IF NOT EXISTS on everything so re-running is a no-op
--   - Defaults preserve existing row semantics (no backfill needed for
--     the column to be well-formed; readers treat missing/empty identically)

alter table public.edges
  add column if not exists agent_feedback jsonb not null default '{"endorsements": [], "disputes": []}'::jsonb;

alter table public.entities
  add column if not exists proposing_agents text[] not null default '{}';

create index if not exists idx_edges_agent_feedback_gin
  on public.edges using gin (agent_feedback);

create index if not exists idx_entities_proposing_agents_gin
  on public.entities using gin (proposing_agents);

comment on column public.edges.agent_feedback is
  'Multi-agent endorsements + disputes on this edge. Written by edge-auditor and critic agents. Shape: {"endorsements":[{agent,reason,at}],"disputes":[{agent,reason,suggested,at}]}. See src/lib/pipeline/edge-auditor.ts.';

comment on column public.entities.proposing_agents is
  'Canonical agent ids (from src/lib/agents/registry.ts) that independently proposed this entity. Feeds the strategizer''s agent_convergence_count signal — entities that many distinct agents converged on rank higher.';
