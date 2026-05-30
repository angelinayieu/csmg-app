# Multi-Chat Workstream Partition (avoid collisions)

> How to distribute the remaining work across parallel chats WITHOUT clobbering.
> The ONE rule that prevents the collisions seen this session:
> **one file = one chat.** Cross-chat needs are met by *new files* + a one-line
> mount that the file's owner makes — never two chats editing the same file.

## The chat-able workstreams (disjoint file ownership)

### Chat A — Synergism Whiteboard Interactions  ← cleanest to split off
Port the OLD `synergy/*` interaction LOGIC onto the NEW tldraw canvas, in the clean
Apple style (logic, not the old visuals): expand-card, lasso → converge, focus mode,
publish mode, on-canvas next-move recs, upstream/downstream tracing, brainstorm→feature.
- **Owns:** new `src/components/objective/canvas-interactions/*` + the tldraw custom
  tools/shapes for these. Reads the old `synergy/*` for logic (read-only).
- **Don't touch:** the object substrate, autopilot, compiler, intake.

### Chat B — Object Substrate & Library  *(this session's lane)*
Finish the `library_objects`/`object_links` model + the data API.
- **Owns:** `lib/objective-canvas/library-objects.ts`, the `space/[id]/library/objects`
  route, new read-side helpers (e.g. a `getSpecObjectsFromLibrary` the compiler imports),
  + Supabase data-ops/backfills.
- **Don't touch:** any consuming UI (it ships helpers; consumers call them).

### Chat C — Autopilot Engine + Canvas Notebook  ← CONSOLIDATE (do NOT split these two)
The whole autopilot run + notebook visibility is ONE concern. Splitting "autopilot" from
"notebook" is exactly what caused this session's collisions — they share files.
- **Owns:** `canvas-autopilot-runner.tsx`, `room-fill-runner.tsx`, `autopilot-runner.tsx`,
  the `autopilot/*` + `autopilot/log` routes, `decision-log.ts`, `lab-notebook-panel.tsx`,
  `notebook-events.ts`.
- Scope: `expand→score→refine` fix, run_id threading, per-step status rows, room-gen trigger.

### Chat D — Final Spec & Mechanism Depth
The deliverable + the depth that feeds it.
- **Owns:** `compile-agent-build-spec.ts`, `agent-build-spec-panel.tsx`, `enrich-mechanism-spec.ts`.
- Scope: derive `depends_on`; read `library_objects.included_in_spec` (from Chat B's helper);
  deepen mechanism nodes (real algorithms + evidence-ground `research_basis`).

### Chat E — Intake / Front-half / Brief Surfacing
Prompt → objective → clarify → layers → room-gen, + the chatbox+brief surfacing.
- **Owns:** the intake/clarify routes, `strategy-brief-view.tsx`, `build-strategy-brief.ts`,
  the brief-surfacing helpers (`INTAKE_TO_BRIEF_SURFACING_PLAN.md`).

*(Systems-viz — Overview/Map/data-flow views — is largely shipped; its only open items
(`depends_on`, precision) fold into Chat D. Don't open a 6th chat for it.)*

## The shared "hub" files — assign ONE owner each (the collision epicenter)

These container files everything wants to mount into. Pick a single owner; every other
chat ships a **new child component** + asks the owner for the one-line mount.

| Hub file | Suggested owner |
|---|---|
| `main-canvas-view.tsx` | Chat E (or a dedicated "Canvas Shell" owner) |
| `objective-canvas-view.tsx` | Chat E |
| `whiteboard-base.tsx` + tldraw shape registry | Chat A |
| `item-detail-drawer.tsx` | Chat C (it's the notebook/drawer surface) |

## The protocol (3 lines, paste into each chat)

1. **Stay in your owned files.** Need a change in someone else's hub file? Ship a new
   component/helper and request the one-line wire from that file's owner.
2. **New tables/migrations: announce first.** Migrations apply as raw SQL via MCP here;
   coordinate timing so two chats don't race the same table.
3. **`git status` before every edit.** If a file you're about to touch is dirty and not
   yours, stop — it's another chat's.

## Quick answer to "what's separable?"
- **Cleanly separable now:** Chat A (Synergism), Chat B (substrate), Chat D (spec+depth).
- **Keep as one (don't over-split):** Chat C (autopilot+notebook — they share files).
- **Already owned:** Chat E (intake/brief).
