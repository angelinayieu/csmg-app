# Phase 2 — Glossary-backed annotations (exact trace-back)

Status: **PLAN ONLY, no code.** Phase 1 (re-render the sub-objective's description
annotations as frameless stage-colored underlines) shipped 2026-05-29. This doc
designs the follow-up the user committed to: making the **space glossary the single
source of truth** for what an underlined phrase means, linked by a **stable concept
ID** instead of by text.

---

## 1. Goal / definition of done

- Hovering an underlined phrase in a room's **Definition** (or anywhere we annotate)
  shows the **same canonical definition** as the main-canvas objective and the item
  drawer — not a per-room reading that can drift.
- The link is **ID-based**, not text-based, so rewording a phrase on regen doesn't
  silently break the trace-back.
- Underline color stays lane-accurate (problem/mechanism/result/objective), ideally
  derived from the concept's linked entity when one exists.

## 2. Current state (grounded)

- **Annotations** — `improvement_goals.annotations` (JSONB). Generated per-goal on its
  own text: parent objective (`/api/brainstorm/annotations/generate`) + each
  sub-objective (`/api/brainstorm/sub-objectives/[id]/annotate`). Schema in
  `annotations-prompt.ts` (`RESPONSE_SCHEMA`); normalized in `normalize-annotations.ts`.
  Fields today: `phrase, start/end_offset, reading, crystal, layer_tag, weight,
  scope, dimensions[], inference_chain[], analogies[], confidence, not_reading`.
  **No stable concept key.**
- **Glossary** — `spaces.synthesis_data.glossary` (JSONB). `generate-glossary.ts`,
  route `/api/brainstorm/space/[spaceId]/glossary`. `GlossaryTerm`:
  `term, definition, aliases[], source ("annotation"|"entity"|"llm"|"user"),
  annotation_phrase?, layer_tag?, weight?, pinned?, updated_at`. Already a
  provenance registry with precedence (`user>annotation>entity>llm`) and an
  entity-definition consistency link (`entityDefinitions`). **Join key = text**
  (`term` / `annotation_phrase`).
- **Render** — `annotated-heading.tsx` (generalized in Phase 1 with `as`) draws the
  underlines + popover; the popover currently shows the annotation's own `reading`.
  `glossary-text.tsx` separately renders first-occurrence glossary underlines.
- **The gap** — annotation → glossary is by text (`seedsFromAnnotations` lifts
  `{phrase, reading}`). Best-effort, not referential.

## 3. Core change — a shared `concept_slug`

Add one stable key, `concept_slug`, carried on **both** sides:
- on each annotation (minted at generation),
- on each `GlossaryTerm` (used as the merge/dedupe key, replacing text matching).

The popover then resolves `annotation.concept_slug → glossaryBySlug.get(slug) →
definition`, with the annotation's `reading` as fallback when no glossary entry
exists yet.

Note: `crystal` (the annotation's one-noun essence) already exists but is a UI noun,
not a stable key — `concept_slug` should be explicit and slugified.

## 4. Where the slug is minted — options

The user deferred this; recommendation below.

- **(A) Mint on annotations + canonicalize at glossary (RECOMMENDED).** Annotation
  generation emits a `concept` (canonical ≤4-word noun phrase) → `concept_slug =
  slugify(concept)`. Glossary seeding dedupes by `concept_slug` and stores it. The
  glossary becomes the canonical registry (it already has precedence + entity links),
  even though slugs originate at annotation time. JSONB-only, matches the codebase
  pattern, smallest migration. Cross-goal canonicalization (same idea, different
  concept strings) is resolved at the glossary merge.
- **(B) Dedicated `concepts` table.** True FKs from annotations/glossary/entities.
  Most correct, heaviest: new migration + three writers + full backfill. Overkill
  unless concepts become first-class elsewhere.
- **(C) Glossary as the registry, others reference it.** Clean conceptually but has a
  chicken-and-egg: the glossary is *seeded from* annotations today, so annotations
  can't reference glossary slugs that don't exist yet.

**Recommendation: (A).** It delivers the user's promise (ID-based, cross-surface
identical) with the least schema churn and reuses the glossary's existing registry
role. (B) is the upgrade path if concepts later need to be queried/related directly.

## 5. Data-model changes (option A)

- `annotations-prompt.ts` — add `concept` to the schema + instructions (canonical
  noun phrase for the underlying idea, distinct from the verbatim `phrase`).
- `normalize-annotations.ts` — derive `concept_slug = slugify(concept ?? phrase)`;
  tolerate missing (back-compatible).
- `generate-glossary.ts` — `AnnotationSeed` gains `concept_slug`; merge/dedupe keys
  on `concept_slug` (fallback to normalized term text); `GlossaryTerm` gains
  `concept_slug`.
- No SQL migration required — both are JSONB. (Reason this stays JSONB: matches the
  existing annotations/glossary storage; a table is option B only.)

## 6. Render path

- `page.tsx` (room) already can load the space glossary server-side; pass a
  `Map<concept_slug, GlossaryTerm>` into `SubObjectiveRoomView` → `HeroProse` →
  `AnnotatedHeading`.
- `AnnotatedHeading` popover: if `concept_slug` resolves in the glossary map, show the
  glossary `definition` (+ a quiet "defined in glossary" affordance); else show the
  annotation `reading` (current behavior).
- Color: keep `layer_tag`; optional upgrade — if the glossary term's source is
  `entity`, use that entity's lane color for exactness.

## 7. Backfill

- Existing annotations/glossary lack `concept_slug`. Bridge: a one-time pass that sets
  `concept_slug = slugify(phrase)` on existing annotations and
  `slugify(term)` on glossary terms (best-effort text match — imperfect but
  monotonic). True canonical slugs arrive on next regen of each goal's annotations.
- No destructive migration; additive only.

## 8. Risks & mitigations

- **Cross-goal concept drift** (same idea, different `concept` strings across parent
  vs sub) → resolved at glossary merge (canonical registry); accept best-effort until
  then.
- **Glossary merge-key change** (text → slug) could merge/split existing entries →
  stage behind the backfill; keep text fallback during transition.
- **Generation prompt change** → keep schema optional/back-compatible; normalize
  tolerates missing `concept`.
- **Parallel sessions co-edit** `annotated-heading.tsx`, `sub-objective-room-view.tsx`,
  `generate-glossary.ts` → check mtime+diff before each edit; prefer small PRs.
- **Density** — more underlines on the Definition; Phase 1 frameless style mitigates.

## 9. Staged sequence (each ships independently)

1. Schema + normalize: add `concept` / `concept_slug` (back-compatible, no behavior
   change yet).
2. Glossary: dedupe/store by `concept_slug`; expose `conceptSlug → term` lookup.
3. Render: thread the glossary map into the room; popover prefers glossary definition.
4. Backfill existing spaces (slugify bridge) + verify a couple live rooms.
5. (Optional) entity-linked lane coloring; extend to drawer + main-canvas popovers
   so all three surfaces read identical definitions.

## 10. Open decisions for the user

- Confirm option **A** (vs B table / C glossary-registry).
- Should the popover **replace** the annotation `reading` with the glossary
  definition, or **show both** (reading = interpretation, glossary = definition)?
- Do we extend the same glossary-backed popover to the **main-canvas objective** and
  the **item drawer** now, or room-only first?
