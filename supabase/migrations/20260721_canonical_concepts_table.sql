-- ── canonical_concepts — the Tier 1 (TBox) registry (W6.1) ───────────
--
-- Tier 1 of the 3-tier KG model. A canonical concept is a domain-
-- agnostic, cross-space concept (e.g. "Brain-Derived Neurotrophic
-- Factor" / canonical_code='bdnf') that situation-specific entities
-- (Tier 2 / ABox) link up to via entities.canonical_concept_id.
--
-- Producers:
--   • canonical-concept-matcher.ts (W6.2) calls
--     INSERT ... ON CONFLICT (canonical_code) DO NOTHING RETURNING
--     to atomically find-or-create. First writer wins; later writers
--     resolve via the unique-constraint conflict path.
--   • Three entity producers (W6.3) call the matcher right after
--     entity insert:
--       - persist-framing-protos.ts
--       - decompose/route.ts
--       - variable-proposals/[id]/approve/route.ts
--
-- Consumers:
--   • GET /api/canonical-concepts/[code] (W6.4) reads concept +
--     aggregate cross-space tally for the drawer UI.
--   • mediator-proposal.ts (W6.5, future) reads candidates filtered
--     by domain_tags to ground LLM suggestions.
--
-- ── RLS design ────────────────────────────────────────────────────
--
-- Shared registry: every authenticated user SELECTs; any
-- authenticated user INSERTs (with created_by = auth.uid()). No
-- per-user UPDATE/DELETE — the registry grows monotonically by
-- design. Tally columns (space_count, entity_count, last_seen_at)
-- are bumped by the matcher via security-definer function, NOT by
-- user-RLS UPDATE policies (which would let users spam-bump counts).
--
-- This means:
--   • Counts always reflect real entity links across the user base
--   • A malicious user can spam INSERT pending rows but can't bump
--     tallies on someone else's verified rows
--   • status flips from 'pending'→'verified' happen via a service-
--     side promotion path (admin or 3-spaces-threshold cron) — not
--     in this migration
--
-- ── Schema ────────────────────────────────────────────────────────

create table if not exists public.canonical_concepts (
  id uuid primary key default gen_random_uuid(),
  canonical_code text not null,
  display_name text not null,
  description text,
  domain_tags text[] not null default '{}',
  aliases text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'merged')),
  -- Cross-space tally — denormalized for fast UI reads.
  -- Bumped by canonical-concept-matcher.ts via a security-definer RPC
  -- (or directly when tallies are read on-demand).
  space_count int not null default 0,
  entity_count int not null default 0,
  last_seen_at timestamptz,
  -- Provenance.
  first_observed_space_id uuid references public.spaces (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- canonical_code is THE clustering key. Two entities with the same
  -- canonical_code by definition refer to the same canonical concept.
  unique (canonical_code)
);

-- ── Indexes ────────────────────────────────────────────────────────

-- Browsing queries (Surface 3 deferred — but index now so the future
-- library page is fast).
create index if not exists idx_canonical_concepts_domain_tags
  on public.canonical_concepts using gin (domain_tags);

create index if not exists idx_canonical_concepts_aliases
  on public.canonical_concepts using gin (aliases);

create index if not exists idx_canonical_concepts_status
  on public.canonical_concepts (status);

-- "Most active" / "last seen" ordering.
create index if not exists idx_canonical_concepts_last_seen
  on public.canonical_concepts (last_seen_at desc nulls last);

-- ── FK from entities ───────────────────────────────────────────────

-- W6.0 (migration 20260716) added entities.canonical_concept_id as a
-- nullable uuid with no FK constraint. Now that canonical_concepts
-- exists, add the FK. on delete set null keeps entities alive if a
-- concept is deleted (the entity becomes "uncategorized" rather than
-- being cascade-deleted).

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entities_canonical_concept_fk'
      and conrelid = 'public.entities'::regclass
  ) then
    alter table public.entities
      add constraint entities_canonical_concept_fk
      foreign key (canonical_concept_id)
      references public.canonical_concepts (id)
      on delete set null;
  end if;
end$$;

-- Lookup index for the FK column (the W6.4 GET endpoint joins
-- entities by canonical_concept_id, and the badge UI counts entities
-- per concept).
create index if not exists idx_entities_canonical_concept_id
  on public.entities (canonical_concept_id)
  where canonical_concept_id is not null;

-- ── RLS ────────────────────────────────────────────────────────────

alter table public.canonical_concepts enable row level security;

-- Everyone authenticated can SELECT (shared registry).
drop policy if exists canonical_concepts_select_all on public.canonical_concepts;
create policy canonical_concepts_select_all
  on public.canonical_concepts
  for select
  using (auth.uid() is not null);

-- Any authenticated user can INSERT a new concept (with their own
-- created_by). The unique (canonical_code) constraint handles
-- collisions: concurrent inserts of the same code → one wins, one
-- conflicts. The matcher catches the conflict and SELECTs the
-- winner.
drop policy if exists canonical_concepts_insert_auth on public.canonical_concepts;
create policy canonical_concepts_insert_auth
  on public.canonical_concepts
  for insert
  with check (created_by = auth.uid());

-- No UPDATE/DELETE policies for regular users. Tally bumps + status
-- promotion happen via service-role.

-- ── Comments ───────────────────────────────────────────────────────

comment on table public.canonical_concepts is
  'Tier 1 TBox registry. Cross-space canonical concepts that situation-specific entities (Tier 2) link to via entities.canonical_concept_id. Producers: canonical-concept-matcher.ts called from persist-framing-protos / decompose / variable-proposals approve. Consumer: GET /api/canonical-concepts/[code] for the entity-card drawer UI.';

comment on column public.canonical_concepts.canonical_code is
  'Deterministic slug produced by canonicalCode() in src/lib/kg/canonical-code.ts. Unique across the registry. Two entities with the same code refer to the same concept.';

comment on column public.canonical_concepts.status is
  '"pending" (new, single-space) → "verified" (≥3 spaces or admin-promoted) → "merged" (manual dedupe target). "rejected" = curator removed.';

comment on column public.canonical_concepts.space_count is
  'Number of distinct spaces with at least one entity linked to this concept. Denormalized — bumped by the matcher / refreshed on demand.';

comment on column public.canonical_concepts.entity_count is
  'Total entities linked to this concept across all spaces. Denormalized.';

comment on column public.canonical_concepts.first_observed_space_id is
  'The space whose entity first introduced this canonical concept to the registry. Set on initial INSERT, never updated.';
