-- Topology vocabulary for edges + fault entity category
-- Enables set-theoretic reasoning (inside/overlap/meets/disjoint/composes/cover/equal)
-- on top of the existing semantic relationship_type, and promotes contradictions
-- from synthesis_data JSONB to first-class "fault" entities in the graph.

-- ── 1. Edge topology column (nullable — coexists with existing edges) ──

alter table public.edges
  add column if not exists topology text;

-- Allowed values. NULL permitted so existing edges and edges the LLM doesn't
-- annotate remain valid. Over time we backfill with a derivation rule.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'edges_topology_check'
  ) then
    alter table public.edges
      add constraint edges_topology_check
      check (
        topology is null or topology in (
          'inside', 'overlap', 'meets', 'disjoint',
          'composes', 'cover', 'equal'
        )
      );
  end if;
end $$;

create index if not exists edges_topology_idx on public.edges (topology)
  where topology is not null;

-- ── 2. Extend entity_category to permit 'fault' ──
-- Contradictions currently live as loose JSON in spaces.synthesis_data and never
-- become visible graph structure. Promoting them to entities lets synthesis and
-- critique operate on them directly and surfaces them in the graph UI.

do $$
begin
  -- Drop the existing check constraint if present (name varies by project history,
  -- so we search by column+kind rather than by a guessed name).
  perform 1
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'entities'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%entity_category%';

  if found then
    execute (
      select 'alter table public.entities drop constraint ' || quote_ident(c.conname)
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = 'entities'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%entity_category%'
      limit 1
    );
  end if;
end $$;

alter table public.entities
  add constraint entities_entity_category_check
  check (entity_category in (
    'concrete', 'abstract', 'process', 'relational', 'epistemic', 'fault'
  ));

-- ── 3. Fault-specific metadata lives in existing provenance JSONB ──
-- No new columns needed. Faults store { severity, involved_entity_ids[],
-- assumption_text, conclusion_text } inside provenance.fault_meta so downstream
-- consumers can find them without a schema change.
