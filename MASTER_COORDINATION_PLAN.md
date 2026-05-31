# Master Coordination Plan — objective canvas

**Status:** DRAFT · **Date:** 2026-05-30 · **Purpose:** one coordination authority across the parallel chats so nothing orphans. Supersedes the lane notes scattered in the other spec docs.

> Verdict from a 3-front audit (orphans/duplicates · identity spine · workstreams/persistence): the engines are built; the failure mode is **disconnection** — two identity systems built in parallel, fragile compute-at-render layers, and a row-addressable object layer that's wired but starved. One keystone decision (the identity spine) unblocks the rest.

---

## A. The reality right now

- **All chats share ONE working tree** (not worktrees). ~23 uncommitted files + 2 new libs are live edits from a parallel chat. Strict one-file = one-chat is mandatory.
- **4 active workstreams** + my (committed) canvas-AI ops:
  - **WS-A · `concept_slug` trace-back** (dominant uncommitted): annotations → glossary → item provenance → cross-room → tech-spec. Files: `generate-annotations`, `normalize-annotations`, `annotations-prompt`, `generate-glossary`, `compile-agent-build-spec`, `agent-spec/route`, `glossary/route`, new `cross-space-concept-stats.ts`.
  - **WS-B · card/drawer UI**: `annotated-objective-card`, `item-detail-drawer`, `main-canvas-view`, `objective-canvas-view`, new `right-panel-signal.ts`. Pure FE.
  - **WS-C · causal-map analyses**: `analyses/cross-room-state`, `distill-concepts`, `annotation-overlap`, `types`, `RoomAltitudeMap`, `CausalMapEdge`.
  - **WS-D · expansion/detail**: `expand-item-detail`, `generate-expansion-node`, `layered-generation`.

---

## B. THE keystone decision — the identity spine (lock this first)

**The #1 structural problem:** two concept-identity systems are being built *at the same time* and never reconcile:
- **`concept_slug`** — hyphen-joined noun-phrase (`vivid-experience`), JSONB-only, in-space (WS-A).
- **`canonical_concept_id → canonical_concepts.canonical_code`** — dot-joined structured code (`pain.cortisol.feedback-loop`), a real cross-space table + FK, but populated by only **3 legacy producers — none in room/feature generation** (every OC entity has `canonical_concept_id = NULL`).

They are islands, bridged only by read-time `slugifyConcept(entity.name)`. **This is the orphan trap at the core** — left alone, the data-flow map, cross-room links, glossary↔KG, and object-flow all key on different identities.

**Recommended spine (low-risk; reuses existing matcher + FK + `slugifyConcept`):**
```
canonical_concepts.canonical_code        ← cross-space registry (TBox)
   ⇅ entities.canonical_concept_id (FK)   ← (NEW write in room-gen)
entities.id  +  entities.concept_slug     ← (NEW nullable column, = slugifyConcept(name))
   ⇅ source_entity_id (FK) + concept_slug
library_objects.id + library_objects.concept_slug
   ⇅ object_links (from/to FK)            ← the back-half graph
glossary[].concept_slug · annotations[].concept_slug  ← already join here (WS-A)
```
**Reconcile the two slug dialects WITHOUT changing either:** store `slugifyConcept(display_name)` in `canonical_concepts.aliases[]` → gives `concept_slug ↔ canonical_code` a lookup path.

**Smallest writes (all infra already exists — only call-sites missing):**
1. Call `linkEntityToCanonicalConcept` in `room/generate` + `sessions/run-feature` (FK + matcher exist).
2. Add nullable `entities.concept_slug`, written `= slugifyConcept(name)` by the same producers.
3. Write the hyphen-slug into `canonical_concepts.aliases[]` at mint time (the bridge).
4. Add `library_objects.concept_slug` + auto-write `object_links` (`derived_from`) at save.

⚠ **Schema decision — LOCK + coordinate, do not build solo** (per OBJECT_FLOW_ARCHITECTURE). Items 1 + 3 are schema-free (pure wiring); item 2 + 4 add nullable columns. **Need your go before building.**

---

## C. Orphaned / parallel subsystems found (the answer to "what else?")

| Item | Type | Disposition |
|---|---|---|
| **Rigor / REML evidence stack never reaches the objective canvas** (`recompute-edge-strengths` has 0 callers from OC; edges hardcode confidence 0.6) | **OPEN DATA SEAM** (CROSS_AUDIT #1) | **WIRE** — re-point the pooler at OC spaces; biggest hidden infra not yet considered |
| **`getSpecObjects` (object-flow read path)** imported nowhere; the spec compiler ignores `library_objects` | unwired | **WIRE** into `compile-agent-build-spec` |
| **`object_links` ≈ empty** (only the manual `link` action writes it) | starved | **WIRE** auto-write at save/election |
| **`library_objects` starved** — only brainstorm-cluster + manual upsert write it; variations/specs/briefs never auto-promoted | starved | **WIRE** (Object-flow Phase 1) |
| **`data_unit_registry`** written/read server-side only, zero UI | unsurfaced | **WIRE** (= the data-flow map payoff) |
| **`hcd_personas`** generated, used only inside scoring, never rendered | unsurfaced | **DECIDE** (surface vs mark internal) |
| **3 map/data-flow views** (causal-map · data-lineage · mechanism-dataflow), never unified | duplicate | **COORDINATE** → `SystemDataflowView` unifier |
| **`proactive-proposals.ts`, `back-prop-refinement.ts`, `space-calibrate` route** | dead | **RETIRE** (zero-risk; keep `reality-calibration` lib) |
| **Two canvas engines** (InteraxisCanvas vs objective whiteboard) | parallel | **LEAVE** (product decision) |
| **`compute-macro-chain` / spine** | — | **already retired** ✓ |
| **Fragile compute-at-render**: bridges (`cross-room-signals`), chains (`compute-chains`), macro-rollup, data-flow — none persisted, silently re-derived each load | fragile | **PERSIST** → a `connections`/rollup row (see E) |

---

## D. Lane split (no clobber)

| Lane | Owner | Files (do not cross) |
|---|---|---|
| `concept_slug` substrate | **WS-A chat** | annotations/glossary/spec set above |
| Identity spine wiring (B) | **me, AFTER WS-A commits** | room-gen producers, canonical matcher, a migration |
| Data-flow map + `SystemDataflowView` | **me** | NEW `build-system-dataflow.ts`, new view; ELK |
| Connections persistence (E) | **me** | NEW builder + migration |
| Object-flow feed (`getSpecObjects`, auto-objects) | **coordinate** | `compile-agent-build-spec` is a 3-way collision — **serialize** |
| analyses/* + causal-map | **WS-C** | re-check mtime+diff (contested history) |
| card/drawer UI | **WS-B** | FE only |

**Serialize `compile-agent-build-spec.ts`** — WS-A (adding `concept_slug`), the data-flow feed, and the object-flow read all target it. One chat at a time, commit between.

---

## E. Sequenced plan (dependencies explicit)

- **P0 · LOCK** the identity spine (B) + schema decision. *Blocks everything keyed on identity.* [decision + ~½ day wiring]
- **P1 · Cleanup** (parallel-safe, now): retire the dead trio. [zero-risk]
- **P2 · Identity wiring** (after WS-A commits): populate `canonical_concept_id` + `entities.concept_slug` in room-gen; alias bridge. [me]
- **P3 · Connections persistence**: a `connections` rollup (feature↔feature via shared canonical concept + causal bindings + data tokens), rebuilt on gen — retires the fragile recomputes AND is the data-flow map's source. [me]
- **P4 · System data-flow map**: `build-system-dataflow.ts` + `SystemDataflowView` (ELK), keyed on the spine; surfaces `data_unit_registry`; unifies the 3 views. [me]
- **P5 · Object-flow feed**: auto-write `library_objects` + `object_links` from generation/election; wire `getSpecObjects` into the compiler. [coordinate]
- **P6 · Close the rigor seam**: point the REML pooler at OC spaces so edges carry real confidence. [me]

---

## F. Coordination rules
1. **One shared tree → strict one-file = one-chat.** Collision files (`compile-agent-build-spec`, `analyses/*`, `layered-generation`, `main-canvas-view`) are serialized, never co-edited.
2. **Commit before consume.** A downstream chat builds against *committed* substrate only (WS-A commits `concept_slug` before I build the spine consumer).
3. **Schema = LOCK.** `entities.concept_slug`, `library_objects.concept_slug`, `canonical_concepts.aliases`, any `connections` table — coordinated decisions, not solo.
4. **This doc is the contract.** Update it when a lane changes hands.
