# AGENTS.md

Guide for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.
**Scope: the Objective Canvas and everything wired to it.** Other modules (Synergy, Robustness X-Ray, intake) exist but are out of scope here.

## Project

`interaxis` (package name `csmg-app`) is a human×AI strategy canvas: you state an objective, the system decomposes it into sub-objectives and per-room causal maps (pain → features → outcomes), and you reason over them on an infinite whiteboard. The **Objective Canvas is the product centerpiece** — the goal is a Miro/Figma-grade canvas where AI moves are first-class.

Stack: **Next.js 16** (App Router) + **React 19** + **TypeScript 5.8 (strict)**. **Supabase** (Postgres + auth) is the backend. LLM backends are the **Anthropic SDK** and **OpenAI**. The canvas floor is **tldraw 4.5**; causal maps use **@xyflow/react**. State via **Zustand**, background jobs via **Inngest**, billing via **Stripe**.

## Build & verify

```bash
npm install
npm run dev          # next dev (Turbopack). If it chokes: npm run dev:webpack ; npm run dev:fresh nukes .next
npx tsc --noEmit     # REQUIRED before claiming work complete — repo is TS strict, no dedicated script
npm run lint         # next lint (eslint 9)
npm run build        # next build --webpack (production; also a full typecheck)
npm run db:status    # supabase migration list — what's actually applied to the linked project
npm run db:push      # apply local migrations to the linked project — confirm first, this hits remote
```

There is **no test suite** — don't try to run one. `npx tsc --noEmit` is the correctness gate.

## How the canvas is wired (read this first)

```
/app/objective/[spaceId]/page.tsx          (server) reads spaces.synthesis_data.objective_canvas
        ↓ hydrates from improvement_goals / entities / edges / layer_ontology
<ObjectiveCanvasShell>                      tldraw floor + room sidebar + board persistence
        └─ <ObjectiveCanvasView>            client orchestrator, drives the staged UI
```

- **Stage machine** lives in `spaces.synthesis_data.objective_canvas.stage`: `clarifying → picking → main` (`done` reserved, unimplemented). Read via `readObjectiveCanvasState()`.
- **The pipeline that drives stages lives under `/api/brainstorm/*`, NOT `/api/objective/*`.** `/api/objective/[spaceId]/*` is *only* board persistence + AI connect. This trips people up constantly.
- Per-room generation = `POST /api/brainstorm/room/generate` (1 LLM call for categories, then pain → outcomes → features, then edges).
- **Every user move logs to `sub_objective_decisions` via `logDecision()`** — see the clobber trap in Gotchas.
- Sending a room item to the whiteboard is one CustomEvent through `board-bus.ts`; `whiteboard-base.tsx` is the only thing that listens.

Full inventory of routes/persistence/events: `OBJECTIVE_CANVAS_OPERATION_MAP.md` (source of truth).

## Project layout

- `src/app/app/objective/[spaceId]/` — server routes: the canvas `page.tsx`, `layout.tsx`, `brief/`, and `sub/[subId]/lab/[entityId]/` (the per-item lab on its own route).
- `src/app/api/brainstorm/` — **the canvas backend**: `clarify/*`, `sub-objectives/*`, `room/*`, `item/*`, `space/*`, `annotations/*`, `analysis/*`, `notebook/*`.
- `src/app/api/objective/[spaceId]/` — board persistence only: `board/`, `board-subs/`, `connect/`, `sub/[subId]/room/`.
- `src/components/objective/` — all canvas UI (~50k LOC). Subdirs: `cards/`, `causal-map/`, `lab/`, `shapes/` (tldraw shapes), `icons/`.
- `src/lib/objective-canvas/` — generation / scoring / analysis logic (~27k LOC). `analyses/` holds cross-room Tier 1/2/3 operations.
- `src/lib/supabase/` — server + browser Supabase clients.
- `src/types/` — shared types. Touch for the data model (`layer-ontology.ts`, `whiteboard.ts`, `tldraw-shapes.d.ts`, `database.types.ts`).
- `supabase/migrations/` — schema. Apply order matters; `db:status` before assuming state.

## Hot files

Orchestration
- `src/app/app/objective/[spaceId]/page.tsx` (~650) — server loader that hydrates the *entire* canvas from `synthesis_data` + `improvement_goals`/`entities`/`edges`. The "what shows up on the canvas" file.
- `src/components/objective/objective-canvas-view.tsx` (~355) — client orchestrator for the staged UI.
- `src/components/objective/objective-canvas-shell.tsx` (~310) — wraps the view in the tldraw floor + room sidebar + persistence.
- `src/lib/objective-canvas/clarifying-state.ts` (~225) — `readObjectiveCanvasState()`, the stage-machine reader.

Canvas surfaces
- `src/components/objective/main-canvas-view.tsx` (~1540) — the `main` stage (sub-objective tiles, workbench, strips).
- `src/components/objective/sub-objective-room-view.tsx` (~1780) — a single room (pain/feature/outcome lanes + edges).
- `src/components/objective/item-detail-drawer.tsx` (~5870) — per-item deep dive (variations / score / refine / compose / research). Biggest file in the module — edit surgically.
- `src/components/objective/layer-shelves-view.tsx` (~1130) — the layer-shelves canvas (the shelves *are* the canvas).

Board layer (tldraw)
- `src/components/objective/whiteboard-base.tsx` (~565) — the **only** tldraw consumer; listens for board-bus events.
- `src/components/objective/board-bus.ts` (~66) — tldraw-free CustomEvent dispatcher + sessionStorage cross-page queue (no tldraw import on purpose).
- `src/components/objective/use-objective-board-persistence.ts` (~255) — persists the board to the `canvases` table.
- `src/components/objective/shapes/` — custom shapes: `artifact-card-shape`, `insight-card-shape`, `room-card-shape`.

Generation / logging
- `src/lib/objective-canvas/layered-generation.ts` (~1950) — room layer generation. Biggest lib file.
- `src/lib/objective-canvas/decision-log.ts` (~435) — `logDecision(db, args)`, the canonical user-move log → `sub_objective_decisions`.

## Data model (tables the canvas touches)

- `spaces` — `synthesis_data` JSONB holds `objective_canvas` (`stage`, `clarifying`, `sub_objectives`, `layers`), plus `cross_room_analysis` and `sub_objective_themes`.
- `improvement_goals` — root goal (`parent_goal_id` null) + sub-objectives (children). Carries `annotations`, `room_categories`, `room_layers_generated_at`, `layer_ordinals`.
- `entities` / `edges` — per-room items + causal edges, scoped by `parent_sub_objective_id`.
- `layer_ontology` — the four canvas stages (`pain` / `features` / `outcomes` / `objective`), seeded per space.
- `canvases` — tldraw board persistence.
- `sub_objective_decisions` — the decision log. ⚠️ has an `action` CHECK constraint — see Gotchas.

## Conventions

- TypeScript strict. Path alias `@/*` → `src/*`.
- **No `@ts-ignore` / `@ts-expect-error`** (currently zero in this module — keep it that way).
- The generated Supabase types (`src/types/database.types.ts`) are incomplete, so DB access casts the client at the boundary: `const db = supabase as any;` behind a single `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. **This is the only sanctioned `any`.** Don't spread it — type the row shapes you `select`, as `page.tsx` does.
- Comments carry the **why** (invariants, phase context, non-obvious constraints); names carry the **what**. This codebase is intentionally densely commented where the reasoning is subtle — match that, don't strip it.
- **Persist-then-emit:** live-canvas events fire only *after* the artifact row is persisted, and only structural artifacts stream to the canvas (entity/edge/cycle/etc.); thinking traces go to the audit drawer.

## Gotchas — parallel sessions

Multiple agent sessions frequently co-edit the Objective Canvas at once.

- Before editing, run `git status` + `npm run db:status` to see in-flight work. **Prefer adding new files over editing shared hot files.**
- ⚠️ **CLOBBER TRAP:** `sub_objective_decisions.action` is a CHECK constraint. Any migration that touches it must re-assert the **full superset** — `elect, reject, defer, clear, generate_batch, confirm` (and `batch_intent`: `initial, creative, concrete, contrarian, gap_fill, ambitious, wildcard`). Dropping a value silently breaks another session's writes.
- `db:push` writes to the linked **remote** project. Never assume the local migration list equals what's applied — `db:status` first, confirm before pushing.

## Before you finish

1. Run `npx tsc --noEmit`.
2. Run `npm run dev` and click through the stage(s) you changed (clarifying / picking / main / room / item drawer).
3. If you touched the board layer, confirm a card actually lands on the tldraw floor **and survives a reload** (persistence).
4. If you added a migration, re-assert constraint supersets (above) and note whether `db:push` is needed.
5. Summarize what you did.
