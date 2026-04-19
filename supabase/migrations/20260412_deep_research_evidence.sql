-- Deep Research + Evidence Infrastructure
-- Claims, evidence items, and claim-evidence links for grounded strategy

-- ── Claims table ──
-- First-class claim objects extracted from research reports
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  claim_text text not null,
  claim_type text not null default 'assertion'
    check (claim_type in ('mechanism', 'assertion', 'prediction', 'assumption', 'finding')),
  status text not null default 'proposed'
    check (status in ('proposed', 'supported', 'contested', 'refuted')),
  confidence numeric default 0.5 check (confidence >= 0 and confidence <= 1),
  -- Optional links to source entity/edge that generated this claim
  source_entity_id uuid references entities(id) on delete set null,
  source_edge_id uuid references edges(id) on delete set null,
  -- Research run metadata
  source_type text default 'deep_research'
    check (source_type in ('deep_research', 'fast_research', 'synthesis', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Evidence items table ──
-- Source-grounded evidence with URL, quotes, and quality metadata
create table if not exists evidence_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  url text,
  title text,
  source_type text default 'unknown'
    check (source_type in ('academic', 'news', 'government', 'blog', 'earnings', 'social', 'organization', 'unknown')),
  published_at timestamptz,
  -- Quote-level grounding
  quote text,
  span_start int,
  span_end int,
  -- Quality scoring
  reliability_prior numeric default 0.5 check (reliability_prior >= 0 and reliability_prior <= 1),
  recency_score numeric default 0.5 check (recency_score >= 0 and recency_score <= 1),
  -- Metadata
  extraction_hash text, -- For deduplication
  created_at timestamptz not null default now()
);

-- ── Claim-evidence junction ──
-- M-to-M: which evidence supports/contradicts which claims
create table if not exists claim_evidence_links (
  claim_id uuid not null references claims(id) on delete cascade,
  evidence_id uuid not null references evidence_items(id) on delete cascade,
  support_type text not null default 'supports'
    check (support_type in ('supports', 'contradicts', 'contextualizes')),
  primary key (claim_id, evidence_id)
);

-- ── Extend existing contradictions table with claim links ──
-- Add claim foreign keys so contradictions can link to structured claims
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'contradictions' and column_name = 'claim_a_id'
  ) then
    alter table contradictions add column claim_a_id uuid references claims(id) on delete set null;
    alter table contradictions add column claim_b_id uuid references claims(id) on delete set null;
  end if;
end $$;

-- ── Extend entities with theory metadata ──
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'entities' and column_name = 'theory_type'
  ) then
    alter table entities add column theory_type text
      check (theory_type is null or theory_type in ('mechanism', 'assumption', 'mediator', 'constraint', 'observable_test'));
    alter table entities add column falsifiability_score numeric
      check (falsifiability_score is null or (falsifiability_score >= 0 and falsifiability_score <= 1));
    alter table entities add column evidence_strength numeric
      check (evidence_strength is null or (evidence_strength >= 0 and evidence_strength <= 1));
  end if;
end $$;

-- ── Indexes ──
create index if not exists idx_claims_space on claims(space_id);
create index if not exists idx_claims_status on claims(space_id, status);
create index if not exists idx_evidence_space on evidence_items(space_id);
create index if not exists idx_evidence_url on evidence_items(url);
create index if not exists idx_claim_evidence_claim on claim_evidence_links(claim_id);
create index if not exists idx_claim_evidence_evidence on claim_evidence_links(evidence_id);

-- ── RLS policies ──
alter table claims enable row level security;
alter table evidence_items enable row level security;
alter table claim_evidence_links enable row level security;

-- Claims: accessible through space ownership
create policy "claims_select" on claims for select using (
  space_id in (select id from spaces where user_id = auth.uid())
);
create policy "claims_insert" on claims for insert with check (
  space_id in (select id from spaces where user_id = auth.uid())
);
create policy "claims_update" on claims for update using (
  space_id in (select id from spaces where user_id = auth.uid())
);
create policy "claims_delete" on claims for delete using (
  space_id in (select id from spaces where user_id = auth.uid())
);

-- Evidence items: accessible through space ownership
create policy "evidence_select" on evidence_items for select using (
  space_id in (select id from spaces where user_id = auth.uid())
);
create policy "evidence_insert" on evidence_items for insert with check (
  space_id in (select id from spaces where user_id = auth.uid())
);
create policy "evidence_delete" on evidence_items for delete using (
  space_id in (select id from spaces where user_id = auth.uid())
);

-- Claim-evidence links: accessible through claim ownership
create policy "claim_evidence_select" on claim_evidence_links for select using (
  claim_id in (select id from claims where space_id in (select id from spaces where user_id = auth.uid()))
);
create policy "claim_evidence_insert" on claim_evidence_links for insert with check (
  claim_id in (select id from claims where space_id in (select id from spaces where user_id = auth.uid()))
);
create policy "claim_evidence_delete" on claim_evidence_links for delete using (
  claim_id in (select id from claims where space_id in (select id from spaces where user_id = auth.uid()))
);
