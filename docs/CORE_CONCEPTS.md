# Core Concepts — Definitions

A single source of truth for the domain terms used across this codebase.
Created because the same word ("feedback loop," "convergence," "chain")
often means different things in different files. If you're confused
which meaning of a term a file uses, this doc is the authority.

Last updated: 2026-05-15.

---

## Feedback loop — the systems-thinking sense (what `cycles` table holds)

A **closed causal chain in the knowledge graph** where the last variable
influences the first, so the loop compounds or self-corrects.

> **NOT to be confused with ML feedback** (prediction → observe → adjust
> model). That sense lives elsewhere in the codebase — see "ML feedback /
> reflexive loop" below.

A feedback loop has three flavors (`cycles.classification`):

| Classification | Behavior | Example |
|---|---|---|
| `reinforcing_positive` | Each rotation amplifies in the *same direction*; compounds. | More users → more content → more users |
| `reinforcing_negative` | Same dynamic, bad direction (vicious cycle). | Burnout → less output → more pressure → more burnout |
| `balancing` | Pushes against itself; stabilizes. | High inventory → lower prices → demand up → inventory drops |

**Stored**: `cycles` table ([schema.sql:160-176](../src/supabase/schema.sql)).

**Detected by**:
1. LLM tracing during synthesis (narrative form lives in `synthesis_data.feedback_loops[]` as `RichFeedbackLoop`)
2. Deterministic graph algorithm at [near-cycle-detector.ts](../src/lib/pipeline/near-cycle-detector.ts) (finds 3-cycles + missing-edge candidates)
3. Enrichment cross-reference with Tier-3 `dynamics: compounding/exponential` edges at [enrich-cycles.ts](../src/lib/decomposition/enrich-cycles.ts)

**Where it actually drives behavior**:
- Monte Carlo simulation amplifies entity deltas by `estimated_multiplier` (or classification-default 1.4× / 0.6×) — [monte-carlo.ts:65-72, 290-293](../src/lib/simulation/monte-carlo.ts)
- Strategy LLM prompt receives cycle list as context for `temporal_phases[].loops_activated[]` references

**Where it's stored but unused operationally**:
- `cycles.growth_type` (additive/multiplicative/accelerating/decelerating) — read nowhere downstream
- `cycles.intervention_point_entity_id` — displayed only, not used to target apps
- `cycles.cycle_time` — unused
- `cycles.edge_ids[]` — stored but unread
- `edges.cycle_id` (back-reference on edges) — never queried

**Two-table split**:
- `cycles` row = structural fact (entity_ids, classification, multiplier)
- `synthesis_data.feedback_loops[]` (`RichFeedbackLoop` type) = narrative form (name, steps as entity names, intervention guidance prose, "when active")
- **These two never cross-reference** — same loop appears in both with no FK link

---

## Causal chain — the goal-anchored forward sequence

A **directed sequence** of entity → entity → entity ... → goal. NOT closed
(that would be a cycle). Each link carries an effect size + mechanism +
confidence. Tied to a specific `improvement_goal` via
`chain.primary_goal_id`.

This is where **rigorous causal modeling** lives in the codebase.

**Stored**: `causal_chains` table.

**Used for**:
- Pooled meta-analysis math at [impact-weighted-metric.ts:191-250](../src/lib/twin/impact-weighted-metric.ts) — fixed/random effects pooling, study weighting, heterogeneity (I²)
- The `CascadeObjective.impact` field (`StageImpact`) on each strategy perspective showing "X% contribution to goal"
- The cascade routing: which objectives connect to which mechanisms

**Difference from cycles in one line**: chains are forward-pointing causal models with effect-size rigor; cycles are closed topological patterns with LLM-guessed multipliers.

---

## Effect size — the causal-rigor primitive

A numeric measure of the strength of one entity's causal influence on
another, sourced from evidence (papers, internal data, expert judgment).

**Stored**: `evidence_registry.effect_size`, sometimes alongside
`standard_error`, `study_count`, `confidence_interval_lo/hi`.

**Consumed by**:
- [impact-weighted-metric.ts](../src/lib/twin/impact-weighted-metric.ts) for pooled meta-analysis (chain-level)
- Forest plot rendering for evidence visualization
- The cascade-objective "impact %" display

**NOT consumed by**: cycles (cycles don't read effect sizes — they use
LLM-guessed multipliers instead).

---

## Mechanism — the operational substrate behind a loop or chain

A **named, structured cycle pattern with assigned agents and apps**. Lives
between strategy and apps in the data model:

```
StrategicRecommendation
  └─ InfrastructureProposal (one per intervention-cluster)
       └─ Mechanism (one per loop the proposal commits to)
            ├─ cycle_pattern (text: how the loop fires)
            ├─ agent_assignments (which agents staff this)
            ├─ status (proposed → approved → active → paused → retired)
            └─ Apps[] (one app per app-spec inside this mechanism)
```

**Stored**: `mechanisms` table ([migration 20260509](../supabase/migrations/20260509_mechanisms.sql)).

**The connection to cycles is weak**: `mechanism.cycle_pattern` is free
text (the cycle's name, typically), NOT a foreign key to `cycles.id`.
String match only.

**Connection to apps is strong**: `apps.parent_mechanism_id` is a real FK.

---

## App — the operationalized intervention

A first-class table row representing one running tool, monitor, workflow,
dashboard, or integration that the user actually interacts with
post-approval.

**Stored**: `apps` table ([migration 20260428](../supabase/migrations/20260428_apps_and_interventions.sql)).

**Created from**: each `InfrastructureProposal` on the approved strategy.
Optionally tied to a parent mechanism via `parent_mechanism_id`.

**NOT tied to cycles directly** — there's no `apps.cycle_id` FK. If a user
wants to know "which loop does this app monitor," they'd have to trace
through the mechanism's `cycle_pattern` (text match).

---

## Digital twin — the model of "the system as we currently know it"

A **macro-level computed state** representing what the system knows about
the user's domain right now: how many entities, how many cycles, what's
the health score, what's the bottleneck, what changed.

**NOT continuously improved.** Frozen at decision points; re-snapshotted
on intervention commit.

**Stored**: `twin_snapshots` table with `reason` ∈
`{user_request, pre_strategy, post_intervention, scheduled, pipeline_checkpoint}`.

> The `scheduled` reason exists in the schema but isn't wired to a cron yet.

**Computed by**: [compute-twin-state.ts](../src/lib/twin/compute-twin-state.ts).

**Key fields**:
- `health_score` (0-100)
- `coverage` (entities/edges/cycles modeled)
- `risk_exposure` (bottleneck, blast radius)
- `dynamics` (total_loops broken into reinforcing+/−/balancing)
- `maturity` (actionable_now / waiting_on_dependency / theoretical / blocked)

**Relationship to cycles**: cycles are *counted* into `dynamics`; cycle
counts ≥ 1 add +3 to `health_score`. That's the entire cycle→twin
behavioral path.

---

## ML feedback / Reflexive loop — the prediction-error learning sense

This is what the user often means when they say "feedback loop" in an AI
context, and it lives SEPARATE from the systems-thinking cycle subsystem.

**Components**:
- `prediction_ledger` — append-only forecasts with `horizon_at` and
  `resolved_at`. On resolution, each row gets a `deviation_tag`:
  `expected` / `surprise` / `regime_shift` / `qualitative`.
- `reality_calibration` — measures whether the KG can reproduce the
  user's stated baselines. Gates strategy approval.
- `connection_prospector` — periodically scans pair-wise relationships
  for missing edges; user reviews proposals.
- `surprise_rate` on `TwinMacroState.risk_exposure` — the share of
  recently resolved predictions that came in tagged 'surprise' or
  'regime_shift'.

**When the user thinks "feedback loop = the AI learns from observed
reality": THIS subsystem is what they mean. Not `cycles`.**

---

## Convergence ring (the pulsing dashed halo)

The visual on a `kg-node` shape when its `isConvergence` boolean is true.
Means: **this entity is a member of at least one detected feedback loop**
(systems-thinking sense).

Rendered as a 2px dashed outline 4px outside the card edge, layer-colored,
breathing on a 2.4-second pulse.

**Limitations**:
- Single boolean — doesn't say *which* loop
- Color comes from entity layer, not cycle classification — can't tell
  reinforcing from balancing visually
- No connection drawn to fellow loop members

---

## Probability space / Landscape axis — investigative lens, NOT a model

8 canonical (until July 2026; now adaptive) "lenses" the LLM uses to scope
the analytical question during the landscape stage. Each axis spawns its
own candidate entities. Entities that appear in multiple axes get flagged
as high-leverage.

**Stored**: `probability_space_runs` rows (post-2026-07-07 with custom
slugs allowed via `is_custom` + `custom_axis_spec`).

**NOT a model of reality.** It's an investigative scoping layer that
informs which entities to deepen.

---

## "What's the cycle, what's the chain, what's the loop?" — quick cheatsheet

| If you're holding | It is | Where it lives |
|---|---|---|
| A row in `cycles` | Closed feedback loop (systems-thinking), structural | `cycles` table |
| A `RichFeedbackLoop` JSON | Narrative version of the above, LLM-prose | `synthesis_data.feedback_loops[]` |
| A row in `causal_chains` | Forward sequence to a goal, with effect sizes | `causal_chains` table |
| A `prediction_ledger` row with `resolved_at` | ML-feedback observation (the model learned something) | `prediction_ledger` |
| A `pairwise_connection_check` row | Reflexive loop's pair examination | `pairwise_connection_checks` |

---

## Why this distinction matters

The two senses of "feedback loop" have completely different rigor profiles:

1. **Systems-thinking cycles** are *detected* with deterministic graph
   topology + LLM tracing, but their *quantification* (the multiplier
   that says "this loop is 2.3× strong") is an LLM guess unweighted by
   evidence. The display is rich; the math is hand-wavy.

2. **Causal chains** carry rigorous meta-analysis math — pooled effect
   sizes, study weighting, heterogeneity quantification. The chain→goal
   contribution % shown on cascade objectives is real causal modeling.

3. **ML-feedback / prediction-resolution** is fully closed-loop and
   honest: predictions land in `prediction_ledger`, get observed
   outcomes, get tagged with deviation severity, and breathe into the
   twin's `surprise_rate`.

When someone says "the system has feedback loops," they could mean any of
the three. This doc disambiguates.

---

## Open questions / acknowledged gaps

- **Cycles don't read effect sizes.** The multiplier is LLM-guessed. To
  make cycles causally rigorous, we'd need to derive multipliers from
  pooled edge effect sizes — currently absent from the codebase.
- **No cycle ↔ goal connection.** Chains have `primary_goal_id`; cycles
  don't. Cycles only affect goal forecasts indirectly (by amplifying
  the chains that target the goal).
- **`scheduled` snapshot reason isn't wired.** Continuous twin
  evolution is supported by schema but no cron job populates it.
- **No FK from `mechanism.cycle_pattern` to `cycles.id`.** The
  connection is text-only and fragile.
- **`loops_activated[]` on temporal_phases is aspirational.** Strategy
  says "Phase 2 ignites Loop X" but no telemetry checks whether Loop X
  actually fired.

These are real limitations of the current architecture, not bugs.
Whether to close them depends on whether you want the system to be
*rich-looking metadata* or *operationally rigorous*.
