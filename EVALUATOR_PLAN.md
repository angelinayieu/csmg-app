# Evaluator Plan — the brain that knows all the factors (qual + quant)

> Status: execution-ready plan, 2026-06-09. Reprioritizes above the simulation.
> Thesis: **a course of action is only as well-evaluated as the factor set it was
> judged against.** Precision on a narrow frame is false confidence. The Evaluator
> holds the FULL factor set, weighs qualitative + quantitative together, and — most
> importantly — surfaces what has NOT been considered.

---

## 0. Why this is more important than the simulation

The Monte Carlo answers "how much does moving X affect Y" — *within a frame already drawn.* It cannot tell you the frame is missing distribution, timing, or willingness-to-pay. **Getting the frame right (completeness) dominates getting the numbers precise.** So the architecture inverts:

- The **Evaluator** is the brain — a comprehensive, decision-aware factor framework + a coverage-first judgment.
- The **simulation / value-engine / crucible / composite-ranker** become **factor-feeders** — each supplies evidence to *one or a few* factors. None is the headline.

The headline output is not a score. It's: **"here is the full factor set; here's what you've considered and how strongly; here's what you have NOT considered — and which of those gaps is decisive."**

---

## 1. Honest framing of "knows ALL the factors"

No system knows *all* factors absolutely — completeness is domain-relative and itself a judgment. So we don't promise omniscience. We deliver the thing that actually beats a smart human: **explicit, self-auditing coverage.** A great evaluator holds the checklist implicitly; ours holds it *explicitly*, adapts it to the decision, actively hunts for what's missing, and *shows its coverage* so the gaps are visible. Under-promise "all," over-deliver "explicit + adversarially self-checked."

The factor set is therefore: **a strong default framework × decision-type adaptation × generative expansion × a missing-factor critic.** Completeness is asymptotic, pursued every pass — not asserted.

---

## 2. The default factor framework (the checklist)

Comprehensive, recognizable to any strong strategist/PM/VC, grouped. The Evaluator weights and extends this per decision; it never just enumerates.

**A · Desirability — do people want it?**
pain intensity (painkiller vs vitamin) · real demand / pull · job-to-be-done fit · who exactly (ICP) + how many · urgency

**B · Viability — does it make sense to do?**
value capture / willingness to pay / business model · unit economics · strategic fit (does it compound with what exists?) · opportunity cost vs other moves

**C · Feasibility — can *you* actually do it?**
technical feasibility · resource / time / skill fit · critical-path dependencies · **founder–market fit (do you have an edge here?)**

**D · Defensibility — will it last?**
differentiation vs real alternatives (← value-engine) · moat / switching cost / network effects · why won't incumbents just copy it

**E · Distribution — how does it reach people?**
channel / GTM · acquisition cost / virality · *(the most under-considered factor — often the real bottleneck)*

**F · Timing — why now?**
enabling shift / market readiness · too-early / too-late risk

**G · Risk — what kills it?**
failure modes / what-has-to-be-true · reversibility (one-way vs two-way door) · second-order & unintended consequences · external / regulatory dependencies

**H · Leverage & dynamics — systems view**
where it acts (Meadows, ← crucible) · variable interactions / feedback loops · **modeled causal effect (← the simulation, as ONE input here)**

**I · Evidence & grounding — meta**
how grounded is each claim (evidence vs assumption) · key unknowns · what to validate next

---

## 3. How the Evaluator runs (coverage-first, not score-first)

1. **Classify the decision + weight the factors.** "What kind of move is this, and which factors are *decisive* here?" (A consumer app → distribution + timing dominate; deep tech → feasibility + moat.) Weighting is **explicit and contestable**, never hidden.
2. **Generate decision-specific factors** beyond the default set, so the frame fits *this* problem.
3. **Evaluate each factor** → `{ assessment (prose), score, confidence/grounding, status: strong | weak | UNADDRESSED | unknown, weight: decisive | relevant | minor, evidence }`. Factors pull from the feeders (value-engine, crucible, simulation, composite-ranker) where available; otherwise LLM judgment with stated confidence.
4. **Multi-perspective stress test** — re-evaluate through distinct lenses (the *skeptic*, the *target customer*, the *competitor*, the *operator*). Their objections become new factors / surfaced gaps. This is the anti-blind-spot mechanism — diversity catches what one pass misses.
5. **Missing-factor critic** — a final pass: "what dimension did we not consider? what claim is unverified?" Its findings are added as `UNADDRESSED` factors.
6. **Coverage map + verdict.** Output the full factor set with statuses, then a holistic verdict that names the **decisive factors**, the **call + confidence**, and the **single biggest unaddressed risk.**

**The key UX:** the most valuable line isn't "score 78." It's *"Strong on product & differentiation. Weak on willingness-to-pay. You have NOT considered distribution — and for this kind of product that's usually what decides it."*

---

## 4. Reuse, don't fork (respects the no-parallel-subsystems rule)

The Evaluator is the **integrating layer over what already exists** — every prior subsystem becomes a factor-feeder:

| Existing | Feeds factor(s) | Note |
|---|---|---|
| `strategy_coverage.gaps` + comprehensive-grounding (axioms/convergences/inversions/subsystems) | the COVERAGE spine | generalize from "close these gaps" → "cover the full factor set"; the gap model is the embryo |
| Crucible (leverage / constraints / first principles / variables) | H (leverage), G (constraints), C (feasibility) | already fills `seed.internal` |
| value-engine (differentiation, analogous, alternatives) | D (defensibility), F (timing via landscape) | web-grounded |
| Monte Carlo simulation (`SEED_SIMULATION_PLAN`) | H (modeled causal effect) — ONE input | with its grounding label intact |
| `strategy-composite-ranker` (8 signals) | a subset of B/G/H scores | un-orphan by feeding it factor scores |
| evidence pooling / `prediction_ledger` | I (grounding), validation loop | makes verdicts falsifiable |

So nothing is duplicated: the Evaluator **orchestrates** them under one explicit factor model.

---

## 5. Where it lives in the seed

- `seed.internal.evaluation`:
  ```ts
  interface SeedEvaluation {
    decisionType: string;
    factors: {
      key: string; group: "A".."I"; label: string;
      assessment: string; score: number; confidence: number;
      status: "strong" | "weak" | "unaddressed" | "unknown";
      weight: "decisive" | "relevant" | "minor";
      source: "evidence" | "simulation" | "crucible" | "value_engine" | "judgment";
    }[];
    decisiveFactors: string[];
    biggestGap: string;           // the most important UNADDRESSED factor
    verdict: string; confidence: number;
    perspectives: { lens: string; objection: string }[];
  }
  ```
- **External face** (`distill-external` reads this): the "highest-leverage move" is the verdict; the value line names the *decisive* factor; a quiet **"⚠ not yet considered: distribution"** when a decisive factor is `unaddressed` (the single most useful thing on the card).
- **Expand → Coverage tab:** the full factor map — grouped A–I, each factor a row with status color (green strong / amber weak / red unaddressed-decisive / grey unknown) + its source badge. This is the "knows all the factors" surface.

---

## 6. The hard parts, stated honestly

- **Completeness is asymptotic.** The default framework + decision adaptation + generative expansion + missing-factor critic make coverage *strong and explicit*, not *total*. The win is that gaps are *visible*, not that they're *absent*.
- **Most factors are qualitative LLM judgments.** So each carries a `confidence` and a `source`; an evidence/simulation-backed factor reads differently from a pure-judgment one. Don't render judgment as fact.
- **Weighting is a judgment.** Which factors are decisive is itself contestable — so it's surfaced and editable (the founder can re-weight in chat), not hidden in a formula.
- **Still needs the founder + the world.** The chat fills decision-specific context; the `prediction_ledger` keeps verdicts falsifiable. The Evaluator sharpens *what to think about*; it doesn't replace validation.

---

## 7. Phasing

- **P1 — the framework + coverage-first evaluator (judgment-only).** Default factors + decision-type weighting + per-factor assessment + the missing-factor critic → `seed.internal.evaluation` + the Coverage tab + the "not yet considered" line on the card. No feeders yet beyond crucible/value-engine. **This alone delivers "knows all the factors, shows the blind spots."**
- **P2 — multi-perspective lenses.** Add the skeptic/customer/competitor/operator passes → richer gap detection.
- **P3 — wire the quantitative feeders.** Simulation → factor H; composite-ranker → B/G/H scores; evidence pooling → I. Quant becomes *part of* the picture, never the whole.
- **P4 — founder re-weighting + validation loop.** Chat re-weights decisive factors; `prediction_ledger` resolves verdicts vs outcomes.

---

## 8. Files

- **NEW:** `seed/evaluator.ts` (the factor framework + run), `seed/factor-framework.ts` (the default ontology + decision-type weighting), `seed-types.ts` += `SeedEvaluation`, `/seed` `evaluate` action, the Coverage tab.
- **REUSE (feeders):** crucible, value-engine, simulation (per `SEED_SIMULATION_PLAN`), `strategy-composite-ranker`, `strategy_coverage` gap model, evidence pooling, `prediction_ledger`.
- **DON'T:** fork a parallel scorer — the Evaluator orchestrates the feeders under ONE explicit factor model; don't render a number without its source + confidence; don't hide the weighting.

---

## 9. Build adjustments (the four sharpenings — adopted)

1. **ONE BRAIN: the factor framework is the Crucible's spine, not a layer above it.** Don't build a second reasoning system that "orchestrates the Crucible as a feeder" — they're the same loop and will drift. The factor framework *is* the Crucible's agenda: the chat's next question = the **decisive × unaddressed** factor; the Crucible's synthesis fills factor scores. The Evaluator is the Crucible's *missing explicit factor model + coverage*, so there is one reasoning loop driven by factor coverage. (P1 pragmatic form: the Evaluator runs over `seed.internal`, and its `biggestGap` becomes the chat's lead question.)

2. **DEPTH, not presence — per-factor rubrics, or it's coverage theater.** `status` is a vibe unless each factor carries a *bar for what "strong" requires* (e.g. "distribution strong" = a named wedge + atomic-network + a CAC hypothesis, NOT "we'll do marketing"). `factor-framework.ts` ships a `depthBar` per factor; the assessor scores against it; a factor that's addressed-but-shallow is `weak`, never `strong`.

3. **INVERT TRUST + route the illegible.** The model is good at *weighting* (decision-archetype pattern-match) and bad at *per-factor verdicts on illegible things* (WTP, timing). So trust `weighting` + `biggestGap`; treat per-factor `score` as low-trust (always with `confidence` + `source`). For a **decisive + low-grounding + illegible** factor, the assessor emits the **question to ask the founder / thing to validate** (a `probe`), NOT a confident verdict.

4. **BIAS-TO-ACTION in the verdict, or it's a perfectionism engine.** A completeness-checker that only surfaces gaps → paralysis. Each gap is classified `stop_ship | two_way_door`; the verdict ends with a **go / refine-first** call ("haven't considered distribution — usually the decider — but it's a two-way door, so test it"). Reversibility (factor G) is promoted into the verdict.

Plus: **calibration from P1** (log `decisiveFactors` + `biggestGap` to `prediction_ledger` so the evaluator is falsifiable, not an unaccountable opinion generator), and **cost discipline** (a cheap default pass: classify + weight + statuses + top gap; the multi-perspective lenses + feeder deep-dives run only for the 1–2 decisive low-grounding factors / on demand).

`SeedEvaluation` += per factor `depthBar`, `probe?` (the question when illegible), `gapKind: "stop_ship" | "two_way_door"`; top-level `call: "go" | "refine_first"`, `weightingRationale: string`.
```
