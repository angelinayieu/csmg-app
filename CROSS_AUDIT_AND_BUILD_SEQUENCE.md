# InterAxis — Cross-Audit & Ranked Build Sequence

> Deep cross-audit of the live codebase (data model, surfaces/journey, orchestration)
> + a module-by-module build plan ranked by user value × impact × leverage.
> Evidence from 3 parallel codebase audits, 2026-05-29. Companion to
> `OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md`, `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md`,
> `REASONING_AND_INFLUENCE_MAP.md`.

## TL;DR — the unified diagnosis

You have sophisticated modules that are **under-connected at three seams**, plus a
**missing front-of-funnel gate**. The highest-value work is **connective tissue**,
not new capability.

1. **Data seam** — there are *two graphs sharing the same tables*, partitioned by
   `spaces.space_kind` (`legacy` vs `objective_canvas`). The whole **rigor stack**
   (evidence registries → REML edge pooling → calibration → prediction feedback)
   is wired to *legacy* spaces and **structurally never reaches the Objective
   Canvas**. Two blackboards that share furniture, not data. *(This is your "does
   data feed everything that benefits?" worry — answer: justified at the seam.)*
2. **Surface seam** — **three competing front doors** (`/app` Synergy [default],
   `/app/objective`, `/app/strategy-lab`) + a largely orphaned legacy Space world.
   No single coherent journey.
3. **Orchestration seam** — the downstream value chain (layers → rooms →
   mechanisms → correlations → scoring → synthesis → strategy) is a sequence of
   **independently click-triggered HTTP stages with no inter-stage handoff**;
   "autopilot" is client-side. Only the initial KG + crons auto-fire.
4. **Funnel gap** — **no define-before-generate gate.** Generation fires from a
   ≥4-char prompt (`objective-entry-card.tsx:80`); the structured `precise-input-form`
   (outcome/constraints/success-metric) exists but is optional and wired to the
   *legacy* path only. This is the root cause of "vague mechanisms."

**Strategy:** connect the seams + add the funnel gate + close the journey to a real
output. Build on what exists; almost nothing here is net-new sophistication.

---

## Baseline module map (what exists + maturity)

| Module | State | Note |
|---|---|---|
| KG substrate (`entities`/`edges`/`layer_ontology`/`annotations`) | ✅ strong, shared | genuine shared substrate *within* a space_kind |
| Rigor stack (evidence registries, REML pooling, calibration, predictions, MC sim) | ✅ strong | **legacy-only**; never runs on objective canvas |
| Objective Canvas (entry → clarifying → picker → canvas → room → lab → brief) | ✅ built | the live product path |
| MechanismSpec (PRD/design/ADR/validation, 6-axis gate) | ✅ built | `research_basis` is LLM-invented, not from evidence registries |
| Evaluation fleet (17 agents, 3× 5-lens ensembles, tiered scorers) | ✅ strong | per-artifact + per-role, not per-layer |
| Subsystems view (composes_with clusters) | ✅ shipped this session | |
| Agent export | ◐ shallow | paste-into-chat markdown (`generate-export-prompt.ts:361`); not on the Brief |
| Define-before-generate gate | ✖ missing on canvas | `precise-input-form` exists but legacy-only |
| Orchestration handoffs (stage → stage) | ✖ manual | each stage a separate click |
| Cross-stack data flow (rigor ↔ canvas) | ✖ siloed | `space_kind` partition |
| Orphans | — | `space-calibrate`, `back-prop-refinement`, `proactive-proposals` (zero callers) |

---

## Ranked build plan (importance × impact × user-value × leverage)

Rank = how much it moves *user value* now, weighted up when it reuses existing code
(leverage) and down by effort. Your stated focus (user functionality + agent-ready
output) is weighted heavily.

| # | Module to build | What | Why (user value) | Impact | Effort | Reuses |
|---|---|---|---|---|---|---|
| **1** | **Define-before-generate gate** | wire the existing `precise-input-form` (desired result · blocking problem · constraints · success metric · key terms) into the Objective Canvas entry, BEFORE generation | fixes the ROOT cause of vague mechanisms — every downstream artifact gets sharper | ★★★★★ | M | ✅ form exists |
| **2** | **Real agent-ready export** | upgrade the shallow markdown into a structured build-spec (add `acceptance_criteria` + `scope_boundaries` to MechanismSpec) and surface it on the Strategy Brief (today a dead end) | delivers the user's actual goal — "instructions to give an agent to build the app"; closes the journey | ★★★★★ | M | ✅ MechanismSpec + export |
| **3** | **One coherent front door** | make `/app` default to the Objective Canvas; link Brief → export/next-action; demote/merge Synergy + Strategy Lab + legacy | removes the 3-door confusion; one journey | ★★★★☆ | M (product decision) | ✅ nav |
| **4** | **Auto-handoff orchestration** | chain layers → rooms → mechanisms → synthesis server-side (promote the client `CanvasAutopilotRunner` into a real stage chain over the existing event bus) | feels intelligent; removes manual clicking | ★★★★☆ | M | ✅ event bus + routes |
| **5** | **MechanismSpec ← evidence registries** | `enrich-mechanism-spec` queries `evidence_registries` for the feature's outcome → cite REAL pooled effect sizes instead of inventing `research_basis` | rigor the user keeps asking for; real grounding | ★★★★☆ | M | ✅ bridge-to-evidence |
| **6** | **REML pooling on canvas edges** | run `recompute-edge-strengths` for `objective_canvas` spaces (they already key on `space_id`); stop hardcoding `confidence:0.6` | edges get real confidence | ★★★☆☆ | M | ✅ pooler |
| **7** | **MechanismSpec → strategy/twin** | feed mechanism specs into the strategy engine / twin (today a dead-end) | cross-feature flow; mechanisms inform strategy | ★★★☆☆ | M-H | ✅ strategy engine |
| **8** | Reasoning-mode tags · storytelling summary · decision-framing | label inferences' logic-type + certainty; persuasive summary; reversible/impact×effort tags | transparency + influence polish | ★★★☆☆ | S–M | ✅ |
| **9** | L3 mechanism data-flow view + directional `depends_on` | DFD of a mechanism's runtime_flow; enrich generator for direction | deep technical view | ★★☆☆☆ | M-H | ◐ |
| **10** | Full cross-feature "blackboard" data substrate | systematic publish/subscribe of subsystem data to all consumers | the ultimate cross-support vision | ★★★★☆ (later) | H | — foundational first |

---

## Sequenced phases

- **Phase 1 — Close the funnel** (modules 1, 2). Highest value, mostly wiring what
  exists; brackets the journey (sharp input → buildable output). *Start here.*
- **Phase 2 — Make the journey coherent** (3, 4). One door + auto-handoff.
- **Phase 3 — Connect the rigor (the data seam / your core worry)** (5, 6, 7).
  This is where "data feeds everything that benefits" actually gets built — and it's
  mostly re-pointing existing producers at the objective-canvas population.
- **Phase 4 — Polish & advanced** (8, 9, 10). Only after the bones connect.

## Honest notes

- Modules 1–7 are **augmentations of existing code**, not new subsystems — consistent
  with the cross-cutting finding that the gap is coherence, not capability.
- Module 3 is partly a **product decision** (which front door wins) — flag for the user.
- Module 10 (full blackboard) is the only genuinely large net-new effort; it should
  come last, after the seams are stitched, or it just adds more to disconnect.
- Confidence: high on the *diagnosis* (3 independent audits agreed); the *effort*
  estimates are rough (M = ~days, H = ~weeks).
