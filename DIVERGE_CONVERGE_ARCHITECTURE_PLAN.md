# Diverge-Converge Architecture & Sequenced Implementation Plan

> **Status as of 2026-05-11**
> **Phase 1 (Problem-framing diverge-converge): SHIPPED — but undemonstrable until stabilization lands**
> **Next action: Sprint A1 (runId fallback) — smallest highest-leverage fix in the codebase**

This document is the unified architectural plan synthesizing every thread of the recent conversation:
the 3-tier knowledge graph model, Phase 1 problem-framing work that already shipped, the strategy-card
stabilization audit, app-sophistication analysis, user-refinement infrastructure gaps, Phase 2 lab
plan, and the canonical concept registry. It supersedes all prior partial plans
(`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`, `KG_DEPTH_CRITIQUE.md`, `RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md`)
where they conflict.

---

## Table of contents

1. [The architectural problem](#1-the-architectural-problem)
2. [The 3-tier mental model](#2-the-3-tier-mental-model)
3. [What's already shipped (Phase 1)](#3-whats-already-shipped-phase-1)
4. [What's broken (stabilization audit findings)](#4-whats-broken-stabilization-audit-findings)
5. [The sequenced implementation plan](#5-the-sequenced-implementation-plan)
6. [Definitions & naming conventions](#6-definitions--naming-conventions)
7. [Open architectural decisions](#7-open-architectural-decisions)
8. [Anti-patterns to avoid](#8-anti-patterns-to-avoid)
9. [Validation gates](#9-validation-gates)
10. [Reference file map](#10-reference-file-map)

---

## 1. The architectural problem

The codebase has built sophisticated upstream cognition (5-lens framing panel, 4-pass strategy engine,
mediator-proposal engine, monte-carlo simulation, manifest-driven app rendering) — but
**the consumer of each layer is missing or broken**:

| Layer | Sophistication of producer | Consumer state |
|---|---|---|
| 5-lens framing panel | ~$0.025 per intake, 17K chars structured output | 0 entities persisted; output thrown away |
| 4-pass strategy engine | ~$0.05 per run, 4 LLM passes, options + rejected_options + verifier | 5 silent-fail paths between emit and render |
| Mediator-proposal patch | LLM proposes canonical mediators with validator | Runs preview-only at preflight; never persists in freeform path |
| App generation | 40-column schema + typed manifest + sub-space + MC distribution | No variable contract (no IV/DV/control); rich widgets exist but no "pick-the-variant" UI on main canvas |
| Per-edge probability spaces | Real micro-topologies (`ProbabilitySpace`) | Generated but consumer rendering is partial |

The pattern: **produce structured cognition, fail to capture it, build a patch instead, then notice the patch is a band-aid.**

Every architectural concern raised in the conversation is the same pattern applied at different layers:
the mediator-proposal critique, the compute-waste observation about framing, the apps-as-templates audit,
and the strategy-card stabilization audit are all manifestations of this one principle:

> **Build the consumer at each layer before adding more producers upstream.**

---

## 2. The 3-tier mental model

Adopt this taxonomy as code-level vocabulary discipline starting now. Every new file declares which
tier it operates on in its header comment; every commit message names the tier.

```
┌─────────────────────────────────────────────────────────────────┐
│ TIER 1: CANONICAL / SCHEMA / TBOX                               │
│                                                                  │
│   Domain-agnostic concepts and their canonical relations.       │
│   What "BDNF" or "ROS" or "sleep_quality" means independent     │
│   of any user's specific situation.                              │
│                                                                  │
│   Existing primitives:                                          │
│   • layer_ontology_templates (20260615_layer_ontology.sql:313)  │
│   • CANONICAL_AXES constant (axes-used-resolver.ts:165-174)     │
│   • condition_modulators WHERE space_id IS NULL                 │
│     (20260714_condition_modulators.sql:33-43)                   │
│   • node_signatures.canonical_code (per-space, not yet global) │
│                                                                  │
│   Missing primitive (Week 6+):                                  │
│   • canonical_concepts table (entity TBox)                      │
│                                                                  │
│   Academic name: TBox (Description Logic) /                     │
│   Wikidata-style canonical registry                             │
└─────────────────────────────────────────────────────────────────┘
                           │ FK: canonical_concept_id
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ TIER 2: SITUATION KG / ABOX                                     │
│                                                                  │
│   This user's instance of the structure for this specific      │
│   prompt. Entities/edges/mechanisms scoped to one space.       │
│                                                                  │
│   Existing primitives:                                          │
│   • entities (per space, all space_id-scoped)                  │
│   • edges, mechanisms, cycles, claims, bridges                  │
│   • layer_ontology (per space, inherits from template)         │
│   • probability_space_runs (per axis × space)                   │
│   • spaces.situation_frame, spaces.situation_baseline          │
│                                                                  │
│   Academic name: ABox (Description Logic) /                    │
│   Personalized Knowledge Graph (Balog & Kenter, SIGIR 2019)     │
└─────────────────────────────────────────────────────────────────┘
                           │ used to parameterize ↓
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ TIER 3: SITUATION-SPECIALIZED CAUSAL MODEL                      │
│         (= what the user means by "digital twin")               │
│                                                                  │
│   "Given this user with these conditions, here's how this      │
│   particular causal model behaves under these interventions."  │
│                                                                  │
│   Existing primitives (DISTRIBUTED across 5 tables):            │
│   • twin_proposals (= committed strategy, NOT the twin itself) │
│   • subjects.conditions (persona)                              │
│   • condition_modulators WHERE space_id IS NOT NULL (overlay)  │
│   • twin_snapshots (frozen state at a moment)                  │
│   • scenarios.action_list (intervention sequences)             │
│                                                                  │
│   Missing: unified situation_twin view (Week 6+)               │
│                                                                  │
│   Academic name: Structural Causal Model parameterized per     │
│   situation (Pearl) / CATE (Künzel et al., 2019) /             │
│   Transportability (Bareinboim & Pearl, 2014)                  │
└─────────────────────────────────────────────────────────────────┘

CROSS-CUTTING (not a tier):
   • memory_items — within-user evidence transfer (HNSW)
   • kg_signatures — cross-space structural analogy
   • bridges — explicit cross-space entity coupling
```

### Critical naming clarification

The codebase says **"Twin === Strategy === Workflow"** (`20260510_twin_proposals.sql:8`). That is the
**Tier 3 commitment artifact**, NOT the Tier 3 causal model.

**Two distinct objects:**
- **`twin_proposals` row** = the *chosen strategy* + its mechanisms (a commitment record). This is what
  the codebase calls "twin." Kinds: `problem_twin` (chosen framing), `strategy_twin` (chosen strategy),
  `executable_twin` (chosen apps).
- **Situation-specialized causal model** = the user's full Tier 3 object = a logical join over
  twin_proposals + subjects + condition_modulators + twin_snapshots + scenarios. **No single row
  represents this today.**

When writing code or comments, use:
- `twin_proposal` for the commitment record (existing)
- `situation_twin` or `situation_causal_model` for the unified Tier 3 object (to be built Week 6+)
- Never say "twin" without a qualifier — it's ambiguous

---

## 3. What's already shipped (Phase 1)

Phase 1 implements the diverge-converge primitive for problem framing. The 5-lens panel now produces
N competing whole framings (instead of merging into one), persists them as a `problem_twin` row, and
emits events that drive a chrome notification card.

### Files modified / added

1. **Migration:** `supabase/migrations/20260715_twin_proposals_kind_and_frame.sql`
   - Adds `kind` column with CHECK (`problem_twin | strategy_twin | executable_twin`), DEFAULT `'strategy_twin'`
   - Adds `frame_payload jsonb` (nullable) for problem_twin shape
   - Relaxes `justification NOT NULL`, adds CHECK requiring per-kind payload presence
   - Adds `idx_twin_proposals_pending_by_kind` partial index for O(log n) supersede sweeps

2. **Event types:** `src/types/pipeline-events.ts:1554-1655`
   - `FramingProposedEvent` — proposalId, spaceId, optionCount, chosenRank, chosenApproach, supportingLenses, framingConfidence
   - `FramingApprovedEvent` — proposalId, spaceId, approvalMode (auto | user), chosenApproach
   - Both wired into the `StructuralEvent` union

3. **Lens schema extension:** `src/lib/prompts/framing-lenses.ts`
   - Added `LensWholeFraming` type (defined in `src/types/situation-frame.ts` to avoid circular imports)
   - Extended `LensOutput` with `candidate_whole_framing: LensWholeFraming | null`
   - Extended `OUTPUT_SPEC` block with the new JSON schema entry + 5 critical rules
   - Added `coerceWholeFraming(lensId, raw)` validator that stamps lens_id from the panel orchestrator

4. **SituationFrame extension:** `src/types/situation-frame.ts` + `src/lib/situation-frame/frame-helpers.ts`
   - Added `candidate_framings: LensWholeFraming[]` to `SituationFrame`
   - Updated `emptyFrame()` and `validateFrame()` to handle the new field
   - Added `coerceCandidateFraming` defensive coercer

5. **Consensus pass:** `src/lib/pipeline/framing-panel.ts:170-230`
   - Added `collectCandidateFramings(lensOutputs)` — gathers non-null framings, sorts by confidence DESC
   - Wired into `consensusMerge`

6. **Persistence + emission:** `src/app/api/pipeline/frame-panel/route.ts`
   - Added `persistAndEmitProblemTwin` helper called after `spaces.situation_frame` update
   - Bifurcated payload builder:
     - **Divergent path** (≥1 candidate framing): N options[] entries, one per lens framing
     - **Fallback path** (no lens emitted a framing): single synthetic option from merged frame
   - Inserts `twin_proposals(kind='problem_twin', user_status='approved', ...)` — auto-approves rank-1
   - Emits `framing_proposed` → `framing_approved` events

7. **Painter handlers:** `src/components/canvas/pipeline-event-painter.tsx:2741-2810`
   - `case "framing_proposed"` — dispatches `window.CustomEvent("interaxis:framing-proposed", ...)`
   - `case "framing_approved"` — dispatches `window.CustomEvent("interaxis:framing-approved", ...)`
   - No tldraw shape painted (chrome overlay pattern, mirrors `kg_plan_proposed`)

8. **Chrome listener:** `src/components/canvas/chrome/framing-proposal-gate.tsx`
   - Non-blocking floating card at top-center, z-40
   - Listens for both window events, space-scoped (ignores cross-space events)
   - Shows: chosen approach, supporting lenses, confidence pct, `{N} candidates` badge when optionCount > 1
   - Auto-dismisses in 4s (approved) / 12s (defensive) / 30s (approved + divergence — CTA window)
   - Currently has a "Review framings →" Link to `/app/space/[id]/framing` (the gate page doesn't exist yet)

9. **Mount:** `src/app/app/space/[id]/whiteboard/page.tsx` — `<FramingProposalGate spaceId={space.id} />` mounted above `<KgPlanReviewGate />`

### What's CURRENTLY undemonstrable

Phase 1's effect — "different framing → different downstream strategy" — is fully wired in code but
**invisible until the strategy card stabilization audit lands**. The framing card itself appears
briefly, but the downstream effect on strategy cards is blocked by 5 silent-fail bugs (see §4).

### Critical Phase 1 adjustment needed (Week 2)

`frame-panel/route.ts` currently inserts the `problem_twin` row with `user_status='approved'`,
auto-approving on the server before the user reviews. **This conflicts with the proto-entity-at-approval
principle (§5 Week 3) and should be changed to `'proposed'`** once the gate page exists. The chrome
card adapts automatically — its CTA already handles the divergent path.

---

## 4. What's broken (stabilization audit findings)

The strategy-card pipeline has **5 distinct silent-fail paths** between strategy generation and a
rendered card. Phase 1 is fundamentally invisible until these get fixed because Phase 1 conditions
the LLM, but if the LLM's output never paints, no one sees the difference.

### Bug #1 — Chain decision blocks first-time spaces

**Location:** `src/lib/pipeline/reactive-triggers.ts:168-256`

The handoff from `synthesize → strategy-refresh` is gated by 8 conditions, all of which assume a delta
against a prior strategy. On a brand-new space, `leverage_changed`/`bottleneck_changed`/`coverage_pct`
derive from `changeDetection` (which is null), `oldQuality` is 0 so `quality_delta` equals
`newQuality` — but the threshold is `> 5` for non-research-paper inputs.

**Effect:** First-time users plausibly hit "no condition met" → chain stops dead at synthesize → strategy
stage never runs → no event, no card, no feedback.

**Fix (~5 LOC):** Add a 9th condition: `!existingStrategy` — first-ever synthesis ALWAYS deserves a strategy.

### Bug #2 — Whiteboard mounted without `?run=` → zero SSE subscription

**Location:** `src/components/canvas/interaxis-canvas.tsx:278`

```ts
const activeRunId = runSearchParams.get("run");
```

If the user navigates back to `/app/space/<id>/whiteboard` (no query param), `activeRunId=null` →
SSE never subscribes → painter never receives a single event → no cards land even if `strategy-refresh`
successfully ran on a prior session. `spaces.current_run_id` is never read as a fallback.

**Effect:** Refresh the page, lose the cards. Forever.

**Fix (~25 LOC):** Fall back to `spaces.current_run_id` when query param missing.

### Bug #3 — canvas-proposal-rings silently drops proposals without distribution

**Location:** `src/components/canvas/chrome/canvas-proposal-rings.tsx:89`

Ring cards in the side rail only render when `s.event.distribution` is truthy. Distributions come from
`simulateEntityChain` (`strategy-refresh/route.ts:2821-2826`), which requires
`entity_references[0]` to resolve to a graph entity AND have a connected hop chain within 3 hops.

**Effect:** Sparse KGs (early intake, abstract prompts) produce proposals with valid LLM confidence
but no simulation distribution → cards silently filtered out → user sees "Strategy generating…"
forever without anything appearing.

**Fix (~30 LOC):** Render without distribution using LLM confidence + a "narrative" grounding badge.

### Bug #4 — Strategy-hero shape uses random ID; re-runs leave stale ghosts

**Location:** `src/components/canvas/pipeline-event-painter.tsx:3830`

`createShapeId()` (random) is used instead of `createShapeId('strategy-hero-${spaceId}')`. Every re-run
leaves the stale hero AND creates a fresh duplicate. Plus `strategy-hero-card` is NOT in
`PAINTER_SHAPE_TYPES` cleanup set, so cross-run sweep doesn't remove it.

**Fix (~5 LOC):** Deterministic shape ID + add to cleanup set.

### Bug #5 — Hero spawn race: spaceId mirror effect runs after first proposal event

**Location:** `pipeline-event-painter.tsx:1322` (mirror effect) + `:3894` (spawn check)

`spaceId` mirrors into `state.strategyHeroSpaceId` via a separate `useEffect`. If backlog
`proposal_ready` events arrive in the same React commit as space loading, the mirror runs AFTER the
events → first proposal sees `strategyHeroSpaceId=null` → `upsertStrategyHero` skips → hero never
spawned. No retry.

**Fix (~20 LOC):** On mirror update, replay first strategy-kind proposal if `strategyHeroShapeId`
still null.

### Dead code to remove (~400 LOC)

Three pieces of code emit signals nothing consumes (or are stub-disabled):

1. **`StrategyHeroBar`** — wrapped in `false && (...)` at `interaxis-canvas.tsx:3968`. The file itself
   is 610 LOC of dead code still imported.
2. **`strategy_consensus_ready` emitter** at `space-strategizer/index.ts:1105` — no painter case
   exists. Listed in `NO_OP_TYPES` at `pipeline-event-painter.tsx:2909`. Pure noise on every run.
3. **`causal_stage_ready` painter case** at `pipeline-event-painter.tsx:2667-2684` — code comment
   says "no backend currently emits this" since 2026-04-24.

Deleting these reduces cognitive load and makes the remaining surface auditable.

---

## 5. The sequenced implementation plan

### Sequencing principle

**Stabilize before extending. Every new producer needs a working consumer.** This is the same
critique that has been raised across all conversation threads applied recursively.

### Tier-aware sequencing summary

| Week | Tier 1 work | Tier 2 work | Tier 3 work |
|---|---|---|---|
| **Now** | Adopt 3-tier vocabulary | — | — |
| **Week 1** | Tier-aware comments on fixes | — | Stabilization sprints A + B + C |
| **Week 2** | — | Phase 1 review surface | — |
| **Week 3** | **Canonical_code hooks land** | Proto-entity persistence at user-approval | — |
| **Week 4** | — | — | Phase 2 lab diverge-converge |
| **Week 5** | — | AppConfig.variables (Tier 2 contract) | Widget binding (Tier 3 rendering) |
| **Week 6+** | **canonical_concepts table** | — | **situation_twin unification** |

### Week 1 — Stabilization (2-3 days)

**Goal:** Strategy cards render reliably on fresh spaces and survive page reload. Phase 1's effects
become observable.

#### Sprint A — Visibility (1 day, ~85 LOC added)

| # | Fix | File | LOC | Risk |
|---|---|---|---|---|
| A1 | Fallback `runId` from `spaces.current_run_id` | `interaxis-canvas.tsx:278` | ~25 | Low |
| A2 | Auto-trigger strategy when `!existingStrategy` | `reactive-triggers.ts:168-256` | ~5 | Low |
| A3 | Render ring cards without distribution | `canvas-proposal-rings.tsx:89` | ~30 | Low |
| A4 | Deterministic hero shape ID + cleanup | `pipeline-event-painter.tsx:3830` | ~5 | Low |
| A5 | Hero spawn retry on mirror update | `pipeline-event-painter.tsx:1322, 3894` | ~20 | Low |

**Order:** A1 first (highest single-fix leverage — fixes page reload). Then A2 (fixes fresh-space
generation). Then A3-A5 in any order.

**Validation:** After Sprint A, fresh intake should produce a visible strategy-hero card + ring cards
in the side rail. Page refresh should preserve them.

#### Sprint B — Dead-code removal (0.5 day, ~705 LOC removed)

| # | Removal | LOC |
|---|---|---|
| B1 | Delete `strategy-hero-bar.tsx` + its import | -610 |
| B2 | Remove `strategy_consensus_ready` emit (or wire painter) | -20 |
| B3 | Remove `causal_stage_ready` painter case | -25 |
| B4 | Clean storyboard references | -50 |

#### Sprint C — Instrumentation (1 day, ~160 LOC added)

| # | Add | LOC |
|---|---|---|
| C1 | `pipeline_error` / `pipeline_warning` event types | ~30 |
| C2 | Emit at every silent-fail path in strategy chain | ~80 |
| C3 | Chrome banner showing accumulated errors/warnings | ~50 |

**Validation gate (end of Week 1):** Run the smoke test in §9. If any step fails, Sprint C's
instrumentation tells us exactly where.

---

### Week 2 — Phase 1 review surface (3-4 days)

**Goal:** Make the framing card a real review surface, not just a notification. Establish the
"draft column → user reviews → approve → materialize" pattern that Week 3 will replicate.

#### W2.1 — Stop auto-approving the problem_twin (~5 LOC)

**File:** `src/app/api/pipeline/frame-panel/route.ts:418-428`

Change:
```ts
user_status: "approved",      // → "proposed"
approved_at: new Date().toISOString(),    // → remove
```

The chrome card adapts automatically — it already distinguishes proposed vs approved states.

#### W2.2 — Build the framing gate page (~250 LOC)

**Files:**
- `src/app/app/space/[id]/framing/page.tsx` (server component, loads twin_proposals row)
- `src/components/framing/framing-pick-client.tsx` (client component, renders options)
- `src/app/api/spaces/[id]/framing/select/route.ts` (re-rank route, mirror `strategy-refresh/route.ts:744-794`)
- `src/app/api/spaces/[id]/framing/approve/route.ts` (approve route, mirror `twin-proposal/approve`)

**UX:** Grid of N framing cards, each showing:
- `framing_title` + `framing_id`
- `chosen_approach` (1-2 sentences)
- Supporting lens chip
- `when_it_wins` / `when_it_fails` collapsibles
- `sub_problems[]` as bullet list
- Confidence pct
- "Choose this framing" button → POST /framing/select then /framing/approve

#### W2.3 — Extend KgPlanReviewCard with framing section (~200 LOC)

**File:** `src/components/canvas/chrome/kg-plan-review-card.tsx:157-228`

Add a "Problem framings" section reading from `kg_generation_plans.scope_and_objectives` or directly
from `twin_proposals(kind='problem_twin')`. PATCH endpoint already accepts the relevant sections.

**Validation gate (end of Week 2):**
1. Re-pick a framing via the gate page
2. See the chrome card update
3. Re-fire strategy-refresh
4. See different strategy cards land (Phase 1's downstream effect observable for the first time)

---

### Week 3 — Proto-entity persistence at user-approval time + Tier 1 hooks (5-7 days)

**Goal:** Stop discarding ~17K chars of structured framing cognition per intake. Persist
high-information artifacts as proto-entities at the moment of user approval. Add Tier 1 hooks
(canonical_code population, selection-diagram markers) so future canonical-tier work is cheap.

#### W3.1 — Migration: Tier 1 hooks (~70 LOC)

**File:** `supabase/migrations/20260716_canonical_hooks_and_proto_entities.sql`

- Add `entities.canonical_concept_id uuid` (NULL, no FK yet — the table doesn't exist)
- Add `entities.derived_from jsonb` for proto-entity provenance
- Add `entities.conditional_context jsonb` for adaptive-weighting context
- Add `edges.is_canonical_mechanism boolean` (NULL)
- Add `edges.transferability_tag text` (NULL — Bareinboim selection-diagram marker)
- Add new `entity_category` values if needed: `framing`, `assumption`, `risk` (or reuse `epistemic`)

#### W3.2 — Proto-entity extractor library (~250 LOC)

**File:** `src/lib/pipeline/persist-framing-protos.ts`

Functions:
- `extractProtoEntities(frame: SituationFrame, twinProposalId: uuid): ProtoEntity[]`
  - One entity per `candidate_framings[i]` → layer=internal, category=epistemic
  - One entity per `sub_problems[i]` for the chosen framing → layer=internal, category=process
  - One entity per `load_bearing_assumptions[i]` → layer=conceptual, category=epistemic
  - One entity per `proposed_axes[i]` → layer=conceptual, category=abstract
  - Skip cell opinions (low-information, keep in JSONB)
- `persistProtoEntities(db, spaceId, protos)` — inserts with deterministic IDs (hash of spaceId + framing_id) so re-runs idempotent
- `linkProtoEntities(db, protos)` — adds edges:
  - framing → sub_problems (decomposition)
  - framing → load_bearing_assumption (depends_on)
  - shared sub_problems across framings (convergence)

#### W3.3 — Canonical_code population (~30 LOC)

**File:** `src/lib/pipeline/persist-framing-protos.ts` (same file as W3.2)

For every proto-entity:
```ts
canonical_code: normalizeCanonicalCode(entity.name)
// Where normalizeCanonicalCode is exported from
// src/lib/kg/canonical-code.ts (~50 LOC, new file)
```

This makes future cross-space joins cheap when Week 6+ adds `canonical_concepts`.

#### W3.4 — Approval hook in `framing/approve/route.ts` (~120 LOC)

On approve:
1. Mark `twin_proposals(kind='problem_twin').user_status = 'approved'`
2. Read `frame_payload.options[chosen_rank-1]` and `spaces.situation_frame.candidate_framings`
3. Call `extractProtoEntities` + `persistProtoEntities` + `linkProtoEntities`
4. Commit `spaces.situation_frame` (the merged frame for legacy consumers)
5. Emit `framing_approved` event (already wired) — painter handles the UI update

#### W3.5 — Variable-definition affordance (~200 LOC)

The user can add/edit/delete variables in the framing review surface. Implementation:
- New section in `framing-pick-client.tsx`: "Variables you care about"
- Each variable carries the preflight `VariableEntry` shape (IV/DV/control/mediator/moderator)
- On approve: materialize as `entities` rows + initial `environment_overrides` rows
- Aggregator (preflight) will then layer further overrides on top

**Files:**
- `src/components/framing/variable-definitions-section.tsx` (~150 LOC)
- `src/app/api/spaces/[id]/framing/variables/route.ts` (~80 LOC)
- Extension to `framing/approve/route.ts` to materialize on approve

#### W3.6 — Decompose conditioning on existing entities (~80 LOC)

**File:** `src/app/api/pipeline/decompose/route.ts:331-360`

Modify Pass 1 prompt to receive `existing_entities[]` from approved proto-entities. Instruct LLM to
LINK and EXPAND rather than re-derive. The prompt extension hook already exists; just extend it.

**Validation gate (end of Week 3):**
1. Submit a fresh prompt
2. Review framing page shows 5 competing problem framings
3. Add 2 custom variables (one IV, one DV) before approving
4. Approve → entities table contains: 1 chosen framing + N sub_problems + N assumptions + N axes + 2 user variables (~30-40 proto-entities total)
5. Decompose Pass 1 emits `entity_added` events that LINK to existing proto-entities (visible in canvas as edges from proto-entities to new entities)
6. `node_signatures.canonical_code` is populated on every proto-entity row

---

### Week 4 — Phase 2 lab diverge-converge (8-10 days)

**Goal:** Build the lab diverge-converge as Tier 3 work, mirroring Phase 1's pattern. The Phase 2 plan
(corrected by the validation audit) lands now that strategy cards render.

**Critical corrections from the validation audit:**
1. Cascade-supersede target = `apps.stale_reason='lab_regen'`, NOT `executable_twin`
2. Layer-on-top: `lab_twin` is the new upstream picker, `lab_scaffolds` stays as the committed config
3. On lab_twin approval: insert ONE `lab_scaffolds` row pre-filled from chosen option → existing wizard takes over
4. Hide existing `canvas-lab-proposal-chip` when a `lab_twin` is pending
5. Gate page path = `/app/space/[id]/lab/pick` (NOT `/lab` — collision with existing post-approval surface)
6. `after()` fire location = `strategy-refresh/route.ts:~3187` (terminal hop, gated on `reasoningSettings.runLab`)

#### W4.1-2 — Migrations (~45 LOC)

- Migration A: extend `twin_proposals` kind CHECK with `'lab_twin'`; add `lab_payload jsonb`
- Migration B: extend `apps.stale_reason` CHECK with `'lab_regen'`

#### W4.3 — Types (~150 LOC)

`LabConfigOption`, `LabProposedEvent`, `LabApprovedEvent`, `LabSelectedEvent`.

`LabConfigOption` shape:
- `design_type` (rct | observational | single_subject | sequential | etc.)
- `subjects[]` (proposed_subjects shape from existing `lab_scaffolds`)
- `features[]` (proposed_features — monte_carlo, what_if, ab_compare, deepen_kg, etc.)
- `measurement_cadence` (daily | weekly | event_triggered)
- `duration_estimate_weeks`
- `primary_iv` / `primary_dv` (entity IDs from KG)
- `confidence`
- `when_it_wins` / `when_it_fails`
- `lens_id` (the stance that produced it)

#### W4.4 — Lab stance prompts (~350 LOC)

**File:** `src/lib/prompts/lab-stances.ts`

5 stances + shared output spec. Each is a distinct epistemological stance on lab design:

| Stance | Optimizes for | Typical bias |
|---|---|---|
| Tight Experimentalist | Internal validity | Strict RCT, single IV, blinded |
| Naturalistic Observer | External validity | Minimal disruption, telemetry |
| Adaptive Designer | Statistical efficiency | Bayesian / sequential / stop-when-evidence |
| Pragmatist | Feasibility | What's achievable given subject access |
| Mechanistic Prober | Hypothesis tests | Probes the chosen framing's load-bearing assumption |

#### W4.5 — Lab generation library (~250 LOC)

**File:** `src/lib/pipeline/lab-options.ts` — mirrors `framing-options.ts`. Runs 5 stances in parallel, validates each, returns sorted options.

#### W4.6 — Generate-lab-options route (~200 LOC)

**File:** `src/app/api/pipeline/generate-lab-options/route.ts`

Wraps the library, inserts `twin_proposals(kind='lab_twin')` row, emits events, auto-approves rank-1
(or `user_status='proposed'` if W2.1's pattern is followed).

#### W4.7 — Painter handlers (~80 LOC)

Add cases for `lab_proposed`, `lab_approved`, `lab_selected` events.

#### W4.8 — Chrome listener + gate page (~750 LOC)

- `lab-proposal-gate.tsx` (mirror `framing-proposal-gate.tsx`)
- `/app/space/[id]/lab/pick/page.tsx` + `lab-pick-client.tsx`
- `/api/spaces/[id]/lab/select/route.ts`
- Hide existing `canvas-lab-proposal-chip` when `lab_twin` pending

#### W4.9 — Wire strategy-refresh `after()` (~80 LOC)

**File:** `src/app/api/pipeline/strategy-refresh/route.ts:~3187`

Gate on `reasoningSettings.runLab` (precedent: lines 183, 534).

#### W4.10 — `lab_scaffolds` materialization bridge (~150 LOC)

On `lab_twin` approval, derive a `lab_scaffolds` row from the chosen option so the existing
subject-materialization wizard keeps working.

#### W4.11 — Downstream conditioning (~150 LOC)

**Files to modify:**
- `src/app/api/pipeline/execution-brief/route.ts`
- `src/app/api/pipeline/generate-apps/route.ts:147` (`generateAppsAndInterventions` call)

Thread `loadChosenLabForSpace` + `formatChosenLabForPrompt` so picking a different lab actually
changes what gets executed.

**Validation gate (end of Week 4):**
1. Pick a framing → approve
2. Strategy generates → emit `strategy_twin`
3. Lab options auto-generate (5 stance-flavored options)
4. Lab pick page shows the 5 options side-by-side
5. Pick a different lab option → execution brief reflects the choice
6. Apps generate against the chosen lab configuration
7. Re-pick lab → cascade-supersedes apps with `stale_reason='lab_regen'`

---

### Week 5 — App variables (Tier 2/3 contract) (5-7 days)

**Goal:** Apps inherit the variable contract (IV/DV/control/mediator/moderator) from preflight + KG +
strategy. App features become first-class manipulable variables.

#### W5.1 — Type extension (~30 LOC)

**File:** `src/types/app.ts`

```ts
interface AppConfig {
  // ...existing fields...
  variables?: VariableEntry[];  // NEW — reuse the preflight VariableEntry shape
}

interface WidgetInstance {
  // ...existing fields...
  binds_variable_id?: string;   // NEW — which variable this widget surfaces
}
```

#### W5.2 — Derivation function (~200 LOC)

**File:** `src/lib/pipeline/derive-app-variables.ts`

```ts
function deriveAppVariables({
  app: AppRow;
  preflight: PreflightView;
  kg: { entities: EntityRow[]; edges: EdgeRow[] };
  goal: ImprovementGoalRow | null;
}): VariableEntry[]
```

Pure function: joins `app.dominant_entity_ids[]` × preflight role assignments. Adds DVs from
`app.tracked_metric_tracker_ids[]` and goal targets. Marks mediators as "pending" until W5.3.

#### W5.3 — Mechanism → app join (~100 LOC)

**File:** `supabase/migrations/20260718_apps_mechanism_link.sql`

Add `apps.mechanism_ids uuid[]` (or derive transitively from strategy). Lights up the mediator role on
the variable card.

#### W5.4 — Variable role chip widget (~150 LOC)

**File:** `src/components/apps/widgets/variable-contract-card.tsx`

Renders the variables grouped by role with override-able role chips (uses
`environment_overrides`-style pattern).

#### W5.5 — Strategy LLM prompt extension (~30 LOC)

**File:** `src/lib/prompts/strategic-recommendation.ts:1186`

Add directive: "For each infrastructure_proposal, declare `app_variables: VariableEntry[]` — what IV/DV
the app exposes, what mediators it implements, what it controls for." The LLM authors what's currently
derived.

**Validation gate (end of Week 5):**
1. Open an app's per-app dashboard
2. See `VariableContractCard` widget showing IVs, DVs, controls, mediators
3. Override a variable's role → environment_overrides row appended
4. Strategy regen → app's variables now LLM-authored, not derived

---

### Week 6+ — Canonical concept tier + situation_twin unification (8-12 days)

**Goal:** Land the Tier 1 canonical concept registry now that Week 3's hooks are in place. Build
the Tier 3 unified `situation_twin` view.

#### W6.1 — Canonical_concepts table (~150 LOC)

**File:** `supabase/migrations/20260720_canonical_concepts.sql`

```sql
create table canonical_concepts (
  id uuid primary key default gen_random_uuid(),
  canonical_code text not null unique,    -- e.g. 'bdnf', 'ros', 'sleep_quality'
  display_name text not null,
  domain_tags text[] not null default '{}', -- biological, behavioral, environmental, ...
  description text,
  literature_refs jsonb,                  -- DOIs, citations
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

#### W6.2 — Backfill canonical_concepts (~200 LOC)

**File:** `src/scripts/backfill-canonical-concepts.ts`

Cluster existing `node_signatures.canonical_code` entries from Week 3's population pass. Use
semantic embedding distance + text similarity. Insert one row per cluster centroid.

#### W6.3 — Retro-add FK constraint (~50 LOC)

**File:** `supabase/migrations/20260721_entities_canonical_fk.sql`

Now that `canonical_concepts` exists, add the FK from `entities.canonical_concept_id`. Backfill from
the W3 `canonical_code` text column via JOIN.

#### W6.4 — Mediator-proposer against canonical DB (~150 LOC)

**File:** `src/lib/prompts/mediator-proposal.ts` + `src/lib/mediator-proposal/propose-mediator.ts`

Instead of asking the LLM to recall "established mediators," query `canonical_concepts` filtered by
`domain_tags` matching the space's domain. Inject as candidate mediator set.

#### W6.5 — `situation_twin` unified view (~300 LOC)

**File:** `src/lib/twin/situation-twin.ts` + `supabase/migrations/20260722_situation_twin_view.sql`

Either a postgres VIEW (read-only) or a materialized denorm row. Joins:
- `twin_proposals` (commitment) WHERE space_id = X AND kind = 'strategy_twin' AND user_status = 'approved'
- `subjects` (persona)
- `condition_modulators` WHERE space_id = X (per-space overlays)
- `twin_snapshots` (latest frozen state)
- `scenarios.action_list` (intervention history)
- `apps` (executable surfaces)

API: `GET /api/spaces/[id]/situation-twin` returns a single JSON object representing the full Tier 3
artifact.

**Validation gate (end of Week 6+):**
1. Multiple spaces' "BDNF" entities resolve to the same `canonical_concept_id`
2. Mediator-proposer suggests `canonical_concepts.canonical_code` instead of inventing
3. `/api/spaces/[id]/situation-twin` returns a unified Tier 3 object
4. Cross-space evidence accumulation: querying canonical_concepts.literature_refs returns all evidence pointing at a concept across all user spaces

---

## 6. Definitions & naming conventions

### Tier-aware file header convention

Every new file declares its tier in the header comment:

```ts
// ── [Component name] ─────────────────────────────────────────────
//
// TIER: 2 (situation KG) — per-space entities/edges/mechanisms
//
// [Rest of header explaining what this component does]
```

Valid tier values:
- `TIER: 1 (canonical/schema/TBox)`
- `TIER: 2 (situation KG/ABox)`
- `TIER: 3 (situation-specialized causal model)`
- `CROSS-CUTTING: memory / analogy / bridges`

### Twin terminology

| Term | Meaning | Existing in code? |
|---|---|---|
| `twin_proposal` | A row in the `twin_proposals` table — represents a *commitment* (problem framing / strategy / executable apps) | YES |
| `problem_twin` | `twin_proposals.kind = 'problem_twin'` — chosen problem framing | YES (this thread) |
| `strategy_twin` | `twin_proposals.kind = 'strategy_twin'` — chosen strategy + mechanisms | YES (default) |
| `executable_twin` | `twin_proposals.kind = 'executable_twin'` — chosen apps + variants | Reserved for Phase 4 |
| `lab_twin` | `twin_proposals.kind = 'lab_twin'` — chosen lab configuration | Phase 2 (Week 4) |
| **`situation_twin`** | **The unified Tier 3 causal model** (logical join over twin_proposals + subjects + condition_modulators + twin_snapshots + scenarios) | NO — to be built Week 6+ |
| "twin" (unqualified) | **AMBIGUOUS — never use without a qualifier** | — |

### Diverge-converge cycle vocabulary

Every diverge-converge cycle in the codebase implements the same 6-step shape:

```
DIVERGE → VERIFY → CONVERGE → GATE → USER PICK → PERSIST
```

| Step | Phase 1 (framing) | Phase 2 (lab) | Phase 4 (apps) |
|---|---|---|---|
| DIVERGE | `framing-options.ts` (5 lens-stances) | `lab-options.ts` (5 lab-stances) | `writer-path` (N variants) |
| VERIFY | `validateLensOutput` | (TBD — same pattern) | `iv-scorer.ts` |
| CONVERGE | `consensusMerge` (collect framings, sort by confidence) | `lab-options.ts` (rank by confidence) | scorer ranks |
| GATE | `twin_proposals(kind='problem_twin')` | `twin_proposals(kind='lab_twin')` | `twin_proposals(kind='executable_twin')` (future) |
| USER PICK | `/api/spaces/[id]/framing/select` (Week 2) | `/api/spaces/[id]/lab/select` (Week 4) | (TBD) |
| PERSIST | `persist-framing-protos.ts` (Week 3) | `lab_scaffolds` materialization (Week 4) | apps table (existing) |

### Variable role taxonomy

The preflight `VariableEntry` shape is the canonical variable contract. Reuse across all tiers:

```ts
type VariableRole =
  | 'independent'   // IV — user manipulates
  | 'dependent'     // DV — user measures
  | 'controlled'    // held constant
  | 'confounding'   // adjusted for
  | 'mediator'      // on the causal path between IV and DV
  | 'modifier'      // effect-modifier / moderator
  | 'unclassified'; // pending user review
```

**Reuse locations:**
- Preflight contract (existing) — Tier 2 entity-level
- Pre-decompose variable definitions (Week 3) — Tier 2 user-authored
- AppConfig.variables (Week 5) — Tier 2/3 boundary, derived + LLM-authored
- (Future) probability_space variable tagging

---

## 7. Open architectural decisions

These are decisions the user should approve before the corresponding week's work begins.

### Decided

| # | Decision | Made when |
|---|---|---|
| D1 | Stabilization (Sprints A+B+C) before any new feature work | This thread |
| D2 | Adopt 3-tier vocabulary discipline from now | This thread |
| D3 | Proto-entity persistence at user-approval time (not LLM-completion) | This thread |
| D4 | Phase 1 framings: change `user_status='approved'` to `'proposed'` (Week 2) | This thread |
| D5 | Phase 2 lab Path C: `twin_proposals(kind='lab_twin')` + `lab_scaffolds` two-table hybrid | This thread |
| D6 | Phase 2 lab: Layer-on-top, don't replace existing `LabProposalWizard` | This thread |
| D7 | No primitive extraction (`generateOptionsAndVerify<T>()`) until Phase 2 ships — rule of three | This thread |
| D8 | Canonical_concepts table = Week 6+, but hooks (`canonical_code` population) land Week 3 | This thread |
| D9 | Cascade-supersede on lab re-pick = flag apps with `stale_reason='lab_regen'` (mirrors strategy-refresh) | This thread |

### Open

| # | Question | Recommended | Decide by |
|---|---|---|---|
| O1 | After Week 2 lands, should clarifying-questions become a real loop (re-callable from review surface)? | Yes — route already accepts `unknowns` + `uncertaintyScore` | End of Week 2 |
| O2 | Should `app_versions` audit table become first-class user-visible history? | Defer until apps stabilize | Week 5+ |
| O3 | When Week 6 lands, rename `twin_proposals` → `strategy_commitments`? | Defer — too disruptive | Week 6+ |
| O4 | Should the 5 lab stances be tuned after Phase 2 ships, or right? | Ship and iterate after watching N spaces | Week 4+ |
| O5 | When canonical_concepts lands, should the mediator-proposer become a DB query instead of an LLM call? | Hybrid: query for candidates, LLM ranks | Week 6+ |

---

## 8. Anti-patterns to avoid

These are the patterns this conversation has explicitly identified as architectural debt. Don't add to them.

### A1 — Producer without consumer

Adding LLM calls or generators when the downstream rendering / persistence consumer is missing or
broken. The 5-lens panel currently produces 17K chars of cognition that becomes prompt text and then
JSONB; never graph structure. Every new producer needs a working consumer.

**Check before shipping:** Does the new artifact persist in a queryable form? Does it render to a
user-visible surface? If no, build the consumer first.

### A2 — Auto-write to `spaces.*` before user approval

The current pattern writes `spaces.situation_frame` and `spaces.situation_baseline` automatically in
the bootstrap `after()` block before the user sees them. The user never gets to add/edit/deepen/delete.
New convention: write to `kg_generation_plans.*_draft` columns first; commit to `spaces.*` only at
user approval.

**Check before shipping:** Does the user have a chance to review/edit before this lands in `spaces.*`?

### A3 — Parallel subsystems (vs. extending what exists)

The `feedback_check_existing_first.md` memory: always grep the codebase for existing implementations
before proposing new pipeline stages, schemas, or components. Phase 2 lab violates this risk because
`canvas-lab-proposal-chip` + `LabProposalWizard` already exist — the new lab gate must layer on top,
not replace.

**Check before shipping:** Have I greped for existing implementations of this concept? Am I extending
or replicating?

### A4 — Primitive extraction before the rule of three

Don't extract `generateOptionsAndVerify<T>()` until Phase 2 ships and we have two concrete callers
(framing-options + lab-options) to abstract from. Premature abstraction designs against imagined
requirements; rule of three says extract on the third instance.

**Check before shipping:** Have I seen this pattern in two places? Am I extracting on the second?

### A5 — Ambiguous "twin" usage

Never write `twin` in code or comments without a qualifier (`problem_twin`, `strategy_twin`,
`situation_twin`, etc.). Ambiguous usage produces architectural confusion downstream.

**Check before shipping:** Did I use "twin" without a qualifier? Replace it.

### A6 — Patch where root cause exists

The mediator-proposal patch concern: a patch makes sense only when the root cause can't be fixed.
When extending the codebase, fix root causes (extend the lens schema, extend the decompose tier, fix
the silent-fail bug) rather than adding patches that compensate for them.

**Check before shipping:** Is this a patch over a deeper bug? Can I fix the root cause instead?

---

## 9. Validation gates

Each week's work ends with a validation gate. If the gate fails, the next week's work doesn't start.

### V1 — End of Week 1 (stabilization)

**Smoke test:**
1. Fresh prompt → land on whiteboard with `?run=<id>` in URL
2. Verify framing card appears (Phase 1 already wired)
3. Approve plan → wait for decompose
4. Wait for synthesize → strategy-refresh auto-fires (Sprint A2)
5. See 3 strategy ring cards in side rail (Sprint A3)
6. See strategy-hero-card in proposal room (Sprints A4/A5)
7. Refresh page → cards still there (Sprint A1)
8. Re-pick framing → run strategy-refresh again → different options land

If any step fails, Sprint C's instrumentation tells us exactly where.

### V2 — End of Week 2 (Phase 1 review surface)

1. Run intake → framing card appears
2. Click "Review framings →" → land on `/app/space/[id]/framing` showing 5 options
3. Re-rank → click "Choose this framing" → POST select then approve
4. Chrome card updates to "approved" state
5. Re-fire strategy-refresh → DIFFERENT strategy cards appear than rank-1 produced

**This is Phase 1's validation moment — first time the framing-to-strategy effect is observable.**

### V3 — End of Week 3 (proto-entity persistence)

1. Fresh prompt → approve framing
2. Query `entities` table — see ~30-40 proto-entity rows with `derived_from.source_type` populated
3. Query `node_signatures` — every proto-entity has `canonical_code`
4. Add 2 user variables in the review surface before approving
5. After approve, the 2 user variables are in `entities` table tagged with role
6. Decompose runs → emits `entity_added` events with EDGES linking to proto-entities (not just from-scratch entities)

### V4 — End of Week 4 (Phase 2 lab)

1. Pick framing → approve → strategy generates → see strategy cards
2. After strategy_twin lands, lab options auto-generate (5 stance-flavored)
3. Open `/app/space/[id]/lab/pick` → see 5 lab options
4. Pick a different lab option → execution-brief reflects it
5. Apps generate against chosen lab
6. Re-pick lab → `apps.stale_reason='lab_regen'` flagged on existing apps

### V5 — End of Week 5 (app variables)

1. Open an app dashboard
2. See `VariableContractCard` widget showing IVs/DVs/controls/mediators
3. Override a variable's role → `environment_overrides` row appended
4. Strategy regen → `infrastructure_proposals[].app_variables[]` is now LLM-authored

### V6 — End of Week 6 (canonical concepts)

1. Backfill clusters existing `canonical_code` entries into `canonical_concepts` rows
2. Two spaces' "BDNF" entities resolve to the same `canonical_concept_id`
3. Mediator-proposer queries `canonical_concepts` table instead of relying on LLM training
4. `/api/spaces/[id]/situation-twin` returns unified Tier 3 JSON object

---

## 10. Reference file map

### Phase 1 files (shipped)

| File | Role |
|---|---|
| `supabase/migrations/20260715_twin_proposals_kind_and_frame.sql` | Migration adding kind + frame_payload |
| `src/types/pipeline-events.ts:1554-1655` | FramingProposedEvent + FramingApprovedEvent |
| `src/types/situation-frame.ts:217-254` | LensWholeFraming + candidate_framings field |
| `src/lib/prompts/framing-lenses.ts` | Lens prompts extended with candidate_whole_framing |
| `src/lib/pipeline/framing-panel.ts:170-230` | consensusMerge + collectCandidateFramings |
| `src/lib/situation-frame/frame-helpers.ts` | emptyFrame + validateFrame + coerceCandidateFraming |
| `src/app/api/pipeline/frame-panel/route.ts:295-505` | persistAndEmitProblemTwin helper |
| `src/components/canvas/pipeline-event-painter.tsx:2741-2810` | Framing event painter cases |
| `src/components/canvas/chrome/framing-proposal-gate.tsx` | Chrome listener (non-blocking card) |
| `src/app/app/space/[id]/whiteboard/page.tsx` | Mount of FramingProposalGate |

### Stabilization files (Week 1 targets)

| File | Bug fixed |
|---|---|
| `src/components/canvas/interaxis-canvas.tsx:278` | A1 — runId fallback |
| `src/lib/pipeline/reactive-triggers.ts:168-256` | A2 — fresh-space auto-trigger |
| `src/components/canvas/chrome/canvas-proposal-rings.tsx:89` | A3 — render without distribution |
| `src/components/canvas/pipeline-event-painter.tsx:3830` | A4 — deterministic hero shape ID |
| `src/components/canvas/pipeline-event-painter.tsx:1322, 3894` | A5 — hero spawn retry |
| `src/components/canvas/chrome/strategy-hero-bar.tsx` | B1 — delete (dead code) |
| `src/lib/pipeline/space-strategizer/index.ts:1105` | B2 — remove orphan emit |
| `src/components/canvas/pipeline-event-painter.tsx:2667-2684` | B3 — remove orphan painter case |

### Week 2-6+ new files (planned)

| File | Week | Role |
|---|---|---|
| `src/app/app/space/[id]/framing/page.tsx` | 2 | Server gate page |
| `src/components/framing/framing-pick-client.tsx` | 2 | Client picker UI |
| `src/app/api/spaces/[id]/framing/select/route.ts` | 2 | Re-rank endpoint |
| `src/app/api/spaces/[id]/framing/approve/route.ts` | 2 | Approve endpoint |
| `supabase/migrations/20260716_canonical_hooks_and_proto_entities.sql` | 3 | Tier 1 hooks |
| `src/lib/pipeline/persist-framing-protos.ts` | 3 | Proto-entity extractor |
| `src/lib/kg/canonical-code.ts` | 3 | normalizeCanonicalCode helper |
| `src/components/framing/variable-definitions-section.tsx` | 3 | Pre-decompose variable UI |
| `src/app/api/spaces/[id]/framing/variables/route.ts` | 3 | Variable CRUD endpoint |
| `supabase/migrations/20260717_lab_twin_and_apps_stale_reason.sql` | 4 | Phase 2 migrations |
| `src/types/lab-options.ts` | 4 | LabConfigOption + lab events |
| `src/lib/prompts/lab-stances.ts` | 4 | 5 lab stance prompts |
| `src/lib/pipeline/lab-options.ts` | 4 | Lab generation library |
| `src/app/api/pipeline/generate-lab-options/route.ts` | 4 | Lab generation route |
| `src/components/canvas/chrome/lab-proposal-gate.tsx` | 4 | Lab chrome listener |
| `src/app/app/space/[id]/lab/pick/page.tsx` | 4 | Lab gate page |
| `src/app/api/spaces/[id]/lab/select/route.ts` | 4 | Lab re-rank endpoint |
| `src/lib/pipeline/derive-app-variables.ts` | 5 | App variables derivation |
| `supabase/migrations/20260718_apps_mechanism_link.sql` | 5 | Mechanism → app FK |
| `src/components/apps/widgets/variable-contract-card.tsx` | 5 | Variable role chip widget |
| `supabase/migrations/20260720_canonical_concepts.sql` | 6+ | Canonical concept registry |
| `src/scripts/backfill-canonical-concepts.ts` | 6+ | Clustering backfill |
| `src/lib/twin/situation-twin.ts` | 6+ | Tier 3 unified API |

---

## Appendix A — Conversation thread map

Every architectural concern raised in the conversation thread, mapped to where it gets addressed
in this plan:

| Thread | Plan location |
|---|---|
| "Mediator proposal is a band-aid patch" | Week 6+ (W6.4 — mediator-proposer against canonical DB) |
| "How much of KG is formed during problem framing?" | Week 3 (proto-entity persistence) |
| "Compute waste — 17K chars → 0 entities" | Week 3 (proto-entity persistence) |
| "Variables manipulable like IV/DV in apps?" | Week 5 (AppConfig.variables) |
| "Apps as configured templates vs rich experiments" | Week 5 (variable contract + widget binding) |
| "User refinement before persistence?" | Week 2 (Phase 1 review surface) + Week 3 (variable definitions) |
| "General KG vs situation KGs (3-tier model)" | §2 + Week 3 hooks + Week 6+ table |
| "Strategy cards keep bugging" | Week 1 (Sprints A+B+C) |
| "Phase 2 lab plan" | Week 4 (with corrections from validation audit) |
| "Sequencing — what to do now?" | §5 sequencing principle: stabilize first |

---

## Appendix B — External research patterns referenced

| Pattern | Source | Where in plan |
|---|---|---|
| TBox/ABox separation | Description Logic / OWL | §2 Tier 1/2 model |
| Personalized Knowledge Graphs | Balog & Kenter, SIGIR 2019 | §2 Tier 2 (existing) |
| Transportability of Causal Effects | Bareinboim & Pearl, 2014 | §2 Tier 3 (selection diagrams via `edges.transferability_tag`, W3.1) |
| CATE / Conditional Average Treatment Effects | Künzel et al., 2019 | §2 Tier 3 (existing `condition_modulators`) |
| Neuro-symbolic causal AI | Schölkopf et al., 2021 | §2 cross-cutting (existing `kg_signatures` + future learning loop) |
| Wikidata / ConceptNet canonical IDs | — | §2 Tier 1 (W6.1 `canonical_concepts`) |

---

## Document version

- **v1.0 — 2026-05-11** — Initial synthesis after extended conversation. Supersedes all prior partial
  plans (`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`, `KG_DEPTH_CRITIQUE.md`,
  `RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md`) where they conflict.

**Next action:** Sprint A1 — fallback runId from `spaces.current_run_id` in
`src/components/canvas/interaxis-canvas.tsx:278`. ~25 LOC. Single-file change. Makes page-reload work.
This is the highest-leverage fix in the codebase right now.
