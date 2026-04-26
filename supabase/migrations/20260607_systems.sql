-- ── Phase 4 — `systems` as first-class primitive ────────────────────
--
-- Background: the canvas already produces a half-dozen graph-shaped
-- surfaces (per-axis shells, synthesis intersection, root-cause
-- atlas, the merged KG, per-app sub-KGs) but there's no shared
-- abstraction for "this specific cluster of entities + edges is a
-- distinct *system* the user cares about, can name, save, compare,
-- and run experiments against."
--
-- This migration introduces that abstraction. A `system` is a saved
-- subgraph: a name + the entity_ids + edge_ids that compose it,
-- plus a pre-computed classification telling the user (and the lab)
-- what KIND of system it is.
--
-- Sources of systems:
--   - cycle               → each detected feedback loop becomes a
--                           candidate system (auto-promotable)
--   - convergent_point    → focal + interactors → candidate system
--   - root_cause_subtree  → branch from the root-cause-tree
--   - mechanism           → existing mechanism row promoted to a system
--   - user_lasso          → user explicitly selected entities on the
--                           canvas and saved them as a system
--
-- Classification (auto-computed at save time, not user-input):
--   - is_open         → does any boundary entity have a cross-axis
--                       link or bridge to outside this system?
--   - is_probabilistic→ median edge confidence across this system's
--                       edges < 0.5 (high uncertainty = probabilistic)
--   - is_complex      → contains at least one cycle (feedback loop)
--                       within its entity set
--
-- Why these three (and not Checkland's full 5): they're the ones
-- that change downstream behavior. Probabilistic systems need MC
-- simulation; complex systems need iterative experimentation; open
-- systems need external-signal monitoring. The other classifications
-- (physical/conceptual, natural/artificial) are interesting taxonomy
-- but don't unlock features in this product, so we skip them rather
-- than add metadata noise.
--
-- Storage shape:
--   entity_ids[] / edge_ids[] are uuid arrays. Querying "which
--   systems contain entity X" uses GIN index on entity_ids.
--   Detail page hydrates entities/edges by joining with a
--   single = ANY() clause.

create table if not exists public.systems (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- ── User-facing identity ───────────────────────────────────────
  name text not null,
  description text,

  -- ── Composition (the subgraph) ─────────────────────────────────
  -- Arrays of entity uuids + edge uuids. The system "contains" these.
  -- Edges referenced here MUST connect two entities also in entity_ids
  -- (enforced in the API write path, not the schema, because Postgres
  -- can't elegantly express that constraint without triggers).
  entity_ids uuid[] not null default '{}',
  edge_ids uuid[] not null default '{}',

  -- ── Provenance ────────────────────────────────────────────────
  -- How was this system surfaced?
  source_kind text not null check (
    source_kind in (
      'cycle',
      'convergent_point',
      'root_cause_subtree',
      'mechanism',
      'user_lasso',
      'manual'
    )
  ),
  -- Backref to the source row when it's a single canonical record
  -- (cycle.id, convergent_points.id, mechanisms.id). Null for
  -- user_lasso / manual / multi-source provenance.
  source_ref_id uuid,

  -- Optional link to the objective this system is being analyzed
  -- against. Lets the UI scope "show me systems serving Goal X".
  objective_id uuid references public.improvement_goals(id) on delete set null,

  -- ── Auto-classification ───────────────────────────────────────
  -- Computed at create + on update; not user-editable.
  is_open boolean not null default false,
  is_probabilistic boolean not null default false,
  is_complex boolean not null default false,

  -- Stored summary stats so the browse page renders without
  -- recomputing. Updated whenever entity_ids/edge_ids change.
  entity_count integer not null default 0,
  edge_count integer not null default 0,
  cycle_count integer not null default 0,
  median_edge_confidence numeric,

  -- ── Lifecycle ─────────────────────────────────────────────────
  status text not null default 'active' check (
    status in ('active', 'archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_systems_space on public.systems(space_id);
create index if not exists idx_systems_user on public.systems(user_id);
create index if not exists idx_systems_objective on public.systems(objective_id);
create index if not exists idx_systems_status on public.systems(status);
-- GIN for "which systems contain entity X" lookups.
create index if not exists idx_systems_entity_ids on public.systems using gin (entity_ids);

-- updated_at trigger — match the pattern used by other tables.
create or replace function public.touch_systems_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_systems_touch on public.systems;
create trigger trg_systems_touch
  before update on public.systems
  for each row execute function public.touch_systems_updated_at();

-- RLS: owner-only.
alter table public.systems enable row level security;

drop policy if exists systems_owner_select on public.systems;
create policy systems_owner_select on public.systems
  for select using (auth.uid() = user_id);

drop policy if exists systems_owner_insert on public.systems;
create policy systems_owner_insert on public.systems
  for insert with check (auth.uid() = user_id);

drop policy if exists systems_owner_update on public.systems;
create policy systems_owner_update on public.systems
  for update using (auth.uid() = user_id);

drop policy if exists systems_owner_delete on public.systems;
create policy systems_owner_delete on public.systems
  for delete using (auth.uid() = user_id);

comment on table public.systems is
  'Phase 4 — saved subgraph (entities + edges) representing a coherent system the user wants to name, browse, compare, and experiment against in the lab. Sources: auto-discovered (cycle / convergent / root-subtree / mechanism) or user-saved (lasso). Classification fields (is_open / is_probabilistic / is_complex) are computed at save time and drive downstream behavior (MC sim, signal monitoring, iterative testing).';

comment on column public.systems.is_open is
  'True when any entity in the system has a cross-axis link or bridge to an entity outside the system. Open systems require external-signal monitoring (radar / weave).';

comment on column public.systems.is_probabilistic is
  'True when the median edge confidence across the system''s edges is below 0.5. Probabilistic systems need Monte Carlo simulation; deterministic ones support analytical reasoning.';

comment on column public.systems.is_complex is
  'True when the system contains at least one detected cycle (reinforcing or balancing feedback loop). Complex systems require iterative experimentation; simple systems support direct intervention.';
