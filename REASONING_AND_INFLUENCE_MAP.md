# Reasoning & Influence Frameworks — Mapped onto the System

> Companion to `OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md`. Maps the
> Question Matrix, Influence Skills (synthesis/storytelling/decision), Strategic
> Thinking, and the logic types onto where the engine *already* does them, where
> it's thin, and where to deliberately force them. (2026-05-29, grep-grounded.)

## Headline finding

The engine **already performs nearly every reasoning mode in these frameworks** —
several are its deepest strengths — but it **doesn't name or track which mode it's
using**, and **two of the three "influence skills" are real output gaps.** So,
consistent with the prior assessment: the gap is *naming + a couple of output
layers*, not missing capability.

---

## 1. Influence Skills → where in the system

| Skill | Status | Where |
|---|---|---|
| **Synthesis** (connect dots, find patterns, form POV) | **STRONGEST — fully built** | entire `src/components/synthesis/*` (synthesis-view, convergence-gallery, leverage-card, perspective-delta, conditional-action-plan…), `pipeline/layered-synthesis.ts` (system→domain→thread), `strategy-engine.ts`, 5-lens consensus merge, gap analysis |
| **Storytelling** (Challenge→Big Idea→Action; lead with the answer) | **GAP** | "narrative" exists only as scattered *data* fields (`monte-carlo.ts`, `persist-strategy-prediction.ts`, `layered-synthesis.ts`) — there is NO deliberate persuasive-narrative output layer (lead-with-answer, story arc). Closest: `generate-description-doc.ts` |
| **Decision Making** (reversible vs irreversible, impact×effort, decision journal) | **PARTIAL — points yes, framing no** | decision POINTS exist (proposal accept, `load-chosen-lab`, `plan-generator`, edge approve). But **reversibility** + **impact×effort** prioritization are NOT first-class. The `decision_record` (ADR) in `enrich-mechanism-spec.ts` is the closest thing to a decision journal |

**Where to force them:** Storytelling → a persuasive-summary layer on a finished
mechanism/strategy (ties to the Case-Study format + "lead with payoff" UI taste +
agent-readiness). Decision-making → add reversible/irreversible + impact×effort
tags to the strategy ranker + approval surface.

---

## 2. Logic types → deployed implicitly, never named

The engine reasons in all these modes; none is labeled in code (grep for
`abductive`/`deductive`/… returns nothing in `src/lib`).

| Logic | Where it already happens | Named? |
|---|---|---|
| **Deductive** (general→specific) | rubric/quality gates apply general criteria to a specific artifact (`score-rubric.ts`, 6-axis gate) | no |
| **Inductive** (specific→general, probability) | **REML τ² evidence pooling** (`edge-strength-pooler.ts`) — specific studies → general edge strength | no |
| **Abductive** (best explanation from partial data) | **the core loop** — infer mechanisms/root-causes from symptoms; the 5 lenses; gap analysis | no |
| **Modal** (possibility/necessity) | variations + "CAN" exploration (`expand-item-detail.ts`); kill_criteria = necessity bounds | no |
| **Fuzzy** (truth on a spectrum) | every 0–1 confidence/strength/calibration score; τ² | no |
| **Dialectical** (thesis→antithesis→synthesis) | **adversarial research pass** + lens **contention→consensus** (`framing-panel.ts`, `triangulation-gap-detector.ts`) | no |
| **Informal** (claim→argument→conclusion) | rationale fields; `mechanism_hypothesis.because` | no |

**Opportunity (meta):** tag each generation/evaluation with the reasoning mode it
used + its certainty character (e.g. "abductive · low certainty" vs "inductively
pooled from 5 sources"). For a tool that sells *intelligence*, surfacing *how* it
concluded — not just the conclusion — is a rigor/trust feature, and it's cheap
(label, don't rebuild).

---

## 3. The Question Matrix → the engine's epistemic ladder

The matrix's columns map almost exactly onto the system's analysis progression:

```
 IS / DID      →  describe current state (entities, baselines, observed behaviour)
 CAN           →  possibility (variations, mechanism options)
 WOULD         →  probability (calibration, REML, conditional "would improve if")
 WILL          →  prediction (resolve-prediction, monte-carlo, strategy prediction)
 MIGHT         →  imagination (horizons, scenarios, auto-inversions, counterfactuals)
```

Rows (WHAT/WHERE/WHICH/WHO/WHY/HOW) = the facets the lenses + annotations cover
(WHY=root cause, HOW=mechanism, WHICH=ranking/choice). Reading levels L1/L2/L3
(retell→infer→synthesize) ≈ the **MethodTier ladder** (heuristic→…→tested). So the
system already spans the matrix — it's a good *coverage checklist* for "are we
asking every kind of question about this objective?", not a missing feature.

---

## 4. Strategic Thinking (7 powers) → coverage

- **Long-term mindset** → horizons + compounding (strategizer horizon weights) ✔
- **Second-order thinking** → **pervasive** (`deepen-prompt` second_order_failure, expansion L4 cascades, reasoning/axis prompts) ✔✔
- **Problem solving** (reframe, 5-whys, root cause) → `root_causes`, gap analysis, `causal_auditor` agent ✔
- **Force multiplier** (leverage) → `leverage-card`, leverage_points, `hierarchical_systems` structural-leverage signal ✔
- **Synthesis** → the synthesis subsystem ✔✔
- **Storytelling** → thin ✖
- **Decision making** → partial ◐

5 of 7 are strong; the two weak ones are the same two as §1.

---

## 5. How this augments the prior assessments

This is the **reasoning-rigor lens** on the engine, complementing the prior docs:
- `OBJECTIVE_CANVAS_SYSTEMATIZATION_ASSESSMENT.md` = structure (4 axes) + evaluator inventory.
- `MECHANISM_SPEC_TECHNICAL_DELIVERABLE.md` = the per-mechanism technical spec.
- **This doc** = which *modes of reasoning* the engine deploys, named for the first time.

It does NOT add new subsystems. It (a) confirms the engine's reasoning is already
sophisticated, (b) names two genuine output gaps (storytelling, decision-framing),
and (c) proposes one cheap rigor feature (reasoning-mode tagging).

---

## 6. Net actionable signal (unchanged across frameworks)

Every framework keeps landing in the same place. The concrete, bounded moves:
1. **Storytelling output layer** — persuasive summary (lead-with-answer) for a mechanism/strategy.
2. **Decision-framing** — reversible/irreversible + impact×effort on the ranker/approval surface.
3. **Reasoning-mode tags** — label each inference's logic type + certainty.
4. (From prior docs) vocabulary pass; agent-readiness fields; cross-feature data-flow audit.

These are *additions/labels on existing strengths*, not new ecosystems.
