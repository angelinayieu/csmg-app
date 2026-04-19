-- Pattern Library
-- Accumulator of recurring convergent-point structures. Each row represents
-- a canonical pattern (e.g. "constrained + enabler → irreversible loss") that
-- has been observed across enough convergent_points to warrant promotion to
-- a reusable template. The library grows from usage — nothing is hand-crafted.
--
-- Key identifier: structural_signature (deterministic from convergent_point fields).
-- Display identifier: canonical_tag (LLM-proposed name, most common among occurrences).

create table if not exists public.pattern_library (
  id uuid primary key default gen_random_uuid(),

  -- Canonical signature string: {focal_role}|{sorted_interactor_roles}|{polarity}|{reversibility}|{time_horizon}
  -- Example: "constrained|enabler,resource|negative|irreversible|months"
  -- Deterministic — two convergent_points with the same signature are instances
  -- of the same pattern.
  signature text unique not null,

  -- Parsed form of the signature for direct access without string splitting.
  signature_detail jsonb not null,

  -- Canonical tag — most common pattern_tag seen among occurrences.
  -- LLM-proposed; may be the modal vote or "unnamed" if no tags were provided.
  canonical_tag text not null default 'unnamed',

  -- All tags seen for this signature + their counts: [{"tag": "...", "count": N}]
  tag_distribution jsonb not null default '[]',

  -- Best example description — the occurrence with the highest composite_score.
  canonical_description text,

  -- Up to 5 example descriptions from top-scoring occurrences. For retrieval
  -- into future prompts as few-shot examples.
  example_descriptions text[] not null default '{}',

  -- Canonical mechanism — the mechanism text from the top-scoring occurrence.
  canonical_mechanism text,

  -- Typical outcome properties (modal values across occurrences)
  typical_polarity text,
  typical_reversibility text,
  typical_time_horizon text,
  typical_propagation text,

  -- Rolling statistics across all occurrences
  occurrence_count int not null default 0,
  avg_probability real,
  avg_confidence real,
  avg_composite_score real,

  -- Spaces that have produced this pattern (for cross-space pattern transfer)
  seen_in_space_ids uuid[] not null default '{}',
  -- Distinct focal entity UUIDs that have instantiated this pattern
  seen_on_focal_entity_ids uuid[] not null default '{}',

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pattern_library_signature_idx on public.pattern_library (signature);
create index if not exists pattern_library_occurrence_idx on public.pattern_library (occurrence_count desc);
create index if not exists pattern_library_tag_idx on public.pattern_library (canonical_tag);
-- GIN for "find patterns that match focal_role=X with interactor role subset"
create index if not exists pattern_library_signature_detail_idx on public.pattern_library
  using gin (signature_detail);

-- RLS: pattern library is GLOBAL. Patterns learned in one user's spaces benefit
-- everyone. This is the whole point — institutional knowledge accumulates.
-- However we still gate WRITES via service role (aggregator runs server-side).
alter table public.pattern_library enable row level security;

drop policy if exists "authenticated_read_patterns" on public.pattern_library;
create policy "authenticated_read_patterns" on public.pattern_library
  for select using (auth.role() = 'authenticated');

-- Writes only via service role — prevents user-side tampering with shared library.
-- (No insert/update policy = default deny for non-service-role callers.)

-- ── Helper column on convergent_points: was this promoted to the library? ──
alter table public.convergent_points
  add column if not exists aggregated_at timestamptz;

create index if not exists convergent_points_aggregated_idx on public.convergent_points (aggregated_at)
  where aggregated_at is null;
