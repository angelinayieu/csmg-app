# Chat A — Synergism Interactions → tldraw Canvas (port plan)

> Hand this to a dedicated chat. Port the OLD `synergy/*` interaction LOGIC onto the NEW
> tldraw Objective Canvas in the clean Apple style (discard old SVG visuals). Verified by
> code trace 2026-05-29.

## Key insight: the substrate is already there
- The Synergism logic splits cleanly from its SVG rendering — **the LOGIC is reusable, the visuals are throwaway.**
- The new canvas already has the extension pattern: `whiteboard-base.tsx` `BoardOverlay` (~:624) reacts to `editor.getSelectedShapes()` and renders a selection-driven floating toolbar (`board-selection-toolbar.tsx`); cross-component messaging is `board-bus.ts` (CustomEvents). **Don't build custom tldraw `StateNode` tools** — use new shapes + selection overlays + new board-bus events.
- **Native tldraw marquee select replaces the old "lasso" entirely.**
- The **brainstorm backend + panel already exist** (`objective/brainstorm/brainstorm-panel.tsx` + `/api/brainstorm/sessions/*`) — its authors explicitly deferred "tldraw page integration" to Phase 4b. This port IS that Phase 4b.

## Sequenced port (new files under `objective/canvas-interactions/*`)
1. **Expand-card brainstorm** (highest value, lowest effort) — add a "Brainstorm" button to `artifact-card-shape.tsx` (clone the existing Expand-button → CustomEvent pattern), wire to the existing `BrainstormPanel`; drop elected candidates as a new `shapes/brainstorm-card-shape.tsx` tethered to the source (reuse `createInsightWithLinks` arrow-binding). Reuse the whole backend — no rewrite.
2. **Focus mode** — copy `lib/synergy/focus-mode.ts` + `focus-mode/use-focus-mode.ts` verbatim (framework-agnostic logic); new Apple-style `canvas-interactions/focus-mode-panel.tsx`; dim out-of-scope shapes via editor opacity. Reuse logic, rewrite visuals.
3. **Converge / next-move CTA** — adapt `use-converge-result.ts` to read shape meta; render an Apple CTA at the recommended bbox via `editor.pageToScreen` (the `BoardOverlay` coordinate trick).
4. **Voice / hold-thought** — copy `hooks/synergy/use-speech.ts`; drop a built-in tldraw note shape per final transcript.
5. **Publish** — route Focus stage-4 to the existing Strategy Brief surface.

## The one porting cost: the `nodes`→shapes seam
All reusable logic is typed against `ClientNode {id,x,y,label,kind,parent}`; the new world is `TLShape`. Build ONE adapter `canvas-interactions/shape-node-adapter.ts` projecting board shapes → `ClientNode[]` so `autoMarkBoard` / `useConvergeResult` / focus-scoping drop in unchanged.

## Collision map
- **Coordinate w/ owner (hub, edit minimally):** `whiteboard-base.tsx` (extend `CUSTOM_SHAPE_UTILS` + add overlay siblings), `board-bus.ts` (append events — additive), `artifact-card-shape.tsx`/`room-card-shape.tsx` (one button each).
- **Net-new (safe):** everything under `canvas-interactions/*`, `shapes/brainstorm-card-shape.tsx`, any new `/api/objective/[spaceId]/*` routes.
