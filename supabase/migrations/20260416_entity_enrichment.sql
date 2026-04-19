-- Entity Enrichment: causal roles + claims index
-- Adds causal_role classification for the 6-stage causal chain:
-- truth → evidence → deliverable → application → outcome → goal

-- ── Add causal_role to entities ──
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'causal_role'
  ) then
    alter table entities add column causal_role text
      check (causal_role is null or causal_role in (
        'truth', 'evidence', 'deliverable', 'application', 'outcome', 'goal'));
  end if;
end $$;

-- ── Index for claims by source entity (enables efficient entity→claims lookup) ──
create index if not exists idx_claims_source_entity on claims(source_entity_id);

-- ── Index for claims by space (already exists as idx_claims_space, but ensure) ──
create index if not exists idx_claims_space_source on claims(space_id, source_entity_id);
