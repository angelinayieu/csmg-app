# Specialized Subsystem Knowledge Graphs — spec (written plan)

**Status:** DRAFT / written plan only (no code in this doc — the room
Subsystems re-altitude is being edited in a parallel session; commit
`9680882` already shipped `subsystem-modules-view.tsx` + retired the old
coupling view). This spec is additive and collision-aware; see §9.

**One-sentence thesis:** the whiteboard already renders the *same*
entity/edge graph at four altitudes — the "specialized knowledge graph for
a subsystem component" the user wants is a **fifth SCOPE (a lens), not a
fifth graph engine**: a focused **problem → mechanism → solution** slice of
the data we already have, made first-class so it can be pinned to the
board, wired to sibling slices, and folded into the Library.

---

## 0. What the user asked for (decoded)

> "visualize problem → mechanism → solution as a knowledge graph using the
> viz infra we have… bring it to the whiteboard… the graph's internal
> mechanisms flowchart is hosted inside a canvas/room infra (pls check)…
> a specialized KG for this specific subsystem component… influencing
> other connected KGs branched out of the same whiteboard… collapsed in
> the library."

Five asks, each mapped to existing infra below:

1. **problem→mechanism→solution KG** — already exists as the **Room Map**.
2. **internal-mechanisms flowchart hosted in room infra** — confirmed:
   `mechanism-dataflow-view.tsx` (✅ "pls check" answered, §2).
3. **bring it to the whiteboard** — tldraw ShapeUtil pattern (§5).
4. **influence connected/branched KGs** — produces/consumes tokens +
   `bridges` + the `cross_space` edge seam (§6).
5. **collapse in the Library** — genuine gap; `library_objects` is
   single-card today (§7).

The "3-panel page for synthesizing content into a knowledge graph" the
user remembers building = the **Triple Lab** (`src/components/triple-lab/
triple-lab.tsx`): raw-signal │ d3-force KG │ insights, at the *space*
level. The subsystem KG is its **scoped, deterministic cousin** — same
data, one mechanism in frame instead of the whole firehose.

---

## 1. What already exists — the four altitudes (reuse, don't fork)

The codebase renders one underlying graph (`entities` + `edges`) at four
zoom scopes. The subsystem KG is a fifth scope built from the **same
vocabulary**, so it inherits the renderer, layout, and styling for free.

| Scope | Frames | Builder | Renderer | Node kinds | Edge kinds |
|---|---|---|---|---|---|
| **Space** | whole whiteboard | (d3 inline) | `triple-lab/kg-panel.tsx` (d3-force `<svg>`) | all entities | all edges |
| **Canvas** | objective → its bets | `causal-map/lib/graph-build.ts:71` `buildCanvasGraph` | `CanvasAltitudeMap.tsx` (ReactFlow) | `sub_objective` | `cross_room` |
| **Room** | one bet (problem→mechanism→solution) | `causal-map/lib/build-room-graph.ts:149` `buildRoomGraph` | `RoomAltitudeMap.tsx` (ReactFlow) | `pain`/`feature`/`outcome` | `causal_chain` (flow only) |
| **Mechanism** | one lever's internals | `mechanism-dataflow-view.tsx:83` `buildGraph` | `MechanismDataflowView` (ReactFlow) | `step`/`outcome` | `dataflow` (token) |
| **Subsystem** | levers of a room, wired by tokens | `lib/objective-canvas/build-subsystem-modules.ts` | `subsystem-modules-view.tsx` (hand-rolled `<svg>`) | module | `produces→consumes` |

**Shared vocabulary to reuse:** `causal-map/lib/types.ts` —
`CausalMapNode = Node<CausalMapNodeData>`, `CausalMapEdge =
Edge<CausalMapEdgeData>`, `CausalMapNodeKind`, `EdgePolarity`,
`EdgeSource` (`local | cross_space | semantic`), `LayoutAlgorithm`. This
type file *already bakes in three KG seams* (its own header, lines 6-20):
`canonicalConceptId` on nodes, a `source` provenance discriminator on
edges, and a named layout registry. **Those three seams are exactly the
substrate for "a specialized KG that influences other connected KGs."**
They were designed for this and are currently dormant.

**Rendering stack:** ReactFlow v12 (`@xyflow/react`) + dagre
(`@dagrejs/dagre`) for the analytical maps; **tldraw** for the actual
product whiteboard (`whiteboard-base.tsx`). The unfurl layer
(`unfurl/render-room-unfurl.ts`, `render-canvas-unfurl.ts`) is the proven
bridge that translates a ReactFlow graph model → tldraw shapes.

---

## 2. "pls check": is the internal-mechanisms flowchart hosted in room infra? — YES

Confirmed. `MechanismDataflowView` (`mechanism-dataflow-view.tsx`) is a
**self-contained, embeddable `<ReactFlow>`**: one prop (`spec:
MechanismSpec`), its own `ReactFlowProvider`, its own dagre LR layout,
fixed 360px height, chrome stripped (no Controls/MiniMap,
`nodesDraggable=false`). It renders the lever's `runtime_flow[]` steps as a
DAG wired by `produces`/`consumes` tokens.

It is **already reused in four places with zero forks**:
- `item-detail-drawer.tsx:4901` (a tab in the lever drawer),
- `subsystem-modules-view.tsx:307` (expand-a-module → reveal its DAG),
- `mechanism-page/spec-section.tsx:185`,
- (and is the natural body for the subsystem KG's expanded node).

So the "graph's internal mechanisms flowchart" the user describes is real,
lives in room infra, and is **drop-in embeddable anywhere** — including a
tldraw shape on the whiteboard (§5). The only thing it lacks is a ReactFlow
**subflow/group** wrapper (`parentId`/`type:"group"` is used *nowhere* in
the codebase) — true nested-canvas is greenfield; the established
precedent is **expand-to-reveal** (click a node → mount the DAG below it).

---

## 3. The conceptual model — the subsystem KG as a fractal lens

A **subsystem KG** is a *curated slice* of the room graph centred on ONE
mechanism (a lever, or a `sub_category` group of levers), rendered as a
**problem → mechanism → solution** triad where the mechanism node is
**expandable into its own internal flowchart**:

```
   ┌─────────┐      ┌───────────────────────┐      ┌──────────┐
   │ PROBLEM │─────▶│      MECHANISM        │─────▶│ SOLUTION │
   │ (pain)  │      │  (lever / subsystem)  │      │(outcome) │
   └─────────┘      │   click ▸ to expand   │      └──────────┘
        ▲           │  ┌─ runtime_flow DAG ┐│            │
        │           │  │ step→step→step    ││            │
   external in      │  └───────────────────┘│       terminal out
   (consumed-only   └──────────┬────────────┘
    data tokens)               │ produces→consumes wires
                               ▼
                     sibling subsystem KGs (same room)
                               │ bridges (influence)
                               ▼
                     subsystem KGs in OTHER rooms / spaces
```

Three nested levels, all from data we already store:

- **L0 — the triad** (problem→mechanism→solution): pain/feature/outcome
  *entity* nodes. Today `buildRoomGraph` draws the whole room's pains,
  features, outcomes together; the subsystem KG **scopes it to one
  mechanism** and pulls in only the pains that edge *into* it and the
  outcomes it edges *out to* (from the room `edges`, deterministic).
- **L1 — the internals**: the mechanism node expands to the
  `runtime_flow` DAG via `MechanismDataflowView` (§2). This is the "graph
  inside the node."
- **L2 — the wiring**: `produces→consumes` token edges to sibling
  subsystems (already computed by `build-subsystem-modules.ts`), and
  `bridges` to subsystems in other rooms/spaces (§6).

**Why "specialized" / "for this specific component":** the Triple Lab KG
is the whole-space firehose (d3-force over every entity). The subsystem KG
is a **single-mechanism frame** you can pin, branch, and compare — the same
data, a tighter and *deterministic* lens (no LLM, no phantom edges).

---

## 4. Feature A — the subsystem KG builder + view

**Genuine gap:** today `subsystem-modules-view.tsx` draws ALL levers of a
room as hand-rolled SVG cards wired by tokens, but (a) it is not the shared
ReactFlow vocabulary (can't reuse map styling/loops/health), and (b) it
omits the **problem (pain) and solution (outcome) anchor entities** — it
shows data tokens (`externalInputs`/`terminalTokens`), not the
pain/outcome nodes that make it a true problem→mechanism→solution KG.

**Plan:** add a pure builder `buildSubsystemKg(input) → CausalGraph` that
emits the **shared `CausalMapNode[] / CausalMapEdge[]`** vocabulary so the
existing ReactFlow renderer draws it:

- Inputs: a focus `mechanismId` (or `sub_category` slug), the room
  `lanes`, the room `edges`, and the `SubsystemModulesModel` already
  produced by `build-subsystem-modules.ts` (reuse — don't recompute).
- Nodes: the focus mechanism (`kind:"feature"`); the pains that edge into
  it (`kind:"pain"`); the outcomes it edges out to (`kind:"outcome"`);
  optionally the sibling mechanisms it token-wires to (`kind:"feature"`,
  dimmed/peripheral).
- Edges: `causal_chain` pain→feature→outcome (from room edges) +
  `dataflow`/`produces→consumes` feature→feature (from
  `SubsystemModulesModel.wires`, `EdgeSource:"local"`).
- Expansion: clicking the focus node mounts `MechanismDataflowView`
  inline (the L1 internals) — exactly the `subsystem-modules-view.tsx:307`
  pattern, just inside a ReactFlow node-detail panel instead of below the
  SVG.

**Where it renders:** a new altitude option in the room's existing tab
strip (Map │ Chains │ Grid │ Subsystems) — OR, better, reuse
`RoomAltitudeMap` with a `focusMechanismId` prop so "Subsystem KG" is the
**focused state of the Map**, not a separate canvas. (Decision D1, §10.)

This builder is the missing rung between the Room scope and the Mechanism
scope: *one problem→mechanism→solution triad, with the mechanism openable.*

---

## 5. Feature B — bring the subsystem KG onto the whiteboard

The whiteboard (`whiteboard-base.tsx`) is **tldraw**, and new things land
on it by **(a)** registering a custom `ShapeUtil` and **(b)** firing a
`window` CustomEvent that the board listens for. Both patterns are already
in production:

- Registered shape utils: `RoomCardShapeUtil`, `InsightCardShapeUtil`,
  `ArtifactCardShapeUtil`, `LayerBandShapeUtil` (in `shapes/`).
- Event bus: `DEPLOY_CARD_EVENT`, `DEPLOY_ARTIFACT_EVENT`,
  `OPEN_UNFURL_EVENT` → handler calls `editor.createShape<…>(…)`.
- Translation precedent: `render-room-unfurl.ts` takes a `RoomGraph` and
  emits `room-card` + `layer-band` + bound `arrow` shapes idempotently
  (stable ids via `meta.unfurl`).

**Plan:** a new `SubsystemKgShapeUtil` whose `component()` mounts the §4
view (a small `<ReactFlow>` or the focused `RoomAltitudeMap`) at a fixed
card size, plus a `DEPLOY_SUBSYSTEM_KG_EVENT` fired from:
- the room's Subsystems tab ("Pin to board" on a module), and
- the Library (re-placing a collapsed subsystem KG, §7).

The shape's `meta` carries `{ mechanismId, subId, spaceId }` so it
rehydrates from live data (not a frozen copy) unless it's a Library
snapshot. Follow `LayerBandShapeUtil`/`RoomCardShapeUtil` verbatim for the
util skeleton; follow `render-room-unfurl.ts` for idempotent placement.

**Open question (D2):** live-bound shape (re-reads entities each render,
stays in sync) vs snapshot shape (frozen at pin time). Recommend
**live-bound by default**, snapshot only when collapsed into the Library.

---

## 6. Feature C — influence across connected / branched KGs

"Influencing other connected knowledge graphs branched out of the same
whiteboard" maps onto **three existing primitives, in increasing reach:**

1. **In-room (already built):** `produces→consumes` token wires
   (`build-subsystem-modules.ts`). Lever A's `runtime_flow.produces` ∩
   lever B's `consumes` ⇒ a deterministic A→B edge. Change a mechanism's
   tokens and every sibling subsystem KG's wiring recomputes — that *is*
   the influence, with no LLM and no phantom edges. Reuse as-is.

2. **Cross-room / cross-space:** the **`bridges` table** (`schema.sql`
   L182-196; migration `20260502_bridges_shared_substrate.sql`).
   `bridge_type ∈ ('identity','influence','structural')`,
   `coupling_strength`, `coupling_direction`, `shared_variable_name`. This
   is the literal "graph A influences graph B" primitive and is already the
   cross-scope substrate. A subsystem KG renders its `bridge_type:
   'influence'` edges with `EdgeSource:"cross_space"` — **KG seam #2 in
   `types.ts` already styles cross-space edges differently**; we just stop
   leaving it always-`"local"`.

3. **Shared concept identity:** `entities.canonical_concept_id` →
   `canonical_concepts.canonical_code` (migration `20260721`). Two
   subsystem KGs in different rooms that resolve to the same canonical
   concept are "the same node, seen twice" — **KG seam #1
   (`canonicalConceptId` on node data)** lights this up.

**Branching:** there is no per-subsystem fork primitive today, but
`twin_snapshots` / `twin_scenarios` (migration `20260602`) already freeze
an entire entities/edges/cycles/bridges subgraph as JSONB and fork it via
`parent_snapshot_id` + an ordered `action_list` + per-action
`twin_scenario_deltas`. A "branch this subsystem KG" action is a
*scoped* snapshot (one mechanism's neighborhood) reusing that machinery —
see D3.

**Orphan flags to fold in, not duplicate:** (a) two parallel
concept-identity systems exist — structured `canonical_concepts` vs derived
`concept_slug` (`cross-space-concept-stats.ts` header admits they don't
match); pick `canonical_concept_id` as canonical. (b) `twin_snapshots`/
`twin_scenarios` are substrate-only ("lands the substrate, not the UI") —
the subsystem-KG branch UI would be their first real consumer.

---

## 7. Feature D — collapse / respawn in the Library

**Genuine gap (the real new build).** `library_objects` (migration
`20260908`) saves a **single addressable handle**: one `source_entity_id`
(+ optional `content_snapshot` JSONB, `object_type`, placement flags).
`object_links` (`validates|delivers|depends_on|feeds|derived_from`) relate
*objects to objects*, implying multi-object structure — but **there is no
"save this cluster/subgraph as one object" path today.** Saving places a
*reference*, it does not respawn structure.

**Plan — two viable shapes (pick in D4):**

- **(i) Snapshot-in-blob (lighter):** a new `object_type:
  "subsystem_kg"` whose `content_snapshot` carries the frozen subgraph
  (nodes + edges + the focus `mechanism_spec`), serialized with the **same
  JSONB shape `twin_snapshots` already uses**. Collapse = write one
  `library_objects` row. Respawn = read it back, fire
  `DEPLOY_SUBSYSTEM_KG_EVENT` (§5) to place it (live-rebind if the source
  entities still exist; otherwise render from the frozen snapshot — solves
  the dangling-handle problem the single-card model has today).
- **(ii) Cluster link (more relational):** add a `cluster_id` (or reuse
  `object_links` with a new `member_of` type) so a Library object can own N
  member objects. Heavier; only worth it if clusters must stay editable
  per-member after collapse.

**Recommendation:** ship **(i)** first — it reuses the `twin_snapshots`
serializer and the existing `content_snapshot` column, requires no new
table, and directly delivers "collapse a subsystem KG → a Library tile →
re-place it later (here or on another whiteboard)."

---

## 8. Feature E — structure protection (the load-bearing foundation)

This is the foundation the other four lean on, and it is **genuinely
absent today**: entities are **HARD-deleted** (cascade), there is no
soft-delete, no lock flag, and no whole-structure respawn — so a user
brainstorming in a room can irreversibly destroy the layer scaffold.

**Plan (minimal, additive):**
1. **Lock flag** — `entities.locked boolean default false` (+ optional
   `improvement_goals.locked`). Locked entities reject delete/auto-retag in
   the mutation routes. Cheap, high-value, stops accidental clobber.
2. **Soft-delete** — `entities.deleted_at timestamptz`; deletes become
   updates; the room/KG queries filter `deleted_at is null`. Makes "undo a
   brainstorm wipe" possible.
3. **Whole-structure respawn** — reuse `twin_snapshots`: snapshot the
   objective's full entity/edge/layer scaffold on first room-generation
   (`room_layers_generated_at` is the natural trigger), and expose
   "Restore structure" that re-applies the snapshot. This is the same
   serializer §6/§7 use — **one snapshot machinery, three consumers.**

**What else to protect (the user asked):** the **layer scaffold**
(`ObjectiveStack` ordinals / `layer_ontology`), the **room lane skeleton**
(pain/feature/outcome lanes per `LANE_ROLE`), and **generated
`mechanism_spec`s** (expensive LLM output in `expanded_detail` — protect
from regen-clobber with a `spec_locked` flag or version stamp). All three
are snapshot-able with the same machinery.

---

## 9. Phasing & sequencing

Ordered by dependency and by "pure-FE-now vs needs-migration":

- **Phase 1 — Subsystem KG view (pure FE, no migration).** §4 builder +
  render in the room (focused Map or new sub-tab). Reuses
  `build-subsystem-modules.ts`, `types.ts`, `MechanismDataflowView`,
  `RoomAltitudeMap`. *Ships value immediately; zero schema risk.* ⚠️
  **Coordinate with the parallel chat** — it owns `subsystem-modules-view`.
- **Phase 2 — Pin to whiteboard (FE + 1 ShapeUtil).** §5
  `SubsystemKgShapeUtil` + `DEPLOY_SUBSYSTEM_KG_EVENT`. No migration.
- **Phase 3 — Cross-KG influence (FE, light).** §6 — turn on
  `EdgeSource:"cross_space"` + `canonicalConceptId` rendering (seams
  already exist), read `bridges` into the subsystem KG. No migration if we
  only *render* existing bridges.
- **Phase 4 — Library collapse/respawn (needs migration).** §7 option (i):
  `object_type:"subsystem_kg"` + snapshot serialize/respawn. Migration =
  none if `content_snapshot` suffices; else one column.
- **Phase 5 — Structure protection (needs migration).** §8: `locked`,
  `deleted_at`, snapshot-on-generate. Do this **before** users brainstorm
  destructively at scale; it's foundational but can land in parallel since
  it's purely additive columns.

**Migrations are the only gated steps** (Phases 4-5). Per the
parallel-workstreams rule: check `list_migrations` + git before authoring
any migration, prefer new files, and re-assert the full
`sub_objective_decisions` action superset if that constraint is touched.

---

## 10. Decisions to lock (Dx)

- **D1 — separate tab vs focused Map.** Recommend: subsystem KG = the
  *focused state* of `RoomAltitudeMap` (add `focusMechanismId`), so we
  don't add a 5th canvas to maintain. (Alt: keep the SVG
  `subsystem-modules-view` as the overview and make the KG the drill-in.)
- **D2 — board shape: live-bound vs snapshot.** Recommend live-bound by
  default; snapshot only when collapsed to Library.
- **D3 — branching granularity.** Per-subsystem scoped snapshot (reuse
  `twin_snapshots`) vs whole-space only. Recommend scoped, as the first
  real `twin_snapshots` UI consumer.
- **D4 — Library subgraph shape.** Snapshot-in-blob (i) vs cluster-link
  (ii). Recommend (i) first.
- **D5 — concept identity source.** `canonical_concept_id` (structured)
  vs derived `concept_slug`. Recommend `canonical_concept_id`; treat
  `cross-space-concept-stats.ts` as the thing to converge, not extend.

---

## 11. Collision-avoidance (parallel session is editing this area)

- **Do NOT touch** `subsystem-modules-view.tsx` or
  `build-subsystem-modules.ts` without diffing first — they were just
  shipped (`9680882`) and `build-subsystem-modules.ts` already carries a
  collaborator-added `specsById`.
- **Safe to add (new files):** `build-subsystem-kg.ts`,
  `SubsystemKgShapeUtil`, a new event constant. Prefer new files over
  edits per the parallel-workstreams memory.
- **Reuse, never fork:** `types.ts` vocabulary, `MechanismDataflowView`,
  `RoomAltitudeMap`, `render-room-unfurl.ts`, `twin_snapshots` serializer,
  `bridges`, `library_objects`.
- **Before any migration:** `list_migrations` + git status; re-assert the
  `sub_objective_decisions` action superset if touched.

---

### Appendix — file index (verified paths)

- 3-panel synthesis: `src/components/triple-lab/triple-lab.tsx`,
  `kg-panel.tsx`; route `src/app/app/space/[id]/triple-lab/page.tsx`.
- Graph vocabulary: `src/components/objective/causal-map/lib/types.ts`.
- Room KG: `…/causal-map/lib/build-room-graph.ts:149`; renderer
  `…/causal-map/RoomAltitudeMap.tsx`.
- Canvas KG: `…/causal-map/lib/graph-build.ts:71`;
  `…/CanvasAltitudeMap.tsx`.
- Mechanism internals: `src/components/objective/mechanism-dataflow-view.tsx`.
- Subsystem (shipped): `src/components/objective/subsystem-modules-view.tsx`
  + `src/lib/objective-canvas/build-subsystem-modules.ts`.
- Whiteboard: `…/whiteboard-base.tsx` + `shapes/*ShapeUtil` + `unfurl/
  render-room-unfurl.ts`.
- Cross-graph: `supabase/schema.sql` L182-196 (`bridges`); migrations
  `20260502_bridges_shared_substrate.sql`, `20260721_canonical_concepts_
  table.sql`, `20260602_snapshots_scenarios.sql`.
- Library: migration `20260908_library_objects.sql`;
  `src/lib/objective-canvas/library-objects.ts`;
  `…/canvas-interactions/save-to-library.ts`.
- Per-entity subgraph store: `entities.expanded_detail.mechanism_spec`
  (migration `20260525_entities_item_detail.sql`); producer
  `src/lib/objective-canvas/enrich-mechanism-spec.ts:262`.
