# Minimal Intake Mode

**Status:** default since 2026-06-02.

The product intake was collapsed to a single calm surface:

```
home chatbox  →  /app/objective/[id]  →  whiteboard with:
                                          • the objective card (collapsed RoomCard)
                                          • the AI Prompt Sharpening Card (below it)
                                          and nothing else.
```

The **full analysis canvas** — clarifying questions, sub-objective picking,
decompose→**rooms**, entities/edges, cross-room signals, chains, decisions,
concept-memory, Tier-2 analyses — is **hidden**, and (this is the important
part) its **server load + intake pipeline are skipped**, not just visually
hidden. That fixes the slow intake load and stops rooms from being generated.

`?full=1` on the objective URL restores the entire old experience.

---

## What was turned off (and where)

| # | Hidden / skipped | File | Mechanism |
|---|---|---|---|
| 1 | **The full canvas server load** (sub-objectives, entities, edges, signals, chains, decisions, concept memory, analyses) — the main cause of the slow intake | [`src/app/app/objective/[spaceId]/page.tsx`](src/app/app/objective/[spaceId]/page.tsx) | When `searchParams.full !== "1"`, the page returns early (`MinimalObjectiveSurface`) **before** any of the heavy queries run. |
| 2 | **Intake pipeline kickoffs** — broad research (`surfacePassToDb`) + concept annotations (`generateInitialAnnotationsForSpace`). These feed clarifying/decompose, i.e. the **rooms**. | [`src/app/api/brainstorm/start/route.ts`](src/app/api/brainstorm/start/route.ts) | Wrapped in `if (!sharpenOnly) { … }`. The chatbox sends `sharpenOnly: true`. Only `generatePromptSharpeningForSpace` still runs. |
| 3 | **Objective layout chrome** — `HomeTabNav`, the Lab Notebook rail + pill, the annotations toggle | [`src/app/app/objective/[spaceId]/layout.tsx`](src/app/app/objective/[spaceId]/layout.tsx) | Gated on `!minimal` (`minimal = mode === "space" && !isBrief && !fullMode`). |
| 4 | **The canvas window itself** — the shell starts **collapsed** so only the board + objective `RoomCard` show | [`src/components/objective/objective-canvas-shell.tsx`](src/components/objective/objective-canvas-shell.tsx) | `collapsed` initialises to `minimal`; `WhiteboardBase` gets `seedCard` (the objective card) + the `PromptSharpeningMount` polls + drops the AI card. |

The chatbox that drives all of this: [`src/components/home/objective-chatbox.tsx`](src/components/home/objective-chatbox.tsx) (`sharpenOnly: true` in the submit body).

## What still runs at intake (minimal mode)

- `spaces` + `layer_ontology` + `improvement_goals` rows (cheap, needed for the objective).
- `generatePromptSharpeningForSpace` → the **Prompt Sharpening Card** (the only analysis).

## How to turn the old experience back on

**A. One objective, temporarily** — append `?full=1`:
`/app/objective/<id>?full=1`. The page loads the full canvas, the layout shows
the tab nav + notebook, and the shell opens the window with the full
`ObjectiveCanvasView` (clarifying / picking / rooms, depending on stage).

**B. Restore the old intake pipeline (research + annotations + rooms)** —
remove the flag so `brainstorm/start` runs the kickoffs again:
- delete `sharpenOnly: true` from the submit body in
  `src/components/home/objective-chatbox.tsx`, **or**
- delete the `if (!sharpenOnly) { … }` guard in
  `src/app/api/brainstorm/start/route.ts` (always run them).
Note: rooms still require the clarifying→decompose flow (full canvas or
autopilot), so you'll also want **C** for them to be reachable.

**C. Make the FULL canvas the default again** — flip the minimal defaults:
- `src/app/app/objective/[spaceId]/layout.tsx` → make `minimal` default `false`
  (e.g. `const minimal = false`).
- `src/app/app/objective/[spaceId]/page.tsx` → make `fullMode` default `true`
  (e.g. `const fullMode = sp?.full !== "0"`), so the heavy load runs by default.
- `src/components/objective/objective-canvas-shell.tsx` → `minimal` prop already
  flows from the layout; no change needed once the layout default flips.

**D. Keep both** — minimal by default but a visible "Open full canvas" button:
link to `?full=1` from the minimal surface or the objective card.

---

## Deprecation & strategic focus — hide the old path, focus the new object layer (2026-06-03)

**Decision (locked):** the **old build is being retired**, not just lazy-loaded. Two things and *everything downstream of them* are hidden + de-prioritized:

1. **Room generation** — the sub-objective "room" pipeline that produces `entities` + `edges` (`POST /api/brainstorm/room/generate` and friends).
2. **The complex operation intake** — the heavy multi-stage decompose pipeline (`POST /api/pipeline/decompose`, `decompose-why-chain`, `research`, `expand`, …).

The product now focuses on the **new object layer**: `library_objects` / **oc-cards** (Variable + Feature), the **converge / diverge** verbs, the minimal / whiteboard-native intake, and the on-canvas chrome (AI-settings bar, selection synth ops, goal sidebar). New-model reference: **`OBJECT_FLOW_ARCHITECTURE.md`** (Phase 0 = `library_objects`).

### Already hidden (by the minimal-mode default above)
Room gen is gated by `spaces.pipeline_mode === "autopilot"` (`src/lib/feature-flags/room-generation.ts`); the **default is `"review_each"` → room gen OFF**. The minimal intake never auto-calls `decompose` (it's user-initiated). So by default a user never triggers either path. The §"What was turned off" table covers the canvas load, the intake kickoffs, the chrome, and the collapsed shell.

### Downstream surfaces of the old path (hidden ⇒ unreachable in the default flow)
| Surface | File | Status in default (minimal) flow |
|---|---|---|
| Sub-objective room view (4 lanes + correlations) | `src/components/objective/sub-objective-room-view.tsx`, route `…/sub/[subId]/page.tsx` | Reachable only via `open_room` + that route; empty without room gen |
| Room altitude / causal map | `src/components/objective/causal-map/altitudes/RoomAltitudeMap.tsx` | entities/edges-backed → empty |
| Lane / category cards | `src/components/objective/category-card.tsx` | room-gen output |
| Entity detail drawer | `src/components/canvas/drawers/entity-detail-drawer.tsx` + `ItemDetailDrawer` | entity-backed |
| Cross-room signals strip | `src/components/objective/cross-room-signals-strip.tsx` | aggregates entities |
| Legacy Synergy / Studio shells | `/app?legacy=1`, `/app?studio=1` | already behind query-param escape hatches |

### Dependency safety (why hiding the old does NOT break the new)
- `library_objects.source_entity_id` is **nullable** — oc-cards/objects exist **without** any entity (`src/lib/objective-canvas/library-objects.ts`). New layer is self-standing.
- **converge / diverge** are board-native (operate on card text → `executeCardOperation`); no entity/room queries.
- Minimal/whiteboard-native intake creates an `objective_canvas` space in `review_each` mode; no rooms, no decompose.

### ⚠️ Residual old-layer leak to seal — the Library rail
The **Library rail** (`canvas-interactions/library-rail.tsx`) + its endpoint **`GET /api/spaces/[id]/graph`** read the **`entities`** table (OLD layer) and open the entity-based `ItemDetailDrawer`. It's mounted in the default board chrome, so under the new direction it will show an **empty** glossary/graph (no room gen) and points at the wrong layer.
**Plan:** re-point the Library to **`library_objects`** (list via the existing `…/library/objects` read path) and open the **object** detail surface used by the oc-cards (`OPEN_CARD_DETAIL_EVENT {objectId}`). NOTE: that object drawer is currently **WIP / unwired** (the only references to `OPEN_CARD_DETAIL_EVENT` are in `oc-card-shape.tsx` — nothing listens yet), so this re-point is gated on the object-flow drawer landing. Until then the Library reads the old layer.

### What is NOT removed (reversible)
Nothing is deleted — the old routes/components remain on disk and are reachable via `?full=1` / `?legacy=1` / `?studio=1` and `pipeline_mode = "autopilot"`. This is a **hide + de-prioritize**, kept reversible per the escape hatches below.

---

## Why intake was slow (the original bug)

`/app/objective/[spaceId]/page.tsx` is a server component that, on every load,
ran the entire full-canvas data load (many Supabase queries + `computeChains`,
cross-room signals, decision summaries, analyses) **even though minimal mode
hides all of it**. Combined with `brainstorm/start` firing the broad research
pass + annotation generation at submit, intake paid the full cost for a surface
that shows only two cards. Items #1 and #2 above remove that cost.
