# Autopilot → Canvas Notebook — Diagnosis & Fix Sequence

> Make the WHOLE autopilot process visible, traceable, and complete inside the Canvas
> Notebook (the user's primary surface — drawer is invisible per the locked
> chatbox+brief decision). Diagnosis verified by direct code trace, 2026-05-29.
> Heavy parallel activity in this area — see §Coordination before editing anything.

## Root cause (one line)

Autopilot is a **client-side closure** that runs only the **back half** (score→synthesis),
with **no durable run, no timeouts, no per-step status** — and the Notebook is a **4-second
poll of a success-only log**, so anything that stalls or skips is invisible.

## Symptom → root cause (verified, file:line)

| Observed problem | Root cause |
|---|---|
| Autopilot cuts off / freezes | bare `fetch()` with no timeout → one hung LLM call froze the whole sequential run (`canvas-autopilot-runner.tsx`) — **FIXED** (`cae45db`) |
| Not visible immediately | front half (intake/objective/research) **never `logDecision`s**; notebook polls success-only rows |
| Rooms inconsistent | room-fill trigger is **ephemeral `justConfirmed`** React state, never persisted (`objective-canvas-view.tsx:172`) → reload/other-entry = no auto-gen |
| Rooms stop midway | per-room `room/generate` soft-fails on error/timeout → silent skip, no retry |
| Title refined late | `distilled_objective` roll-up is **Overview-tab-gated**, not autopilot-fired (`main-canvas-view.tsx:258`) |
| No full chain in notebook | silent steps (`no_variations` skip in `score:142`, intake, research) + **timestamp grouping** (5-min window) splits long runs (`lab-notebook-panel.tsx:1847`) |
| Can't trace notebook→room | space-scoped events carry `sub_objective_id:null` → no deep-link |
| Silent failures | soft-fail → `console.warn` only; **no pending/running/failed status rows** |

**The killer:** a freshly-generated room whose features have no variations → `score` returns
`no_variations` **silently** + **skips refine** → autopilot "runs" but writes **zero notebook
rows** for that room. That's the "notebook appears but autopilot work doesn't show."

**FIX (verified 2026-05-29) — the single highest-leverage notebook-visibility fix:** the
autopilot runner must call **`item/expand`** (generates the 3-5 variations; **idempotent** —
short-circuits on cached detail, `expand/route.ts:307,385`) for each feature **BEFORE** `score`
(which gates on `expanded_detail.variations.length`, `score/route.ts:141-148`). The loop skips
`expand` entirely today, so fresh rooms score nothing. Wiring `expand → score → refine` makes
autopilot actually produce per-room work → real `score`/`rd_iterate` notebook rows appear.
*(Belongs in `canvas-autopilot-runner.tsx` — parallel-hot right now; HAND to its owner.)*

## Fix sequence (ordered)

1. ✅ **Freeze guard (BOTH runners)** — per-stage `fetchWithTimeout` (AbortController) so a hung LLM call can't freeze the run. **DONE: autopilot runner `cae45db` (120s/stage), room-fill runner `9f7bfe1` (180s/room).**
2. **Room-gen reliability — trigger fix (remaining half).** ▶ TODO: replace the ephemeral `justConfirmed` trigger (`objective-canvas-view.tsx:172` → `autoFillRooms={justConfirmed}` `:289`) with the PERSISTED `pipeline_mode` (already on the space: `start/route.ts:115`, `load-room-data.ts:93`) so rooms auto-fill on ANY canvas mount in autopilot mode, not just the live confirm click. `room-fill-runner` already targets only ungenerated rooms (`main-canvas-view.tsx:487` `subs.filter(!generatedAt)`) + is idempotent → the fix is `autoFillRooms = justConfirmed || pipelineMode === "autopilot"`. BUT `pipelineMode` isn't threaded into the view yet (needs page → `objective-canvas-view` → `main-canvas-view` prop). **HAND TO the front-half/intake owner** (`INTAKE_TO_BRIEF_SURFACING_PLAN`) — threading it through the intake views collides with their rework.
3. **Visibility** — mint a real `run_id` at autopilot start; thread it into every `logDecision` metadata; emit **per-step status rows** (pending/running/completed/failed/skipped) so `no_variations`/errors become visible; group the notebook by `run_id` not the 5-min timestamp window. *(touches `decision-log.ts` + `lab-notebook-panel.tsx`.)*
4. **Front-half orchestration** — wire intake→objective→clarify→annotate→layers→room-gen into the SAME run so the notebook shows the whole chain from prompt to deliverable (no orchestrator spans this today).
5. **Durable server run** — move the loop onto `pipeline_runs`/`pipeline_run_events`/SSE (survives reload, resumable, real-time). *Needs 2 CHECK migrations (`pipeline` value + a status `event_type`).*
6. **Title at the right stage** — fire the macro roll-up as a named autopilot step (emit a notebook row), not Overview-gated.

## Coordination — heavy parallel activity (verify git before ANY edit)

- **HOT, do NOT touch (parallel editing right now):** `lab-notebook-panel.tsx`, `decision-log.ts`
  — these are exactly the notebook + log files Step 3 needs. The visibility work overlaps with
  active parallel sessions; coordinate, don't clobber.
- **Parallel-owned / in-flight:** the chatbox+brief surfacing rework (`INTAKE_TO_BRIEF_SURFACING_PLAN.md`)
  + shipped helpers (`derive-depends-on`, `data-unit-registry`, `compose-rich-narration`,
  `compose-experience-brief-section`). The front-half/Step-4 work likely lives here.
- **Migration-gated:** Step 5 needs 2 CHECK migrations; a parallel migration
  (`20260906_deliverable_visibility.sql`) is already uncommitted — don't stack more now.
- **Safe for an isolated session:** Step 1 (done); Step 2 is mostly on clean files but in the
  hot zone — re-verify git state + edit surgically, or hand to the front-half owner.

## Reusable vs restructure
- **Reuse:** `logDecision` + 40+-action `DecisionAction` union; the notebook GET enrichment +
  `visualFor` renderer (handles every action + a default — no whitelist drop); the idempotent,
  soft-failing stage routes; `room/generate` cache semantics; the existing `pipeline_runs`/SSE infra.
- **Restructure:** the client run loop → durable server run; timestamp grouping → `run_id`;
  success-only rows → status rows; ephemeral `justConfirmed` → persisted intent.
