-- ── Entities: proxy_for + proxy_quality ─────────────────────────────────
--
-- First-class proxy relationships. Today, "BDNF serum proxies for central
-- BDNF" is a free-text comment in template seeds; nothing queryable, no
-- per-proxy quality score, no surrogate-model coefficient store. After
-- this migration:
--
--   - entities.proxy_for points to the gold-standard / latent entity this
--     row stands in for. Null when this entity isn't a proxy.
--   - entities.proxy_quality is a 0-1 score: how well this proxy predicts
--     the gold standard. Sourced initially from literature / template
--     metadata; later from fitted surrogate models (planned).
--
-- Read by:
--   - aggregate-environment-definition.ts → StateVariable.proxy_for /
--     proxy_quality (drives the "via proxy" chip + observability)
--   - inferObservability(): proxy_for set → "inferable_via_proxy" bucket
--     (when measurement_observability column doesn't already classify)
--   - simulator (future): when user logs the proxy, infer the gold
--     standard with measurement-error noise scaled by (1 - proxy_quality)
--
-- Self-referential FK is permitted (an entity can proxy for another
-- entity in the same space). on delete set null so deleting the
-- gold-standard entity doesn't cascade-delete the proxy row.

alter table public.entities
  add column if not exists proxy_for uuid;

alter table public.entities
  add column if not exists proxy_quality numeric;

alter table public.entities
  drop constraint if exists entities_proxy_for_fk;

alter table public.entities
  add constraint entities_proxy_for_fk
  foreign key (proxy_for)
  references public.entities (id)
  on delete set null;

alter table public.entities
  drop constraint if exists entities_proxy_quality_check;

alter table public.entities
  add constraint entities_proxy_quality_check
  check (
    proxy_quality is null
    or (proxy_quality >= 0 and proxy_quality <= 1)
  );

-- Lookup: "find every proxy for a given gold-standard entity."
-- Used by the entity-detail page ("3 proxies measure this latent value")
-- and by the inverse-inference simulator path.
create index if not exists entities_proxy_for_idx
  on public.entities (space_id, proxy_for)
  where proxy_for is not null;

comment on column public.entities.proxy_for is
  'When this entity is a measurable proxy for a harder-to-measure gold-standard entity, points to that entity. Null when this entity is not a proxy. Self-referential FK within entities.';

comment on column public.entities.proxy_quality is
  'How well this proxy predicts the gold-standard, 0-1. Sourced from literature initially; replaced by fitted surrogate-model R^2 once enough (proxy, gold-standard) observation pairs accumulate.';
