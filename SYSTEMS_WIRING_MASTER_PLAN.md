# Systems Visualization, Wiring & Tech-Spec — Master Plan

> Priority: the systems + their upstream/downstream dependencies, **visualized,
> wired into the live UI, and showing up on the final tech spec.**
> Verified by direct read + grep, 2026-05-29.
>
> **Headline: this is ~90% built AND mounted already** (across parallel sessions).
> So this is a **convergence + gap-closure + verification** plan, not a from-scratch
> build. The biggest risk now is *adding redundant views*, not missing features.

## The verified navigation map — it's all reachable today

| Where you navigate | What you see | Status |
|---|---|---|
| Goal card → **Overview** tab | `MacroSummaryCard` — distilled objective + numbered causal path + macro sub-problems per layer | ✅ live (`main-canvas-view.tsx`, props via `build-macro-summary-props.ts`) |
| Goal card → **Map** tab | `CausalMap` — the causal system map (graph) + `MapInsightsPanel` | ✅ live |
| Goal card → **Blueprint** tab | the detailed layer cards | ✅ live |
| Room → mechanism card → **drawer** | `mechanism-experience-view`: [UI artifact] + **[Data-flow DAG]** over `runtime_flow` (produces/consumes) — the per-mechanism upstream→downstream | ✅ live (`item-detail-drawer.tsx`) |
| **Strategy Brief** → panel | `agent-build-spec-panel` → the **AgentBuildSpec**: macro architecture + per-feature specs + **cross-feature data flow (upstream/downstream)** + dependency-ordered build sequence | ✅ live (mounted in `strategy-brief-view.tsx`) |

## How the systems are wired together (the data flow that already exists)

```
macro roll-up (macro_problems + distilled_objective)
        → Overview card  +  AgentBuildSpec.macro_architecture
mechanism_spec (produces/consumes tokens, 17 refs)
        → drawer Data-flow DAG  +  AgentBuildSpec per-feature specs
cross-feature flow  (AgentBuildSpec.data_flow_cross_feature —
        "ordered labeled flows BETWEEN features, upstream/downstream,
         how the parts feed each other across layers")  +  build_sequence
        ─────────────────────────────────────────────────────────────►
                 ALL CONVERGE IN  →  the AgentBuildSpec  =  the tech spec
                 (mounted in the Strategy Brief)
```

So the "systems + dependencies → tech spec" pipeline **exists and is wired.** Upstream/
downstream is represented at two scales: **within a mechanism** (the runtime_flow DAG) and
**between features** (`data_flow_cross_feature` in the spec).

## The real gaps — the actual remaining work

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| **1** | `AgentBuildFeature.depends_on` is **stubbed `[]`** (`compile-agent-build-spec.ts:197,230`) | per-feature dependency list is empty even though `data_flow_cross_feature` exists | derive `depends_on` from the cross-feature flow (from→to) so each feature lists its real upstream deps |
| **2** | **Precision** — `data_flow_cross_feature` is LLM-synthesized; edges uncalibrated; mechanism depth is architect-sketch | the dependencies are *asserted*, not *measured* (per the precision assessment) | deepen nodes (real algorithms + schemas) + ground `research_basis` in the evidence registry + connect edge calibration (cross-audit's rigor seam) |
| **3** | **Not verified end-to-end on a real space** | the roll-up is on-demand; nothing confirms Overview + AgentBuildSpec actually populate + the cross-feature flow reads sensibly | run the roll-up on the live space → eyeball the Overview, the spec, the dependency flow |
| **4** | **Redundancy: my `compute-macro-chain` + `MacroChainSpine` now duplicate** `CausalMap` (Map tab) + `data_flow_cross_feature` (spec) | adds a 3rd overlapping representation — the exact "too many views" problem to avoid | **retire / don't wire** the chain spine; revive only if CausalMap proves insufficient for the linear macro→micro→macro reading |
| **5** | **On-demand, not constant** — roll-up + spec compile only when triggered | "cross-communicating constantly" isn't true; it's batch | autopilot auto-fires the roll-up + spec after room-fill (Autopilot plan Steps 4–6) |

## Coordination (heavy parallel activity — verify before any edit)

- **Parallel-owned, do NOT touch:** `compile-agent-build-spec.ts` + `agent-build-spec-panel.tsx`, `mechanism-dataflow-view.tsx` + `mechanism-experience-view.tsx`, `build-macro-summary-props.ts`, `enrich-mechanism-spec.ts`, and the dirty board/brief/drawer/notebook files (`main-canvas-view`, `strategy-brief-view`, `item-detail-drawer`, `lab-notebook-panel`, `objective-canvas-shell`).
- **Safe for this session:** read-only verification (gap 3); a new `depends_on` derivation helper (gap 1, new file consumed by the spec — coordinate the one-line call site); retiring my own harness files (gap 4).
- Related design docs already exist: `AGENT_EXPORT_SPEC.md`, `MECHANISM_EXPERIENCE_SPEC.md`, `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md`.

## Ordered next actions (for the ASAP priority)

1. ✅ **DONE — verified end-to-end (2026-05-29).** Live `Monetary Value Feedback Loop` space:
   the macro roll-up HAS run (12 `macro_problems` findings + 1 `distilled_objective`), and
   **10 of 17 features are specced**. So the Overview card, the polished brief title, the
   AgentBuildSpec tech spec, and the drawer data-flow DAG all populate with REAL data; the 7
   un-specced features degrade gracefully ([NEEDS CLARIFICATION]). **The wired system delivers.**
   *(Caveat: this populated only because the roll-up was run on-demand — see #6.)*
2. ✅ **DONE — brief title polished (commit `f75f9c1`).** The brief header + markdown export now
   lead with `distilled_objective` (raw prompt demoted to a collapsible "Full objective"),
   fallback-safe. Closes the "title is just the raw prompt" complaint.
3. ✅ **DONE — retired the redundant chain spine (commit `e252112`).** `compute-macro-chain.ts` +
   `macro-chain-spine.tsx` + harness removed (superseded by CausalMap + `data_flow_cross_feature`).

**Remaining — all PARALLEL-OWNED; recommend to the owning sessions, don't clobber:**
4. **Close gap 1** — populate `depends_on` from `data_flow_cross_feature` (real per-feature deps on the tech spec). *Owner: the `compile-agent-build-spec.ts` session.*
5. **Precision pass** (gap 2) — deepen nodes + evidence-ground + calibrate. *Owner: the `enrich-mechanism-spec.ts` session + the cross-audit rigor seam.*
6. **Auto-fire** (gap 5) — fold the roll-up + spec into the autopilot sweep so the deliverable is always populated, not on-demand. *Owner: the autopilot / `room-fill-runner.tsx` session.*

## Added scope (2026-05-29) — two gaps the current system papers over

**A. Base-unit data-flow (data lineage) view — NEW, not built, not redundant.**
Today's data-flow surfaces are *per-mechanism* (`runtime_flow` DAG) and *feature→feature*
(`data_flow_cross_feature`). Neither traces a single **base data unit** (e.g. *attention units*)
from collection → transformation → realized outcome across the layers. This is a distinct lens
— *what raw thing do we capture, and what does it become at each layer* — NOT a causal graph
(CausalMap) and NOT feature flows. Proposed home: a **4th Goal-card view ("Data Flow")** beside
Overview/Blueprint/Map.
- *Data seed (no new generation):* per-layer `variables` (the data state at each layer) +
  the layer transitions / `data_flow_cross_feature` (transform labels) + `runtime_flow`
  produces/consumes tokens (the unit tokens). Compose, don't invent.
- *Status:* prototyped in `preflight/data-lineage-preview` (this session, harness + mock).
  Wire-in (the real Goal-card tab + a compose-from-state helper) is a follow-up; the tab system
  is parallel-owned (`main-canvas-view.tsx`) → coordinate.

**B. Eval-driven algorithm selection — "optimal" is currently a misnomer.**
`MechanismSpec.decision_record.chosen` (which `implementation_method` to "use") is **LLM-asserted
at spec-gen; nothing runs or scores the alternatives** (grep-confirmed: no bake-off). To make
"optimal" real, route the `implementation_methods` through the **existing scoring tiers**
(rubric / ensemble / MC-placebo — already built) so `chosen` reflects an evaluation, then surface
the chosen algorithm on the Blueprint card + the tech spec.
- *Reuses existing evaluators* — no new scorer. Touches `enrich-mechanism-spec.ts` + the
  `score` route (**PARALLEL-OWNED** → hand to the owning session / coordinate).
