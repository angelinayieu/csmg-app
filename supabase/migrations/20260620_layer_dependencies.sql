-- ── Layer Dependencies — cross-layer propagation cascades ─────────
--
-- Sibling table to `layer_ontology`. Where layer_ontology defines
-- the per-space vertical hierarchy (ordinal-ranked layers from
-- fundamental → emergent), layer_dependencies records DIRECTED
-- propagation claims between two layers — "changes at the Molecular
-- layer cascade UP to the Cognitive layer via BDNF signaling, with
-- lag ≈ weeks, strength 0.7, confidence 0.6."
--
-- WHY this table exists:
--   The synthesize pipeline runs a cross-layer cascade prediction
--   hop (D-track β) via LLM at:
--     src/lib/pipeline/cross-layer-cascade-prediction.ts
--   That module persists cascade claims here. Downstream consumers
--   (strategy-variants/generate, LayerStackShape arrows, variant
--   ripple chips) READ these rows to thread layer-aware context
--   into prompts and the canvas — including
--   recommendation.layer_focus.cascade on a stratified variant.
--
-- HISTORY note:
--   The writer + reader code (`cross-layer-cascade-prediction.ts`)
--   and the synthesize-route hop (line 2865-2933) shipped earlier
--   in their final form, but the DDL migration was missed. This
--   migration fills that gap. Prior cascade-prediction calls
--   silently failed (PostgREST relation-does-not-exist) and the
--   route's outer try/catch swallowed the error → variants
--   generated up to now have null `layer_focus.cascade`. Re-running
--   synthesize on existing spaces will backfill once this migration
--   is applied.
--
-- Idempotency:
--   The writer DELETES existing (space_id, user_id, source=llm_inferred)
--   rows before upserting fresh ones. User-authored / hybrid rows
--   survive that delete. Upserts conflict on the (space_id,
--   from_layer_id, to_layer_id) unique index → previous LLM row
--   for the same pair gets replaced.

-- ──────────────────────────────────────────────────────────────────
-- Pre-flight dependency guards
-- ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='spaces') then
    raise exception 'layer_dependencies migration requires spaces table';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='layer_ontology') then
    raise exception 'layer_dependencies migration requires layer_ontology table (see 20260615_layer_ontology.sql)';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────
-- Table
-- ──────────────────────────────────────────────────────────────────

create table if not exists public.layer_dependencies (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- ── Endpoints ──
  -- Both reference layer_ontology rows in the SAME space. The writer
  -- validates the LLM's layer ids against the ontology row set
  -- before insert; the FK + CHECK constraints below are
  -- defence-in-depth.
  from_layer_id uuid not null references public.layer_ontology(id) on delete cascade,
  to_layer_id   uuid not null references public.layer_ontology(id) on delete cascade,

  -- ── Cascade descriptor ──
  -- Closed vocabulary mirrors the LLM prompt enum. See
  -- src/lib/prompts/cross-layer-cascade.ts (CrossLayerCascadeLLMOutput
  -- type) and VALID_KINDS in cross-layer-cascade-prediction.ts.
  --   "causal"       — A directly causes B (typical directional claim)
  --   "modulatory"   — A modulates B's response without driving it alone
  --   "inhibitory"   — A suppresses or dampens B
  --   "compensatory" — When A drops, B rises to maintain function (and vv)
  --   "reinforcing"  — A and B mutually amplify (emit two rows: A→B + B→A)
  kind text not null,

  -- 0..1 strength of the cascade claim. Higher = the LLM is more
  -- confident this propagation is real. Distinct from `confidence`
  -- (which captures evidence-grounding rather than effect size).
  strength numeric not null,

  -- Lag description. Free-text label ("minutes", "days", "weeks",
  -- "months", "varies") plus optional numeric estimate. lag_hours
  -- can be null when the LLM declines to commit to a number.
  lag_label text,
  lag_hours numeric,

  -- The load-bearing claim. Per the prompt CRITICAL RULE #1:
  -- "EVERY cascade you propose MUST name a real mechanism — not just
  -- 'A affects B' but 'A causes B via X'." Empty mechanism is
  -- rejected by writer validation; CHECK constraint here enforces
  -- at DB level.
  mechanism text not null,

  -- Optional pointer to which entities / edges in the KG provide
  -- evidence for this cascade. Free-text summary — not structured —
  -- so the user can audit "why this cascade" without locking the
  -- LLM into a rigid evidence schema.
  evidence_summary text,

  -- 0..1 — how grounded the cascade is in actual KG edge structure
  -- vs. domain-knowledge speculation. The prompt enforces:
  -- "When you propose a cascade with no edge evidence, your
  -- confidence MUST be ≤ 0.5." Defence-in-depth: the writer also
  -- checks bounds, but we range-check at DB level.
  confidence numeric not null,

  -- ── Provenance ──
  -- "llm_inferred" — written by predictAndPersistLayerCascades()
  -- "user_authored" — researcher hand-typed via UI (TODO: not yet
  --                  wired; reserved for future user-editing surface)
  -- "hybrid"        — started LLM-inferred, then user-edited
  source text not null default 'llm_inferred',

  -- Which synthesize hop wrote this row. Today always
  -- "synthesize-cascade-prediction"; reserved for finer-grained
  -- attribution if cascades start being written from other steps
  -- (e.g. "wire-twin-proposal-cascade-refresh").
  source_synthesis_step text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────
-- Constraints
-- ──────────────────────────────────────────────────────────────────

-- Closed enum for kind. Mirror exactly the VALID_KINDS array in
-- cross-layer-cascade-prediction.ts — keep these in sync.
alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_kind_check;
alter table public.layer_dependencies
  add constraint layer_dependencies_kind_check
  check (kind in (
    'causal',
    'modulatory',
    'inhibitory',
    'compensatory',
    'reinforcing'
  ));

-- Closed enum for source.
alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_source_check;
alter table public.layer_dependencies
  add constraint layer_dependencies_source_check
  check (source in (
    'llm_inferred',
    'user_authored',
    'hybrid'
  ));

-- Bounded numeric ranges. The writer validates 0..1 before insert,
-- but the DB-level check protects against direct SQL writes or
-- manual user-authored rows.
alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_strength_check;
alter table public.layer_dependencies
  add constraint layer_dependencies_strength_check
  check (strength >= 0 and strength <= 1);

alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_confidence_check;
alter table public.layer_dependencies
  add constraint layer_dependencies_confidence_check
  check (confidence >= 0 and confidence <= 1);

-- No self-loops. The writer drops self-loops with reason
-- "self-loop forbidden" (line 232-235 of the prediction module);
-- DB-level CHECK is defence-in-depth.
alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_no_self_loop;
alter table public.layer_dependencies
  add constraint layer_dependencies_no_self_loop
  check (from_layer_id <> to_layer_id);

-- Mechanism must be a non-empty string. Prompt CRITICAL RULE #1.
alter table public.layer_dependencies
  drop constraint if exists layer_dependencies_mechanism_not_empty;
alter table public.layer_dependencies
  add constraint layer_dependencies_mechanism_not_empty
  check (length(trim(mechanism)) > 0);

-- ──────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────

-- Unique cascade per (space, from, to). The writer's upsert at line
-- 304-310 of cross-layer-cascade-prediction.ts conflicts on these
-- three columns. Supabase-js's onConflict spec matches by column
-- list, so a unique index on these columns is what makes the upsert
-- work; the index name itself is not load-bearing.
create unique index if not exists layer_dependencies_space_from_to_unique
  on public.layer_dependencies (space_id, from_layer_id, to_layer_id);

-- Filter index for the writer's pre-insert delete:
--   .delete().eq(space_id).eq(user_id).eq(source, 'llm_inferred')
-- Partial index keyed to llm_inferred (the only source the writer
-- ever deletes) so the index stays small.
create index if not exists layer_dependencies_space_user_source_llm_idx
  on public.layer_dependencies (space_id, user_id)
  where source = 'llm_inferred';

-- Sort index for the reader's order-by:
--   loadLayerCascades(): .select('*').eq(space_id).eq(user_id)
--                        .order('strength', { ascending: false })
create index if not exists layer_dependencies_space_strength_idx
  on public.layer_dependencies (space_id, strength desc);

-- FK-join indexes. PostgreSQL doesn't auto-index referencing columns
-- of FK constraints; cascading deletes on layer_ontology row delete
-- will table-scan layer_dependencies without these.
create index if not exists layer_dependencies_from_layer_idx
  on public.layer_dependencies (from_layer_id);
create index if not exists layer_dependencies_to_layer_idx
  on public.layer_dependencies (to_layer_id);

-- ──────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ──────────────────────────────────────────────────────────────────

create or replace function public.layer_dependencies_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists layer_dependencies_set_updated_at on public.layer_dependencies;
create trigger layer_dependencies_set_updated_at
  before update on public.layer_dependencies
  for each row execute function public.layer_dependencies_set_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- RLS — same pattern as layer_ontology
-- ──────────────────────────────────────────────────────────────────

alter table public.layer_dependencies enable row level security;

drop policy if exists "layer_dependencies select own space" on public.layer_dependencies;
create policy "layer_dependencies select own space"
  on public.layer_dependencies for select
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_dependencies.space_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "layer_dependencies insert own space" on public.layer_dependencies;
create policy "layer_dependencies insert own space"
  on public.layer_dependencies for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.spaces s
      where s.id = layer_dependencies.space_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "layer_dependencies update own space" on public.layer_dependencies;
create policy "layer_dependencies update own space"
  on public.layer_dependencies for update
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_dependencies.space_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = layer_dependencies.space_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "layer_dependencies delete own space" on public.layer_dependencies;
create policy "layer_dependencies delete own space"
  on public.layer_dependencies for delete
  using (
    exists (
      select 1 from public.spaces s
      where s.id = layer_dependencies.space_id
        and s.user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- Comments
-- ──────────────────────────────────────────────────────────────────

comment on table public.layer_dependencies is
  'Directed cross-layer propagation cascades. One row = one claim that "changes at from_layer_id propagate to to_layer_id via <mechanism>" with strength + lag + confidence + evidence_summary. Written by the synthesize cascade-prediction hop (src/lib/pipeline/cross-layer-cascade-prediction.ts); read by strategy-variants/generate to populate recommendation.layer_focus.cascade and by canvas LayerStackShape to render inter-layer arrows.';

comment on column public.layer_dependencies.kind is
  'Closed enum: causal | modulatory | inhibitory | compensatory | reinforcing. Mirror exactly VALID_KINDS in cross-layer-cascade-prediction.ts.';

comment on column public.layer_dependencies.strength is
  '0..1 strength of the cascade claim (how big is the effect when the propagation fires). Distinct from confidence, which captures evidence-grounding.';

comment on column public.layer_dependencies.confidence is
  '0..1 evidence-grounding score. Per the prompt, cascades with no KG-edge evidence MUST have confidence ≤ 0.5.';

comment on column public.layer_dependencies.mechanism is
  'The load-bearing claim describing HOW the cascade fires (e.g. "elevated cortisol downregulates hippocampal BDNF expression"). Empty mechanism is rejected at both writer + DB level.';

comment on column public.layer_dependencies.source is
  'Provenance: llm_inferred (written by predict-and-persist hop) | user_authored (hand-typed; UI TBD) | hybrid (started LLM-inferred, then user-edited). The writer only deletes its own llm_inferred rows before upserting fresh ones — user_authored + hybrid survive regeneration.';

comment on column public.layer_dependencies.source_synthesis_step is
  'Which synthesize hop wrote this row. Today always "synthesize-cascade-prediction"; reserved for finer-grained attribution if cascades start being written from other steps.';
