# Computational-Substance Roadmap

**Status as of 2026-04-24 — what's real math, what's LLM prose, and what it would take to close each gap.**

This file exists because the UI uses the same words ("confidence", "lift", "calibration", "simulation", "mechanism") for quantities produced by very different processes. Honest provenance tagging (migration `20260531_score_provenance.sql`) and UI badges are now live. This document tracks the remaining bridges from "Tier-N labeled as Tier-M" down to where they actually live, and what work ships each tier upward.

## Current state (post-2026-04-24 provenance pass)

| Component | Today | Wears label | Provenance tag |
|---|---|---|---|
| Edge-level mechanism propagation (polarity/dynamics/strength → MC) | **Tier 4** — real | "simulation" | ✅ `mc_simulation` on apps.state + proposal distributions |
| Monte Carlo engines (`src/lib/simulation/monte-carlo.ts`, `src/lib/pipeline/monte-carlo.ts`) | **Tier 4** — real, seeded, gated | "Monte Carlo" | ✅ correct |
| Bootstrap resampling (`src/lib/pipeline/bootstrap-simulation.ts`) | **Tier 4** — real | "bootstrap" | ✅ correct |
| Strategizer ranker (`src/lib/pipeline/space-strategizer/ranker.ts`) | **Tier 3** — weighted composite | "rank" | ✅ correct |
| Strategy composite ranker (`src/lib/pipeline/strategy-composite-ranker.ts`) | **Tier 3** — NEW this pass | "rank_score" | ✅ `composite_computed` |
| Proposal confidence chip (`canvas-proposal-rings.tsx`) | Mixed Tier 1 / Tier 4 by distribution source | "confidence" | ✅ badge discloses; amber for LLM, blue/green for MC |
| Variant `aggregate_lift` (`iv-scorer.ts`) | **Tier 2** — LLM self-rating aggregated arithmetically | "% lift" | ✅ tagged `llm_review`; UI shows ✎ icon + `~` prefix |
| Reality calibration (`reality-calibration.ts`) | **Tier 1** — LLM judges KG | "calibration" | ✅ relabeled "LLM Reality Audit" in drawer header |
| `mechanisms` table rows | **Tier 1** — widget-routing tags | "mechanism/kind=simulation" | ⚠️ not yet relabeled — see roadmap |
| `twin_proposals` | **Tier 1** — LLM proposals | "twin" | ⚠️ not yet relabeled |
| `ProbabilityNode.probability` (per-axis generators) | **Tier 1** — LLM-assigned scalars | "probability" | ⚠️ not yet tagged |

## Deferred work — ranked by leverage

### R1 — MC-backed variant lift (Tier 2 → Tier 4)

**What:** Replace `iv-scorer.ts`'s LLM self-rating with a real lift computation:
1. For each scored variant, map the variant's slot fills to a set of KG entity-value perturbations (e.g. filling the "trigger" slot = raising confidence on a specific trigger entity from 0.4 → 0.9).
2. Run `simulateEntityChain()` twice: once with the perturbation applied, once without.
3. `aggregate_lift = (p50_with_variant - p50_baseline) / |p50_baseline|`.
4. Write `score_provenance = "mc_lift"` and `sampleCount = 500`.

**Blockers:**
- Requires a variant→KG-intervention mapping that doesn't exist. Options: (a) extend taxonomy.slots[*] with `target_entity_id` and `magnitude`, (b) LLM once per variant to translate slot fills into perturbations, (c) require users to annotate which entity each slot influences.
- Target outcome entity must be resolvable per variant.

**Effort:** ~1-2 days. Low runtime cost once mapping exists.

**Priority:** High. This is the single biggest credibility fix — the carousel's "% lift" numbers are currently LLM self-reports that users reasonably read as A/B test outcomes.

### R2 — Numerical reality calibration (Tier 1 → Tier 4)

**What:** Replace the LLM call in `reality-calibration.ts:107-114` with a deterministic recomputation:
1. For each `MetricBaseline`, walk the claim-ledger to identify constituent entities.
2. For each entity, look up its structural value from the KG (confidence × strength propagated through in-edges).
3. Aggregate per the baseline's declared formula (sum / ratio / etc.) — `MetricBaseline` needs a `formula_kind` field.
4. Compare to declared baseline value within the `DEFAULT_TOLERANCE`; verdict from numerical comparison.
5. Write `verdict_provenance = "numerical_recompute"`.

**Blockers:**
- `MetricBaseline` doesn't carry a formula today. Schema change needed.
- Entity → baseline mapping is currently implicit (label-matching). Needs explicit links, probably in the claim-ledger.

**Effort:** ~1-2 days assuming baselines can be decomposed into additive/ratio formulas. Some baselines may not be numerically decomposable (qualitative claims like "brand is perceived as premium") — those stay `llm_audit` and that's honest.

**Priority:** Medium-high. Credibility fix for the "calibration" label.

### R3 — Tier 4 → Tier 5: continuous-time ODE engine

**What:** Replace the discrete-timestep scalar-multiplier loop in `monte-carlo.ts:188-215` with RK4 numerical integration:
1. Each edge's `dynamics` becomes a right-hand-side function: for `compounding`, `dx/dt = k*x`; for `decay`, `dx/dt = -k*x`; for `threshold`, `dx/dt = k*(x > threshold ? 1 : 0)`; etc.
2. `dynamics_properties JSONB` column already exists to hold rate constants + time constants.
3. Feed the RHS into an RK4 solver with adaptive step size (~200 LOC).
4. `simulation_distribution.provenance = "ode_rk4"`.

**Blockers:**
- Some dynamics don't have obvious continuous analogs (conditional gates are discrete by nature). Need a clean type split between "continuous dynamics" and "discrete rules."
- Stability analysis for user-authored graphs (stiff systems will blow up RK4 without adaptive step).
- Numerical performance — 1000 iterations × 100 nodes × RK4 step cost is significantly more expensive than the current multiplier loop.

**Effort:** ~1 week including stability testing.

**Priority:** Low right now. The Tier-4 MC is not what users are complaining about — the complaints are about fake Tier-4 labels on Tier-1 components, not about wanting more math in the Tier-4 core. Revisit after R1+R2.

### R4 — Relabel `mechanisms` table semantics

**What:** The `public.mechanisms` table has `kind ∈ {simulation, prediction, validation, …}` but these rows don't run simulations — they route which widget shows up. Either:
- (a) Rename `kind` → `widget_hint` and update `materialize-mechanisms.ts` + `app-manifest-builder.ts` references. Semantic accuracy.
- (b) Wire the tags to actually execute a small routine (e.g. `kind=simulation` rows auto-stamp a real MC distribution on the linked app). This is R1-adjacent.

**Blockers:** Touches many call sites. Need to audit every `SELECT * FROM mechanisms` consumer.

**Effort:** ~3-5 hours for option (a). Option (b) wraps into R1.

**Priority:** Medium. The word "mechanism" is especially misleading because it implies executable causal logic.

### R5 — Agent-authored executable tools

**What:** Today agents CAN'T write new executable code. They configure from a closed registry of ~28 widgets and 23 action kinds. To get "agent wrote you a custom tool on the spot," we'd need:
1. A sandbox (v8 isolate / Pyodide / Deno Deploy Subhosting).
2. A vetted subset of tldraw-shape + computation API the agent can emit as data.
3. A code-review / safety pass before execution.
4. A binding between agent-emitted code and specific KG entities / MC engines so the agent can compose, not just wrap.

**Blockers:** Whole subsystem. Each sandbox choice has its own operational story.

**Effort:** ~2-4 weeks for a first cut with a single sandbox choice + small computation whitelist.

**Priority:** Low. The current "configure from a fixed registry" model is NOT a lie — it's just not the marketing. Reframe the product's value prop ("agents wire real MC simulators to your specific graph") rather than promise custom code.

### R6 — `ProbabilityNode.probability` numerical backing

**What:** Per-axis generators emit `ProbabilityNode.probability` + `ProbabilityEdge.probability` as LLM-self-reported scalars. For each, add a numerical backfill:
- Node probability from co-occurrence frequency in supporting evidence
- Edge probability from agent-consensus (multiple agents vote)
- Or from MC-forward-pass of parent nodes

**Blockers:** Requires evidence-count infrastructure (exists) + agent-consensus voting (partial in `agent_convergence_count`).

**Effort:** ~1 day.

**Priority:** Low-medium. These numbers are already tucked behind a "Why this lens" expand — lower surface area than the proposal/variant cards.

## How to add a new provenance-tagged field (process)

1. Add the provenance column to the migration (or extend the enum of an existing one).
2. Update the writer (LLM-scorer / MC engine / ranker) to stamp the tag.
3. Update the type in `src/types/pipeline-events.ts` or the relevant schema type.
4. Update the UI to render a badge (copy the pattern from `canvas-proposal-rings.tsx` or `variant-carousel-widget.tsx`).
5. Update this doc with the row.

## What good looks like

Long-term the UI should be able to answer "what is the computational basis of this number?" for every number it renders — and the answer should be the same whether the user asks the designer or reads the code. The provenance column is the contract that makes that possible. This pass laid the substrate; R1 and R2 upgrade the two biggest Tier-1→Tier-4 candidates; R3-R6 polish.
