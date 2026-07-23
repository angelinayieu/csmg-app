# Research ↔ Uncertainty Loop — Design

**Date:** 2026-07-23
**Branch:** `feat/double-diamond-remodel`
**Builds on:** `184f226` (verb registry + maturity model), `DOUBLE_DIAMOND_REMODEL_SPEC.md` (issue #17)

## Problem

`DOUBLE_DIAMOND_REMODEL_SPEC.md` describes a loop: the KG's uncertain regions
generate questions, questions drive research, research cools the map and reveals
new uncertainty. Today that loop is an open arc.

What exists:

- A knowledge-accumulating research engine. `research-depth-engine.ts:228`
  (`shouldContinueResearch`) decides whether to run another pass from what the
  last pass found — continuation signals, new-entity yield, circuit breakers —
  and `pass-kind-dispatcher.ts:63` routes the next pass by kind
  (`outcome_breadth` → `triangulation` → `adversarial` → `cycle_close` →
  `boundary_condition`).
- Graph expansion from findings. `research/route.ts` inserts new `entities`
  (1493) and `edges` (1633, 1769, 1854, 1909).
- A graph-uncertainty-driven work loop. `space-strategizer/index.ts:755` ranks
  candidates, `space_work_queue` holds them, `space-executor-drain.ts` claims
  them, `deepenNodeSignature()` builds a ring and lowers
  `residual_uncertainty` (`signature-materializer.ts:919`, floored at 0.05).

What is missing:

- The refreshed heat map never becomes an input to the next research pass.
  `reactive-triggers.ts:7` — *"Chain is strictly LINEAR (never loops back)."*
- No question layer connects the two. `computeMaturity()` is referenced only by
  its own test. `QuestionEvidence.research` has no writer.
- The intake heat map is still Engine A: the fixed 10 ambiguity zones in
  `objective-canvas/prompt-sharpening-prompt.ts:13`, which the spec retires.

## Principles

1. **Structure is discovered, never named in advance.** The reason the 10 zones
   are being retired. Any mechanism that reintroduces a fixed list of named bins
   is wrong, at any level of the hierarchy.
2. **One uncertainty quantity.** `node_signature.residual_uncertainty` on
   `entities`. No parallel uncertainty concept is introduced.
3. **The map and the bar are the same signal.** Uncertainty drains only on
   question state change, so the map cannot cool while the bar is flat.
4. **Soft-fail.** A graph write failing never blocks the user. Fail closed only
   where a wrong result is worse than no result (question spawning).

## Architecture

### Stores

`library_objects.source_entity_id` is already `uuid references entities(id)` and
part of the natural key (`20260908_library_objects.sql:27,46`). The layering is
therefore already correct and needs no new bridge:

| Store | Role | Carries uncertainty |
|---|---|---|
| `entities` + `edges` | substrate KG — what the heat map *is* | yes (`node_signature`) |
| `library_objects` + `object_links` | synthesized outputs, pointing back via `source_entity_id` | no |

**Invariant:** discovered dependencies are written to `edges`. `object_links`
stays output-layer. A dependency recorded only as an `object_link` would be
invisible to the heat map, so the question-spawn path must never read
`object_links`. Enforced by test.

### Three bounded levels

```
Question          flat list in the panel, user-facing
  └─ Criteria     bounded closed set, machine-checked, visible as a checklist
       └─ Rings   node_signature.basis[] — the substrate
```

Plus **ring-derived sub-questions** (below), which are children in display and
provenance only; the maturity average runs over leaves.

### Categorization

Grouping of findings comes from `community-detection.ts` +
`community-summarize.ts` → `kg_communities` (hierarchical modularity clustering
with bottom-up roll-up summaries). Questions are **not** a categorization
scheme: a question exists to be destroyed, a category exists to persist; a
category must be exhaustive, a question covers only what is uncertain. Using
questions as bins reintroduces principle 1's failure and orphans every finding
about a settled region of the graph.

## The maturity indicator

The core of this design. A maturity bar's dominant failure mode is not a gamed
numerator — the criteria gates cover that — but a **meaningless denominator**:
three shallow questions, all resolved, reads 100%.

The indicator is therefore two numbers.

### 1. Maturity

```
maturity = Σ(wᵢ × stateScoreᵢ) / (Σwᵢ + U_unasked)

stateScore:  open = 0.0   explored = 0.5   resolved = 1.0
wᵢ           = Σ over sourceNodeIds of root_score(node), FROZEN at question
               creation; × CRITICAL_WEIGHT (2.0) when the user marks it critical
U_unasked    = Σ root_score over aligned nodes that carry real root_score but
               sit below the question-spawn threshold
```

`root_score` comes from `root-tracer.ts`:
`convergence_weight × depth_ratio × uncertainty_boost` — importance × causal
depth × uncertainty, all three at once. It replaces both the default weight of
`1.0` and the strategizer's `centrality × residual_uncertainty` hot-spot
ranking, which `target-outcome-extractor.ts` already identifies as degenerate:
*"Without an explicit target… ranking degenerates to graph centrality."*

Two details that carry the accuracy:

- **Weight is frozen at question creation.** If it tracked live uncertainty,
  resolving a question would shrink its own weight and the bar would chase
  itself.
- **`U_unasked` is the phantom denominator.** Without it, every discovery
  lurches the bar downward. With it, discovery mostly *converts phantom weight
  into real weight*, and the bar only drops by the genuinely new.

### 2. Saturation

How much we can trust the denominator.

```
saturation = Σ root_score over aligned nodes with
               pinned_because ∈ {saturated, user_locked}
             ─────────────────────────────────────────────
             Σ root_score over all aligned nodes

capped at 0.7 when the most recent research plan's circuit_breaker_reason was
"Max passes reached" or "Search budget exhausted"
```

`ResolutionLevel.pinned_because` already distinguishes *stopped because there
was nothing left* (`saturated`) from *stopped early* (`budget`,
`awaiting_evidence`). The circuit-breaker cross-check catches the case where the
graph looks saturated only because we ran out of money.

### The Make gate

```
makeUnlocked = maturity ≥ 0.60 AND saturation ≥ 0.50
```

The conjunction is the point. Maturity alone over a small denominator is
meaningless; saturation alone says nothing about whether anything was answered.

**Make does not hard re-lock.** Once earned, it stays. New discoveries interpose
a review step — *"3 things surfaced since you unlocked this"* — with an explicit
proceed option.

## Arc 1 — resolve cools the map

On question state change, drain the question's `sourceNodeIds`. The drain
mirrors `stateScore` exactly, which is what makes principle 3 provable rather
than aspirational:

```
drainable = residual_uncertainty − 0.05        // existing floor
explored  → residual −= 0.5 × drainable × shareₙ
resolved  → residual −= 1.0 × drainable × shareₙ
```

When a question has several source nodes, `shareₙ` is that node's fraction of
the question's frozen weight (`root_score(n) / Σ root_score`), so one question
resolving does not fully drain several nodes at once. A single-source question
has `shareₙ = 1` and lands exactly on the floor.

Written as a new ring via `persistSignature` + `emitSignatureDeepened`, citing
the question. Requires one type change: `BasisEvidence.source` gains
`"question"`.

Failure is soft: a failed drain logs and leaves residual unchanged. The question
state still advances — the user is never blocked on a graph write. The drain is
idempotent per (question, state) so a retry cannot double-drain.

## Arc 2 — research grows the graph, the graph grows the questions

After a research pass writes entities/edges:

1. Re-materialize signatures.
2. Run `root-tracer` to set `causal_depth`, `converges_chains`, `root_score`.
3. Score the delta with `decomposition-quality.ts`.

A new entity spawns a question only if **all** hold:

- `causal_depth != null` — it lies on a backward causal trace from a goal. A
  plausible-sounding irrelevant node has no such path and is silently ignored.
  This is the anti-node-spam gate, and it is a graph filter, not a judgment.
- `root_score` clears the spawn threshold.
- The delta did not trip `retryRecommended`.

Capped at **3 new questions per pass**. The cap is logged when it binds — a
silent cap reads as "covered everything."

Research landing on an *existing* question recomputes its criteria instead of
spawning.

`root-tracer` failure **fails closed**: no questions spawn that pass. Spawning
unaligned questions is worse than spawning none.

## Arc 3 — criteria steer the next pass

The piece that closes the loop. `shouldContinueResearch` gains a graph
context, and unmet criteria become its objective function:

| Unmet criterion | Next pass kind |
|---|---|
| `coverage` | `outcome_breadth`, focused on the question's source node |
| `triangulation` | `triangulation` |
| `adversarial` | `adversarial` |

Halts when every criterion on every question is met, or when the existing
circuit breakers fire (max passes, search budget, 100-entity cap, no-new-
entities). Those remain the outer bound and are not relaxed.

The same criteria drive the sidebar checklist and the research router, so what
the user sees missing is exactly what the system goes after next.

## Criteria

Five, closed set, each already implemented somewhere in the repo:

| id | Checked by | Bar | UI label |
|---|---|---|---|
| `coverage` | `claim-producer` | research produced a claim linked to the source node | Backed up |
| `triangulation` | `triangulation-gap-detector` | ≥2 distinct high-reliability supporters, zero high-reliability contradictors | Independently checked |
| `adversarial` | the `adversarial` pass | ran, no contradiction survived | Argued against |
| `graph_quality` | `decomposition-quality.ts` | delta adds no orphans, edges carry real `relation_type`s, confidence calibrated | Holds together |
| `alignment` | `root-tracer.ts` | new nodes have `causal_depth` set | Connects to goal |

UI labels are plain language. Spec invariant #11 bans jargon from rendered
strings; "triangulation" is not on the banned list but fails the same test.

## Sub-questions

**A sub-question is a ring that does not exist yet.**

`residual_uncertainty` is defined as what remains *after* a node's current
rings. `deepenNodeSignature` proposes the one variable that would most reduce
it, and is instructed to return null rather than fabricate a ring to stay busy
(`signature-materializer.ts:746`). So *"what does this node still need
resolved?"* is already a well-posed question, and each answer is a sub-question.

Properties that fall out, none of which need new machinery:

- **Derived, not guessed.** Children come from the graph, same as parents.
- **Bounded with no depth cap.** Decomposition stops when the next proposed ring
  contributes < 0.05 — the materializer's existing stopping rule.
- **They vanish correctly.** Resolving a sub-question builds the ring, so the
  child disappears because what it asked for now exists. No orphaned labels.
- **Weight is conserved.** The parent's frozen weight is distributed across its
  children in proportion to each proposed ring's expected `contribution`:
  `wᵢ = w_parent × contributionᵢ / Σ contributions`. Weight stays in
  `root_score` units and the denominator is provably unchanged by
  decomposition — which is what makes the "bar holds" row below true rather
  than approximate.

That last property gives the bar a distinction worth having:

| | effect on the bar | why it is honest |
|---|---|---|
| **Discovery** — research finds a new aligned node | adds weight → bar drops | the problem is bigger than you thought |
| **Decomposition** — a question is unpacked | redistributes weight → bar holds | you got more specific, you did not learn anything new |

Maturity runs over **leaves**: a new pure `flattenForMaturity()` drops any
question that has children. The tree exists for display and provenance.

**Known risk:** sub-question quality is bounded by the quality of the variables
`deepenNodeSignature` proposes. The `contribution ≤ residual` rule and the
return-null instruction bound quantity, not quality, and vague proposals become
user-facing where they were previously buried in a ring label. First
implementation logs proposed children before rendering them, so a few dozen can
be read and judged before this is trusted.

## Data model

### `src/lib/maturity/types.ts`

```ts
export type CriterionId =
  | "coverage" | "triangulation" | "adversarial" | "graph_quality" | "alignment";
export type CriterionStatus = "unmet" | "met" | "contradicted";

export interface Criterion {
  id: CriterionId;
  status: CriterionStatus;
  detail: string;          // one user-facing line: "1 of 2 separate sources"
}

export interface QuestionEvidence {
  criteria: Criterion[];   // replaces `research: boolean`
  userAnswer: boolean;     // guess-then-compare gate — unchanged
  confirmed: boolean;      // explicit confirmation — unchanged
}

export interface GlobalQuestion {
  id: string;
  prompt: string;
  state: QuestionState;
  weight: number;          // frozen root_score sum; × 2 when critical
  evidence: QuestionEvidence;
  sourceNodeIds: string[];
  parentId?: string;       // ring-derived decomposition
  derivedFrom?: string;    // breadcrumb: the question whose research found this
}
```

### `src/lib/maturity/compute.ts`

- `computeMaturity(questions, unaskedWeight = 0)` — denominator gains
  `U_unasked`. Defaulting to 0 keeps existing tests meaningful.
- `flattenForMaturity(questions)` — new pure function, drops parents.
- `computeSaturation(nodes, lastCircuitBreakerReason)` — new.
- `isMakeUnlocked` — now the conjunction of maturity and saturation.
- `canMarkExplored(e)` — `coverage` met **or** `userAnswer`, and nothing
  `contradicted`.
- `canMarkResolved(e)` — all five criteria met, **and** `userAnswer`, **and**
  `confirmed`.

### New table `global_questions`

`entity_questions` (`20260417_entity_questions.sql`) does not fit: single
`entity_id` FK where multiple `sourceNodeIds` are needed, a different four-state
lifecycle (`open|researching|answered|dismissed`), no weight, no criteria. It
stays as-is for user-authored node questions. The new table is space-scoped and
carries `source_node_ids uuid[]`, `weight numeric`, `criteria jsonb`,
`parent_id`, `derived_from`, and the three-state lifecycle.

## UI

```
◐ How does user feedback reach the decision?     explored · 1.0/2.0
   ✓ Backed up               3 findings point at this
   ◐ Independently checked   1 of 2 separate sources
   ✗ Argued against          not tried yet
   ✓ Holds together          no loose ends, 4 real links
   ✓ Connects to goal        2 steps from "retention"
```

The checklist renders under each question — strictness is legible, not hidden.
Sub-questions render indented under their parent. The bar shows maturity filled,
with saturation as a band: a low-saturation bar reads visibly provisional.

Long question lists cap at top N by weight with the remainder collapsed.

## Error handling

| Failure | Behavior |
|---|---|
| Drain write fails | Log, leave residual unchanged, advance question state anyway |
| `root-tracer` fails | Fail closed — no questions spawn this pass |
| `decomposition-quality` trips `retryRecommended` | Suppress spawning; surface "we found things, but they didn't hold together" |
| Criteria evaluation fails | Criteria are pure over persisted rows — recompute on next read, never a blocking write |
| Sub-question proposal returns null | Correct behavior, not an error — the node is saturated |

## Testing

`184f226` notes: *"vitest is not installed in this checkout, so these were
verified by `tsc --noEmit` plus manual arithmetic."* Acceptance criterion 13
requires tests passing, so **installing vitest is a prerequisite of this work**,
and the existing `compute.test.ts` and `verbs.test.ts` must be made to run
before anything here is trusted.

Coverage required:

- Maturity math: frozen weights, `U_unasked` denominator, leaf flattening,
  critical weighting.
- Saturation: the circuit-breaker cap, the weighted aggregate.
- Make gate: the conjunction, and that it does not hard re-lock.
- Criteria gates: `explored`/`resolved` transitions, `contradicted` blocking.
- Arc 1 drain: mirrors `stateScore`, respects the 0.05 floor, is idempotent.
- Arc 2 spawn gate: `causal_depth == null` never spawns; the 3-per-pass cap
  binds and logs.
- Arc 3 routing: each unmet criterion selects its pass kind; circuit breakers
  still halt.
- Invariant: the question-spawn path never reads `object_links`.
- Invariant: `AMBIGUITY_ZONES` is not imported by any question or map path
  (spec §4b).

## Acceptance criteria

1. Seeding builds `entities` + `edges` and materializes `node_signature` before
   any question is shown.
2. Hot spots rank by `root_score`; no path references the retired 10-zone list.
3. Each question carries `sourceNodeIds`; resolving it lowers those nodes'
   residual uncertainty and the map visibly cools.
4. Every question renders its five-criterion checklist with a one-line detail
   each.
5. `explored` and `resolved` are unreachable by clicking alone — the criteria
   gates hold.
6. A node with `causal_depth == null` never produces a question.
7. The bar reports maturity and saturation; Make unlocks only on both, and does
   not hard re-lock.
8. A question with children is excluded from the maturity average; its children
   are included, and decomposition leaves the percentage unchanged.
9. Research halts when all criteria are met, or on an existing circuit breaker.
10. Tests written and passing under vitest.

## Deferred

- Surfacing `kg_communities` as a user-facing grouping in the panel. The
  substrate exists; presenting it is separate work.
- Whether `entity_questions` and `global_questions` eventually converge.
- Retiring Engine A's code (this design stops *reading* it; deletion is its own
  commit).
