# Objective Canvas — Operation Map & Lab Notebook Design Substrate

> Living document. Last updated 2026-05-27 after Phase 9 ship (Lab Notebook MVP).
> Source of truth for **what operations exist inside the Objective Canvas, what they persist, what they emit, and where the gaps are** — before Phase 10 (notebook expansion + chat surface) is designed.

---

## 0. Why this doc exists

Phase 9 shipped a Lab Notebook that surfaces decision-log events scoped to a single room. The user wants to evolve it into a **conversational, queryable surface** that tells the whole canvas story — initial prompt, clarifying Q&A, sub-objective picking, room generation, every per-item move, cross-room signals, the works.

Before designing Phase 10 we need an **inventory** of every operation: what's logged today, what *should* be logged, what's only client-side, what's silently persisted to JSONB, and what's missing entirely. This doc is that inventory.

Scope: **Objective Canvas only** — Synergy (cross-space sessions) is explicitly out of scope per the latest user direction.

---

## 1. End-to-end canvas walkthrough

A user lands on `/app/new`, types an objective, and sees this sequence:

```
┌── STAGE: clarifying ─────────────────────────────────────────────┐
│  1. POST /api/brainstorm/start                                   │
│     → row in spaces, row in improvement_goals (root, parent=null)│
│     → fire-and-forget surfacePassToDb() research                 │
│  2. POST /api/brainstorm/clarify/generate (mode=initial)         │
│     → spaces.synthesis_data.objective_canvas.clarifying.questions│
│  3. POST /api/brainstorm/clarify/answer (per Q)                  │
│     → spaces.synthesis_data.objective_canvas.clarifying.answers  │
│  4. POST /api/brainstorm/clarify/complete                        │
│     → stage = "picking"                                          │
│     → fire-and-forget deepPassToDb() + annotations/generate      │
└──────────────────────────────────────────────────────────────────┘
┌── STAGE: picking ────────────────────────────────────────────────┐
│  5. POST /api/brainstorm/annotations/generate (background)       │
│     → improvement_goals.annotations + annotations_versions       │
│  6. POST /api/brainstorm/sub-objectives/propose (mode=initial)   │
│     → spaces.synthesis_data.objective_canvas.sub_objectives      │
│  7. (optional) /propose mode=variant w/ intent → batches[]       │
│     → logDecision(action="generate_batch", batch_intent=...)     │
│  8. (optional) /api/brainstorm/sub-objectives/disposition        │
│     → in-memory pre-confirm preference signal                    │
│  9. POST /api/brainstorm/sub-objectives/confirm                  │
│     → materializes picked proposals as child improvement_goals   │
│     → stage = "main"                                             │
│     → logDecision(action="confirm") per pick                     │
└──────────────────────────────────────────────────────────────────┘
┌── STAGE: main (the canvas) ──────────────────────────────────────┐
│  Main canvas page hosts:                                         │
│   • Sub-objective tiles (one per child goal)                     │
│   • AnalysisWorkbench strip (cross-room findings)                │
│   • Cross-room signals strip + Concept memory feed strip         │
│   • Strategy Brief deliverable                                   │
│   • Sub-objective picker (add more, cluster, branch)             │
│                                                                  │
│  Clicking a sub-objective tile navigates to /sub/<id>            │
│  → SubObjectiveRoomView mounts                                   │
└──────────────────────────────────────────────────────────────────┘
┌── INSIDE A ROOM (sub-objective view) ────────────────────────────┐
│  10. POST /api/brainstorm/room/generate (initial)                │
│      → 1× LLM call for room_categories                           │
│      → 3× sequential LLM calls (pain → outcomes → features)      │
│      → inserts entities (rows)                                   │
│      → inserts cross-layer edges (causal correlations)           │
│      → inserts within-layer edges (composes_with/interferes)     │
│      → updates improvement_goals.room_layers_generated_at        │
│  11. Per item: variation generate / disposition / refine / score │
│      / compose / prototype / research / highlights / expansion   │
│      (see §5)                                                    │
│  12. Per edge: approve / revoke (logDecision approve_bet)        │
│  13. Constraints editor (per space, surfaced in rooms)           │
│  14. Autopilot — client-side loop over chains                    │
│  15. Lab Notebook panel — read-only view of decisions            │
└──────────────────────────────────────────────────────────────────┘
┌── CROSS-ROOM (parent canvas, post-room-generation) ──────────────┐
│  16. AnalysisWorkbench auto-scans on mount (Tier 1, 5 analyses)  │
│  17. User clicks Run on Tier 2/3 operation (3 analyses)          │
│  18. Findings: open → acknowledged | resolved | dismissed (silent)│
│  19. Theme finding → "Distill into sub-objective" → new child    │
│  20. Strategy Brief build + polish                               │
└──────────────────────────────────────────────────────────────────┘
```

Stages live in `spaces.synthesis_data.objective_canvas.stage`. The `done` stage is reserved but unimplemented.

---

## 2. Stage state machine (definitive)

| Stage | Storage | Set by | Transition trigger |
|---|---|---|---|
| `clarifying` | default on space creation | `POST /api/brainstorm/start` | — |
| `picking` | `synthesis_data.objective_canvas.stage` | `POST /api/brainstorm/clarify/complete` | user clicks "Done clarifying" |
| `main` | same | `POST /api/brainstorm/sub-objectives/confirm` | user confirms picks |
| `done` | reserved | (unimplemented) | — |

**Side-effects of transitions:**
- `clarifying → picking`: kicks off `void deepPassToDb()` and `void generateInitialAnnotationsForSpace()` (both fire-and-forget, idempotent).
- `picking → main`: materializes picked proposals as `improvement_goals` rows with `parent_goal_id = root.id`, logs one `confirm` decision per pick.
- `add` (post-`main`): `POST /api/brainstorm/sub-objectives/add` inserts more children without changing stage.

**Key:** stage is **space-wide**, not per-sub-objective. There is no per-room lifecycle column — a room either has `room_layers_generated_at` set (generated) or null (not generated).

---

## 3. Full route inventory

### 3.1 `/api/brainstorm/start`
- POST → space + root improvement_goal + fires surface research
- `pipeline_mode` field set from `mode` ("autopilot" vs "human")
- No logDecision

### 3.2 `/api/brainstorm/clarify/*`
| Route | Method | What | logDecision? |
|---|---|---|---|
| `clarify/generate` | POST | LLM-generates 1-5 questions (`mode`: initial/more/regenerate) | No |
| `clarify/answer` | POST | Records one answer (idempotent per `question_id`) | No |
| `clarify/complete` | POST | Stage transition `clarifying → picking`; fires deep research + initial annotation gen | No |

Storage: `spaces.synthesis_data.objective_canvas.clarifying = { questions[], answers{}, generated_at }`. Question shape `{ id, question, rationale, selection: "single"|"multi", options? }`. Answer value clamped to 2000 chars.

### 3.3 `/api/brainstorm/annotations/*`
| Route | Method | What | logDecision? |
|---|---|---|---|
| `annotations/generate` | POST | Phrase annotations on objective text, version "initial" | No |
| `annotations/deepen` | POST | Generates "deepen" version on chosen parent version | No |
| `annotations/synthesize` | POST | Synthesizes two versions into a new merged version | No |
| `annotations/versions` | GET | Reads version history for UI | — |

Storage: `improvement_goals.annotations` (current snapshot, JSONB array) + `improvement_goals.annotations_versions` (JSONB array of versioned snapshots, capped ~10). Generator types: `initial | deepen | synthesis`. Each annotation `{ phrase, start_offset, end_offset, note, linked_sub_objective_id, layer_tag }`.

### 3.4 `/api/brainstorm/research/*` (space-scoped, brainstorm tier)
| Route | What | Persists to |
|---|---|---|
| `research/surface` | Surface-level synthesis | `spaces.surface_research` |
| `research/deep` | Targeted deep research | `spaces.deep_research` |
| `research/full` | Full synthesis | `spaces.synthesis_data.full_research` |
| `research/status` | Polling for async jobs | — |

### 3.5 `/api/pipeline/research/*` (space-scoped, pipeline tier — background)
| Route | Purpose |
|---|---|
| `pipeline/research` | Main orchestrator |
| `pipeline/research-schedule` | Scheduling layer |
| `pipeline/research-deep` | Deep branch |
| `pipeline/research/adversarial` | Adversarial probing |
| `pipeline/research/boundary` | Boundary conditions |
| `pipeline/research/cycle-close` | Close-out synthesis |
| `pipeline/research/round` | Round orchestration |
| `pipeline/research/triangulate` | Cross-source validation |

All write into `spaces.pipeline_research_state` or related JSONB. None log decisions.

### 3.6 `/api/brainstorm/sub-objectives/*`
| Route | Method | What | logDecision? |
|---|---|---|---|
| `sub-objectives/propose` | POST | LLM proposal generation (modes: initial/regenerate/variant) | Yes on `mode=variant` → action=`generate_batch` w/ batch_intent |
| `sub-objectives/disposition` | PATCH | Pre-confirm preference signal | Yes → action=`elect/reject/defer/clear` (pre-confirm; uses `proposal_id` not entity_id) |
| `sub-objectives/confirm` | POST | Materializes picks as children + stage transition | Yes → action=`confirm` per pick |
| `sub-objectives/add` | POST | Add a single new sub-objective post-main (driven by IncrementalCutLab) | Yes → action=`confirm` (same as batch confirm; `batch_intent` from source batch) |
| `sub-objectives/branch-from-concept` | POST | Spawn child from a cross-space canonical concept; bumps `canonical_concepts.space_count` + `entity_count` | **No (gap — should log)** |
| `sub-objectives/[id]/decisions` | GET | **Lab Notebook feed** (Phase 9) | — |

Batch intent enum: `initial | creative | concrete | contrarian | gap_fill | ambitious | wildcard`.

### 3.7 `/api/brainstorm/space/*`
| Route | Method | What | logDecision? |
|---|---|---|---|
| `space/mode` | POST | Toggle `pipeline_mode` (autopilot ↔ review_each) | No |
| `space/constraints` | GET/POST | Read (auto-infer if empty) / write user overrides | No |
| `space/cluster-sub-objectives` | POST | LLM theme-clusters child goals on the main canvas | No |
| `space/analysis/scan` | POST | Auto-run all 5 Tier 1 analyses | No |
| `space/analysis/run` | POST | Run one Tier 2/3 analysis by key | No |
| `space/analysis/disposition` | PATCH | Set finding `open/acknowledged/resolved/dismissed` | **No (silent — gap)** |
| `space/analysis/sub-branch/sub-objective` | POST | Distill a theme finding into a NEW child sub-objective | TBD (should log) |
| `space/brief/polish` | POST | Optional polish layer for Strategy Brief | No |

### 3.8 `/api/brainstorm/room/*`
| Route | Method | What | logDecision? |
|---|---|---|---|
| `room/generate` | POST | Generate room (categories + 3 lanes + cross/within edges) | No (no event emitted — gap) |
| `room/edges/approve` | POST | Approve/revoke one correlation edge | Yes → action=`approve_bet` |

### 3.9 `/api/brainstorm/item/*` (per-entity, room-scoped)
| Route | Method | What | logDecision? |
|---|---|---|---|
| `item/expand` | POST | Generate `expanded_detail` (definition + variations + planning constraints) | No |
| `item/highlights` | POST | Generate 3–5 verbatim phrase highlights on definition | No (stateless, no persist) |
| `item/research` | POST | Tavily + LLM distill into `entities.detail_research` | No |
| `item/expansion/spawn` | POST | Create child node in `expanded_detail.expansion_tree[]` | No (gap) |
| `item/variation/disposition` | PATCH | Elect/reject/defer/clear a variation | Yes → action=`elect/reject/defer/clear` |
| `item/variation/refine` | POST | R&D loop: propose 3 new IV candidates targeting weakest root cause | Yes → action=`rd_iterate` |
| `item/variation/score` | POST | Monte Carlo + placebo refutation on feature lift vs pain | Yes → action=`score` |
| `item/variation/prototype` | POST | Generate 2-3 sentence prototype brief per (variation × open_question) | No (gap) |
| `item/variation/prototype/status` | **PATCH** | Update brief lifecycle status: `planned | running | concluded | abandoned | null`, optional `result_summary` when concluded | **No (gap — user state transition)** |
| `item/compose` | POST | Synthesize ≥2 elected variations into ComposedDesign | Yes → action=`compose` |

---

## 4. logDecision coverage matrix

This is the heart of the Lab Notebook's coverage. **Phase 9 added 6 new action types but only 4 of them are actually fired by code.**

### 4.1 Action types declared in `ALLOWED_ACTIONS` (decision-log.ts)
- `elect`, `reject`, `defer`, `clear` — **fired** from `item/variation/disposition` AND from `sub-objectives/disposition`
- `generate_batch` — **fired** from `sub-objectives/propose` (variant mode only)
- `confirm` — **fired** from `sub-objectives/confirm` (one per pick)
- `rd_iterate` — **fired** from `item/variation/refine`
- `score` — **fired** from `item/variation/score`
- `approve_bet` — **fired** from `room/edges/approve`
- `compose` — **fired** from `item/compose`
- `autopilot_run` — **NEVER FIRED** ⚠️
- `autopilot_iteration` — **NEVER FIRED** ⚠️

### 4.2 Operations that should log but don't (gaps)
| Operation | Recommended action | Why it matters for notebook |
|---|---|---|
| `room/generate` (initial + regenerate) | `room_generated` | Most important room-lifecycle event; without it, the notebook never sees the room being born |
| `item/expand` | `item_expanded` (or finer-grain `variations_generated`, `definition_generated`) | First time variations show up — major learning moment |
| `item/expansion/spawn` | `expansion_spawned` | New L3+ node added; reflects deepening of the workspace |
| `item/research` | `item_researched` | External evidence pulled in |
| `item/variation/prototype` | `prototype_briefed` | Step toward action / handoff |
| `item/variation/prototype/status` (PATCH) | `prototype_status_changed` w/ status + result_summary | Lifecycle change (planned→running→concluded/abandoned) — major signal |
| `space/analysis/scan` | `analysis_scanned` | Cross-room signal refresh |
| `space/analysis/run` | `analysis_ran` w/ `operation_key` | User-initiated cross-room inference |
| `space/analysis/disposition` | `finding_acknowledged` / `finding_dismissed` / `finding_resolved` | User curatorial choices on findings |
| `space/analysis/sub-branch/sub-objective` | `theme_distilled` | New room spawned from cross-room theme |
| `space/constraints` (POST) | `constraints_set` | Affects all downstream gen |
| `clarify/answer` | `clarifying_answered` | The first user signal of intent — currently invisible to notebook |
| `clarify/complete` | `stage_clarifying_complete` | Stage transition is invisible |
| `annotations/generate` / `deepen` / `synthesize` | `annotations_versioned` | Background lens-changes affect future generation |
| `cluster-sub-objectives` | `themes_clustered` | Theme structure formed on main canvas |
| **Autopilot client-side loop** | `autopilot_run` (start) + `autopilot_iteration` per chain | **Scaffold exists in ALLOWED_ACTIONS, never wired** |
| `sub-objectives/branch-from-concept` | `concept_branched` | Cross-space spawn |

### 4.3 Notebook ALLOWED_ACTIONS list vs. fired actions

The GET endpoint in `sub-objectives/[id]/decisions/route.ts` validates against this list:
```
elect, reject, defer, clear,
generate_batch, confirm,
rd_iterate, score, approve_bet, compose,
autopilot_run, autopilot_iteration
```

That's **12 declared, ~10 actually fired**. The two declared-but-never-fired are the autopilot ones. The notebook UI knows how to render them (`visualFor` switch covers them) but they will never appear because no code emits them.

---

## 5. Persistence map (where each operation writes)

| Operation | Target | Shape note |
|---|---|---|
| Space create | `spaces` row | One per user objective |
| Root goal | `improvement_goals` row, `parent_goal_id=null` | One per space |
| Child goals | `improvement_goals` rows, `parent_goal_id=root.id` | N per space, materialized at confirm |
| Clarifying Q&A | `spaces.synthesis_data.objective_canvas.clarifying` | JSONB slice |
| Sub-objective proposals | `spaces.synthesis_data.objective_canvas.sub_objectives` | JSONB slice w/ batches[] |
| Cluster themes | `spaces.synthesis_data.sub_objective_themes` | JSONB w/ proposals_hash for cache |
| Annotations | `improvement_goals.annotations` + `annotations_versions` | JSONB on root goal |
| Constraints | `spaces.synthesis_data.constraints` | JSONB |
| Surface research | `spaces.surface_research` | JSONB |
| Deep research | `spaces.deep_research` | JSONB |
| Pipeline research | `spaces.pipeline_research_state` (or similar) | JSONB |
| Cross-room analysis findings | `spaces.synthesis_data.cross_room_analysis` | JSONB w/ state_hash + findings[] |
| Strategy brief | `spaces.synthesis_data.strategy_brief` | JSONB (or computed on-demand) |
| Strategy brief polish | `spaces.synthesis_data.strategy_brief_polish` | JSONB w/ state_hash |
| Room categories | `improvement_goals.room_categories` | JSONB on the child goal |
| Room lane labels | `improvement_goals.room_lane_labels` | JSONB |
| Top negative outcome | `improvement_goals.top_negative_outcome` | text |
| Room-gen marker | `improvement_goals.room_layers_generated_at` | timestamp |
| Entities | `entities` rows | `parent_sub_objective_id` scopes to room |
| Causal chain (per-entity) | `entities.causal_chain` | JSONB |
| Expanded detail (variations, etc.) | `entities.expanded_detail` | JSONB — **kitchen sink** |
| Cross/within-layer edges | `edges` rows | `dimension="causal"` vs `"structural"` |
| Edge approval | `edges.approved_at` | timestamp |
| Item research | `entities.detail_research` | JSONB |
| Variations | `entities.expanded_detail.variations[]` | JSONB array |
| Effectiveness envelope | `entities.expanded_detail.effectiveness_envelope` | JSONB |
| Composed design | `entities.expanded_detail.composed_design` | JSONB |
| Expansion tree | `entities.expanded_detail.expansion_tree[]` | JSONB |
| Prototype briefs | `entities.expanded_detail.prototype_briefs[]` | JSONB |
| Canonical concepts (per entity) | `entities.expanded_detail.canonical_concepts[]` | JSONB |
| Decisions log | `sub_objective_decisions` rows | Phase 9: has `sub_objective_id` column |

**Key takeaway:** persistence is **JSONB-heavy**. Only 5 true relational tables in play (`spaces`, `improvement_goals`, `entities`, `edges`, `sub_objective_decisions`). Everything else lives inside `synthesis_data` or `expanded_detail` blobs.

---

## 6. Cross-Room Analysis Workbench (full anatomy)

Cross-room is **inside** the Objective Canvas (per user scope) — it lives on the main canvas page above the room grid.

### 6.1 The 8 analyses (2 tiers, 3 if Tier 3 ever used)

Tier 1 (auto, deterministic, free) — run by `/scan`:
1. `shared_mechanisms` — features that appear in multiple rooms
2. `annotation_overlap` — annotations that span sub-objectives
3. `orphan_annotations` — annotations not yet picked up by any room
4. `pain_coverage` — pains addressed in 0/1 rooms (bottlenecks)
5. `duplicate_variations` — near-identical variations across rooms

Tier 2 (on-demand, LLM) — run by `/run` with `operationKey`:
6. `distill_concepts` — surface canonical themes recurring across rooms
7. `recommend_next_move` — advisor: what should the user do next
8. `cross_room_contradictions` — features that contradict each other across rooms

Tier 3 (declared in `tier: 1|2|3` typedef, no instances found yet) — reserved.

### 6.2 Finding shape (`AnalysisFinding`)
```
{
  id, analysis_key,
  category: friction | redundancy | gap | bottleneck | priority | structure | theme,
  severity: critical | high | medium | low | info,
  tier: 1 | 2 | 3,
  title, summary, body: { … per-analysis-key shape },
  references: { room_ids[], item_ids[] },
  disposition: open | acknowledged | resolved | dismissed,
  generated_at
}
```

### 6.3 UI surface (`analysis-workbench.tsx`)
- **Strip** — always visible, single line, counts by category + last-scan timestamp + rescan button
- **Panel** — expanded view with tabs per category, Findings list, Operations list
- **Auto-scan on mount** if no cached analysis (Tier 1 only, cheap)
- **Disposition** is set silently (optimistic update + PATCH; no logDecision)
- **Theme findings** (`distill_concepts`) have a "Distill into sub-objective" button → spawns a NEW child goal via `/sub-branch/sub-objective` and navigates to it
- **Recommend findings** (`recommend_next_move`) show next_steps + effort + what_youll_learn inline

### 6.4 Persistence
- All findings live in `spaces.synthesis_data.cross_room_analysis = { state_hash, scanned_at, findings[] }`
- Findings array is **monotonically growing** until manually dismissed — there's no cleanup; old findings can stack up
- `state_hash` is what gates cache invalidation: when room/item state changes, hash changes, scan re-runs

### 6.5 Gaps in cross-room
- **No logDecision for findings.** A user can dismiss 20 findings and the notebook will be silent.
- **No `theme_distilled` event** when a theme becomes a new sub-objective.
- **No undo path** for dispositions (would require either logDecision events with reversibility or a dedicated audit column).

---

## 7. Autopilot (critical finding)

**Autopilot is a client-side React component** (`autopilot-runner.tsx`), not a server-side orchestrator.

### 7.1 What it actually does
```
chains.forEach(chain => {
  fetch /api/brainstorm/item/variation/score  ({ entityId: chain.featureId })
  if (ok) fetch /api/brainstorm/item/variation/refine ({ entityId: chain.featureId })
})
```

The underlying routes each log a decision (`score`, `rd_iterate`) so the notebook **does** see the work being done. But it sees it as a sequence of individual events, not as **"the user ran autopilot at 3:04pm and it touched 5 chains."**

### 7.2 Dead scaffold
- `autopilot_run` and `autopilot_iteration` are in `ALLOWED_ACTIONS` and the notebook has `visualFor` switches that render them
- **No code anywhere fires either action**
- The Autopilot Runner component has `onChainComplete` and `onAllComplete` callbacks but they only bump a `refreshSignal` on the parent — no backend write

### 7.3 What to do
- Easy fix: have AutopilotRunner POST to `/api/brainstorm/sub-objectives/[id]/autopilot/start` (new route) which logs `autopilot_run` with `metadata.chain_count`, then logs `autopilot_iteration` per chain via a follow-up. Or simpler: a single `autopilot_run` event at start, and let the existing `score`/`rd_iterate` events represent the iterations (notebook can group them by proximity to the autopilot_run timestamp).
- The notebook would then render an autopilot run as a parent group with the individual score/rd_iterate as children — much cleaner story.

---

## 7b. Derived / aggregator UI surfaces (no new operations, but worth knowing)

These surfaces don't introduce new write operations — they **read** existing state and present it. Worth cataloguing because the chat agent will want to call into the same data they derive from.

| Surface | File | Altitude | What it reads | What it surfaces |
|---|---|---|---|---|
| **DecisionSurface** (per-item) | `decision-surface.tsx` | Item drawer body | This item's `expanded_detail` (conflicts, staleness, friction findings, pending dispositions) | One row per CATEGORY (conflict / stale / friction / pending) — scroll to relevant drawer section |
| **CanvasDecisionSurface** (main canvas) | `canvas-decision-surface.tsx` | Main canvas | `computeRoomDecisionSummaries()` over all rooms in space | One row per ROOM with pending decisions, sorted by severity (conflict > friction > pending), links to room |
| **CrossRoomSignalsStrip** | `cross-room-signals-strip.tsx` | Main canvas | `synthesis_data.cross_room_analysis.findings` (structural patterns) | Surfaces structural patterns ("look at this") — sibling to CanvasDecisionSurface ("do this here") |
| **ConceptMemoryFeedStrip** | `concept-memory-feed-strip.tsx` | Main canvas | User's whole-KG canonical concepts by recent activity (cross-space) | Top concepts as ambient chips → open CanonicalConceptDrawer |
| **IncrementalCutLab** | `incremental-cut-lab.tsx` | Main canvas | Variant-lab backend (same as picker) | Add ONE more sub-objective post-confirm via `/propose mode=variant` → `/add`, stage stays `main` |
| **ExperimentsLibraryView** | `experiments-library-view.tsx` | Dedicated route (cross-workspace) | All prototype briefs across all the user's spaces, joined w/ status | Index of every experiment with filters by status / domain / workspace. Status mutated via `PATCH /api/.../prototype/status` |
| **AutopilotRunner** | `autopilot-runner.tsx` | Room view top chrome | Local — no backend reads | Client-side loop over chains; fires score+refine per chain (see §7) |
| **AnnotationCompareModal** | `annotation-compare-modal.tsx` | Modal over root canvas | `improvement_goals.annotations_versions` | Diff/compare two annotation versions — chooses parents for synthesize |
| **StrategyBriefView** | `strategy-brief-view.tsx` | `/app/objective/[id]/brief` route | `synthesis_data.strategy_brief` + `strategy_brief_polish` | Read-only deliverable; polish-on-click |
| **WorkspaceLibraryCard** | `workspace-library-card.tsx` | Cross-workspace home | Multi-space index | Library card render per workspace |

**Key implication for chat agent:** the agent should be able to call functions that mirror these aggregators (`computeRoomDecisionSummaries`, `listExperiments`, `relatedConcepts`) so when the user asks "what's next?" or "where are my conflicts?", the agent can pull from the same derived state, not just the raw decision log.

---

## 8. Current Phase 9 Lab Notebook coverage

### 8.1 What it shows today
Action types rendered by `visualFor` in `lab-notebook-panel.tsx`:
- `elect`, `reject`, `defer`, `clear` (variation dispositions)
- `rd_iterate`, `score` (R&D experiments)
- `approve_bet` (chain bets)
- `compose` (synthesis)
- `generate_batch`, `confirm` (legacy picker activity that pre-dates room scope)
- `autopilot_run`, `autopilot_iteration` (dead — see §7)

Filter chips: All / Experiments / Elections / Bets.

### 8.2 What it can't show even with the current schema
Because these operations don't log decisions:
- Room generation (the "birth" of every room)
- Item expansion / first variations appearing
- Item research being run
- Item highlights being generated
- Expansion tree spawn
- Prototype brief request
- Cross-room finding acknowledged / resolved / dismissed
- Cross-room scan refreshed
- Constraints set or updated
- Clarifying question answered or skipped
- Annotation version created
- Stage transition (clarifying → picking → main)
- Theme distilled into new sub-objective
- Sub-objective added post-main

### 8.3 What it can't show even with logging added (structural limits)
- Room scope: notebook is keyed on `sub_objective_id`, but events like clarifying answers, annotation versions, stage transitions belong at the **space** level (no sub-objective yet). A space-scoped notebook view doesn't exist.
- Cross-room scope: Analysis findings are space-level, not room-level. Surfacing them in a single room's notebook is awkward.
- Background work: research routes complete async; SSE infrastructure (`pipeline_run_events`) exists but isn't wired into Objective Canvas routes. No real-time feed today.

---

## 9. What's there vs. what's missing

### 9.1 ✅ There and working
- Phase 9 decision-log schema with `sub_objective_id` scoping
- Cursor-paginated GET endpoint with action filtering
- Server-side enrichment (entity names, variation names, chain labels)
- 10 of the 12 action types actually fired by code
- Right-edge slide-in panel with day-grouped timeline + filter chips
- Cross-Room Analysis Workbench (strip + expanded panel) — complete UI
- Autopilot runner client component with cancel/reset
- Sub-objective propose with 7 batch intents
- 3-stage versioned annotation pipeline (generate/deepen/synthesize)
- Strategy Brief builder + polish layer with state-hash staleness
- Expansion tree closed-loop with cross-room `distill_concepts` (informs L3+ generation)
- Composition staleness detection (3-tier: local + upstream + recursive)
- Brief staleness detection
- Soft-fail patterns throughout (no single LLM failure crashes the flow)

### 9.2 ⚠️ There but weak / incomplete
- **`autopilot_run` / `autopilot_iteration` actions are declared but never fired.** Scaffold without wiring.
- **Notebook is room-scoped only.** No space-scoped view for pre-room or cross-room events.
- **No real-time updates.** Notebook fetches on open; if user runs autopilot in background, panel won't refresh.
- **No event emission to `pipeline_run_events`.** SSE infrastructure exists, Objective Canvas doesn't use it.
- **Cross-room finding dispositions are silent.** No audit trail of which user discarded which finding.
- **Cluster-sub-objectives runs silently.** Theme structure forms on the canvas with no event.
- **Constraints changes are silent.** Constraints feed all downstream LLM gen but nothing records when they change.
- **Stage transitions are silent** except for `confirm` which logs per-pick (not as a stage event).
- **Findings array grows unboundedly.** No cleanup of resolved/dismissed findings.

### 9.3 ❌ Missing entirely
- No "talk to the canvas" / agent chat surface yet
- No HCD toggle (declared as Phase 11 in roadmap)
- No HTML/JSX prototype interface generation on mechanism expansion (Phase 12)
- No Prompt Library deliverable surface (Phase 13)
- No revert / undo capability for any decision
- No diff view between annotation versions (only a list)
- No "what did autopilot do" parent-grouping in the notebook
- No way to query the notebook by entity ("show me everything that happened to this mechanism")
- No outbound event stream (Slack/email/webhook) for user-curated milestones
- No event compaction (e.g., 5 rapid `elect/reject` on the same entity could collapse to one summary event)

### 9.4 🚨 Risks / smells
- **`entities.expanded_detail` is a kitchen-sink JSONB blob.** Mutations are `{...existing, ...patch}` spreads. Concurrent edits (autopilot + manual click) could race, though single-user context makes this unlikely.
- **`synthesis_data` is also a kitchen sink** — constraints, clarifying, sub_objectives, cross_room_analysis, strategy_brief, strategy_brief_polish, sub_objective_themes all coexist. Risk of conflicting writes between routes.
- **Soft-fail can mask broken behavior.** Example: `room/generate` returns success even if `linkCorrelations` produces 0 edges. The room renders empty chains, user is confused, no logs.
- **No structural events** = no way to reconstruct what happened from logs alone if a user reports a bug.
- **`recommend_next_move` returns advice with no follow-through capture.** User reads the recommendation, takes the action, but the notebook can't connect "user did X because the advisor said to."
- **Annotation provenance pointed at items** (`entities.causal_chain.derived_from_annotations`) is **not invalidated** when annotations change. Stale.
- **`pipeline_runs` table is unused for Objective Canvas.** That infrastructure has SSE + 500ms DB poll + persist-then-emit rule (per project memory) but no canvas route writes to it.

---

## 10. Notebook design implications

### 10.1 The user's stated goal
> Make the lab notebook linked to the agent that manages context across all the rooms / layers / expansions and wires the system together. The user puts in their prompt initially and it shows up on the lab notebook and is queryable / the user can talk to the notebook.

This means the notebook is **not just an audit log** — it's the **conversational interface** to the whole canvas's history. The agent has to:
- Reconstruct what's happened (read events + read current state)
- Answer questions (e.g., "why did you reject that variation?", "what's the latest on Pain X?")
- Take actions (fire /refine, /score, /disposition, /compose on the user's instruction)
- Surface what's worth attention next (using `recommend_next_move` as a substrate)

### 10.2 What the notebook needs to capture
Tier A — **must-have** for the chat agent to be useful:
- Stage transitions (clarifying → picking → main)
- Initial space prompt (recorded once, surfaced as the conversation root)
- Clarifying questions + user answers
- Sub-objective proposals + user picks
- Room generation events (with entity counts per layer)
- All current decision-log actions (already there)
- Cross-room finding dispositions
- Theme distilled → new sub-objective

Tier B — **important** for richness:
- Item expansion (first variations generated)
- Expansion tree spawn (deepening)
- Prototype brief generation
- Constraints set/changed
- Autopilot run start + completion (currently scaffold-only)
- Cross-room analysis scan/run

Tier C — **nice-to-have**:
- Annotation version events
- Cluster-themes formed
- Research events (item-level only; space-level is too noisy)
- Definition highlights

### 10.3 Architecture options
**Option A — Add logDecision calls to every Tier A/B route.**
- Pro: minimal infrastructure change, reuses Phase 9 substrate
- Con: notebook is still keyed on `sub_objective_id`; needs a space-level companion view for pre-room events
- Effort: ~600-900 lines (route changes + new actions + visualFor cases)

**Option B — Synthesize the notebook from artifact timestamps + decision log.**
- Pro: no need to backfill log events; reconstruct events from `created_at`, `generated_at`, `scanned_at`, etc.
- Con: harder to filter, harder to add per-event metadata, more compute on read
- Effort: ~400-600 lines (synthesizer module + UI updates) but with limited richness

**Option C — Hybrid (recommended).**
- Add logDecision calls for **user-driven** events (Tier A explicit choices) and a few critical system events (room_generated, expansion_spawned).
- Synthesize background/system events from artifact timestamps when shown in chat context but not in the strict timeline.
- Keep the strict timeline as "things the user did or asked for"; let the chat layer pull from artifact state separately.
- Effort: ~700-1000 lines.

**Option D — Pipeline events SSE.**
- Wire Objective Canvas routes into the existing `pipeline_runs` / `pipeline_run_events` SSE infrastructure.
- Pro: real-time updates, supports background autopilot, conforms to project locked-in architecture (`project_event_bus_architecture.md`).
- Con: Bigger change. Have to decide what counts as a "run" (the whole canvas? per room? per autopilot session?).
- Effort: ~1200-1800 lines.

### 10.4 Recommended phased approach
- **Phase 10a — Bootstrap events.** Add logDecision calls to the Tier A operations. Update ALLOWED_ACTIONS + visualFor. Wire AutopilotRunner to emit `autopilot_run` start. (~600 lines)
- **Phase 10b — Space-scoped notebook view.** Lift the panel from sub-objective-only to support a space-level mode (pre-room events). Add an "All rooms" toggle. (~400 lines)
- **Phase 10c — Chat surface.** Add a `talk to notebook` mode: chat input that goes to an agent endpoint, agent reads current state + recent events, responds + optionally fires tool calls back into canvas routes. (~900 lines)
- **Phase 10d — Pipeline events SSE (later).** Convert key routes (room/generate, autopilot, analysis/scan) to emit through `pipeline_run_events` so the panel can live-update. (~600 lines)

### 10.5 UI design considerations
- **Hierarchical grouping.** Notebook should collapse rapid sequences (5 rapid elects on the same entity → one summary row "elected 5 variations of X").
- **User vs system events.** Differentiate visually — user actions look like chat turns, system events look like inline tools-fired-by-agent notations.
- **Per-entity drill-down.** Click an entity name → filter the notebook to events touching that entity.
- **Per-chain drill-down.** Same for chains.
- **Real-time refresh.** At minimum poll on visibility-change + after any panel-fired action. Later, SSE.
- **Revert / undo capability.** Lift Phase 10 scope from MVP — flagged for a future phase.

---

## 11. Phase 10 lock-ins (decided 2026-05-27)

| # | Decision | Implication |
|---|---|---|
| **L1** | **Event scope**: user choices + key system events | Add ~12 new actions: `room_generated`, `item_expanded`, `prototype_status_changed`, `finding_acknowledged`, `finding_dismissed`, `finding_resolved`, `theme_distilled`, `concept_branched`, `constraints_set`, `stage_transitioned`, `expansion_spawned`, `autopilot_run` (rewire). |
| **L2** | **Refresh model**: poll on panel open + after panel-fired actions | No SSE in MVP. Re-fetch after every panel-fired mutation. ~150 lines simpler than SSE. SSE can be retrofitted in Phase 10d. |
| **L3** | **Panel shape**: timeline-first, chat as side action | Phase 9 timeline stays as the main surface. Chat input bar sits in the panel chrome (sticky). Click an event = filter timeline; type a question = chat turn. Lowest UX delta. |
| **L4** | **Notebook scope**: room-only panel + new "All rooms" tab on main canvas | Current per-room panel unchanged. NEW: space-scoped variant rendered on the main canvas page showing pre-room (stage transitions, clarifying, picking) + cross-room (workbench dispositions, theme distillations) + summarized per-room highlights. Needs a new GET endpoint scoped by `space_id`. |
| **L5** | **Revert capability**: deferred (not MVP) | No `reverted_at` column. Most actions are inverse-firable (un-elect via `disposition=null`). If a user wants to undo, they fire the inverse via chat agent (L7) or the existing UI. |
| **L6** | **Autopilot wiring**: bundled into Phase 10a | `AutopilotRunner` POSTs to a new `POST /api/brainstorm/sub-objectives/[id]/autopilot/start` route that writes one `autopilot_run` event with `{ chain_count, chain_ids[] }`. Subsequent `score`/`rd_iterate` events for those chain ids are visually grouped under the parent in the notebook UI. |
| **L7** | **Agent tool surface**: read + safe writes | Tools the chat agent can fire: `disposition` (elect/reject/defer/clear), `score`, `refine` (rd_iterate), `item/research`, `space/constraints` POST, `space/analysis/disposition` (acknowledge/dismiss). **Cannot fire:** `approve_bet`, `compose`, `room/generate`, `sub-objectives/confirm`, `add`, `branch-from-concept`, `regenerate` modes. Hard wall — those need explicit user clicks. |
| **L8** | **Chat persistence**: per sub-objective room (and per space for the canvas thread) | New table `notebook_messages` keyed on `(sub_objective_id NULL allowed, space_id, message_id)`. Stores user + agent turns + tool-call records. Room view loads thread by sub_objective_id; canvas view loads by space_id. Survives reloads. |

### Derived Phase 10 plan (post-lock)

**Phase 10a — Event scope expansion** (~600-700 lines)
- Extend `DecisionAction` union with the 12 new actions
- Extend migration: bump CHECK constraint, add `decision_scope` column = `room|space|cross_room` (or use `sub_objective_id IS NULL` to mean space-scoped)
- Wire logDecision calls into the 12 unwired routes
- Wire AutopilotRunner to POST a new `/api/.../autopilot/start` route that logs `autopilot_run` with `chain_count` + `chain_ids[]` metadata
- Update notebook GET endpoint's `ALLOWED_ACTIONS` + `visualFor` switch in the panel

**Phase 10b — Space-scoped notebook view** (~300-400 lines)
- New GET `/api/brainstorm/space/[spaceId]/decisions` endpoint (same enrichment pattern as the room one)
- New panel mount point on main canvas (`/app/objective/[spaceId]/page.tsx`)
- "All rooms" tab in the room view that routes to the same space-scoped panel
- Server-side rollup of per-room counts so the All-rooms view shows summaries, not raw rows

**Phase 10c — Chat surface** (~800-1000 lines)
- Chat input bar in the notebook panel chrome (sticky at top — L3)
- POST `/api/brainstorm/notebook/chat` — agent endpoint
  - Reads: recent decisions (paginated like §3.6), current state (entities + edges + findings + composed_designs scoped to room/space), chat thread history
  - Returns: assistant turn + optional tool calls
- New migration: `notebook_messages` table — `{ id, user_id, space_id, sub_objective_id NULL allowed, role: user|assistant|tool, content, tool_call?, tool_result?, created_at }`
- Tool surface per L7:
  - `disposition` — elect/reject/defer/clear a variation
  - `score` — fire score on a feature
  - `refine` — fire R&D iteration on a feature
  - `research` — fire item-level research
  - `set_constraints` — write constraints (with confirmation flag in agent turn)
  - `analysis_disposition` — acknowledge/dismiss a finding
  - Hard wall on: approve_bet, compose, room/generate, confirm, add, branch-from-concept, regenerate
- Agent context window:
  - Recent N events (default 30) from decision log
  - Current room state (entities w/ name + variations summary + composed_design.conflicts_open)
  - Cross-room workbench findings (open + acknowledged only)
  - Last 10 chat turns from `notebook_messages`

**Phase 10d — Real-time (deferred)** — retrofit SSE via `pipeline_run_events` later. Will require routes to call `emitPipelineEvent` after `logDecision`.

All 8 critical questions are now locked (see §11 lock-in table). No remaining blockers for Phase 10a.

### Remaining sub-decisions (can be made during implementation)

- **Tool-call confirmation UX** — for write tools like `set_constraints` or `disposition` on many items at once, does the agent confirm in-turn ("I'll mark these 5 as deferred — proceed?") or fire-and-explain ("Done. I marked 5 as deferred.")? Lean toward fire-and-explain for single actions, in-turn confirm for batches ≥3.
- **Notebook event ordering when summarized** — when the "All rooms" view rolls up per-room highlights, does it interleave by time or group by room? Lean interleaved.
- **Chat agent model** — Claude vs OpenAI vs current LLM wrapper. Reuse existing `llmJSON()` plumbing where possible.

---

## 12. Glossary

- **Objective Canvas** — the high-level feature; one space → one root improvement_goal → N children (sub-objectives) → per child a "room" with pain/mechanism/outcome entities
- **Room** — workspace view for one sub-objective; has 3 lanes (pain / features / outcomes) + chains between them
- **Chain** — a (pain × feature × outcome) triplet linked by causal edges; rendered as a Category Card (Phase 7a/d)
- **Variation** — a candidate version of a mechanism (feature); lives in `entities.expanded_detail.variations[]`
- **Disposition** — a user's choice on a variation: elect / reject / defer / clear
- **Composed design** — synthesis of ≥2 elected variations into one design (`compose` action)
- **Expansion tree** — hierarchical sub-nodes deepening one item; lives in `expanded_detail.expansion_tree[]`
- **Cross-Room Analysis Workbench** — strip + panel on main canvas surfacing findings across sibling rooms
- **Finding** — one signal from a cross-room analysis (e.g., a friction, a redundancy, a recommended next move)
- **Pipeline run / pipeline event** — separate SSE infrastructure (per project memory), not currently wired into Objective Canvas
- **Stage** — space-level state: clarifying / picking / main / done (last unimplemented)
- **Annotation** — phrase-level lens on the root objective text; versioned generate/deepen/synthesize loop
- **Batch intent** — flavor of sub-objective proposal generation: creative / concrete / contrarian / gap_fill / ambitious / wildcard
- **Strategy brief** — read-only deliverable composing the canvas's outputs; cached by state-hash; optional polish layer

---

## 13. Confidence

After this audit pass: **~98% on operations inventory** (revised up from 95% after closing the remaining gaps).

### Closed in this pass
- ✅ `sub-objectives/add` logs `action="confirm"` (verified)
- ✅ `decision-surface` + `canvas-decision-surface` are NOT parallel impls; they're sibling concepts at item-drawer vs main-canvas altitudes — both **derived** (no new ops)
- ✅ `incremental-cut-lab` is a thin wrapper that calls propose+add (no new ops needed)
- ✅ `experiments-library-view` is a real cross-workspace prototype browser; status mutated via the prototype/status PATCH which has 4 states + null
- ✅ `concept-memory-feed-strip` is a cross-space concept viewer (no writes)
- ✅ `pipeline_run_events` IS used by **pipeline-tier** research routes (e.g., `/api/pipeline/research`) but NOT by brainstorm-tier or any room/item route inside Objective Canvas

### Remaining ~2% uncertainty
- Exact `body` shape per analysis_key (each is `Record<string, unknown>` per `types.ts`; per-file enumeration would close it but only matters if the chat agent needs structured access)
- Annotation pipeline touches `canonical_concepts` indirectly (via the proposal generator's prior-concepts lookup) but not directly — confirmed by reading `annotations/generate`

### Newly confirmed in this last pass
- ✅ `sub-objectives/branch-from-concept` does NOT log a decision — **new gap.** The route bumps `canonical_concepts.space_count` and `entity_count` server-side but writes nothing to `sub_objective_decisions`. Add an action like `concept_branched` with metadata `{ canonical_code, prior_entity_count }`.
- ✅ `computeRoomDecisionSummaries(args: { subs, entities, crossRoomAnalysis? }) → RoomDecisionSummary[]`. Each summary: `{ sub_objective_id, sub_objective_title, conflict_count, friction_count, pending_strong_count, total_signal, top_category: "conflict"|"friction"|"pending"|null }`. Filters: friction-shaped categories only (friction/gap/bottleneck), critical+high severity only, open+acknowledged disposition only. Rooms with 0 signal are dropped.
- ✅ Analyses receive `user_intent_preferences` from decision-log (per `CrossRoomState.user_intent_preferences?: IntentPreference[]`). **There's a closed loop:** user decisions → preference profile → influences future cross-room analysis output. This is a richer surface than I had appreciated.
- ✅ Analysis modules carry their own `trigger: "auto_on_scan" | "on_demand"` so the orchestrator routing isn't a hardcoded list — it's a discoverable property on each module.

These last bits are now all closed enough for Phase 10 design.

---

## 14. Changelog

- **2026-05-27** Initial draft after Phase 9 ship. Captures pre-room, room, per-item, cross-room operations + Phase 10 design substrate.
- **2026-05-27 (later same session)** Folded in: experiments-library-view (cross-workspace prototype browser), concept-memory-feed-strip, both decision surfaces (item + canvas altitudes), incremental-cut-lab, prototype/status PATCH lifecycle (4 statuses + null), verified `sub-objectives/add` logs `confirm`, verified pipeline-tier research emits `pipeline_run_events` while brainstorm-tier doesn't.
