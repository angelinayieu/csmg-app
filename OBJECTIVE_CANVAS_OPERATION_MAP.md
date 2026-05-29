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

## 16. Phase 11+ lock-ins (decided 2026-05-27, post-10b)

Architectural collapse to **three surfaces**: room · notebook+chat (always-open right rail) · Lab page (utility-first tables). Plus a canvas-wide autopilot trigger that pre-populates the substrate so chat has data to talk about.

| # | Decision | Implication |
|---|---|---|
| **M1** | **Notebook is a persistent right rail (default open, 380px), not a slide-in modal** | Lift mount from page to `app/objective/[spaceId]/layout.tsx`; collapse to 32px strip via caret; state persisted in `localStorage` keyed by spaceId. Mobile (≤1100px) keeps current slide-in modal pattern. |
| **M2** | **Canvas-wide autopilot is one button on main canvas** | New `CanvasAutopilotRunner` iterates sub-objectives sequentially → for each, runs existing score+refine per chain. Logs ONE parent `autopilot_run` event with `scope: "canvas"` + sub_objective_ids[]. Per-room score/rd_iterate events log as normal. Cancellable. Auto-fires `/api/brainstorm/space/analysis/scan` on completion so cross-room findings refresh. |
| **M3** | **Default evaluation tier is Tier 2 (rubric), not Monte Carlo** | New `score-rubric.ts`. 5 criteria: plausibility, addresses_pain, constraint_fit, novelty, risk. Single LLM call per variation. Saves ~3s × N variations on every room creation. MC fires on demand only (chat tool or Lab page button). |
| **M4** | **Universal `MethodBadge` component renders alongside every score** | Single file `~/components/objective/method-badge.tsx`. Emoji + tier label + optional ± band. Used in cards, notebook rows, drawer, Lab page. Variations get `evaluation_method` field. |
| **M5** | **Lab page is a route, not a modal** | `/app/objective/[spaceId]/sub/[subId]/lab/[entityId]`. URL-addressable. Tables only — Indicators · Evidence · Simulation · Variation Diff · Actions. No charts. |
| **M6** | **Cards summarize; Lab page elaborates** | Category card body height capped. No expanded card view. No inline indicator lists. Mechanism name + method badge + score chip + "Open Lab" link. |
| **M7** | **Chat agent has 8 tools max** (per L7 in §11) | score_mechanism, score_per_indicator, open_experimentation_room, propose_real_test, set_disposition, set_constraints, research_item, acknowledge_finding. Hard wall on approve_bet, compose, room/generate, confirm, add, branch-from-concept. |
| **M8** | **Notebook chat persistence: same `notebook_messages` table, keyed by scope** | `(space_id, sub_objective_id NULL allowed, message_id)`. Per-room chats keyed on sub_objective_id; canvas chats keyed on space_id alone. |
| **M9** | **Cross-room agent conversations reuse the same chat surface** | In space mode, the chat reads space-scoped events + cross-room analysis findings + per-room state. No separate cross-room chat surface. |
| **M10** | **Method badges proliferation rule: emoji + score + ± band, no color shouting** | Single emoji set: 🧠 Heuristic · 📋 Rubric · 📚 Evidence · 🎲 Simulated · 🧪 Tested. Restrained typography. Tables only for deeper data. |

### Final outcome criteria (post-Phase-14)

A user landing on the canvas MUST be able to:
- See the notebook already open on the right
- Click "Autopilot all rooms" and watch live progress + events populate
- Ask chat any cross-room question and get specific (not generic) answers
- See a method badge next to every score, everywhere
- Click any score → open the Lab page → see indicator + evidence + sim tables
- Toggle HCD and get persona-aware scoring
- Generate an HTML/JSX mockup via chat
- View the prompt library + positioning section in the Strategy Brief

### Phase 11+ build plan (sequenced)

| Phase | Scope | Lines | Status |
|---|---|---|---|
| **10c** *(in progress, parallel chat)* | Chat surface + 8 tool calls + `notebook_messages` table | ~900 | 🟡 |
| **11.0** | Always-open notebook rail + Canvas Autopilot Runner | ~450 | ⏳ |
| **11.1** | MethodBadge + `evaluation_method` field + Tier 2 rubric scorer | ~350 | ⏳ |
| **11.2** | Lab page route (5 tables) + agent `open_experimentation_room` tool | ~600 | ⏳ |
| **11.3** | Per-indicator scoring + Tier 3 evidence-grounded scorer | ~550 | ⏳ |
| **12** | HCD toggle + persona generation + persona-aware rubric | ~250 | ⏳ |
| **13** | Mockup generation tool callable from chat | ~300 | ⏳ |
| **14** | Prompt library tab in Lab page + Positioning section in Strategy Brief | ~150 | ⏳ |

Critical path (core UX): **10c → 11.0 → 11.1 → 11.2** = ~2300 lines.

---

## 17. Phase 12.A lock-ins — Causal System Map (decided 2026-05-27)

The architectural pivot from "grid of sub-objective cards" to "multi-altitude causal system visualization." Locks the central design principle: **the main canvas IS a causal system map, not a list of items grouped by themes**.

### One-paragraph summary

Multi-altitude visualization with consistent visual grammar across four zoom levels: **Canvas** (layered causal graph of sub-objectives positioned by `layer_ordinals` Y-axis) → **Room** (CLD of pain/feature/outcome with mediator nodes) → **Item** (comparison matrix of variations × criteria + mockup iframe + prompt) → **Variation** (full-screen mockup detail). Uses React Flow as the graph primitive, ELK.js + Dagre for auto-layout, framer-motion for shared-element zoom transitions. Health overlay, loop detection via Tarjan's SCC, polarity coloring, layer-band positioning all rendered as first-class signal. Chat agent gets 4 new tools for narrating + manipulating the map. Live refresh via the existing decision-log change-signal pattern. Cards-grid view retained as toggle for users who prefer linear browse.

### 17.1 Lock-in decisions

| # | Decision | Implication |
|---|---|---|
| **N1** | **React Flow** as graph primitive, NOT Cytoscape / D3 | React-first, custom node types easy, smaller bundle |
| **N2** | **ELK.js** (canvas altitude — layered) + **Dagre** (room altitude — LR) for layout, wrapped behind `useLayoutAlgorithm` hook | Right algorithm per altitude, swappable |
| **N3** | **URL-based altitude state**, NOT global store | Shareable links, browser back/forward works |
| **N4** | **Cards view kept indefinitely as toggle** alongside Map view | No user flow gets broken by rollout |
| **N5** | **Per-user `causal_map_state`** (collapsed clusters, pinned layers, toggle states) | Two users on same canvas can have independent views |
| **N6** | **Auto-layout default; user pins override** via `improvement_goals.canvas_position` | Most users don't manually position; pins available for power users |
| **N7** | **Health overlay is opt-in toggle**, not always-on | Reduces visual density when user just wants to browse |
| **N8** | **Loop detection runs client-side** via Tarjan's SCC | Real-time recompute as edges change; no server round-trip |
| **N9** | **Edge polarity** from `edges.polarity` (existing) + `agent_feedback.layer_reach.cross_layer_movements[].verb` (Phase 11.4) | Reuses existing data; no new enrichment |
| **N10** | **Chat agent tools are READ-PRIMARY** (highlight, focus) + write via `chain_proposed` only with user confirm | Map is the user's; agent narrates but doesn't restructure without consent |

### 17.2 Migration

```sql
-- supabase/migrations/20260902_phase_12a_causal_map.sql

-- 1. Optional user-pinned positions on canvas-altitude nodes. NULL =
--    use auto-layout. Set = override for that node only.
alter table public.improvement_goals
  add column if not exists canvas_position jsonb;
  -- Shape: { x: number, y: number, pinned_at: ISO } | null

-- 2. Per-(user, space) view state. Composite PK; RLS-scoped to user.
create table if not exists public.causal_map_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  -- Shape: {
  --   altitude: "canvas" | "room" | "item",
  --   focused_node_id: string | null,
  --   collapsed_layers: number[],
  --   pinned_loops: string[],
  --   show_health_overlay: boolean,
  --   show_inactive_edges: boolean,
  -- }
  updated_at timestamp with time zone default now(),
  primary key (user_id, space_id)
);

alter table public.causal_map_state enable row level security;
create policy "Users manage their own map state"
  on public.causal_map_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Extend decision-log CHECK with 4 new map-interaction action types.
alter table public.sub_objective_decisions
  drop constraint sub_objective_decisions_action_check;

alter table public.sub_objective_decisions
  add constraint sub_objective_decisions_action_check
  check (action in (
    -- ... all 29 existing actions through Phase 11.A ...
    'map_view_changed',         -- zoom / pan / altitude switch
    'loop_highlighted',         -- agent or user surfaced a detected loop
    'node_pinned',              -- user dragged a node to a custom position
    'chain_proposed'            -- user drew an inter-sub-objective edge
  ));
```

### 17.3 Architecture — three orthogonal axes

**Axis 1 — Altitude (zoom levels, C4-inspired):**

| Altitude | Route | What renders | Primitive |
|---|---|---|---|
| **L0 Canvas** | `/app/objective/[spaceId]` | Sub-objectives as nodes, positioned by `layer_ordinals` on Y. Edges = cross-room causal influences. | React Flow + ELK layered + horizontal layer bands |
| **L1 Room** | `/app/objective/[spaceId]/sub/[subId]` | Pain / feature / outcome / mediator nodes for this room's chains. | React Flow + Dagre LR |
| **L2 Item** | `/app/objective/[spaceId]/sub/[subId]/lab/[entityId]` | Comparison matrix of variations × criteria + indicators + mockup iframe + prompt | Tables + iframe (Lab page extension) |
| **L3 Variation** | `/app/objective/[spaceId]/sub/[subId]/lab/[entityId]?v=variationId` | Full-screen mockup, prompt, indicator scores | Modal-style overlay |

Zoom is **smooth** (framer-motion shared-element via `layoutId`), NOT a hard page nav. URL changes drive state for shareability.

**Axis 2 — Visual grammar (consistent across altitudes):**

| Primitive | Visual | Meaning |
|---|---|---|
| Node | Rounded rectangle, lane-colored border | An entity (sub-obj / pain / feature / outcome / variation / mediator) |
| Outgoing arrow → | Directed line, polarity-colored | Causal effect: A → B means A influences B |
| Polarity (+/−) | Green / red arrow tint | + same-direction, − opposite-direction |
| Edge thickness | 1-4px gradient | `chain_strength` × placebo_verdict × disposition |
| Loop annotation | R (orange ring) / B (purple ring) on detected SCC | Reinforcing / Balancing feedback loop |
| Layer band | Faint horizontal stripe (canvas altitude only) | Layer ordinal positioning |
| Health overlay | Traffic light on node border | `chain_strength` + disposition + coverage aggregate |
| Mediator | Small pill on the edge | Variable that moderates the chain |
| Delay marker | `\|\|` symbol on arrow | Temporal lag |
| Method badge | `📋 0.71` chip in node corner | `evaluation_method` from existing MethodBadge |

**Axis 3 — Health overlay (toggleable):**

| Source | Visual | Read from |
|---|---|---|
| Node health | Border traffic-light | `chain_strength` of inbound + outbound edges |
| Edge confidence | Opacity gradient | `agent_feedback.chain_strength` |
| Disposition state | Inner glow (green=elected, red=rejected, gray=deferred) | `variations[].disposition` |
| Layer coverage gap | Pulsing border on uncovered layers | `analyses/layer-coverage.ts` findings |
| Empirical signal | 🧪 badge | `evaluation_method === "tested"` |
| Recent activity | Brief flash | New `score` / `rd_iterate` event within last 30s |

### 17.4 Visual mockups (reference)

**L0 — Canvas Altitude (the main whiteboard):**

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◀ Canvas        Layout: ▼ Layered   Health: ●   Loops: 2  ▣ Cards     │
├────────────────────────────────────────────────────────────────────────┤
│ ░░░░ L5 OUTCOME ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│         ┌──────────────────┐         ┌──────────────────┐              │
│         │ 📊 Goal Track    │←·······→│ 💰 Monetization  │              │
│         │ ⚡0.78 · 5L mat. │   R     │ ⚡0.64 · 2L map. │              │
│         └────────┬─────────┘         └────────┬─────────┘              │
│                  │ produces                   │ measures              │
│ ░░░░ L4 BEHAVIORAL ░░░░░░░░░░░│░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░░ │
│         ┌──────────────────┐    │    ┌────────▼─────────┐              │
│         │ 🎯 Goal Align Tool│    │    │ 🔍 Search Intent  │              │
│         │ ⚡0.71 · L3→L4    │   ←┘    │ ⚡0.52 · L4 dir.  │              │
│         └────────▲─────────┘         └──────────────────┘              │
│                  │ enables                                             │
│ ░░░░ L3 COGNITIVE ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│         ┌──────────────────┐         ┌──────────────────┐              │
│         │ 🧠 Attention Reg │═══─Q──→│ 👥 Community Eng │              │
│         │ ⚡0.85 · L3 dir. │amplifies│ ⚡0.43 · L4 dir. │              │
│         └────────▲─────────┘         └──────────────────┘              │
│                  │ depends on                                          │
│ ░░░░ L2 NEUROBIOLOGICAL ░░░░░░░░  ⚠ uncovered                       │
│ ░░░░ L1 FOUNDATIONAL ░░░░░░░░░░░  ⚠ uncovered                       │
│                                                                        │
│  R · Reinforcing loop: Attention Reg ⇌ Goal Track ⇌ Search Intent     │
│  ⚠ 2 layers uncovered — agent suggests proposing L1/L2 sub-objectives │
└────────────────────────────────────────────────────────────────────────┘
```

**L1 — Room Altitude (sub-objective CLD with mediators):**

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◀ Canvas > Attention Regulation        Layout: ▼ Causal Loop          │
├────────────────────────────────────────────────────────────────────────┤
│                              [mediator]                               │
│                          ┌─ Adherence ≥80% ─┐                          │
│                          ▼                  ▼                          │
│  ┌──────────────┐  amplifies   ┌──────────────┐  produces  ┌────────┐  │
│  │ 🔴 Distraction│←───────────│ 🔵 Pomodoro  │───────────→│🟢 Focus│  │
│  │  Overload    │   counters  │  Time-Boxing │  L3→L4    │  Min   │  │
│  └──────┬───────┘             └──────┬───────┘            └───┬────┘  │
│         └─────────── closes ─────────┴─────── ⚡ 0.78 ─────────┘        │
│                       (B balancing loop)                              │
└────────────────────────────────────────────────────────────────────────┘
```

**L2 — Item Altitude (comparison matrix + inline mockup + prompt):**

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◀ Canvas > Attention Regulation > Pomodoro     Method: 📋 Rubric      │
├────────────────────────────────────────────────────────────────────────┤
│ INDICATORS MATRIX                                                     │
│                  Sustained   Interrupt   Deep Work    Composite       │
│  Classic 25/5      0.85        0.82        0.40         0.78           │
│  Adaptive Sess.    0.78        0.65        0.70         0.71           │
│  Hard 50/10        0.55        0.45        0.85         0.58           │
│  Indicator conf.   0.85        0.75        0.40 (shaky) —              │
│                                                                        │
│ MOCKUP                              EXPORT PROMPT                     │
│ ┌──────────────────────┐            ┌──────────────────────┐           │
│ │ [iframe srcDoc=HTML] │            │ # Pomodoro Spec       │           │
│ └──────────────────────┘            └──────────────────────┘           │
└────────────────────────────────────────────────────────────────────────┘
```

### 17.5 Component file tree

```
src/components/objective/causal-map/
  ├── CausalMap.tsx                    // top-level orchestrator
  ├── altitudes/
  │     ├── CanvasAltitudeMap.tsx       // L0
  │     ├── RoomAltitudeMap.tsx         // L1
  │     ├── ItemAltitudeMatrix.tsx      // L2
  │     └── VariationAltitudeDetail.tsx // L3
  ├── nodes/
  │     ├── SubObjectiveNode.tsx
  │     ├── PainNode.tsx
  │     ├── FeatureNode.tsx
  │     ├── OutcomeNode.tsx
  │     ├── VariationNode.tsx
  │     └── MediatorNode.tsx           // edge-decoration node
  ├── edges/
  │     ├── CausalEdge.tsx              // polarity-colored arrow
  │     ├── LoopEdge.tsx                // R/B annotated
  │     └── CrossLayerEdge.tsx          // dotted, spans bands
  ├── overlays/
  │     ├── HealthOverlay.tsx
  │     ├── LayerBands.tsx
  │     └── ActivityPulse.tsx
  ├── controls/
  │     ├── AltitudeBreadcrumb.tsx     // Canvas > Sub > Room > Item > Var
  │     ├── ViewToggle.tsx             // map / cards / matrix
  │     ├── HealthOverlayToggle.tsx
  │     └── LoopHighlighter.tsx        // sidebar listing detected loops
  ├── hooks/
  │     ├── useLayoutAlgorithm.ts      // ELK / Dagre wrapper
  │     ├── useLoopDetection.ts        // Tarjan's SCC
  │     ├── useHealthAggregation.ts    // per-node health from edges
  │     ├── useMapState.ts             // reads/writes causal_map_state
  │     ├── useRealtimeRefresh.ts      // listens for refresh signals
  │     └── useZoomTransition.ts       // framer-motion shared-element
  └── lib/
        ├── graph-build.ts             // entities + edges → React Flow shape
        ├── tarjan-scc.ts              // strongly-connected components
        ├── loop-classify.ts           // R vs B based on polarity product
        └── visual-grammar.ts          // colors, sizes, shapes constants

src/lib/objective-canvas/causal-map/
  ├── load-canvas-graph.ts             // server-side graph loader
  ├── load-room-graph.ts
  ├── compute-cross-room-edges.ts      // from cross_room_analysis findings
  └── types.ts

src/app/api/brainstorm/space/[spaceId]/causal-map/
  ├── route.ts                         // GET full canvas graph
  ├── pin-node/route.ts                // POST user-dragged position
  └── state/route.ts                   // GET/POST causal_map_state CRUD
```

**~30 new files. ~2300-2800 lines.**

### 17.6 Build sequence

| Phase | Scope | Lines | Critical path? |
|---|---|---|---|
| **12.A.1** | Migration + types + visual grammar + React Flow setup | ~400 | ✅ |
| **12.A.2** | Canvas-altitude Layered Causal Graph (nodes + edges + ELK layout + layer bands + loop detection + health overlay) | ~700 | ✅ |
| **12.A.3** | View Toggle on main canvas (Cards / Map) so the new view is opt-in | ~80 | ✅ |
| **12.A.4** | Room-altitude CLD (pain/feature/outcome/mediator nodes + Dagre LR) | ~500 | ✅ |
| **12.A.5** | View Toggle in room view (Categories / Variables / Causal Loop) | ~50 | |
| **12.A.6** | Item-altitude comparison matrix (Lab page extension: matrix + mockup iframe + prompt inline) | ~400 | |
| **12.A.7** | Smooth zoom (framer-motion shared-element transitions) + breadcrumb | ~250 | ✅ |
| **12.A.8** | Map state persistence (`canvas_position` + `causal_map_state` CRUD) | ~200 | |
| **12.A.9** | Live refresh hook (`useDecisionLogSignal` — subscribes to existing decision-log polling) | ~150 | ✅ |
| **12.A.10** | Chat agent map tools (`highlight_loop`, `propose_chain`, `pin_layer`, `focus_node`) + system prompt extension | ~250 | |
| **12.A.11** | Notebook event wiring (4 new actions + visualFor + chips) | ~150 | |
| **12.A.12** | Supabase Realtime channel subscription (optional, defer) | ~150 | |

**Critical path to user-visible MVP: 12.A.1 → A.2 → A.3 → A.4 → A.7 → A.9 = ~2080 lines.** Lands the layered causal graph + zoom + live refresh + Cards toggle.

### 17.7 Files touched (modifications)

```
src/components/objective/main-canvas-view.tsx        // add view toggle, mount CausalMap
src/components/objective/sub-objective-room-view.tsx // add view toggle for room CLD
src/app/app/objective/[spaceId]/sub/[subId]/lab/[entityId]/page.tsx  // extend with matrix + mockup
src/lib/objective-canvas/decision-log.ts             // add 4 new action types
src/lib/objective-canvas/notebook-events.ts          // extend meta with map state fields
src/app/api/brainstorm/sub-objectives/[id]/decisions/route.ts  // ALLOWED_ACTIONS + meta passthrough
src/app/api/brainstorm/space/[spaceId]/decisions/route.ts      // ALLOWED_ACTIONS + meta passthrough
src/components/objective/lab-notebook-panel.tsx      // visualFor + System filter for new actions
src/lib/objective-canvas/notebook-chat.ts            // add 4 new agent tool definitions
src/app/api/brainstorm/notebook/chat/route.ts        // agent system prompt + tool dispatch
```

### 17.8 New npm dependencies

```json
"reactflow": "^11.x",      // graph rendering — React-first, custom nodes
"elkjs": "^0.9.x",         // layered auto-layout — for canvas altitude
"dagre": "^0.8.x"          // LR auto-layout — for room altitude
```

All three MIT-licensed, used in production by major tools.

### 17.9 Coordination with existing systems

**Refresh signals the map subscribes to:**

| Source | When | What invalidates |
|---|---|---|
| `useDecisionLogSignal` | Notebook fetches new events | All map data hooks |
| `router.refresh()` | Layout-level forced refresh | Server-side props re-fetch |
| Canvas autopilot `onAllComplete` | After autopilot finishes | Re-fetch chain_strength + variations |
| Chat agent tool result | After agent fires score / disposition / refine | Re-fetch the specific entity |
| Layer regeneration | After `/layers/generate?mode=regenerate` | Re-fetch canvas graph + reposition |
| Picker confirm | After `/sub-objectives/confirm` | Add new node to canvas |

**Specific event-to-invalidation mapping:**

| Event | Invalidates |
|---|---|
| `score` decision | Node health on the feature's parent sub-objective |
| `rd_iterate` decision | Variations list at item altitude |
| `chains_enriched` | All edges (re-compute thickness + loop detection) |
| `layers_generated` | Whole canvas (reposition on new layer stack) |
| `confirm` (sub-objective added) | Add new node to canvas |
| `approve_bet` | Edge style on the chain |
| `disposition` | Variation node coloring at item altitude |

**Map-emitted events (logged to notebook):**

| User action | Notebook event | Visible in agent context |
|---|---|---|
| Zoom to room | `map_view_changed` | Agent knows current altitude |
| Click loop annotation | `loop_highlighted` | Agent can explain the loop |
| Drag a node | `node_pinned` | Agent notes user's spatial preference |
| Draw inter-sub-obj edge | `chain_proposed` | Agent reviews + suggests persistence |
| Toggle health overlay | `map_view_changed` w/ subaction | Agent knows what user is reading |

### 17.10 Agent integration — 4 new tools

| Tool | Args | Effect |
|---|---|---|
| `highlight_loop` | `{ loop_id }` | Pulses loop's nodes + edges; pans/zooms to fit |
| `propose_chain` | `{ from_sub_id, to_sub_id, polarity, rationale }` | Draws proposed cross-room edge; user confirms to persist |
| `pin_layer` | `{ layer_ordinal }` | Collapses other layers; focuses on one |
| `focus_node` | `{ node_id }` | Pans/zooms map to center this node |

Agent system prompt extension:

```
MAP AWARENESS:
You can read the current map state — the user's currently-focused node,
detected loops, layer coverage, recent events. When answering "what
should I focus on?" questions, reference SPECIFIC nodes + loops by
name. Never give generic strategic advice when concrete map state is
available.

When the user asks "why does X loop exist?", explain the polarity flow
explicitly — count negatives, identify the type.

When you fire focus_node or highlight_loop, narrate it in the message
so the user knows what's happening on the map.
```

### 17.11 Anti-patterns

| Don't | Why |
|---|---|
| Use force-directed layout at canvas altitude | Layer stack needs deterministic positioning. ELK layered is the right algorithm. |
| Render mockups as full screenshots at canvas altitude | Performance killer + visual noise. Mockups only at L3. |
| Auto-pan on every refresh | Disorienting. Only pan on explicit user focus / zoom. |
| Try to put all 4 altitudes in one giant graph | Cognitive overload. C4 zoom is the answer. |
| Hide the cards view | Many users prefer linear browse. Toggle, don't replace. |
| Couple to a specific layout engine | Wrap ELK + Dagre behind `useLayoutAlgorithm` for swappability. |
| Persist node positions globally | Per-user via `causal_map_state` — different users have different mental maps. |
| Render edges from EVERY analysis finding | Threshold by severity (high+critical only) to keep canvas readable. |
| Fire decision-log events for every micro-interaction | `map_view_changed` debounces 500ms — only emit settled state. |
| Re-fetch entire graph on every signal | Field-level invalidation via React Query / SWR with granular keys. |

### 17.12 Edge cases

| Scenario | Behavior |
|---|---|
| Empty canvas (no sub-objectives) | Map renders empty layer bands + "Confirm sub-objectives to populate the map" placeholder |
| Pre-Phase-11.A space (no layer stack) | Falls back to force-directed layout WITHOUT layer bands; chip: "Generate layers to enable layered view" |
| Pre-Phase-11.4 chains (no enrichment) | Edges render with NEUTRAL coloring; chip: "Enrich chains for polarity + strength" |
| Pre-Phase-11.6 baselines | Variation nodes show composite only, no indicator breakdown |
| Mobile (≤1100px) | Map degrades to existing card grid; chip: "Map view requires desktop" |
| Huge canvas (>30 sub-objectives) | Viewport culling + cluster auto-collapse |
| Real-time refresh while user is panning | Defer invalidation until pan settles |
| Two users on same canvas in real-time | Each user has independent `causal_map_state`; map content same; pin positions per-user |
| Loop detection fails (race) | Render without loop annotations; show "Loops re-computing…" chip |
| Auto-layout fails | Fall back to grid layout; log to console |

### 17.13 Cross-altitude provenance — end-to-end trace

When user clicks a variation's mockup at L3, they should be able to TRACE through every layer that produced it:

```
1. Mockup at L3      ←ROLLS UP TO— variation card
2. Variation at L2   ←PRODUCES— composite score per indicator (matrix row)
3. Indicators at L2  ←MEASURED FROM— the parent outcome at L1
4. Outcome at L1     ←CHAINED FROM— pain via feature (3-node CLD)
5. Room at L0        ←POSITIONED ON— layer N of the canvas stack
6. Sub-objective L0  ←INFLUENCES— other sub-objectives via cross-room edges
7. Layer L_N         ←DEPENDS ON— layers below it
```

Breadcrumb at top of every altitude makes this provenance visible:

```
Canvas (Cognition · L1-L5) > L3 Cognitive States > Attention Regulation > Pomodoro > Classic 25/5
                                                                                       │
                                                                                       ▼
                                                                              [mockup preview iframe]
```

Each segment hover-able — hovering shows what THAT altitude's work contributes to the chain.

### 17.14 Migration / mount strategy

Phased rollout to avoid breaking existing flows:

**Stage 1 (12.A.1–A.7):** Map exists as a toggle alongside existing Cards view. Default = Cards. User opts into Map via a top-chrome toggle.

**Stage 2 (12.A.8–A.11):** Map gets its own URL params (`?view=map`), shareable, persisted in `causal_map_state.altitude`.

**Stage 3 (future):** Once usage signals which view users prefer, switch default per-user based on last-used view.

Cards grid never removed — serves real purpose for linear browse + early-stage canvases without enough structure for a map.

### 17.15 The single most important UX moment

First time user clicks `🗺 Map` on the canvas. Three things must happen in <500ms:

1. Cards view fades out
2. Map fades in with sub-objective nodes appearing at their layer positions
3. First detected loop (if any) gets a gentle pulse + chat agent drops a notebook message: "I see one reinforcing loop in your canvas — click R to highlight it, or ask me to explain."

This moment transforms "I'm browsing my work" into "I'm looking at the system I'm building." Everything else in this spec is in service of that landing cleanly.

### 17.16 What this phase locks in (the bigger picture)

The central design principle: **the canvas IS a causal system map.** Once shipped, every existing feature reframes:

- Theme clusters → node groupings on the map
- Chain enrichment → edge thickness + loop detection
- Layer stack → positional Y-axis
- Cross-room analysis → edge palette
- Autopilot → live update stream
- Chat agent → narrator + co-pilot
- Lab page → drill-down for variation altitude
- Notebook → audit trail of map interactions

The map becomes the single VISUAL truth. Other surfaces feed it. Nothing competes for "the main view" anymore.

### 17.17 KG-native enhancements (build MVP first, layer these on)

The Causal System Map MVP (§17.1–17.16) renders the **within-space entity-edge graph** — which IS a knowledge graph (typed nodes + typed edges). But the codebase has KG infrastructure the MVP spec doesn't yet wire in:

| KG component | File | Currently used by map? |
|---|---|---|
| Property graph (entities + edges) | `entities` + `edges` tables | ✅ Yes — it's what the map renders |
| Canonical concept resolution | `src/lib/kg/canonical-concept-matcher.ts`, `canonical-code.ts` | ❌ No |
| Concept lookup (semantic retrieval) | `src/lib/objective-canvas/canonical-concept-lookup.ts` | ❌ No |
| Path-aware calibration | `src/lib/kg/path-aware-calibration.ts` | ⚠️ Indirect (writes `edges.strength`) |
| pgvector embeddings | (entity embeddings) | ❌ No |

**Decision: build the MVP first, layer KG features on after. It's additive, not a restructure — PROVIDED 3 extension seams are baked into the MVP.**

#### The 3 extension seams (cost ~10 lines in MVP, save a refactor later)

1. **`canonicalConceptId` on the node data model** — populate from `entities.canonical_concept_id` even though MVP doesn't render it. When the overlay ships, data already flows.
2. **`source: "local" | "cross_space" | "semantic"` discriminator on the edge data model** — always `"local"` in MVP. Cross-space + semantic edges tag differently later; renderer branches on it.
3. **Open layout registry** — `useLayoutAlgorithm` returns from a named map (`{ layered: elk, force: dagre }`), NOT a hardcoded if/else. Adding `semantic` later = one entry.

#### The 4 KG layers (each a distinct user "aha")

| Layer | Looks like | Makes framework better | Lines |
|---|---|---|---|
| **KG-1 Canonical overlay** | Faint "echo" links between nodes sharing a `canonical_concept_id` + "appears in N rooms" badge. Toggleable. | Surfaces UNINTENTIONAL repetition — user solving same problem in 3 places → consolidate. `canonical-concept-matcher.ts` already computes the matching. | ~120 |
| **KG-2 Cross-space bridges** | Ghost-edges to a "cross-space" cluster at the canvas margin when a sub-obj's concepts match prior work in other spaces. Click → existing CanonicalConceptDrawer. | Turns each canvas from an island into a node in the user's lifetime KG. "You built this mechanism in another space — reuse?" | ~150 |
| **KG-3 Semantic layout** | Third layout option (alongside Layered + Force) positioning nodes by pgvector cosine distance. | Catches semantic duplication LLM theme-labels miss. Embeddings = geometric truth vs LLM judgment. "These 3 cluster within 0.05 cosine — same idea, different words." | ~200 |
| **KG-4 Calibration-weighted edges** | Edge thickness reads `max(chain_strength, calibrated_edge_strength)`. Edges visibly thicken/thin as real outcomes land. | Map evolves from "what the LLM thinks is strong" → "what real outcomes PROVED is strong." Closes prediction→reality loop visually. | ~50 |

#### The compounding insight

The current framework is a single-canvas, single-moment snapshot. KG incorporation makes it: **cross-canvas** (canonical concepts unify across spaces), **temporal** (calibration accumulates outcomes), **semantically grounded** (embeddings beat LLM-label clustering), **self-correcting** (calibration feedback loop).

The flywheel: the canonical-concept KG already feeds `loadRelevantCanonicalConcepts` → which informs sub-objective proposals + layer decomposition + chain enrichment. Every canvas the user builds enriches the KG → makes the NEXT canvas smarter. The KG is the substrate that makes the whole system learn with use. The map just makes it visible.

#### Recommended build order

1. **Phase 12.A MVP** (local entity-edge map) — with the 3 extension seams baked in
2. **KG-1** (canonical overlay) — cheapest, highest aha
3. **KG-4** (calibration edges) — the credibility loop
4. **KG-3** (semantic layout) — needs embedding plumbing in the graph loader
5. **KG-2** (cross-space bridges) — the lifetime-KG moonshot, build once the rest is proven

---

## 18. Knowledge-Graph consolidation plan (deferred — weave in later) (investigated 2026-05-28)

> **Status: PLAN ONLY. No code changes. Deferred until current in-flight work settles.**
> This section is the *infrastructure* layer beneath §17.17. §17.17 = "make the
> Causal Map richer using KG data." §18 = "consolidate the KG infrastructure itself
> into a reusable core + decide the paradigm fork." §18 Track B is the prerequisite
> that gives §17.17's KG-1/KG-3/KG-4 features real data to render.

### 18.0 What triggered this — and the headline finding

Deep read-only audit: ~30 files read **in full** across `lib/{graph, kg, causal-chains, kg-context, entities, weaving, systems, subsystems}` + the objective-canvas KG surface. The audit was prompted by a hypothesis that objective-canvas had *reinvented* the shared KG.

**Headline: that hypothesis is FALSE. Zero true duplicates found.** Four separate "looks like a duplicate" pairs (compute-chains vs propagate; canonical-lookup vs canonical-matcher; cross-room-signals vs community-detection; domain-signature vs domain-detector) ALL turned out to be **different operations on different data contracts** once read. Structural signals (file names, line counts) produced 4/4 false positives. **Lesson baked into the guardrails below: names lie; verify data contracts before ever merging.**

### 18.1 Current-state snapshot (what we're doing right now)

- **In flight / HOT (do not disturb):** Phase 12.A Causal Map (MVP + A.9 live-refresh shipped; **A.4 room CLD + A.7 zoom still remaining**), the new **Strategy Lab** module (`api/strategy-lab`, `app/strategy-lab`, `components/strategy-lab`), and modified objective-canvas surfaces (`chain-card`, `correlation-side-panel`, `main-canvas-view`, `annotated-sub-objective-card`).
- **Genuine redundancies INSIDE the shared KG** (intra-paradigm, real targets): degree-centrality is computed **4 ways** (`hub-discovery`, `preliminary-insights`, `compute-entity-scores`, `force-layout`); there are **two** `community-detection.ts` files (`lib/graph` = label-propagation for viz vs `lib/pipeline` = Newman modularity for GraphRAG).
- **Hygiene bug:** `src/types/database.types.ts` is **stale** — missing `canonical_concept_id`, `causal_chain`, `expanded_detail`, `agent_feedback`, `parent_sub_objective_id` on entities/edges, and the `canonical_concepts` table is absent entirely. Code currently compensates with `unknown` casts.

### 18.2 The two KG paradigms (the core mental model)

| | **Paradigm 1 — space typed graph** | **Paradigm 2 — objective-canvas room graph** |
|---|---|---|
| Tables | `entities` + `edges` | same tables |
| Columns used | typed: `dimension`, `polarity`, `strength`, `confidence`, `centrality_rank` | room-scoped: `parent_sub_objective_id` + JSONB (`causal_chain`, `agent_feedback.mechanism`, `expanded_detail`) |
| Operations | graph algorithms (cascade, community, centrality, layout, calibration) | string/LLM ops (chain composition, enrichment, signal bucketing) |
| Homes | `lib/{graph, kg, causal-chains, kg-context, systems, subsystems, weaving}` | `lib/objective-canvas/*` |
| Consumers | pipeline, twin, canvas, synthesis, predictions, systems | objective-canvas only |
| Imports Paradigm 1? | — | **Zero times** |

Paradigm 1 IS already the de-facto cross-cutting KG base — it's just scattered across 8 folders with **no single front door**. Paradigm 2 is off it **by data-model divergence, not laziness** — its edges carry prose JSONB, not typed `dimension`/`strength`, so `lib/graph` algorithms can't consume them as-is.

### 18.3 The fork decision (OPEN — needs a product call before Track B)

- **Converge:** objective-canvas room entities/edges ALSO populate typed columns + run the canonical write path → inherits all `lib/graph` algorithms for free + feeds §17.17's KG features. High value, data-model change.
- **Stay parallel:** keep objective-canvas a deliberate parallel paradigm; share only read-side infra via the front door. Lower risk, but §17.17 KG-1/3/4 stay **data-starved** (overlays render empty).
- **Recommendation:** converge *incrementally* (Track B) — but only after Tracks A + C, and only after the hot files settle.

### 18.4 Track A — Unify the shared KG behind one front door (SAFE, do soon)

1. Add `src/lib/kg/index.ts` as a **public API that re-exports** existing functions (graph algorithms, canonical resolve, calibration, kg-context, chains). No files move. Additive, reversible.
2. Reconcile the genuine redundancies: 4 centrality copies → one canonical scorer; disambiguate the two `community-detection.ts` (viz vs GraphRAG) by name.
3. Make new modules (**Strategy Lab**) import from the front door instead of forking — this is *why Track A should land before Strategy Lab hardens.*
- **Risk: low.** These are cold files relative to the hot objective-canvas/causal-map area. 30+ consumers of `entities`/`edges` → keep all signatures; additive only.

### 18.5 Track B — Bridge objective-canvas onto the typed graph (HIGH VALUE, STAGED, fork-gated)

At room entity/edge creation, ALSO: (1) run `findOrCreateCanonicalConcept` to link `canonical_concept_id`; (2) populate typed edge columns (`dimension="causal"`, `polarity`, `strength`) alongside the existing `agent_feedback` JSONB. Then the **existing** `lib/graph` algorithms (community detection, centrality, cascade) run over objective-canvas data → the leverage-point + sophisticated-chain quality the user has been asking for.

- **This is the prerequisite that gives §17.17's KG-1 / KG-3 / KG-4 real data** (canonical overlay, semantic layout, calibration edges are empty without it).
- **Touches HOT files** (`enrich-chain`, `room/generate`, `compute-chains`). Must wait for: parallel chat to settle + Phase 11.A migration applied + Track C done + Track A front door existing.
- **Gated on the fork decision (converge).**

### 18.6 Track C — Hygiene: regenerate `database.types.ts` (DO FIRST, anytime)

Regenerate types from the live schema. Removes the `unknown` casts (e.g. `layer-coverage` reading `layer_ordinals`). Low collision (generated file), high safety dividend, unblocks A + B.

### 18.7 Weave-in sequencing (the actual "later" plan)

A timeline that does **not** disrupt current work:

1. **NOW** — no KG-infra changes. Let Phase 12.A (A.4, A.7) + Strategy Lab land. **Apply the Phase 11.A migration to live Supabase** (still pending).
2. **Track C** (regenerate types) — safe, anytime; ideally before A/B so casts disappear.
3. **Track A** (front door + dedupe) — cold-file area, can run *in parallel* with objective-canvas work; land it **before Strategy Lab hardens** so the new module consumes the door.
4. **Fork decision** (user) — converge vs parallel.
5. **If converge → Track B**, staged, AFTER 12.A is stable and the hot files have settled. Then §17.17 KG-1 → KG-4 → KG-3 → KG-2 light up with real data.

### 18.8 Guardrails (carried from the audit)

- **Read-before-merge:** every suspected duplicate gets a full read + a written *same / different / relocate* verdict. (4/4 so far = "different.")
- **Names lie:** shared vocabulary ≠ shared operation. Verify the data contract.
- **Additive front door, zero forced migration, reversible steps.** Never a big-bang.
- **Preserve load-bearing contracts verbatim:** soft-fail (`return []`/`null` on error), concurrency (`INSERT … ON CONFLICT DO NOTHING`), cache invalidation (`state_hash`).
- **Avoid hot files; coordinate with parallel chats.**
- **Full-repo `tsc --noEmit` after each step**, not just touched files.

---

## 14. Changelog

- **2026-05-27** Initial draft after Phase 9 ship. Captures pre-room, room, per-item, cross-room operations + Phase 10 design substrate.
- **2026-05-27 (later same session)** Folded in: experiments-library-view (cross-workspace prototype browser), concept-memory-feed-strip, both decision surfaces (item + canvas altitudes), incremental-cut-lab, prototype/status PATCH lifecycle (4 statuses + null), verified `sub-objectives/add` logs `confirm`, verified pipeline-tier research emits `pipeline_run_events` while brainstorm-tier doesn't.
- **2026-05-27 (session end)** Phase 11.A foundation through chip integration shipped (commits 002e01f, e29c2c8, 0c655d1, 00c953e, e4452b3). 9 of 12 sub-phases (75%): migration + types + decompose-into-layers LLM + endpoints + ObjectiveStack widget + LayerPositionChip + proposer extension + auto-fire trigger + layer_coverage analysis + notebook event wiring. Critical path to "user sees the stack on the picker" complete; A.8/A.9/A.12 deferred (hot files).
- **2026-05-27 (session end)** Added §17 — Phase 12.A Causal System Map spec. Locks the pivot from "grid of cards" to "multi-altitude causal system visualization." 16 sub-decisions (N1-N10 + architecture) + migration + 30 new files spec + critical path (12.A.1→A.2→A.3→A.4→A.7→A.9 = ~2080 lines). React Flow + ELK.js + Dagre + framer-motion. Reuses all existing data substrate (layers, chains, mediators, indicators, mockups) — pure visualization layer over what already exists.
- **2026-05-27 (session end)** Added §17.17 — KG-native enhancements. MVP-first, then layer 4 KG features (canonical overlay / cross-space bridges / semantic layout / calibration-weighted edges) on top via 3 cheap extension seams baked into the MVP data model. Recommended build order MVP → KG-1 → KG-4 → KG-3 → KG-2.
- **2026-05-27 (continued)** Phase 12.A MVP BUILT — the canvas-altitude Causal System Map ships behind a Cards/Map toggle (N4). Decision adjustments vs spec: (a) used installed `@xyflow/react@12` (not `reactflow@11`) + `@dagrejs/dagre` — matches the existing `causal-chains/` React Flow code; (b) deferred ELK.js — dagre covers layered layout, wrapped behind `useLayoutAlgorithm`'s named registry so ELK/semantic drop in later (seam #3); (c) all 3 KG seams baked in (canonicalConceptId on node data, source discriminator on edge data, open layout registry). Files (all NEW, zero collision with the parallel chat): `causal-map/lib/{types,visual-grammar,tarjan-scc,loop-classify,graph-build}.ts`, `causal-map/hooks/{useLayoutAlgorithm,useLoopDetection}.ts`, `causal-map/nodes/SubObjectiveNode.tsx`, `causal-map/edges/CausalMapEdge.tsx`, `causal-map/overlays/LayerBands.tsx`, `causal-map/altitudes/CanvasAltitudeMap.tsx`, `causal-map/CausalMap.tsx`. Modified: `main-canvas-view.tsx` (Cards/Map toggle). Migration `20260902_phase_12a_causal_map.sql` written — PENDING, not applied (map MVP renders from props, doesn't need it). Covers critical path 12.A.1 + A.2 + A.3. Verified: 0 tsc errors + 0 eslint errors in all new/touched files. DEFERRED: A.4 (room CLD), A.7 (framer-motion zoom transitions), A.10 (agent map tools), A.11 (notebook wiring of the 4 new actions).
- **2026-05-28** Phase 12.A.9 BUILT — live refresh. New zero-collision hook `causal-map/hooks/useDecisionLogSignal.ts` polls the EXISTING decision-log feed (`GET .../decisions?limit=1`, watches exact `total` + newest event id) and bumps a monotonic `signal` when a new decision lands. Baseline-on-mount (no spurious refresh), visibility-aware (pauses on hidden tab, re-polls on return), burst-debounced by cadence, soft-fail. Wired into `main-canvas-view.tsx`: enabled only while Map view is active → `router.refresh()` on bump (Cards-view users uninterrupted; no refresh loop since refresh emits no decision). Reusable for the room altitude (pass `subObjectiveId`). 0 tsc + 0 eslint errors. Critical-path MVP now A.1–A.3 + A.9; remaining: A.4 (room CLD) then A.7 (zoom).
- **2026-05-28** Phase 12.A.4 BUILT — room-altitude Causal Loop Diagram. New "Map" view alongside the room's existing Categories / Variables toggle (mounted in `sub-objective-room-view.tsx`, which the parallel session is NOT editing — its room page / lab page avoided to dodge collision). Reads the SAME `lanes` + `edges` props the room already has; checked `room-edges-overlay.tsx` first (an SVG-over-cards layer for the Categories view, NOT a graph — so the CLD is complementary, not a duplicate). Lane-column layout (pain → mechanism → outcome, matching the §17.4 L1 mockup), edges carry polarity + strength + a mediator pill from `agent_feedback.mechanism`, feedback loops detected live (reuses `useLoopDetection`) with a balancing/reinforcing sidebar. New files: `causal-map/lib/build-room-graph.ts`, `causal-map/nodes/RoomItemNode.tsx`, `causal-map/overlays/LaneColumns.tsx`, `causal-map/altitudes/RoomAltitudeMap.tsx` (+ room dims in `visual-grammar.ts`); reused `CausalMapEdge`. 0 tsc + 0 eslint errors (5 room-view warnings are pre-existing). Critical-path MVP now A.1–A.4 + A.9; only A.7 (framer-motion canvas⇄room zoom) remains.
- **2026-05-28** Phase 12.A.7 BUILT — zoom transitions + breadcrumb. **The MVP critical path (A.1→A.2→A.3→A.4→A.7→A.9) is now COMPLETE.** Since framer-motion `layoutId` can't span a Next App-Router navigation (source tree unmounts, server round-trip), implemented a coordinated two-sided zoom instead: (a) `causal-map/hooks/useZoomTransition.tsx` blooms an accent veil out of the clicked sub-objective node (GPU transform scale + opacity flash) then runs the nav; (b) both the canvas + room maps play a scale/opacity landing animation on mount → the canvas→room hop reads as one continuous zoom; (c) `causal-map/controls/AltitudeBreadcrumb.tsx` renders "Canvas › Room" in the room map (Canvas segment pops back). Honors `prefers-reduced-motion` (skips bloom, navigates immediately). Threaded `spaceId` into `RoomAltitudeMap` for the back link; NO room-page edit (collision-safe — the room title isn't a room-view prop, so the breadcrumb stays generic rather than touching the other session's page). New files: useZoomTransition.tsx, AltitudeBreadcrumb.tsx; modified: CanvasAltitudeMap + RoomAltitudeMap. 0 tsc + 0 eslint errors. Phase 12.A status: critical path DONE; deferred non-critical = A.5 (room view-toggle polish — effectively done via the Map option), A.6 (item-altitude matrix), A.8 (persist map state), A.10 (agent map tools), A.11 (notebook wiring of map actions), A.12 (Realtime).
- **2026-05-28** Phase 12.A.8 (client slice) BUILT — view persistence. New SSR-safe `causal-map/hooks/useLocalPref.ts` (renders `initial` on server + first paint, flips to stored value in an effect → no hydration mismatch; mirrors the layout.tsx notebook-rail pattern). Wired: Cards/Map choice per space (`causalmap:view:${spaceId}` in main-canvas-view), health overlay per space (`causalmap:health:${spaceId}` in CanvasAltitudeMap), room view per sub-objective (`room:view:${subObjectiveId}` in sub-objective-room-view). No migration (the server-backed `causal_map_state` table + cross-device sync + pinned node positions wait on the pending migration + interactive drag testing). 0 tsc + 0 eslint errors. NOTE: another session is now co-developing in `causal-map/` — added `MapInsightsPanel.tsx` + `lib/summarize-map.ts` (a synthesis panel reading this phase's graph/types) and imports it in main-canvas-view; verified the COMBINED state (their files + mine) compiles + lints clean (0 errors). The dir is no longer single-owner.
- **2026-05-28** Phase 12.A.10 (foundation) BUILT — URL focus/highlight (the collision-free half of agent map tools). Both altitudes now read `?focus=<nodeId>` (fitView to it once the flow inits, via `useReactFlow().fitView({nodes:[{id}]})`) and `?loop=<loopId>` (applied as the initial highlight) and WRITE the active loop back to the URL via `window.history.replaceState` (pure client update, no nav/refetch) → shareable/bookmarkable focused views, completing the N3 URL-state contract (read + write). Params read from `window.location` (not `useSearchParams`) — safe + lint-clean because both maps mount client-side only (view toggles resolve post-hydration), so `?loop=` is a lazy `useState` initializer (no setState-in-effect, which the repo's `react-hooks/set-state-in-effect` rule errors on). This makes the agent's future `focus_node`/`highlight_loop` tools a plain deep-link — NO chat/notebook-file edits needed now (those are hot + co-owned). Files: CanvasAltitudeMap + RoomAltitudeMap. 0 tsc + 0 eslint. **GATED BOUNDARY REACHED:** remaining Phase 12.A items all need either (a) the pending migration applied to live Supabase — A.8-server (causal_map_state, pinned positions), event emission (the 4 map actions need the CHECK constraint), A.11 notebook wiring; or (b) edits to hot co-owned files (lab page for A.6 item matrix; notebook-chat/route for A.10 agent tools). No safe+unblocked work remains without user authorization (apply migration / commit / coordinate on hot files).
- **2026-05-28** Phase 12.A migration APPLIED to live Supabase (user authorized "apply"). Applied via `apply_migration` (name: phase_12a_causal_map). **Pre-apply reconciliation caught a clobber hazard:** the remote already had the parallel `arc3_1_mechanism_spec_action` migration, which had added `mechanism_spec_generated` to `sub_objective_decisions_action_check`. My `20260902` file (written earlier) omitted it, so a naive apply would have DROPped+re-ADDed the constraint WITHOUT it → breaking the other session's mechanism-spec inserts. Fixed by re-asserting it: the applied constraint is a strict SUPERSET (33 actions = 28 prior + `mechanism_spec_generated` + the 4 map actions). Verified on the remote: constraint contains all 33, `improvement_goals.canvas_position` column present, `causal_map_state` table present with RLS. UNBLOCKS: server-backed A.8 (pinned positions, cross-device state), emission of the 4 map decision events, A.11 notebook wiring. Coordination note for both sessions: the action list lives in 3 places that must stay in sync — the live constraint, `lib/objective-canvas/decision-log.ts` (DecisionAction union), and each decisions GET route's ALLOWED_ACTIONS; future constraint-touching migrations from EITHER session must re-assert the full superset (incl. map actions) or they'll clobber.
- **2026-05-28** Phase 12.A.8-server BUILT — pinned canvas layout (advances the Miro/Figma north star). Drag a sub-objective node to arrange the map; positions persist PER-USER in `causal_map_state.state.pins` (now that the table exists). Chose per-user (N5) over `improvement_goals.canvas_position` (per-goal/shared, N6) specifically to avoid editing the shared `MainCanvasSub`/main page (collision-safe). New files: `api/brainstorm/space/[spaceId]/causal-map/state/route.ts` (GET+PUT, safeAuth + space-ownership + 100KB cap, supabase upsert onConflict user_id,space_id), `causal-map/hooks/useMapState.ts` (async load = lint-clean, debounced 600ms PUT, latestRef mirror). Edited CanvasAltitudeMap (mine): `nodesDraggable`, merge `pins[id] ?? autoLayoutPos` into node positions, `onNodesChange`→`setPin` (position-only; the handler is what makes controlled nodes draggable), "Reset layout" button when pins exist. Scoping decision re: agent work — the other session's `summarize-map.ts` explicitly targets A.10 (agent map-awareness) + powers their `MapInsightsPanel`, so they OWN the agent/insights trajectory; this pinning work is deliberately non-overlapping. 0 tsc + 0 eslint errors. CAVEAT: the drag UX itself (edge rendering mid-drag, snap behavior, per-mousemove re-render cost at >30 nodes) needs an interactive browser smoke-test I couldn't run here — logic + types are verified, runtime feel is not.
- **2026-05-28** Map Insights digest BUILT (zero-collision, while another session shipped A.7 zoom + A.8 view-persistence). New pure `causal-map/lib/summarize-map.ts` (uncovered layers · health distribution · R/B loop counts · strongest cross-room links · one headline recommendation) + `causal-map/MapInsightsPanel.tsx` rendering it beneath the canvas map (mounted via ONE additive line in `main-canvas-view.tsx` — deliberately avoided every zoom-owned file: CanvasAltitudeMap, RoomAltitudeMap, sub-objective-room-view, useZoomTransition, AltitudeBreadcrumb). Self-contained: rebuilds the graph + re-detects loops from the same props the map uses, so it can't disagree with the render. Also the read-substrate for future agent map-awareness (A.10). Verified in-browser via a new `/preflight/map-insights-preview` harness (live canvas is auth-gated): headline correctly flagged L1+L2 uncovered, health 2 strong / 1 weak / 1 unscored, coverage chips L1·L2, 3 entangled-room links correctly directed substrate→outcome. 0 tsc + 0 eslint errors (new files + mount + harness).
- **2026-05-28** Added §18 — KG consolidation plan (DEFERRED, plan-only). Followed a deep read-only audit (~30 files across `lib/{graph,kg,causal-chains,kg-context,entities,weaving,systems,subsystems}` + objective-canvas KG surface). Key finding: **zero true duplicates** — 4/4 suspected duplications were different operations on different data contracts (structural signals gave 4/4 false positives). Codebase has **two KG paradigms**: (1) space-level *typed* graph (entities/edges typed columns + `lib/graph` algorithms, used by pipeline/twin/canvas/synthesis) and (2) objective-canvas *room* graph (same tables, room-scoped JSONB, string/LLM ops, imports paradigm 1 zero times). Plan = 3 tracks sequenced to NOT disturb in-flight Phase 12.A + Strategy Lab: **Track C** regenerate stale `database.types.ts` (do first); **Track A** unify shared KG behind one `lib/kg/index.ts` front door + dedupe genuine redundancies (4 centrality copies, 2 community-detection files) — land before Strategy Lab hardens; **Track B** (fork-gated, high value, hot files) bridge objective-canvas onto the typed-edge contract so existing graph algorithms run on it + §17.17 KG features get real data. Open decision: converge objective-canvas onto the shared graph vs keep parallel.
