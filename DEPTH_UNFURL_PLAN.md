# Depth-Unfurl Plan — the objective as a progressively-forkable causal stack

> Written 2026-05-28. A continuous "depth dial" that unfurls an objective from a
> single orb down to its confirmed causal model, one rank of structure at a time.
> Grounds every level in data that already exists (see `LAYER_DEFINITIONS.md` +
> `src/components/objective/causal-map/`). Companion to the floor-0 whiteboard:
> the unfurl is the **quarry** of artifacts, the board is the **workbench**.

---

## 0. The core idea (one paragraph)

The objective canvas already has a Phase 12.A causal-map with discrete altitudes
(`canvas · room · item · variation`). This plan turns that *click-to-drill*
navigation into a **continuous, game-like depth dial** with two properties the
current map lacks: (1) **progressive disclosure** — each notch reveals only the
single most-important child per fork ("one hero + a count"), so depth never
floods the screen; (2) **local depth** — a global "floor" depth plus a per-node
"dig here," so the user chooses *where* to go deep. Every node, at every depth,
can be **plucked onto the floor-0 whiteboard** as a card (reusing the existing
collapse-to-card shape) to mix, connect, and experiment.

---

## 1. The fork-out ladder — what appears at each depth

Each notch adds **exactly one new rank of causal structure**. The "hero" column
is what the simplicity engine (§2) surfaces; everything else collapses to "+N".

| Depth | Fork (what appears) | The ONE hero | Collapsed | New connections | Game move | Data source |
|---|---|---|---|---|---|---|
| **D0 · Seed** | The objective orb | Objective line + readiness % | — | — | Pulses; pull the dial | `space.description`, aggregate health |
| **D1 · Anatomy** | 4–6 ObjectiveStack layers (substrate→outcome shelves) | Each layer's hero **variable** | "+N variables" | Cross-layer **influence arrows** (enables/produces/constrains/measures…) | Uncovered layer glows "nothing here yet" | `ObjectiveStack.layers[].variables`, `.influences` |
| **D2 · Bets** | Sub-objectives dock onto their layer band | Highest-**leverage** sub-objective (widest span / best health) | "+N rooms" per band | **Cross-room edges** (shared mechanism / root cause / lens) | Drag a bet to re-tag its layer; gaps invite a new bet | `improvement_goals.layer_ordinals`, `CrossRoomSignals` |
| **D3 · Levers** | Inside each room: 3 lanes pain → **mechanism** → outcome | Hero **mechanism** + its pain + outcome | "+N pains/mechanisms/results" | Lane-to-lane links | Mix-and-match: drag a mechanism near another room's pain → AI "would this help?" | `RoomLane[]` (pain/features/outcomes), entities |
| **D4 · Plays** | Causal **chains** (pain→feature→outcome) + **loops** | Strongest validated chain; biggest reinforcing **loop** | "+N chains"; weak loops dimmed | Polarity (±), strength (stroke), mediator pills, R/B loop rings | "Complete the chain"; "what breaks this loop?" | `RoomEdge[]`, Tarjan SCC loops |
| **D5 · Proof** | Evidence + rigor per edge; mechanism **variations** | What's **confirmed** (tested) vs assumed | Speculative edges ghosted; "+N experiments" | Method-tier badges, evidence forest | Filter to "only confirmed"; click an assumption → launch a test | method tiers, `evidence_registries`, Lab pages |

**Concrete read (cognition-health objective):**
`D0` *"Sustain afternoon focus" — 62%* → `D1` *Foundational → Biological →
**Cognitive** → Behavioral → Outcome* → `D2` bet *"Stabilize afternoon glucose"*
(bridges Foundational→Biological) → `D3` *post-lunch crash → **protein-forward
lunch** → stable 2–4pm focus* → `D4` *protein → stable glucose → fewer crashes →
focus → (reinforcing: focus → better food choices)* → `D5` *"protein→glucose" is
**tested**; "breaks→focus" is **assumed**, ghosted.*

---

## 2. The simplicity engine — "one hero + a count"

What keeps depth from exploding is *what we choose to surface*. At every fork,
rank children by a signal **already computed**, show #1 prominently, collapse the
rest to a "+N" chip (expands on tap, or auto-expands at the next notch):

| Fork | Hero = rank by |
|---|---|
| Layer → variable | most influence arrows touching it |
| Band → sub-objective | `health` × `approvedPlayCount` × layer span (leverage) |
| Room → mechanism | strongest chain / highest method tier |
| Chain set → chain | highest `strength`, validated |
| Loop set → loop | reinforcing cycle w/ biggest multiplier |

---

## 3. The game layer (mix · match · connect)

1. **Drag-to-connect** — pull two nodes together → AI proposes the relationship
   as a ghost arrow + label (this is the planned A1 cross-room synthesis layer;
   the unfurl is its richest input). ✓/✗ to keep.
2. **Pluck-to-whiteboard** — any node → a card on floor-0 (reuse collapse-to-card).
3. **"What-if" ghosting** — drop a lever into a different room/layer → AI
   speculates the downstream chain as a ghost.
4. **Gap invitations** — uncovered layers + missing chain links render as glowing
   empty *slots*, not absences.
5. **Progressive reveal as reward** — each notch animates the unfurl; the dial
   always rewinds to calm.

---

## 4. Architecture — reuse, don't fork

- **Data builders already exist (pure transforms):** `buildCanvasGraph`
  (D1–D2 nodes/bands/cross-room edges), `buildRoomGraph` (D3–D4 lanes/chains),
  Tarjan loop detection, `healthBandOf`, method tiers — all in
  `src/components/objective/causal-map/lib/`.
- **New work is the interaction + render layer only:**
  1. `useDepthDial` — global floor depth (0–5) + per-node local depth overrides.
  2. A progressive-disclosure renderer that applies the "one hero + count" rule
     per fork and animates between notches.
  3. Wire the game moves (drag-to-connect, pluck-to-board) to the existing
     synthesis endpoint (A1) + collapse-to-card shape.
- **Render surface (decision §6.1):** lean = render on the floor-0 tldraw board
  reusing the graph-build *data*, so the unfurl + cards + play live on one surface.

---

## 5. Phasing

- **P0 (prototype, this pass):** D0→D2 with the dial, mock cognition-health data,
  the one-hero rule + unfurl animation. Verifiable on `/preflight`. No backend.
- **P1:** wire D0→D2 to real `ObjectiveStack` + `MainCanvasSub` data on the board.
- **P2:** D3→D4 (rooms → levers → chains/loops) reusing `buildRoomGraph`.
- **P3:** D5 (evidence/rigor) + the game moves (drag-to-connect via A1, what-if).
- **P4:** pluck-to-whiteboard for every node; cross-room mix-and-match.

---

## 6. Open decisions

1. **Render surface:** tldraw floor (one surface, re-implement node layout) vs the
   existing React-Flow causal-map (free layout/loops, separate canvas). Lean: tldraw.
2. **Dial shape:** vertical stack (matches substrate→outcome) vs radial bloom from
   the orb. Lean: vertical, radial only as the D0→D1 flourish.
3. **Global vs local depth:** recommending **local** (per-branch dig) + a global
   floor. Confirm against the user's mental model.

---

## 7. Relationship to existing systems

- **Extends, doesn't replace,** the Phase 12.A causal-map (`AltitudeBreadcrumb`,
  `CanvasAltitudeMap`, `RoomAltitudeMap`). The dial is a continuous reframe of the
  same altitude ladder; the data builders are shared verbatim.
- **`LAYER_DEFINITIONS.md` is load-bearing here:** the ladder uses ObjectiveStack
  (#1) for D1, sub-objective `layer_ordinals` for D2, room lanes (#2) for D3.
  It deliberately does NOT touch `layer_ontology` (#3) — different axis.
