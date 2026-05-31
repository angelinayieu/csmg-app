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

### Phase 2 — BUILT ✅ (collision-safe, type-clean)

Shipped as **3 new files + 2 purely-additive edits** (84 insertions / 0
deletions in `whiteboard-base.tsx`; 0 deletions in the `.d.ts`):

| File | Role |
|---|---|
| `subsystem-kg-board-bus.ts` *(new)* | tldraw-free dispatch bus — `DEPLOY_SUBSYSTEM_KG_EVENT` + `deploySubsystemKgCard` / `queueSubsystemKgForBoard` / `sendSubsystemKgToBoard` / `drainPendingSubsystemKgs`. Mirrors `board-bus.ts` (live event **+** sessionStorage queue **+** drain-on-mount) so a room on the full-page route — which has no board mounted — still lands its KG when the board next mounts. Feature-scoped bus, same pattern as `brainstorm/brainstorm-board-bus.ts`. |
| `shapes/subsystem-kg-shape.tsx` *(new)* | `SubsystemKgShapeUtil extends BaseBoxShapeUtil`. Renders the **problem → mechanism → solution** triad as a self-contained glass card (chip columns + accent mechanism hero pill + "N steps inside" footer). "Open in room" fires the shared `OPEN_ROOM_EVENT` with `{ roomId, focusEntityId: mechanismId }`. |
| `app/preflight/subsystem-kg-board-preview/page.tsx` *(new)* | Public preflight harness — mounts the real `WhiteboardBase`, deploys 3 sample KGs (with-spec / multi-problem / no-internals), and reads back the `OPEN_ROOM_EVENT` round-trip (incl. the focus hint). |
| `whiteboard-base.tsx` *(additive)* | Import + register `SubsystemKgShapeUtil` in `CUSTOM_SHAPE_UTILS`; `onSubsystemKg` listener + `createSubsystemKgCard` helper (dedupe by `mechanismId`, cascade, center — mirrors `createArtifactCard`); drain queued KGs on mount. |
| `types/tldraw-shapes.d.ts` *(additive)* | One `"subsystem-kg"` entry in `TLGlobalShapePropsMap` so `editor.createShape<SubsystemKgShape>` + `s.type === "subsystem-kg"` narrow. |

The trigger lives in **`subsystem-kg-panel.tsx`** (Phase 1, my file): a
**"Send to whiteboard"** header button computes a lightweight snapshot from
the already-scoped triad and calls `sendSubsystemKgToBoard`.

**Decision D2 — RESOLVED → snapshot card (not live-mount).** A board card
carries a **lightweight snapshot in props** (chip labels + counts +
`hasSpec`/`stepCount`), **never** the full `MechanismSpec` and **not** a
mounted `RoomAltitudeMap`. Rationale: on the canvas/objective altitude no
single room's lanes/edges are in scope, and serializing a live ReactFlow
graph into tldraw props is heavy + fragile. Instead the card is a *legible
pointer* — it shows the triad shape at a glance and **"Open in room"
deep-links to the live graph** (reusing `RoomAltitudeMap`'s `?focus=` seam
via `OPEN_ROOM_EVENT`). Live-rebind on respawn stays the Library story (D4).

> **Follow-up (parallel-session, one line):** wire the shell's
> `OPEN_ROOM_EVENT` handler (`objective-canvas-shell.tsx:190`) to forward
> `detail.focusEntityId` into its `navTo` as `?focus=` — today the extra
> field is harmlessly ignored, so the card already opens the right room; the
> follow-up just makes it land *focused on the mechanism*.

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

**Serializer BUILT ✅ (no migration).** `lib/objective-canvas/structure-snapshot.ts`
now provides the option-(i) machinery: `serializeStructureSnapshot({scope:
"subgraph", scopeRef: mechanismId, entities, edges, …})` → a denormalized,
FK-free `StructureSnapshotPayload`, and `toLibraryStructureRow(payload, …)`
→ the **durable** `library_objects` insert (`object_type:"structure"`,
`source_entity_id: NULL`, capture in `content_snapshot`). The NULL source is
the fix for the dangling-handle bug: verified the live FK
`library_objects.source_entity_id → entities ON DELETE CASCADE`, so a
single-entity save is cascade-killed when its source is deleted — a
structure save with NULL source is not. Respawn = read the row, fire
`DEPLOY_SUBSYSTEM_KG_EVENT` (§5) or `planRespawn()` to re-create entities/
edges with their original ids. Remaining = one thin route to persist it
(no schema work).

---

## 8. Feature E — structure protection (the load-bearing foundation)

This is the foundation the other four lean on, and it is **genuinely
absent today**: entities are **HARD-deleted** (cascade), there is no
soft-delete, no lock flag, and no whole-structure respawn — so a user
brainstorming in a room can irreversibly destroy the layer scaffold.

### Phase E — WRITTEN ✅ (migrations authored, **NOT applied**)

Authored 2026-05-30 after the mandated read-only schema inspection
(`list_migrations` + column/constraint dump). Split into **two migration
files on purpose** so the safe half can ship without waiting on the
cross-cutting half:

| File | What | Apply status |
|---|---|---|
| `20260912_structure_snapshots.sql` | NEW `structure_snapshots` table — denormalized, FK-free JSONB capture (only FK is `space_id`); the whole-structure respawn substrate. | **Safe to apply** the moment the migration lane is clear — changes no read/write path. |
| `20260913_structure_soft_delete.sql` | `deleted_at timestamptz` + `locked boolean` on `entities`/`edges`/`improvement_goals`/`layer_ontology`/`spaces` + partial `…_live` indexes. | **Coordination-GATED.** Columns are additive/harmless, but the *semantics* need a read/write-path sweep across ~dozens of routes — do NOT flip deletes→soft-deletes solo. |
| `lib/objective-canvas/structure-snapshot.ts` | Pure serializer + `planRespawn()` + `toSnapshotRow()` + `toLibraryStructureRow()`. No React/DB/shared-type imports → collision-safe, type-clean. | n/a (code, merged). |

**Why this maps the original three-point plan:**
1. **Lock flag** → `locked boolean` (migration B) — locked rows reject
   delete/auto-retag in the mutation routes. Cheap, stops accidental clobber.
2. **Soft-delete** → `deleted_at timestamptz` (migration B) — deletes become
   updates; live reads filter `deleted_at is null` (the gated sweep). Makes
   "undo a brainstorm wipe" possible.
3. **Whole-structure respawn** → `structure_snapshots` (migration A) +
   `serializeStructureSnapshot` / `planRespawn`. Generalizes the proven
   `twin_snapshots` JSONB design to the full structural set
   (spaces→improvement_goals→entities→edges + layer_ontology +
   whiteboard_positions). **One snapshot machinery, three consumers** (§6
   bridges, §7 Library, §8 restore). The natural auto-capture trigger stays
   `room_layers_generated_at`; `reason:"pre_delete"` captures before a
   destructive op give a free undo.

**Schema facts that shaped the DDL (verified live, not assumed):**
- **No `sub_objectives` table** — a "room" is an `improvement_goals` row
  (`parent_goal_id`); entities/edges point at it via
  `parent_sub_objective_id`. The serializer filters on that.
- **`library_objects.object_type` has no CHECK** — the `"structure"`
  object_type needs no migration (free-text), avoiding the constraint-clobber
  trap.
- Snapshots hold **no FK to entities/goals/edges** (only `space_id` cascade),
  so deleting a room never cascades the snapshot away — the entire point.

**What else to protect (the user asked):** the **layer scaffold**
(`layer_ontology` ordinals), the **room lane skeleton** (pain/feature/outcome
lanes), and **generated `mechanism_spec`s** (expensive LLM output in
`expanded_detail`) — all three ride inside the same `structure_snapshots`
payload (`layerOntology[]`, the room goal's `room_lane_labels`, and each
entity's full `expanded_detail`), so one capture protects all three. A
finer `spec_locked` stamp can come later via the same `locked` column.

**⚠️ Standing constraint:** both migrations are **written, not applied**.
Do not apply unilaterally while the parallel objective-canvas session is
mid-migration. Migration B additionally needs its read/write-path sweep
planned with the route owner before its soft-delete semantics go live.

---

## 9. Phasing & sequencing

Ordered by dependency and by "pure-FE-now vs needs-migration":

- **Phase 1 — Subsystem KG view (pure FE, no migration). BUILT + MOUNTED ✅.**
  §4 builder (`build-subsystem-kg.ts`) + `subsystem-kg-panel.tsx`, reusing
  `RoomAltitudeMap` + `MechanismDataflowView` as black boxes. *Ships value
  immediately; zero schema risk.* The mount wrapper `subsystem-section.tsx`
  is BUILT ✅ and now **mounted ✅** — the one-element swap is APPLIED in the
  host `sub-objective-room-view.tsx` (Subsystems tab → Modules ⇄ Knowledge
  graph toggle live). See §12.3.
- **Phase 2 — Pin to whiteboard (FE + 1 ShapeUtil). BUILT ✅.** §5
  `SubsystemKgShapeUtil` + `DEPLOY_SUBSYSTEM_KG_EVENT` (+ queue/drain) +
  preflight harness. No migration. Edits to `whiteboard-base.tsx` /
  `tldraw-shapes.d.ts` are purely additive.
- **Phase 3 — Cross-KG influence (FE, light).** §6 — turn on
  `EdgeSource:"cross_space"` + `canonicalConceptId` rendering (seams
  already exist), read `bridges` into the subsystem KG. No migration if we
  only *render* existing bridges.
- **Phase 4 — Library collapse/respawn. Serializer BUILT ✅ (no migration).**
  §7 option (i): `toLibraryStructureRow()` writes a durable
  `object_type:"structure"` row (NULL source, capture in `content_snapshot`)
  — confirmed `content_snapshot` suffices, **no migration**. Remaining = one
  thin persist/respawn route.
- **Phase 5 — Structure protection. Migrations WRITTEN ✅ (NOT applied).**
  §8: `20260912_structure_snapshots.sql` (new table, safe to apply) +
  `20260913_structure_soft_delete.sql` (`locked`/`deleted_at`, coordination-
  gated) + `structure-snapshot.ts` serializer/respawn-planner (merged,
  type-clean). Do this **before** users brainstorm destructively at scale.
  Migration A is purely additive; migration B's columns are additive but its
  soft-delete *semantics* need the route read/write-path sweep first.

**Migrations are the only gated steps** (Phases 4-5). Per the
parallel-workstreams rule: check `list_migrations` + git before authoring
any migration, prefer new files, and re-assert the full
`sub_objective_decisions` action superset if that constraint is touched.

---

## 10. Decisions to lock (Dx)

- **D1 — separate tab vs focused Map.** ✅ **LOCKED: focused state of
  `RoomAltitudeMap`** (add `focusMechanismId`). No 5th canvas; reuse the
  map's styling, loop detection, health, and (crucially) its *existing*
  focus/fade machinery (§12). The SVG `subsystem-modules-view` stays as the
  overview; the KG is the drill-in. (Alt noted: standalone sub-tab.)
- **D2 — board shape: live-bound vs snapshot.** Recommend live-bound by
  default; snapshot only when collapsed to Library. *(still open)*
- **D3 — branching granularity.** Per-subsystem scoped snapshot (reuse
  `twin_snapshots`) vs whole-space only. Recommend scoped, as the first
  real `twin_snapshots` UI consumer. *(still open)*
- **D4 — Library subgraph shape.** ✅ **LOCKED: snapshot-in-blob (i),
  live-rebind on respawn.** Reuse the `twin_snapshots` serializer into
  `library_objects.content_snapshot`; on re-place, re-bind to live entities
  if present, else render the frozen snapshot (fixes today's
  dangling-handle problem). No new table. (Alt noted: cluster-link (ii).)
- **D5 — concept identity source.** `canonical_concept_id` (structured)
  vs derived `concept_slug`. Recommend `canonical_concept_id`; treat
  `cross-space-concept-stats.ts` as the thing to converge, not extend.
  *(still open)*

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

## 12. Phase 1 — BUILT ✅ (collision-safe, type-clean)

**Goal:** a "specialized subsystem KG" = the room Map focused to ONE
mechanism's **problem → mechanism → solution** triad, with the mechanism
node openable into its internal `runtime_flow` DAG. **Decision D1 locked:
focused state of `RoomAltitudeMap`.**

**Shipped as two NEW files (zero edits to any parallel-session file;
`tsc --noEmit` reports zero errors in both):**
- `src/lib/objective-canvas/build-subsystem-kg.ts` — pure
  `scopeRoomToMechanism({lanes, edges, mechanismId})` → the triad slice
  (problems = pains edging into the lever; solutions = outcomes it edges
  to). Returns drop-in `RoomLane[]`/`RoomEdge[]`.
- `src/components/objective/subsystem-kg-panel.tsx` —
  `<SubsystemKgPanel>` feeds that slice into the existing
  `<RoomAltitudeMap>` (same ReactFlow renderer as the room Map tab) and
  reveals `<MechanismDataflowView spec=…>` inline for the internals.

**Remaining = a single element swap** in the host room view. This was
originally framed as "mount the panel," but the panel needs raw
`lanes`/`edges`/`spaceId`/`subId` that the shipped `subsystem-modules-view`
does **not** receive (it gets only the built `model` + `onOpenItem`). Rather
than thread four new props through a parallel-owned view, the mount is now a
**self-owned wrapper** (`subsystem-section.tsx`, §12.3) that builds the model
itself and offers both lenses behind one toggle — collapsing the host change
to a **one-element swap**. Held only because `sub-objective-room-view.tsx`
is dirty (parallel session active). See §12.3 for the ready-to-paste diff.

### 12.1 The discovery that makes this small

`RoomAltitudeMap` (`causal-map/altitudes/RoomAltitudeMap.tsx`) **already
computes exactly the scoping we need**:

- `focusNodeId` state (L102) + `focusSet` (L162-181) walk **`reach(fwd)`
  ∪ `reach(bwd)`** from the focused node. For a *mechanism* node,
  `reach(bwd)` = its upstream **pains (= problem)** and `reach(fwd)` = its
  downstream **outcomes (= solution)**. That set **is** the
  problem→mechanism→solution triad — already implemented, just hover-driven.
- `flowNodes`/`flowEdges` (L244-297) already `faded`-dim everything outside
  the focus set.
- A `?focus=<entityId>` effect (L221-231) already `fitView`-centers a node.
- `onOpenItem(entityId)` (L64, L189-207) already opens the lever drawer —
  **which already contains the `MechanismDataflowView` DAG tab** (the L1
  internals), per §2. So "expand the mechanism's internals" needs no new
  surface in Phase 1.

`buildRoomGraph` (`build-room-graph.ts:149`) is a **pure** transform over
`{lanes, edges}`; its `isFlowEdge` (L186-190) keeps only one-lane-forward
spine edges. Feed it scoped lanes → it draws a scoped spine. No edit needed.

### 12.2 ⚠️ Collision constraint → build by COMPOSITION, not edits

Memory (`project_room_altitudes`) marks the causal-map/graph files
**CONTESTED** across sessions: *"verify mtime+diff before editing
map/graph files."* So Phase 1 must reach the focused-Map outcome **without
editing `RoomAltitudeMap.tsx` or `build-room-graph.ts`.** Achieve it with
**two NEW files** that use the existing renderer as a black box:

**File 1 (NEW, pure) — `src/lib/objective-canvas/build-subsystem-kg.ts`:**
- Export `scopeRoomToMechanism(input: { lanes: RoomLane[]; edges:
  RoomEdge[]; mechanismId: string; model?: SubsystemModulesModel }):
  { lanes: RoomLane[]; edges: RoomEdge[] }`.
- Logic (deterministic, no LLM):
  1. Find focus feature `F` (id = `mechanismId`) in the `features` lane.
  2. `problems` = pain-lane items `p` with an edge `p → F`.
  3. `solutions` = outcome-/objective-lane items `o` with an edge `F → o`.
  4. *(optional, for context)* `siblings` = features token-wired to `F`
     from `model.wires` (from/to === F). Include dimmed, or omit in v1.
  5. Return **sub-lanes** preserving slug/label/color but with
     `items` filtered to `{ problems } / { F (+siblings) } / { solutions }`,
     and **sub-edges** = the input edges whose endpoints are both in that
     node set.
- This reuses the SAME `RoomLane`/`RoomEdge` types the renderer eats, so
  it drops straight into `<RoomAltitudeMap lanes=… edges=…>`.

**File 2 (NEW, thin) — `src/components/objective/subsystem-kg-panel.tsx`:**
- Props: `{ spaceId; lanes; edges; mechanismId; spec?: MechanismSpec;
  onOpenItem? }`.
- Body: `const scoped = useMemo(() => scopeRoomToMechanism({lanes, edges,
  mechanismId, model}), …)`; render `<RoomAltitudeMap spaceId={spaceId}
  lanes={scoped.lanes} edges={scoped.edges} onOpenItem={onOpenItem} />`.
  Because only the triad's nodes exist in `scoped`, the Map *is* the
  specialized KG — full renderer, zero contested-file edits.
- Below it (Phase 1 inline internals, optional): when `spec` present,
  render `<MechanismDataflowView spec={spec} />` in a collapsible card —
  literally the `subsystem-modules-view.tsx:279-308` block, reused.

### 12.3 Entry point — BUILT ✅ `subsystem-section.tsx` (the one-element swap)

**As-built (supersedes the earlier "edit `subsystem-modules-view`" sketch).**
Mounting the KG needs raw `lanes`/`edges`/`spaceId`/`subId`, but the shipped
`subsystem-modules-view` receives only `{ model, onOpenItem }` — so threading
those four props would mean editing a parallel-owned file. Instead the entry
point is a **new, fully-owned wrapper** that the host mounts in place of the
modules view:

`src/components/objective/subsystem-section.tsx` *(new, type-clean)* —
- Builds the model itself via the **same** `buildSubsystemModules({ lanes,
  edges, roomCategories })` call the host previously made inline (single
  source for both lenses).
- A segmented **lens toggle: Modules ⇄ Knowledge graph.**
  - *Modules* → `<SubsystemModulesView model … onOpenItem … />` verbatim
    (the existing system view, untouched).
  - *Knowledge graph* → a mechanism-picker chip row + `<SubsystemKgPanel>`
    for the focused lever (defaults to the first lever that `hasSpec`).
    The panel already carries the Phase-2 **"Send to whiteboard"** button.
- Treats both views **and** the KG panel as black boxes → consumes only
  shipped exports, edits none of them.

**Host handoff — APPLIED ✅ 2026-05-30 (surgical 2-hunk edit; user-authorized
despite the dirty host).** `sub-objective-room-view.tsx` was actively shifting
(the parallel session had just dropped the `!skeleton &&` guard mid-edit), so
both hunks were re-read fresh immediately before editing and confirmed isolated
in the diff. tsc: **zero errors in any file I touched** (the total moved with
the parallel session's unrelated in-progress edits, not this swap).

**(1) The element — applied at the live Subsystems render site.** Guard kept
as-found (`{roomView === "subsystems" && (`, post-parallel-edit); only the
inner element swapped:

```tsx
// before
{roomView === "subsystems" && (
  <SubsystemModulesView
    model={buildSubsystemModules({ lanes, edges, roomCategories })}
    onOpenItem={setDetailEntityId}
  />
)}

// after — every prop ALREADY in host scope (verified):
//   spaceId (prop), subObjectiveId (prop L142/196, === room id per L1278),
//   lanes, edges, roomCategories (useMemo), setDetailEntityId (handler).
{roomView === "subsystems" && (
  <SubsystemSection
    spaceId={spaceId}
    subId={subObjectiveId}
    lanes={lanes}
    edges={edges}
    roomCategories={roomCategories}
    onOpenItem={setDetailEntityId}
  />
)}
```

**(2) The import — applied at host L65.** The two now-unused imports
(`SubsystemModulesView` + `buildSubsystemModules` — verified the *only* refs,
4 total) were replaced with a single `import { SubsystemSection } from
"./subsystem-section";`. Clean replacement (both symbols now live only inside
the wrapper). That was the **whole** mount — no other host line changed; the
git diff shows exactly these two hunks.

### 12.4 Acceptance criteria

- Given a lever with a `mechanism_spec`, the panel shows **its** pains →
  itself → its outcomes (nothing else from the room), centered/fit.
- Clicking the mechanism opens the lever drawer on the **data-flow tab**
  (existing `onOpenItem`), OR expands the inline `MechanismDataflowView`.
- Levers with no spec still render the triad (problem→mechanism→solution
  from edges), with a "generate spec" affordance for the internals.
- **Zero diffs** to `RoomAltitudeMap.tsx` / `build-room-graph.ts` /
  `build-subsystem-modules.ts` / `subsystem-modules-view.tsx`. All entry-point
  logic lives in the owned wrapper `subsystem-section.tsx` (§12.3); the host's
  only change is a one-element swap it lands when its file is clean.

### 12.5 Alt (only if you own the map file this week)

Instead of pre-scoping lanes, add a `focusMechanismId?: string` prop to
`RoomAltitudeMap` that seeds a *persistent* focus: feed `focusNodeId ??
focusMechanismId` into `focusSet`, and extend the `?focus=` effect to
center it. Keeps the full room visible with the triad lit and siblings
dimmed (softer than hard-scoping). Cleaner UX, but **touches a contested
file** — only do it if a fresh `git`/mtime check shows you own it.

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
- **Structure protection (§7/§8, WRITTEN — not applied):** migrations
  `supabase/migrations/20260912_structure_snapshots.sql` (new table, safe) +
  `20260913_structure_soft_delete.sql` (`locked`/`deleted_at`, gated);
  serializer/respawn-planner `src/lib/objective-canvas/structure-snapshot.ts`
  (`serializeStructureSnapshot` / `planRespawn` / `toSnapshotRow` /
  `toLibraryStructureRow`). Snapshot precedent: `twin_snapshots`.
