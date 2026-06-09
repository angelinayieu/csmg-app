# Crucible Master Plan — Reasoning Ground → Ranked Proposals → Spec → Prototype

> Status: design-locked draft, 2026-06-08. Owner: objective-canvas. Companion memory: `project_crucible_interrogation`.
> This plan consolidates a multi-session design thread. It is deliberately opinionated about **what NOT to build** (the highest-leverage engineering decision here), because the codebase already contains most of the downstream machinery.

---

## 0. Thesis (one paragraph)

A user's hand-drawn mind-map is a better "birds-eye view" than anything the AI currently emits — not because it has better *content*, but because it has the right *form*: an associative concept graph, edges-as-meaning, metadata hidden inside nodes, one convergent apex everything points at. The system already computes the right *substance* (leverage points, first principles, variables, constraints as a real `object_links` graph) but renders it as dense vertical card-fans. **The finalize move is to (a) make the AI's output land as a legible, pruned, pill-based concept graph (the "reasoning ground"); (b) let ranked "proposals" bud off the graph's leverage surface and expand into structured build-specs; and (c) route those proposals into the *existing* SpecForge / decompose / tech-spec / prototype machinery instead of rebuilding it.** One graph, many lenses, one reasoning source, depth-tiered build paths, one shared terminal.

---

## 1. Problem & first principles

Learned from the user's own brainstorm artifacts and a codebase audit:

1. **The edges are the content.** Insight lives in the relationships, not the nodes. A node alone says little.
2. **Metadata belongs inside the node.** The canvas should show a *skeleton* (labels + connections); detail lives behind a click. (Shneiderman: *overview first, zoom and filter, details on demand.*)
3. **There is one convergent apex.** The highest-leverage framing must *cascade* — re-weighting every micro-relationship below it. Today it's computed but filed as "rank 1 in a list"; it does not cascade.
4. **Converge/diverge is a shape, not just a computation.** We compute both (diverge → candidate answers; converge → leverage/first-principle rankings) but never render the funnel.
5. **Simplicity is curation, not cramming.** Surface the conceptually-strong few; collapse the rest. ~12 legible pills, not 30 cards.
6. **Don't build parallel systems.** SpecForge, the light decompose, and Crucible already overlap. The win is consolidation, not addition. (This is the user's stated recurring fear and the single biggest risk.)

---

## 2. Core architecture

### 2.1 One object graph (the reasoning ground)
Everything lives in the existing object layer: `library_objects` (nodes) + `object_links` (edges). Node `object_type` ∈ {`objective`, `first_principle`, `leverage_point`, `variable`, `constraint`, `sub_objective`, `feature`, `concept`, `decision`, …}. This is the **model** — persistent, accreting, reused. It is NOT where build-structure lives.

### 2.2 Three lenses over one graph (NOT three graphs)
Do **not** fork the data into separate "structural" and "causal" graphs (that re-creates the mess). Store one typed node/edge model and render **three lens projections** by filtering edge types + swapping the layout engine:

| Lens | Edges shown | Layout engine | Purpose |
|---|---|---|---|
| **Conceptual** | `relates_to`, `derived_from` | force-directed (cytoscape **fCoSE**) | explore / sense-make — the organic web |
| **Structural** | `feeds`, `depends_on`, `delivers` | layered DAG (**dagre/elk**), rank = abstraction tier | Outcome → Feature → Mechanism → Experiment → Spec |
| **Causal** | causal/`derived_from` (leverage→principle, pain→cause) | layered DAG, rank = causal stage | Pain → Cause → Leverage → Intervention → Result |

Both structural and causal chains **already exist as data** (`layer-model.ts` archetypes; `causal-chains.ts`; `RoomAltitudeMap`; Crucible `leverage_point`/`first_principle`). The missing pieces are (1) the **conceptual lens** + a lightweight `relates_to` edge, and (2) a **lens toggle**. "Don't make one view do everything" = different *layouts* per lens; it does **not** mean different *data*.

### 2.3 The leverage membrane
Model the graph as a cell: **first principles = nucleus** (irreducible roots), variables/connections = cytoplasm, **leverage points = membrane** (the actionable surface — by definition "where to act"). **Proposals bud from the leverage membrane.** Reasoning lives above the membrane; bets live below it. This gives a non-arbitrary boundary between "understanding" and "building."

### 2.4 The depth-tier spine
A "proposal" is **a bet forged at a chosen depth**, all sharing one terminal:

```
EXPLORE  Crucible: dialogue → reasoning graph → leverage + first principles + connections → pick a BET
                                  │ (reasoning computed ONCE)
                                  ▼  "Spec this bet" at a depth (cost-aware choice):
   ┌──────────────┬───────────────────────┬───────────────────────────────┐
   │  SKETCH      │  STANDARD             │  FORGE                          │
   │  ~1 LLM call │  ~3 calls            │  ~20+ engines + critic          │
   │ feature/var  │ lanes → tech-spec    │ SpecForge (full discovery)      │
   │ lanes        │                      │                                 │
   └──────────────┴───────────────────────┴───────────────────────────────┘
                                  ▼
            compose-tech-spec (Opus)  →  prototype (HTML / React-Sandpack)   [SHARED TERMINAL]
```

SpecForge (~20 LLM calls + per-engine critic) is too expensive for every idea; the light `decompose-cards` path (~1 call) is the correct cheap tier. **Both already share `composeTechSpec()`** (it accepts either `forgeContext` or a bare `idea`). The light path is currently *stranded* (its feature/variable cards never auto-reach tech-spec) — fixing that wiring **is** the Standard tier.

### 2.5 Single reasoning source
Leverage, first principles, and constraints must be computed **once** — by Crucible, interactively + web-grounded — and **consumed** by the decompose/SpecForge paths, never recomputed. Today three systems compute overlapping features/leverage independently and can diverge. Collapse to one lineage: **Crucible seeds → decompose/SpecForge elaborates → tech-spec → prototype.**

### 2.6 SpecForge reconciliation (consume, don't duplicate)
SpecForge already does idea → root cause → first principles → product thesis → ranked MVPs → recommended build → mechanisms → data → validation → export. **Do not rebuild any of it.** Instead:
- A **proposal = a SpecForge (or light-decompose) run seeded by a leverage subgraph** + Crucible context.
- SpecForge's `power_up` / `problem_tree` / `convergence` engines **consume** Crucible's leverage/first-principles/constraints as context (cheaper + better-grounded) instead of cold one-shot regeneration.
- What's genuinely new and *not* in SpecForge: the persistent **conceptual graph**, multi-round **dialogue**, web-grounded self-answers, the **connection-ranker** (ranking bridges *across* the graph and *across* bets — SpecForge only ranks MVPs *within* one idea).

---

## 3. Data model

- **Nodes:** `library_objects` rows. Surface = `title` (the pill label, ≤ ~3 words ideal). Everything else (`summary`, `content_snapshot`, scores, rubric breakdowns) is hidden payload.
- **Edges:** `object_links`, `relation` ∈ {`feeds`, `depends_on`, `derived_from`, `validates`, `delivers`} **+ new `relates_to`** (loose associative edge so the AI can express conceptual adjacency, not only causal dependency). `object_type` and `relation` are **free-text in the DB → no migration** for new types/relations.
- **Strength score** (`crucible-strength.ts`, shipped): `0.5·rubric_score + 0.4·graph_centrality + 0.1·novelty − generic_penalty`. Combines LLM judgment with structural load-bearing (degree/fan-out) so compressed self-scores don't fool the ranking.
- **Connection score** (NEW): `betweenness(bridges-N-branches) × endpoint_strength × novelty`. Ranks the *edges*, surfacing cross-branch bridges as first-class.
- **Provenance:** every proposal/spec carries a back-link to the leverage region it budded from (`source_ref`). Every forged spec carries the Crucible context hash so we know it's grounded.

---

## 4. The agent pipeline

| Agent | Role | Status |
|---|---|---|
| **Inquirer** | 1–3 info-gain-ranked Qs/round; tags `user` vs `research`; self-answers facts via web search | ✅ shipped (Phase 1) |
| **Analyst** | classify answers → landscape / solution / constraint; extract variables; running model | ✅ shipped (Phase 1) |
| **Synthesizer (leverage)** | rank 3–6 leverage points (Meadows ×3 · bindingness ×3 · fan-out ×2 · Pareto ×2 · feasibility ×2 · contradiction ×1 → 0–100) | ✅ shipped (Phase 2) |
| **First-principles** | 2–5 irreducible truths (irreducibility ×3 · counterfactual ×3 · necessity ×2 · sufficiency ×2 · 5-whys ×2 · independence ×1) — *the eval metric for "is this a real first principle"* | ✅ shipped (Phase 3) |
| **Roadmap** | coin sub-objectives + seed features from leverage | ✅ shipped (Phase 4) |
| **Connection-ranker** | rank cross-branch bridges; pick which membrane regions warrant a proposal | ❌ NEW (W2) |
| **Apex cascade** | top principle/leverage → re-weights optimization factors → drives every downstream micro | ❌ NEW (W3) |
| **SpecForge feed-forward** | route a bet + Crucible context into SpecForge/light-decompose; consume don't recompute | ❌ NEW (W4) |

Quality guardrail to add (borrowed from SpecForge's per-engine critic + the deep-research adversarial pattern): **the apex + each top connection get an adversarial "is this noise / generic / not actually highest-leverage?" check** — survives only if ≥2 of 3 skeptics fail to refute.

---

## 5. The UI/UX system (top-tier)

Design law (Shneiderman's mantra): **overview first → zoom and filter → details on demand.** Every surface obeys it.

### 5.1 Pill idiom + progressive disclosure
- Node = rounded-pill, **single-line truncated label**, leading 8px type-color dot, optional trailing count badge. **No metadata on the canvas.** Click → side detail panel (the hidden payload). (Linear/Notion density discipline — density is curation, not cramming.)
- Apex pill = filled accent, larger, with a soft halo — the gravitational center.

### 5.2 DOI pruning — "apex + few"
Universal primitive: **Degree-of-Interest** `DOI(node) = intrinsic_strength − distance_from_focus`; elide nodes below threshold; collapse the remainder into a single `+N more` pill. Default budget = **apex + 5** (ruthless), with Apex+3 / Apex+8 / All toggles. (Furnas fisheye / Card–Nation DOI trees; Kumu "walk out step by step.") *Shipped in `crucible-strength.ts` + the `/preflight/crucible-pillmap` harness.*

### 5.3 Semantic-zoom LOD labels
Drive label visibility off the live zoom transform: apex-only labels when zoomed out; progressive reveal + labels-on-hover when zoomed in. This is what keeps it hand-drawn-legible at scale (d3/react-force-graph zoom callback; cytoscape `min-zoomed-font-size`).

### 5.4 Lens switching + layout engines
A 3-way toggle (Conceptual / Structural / Causal) over the same nodes. Conceptual → cytoscape **fCoSE** (organic). Structural & Causal → **dagre/elk** layered DAG with `rank = abstraction/causal tier`. Animate the transition so the user sees the same graph *re-settle* into a new grammar.

### 5.5 Abstraction-gradient canvas — direction is semantic
**Vertical = abstraction → concreteness; lateral = alternatives at the same altitude.** Build it from a layered DAG with a fixed `rank = abstraction tier`. Overlay the **Double-Diamond silhouette**: wide rows where we diverge (explore), narrow rows where we converge (apex). This makes convergence/divergence *visible* — the thing the user's hand-map had and the AI output lacked.

```
  REASONING GROUND   first principles (core) · variables · connections
        │                     ▼  LEVERAGE MEMBRANE  ◄── proposals bud here
        ▼ (down = more concrete)
  PROPOSALS (collapsed pills, fan sideways = ranked alternatives)
        │  expand on demand
        ▼
  STRUCTURE  subsystem lanes (Feature/Variable + flow connectors)  ← the existing image-2 decompose
        ▼
  PROTOTYPE  coded HTML / React
```

### 5.6 Proposal objects
- Collapsed by default: `Proposal: Constellation-first · rank 1 · 86`, connector up to the leverage region it budded from.
- Expand downward → the existing `decompose-cards` lanes (Sketch/Standard) or a SpecForge run (Forge).
- Ranked laterally by the composite ranker (un-orphaned). Depth chosen per bet, cost shown.

### 5.7 Build substrate
- **tldraw** = the canvas engine (we already own custom shapes/bindings) — keep.
- **cytoscape.js (fCoSE)** + **dagre/elk** = *headless* layout solvers; feed computed positions back into tldraw shapes.
- **React Flow patterns** (custom node + typed handles + minimap) = the reference for the structured proposal→build-spec sub-graphs.

### 5.8 Screen coherence — the anti-mess law
The board today accumulates 6–8 floating forks (sharpening · ambiguity heatmap · priority map · resolve pill · exploration · Crucible · brief · decompose lanes). Adding the pill-map as another fork reproduces the exact "too messy / no birds-eye view" problem this project exists to solve. The law:

> **New capability is added as a LENS or OVERLAY on the one reasoning surface — never as a new floating card.**

- The **ambiguity heatmap** and **priority map** stop being cards and become **data-driven decorations** on the single graph (Kumu pattern): ambiguity → node *color*; priority → node *size*. Toggles, not surfaces.
- **Concept / Structure / Cause** are layout lenses (§5.4); **Heat / Size** are decoration overlays. One graph, a row of toggles.
- **One vertical spine:** objective → reasoning frame (lens-toggled) → proposals (collapsed pills) → structural lanes (on expand) → prototype.
- **Stages recede.** Once the Crucible converges, the ambiguity/priority cards are gone (now overlays) and the Q&A collapses into a small "how we got here" rail. Show the current altitude, not every artifact ever produced.
- **Metadata in the right-side panel, never on the canvas.** The canvas shows only labels + connections.

Consequence: this is a **consolidation + deprecation**, not a pure add — it retires the standalone heatmap/priority/resolve-pill cards (reborn as overlays) and re-homes Crucible/brief onto the spine. Several of those are the parallel session's surfaces → coordinate before editing their shape files.

### North stars (what to steal)
- **Obsidian local-graph** — depth-slider "reveal one ring at a time."
- **Kumu.io** — data-driven decorations (size/color from attributes) + Focus mode (walk out step by step).
- **Heptabase** — card lives once, appears on many lens-views (≡ one graph, many lenses).
- **Linear / Notion** — dense-but-calm; metadata behind a panel.
- **Double Diamond** — the diverge-fan → converge-funnel grammar.
- **ComfyUI / Tree-of-Thought** — proposal → executable structured subtask tree → prototype.

---

## 6. Current state (shipped this thread)

- **Crucible Phases 1–4** — interrogation loop (Inquirer/Analyst), leverage synthesis + scoring, first-principles lens + glossary wiring, roadmap (sub-objectives + seed features). State in `synthesis_data.objective_canvas.crucible`; outputs persisted as `library_objects` + `object_links`; no migration.
- **Composed brief seam closed** — `assembleBrief` + brief card now surface sub-objectives + features.
- **Pill-map + strength module** — `crucible-strength.ts` (strength + ruthless prune) and `/preflight/crucible-pillmap` (apex-centered pill renderer, metadata-inside panel, budget control, noise-suppression demo). *Type-clean; not yet rendered live due to a transient dev-server state.*

---

## 7. Workstreams (ranked by leverage)

| # | Workstream | What | Effort | Clobber risk | Coordinate? |
|---|---|---|---|---|---|
| **W1** | **Pill-map → live surface** | graduate the pill renderer + DOI prune onto the KG/cluster surface; add lens toggle (fCoSE/dagre) | M | med (KG render files) | yes (concept-track session) |
| **W2** | **Connection-ranker** | rank cross-branch bridges (betweenness × endpoint × novelty); adversarial apex/connection verify | S | low (extends `crucible-strength`) | no |
| **W3** | **Apex cascade** | top principle/leverage → re-weight optimization factors → drive micros/sub-objs/features | M | high (`prompt_sharpening`, `loadOptimizationFactors`, `derive-micro-objectives`) | yes |
| **W4** | **Spine consolidation** | un-strand light decompose → tech-spec; Crucible context → both decompose & SpecForge (consume, don't recompute); single feature lineage | L | high (`decompose-cards`, `compose-tech-spec`, SpecForge context) | yes |
| **W5** | **Proposal objects + depth tiers** | proposal pills bud from membrane; Sketch/Standard/Forge selector; lateral ranking via composite ranker (un-orphaned) | L | med | yes |
| **W6** | **`relates_to` edge** | loose associative relation so the AI expresses conceptual adjacency | XS | low | no |

**Recommended order:** W2 + W6 first (isolated, additive, answer the open "rank connections" question), then W1 (visual form), then W4 (consolidation — the redundancy killer), then W3 (the cascade), then W5 (proposals).

---

## 8. Open decisions

1. **Provisional mid-loop sub-objectives** — currently only finalized-at-convergence is built; do we surface provisional branches mid-loop? (deferred)
2. **Where proposals render** — same canvas (abstraction gradient) vs a focused sub-surface. Plan recommends same canvas with collapse-by-default.
3. **Depth default** — does "Spec this bet" default to Sketch (cheap) or prompt every time? Plan recommends explicit cost-aware choice.
4. **fCoSE vs dagre boundary** — confirm conceptual=force, structural/causal=layered; revisit if the conceptual web is small enough to also lay out cleanly with dagre.

---

## 9. Verification & guardrails

- **No migrations** for new object types/relations (DB free-text) — keep it that way.
- **tsc --noEmit = 0 errors** is the merge gate (the dev server is flaky under parallel sessions; tsc is authoritative).
- **`/preflight/*`** harnesses for any board UI (auth-gated routes can't render in the preview browser).
- **Parallel-session discipline:** re-check `git`/mtime before editing any shared Crucible/brief/decompose/SpecForge file; prefer new files; never both-edit a hot file.
- **Anti-goals:** do NOT rebuild SpecForge's reasoning; do NOT fork the graph into structural+causal data; do NOT compute leverage/first-principles in more than one place.

---

## 10. Appendix — inspiration references

- Shneiderman, *The Eyes Have It* (overview→zoom→details): https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf
- Furnas, *Generalized Fisheye Views* (DOI): http://csis.pace.edu/~marchese/CS835/Readings/FisheyeOriginalTM.pdf
- Card & Nation, *Degree-of-Interest Trees* (AVI'02): https://faculty.cc.gatech.edu/~stasko/7450/Papers/card-avi02.pdf
- Double Diamond (UK Design Council): https://en.wikipedia.org/wiki/Double_Diamond_(design_process_model)
- Kumu system mapping (focus mode / decorations): https://docs.kumu.io/disciplines/system-mapping
- Obsidian graph: https://obsidian.md/help/plugins/graph
- Heptabase (card-lives-once): https://makerstack.co/reviews/heptabase-review/
- cytoscape.js layouts (fCoSE): https://blog.js.cytoscape.org/2020/05/11/layouts/
- cytoscape.js-dagre (layered DAG): https://github.com/cytoscape/cytoscape.js-dagre
- React Flow custom nodes / handles: https://reactflow.dev/learn/customization/custom-nodes
- react-force-graph (semantic zoom hook): https://vasturiano.github.io/react-force-graph/
- tldraw SDK: https://tldraw.dev/
- Hierarchical edge bundling: https://d3-graph-gallery.com/bundle
- Progressive disclosure (NN/g via IxDF): https://ixdf.org/literature/topics/progressive-disclosure
- ComfyMind (tree-based planning): https://arxiv.org/html/2505.17908v1
```
