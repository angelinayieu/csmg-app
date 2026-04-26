-- ── Batch 6 · canonical node signature substrate ──
--
-- Slots a per-node canonical signature alongside every KG entity so the
-- three-panel unravelling UI has a stable key that survives refinement.
-- One more variable on a node = one more element in the basis array =
-- one more ring in the layered-circle visual.
--
-- This migration is purely additive:
--   1. `entities` gains `node_signature` JSONB + `resolution_zoom` +
--      `resolution_horizon` columns. All nullable — old rows render fine.
--   2. `edges` gains a `relation_type` enum column promoting the
--      free-text `relationship_type` to a closed vocabulary. The
--      free-text field stays (backward compat); the enum rides alongside
--      and is populated by the signature_materializer agent.
--   3. `pipeline_run_events.event_type` CHECK widens to accept
--      `signature_deepened`.
--
-- No existing data migrates here. A separate backfill task (out of
-- scope for this migration) will walk existing entities and populate
-- signatures from their current edges.

-- ── 1. Typed relation enum ──────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'relation_type') then
    create type relation_type as enum (
      'causes',
      'enables',
      'inhibits',
      'moderates',
      'mediates',
      'constrains',
      'composes',
      'competes',
      'temporally_precedes',
      'relates_to'
    );
  end if;
end $$;

-- ── 2. Resolution-level enums ──────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'resolution_horizon') then
    create type resolution_horizon as enum (
      'immediate',
      'hours',
      'days',
      'months',
      'years',
      'indefinite'
    );
  end if;
end $$;

-- ── 3. entities: signature + resolution plane ──────────────────────────

alter table public.entities
  add column if not exists node_signature    jsonb,
  add column if not exists resolution_zoom   smallint,
  add column if not exists resolution_horizon resolution_horizon;

-- Zoom is 0..5 per the NodeSignature contract. Enforce at DB level so a
-- bad materializer run can't sneak a 7 past the type system.
alter table public.entities
  drop constraint if exists entities_resolution_zoom_range;
alter table public.entities
  add constraint entities_resolution_zoom_range
  check (resolution_zoom is null or (resolution_zoom between 0 and 5));

-- Signature canonical_code is the lookup key for cross-panel
-- synchronization. Query-heavy — index the expression so the UI can
-- find "the same node" across landscape / KG / app panels cheaply.
create index if not exists entities_signature_canonical_code_idx
  on public.entities ((node_signature->>'canonical_code'))
  where node_signature is not null;

-- ── 4. edges: typed relation alongside free-text ────────────────────────

alter table public.edges
  add column if not exists relation_type relation_type;

-- Default the column to 'relates_to' for any future INSERT that forgets
-- it. Historical rows stay NULL — the UI's ring renderer treats NULL as
-- "not yet classified" and shows a dashed fallback.
alter table public.edges
  alter column relation_type set default 'relates_to';

create index if not exists edges_relation_type_idx
  on public.edges (relation_type)
  where relation_type is not null;

-- ── 5. Widen pipeline_run_events.event_type CHECK ──────────────────────
--
-- Mirrors the style of 20260526_event_type_expansions.sql: drop the
-- existing CHECK and rebuild with the full union so historical rows
-- keep validating while new signature_deepened events are accepted.

alter table public.pipeline_run_events
  drop constraint if exists pipeline_run_events_event_type_check;

alter table public.pipeline_run_events
  add constraint pipeline_run_events_event_type_check
  check (event_type in (
    -- Core structural stream
    'stage_boundary',
    'entity_added',
    'edge_added',
    'cycle_detected',
    'bridge_formed',
    'proposal_ready',
    'source_cited',
    'prediction_recorded',
    -- Streaming reasoning trace
    'reasoning_chunk',
    -- Probability-space choreography
    'space_opened',
    'space_entity_added',
    'space_edge_added',
    'cross_space_link',
    'space_merge_begin',
    'space_merge_complete',
    -- Cross-domain structural analogy
    'structural_analog_found',
    -- Canonical node signature deepening (this migration)
    'signature_deepened',
    -- VP Project report events
    'taxonomy_inferred',
    'variant_proposed'
  ));

-- ── 6. Invariant trigger: basis.length === rings && canonical_code matches ──
--
-- Without this, a buggy materializer could persist a 3-ring signature
-- whose basis array has 4 elements and the UI would paint ghost rings
-- forever. Enforce at write time so client-side validateNodeSignature()
-- stays advisory.

create or replace function public.node_signature_invariants()
returns trigger
language plpgsql
as $node_sig_fn$
declare
  sig_rings int;
  sig_basis_len int;
  sig_code text;
  rebuilt_code text;
begin
  if new.node_signature is null then
    return new;
  end if;

  sig_rings := (new.node_signature->>'rings')::int;
  sig_basis_len := jsonb_array_length(new.node_signature->'basis');
  sig_code := new.node_signature->>'canonical_code';

  if sig_rings is null or sig_rings <> sig_basis_len then
    raise exception 'node_signature.rings (%) must equal basis.length (%)',
      sig_rings, sig_basis_len;
  end if;

  -- Rebuild canonical_code from basis[].code sorted by index. Mirrors
  -- buildCanonicalCode() in src/types/node-signature.ts — keep both in
  -- sync or the trigger rejects otherwise-valid writes.
  --
  -- We use direct scalar-subquery assignment (`var := (select ...)`)
  -- rather than `SELECT ... INTO var FROM ...` because some SQL editors
  -- mis-parse the latter as a Postgres `SELECT INTO TABLE` statement,
  -- producing the misleading error: relation "<var>" does not exist.
  rebuilt_code := (
    select string_agg(basis_elem->>'code', '.' order by (basis_elem->>'index')::int)
      from jsonb_array_elements(new.node_signature->'basis') as basis_elem
  );

  if sig_code is distinct from rebuilt_code then
    raise exception 'node_signature.canonical_code (%) must equal basis join (%)',
      sig_code, rebuilt_code;
  end if;

  return new;
end;
$node_sig_fn$;

drop trigger if exists node_signature_invariants_trg on public.entities;
create trigger node_signature_invariants_trg
  before insert or update of node_signature on public.entities
  for each row
  execute function public.node_signature_invariants();

-- RLS is unchanged — entities already own their row via space_id →
-- spaces.user_id. New columns inherit the existing policies.
