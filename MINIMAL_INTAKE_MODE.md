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

## Why intake was slow (the original bug)

`/app/objective/[spaceId]/page.tsx` is a server component that, on every load,
ran the entire full-canvas data load (many Supabase queries + `computeChains`,
cross-room signals, decision summaries, analyses) **even though minimal mode
hides all of it**. Combined with `brainstorm/start` firing the broad research
pass + annotation generation at submit, intake paid the full cost for a surface
that shows only two cards. Items #1 and #2 above remove that cost.
