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

## C.1 — VERIFIED ROOT CAUSE: the OC substrate-starvation pattern (2026-05-30)

The single finding that explains "nothing connects / the map is fuzzy / are there orphans": **objective-canvas room generation is a parallel pipeline that feeds NONE of the advanced substrates the legacy pipeline populates.** Measured against the live DB (OC = entities with `parent_sub_objective_id`):

| Substrate | Legacy coverage | **OC coverage** | Why starved | Fix class |
|---|---|---|---|---|
| `canonical_concept_id` | 77.6% | **0% → wired** | room-gen never called the matcher | **CHEAP (deterministic) — ✅ SHIPPED `ed1ccc6`** (future rooms link) |
| `evidence_registries` (→ REML edge strength) | 259 attached | **0 attached** | needs effect-size extraction over papers; OC content isn't quantitative research | BIG build + **likely inappropriate** for OC content |
| `bridges` (cross-room influence) | 49 (all cross-*space*) | **0 touching OC** | needs LLM bridge-detection pass | BIG build + shared-write |
| mechanism tokens (`produces/consumes`) | — | **26/510** | only written when autopilot "tech specs" on | conditional; sparse |
| dense cross-room connections | — | **6 (canonical) / 39 (root_cause)** | concepts are space-specific phrasings; exact-match too sparse | needs **semantic clustering (embeddings)** — shared-write |

**Implication for the map:** a denser/clearer map is **not a viewing problem** (the views exist, parallel-session-owned). It needs a substrate **population** pass. Only `canonical` was cheap+deterministic (shipped). The rest are real builds, several writing to **shared** cross-space tables (coordinate, don't solo) — and `evidence`/effect-size extraction is a poor fit for OC's qualitative content. **The one lever that serves the dense-map goal = semantic clustering of canonical concepts (embeddings) — high value, shared-write, must be scoped.**

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
  - **✅ VERIFIED against live DB 2026-05-30** (don't trust the aggregate — it lies): `entities` total 5075, 70% linked *in aggregate* — BUT that's all legacy. Bucketed by `parent_sub_objective_id` (the OC marker): **OC room entities = 510, `canonical_concept_id` linked = 0 (0.0%)**; legacy = 4565 @ 77.6%. So the spine genuinely never reaches the objective canvas — premise confirmed.
  - **Infra present** (no build needed): helper `linkEntityToCanonicalConcept` @ `src/lib/kg/canonical-concept-matcher.ts:279` (3 callers: decompose, variable-proposals/approve, persist-framing-protos — none in room-gen); FK `entities.canonical_concept_id` ✅; `canonical_concepts.aliases[]` ✅ (bridge column ready); 1971 canonical rows.
  - **Missing schema (LOCK):** `entities.concept_slug` and `library_objects.concept_slug` columns do NOT exist yet. (Latest migration on disk: `20260911`; next free = `20260912`.)
  - **Call-sites:** `brainstorm/room/generate/route.ts` ✅ **DONE (ed1ccc6)** — wired `linkEntityToCanonicalConcept` after the entity insert, mirroring decompose; future room entities link at gen time. `sessions/run-feature` = **no-op** (verified: reads an existing entity, mints none); `branch-from-concept` already links. So all live OC entity producers are covered going forward.
  - **Still NULL: the 510 EXISTING OC entities.** Cheap backfill rejected (only 5/510 match an existing concept; 505 would mint sentence-noise into the shared registry, and it yields just 6 cross-room edges anyway). Existing data links on next regenerate, or waits for a semantic-clustering pass.
- **P3 · Connections persistence**: a `connections` rollup (feature↔feature via shared canonical concept + causal bindings + data tokens), rebuilt on gen — retires the fragile recomputes AND is the data-flow map's source. [me]
- **P4 · System data-flow map** — ❌ **RETIRED 2026-05-30 (was a duplicate-in-waiting).** A parallel session owns the connection-viz lane (`SUBSYSTEM_KG_SPEC.md`): the 4 altitudes already exist (Space=triple-lab, Canvas=`CanvasAltitudeMap`, Room=`RoomAltitudeMap`, Mechanism=`MechanismDataflowView`) + a new Subsystem lens (Phase-1 built: `build-subsystem-kg.ts` + `subsystem-kg-panel.tsx`). A separate `SystemDataflowView` would fork that. **MORE IMPORTANTLY, its premise is false:** verified against live DB, OC spaces have **NO dense cross-room connection substrate** — `bridges` 0 touching OC, mechanism tokens 26/510, exact shared-`root_cause` 39 pairs/2 spaces, canonical cheap-link → 6 cross-room edges. A denser map is NOT a viewing problem; it needs a **generation/semantic-clustering pass to POPULATE connections** (embeddings over canonical concepts, or LLM bridge-detection pointed at OC). That substrate work — not a new view — is the real lever. **Lane: parallel session owns the views; I own the identity/connection SUBSTRATE.**
- **P5 · Object-flow feed**: auto-write `library_objects` + `object_links` from generation/election; wire `getSpecObjects` into the compiler. [coordinate]
- **P6 · Close the rigor seam**: point the REML pooler at OC spaces so edges carry real confidence. [me]

---

## F. Coordination rules
1. **One shared tree → strict one-file = one-chat.** Collision files (`compile-agent-build-spec`, `analyses/*`, `layered-generation`, `main-canvas-view`) are serialized, never co-edited.
2. **Commit before consume.** A downstream chat builds against *committed* substrate only (WS-A commits `concept_slug` before I build the spine consumer).
3. **Schema = LOCK.** `entities.concept_slug`, `library_objects.concept_slug`, `canonical_concepts.aliases`, any `connections` table — coordinated decisions, not solo.
4. **This doc is the contract.** Update it when a lane changes hands.
