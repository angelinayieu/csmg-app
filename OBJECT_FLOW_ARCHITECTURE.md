# Object Flow Architecture — Diagnosis & Foundation

> The 18-point spec (Autopilot / Sidebar objects / Whiteboard placement / Library /
> Blueprint layers / Final spec) is **ONE root problem, not 18**: generated content is
> not a first-class, addressable OBJECT. Fix the object/Library/layer/back-link model and
> most of the 18 become wiring. Diagnosis by 3 parallel code traces, 2026-05-29.

## Root cause (one line)

**There is no unified Object abstraction below the `entities` row.** Variations,
mechanism-specs, experiments (prototype_briefs), composed designs, deliverables, expansion
nodes, and findings are all **JSONB array-elements / inline fields** inside
`entities.expanded_detail` (or `spaces.synthesis_data`). They persist (survive reload) but
are **not rows, not FK-referenceable, not individually save/rank/place-able.** The "Library"
is a read-only count over those blobs. The "final spec" is a request-time scan, never a
stored object. → §18's "object flow" is broken because the objects don't exist as objects.

## §16 Diagnosis — answered (verified, file:line)

**Persistence map (what's a row vs a blob):**
| Item | Persistence | Addressable id? |
|---|---|---|
| pain / feature / outcome | ROW in `entities` | ✅ uuid |
| variation | JSONB `expanded_detail.variations[]` | ◐ blob-local string id (no FK) |
| mechanism_spec | JSONB sub-object | ✖ none |
| experiment (prototype_brief) | JSONB `expanded_detail.prototype_briefs[]` | ◐ blob-local string |
| composed_design | JSONB sub-object | ✖ none |
| deliverable (doc/mockup/export) | JSONB **fields on the variation** | ✖ none |
| expansion node | JSONB `expanded_detail.expansion_tree[]` | ◐ blob-local string |
| recommendation/finding | JSONB `synthesis_data.cross_room_analysis.findings[]` | ◐ hash, recomputed per scan |

- **Library** = visual aggregation, **not a model**. `load-workspace-library.ts` ("no migration, no new columns") counts blob contents. No `workspace_library`/saved table exists.
- **Selection/election** persists but only as `disposition` *inside the blob*. No `included_in_spec`/`selected` column. No ranked "held" set.
- **Whiteboard placement** persisted via **3 uncoordinated mechanisms** (tldraw snapshot blob, `whiteboard_positions` entity-keyed, `shape_threads` shape-id) — no single shape↔entity map. Manual placement = a **"→ Board" button only** (no drag-and-drop from sidebar/notebook). **Auto-placement on Autopilot: ABSENT** (the runner fires zero board calls).
- **Notebook rows** = **click-to-navigate only**. No drag-to-board, no in-place expand, no save-to-library.
- **Synergism interactions** (expand-card, lasso, focus mode, publish mode, upstream/downstream tracing, brainstorm→feature, on-canvas next-move, voice/hold-thought) — **ALL exist, but only in the OLD `synergy/*` SVG world; NONE ported to the new tldraw Objective Canvas.**
- **Final-spec assembly** — the one bright spot: it **does** assemble from SELECTED (elected) objects, not all-generated, and **swap→regenerate works** (cached by `state_hash`). BUT: features have **no own layer slot** (room-title string-match, **empty on the live path** → every feature's layer = `""`); **experiment→mechanism** and **deliverable→experiment** links are **not persisted**; the spec references features by **name string, not id** (not back-traceable); `depends_on` is an **LLM name-match**; ranking is **room-local** (blind to layer/dependency/deliverable context).

## The object-flow gap map (§18's required flow, arrow by arrow)

```
Generated → [✖ no Object] → Whiteboard → [✖ no auto/drag] → Library → [✖ no model]
          → Blueprint Layer → [✖ no per-feature slot] → Final Spec [◐ from elected blob, name-keyed]
```
Every arrow is broken except the last (and that one is name-keyed, not id-keyed).

## The foundation (the minimal model that unlocks all 18)

1. **A first-class Object/artifact layer.** Promote the elect-able items to addressable rows
   (own uuid, `type`, `parent` FK, `metadata`) — OR a `library_objects` table that references
   blob items by a composite key. Either way: a stable id every surface (sidebar, notebook,
   whiteboard, library, spec) can jointly reference.
2. **A Library/selection table** carrying §4's metadata (type · source room/variable/objective ·
   layer · rank · selection status · in-spec · on-board · in-brief). This becomes the
   **source of truth the final spec compiles from** (§8).
3. **Per-feature blueprint-layer slot** (not room-title match) so features map to layers + can be
   swapped within a layer (§7).
4. **Persisted back-links** (experiment→mechanism, deliverable→experiment, feature→spec by id) =
   the object graph (§6) → enables tracing + context-aware ranking.

Everything else (§1-3 placement, §2 card actions, §5 notebook objects, §9-14 Synergism
interactions, §15 modes) becomes **wiring on top of this foundation.** Build any of them first
and you build on sand.

## Sequenced phases

- **Phase 0 — the unlock (foundation):** the Object/Library/selection model + per-feature layer slot + back-links. *Schema work. Nothing else is durable without it.*
- **Phase 1 — universal card actions** (§2): save / place / rank / select / reject / trace — wiring once objects have ids + a Library.
- **Phase 2 — whiteboard placement** (§3): manual drag from sidebar/notebook + auto-unfurl during Autopilot (wire the runner to `deployArtifactCard`/`openUnfurl`).
- **Phase 3 — final spec from Library/Blueprint** (§7-8): compile from the selection table; layer-swap → regen.
- **Phase 4 — port Synergism interactions** (§9-14): expand-card, lasso, focus, publish, on-canvas next-move, voice — port from `synergy/*` into `objective/*` (logic, not the old visual design).
- **Phase 5 — context-aware ranking** (§6): feed layer/dependency/deliverable context into the scorer.

## Coordination — this is a decision to LOCK, not to unilaterally build

The Autopilot runner, notebook, whiteboard, drawer, decision-log, and a `brainstorm_sessions`
migration are **all under active parallel edit right now.** Phase 0 is a **schema change**
(new tables/migrations) that every parallel session must build against — so it must be a
**coordinated, locked architecture decision**, not one session racing ahead. Starting Phase 0
code unilaterally would collide hard.

**Reuse, don't rebuild:** the elected→compile→swap→regen assembly loop already works; the
Synergism interactions already exist (port them); the stage routes are idempotent. The missing
thing is the *object substrate* underneath.
