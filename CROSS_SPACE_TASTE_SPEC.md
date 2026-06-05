# Cross-Space Taste (P3) — decision spec

**Status:** decision-needed. Author: 2026-06-05. Prereq shipped: P0+P1 (see `project_taste_glossary_loop`).

## The question
Today "taste" (a user's defined term meanings + resolutions) is **space-scoped**: the
glossary lives in `spaces.synthesis_data.glossary`, and `buildSpaceContext` only ever
reads the current space. So a user who sharpens "Flow" in App A must re-define it in
App B. The ask: make a term you shaped in one app arrive **pre-deepened** in another,
without redundant re-entry.

## The seam (why this is a real decision, not just a build)
A sophisticated cross-space layer ALREADY exists — `canonical_concepts` (user-wide
concept registry, `concept_slug ↔ canonical_code`), `memory_items` pgvector similarity,
`concept-memory-feed` (recency×spread), `decision-log.getUserIntentPreferences`
(cross-space revealed taste). **But it is wired only into the OLD `brainstorm/
sub-objectives/propose` + `decompose/route` rails** — written only by old producers,
read only by old consumers. The NEW object layer (`library_objects`, `decompose-cards`,
glossary) neither writes nor reads it. And per the deprecation lock
(`project_old_build_deprecation`), those rails are being retired.

So the naive "wire the cross-space machinery into the new layer" reopens the
deprecation decision AND inherits a dependency on `entities` + entity embeddings the
new layer doesn't produce. That's the trap.

## The unlock
`concept_slug` is **already** the universal identity key — glossary terms, annotations,
and `context_concept` rows all carry it. And each space's glossary already stores
user-authored, **pinned** (immutable) definitions. That means cross-application taste
reuse needs only **one new read**: "for this term's slug, what has the user pinned for
the same slug in their other spaces?" No embeddings, no `canonical_concepts`, no
`entities`, no old-rail revival.

## Options

| | A — Port forward | B — Stay space-scoped | **C — Thin slug-bridge (recommended)** |
|---|---|---|---|
| Mechanism | Revive canonical_concepts + embeddings onto library_objects | Do nothing | Read other spaces' glossaries by concept_slug |
| Identity | Fuzzy (embedding cluster) | n/a | Exact slug (v1); embeddings deferred |
| Deprecation conflict | **High** (re-activates old rails) | None | None |
| New write cost | Per-object canonical write + embed | None | None (read-only) |
| Delivers reuse | Yes | No | Yes |
| Precision | Highest | n/a | Exact-match only (good enough for v1) |

**Recommend C.** It delivers the "define once, reuse across apps" promise purely
additively over the NEW layer, respects the deprecation lock, needs no embeddings, and
soft-fails to today's behavior. Keep A's embedding/canonical precision as a *deferred*
upgrade if exact-slug proves too narrow.

## The reasoning model (what "cross-application taste" actually computes)
1. **Identity** — `concept_slug` (exact) is v1; `canonical_concept_id` (clustered) is the
   v2 precision upgrade, only if needed.
2. **Read** — for each term slug in the current space, fetch the user's **pinned /
   user-authored** definitions of the SAME slug in their OTHER spaces. Pinned = highest-
   authority taste.
3. **Seed, don't overwrite** — a cross-space pinned definition SEEDS a missing/ungrounded
   term in the new space (provenance `user`, tagged `cross_space_origin`). Authority order:
   **same-space pinned > cross-space pinned > same-space annotation > entity > llm.** A
   same-space pinned term is never overridden by a cross-space one.
4. **Surface** — "Inherited from your *App X*" provenance tag; the user can accept or
   override. Override writes a same-space pinned term (which then wins forever).
5. **Taste vector (later)** — fold a cross-space *preference* signal (which converge/
   diverge choices the user keeps) to bias framing, analogous to the old
   `getUserIntentPreferences`. Separate, deferred.

## Concrete wiring (Option C)
- **New** `loadCrossSpaceGlossary(db, userId, currentSpaceId, slugs)` →
  `Map<slug, { definition, sourceSpaceTitle, pinned }>`. Queries
  `spaces.synthesis_data.glossary` across the user's other (non-archived) spaces, keeps
  only `pinned`/`source==='user'` terms whose slug is in `slugs`. Soft-fail → empty map.
- **Glossary build** (`generateGlossary` / the POST route): after merge, seed any term
  that is missing or still `ai`/`entity` with a cross-space pinned definition, stamped
  `source:'user'` + `cross_space_origin: <spaceId>` (a new optional field on `GlossaryTerm`).
- **buildSpaceContext**: annotate such terms "[also defined by you in *App X*]" so
  reasoning treats them as owned.
- **UI** — extend the existing inline provenance cue + the taste receipt with an
  "inherited" treatment; **migrate** the `crossSpaceCount` pill (currently
  `loadCrossSpaceConceptStats`, which reads legacy `entities`) to count cross-space
  glossary hits instead, so the "used in N of your spaces" number reflects the new layer.

## Risks / blind spots
- **Slug collisions across domains** (same slug, different meaning) → mitigate with the
  accept/override step + an optional domain tag on the seed; never silently apply.
- **Privacy/scope** — strictly per-USER (their own spaces). Never across users.
- **Stale inheritance** — a definition the user later changed in App A shouldn't silently
  re-seed; carry `updated_at` and prefer the most recent pinned.
- **Embeddings gap** — `library_objects` have none today; exact-slug sidesteps that for
  v1. Adding embeddings is the A-style precision upgrade, isolated behind the identity
  step (1).

## Phasing
- **P3.0** — `loadCrossSpaceGlossary` + seed-on-build + provenance tag. (read-only, additive)
- **P3.1** — migrate the `crossSpaceCount` pill off legacy `entities` onto glossary hits.
- **P3.2 (deferred)** — embedding/canonical precision for fuzzy concept identity.
- **P3.3 (deferred)** — cross-space preference signal (kept converge/diverge choices).
