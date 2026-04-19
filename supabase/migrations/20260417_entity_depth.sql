-- Phase 10 — Entity depth as a first-class integer.
--
-- Motivation: `entity.layer` was previously a free-text field ("system" /
-- "domain" / "thread" / "claim" / "atom", with occasional drift). Layer is
-- still useful as a semantic label, but downstream consumers need a clean
-- numeric depth for comparisons, ordering, and depth-monotonic checks.
--
-- This migration:
--   1. Adds `entity.depth` (integer 0..4, NOT NULL, default 2).
--   2. Backfills depth from the current `layer` string using the same
--      mapping the read-time helper uses, so nothing regresses.
--   3. Adds a CHECK constraint forcing depth into 0..4.
--   4. Adds an index on (space_id, depth) for depth-filtered queries
--      (rings / nudges / bridges all filter by depth within a space).
--
-- `layer` remains nullable string — we keep backwards compat and use it as
-- the semantic label. `depth` is the enforced numeric axis.

alter table public.entities
  add column if not exists depth integer;

-- Backfill from existing layer string. Same mapping as entityToLayerId.
update public.entities
set depth = case lower(trim(coalesce(layer, '')))
  when 'system' then 0
  when 'domain' then 1
  when 'thread' then 2
  when 'claim' then 3
  when 'property' then 3       -- legacy alias
  when 'atom' then 4
  when 'atomic' then 4
  else
    case lower(trim(coalesce(knowledge_layer::text, '')))
      when 'conceptual' then 1
      when 'external' then 3
      when 'bridge' then 2
      else 2
    end
end
where depth is null;

-- Now we can enforce NOT NULL + a valid range.
alter table public.entities
  alter column depth set not null;

alter table public.entities
  alter column depth set default 2;

alter table public.entities
  add constraint entities_depth_range_chk
    check (depth >= 0 and depth <= 4);

create index if not exists entities_space_depth_idx
  on public.entities (space_id, depth);
