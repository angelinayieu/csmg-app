# Complexity → Deliverable — Build Spec

> The north-star track: make the **Strategy Brief carry the full engineering complexity**
> so it becomes the world-class tech spec everything else optimizes for. Today the depth is
> generated and then **dropped** before the deliverable. Verified by direct read + grep,
> 2026-05-29. Runs in PARALLEL to, and complementary with, the other tracks (see §Coordination).

## The proof (why this track exists)

`mechanism_spec` — the artifact holding all engineering depth (`mechanism_of_action`,
`system_components`, `runtime_flow`, `implementation_methods` + ADR, `acceptance_criteria`,
`kill_criteria`, `research_basis`, `quality_score`) — is consumed by the **item drawer**
(`item-detail-drawer.tsx`) and the **per-variation** routes (`export-prompt`, `mockup`,
`description-doc`, `prototype`). It is consumed by the **strategy brief: 0 times** (grep =
0 in `build-strategy-brief.ts`, `strategy-brief-view.tsx`, `brief/polish/route.ts`).

`buildStrategyBrief` reads only `expanded_detail.composed_design`, `.variations`,
`.prototype_briefs`, `.expansion_tree`. **The brief is a strategy read-out, not a tech spec** —
the deepest artifact dies at the brief boundary.

## Ground truth (verified)

- `ExpandedItemDetail.mechanism_spec?: MechanismSpec | null` (`expand-item-detail.ts:579`);
  `MechanismSpec` type exported from `enrich-mechanism-spec.ts`.
- The mechanism spec lands at "senior-architect sketch," not "staff-engineer build" depth:
  it NAMES algorithms/systems (e.g. "Content Filtering Algorithm") + picks an approach via a
  real ADR, but doesn't DESIGN the algorithm/schemas; `research_basis` is LLM-invented.
- `build-strategy-brief.ts` + `strategy-brief-view.tsx` are **clean in git** (safe to edit).
- The Step-2 `macro_problems` findings ALREADY flow into the brief's `open_items` — so the
  brief is already partly fed by the coordination track. Good synergy to build on.

## The sequence (deliverable-first → substance → structure)

| # | Step | What | Files | Schema? |
|---|---|---|---|---|
| **1** | **Carry the depth into the deliverable** | aggregate each specced mechanism's `mechanism_spec` into a "Technical specification" section of the brief (data + markdown export, then the on-screen view) | `build-strategy-brief.ts`, `strategy-brief-view.tsx` (both clean) | none |
| **2** | **Deepen the nodes** | upgrade `enrich-mechanism-spec.ts` so depth is *buildable* — specify the named algorithm + data schemas; ground `research_basis` in the evidence registry (real effect sizes) | `enrich-mechanism-spec.ts` + evidence-registry read | none |
| **3** | **Weave the chain** | the macro→micro→macro chain (= MACRO_ROLLUP Step 6) rendered IN the deliverable as the system spine linking the per-mechanism specs; concept identity (MACRO_ROLLUP Step 5) for cross-room reliability | new `compute-macro-chain.ts` + brief section | none (Step 5 needs a migration — defer) |

Step 1 alone makes the brief a tech spec (using depth that already exists). Step 2 makes it
deep. Step 3 makes it connected.

**Live coordination status (2026-05-29, discovered mid-build):** Steps 1 AND 2 are BOTH in-flight
in parallel sessions — `build-strategy-brief.ts` is dirty with a `BriefMechanismSpec` type +
`mechanism_specs` per room (Step 1 **data layer DONE by a parallel session**), and
`enrich-mechanism-spec.ts` is dirty (**Step 2 in-flight**). Remaining Step-1 tail NOT yet done:
the markdown export + the on-screen `strategy-brief-view.tsx` render of `mechanism_specs`.
**To stay complementary, THIS session takes Step 3 (the chain — all new files, zero collision)**,
which is also the top-priority "systems interweaving." The brief-view render should follow only
AFTER the parallel Step-1 data layer commits — couple to its final `mechanism_specs` shape, don't
fork it.

## Coordination — complementary, not colliding

This track is deliberately scoped to files the other tracks DON'T own:

- **vs the Autopilot track** (parallel sessions — run-id threading, SSE, room-fill): ORTHOGONAL.
  That track is about *how generation runs + live recording*; this is about *deliverable depth*.
  They meet only positively: autopilot Step 5 (chain scoring after fill) ensures mechanisms get
  specced/scored → richer input to this brief. No shared files.
- **vs the MACRO_ROLLUP track** (board coordination): this track **subsumes its Steps 5–6**
  (concept identity + cross-level chain) — they were always in service of the deliverable.
  MACRO_ROLLUP Steps 1–4 (seam ✓, roll-up ✓, Overview UI, autopilot-wire) stay as the board
  track. The `macro_problems` findings (Step 2) already feed the brief — reuse, don't duplicate.
- **vs the Overview card** (`macro-summary-card.tsx`, parallel-owned): COMPLEMENTARY faces —
  the Overview is the *macro at-a-glance*; the brief's tech-spec section is the *deep per-mechanism
  build detail*. Different altitudes of the same object. Do NOT touch `macro-summary-card.tsx`.
- **vs the current codebase**: REUSE, don't rebuild. Consume the existing `mechanism_spec`
  (generated by `enrich-mechanism-spec`); reuse `renderStrategyBriefMarkdown`'s pattern; reuse
  the analyses/findings already in `CrossRoomState`.

## What NOT to do (collision avoidance)

- **Don't touch** `macro-summary-card.tsx`, the autopilot runners, `decision-log.ts`,
  `lab-notebook-panel.tsx`, `main-canvas-view.tsx`, `objective-canvas-view.tsx`, or the
  priority-vector files — all under parallel edit. Verify `git status` before each edit.
- **Don't add a parallel mechanism generator** — consume the existing `mechanism_spec`.
- **Don't do Step 3's concept-identity migration** while a parallel migration is uncommitted.
- **Don't re-derive** `macro_problems` — they already flow to the brief as `open_items`.
