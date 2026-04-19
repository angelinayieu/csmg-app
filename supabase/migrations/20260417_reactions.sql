-- Phase 11 — Reactions as first-class persisted objects.
--
-- Phase 9c.2 introduced LLM-driven interpretation of "combinations" of
-- entities (what does X × Y imply?). Those results were ephemeral — each
-- click re-ran the LLM. Phase 11 persists them so the user can revisit,
-- share, and have downstream agents (research, synthesis, strategy)
-- consume them as stable references.
--
-- A Reaction is a named interpretation of 2-4 entities' intersection:
--   - entity_ids: the participants
--   - name: short headline (<= 10 words)
--   - reaction_type: enum — emergent / reinforcing / tension / trivial
--   - probability: 0..1 (LLM's subjective confidence in the implication)
--   - ci_low / ci_high: optional confidence interval (0..1)
--   - mechanism: one-sentence how-it-works
--   - implication: 1-2 sentences — what the combination implies
--   - probes: follow-up questions
--   - provenance: where it came from (user / LLM / which endpoint call)
--
-- Deterministic lookup: `canonical_key` is a sorted, piped concatenation
-- of the entity UUIDs. A UNIQUE index on (space_id, canonical_key) lets
-- the client cheaply check "has this combination been saved already?"
-- before firing the LLM.

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,

  name text not null,
  reaction_type text not null check (
    reaction_type in ('emergent', 'reinforcing', 'tension', 'trivial')
  ),

  -- Participants. Storing as a uuid[] (not a join table) keeps the
  -- reaction a simple value-object; ordering-independence is enforced by
  -- `canonical_key`.
  entity_ids uuid[] not null check (
    cardinality(entity_ids) between 2 and 6
  ),
  -- Sorted, piped. Computed trigger-side so producers don't have to care.
  canonical_key text not null,

  probability double precision not null check (probability between 0 and 1),
  ci_low double precision check (ci_low between 0 and 1),
  ci_high double precision check (ci_high between 0 and 1),

  mechanism text,
  implication text,
  probes jsonb,

  -- Lineage
  source_tag text not null default 'llm' check (
    source_tag in ('user', 'llm', 'inferred')
  ),
  provenance jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reactions_space_canonical_uidx
  on public.reactions (space_id, canonical_key);

create index if not exists reactions_entity_ids_gin_idx
  on public.reactions using gin (entity_ids);

create index if not exists reactions_space_created_idx
  on public.reactions (space_id, created_at desc);

-- ── canonical_key trigger ─────────────────────────────────────────────
-- Guarantees equal reactions are deduplicated regardless of caller order.
create or replace function public.tg_reactions_canonical_key()
returns trigger language plpgsql as $$
begin
  new.canonical_key :=
    array_to_string(
      (select array_agg(e order by e) from unnest(new.entity_ids) e),
      '|'
    );
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_reactions_canonical_key on public.reactions;
create trigger trg_reactions_canonical_key
  before insert or update on public.reactions
  for each row execute function public.tg_reactions_canonical_key();

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.reactions enable row level security;

drop policy if exists "owner_read_reactions" on public.reactions;
create policy "owner_read_reactions" on public.reactions
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = reactions.space_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "owner_write_reactions" on public.reactions;
create policy "owner_write_reactions" on public.reactions
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = reactions.space_id and s.user_id = auth.uid()
    )
  );
