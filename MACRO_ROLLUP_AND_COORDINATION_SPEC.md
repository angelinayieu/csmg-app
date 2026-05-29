# Macro Roll-Up & Cross-Level Coordination — Build Spec

> The fix for the #1 problem: **rooms and the macro board don't coordinate.** Today the
> macro board is built TOP-DOWN and FROZEN; rooms never write back. This spec flips it to
> BOTTOM-UP roll-up so the macro board reflects what the rooms actually produced — and lays
> the path to the single macro→micro→macro chain for the tech spec.
> Every path below verified by direct code read, 2026-05-29. Companion to
> `AUTOPILOT_RESTRUCTURE_SPEC.md` and `CROSS_AUDIT_AND_BUILD_SEQUENCE.md`.

## The problem — verified ground truth

- **The macro stack is top-down + frozen.** `decompose-into-layers.ts:42` prompts for "the
  structural skeleton of the problem, **not content within it**" from objective text, at the
  clarifying→pick transition. Every writer of `synthesis_data.objective_canvas.layers` is
  top-down: `clarify/complete/route.ts:282`, the seed trigger (`start/route.ts:12`), and
  `space/[spaceId]/layers/generate/route.ts` (`initial` = no-op if it already exists).
  **No writer re-derives the stack from room results.**
- **The orchestrator compares rooms; it doesn't roll them up.** `analyses/index.ts` ("Cross-room
  Analysis Registry + Orchestrator") + `cross-room-signals.ts` only detect *verbatim string
  overlaps* across rooms (`:167` mechanism, `:190` first-principle, `:230` annotation) → the
  "N signals in ≥2 rooms" strip. Loose overlap, not aggregation.
- **The one seam meant to tie rooms→layers is DEAD.** `layer-coverage.ts:62-76` (verbatim):
  *"The loader doesn't currently project layer_ordinals onto RoomSnapshot… treat all rooms as
  untagged."* `ordinalsByRoom` is therefore always empty (`:81`) and it only ever emits the
  "Rooms not yet tagged" finding. The layer-card "coverage" chip counts *picker intent*
  (`objective-stack.tsx:116` → `taggedProposals`), not delivered room work.
- **No cross-level chain exists.** `compute-chains.ts:68` builds Pain→Mechanism→Result triples
  from **one room's** edges only; `ChainTriple` has no layer/objective field. Nothing threads
  macro-problem → micro-problem → micro-mechanism → micro-outcome → macro-outcome.
- **The only roll-up-ish thing:** `distill-concepts.ts` (Tier 2, LLM) groups rooms into 3-5
  `theme` findings (`:40`) — but it's manual, advisory, and feeds nothing back to the board.

**Net:** a top-down skeleton and bottom-up room detail that never meet. That is the
"lack of coordination across systems/variables."

## The direction flip

```
TODAY:   objective → top-down skeleton (frozen) → rooms fill detail → detail stranded
TARGET:  objective → rooms produce problems/mechanisms/outcomes → ROLL UP → macro board
                                                                   reflects real room work
```

## Reuse — do NOT rebuild

- **`distill-concepts.ts`** — the grouping engine; add a problem-specific variant.
- **`layer-coverage.ts`** — FIX the seam (project `layer_ordinals` onto `RoomSnapshot`), don't rebuild.
- **The layer stack UI** (`objective-stack.tsx`) + `synthesis_data.objective_canvas.layers` — the render target.
- **Room problems** (pain entities) — already generated; `room-fill-runner.tsx` auto-runs room-fill after approval.
- **`build-strategy-brief.ts:185`** — already derives the brief from room content.

## The sequence — what to build, in order

| # | Step | What | Where (verified) | Schema? | Status |
|---|---|---|---|---|---|
| **1** | **Fix the rooms→layers seam** | project each room's `improvement_goals.layer_ordinals` onto `RoomSnapshot` so coverage is REAL (the dead code already wants this) | `analyses/cross-room-state.ts` (loader) + `layer-coverage.ts:62-76` | none | ▶ **first** |
| **2** | **Roll up room PROBLEMS → macro sub-problems** | a problem-specific distill pass: read all room pain entities, group into N macro sub-problems per layer, write to `objective_canvas.layers[*].sub_problems` | new analysis beside `distill-concepts.ts`; persist into the layers blob | none (JSONB) | ▶ next |
| **3** | **Distilled objective + macro bullets** under Core Objective card | 1 dense sentence (one small LLM call) + bullet the macro sub-objectives (the layer cards already hold them) | new UI under the Core Objective card + 1 route | none | ▶ next |
| **4** | **Wire roll-up into the autopilot sweep** | after room-fill completes, auto-run steps 1-2 so the macro board updates itself; emit to the notebook | `room-fill-runner.tsx` → roll-up route | none | then |
| **5** | **Concept identity (`concept_slug`)** | stamp a stable slug on annotations + room entities; re-key cross-room matching from strings to identity | `annotations-prompt.ts`, `room/generate`, `cross-room-signals.ts` | **migration** (defer until parallel session's lands) | then |
| **6** | **Cross-level chain + data-flow view** | thread macro-problem → micro-problem → micro-mechanism → micro-outcome → macro-outcome into ONE chain; render as the macro data-flow spine, zoom into rooms | new `compute-macro-chain.ts` + a macro chain view | none (needs #5 to be reliable) | last |

### Step detail (immediate)

**Step 1 — fix the seam (smallest, unblocks everything).** The loader (`cross-room-state.ts`)
already loads rooms; add `layer_ordinals` to the `RoomSnapshot` shape and select it. Then
`layer-coverage.ts`'s existing logic (lines 106-223) lights up for free — real per-layer
coverage from delivered rooms, not picker intent.

**Step 2 — roll up problems.** Mirror `distill-concepts.ts` but scoped to pain entities and
grouped *per layer*: "across the rooms tagged to L2, the recurring problems are X, Y, Z."
Persist as `sub_problems` on each layer in the `objective_canvas.layers` blob (freeform JSONB —
no migration). This is the macro sub-problem grouping the user asked for, derived bottom-up.

**Step 3 — the visible payoff.** Under the Core Objective card: one dense distilled sentence
(white, Apple-simple) + a bullet list of macro sub-objectives (re-presenting the layer cards)
+ the rolled-up macro sub-problems from Step 2 as a band beneath each layer.

## Where to visualize (given the current interface)

- **Distilled objective + macro bullets + grouped macro-problems** → on the **main Objective
  Canvas**, under the Core Objective card, with the grouped problems as a band on/under each
  layer-stack card (the macro sub-objectives *are* the layer cards).
- **The full chain / data-flow** → the **layer stack rendered as a flowing macro chain**
  (problem→…→outcome across L1–L4), zooming into the room that owns each hop. This is the
  "system/subsystem interweaving zoom." It IS the upstream→downstream data-flow spine — the
  expert idiom is a layered data-flow / computational graph (see `REASONING_AND_INFLUENCE_MAP.md`
  + `OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md` §2).

## What NOT to do

- **Don't rebuild** `distill-concepts`, the layer stack, or room problem-generation — extend them.
- **Don't build the cross-level chain (Step 6) before concept identity (Step 5)** — without
  stable IDs it falls back to the fragile verbatim string-match and won't hold.
- **Don't add migrations now** — a parallel session has an uncommitted migration
  (`20260904_priority_vector.sql`); Steps 1-4 need NONE. Only Step 5 does.
- **Don't pre-generate "everything"** for cross-weave — only the *vocabulary* (Step 5) is worth
  pre-generating; full pre-gen explodes LLM cost (per `AUTOPILOT_RESTRUCTURE_SPEC.md`).
- **Respect the 4-axis "layer" vocabulary** (`OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md` §2)
  — this work lives on the *abstraction-stack* axis (L1-L4), not the room *causal-stage* axis.

## Tie to the autopilot vision

This roll-up **IS a new autopilot stage**, slotting between room-fill and the brief:
```
approve → fill rooms → [ROLL UP to macro: coverage + sub-problems + distilled objective] → score → Strategy Brief ready
```
That simultaneously (a) closes the coordination gap and (b) advances "press once, read the
finished brief" — the macro board and brief finally reflect what the rooms produced.

## Recommendation

Build **Steps 1 + 2 + 3** first — the seam fix + problem roll-up + the visible Core-Objective
distillation. All three need NO migration, reuse existing engines, and directly kill the
coordination gap with immediate on-board payoff. Steps 4-6 (autopilot wiring, identity, the
cross-level chain) follow as deliberate, separately-scoped builds.
