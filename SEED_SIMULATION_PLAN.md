# Seed Simulation Plan — make leverage a *modeled* effect, honestly

> Status: execution-ready plan, 2026-06-09. Goal: move the seed from "the model
> *thinks* this is high-leverage" → "moving this variable has a **modeled P50/P90
> effect** on the outcome, with an explicit **grounding** level." Reuses the
> existing Monte Carlo engine + REML pooler; builds only the missing layer.

---

## 0. What this buys — and the one non-negotiable constraint

**Buys:** leverage stops being a rubric (Meadows + centrality) and becomes a *computed marginal effect* (∂outcome/∂lever from simulation); variable interactions get *propagated* (cycles + dynamics, not just structure); value-of-a-course-of-action gets *distributions* (P50/P90), which un-orphans the composite ranker.

**Constraint (read twice):** a simulation is only as honest as its edge magnitudes. If the βs are LLM-guessed and we render a crisp "P50 = +18%", we've built **confidence theater** — the exact "fancy-school idea with impressive numbers" we're trying to avoid. So the governing law of this plan:

> **Every edge carries provenance (evidence / founder / estimated). The output interval's width and label reflect the *worst* provenance on the path. A simulation on guessed βs is shown as a *sensitivity sketch*, never a forecast.**

This is what separates a real tool from a dashboard that lies confidently.

---

## 1. What already exists (REUSE — do not duplicate)

| Capability | File | Contract |
|---|---|---|
| **Pure MC engine** | `src/lib/simulation/monte-carlo.ts` → `runMonteCarlo(spec)` | in-memory, no DB, <100ms/3-hop. IN: `nodes[{id,priorMean,priorStdDev,min?,max?}]` + `edges[{sourceId,targetId,strength,polarity,dynamics,dynamics_properties?}]` + `{iterations,timesteps,seed}`. OUT: `nodes[{nodeId,p10,p50,p90,mean,stddev,samples}]`. |
| DB wrapper (walks entities/edges) | `src/lib/simulation/simulate-entity-chain.ts` → `simulateEntityChain(db,opts)` | returns `targetDistribution{p10,p50,p90,mean,stddev}` for a target entity. |
| **REML effect-size pooling** | `src/lib/evidence/edge-strength-pooler.ts` → `poolEffects(PoolingInput[])` | IN: `{effect_size,standard_error,evidence_id}[]`. OUT: `{pooled_effect,pooled_se,ci,tau_squared,n_studies}`. strength = `|pooled_effect|/1.5` clamped. |
| Evidence → edge strength orchestrator | `src/lib/evidence/recompute-edge-strengths.ts` | groups `evidence_registries` by `attached_entity_id`, pools, writes `edges.strength` + `dynamics_properties.pooling_metadata`. |
| Non-additive interaction detection | `src/lib/pipeline/interaction-discovery.ts` | MC-variance based; reuse for interaction surfacing. |
| Ranked courses-of-action | `strategy-composite-ranker.ts` | has an **`mc_p50_normalized`** signal — present only if a distribution exists. Orphaned for the seed. |
| Outcome validation ledger | `prediction.ts` / `prediction_ledger` | persist predicted P50/P90, resolve vs actuals later (the only real accuracy check). |

The engines are solid. **We build exactly one new thing: the parameterization layer.**

---

## 2. The gap, precisely

`seed.internal.reasoningGraph` = `{ nodes[{id,label,type}], edges[{source,target,relation}] }` — **qualitative**. The MC engine needs each edge to have a numeric `strength (0..1)` + `polarity` + `dynamics`, and each node a `priorMean/priorStdDev`. **No existing path produces a β for an edge that has no uploaded literature.** That path is the build.

---

## 3. The build — `seed/parameterize.ts` (qualitative graph → simulatable spec)

For each seed edge, assign `{strength, polarity, dynamics, sd, provenance}` from the best available source, in priority order:

1. **Evidence-grounded** (`provenance:"evidence"`) — if the space has `evidence_registries` rows attachable to the edge's endpoints, pool with `poolEffects()` → real strength + τ² + CI. Highest trust. (Requires the entities/edges materialization — see §6, P2.)
2. **Founder-calibrated** (`provenance:"founder"`) — the SeedChat asks, for the top ~3 edges only, "how strongly does X move Y — weak / medium / strong, and which direction?" → strength + a *tight* SD. Human judgment beats a model prior.
3. **LLM-elicited prior** (`provenance:"estimated"`) — a structured LLM call estimates `strength + polarity + dynamics` **with an explicit uncertainty band**, defaulting to a **WIDE SD**. This is the new default for ungrounded edges. Wide priors → wide output intervals → honest.

**Nodes:** `priorMean = 0` (everything is a deviation). `priorStdDev` by type — `leverage_point` = controllable, wider (you can move it); `variable` = receiver, narrow; `constraint` = bounded; the **outcome node** (the objective's success metric) = pure receiver, SD 0. Map seed `relation` → polarity/dynamics: `feeds`→positive/linear, `depends_on`→bounded (threshold or negative), `grounds`→structural (excluded from propagation or weak-positive).

**Output:** a `SimulationSpec` + a parallel `Map<edgeKey, {provenance, confidence}>`. Pure; no DB writes in P1.

---

## 4. Run + interpret — `seed/simulate-seed.ts`

1. `spec = parameterize(seed.internal)` → `runMonteCarlo(spec, {iterations:500, seed:fixed})`.
2. **Leverage = the real thing.** For each lever, perturb it one-at-a-time (Δ on its priorMean) and re-run → **∂outcome/∂lever = the simulated marginal effect on the outcome node**. Rank levers by *modeled effect on the outcome*, not Meadows+centrality. (Cheap: reuse the `perturbations` map `simulateEntityChain` already supports, or batch in the pure engine.)
3. **Value-of-action.** For each proposal/fork, apply its intervention to the spec → outcome distribution; report the **P50/P90 delta vs baseline**. Feed into `strategy-composite-ranker`'s `mc_p50` → ranked courses-of-action.
4. **Interactions.** MC already propagates through cycles + dynamics → non-additive effects are captured; reuse `interaction-discovery`'s variance method to surface the top interacting pairs.

---

## 5. Honesty layer (the part that makes it not-theater)

- **Grounding score** = fraction of edges *on the path to the outcome* that are `evidence` or `founder` grounded (not `estimated`). Carried per result.
- **Label by worst provenance on the path:** any `estimated` edge on the path → the whole result is `"modeled estimate · low grounding"`, never `"predicted"`. All-evidence path → `"forecast · grounded"`.
- **Surface it honestly:** the card shows `"modeled effect +18% · grounding 30% (mostly estimated)"`. The founder instantly knows whether this is a forecast or a structured guess.
- **Close the loop:** write the P50/P90 to `prediction_ledger` so it can be resolved against real outcomes later — the only true accuracy test (and the seed of real calibration).

---

## 6. Where it lives + the entities/edges question

- **P1 stays in-memory.** Build the spec from `seed.internal.reasoningGraph` and call the *pure* `runMonteCarlo` — **no materialization into entities/edges.** Isolated, fast, zero schema risk. Result → `seed.internal.simulation`.
- **P2 (evidence grounding) materializes.** To reuse `auto-attach` + `recompute-edge-strengths` (which key off `entities.id` / `evidence_registries.attached_entity_id`), the seed graph must become real `entities`/`edges` rows. This is the bridge that lets uploaded docs / web-researched effect sizes flow into the seed's βs. Decision to lock when we get there; P1 doesn't need it.

`seed.internal.simulation` shape:
```ts
interface SeedSimulation {
  ran: boolean;
  targetDistribution: { p10: number; p50: number; p90: number } | null;
  leverageRanking: { slug: string; label: string; modeledEffect: number; grounding: number }[];
  groundingScore: number;          // 0–1, path-weighted
  label: "forecast" | "modeled_estimate" | "sketch";
  provenanceBreakdown: { evidence: number; founder: number; estimated: number };
  updatedAt: string;
}
```

**External face:** when simulation ran *and* grounding is decent, the value chip upgrades to `"modeled +X% · grounding Y%"`; otherwise the qualitative `valueToSwitch` stays (no false precision). **Map tab (expand):** a sensitivity view — levers ranked by modeled effect, edges sized by β, **colored by provenance** (green=evidence, blue=founder, grey=estimated) so the grounding is visible at a glance.

---

## 7. Trigger + route

- New action **`simulate`** on `/api/objective/[spaceId]/seed` (or a sibling `/seed/simulate`): `parameterize → runMonteCarlo → leverage perturbations → write seed.internal.simulation → re-distill external with the modeled numbers + grounding label`.
- **On-demand first**, not auto: a *"Model the leverage"* affordance on the card/Map tab. Reasons: (a) it's the heavier step, (b) honesty — don't auto-surface numbers the founder didn't ask to trust. Auto-run later only once grounding is typically high.

---

## 8. Phasing (each phase independently shippable + honest)

- **P1 — parameterize + simulate, elicited-only (the MVP).** In-memory `runMonteCarlo` on LLM-elicited βs with wide priors. Levers ranked by modeled effect; everything labeled `"modeled estimate · low grounding"`. Proves the loop with zero literature. *This is the first real "evaluate how variables interact" — honestly caveated.*
- **P2 — evidence grounding.** Materialize seed graph → entities/edges; wire `poolEffects`/`recompute-edge-strengths` so uploaded docs + web-researched effect sizes upgrade grounded edges. Grounding score climbs; labels shift toward `"forecast"`.
- **P3 — founder calibration.** SeedChat elicits the top-3 edge strengths → `provenance:"founder"`. Cheapest grounding gain after evidence.
- **P4 — value-of-action / un-orphan the ranker.** Feed simulated distributions into `strategy-composite-ranker` → ranked proposals with `mc_p50` + risk balance. This is where forks become *ranked* bets.

---

## 9. Honest cost / benefit / trap

- **Benefit:** the only path to *quantitative* interaction + leverage evaluation; turns leverage into a computed sensitivity, gives courses-of-action intervals, and creates a validation loop (`prediction_ledger`).
- **Cost / trap:** P1's βs are LLM-elicited → the numbers are a **structured sensitivity model, not a validated forecast.** If we ever drop the grounding label, we've built the theater. The grounding score + worst-path labeling are *load-bearing*, not decoration.
- **Pressure-test still rules:** even fully wired, accuracy is unproven until P50s resolve against real outcomes. The ledger exists for exactly this — the simulation makes the claim *falsifiable*, which is itself the value.

---

## 10. Files

- **NEW:** `seed/parameterize.ts`, `seed/simulate-seed.ts`, `seed-types.ts` += `SeedSimulation`, `/seed` `simulate` action, Map-tab sensitivity view.
- **REUSE (never duplicate):** `runMonteCarlo` (monte-carlo.ts), `poolEffects` (edge-strength-pooler.ts), `recompute-edge-strengths`, `interaction-discovery`, `strategy-composite-ranker`, `prediction_ledger`.
- **DON'T:** materialize into entities/edges in P1 (in-memory only); don't surface a number without its grounding label; don't auto-run on every promote.
```
