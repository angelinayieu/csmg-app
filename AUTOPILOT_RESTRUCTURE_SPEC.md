# Autopilot — Finalized Build Plan (verified, sequential)

> The canonical autopilot plan. Every file path below was opened or grep-verified
> against the codebase on 2026-05-29 — not inferred from agent summaries. Goal:
> autopilot that (a) generates each room's internal content and (b) is recorded
> live, built by augmenting what exists. Broader product roadmap (funnel gate,
> agent export, rigor wiring) lives in `CROSS_AUDIT_AND_BUILD_SEQUENCE.md`.

---

## Ground truth (verified by direct code read)

- **Autopilot is 100% client-side.** `src/components/objective/canvas-autopilot-runner.tsx`
  fires `fetch()`s in a loop; `…/autopilot/start/route.ts` is a logging header, not an
  orchestrator. Run state lives only in React state → tab close = lost, no resume.
- **It starts at SCORING.** The loop runs `score → refine → enrich-chains → (opt) mechanism-spec
  → scan`. Anything before that is separate. Missing prerequisites are **silently skipped**
  (`score` returns `no_variations`, logged nowhere).
- **Two distinct generation stages — NOT one** (a common mis-citation):
  - Objective-level layer ontology (the L1–L4 macro stack):
    `src/app/api/brainstorm/space/[spaceId]/layers/generate/route.ts`
  - Per-room internal content (the 4-stage Pain → Outcomes → Features → Correlations):
    `src/app/api/brainstorm/room/generate/route.ts` — idempotent on `mode:"initial"`,
    logs `room_generated`. *(There is no `layers/generate-room` route.)*
- **Annotation is SILENT on every live surface** — verified 0 logging calls in BOTH
  `src/app/api/brainstorm/annotations/generate/route.ts` and
  `src/app/api/brainstorm/sub-objectives/[id]/annotate/route.ts`. Stored on
  `improvement_goals.annotations` *(there is no `objectives` table)*.
- **Live record = two tables:**
  - `sub_objective_decisions` — the Lab Notebook. Append-only, **freeform JSONB `metadata`
    (no CHECK)**, polled ~4s, grouped by **timestamp proximity (no run-id)**. Action column
    HAS a CHECK constraint (`src/lib/objective-canvas/decision-log.ts`) — adding an action
    requires re-asserting the **full superset** (clobber trap).
  - `pipeline_run_events` + SSE `src/app/api/pipeline/stream/[runId]/route.ts` (500ms poll) +
    `src/lib/events/structural-event-bus.ts` — true streaming, but **never touches autopilot**.
    Both `pipeline_runs.pipeline` and `pipeline_run_events.event_type` have CHECK constraints,
    so putting autopilot on this bus needs **two full-superset re-assert migrations**.

## Already shipped — do NOT rebuild

- ✅ **Post-approval room-fill** (this session): `src/components/objective/room-fill-runner.tsx`
  + `objective-canvas-view.tsx` (`justConfirmed` → `autoFillRooms`) + `main-canvas-view.tsx`
  mount. After the user approves sub-objectives, auto-runs `room/generate` for every
  not-started room; opens the notebook so `room_generated` events stream in. tsc-clean.
- ✅ **Priority vector** (parallel session — DON'T duplicate): `src/lib/objective-canvas/priority-vector.ts`,
  `src/app/api/brainstorm/sub-objectives/[id]/priorities/route.ts`,
  `supabase/migrations/20260904_priority_vector.sql`. 5-dim, LLM-inferred, on
  `improvement_goals.priority_vector`. `priorities_set` already added to the action CHECK.
- ✅ **Glossary registry + view** (placement only is wrong): `src/lib/objective-canvas/generate-glossary.ts`
  (text-keyed), `src/components/objective/notebook-glossary-view.tsx` (lives in the notebook
  rail), `src/app/api/brainstorm/space/[spaceId]/glossary/route.ts`. `concept_slug` is
  planned, not built (`ROOM_ANNOTATION_GLOSSARY_PHASE2_PLAN.md`).

---

## The sequence — exactly what to do, in order

| # | Step | Where (verified paths) | Schema? | Status |
|---|---|---|---|---|
| **1** | **Post-approval room-fill** — generate internal content of every room after approval | `room-fill-runner.tsx` + canvas/main views | none | ✅ **done** |
| **2** | **Annotation live events** — emit to the notebook from both annotate routes so the first, most KG-shaping step is visible | `annotations/generate/route.ts`, `sub-objectives/[id]/annotate/route.ts`, `decision-log.ts` | +1 action (full-superset re-assert) | ✅ **done · migration applied (live: 35 actions, verified)** |
| **3** | **Run-id threading** — client-mint a `runId` in the room-fill + autopilot runners, thread it into each stage's `logDecision` metadata, group the notebook feed by `runId` not timestamp | `room-fill-runner.tsx`, `canvas-autopilot-runner.tsx`, stage routes, notebook grouping | none (metadata is freeform JSONB) | ▶ **next** |
| **4** | **Richer room-fill narration** — emit per-sub-stage progress (pain → outcomes → features → correlations) so the user watches *inside* each room fill | `room/generate/route.ts` | none | next |
| **5** | **Chain scoring after fill** — on room-fill complete, auto-run the existing score/refine pass so approval → fill → score is one sweep; de-dup the two runners while here | `room-fill-runner.tsx` → `canvas-autopilot-runner.tsx` | none | then |
| **6** | **Server orchestration + true SSE** — move the loop server-side over `pipeline_runs`/`pipeline_run_events`; add `"autopilot"` pipeline + a narration `event_type`; point the feed at the existing SSE. Resumable, survives tab close, true streaming | `structural-event-bus.ts`, `pipeline/stream/[runId]`, a new server runner | **2 CHECK migrations** | **defer** until parallel session's migration lands |

### Step detail for the immediate ones

**Step 2 — Annotation live events** *(smallest, highest-leverage)*
1. In both annotate routes, after the LLM extraction, call `logDecision({ action: "annotated", metadata: { phrase_count, source } })`.
2. Add `"annotated"` to the `DecisionAction` union in `decision-log.ts` **and** to the `sub_objective_decisions` action CHECK via a migration that **re-asserts the full existing superset** (per `project_parallel_workstreams` — never drop+add just the new one).
3. The notebook already polls + renders decision rows, so it surfaces automatically. Result: "Reading your objective… extracted 14 concepts" appears live.

**Step 3 — Run-id threading** *(fixes the #1 fragility, no migration)*
1. `const runId = crypto.randomUUID()` at the top of `runFill` / `runCanvasAutopilot`.
2. Include `run_id: runId` (and a one-line `narration`) in the `metadata` of every `logDecision` the stages already write (`sub_objective_decisions.metadata` has no CHECK — free to extend).
3. Group the notebook timeline by `metadata.run_id` instead of timestamp proximity. *(The notebook file is being edited by the parallel session — coordinate or do this grouping in a read-only wrapper.)*

---

## What NOT to do (deliberate)

- **Don't rebuild the priority vector** — the parallel session owns it. Verify it joins into
  scoring (`score-variation-effectiveness.ts`) once it lands; don't touch its files.
- **Don't do Step 6's migrations now** — a concurrent session has an uncommitted migration
  (`20260904_priority_vector.sql`); two more CHECK re-asserts on top risks collision.
- **Don't add a 7-layer band column** before the 4-axis "layer" disambiguation
  (see `OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md` §3): altitude / abstraction-stack /
  causal-stage / coupling are distinct and "layer" already over-refers to three of them.
- **Don't pre-generate everything** for cross-weave — only the *vocabulary* (glossary at
  intake, via `concept_slug`) is worth pre-generating; full pre-gen explodes LLM cost.
- **Don't unify the two event tables** — different lifetimes (ephemeral SSE vs durable audit).
- **Don't trust a path you haven't grepped** — these are verified as of 2026-05-29; re-check
  before editing, since the tree is under concurrent edit.

---

## Verification log (2026-05-29)

`room/generate` exists; `layers/generate-room` does **not**. Both annotate routes: 0 live-stream
calls. No `objectives` table. `space/[spaceId]/layers/generate`, `notebook-glossary-view.tsx`,
`space/[spaceId]/glossary` route, `priority-vector.ts` + priorities route + migration,
`canvas-autopilot-runner.tsx`, `room-fill-runner.tsx` — all present. Step 1 ships tsc-clean.
