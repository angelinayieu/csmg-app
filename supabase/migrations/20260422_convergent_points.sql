-- Node Probability Space: convergent points
-- A convergent point is (focal_entity, interactor_set, conditions) → outcome.
-- For a given focal node, its "probability space" is the set of all convergent
-- points — the enumeration of what the node becomes / produces / fails as under
-- varying interactor combinations. Analogous to a reaction matrix in chemistry.

-- ── Main table ──
create table if not exists public.convergent_points (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  focal_entity_id uuid not null references public.entities(id) on delete cascade,

  -- 1-N interactors. UUIDs of entities already in the graph.
  interactor_entity_ids uuid[] not null default '{}',

  -- External context conditions the LLM added that aren't entities
  external_conditions text[] not null default '{}',

  -- The outcome record — kept as JSONB because the shape may evolve
  outcome jsonb not null,

  -- Probability of this outcome occurring given the interactor combination (0-1)
  probability real not null default 0.5 check (probability >= 0 and probability <= 1),
  -- Our confidence in the outcome description itself (0-1)
  confidence real not null default 0.6 check (confidence >= 0 and confidence <= 1),

  -- Where this convergent point came from
  generation_method text not null check (generation_method in (
    'empirical_edge',         -- direct existing edge
    'structural_derivation',  -- 2-hop path inference
    'analogical_mapping',     -- role-pattern match from another system
    'domain_inference',       -- LLM-added interactor
    'adversarial'             -- deliberate counterexample
  )),

  -- Optional tag for pattern library (filled when structural signature matches
  -- a known pattern, or assigned for future clustering)
  pattern_tag text,

  -- Structural signature — the abstract shape that makes this comparable
  -- across focal nodes. Used by the future pattern-library aggregator.
  -- Shape: { focal_role, interactor_roles[], outcome_polarity,
  --          outcome_reversibility, outcome_time_horizon }
  structural_signature jsonb,

  -- Objective alignment scores (array of { objective_id, score, reasoning })
  objective_alignment jsonb not null default '[]',

  -- Evidence basis — which entities / edges / claims back this point
  evidence_basis jsonb not null default '[]',

  generated_at timestamptz not null default now(),
  generated_by text default 'llm',

  created_at timestamptz not null default now()
);

-- ── Indexes ──
create index if not exists convergent_points_space_idx on public.convergent_points (space_id);
create index if not exists convergent_points_focal_idx on public.convergent_points (focal_entity_id);
create index if not exists convergent_points_pattern_idx on public.convergent_points (pattern_tag)
  where pattern_tag is not null;
-- GIN index on interactor_entity_ids for "show me all convergent points involving entity X"
create index if not exists convergent_points_interactors_idx on public.convergent_points
  using gin (interactor_entity_ids);

-- ── Enable RLS ──
alter table public.convergent_points enable row level security;

-- Users can only see convergent points in spaces they own
drop policy if exists "users_read_own_convergent_points" on public.convergent_points;
create policy "users_read_own_convergent_points" on public.convergent_points
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = convergent_points.space_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "users_write_own_convergent_points" on public.convergent_points;
create policy "users_write_own_convergent_points" on public.convergent_points
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = convergent_points.space_id and s.user_id = auth.uid()
    )
  );
