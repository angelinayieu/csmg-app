-- Add source_quote column to claims table for evidence provenance.
--
-- Purpose: Capture the verbatim user-input quote that justifies each claim,
-- OR an "IMPLICIT: <reason>" / "ASSUMED: <reason>" string when the entity
-- was inferred rather than explicitly stated.
--
-- This closes the evidence-provenance gap where entities were being generated
-- from user text or LLM imagination with no way to trace why they exist.

alter table claims add column if not exists source_quote text;

create index if not exists idx_claims_source_quote_not_null
  on claims (source_entity_id)
  where source_quote is not null;

comment on column claims.source_quote is
  'Verbatim (or near-verbatim) quote from user input that supports this claim, OR "IMPLICIT: <1-line reason>" / "ASSUMED: <1-line reason>" for inferred or assumed entities. NULL when legacy data or LLM did not provide.';
