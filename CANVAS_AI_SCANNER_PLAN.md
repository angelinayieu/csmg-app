# Canvas AI Scanner — Plan & Operation Registry

**Status:** DRAFT (spec-first, pre-code) · **Date:** 2026-05-30 · **Owner lane:** objective-canvas / canvas-interactions
**Decisions locked:** start with this written spec · scanner intelligence = **hybrid** (instant heuristic + LLM refine)

> One-line intent: make the Objective Canvas behave the way the northstar already
> promises — *"sticky notes = AI triggers, drop-to-analyze"* — by (1) cataloging the
> AI operations we already built into one registry, (2) routing every operation
> through a single executor that drops results back onto the board as tethered cards,
> and (3) adding a minimalist floating "scanner" that, given any idea, recommends
> which operations apply.

---

## 1. Why — the three hard truths today

Grounded in a code audit (whiteboard-base, board-bus, lib/objective-canvas, lib/interactions):

1. **Native sticky notes & text have zero AI.** `whiteboard-base.tsx` registers only 4 custom
   shapeUtils (`room-card`, `insight-card`, `artifact-card`, `layer-band`). tldraw's `note`/`text`
   are vanilla. `isBoardCard()` gates every AI surface to the 3 custom cards, so hand-typed
   stickies are inert.
2. **The card hover menu is mostly hollow.** Cards dispatch `CARD_ACTION_EVENT`
   (`decompose/variations/questions/make_plan/save`), but the **only** listener
   (`whiteboard-base.tsx onCardAction`) early-returns on everything except `save`. The four AI
   tiles fire into the void. board-bus admits it: the AI actions are *"left for the brainstorm
   engine's handler"* — which does not exist.
3. **This contradicts our own northstar.** Sticky-as-AI-trigger is planned-but-unbuilt; the
   engines exist but are unreachable from a free idea on the board.

Deployment note: the notebook pill is pinned **top-right** in code (`layout.tsx top:16; right:16`);
the "Proof" label on the right is the unfurl **depth dial** (`depth-scrubber.tsx`, Seed→Proof), not
a notebook control. The clean de-purpled look matches HEAD's theme sweep.

---

## 2. What already exists (do NOT rebuild)

### 2a. The operations ("power-ups") — `src/lib/objective-canvas/*`

Each operation = one `llmJSON()` call behind a soft-failing lib fn, invoked by an API route,
surfaced today only from inside rooms / the item drawer. **Input contract** is the critical axis:
`text` = runs on a bare string; `entity` = needs a feature/pain/outcome id; `room` = needs space+room scaffold.

| Op id | Intent (scanner copy) | Contract | Lib fn / file | Route | Output shape | Render |
|---|---|---|---|---|---|---|
| `questions` | "What questions clarify this?" | **text** | `generateClarifyingQuestions` · generate-clarifying.ts | `clarify/generate` | `ClarifyingQuestion[]` | insight card |
| `layers` | "What are the layers of this?" | **text** | `decomposeIntoLayers` · decompose-into-layers.ts, layer-model.ts | `space/[id]/layers/generate` | `ObjectiveStack{layers[], influences[]}` | layer-band shapes / stack |
| `sub_objectives` | "Break into sub-objectives" | **text** | `generateSubObjectiveProposals` · generate-sub-objectives.ts | `sub-objectives/propose` | `GeneratedSubObjectives{proposals[]}` | artifact cards |
| `categories` | "Bucket into friction/mechanism/result" | **text** | `generateRoomCategories` · generate-categories.ts | (in `room/generate`) | `RoomCategories` | (lanes) |
| `augment_*` | generic decompose/variations/questions/plan | **text** | (route only) | `/api/synergy/augment` `{transcript, mode}` | mode-specific | notes/cards |
| `card_insights` | "Socratic prompts on this content" | **text** | (route only) | `/api/canvas/card-insights` | questions (heuristic fallback) | insight card |
| `make_technical` | **"Make this more technical"** (the mechanism spec) | **entity** | `enrichMechanismSpec` · enrich-mechanism-spec.ts | `item/[id]/mechanism-spec` | `MechanismSpec` (see 2b) | artifact + dataflow |
| `sharpen` | "Tighten into specific + measurable" | **entity** | `sharpenDefinition` · sharpen-definition.ts | `item/[id]/sharpen` | tightened def | in-place |
| `variations` | "Give me design variations" | **entity** | `composeVariations` / `proposeMechanismCandidates` · compose-variations.ts, refine-mechanism.ts | `item/compose`, `item/variation/refine` | `ComposedDesign` / `ItemVariation[]` | artifact cards |
| `score_variations` | "Score these for effectiveness" | **entity+room** | `scoreVariationsForFeature` · score-variation-effectiveness.ts | `item/variation/score` | `VariationScoreEnvelope` | pills on cards |
| `expand` | "Deep-dive a sub-part" | **entity** | `generateExpansionNode` · generate-expansion-node.ts, expansion-catalog.ts | `item/expansion/spawn` | `GeneratedExpansionChild[]` | nested cards |

### 2b. Yes — technical structures ARE generated (`make_technical`)

`MechanismSpec` (`enrich-mechanism-spec.ts`) is an engineering spec, not prose:
- `runtime_flow[]` = an executable **data-flow DAG** — each step has `produces[]` / `consumes[]`
  data tokens wiring steps together, plus `component`, `user_sees`, `visual_intent`.
- `system_components[]` typed `data | ui | logic | integration`.
- `implementation_methods[]` = compared build approaches with `decision: use | test_later | reject`.
- `input_data[]`, `decision_record` (ADR), `acceptance_criteria[]`, `kill_criteria[]`,
  `research_basis`, `quality_score` (6 axes).

This is the real "make it more technical" payload — today only reachable from the item drawer.

### 2c. Reusable scaffolding (the connective tissue we extend)

- **Registry pattern:** `src/lib/interactions/skill-registry.ts` — `SkillDescriptor{id,name,inputs,
  outputs,depends_on,cost,requires_llm}` + `SkillRegistry` (runnableWith / executionOrder topo-sort /
  estimateCost). Targets the **KG pipeline**, unwired to UI. We model a *sibling* registry on it, not overload it.
- **Heuristic recommender pattern:** `synergy-ai-rail.tsx recommendNextMove()` — picks
  decompose→questions→research from what's missing, returns `{mode, copy, reason}`. Lift the shape.
- **Text→AI endpoints (no legacy coupling):** `/api/synergy/augment`, `/api/canvas/card-insights`.
- **Proven AI→board-card render path:** `render-brainstorm-on-board.ts` (candidates → native notes,
  idempotent via `meta.proposal_id`, lane-laid-out) + `createArtifactCard` / `createInsightWithLinks`
  (`whiteboard-base.tsx`). Results plug straight in.
- **Converge (existing):** Focus-Mode panel + `shape-node-adapter.ts` already projects board shapes
  → nodes and publishes a kept set to the brief (local, no AI). The "converge" half of expand⇄converge exists.

---

## 3. Architecture

```
        ┌──────────────── the loop ────────────────┐
  idea →  SCAN (hybrid)  →  RECOMMEND  →  RUN op  →  results as tethered cards
  (sticky/card)   │             │            │              │
                  │             │            │              └─→ Connect / Synthesize / Converge → Brief
                  ▼             ▼            ▼
            ScanTarget    AI-ScannerPanel  OperationExecutor
            (adapter)     (white sidebar)  (registry → route → render)
```

### 3a. `ScanTarget` — one shape for stickies AND cards
```ts
interface ScanTarget {
  source: "sticky" | "text" | "artifact_card" | "room_card";
  text: string;          // note richText, or card title + subtitle
  shapeId: TLShapeId;    // tether results near this
  entityId?: string;     // present for cards (and Phase-3 scratch entities)
  roomId?: string;
}
// shapeToScanTarget(shape) — extends canvas-interactions/shape-node-adapter.ts
```

### 3b. `CanvasOperation` — the registry descriptor
```ts
interface CanvasOperation {
  id: string;                       // "layers" | "make_technical" | ...
  label: string;                    // shown in menu + scanner
  intent: string;                   // plain-language one-liner
  contract: "text" | "entity" | "room";
  route: string;                    // API endpoint
  requires_llm: boolean;
  buildRequest(t: ScanTarget): Record<string, unknown>;
  render: "notes" | "artifact_cards" | "insight" | "stack" | "in_place";
  relevance?(t: ScanTarget): number; // 0..1 heuristic (Stage-1 scan)
}
export const CANVAS_OPERATIONS: CanvasOperation[]   // the catalog in §2a
export function operationsFor(t: ScanTarget): CanvasOperation[] // contract-runnable subset
```

### 3c. The single executor (kills the hollow menu)
`OPERATION_REQUEST {opId, target}` → `whiteboard-base` listener → look up op → `buildRequest` →
`fetch(route)` → render via the op's strategy (reuse `render-brainstorm-on-board` / `createArtifactCard`)
→ `OPERATION_RESULT {opId, shapeId, ok}` for UI feedback. `CARD_ACTION_EVENT`'s 4 AI actions become
`OPERATION_REQUEST`s; `save` stays as-is. Sticky notes dispatch the same event.

### 3d. The hybrid scanner
- **Stage 1 — instant heuristic** (`scan-recommendations.ts`): score each `text`-contract op via
  `relevance(target)` (rules: long/abstract text → `layers`,`make_technical`; "?" → `questions`;
  "vs"/comparison → `variations`; short noun phrase → `sub_objectives`). Render top 3-4 immediately.
- **Stage 2 — LLM refine** (debounced): POST the note text to `/api/synergy/augment` in a classify
  mode; re-rank / add ops; patch the panel when it returns. Soft-fail to Stage-1 ranking.

### 3e. The sidebar UI — `ai-scanner-panel.tsx`
Minimalist, white, frosted, no heavy chrome (matches the de-purpled theme). Mounts on **single**
shape selection (sticky or card) over the board, anchored near the shape. Each row = op label +
one-line intent + run affordance; entity-contract ops on a bare sticky show a subtle "needs context"
state until Phase 3. Dismiss on deselect.

---

## 4. Phased delivery & file map

### Phase 0 — Operation Registry (the "organize + document" ask) · low risk, no UI
- NEW `src/lib/objective-canvas/canvas-operations.ts` — `CanvasOperation` type + `CANVAS_OPERATIONS` + `operationsFor()`.
- NEW `src/lib/objective-canvas/scan-target.ts` — `ScanTarget` + `shapeToScanTarget()` (or extend `shape-node-adapter.ts`).
- This document.

### Phase 1 — Executor + AI on sticky notes (un-hollows the menu)
- NEW `src/components/objective/canvas-interactions/operation-executor.ts`.
- EDIT `board-bus.ts` — add `OPERATION_REQUEST` / `OPERATION_RESULT` + dispatchers; map `CardAction`→`opId`.
- EDIT `whiteboard-base.tsx` — replace hollow `onCardAction` with the executor; give native `note`/`text`
  a hover/selection affordance opening the shared menu (filtered to `text` ops).
- EDIT `card-hover-actions.tsx` — drive tiles from the registry (one source for card + sticky menus).

### Phase 2 — Hybrid scanner sidebar
- NEW `src/lib/objective-canvas/scan-recommendations.ts` — heuristic scorer + LLM-refine caller.
- NEW `src/components/objective/canvas-interactions/ai-scanner-panel.tsx` — the white floating panel.
- EDIT `whiteboard-base.tsx` — mount panel on single-shape selection; wire clicks → executor.

### Phase 3 — Context ops from a bare idea (deepest; coordinate)
- NEW `src/lib/objective-canvas/ensure-scratch-entity.ts` — materialize a synthetic feature entity +
  minimal room scaffold so `make_technical` / `variations` run from a sticky.
- EDIT `canvas-operations.ts` — entity-contract ops resolve via the scratch entity.

---

## 5. Coordination (parallel sessions)

- **Reuse, don't fork, the render path.** The brainstorm session owns `render-brainstorm-on-board.ts`
  + `brainstorm-*`. The executor (§3c) must call a **shared** "render AI cards on board" helper, not a
  second renderer. Action: agree on one helper signature before Phase 1.
- **`whiteboard-base.tsx` is the shared hot file.** Use partial-stage discipline (commit only your hunks).
- **Don't overload `skill-registry.ts`** (KG pipeline). `canvas-operations.ts` is a distinct sibling.
- One-file = one-chat: Phases 0-2 are canvas-interactions lane; Phase 3 touches entity/room creation —
  coordinate with whoever owns intake/room generation.

---

## 6. Open decisions (resolve before the relevant phase)

1. **Where results land:** native notes (cheap, matches brainstorm stream) vs custom artifact/insight
   cards (richer, tethered, saveable to Library). *Lean:* single-op results → tethered insight/artifact
   card; multi-candidate streams → notes.
2. **Scratch-entity lifecycle (Phase 3):** ephemeral vs persisted to `library_objects`. *Lean:* persist
   so `make_technical` output is addressable in the object-flow.
3. **`CARD_ACTION_EVENT` fate:** retire in favor of `OPERATION_REQUEST`, or keep as a thin alias. *Lean:* alias for one release, then retire.
4. **LLM classify mode:** reuse a `/api/synergy/augment` mode vs a tiny dedicated classify route. *Lean:* reuse first; split out only if latency hurts.

---

## 7. How this answers the original ask

- *"refine to be more technical"* → `make_technical` (`enrichMechanismSpec` → MechanismSpec data-flow DAG).
- *"what are the layers"* → `layers` (`decomposeIntoLayers` → ObjectiveStack), runs on any sticky text.
- *"which card can this feed into"* → existing Connect/Synthesize toolbar + `object_links.feeds`.
- *"AI scanner for recommendations across all power-ups"* → §3d hybrid scanner over the §2a registry.
- *"organize + document the operations"* → §2a catalog, made executable as `canvas-operations.ts` (Phase 0).
- *"put in any idea, expand and converge"* → expand = run ops (text now, entity via Phase-3 scratch);
  converge = existing Connect / Synthesize / Focus-Mode → Strategy Brief.
