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

1. **Verify end-to-end on the live space** (read-only, highest value) — run/inspect the macro roll-up, confirm the Overview + AgentBuildSpec populate, and read the `data_flow_cross_feature` to judge whether the upstream/downstream dependencies are sensible. *This tells us if the wired system actually delivers your priority.*
2. **Close gap 1** — populate `depends_on` from the cross-feature flow (real per-feature dependencies on the tech spec).
3. **Retire the redundant chain spine** (gap 4) — keep the surface area clean.
4. **Precision pass** (gap 2) — deepen nodes + evidence-ground + calibrate (the substance upgrade).
5. **Auto-fire** (gap 5) — fold the roll-up + spec into the autopilot sweep.
