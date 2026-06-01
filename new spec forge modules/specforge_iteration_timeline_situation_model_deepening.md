# SpecForge — Iteration Timeline / Situation Model Deepening

## 1. Purpose

The **Iteration Timeline / Situation Model Deepening** system tracks how a SpecForge project evolves across repeated reasoning, user edits, validation results, repairs, and downstream recalculations.

It prevents the product model from becoming a static one-time output.

The module answers:

> How did the situation model grow over time, what changed, why did it change, what value was added, which assumptions were reduced, which recommendations shifted, and how should the next iteration deepen the model?

SpecForge should not only generate a model.

It should help users **improve the model over time**.

---

## 2. Core Thesis

A strong product model is built through iterations.

Weak version:

```text
Run the agent once and accept the output.
```

Strong version:

```text
Run the agent, inspect the model, refine key nodes, test assumptions, update evidence, repair weak reasoning, recalculate downstream recommendations, and track how each iteration improves the product decision.
```

The timeline should show:

```text
what changed
why it changed
which layer improved
which graph nodes were added
which uncertainty was reduced
which recommendation changed
what value was added
```

---

## 3. Position in SpecForge System

The Iteration Timeline sits across the whole system.

It receives events from:

```text
Prompt Power-Up
Target User Layering
Multifactor Problem Causal Modeling
Desired Result Layering
Differentiation Intelligence
MVP App Direction Generator
Feature Card System
Evaluation Lab
Validation Lab
Quality Critic
User Edits
Spec Exporter
```

It does not generate the initial model.
It tracks and deepens the model after generation.

---

## 4. Main Output

The module outputs:

```text
Iteration History
↓
Model Version Snapshots
↓
Change Summary
↓
Value Added Per Iteration
↓
Uncertainty Reduced
↓
Graph Growth
↓
Recommendation Changes
↓
Constraint Changes
↓
Validation Results
↓
Next Deepening Recommendation
```

---

## 5. Iteration Object Schema

Each iteration should be represented as:

```json
{
  "iteration_id": "",
  "project_id": "",
  "iteration_number": 0,
  "trigger": "initial_run | user_edit | repair | validation_result | re_evaluation | research_update | manual_rerun",
  "started_at": "",
  "completed_at": "",
  "summary": "",
  "changed_nodes": [],
  "new_nodes": [],
  "removed_nodes": [],
  "updated_edges": [],
  "constraints_added": [],
  "constraints_removed": [],
  "quality_gates_changed": [],
  "recommendation_before": "",
  "recommendation_after": "",
  "confidence_before": 0,
  "confidence_after": 0,
  "uncertainties_reduced": [],
  "new_uncertainties": [],
  "value_added": "",
  "next_recommended_iteration": ""
}
```

---

## 6. Iteration Trigger Types

### 6.1 Initial Run

The first full SpecForge generation.

Creates:

```text
baseline target user
baseline causal model
baseline desired result
baseline differentiation
baseline MVP direction
baseline feature cards
```

### 6.2 User Edit

Triggered when the user changes a node.

Examples:

```text
change target user
rewrite root constraint
reject MVP direction
accept alternative mechanism
```

### 6.3 Repair

Triggered by Causal Quality Critic.

Examples:

```text
problem model too shallow
differentiation too feature-level
MVP candidates confused with features
```

### 6.4 Validation Result

Triggered when an experiment returns evidence.

Examples:

```text
target user urgency lower than expected
users prefer causal board over static answer
feature mechanism fails usability
```

### 6.5 Re-Evaluation

Triggered when Evaluation Lab re-scores options.

Examples:

```text
re-score for fastest build
re-score for strongest differentiation
re-score for world-class depth
```

### 6.6 Research Update

Triggered when current market or competitor information changes the model.

Examples:

```text
competitor already has similar feature
new alternative found
pricing assumption changed
```

### 6.7 Manual Rerun

Triggered when user asks the agent to run deeper.

Examples:

```text
go deeper on causal model
generate more root constraints
deepen feature mechanisms
```

---

## 7. Value Added Per Iteration

Every iteration should explain its value.

Value categories:

```text
depth increased
uncertainty reduced
constraint clarified
recommendation improved
weak option removed
mechanism improved
evidence added
scope simplified
differentiation strengthened
buildability improved
```

Example:

```text
Iteration 3 value added:
Added feedback-loop analysis to the problem model, which changed the selected root constraint and downgraded the previous MVP direction.
```

---

## 8. Situation Model Deepening Dimensions

The timeline should track which dimensions improved.

```text
target user specificity
problem causal depth
desired result precision
differentiation strength
constraint clarity
MVP direction confidence
feature mechanism quality
data model precision
evaluation rigor
validation evidence
build readiness
```

---

## 9. Graph Growth Tracking

The timeline should show how the graph grows.

Track:

```text
nodes added
edges added
clusters created
constraints added
assumptions resolved
questions answered
experiments completed
recommendations changed
```

Example:

```text
Graph growth:
+8 causal variables
+3 feedback loops
+2 contradictions
+1 new root constraint candidate
+4 constraints passed to MVP generator
```

---

## 10. Recommendation Change Tracking

If a recommendation changes, explain why.

Example:

```text
Before:
Selected MVP App = Differentiation Intelligence Workspace

After:
Selected MVP App = Causal Product Modeling Workspace

Why changed:
Problem Causal Model repair showed that weak problem modeling is upstream of weak differentiation. Therefore, causal modeling has higher downstream leverage.
```

This builds trust.

---

## 11. Confidence Tracking

Each iteration should track confidence changes.

```text
confidence_before
confidence_after
why confidence changed
evidence added
uncertainty reduced
new uncertainty introduced
```

Example:

```text
Confidence increased from 0.62 to 0.78 because user variant scoring clarified that solo technical founders have stronger urgency than general founders.
```

---

## 12. Model Versioning

The system should keep version snapshots.

Snapshots should exist for:

```text
graph state
selected target user
problem causal model
root constraint
desired result stack
differentiation thesis
MVP app direction
feature card set
recommendation
spec output
```

Users should be able to:

```text
view previous version
compare versions
restore version
branch from version
```

---

## 13. Timeline View

### Default Timeline Card

```text
Iteration Timeline

Current version:
v4

Last improvement:
Root constraint repaired and MVP direction re-scored.

Confidence:
0.78

Next suggested iteration:
Validate target user urgency.
```

### Expanded Timeline

```text
v1 Initial run
v2 Target user refined
v3 Problem causal model repaired
v4 MVP direction re-scored
v5 Validation planned
```

### Deep Timeline View

Shows:

```text
full change history
graph growth
value added
recommendation changes
confidence changes
validation results
```

---

## 14. Situation Model Growth View

The growth view should show the model expanding across complexity.

Possible display:

```text
Target User: 4 nodes → 11 nodes
Problem Model: 6 nodes → 29 nodes
Desired Result: 3 nodes → 9 nodes
Differentiation: 2 nodes → 15 nodes
MVP Directions: 3 candidates → 1 selected + 2 rejected
Feature Cards: 0 → 6
```

This helps the user see how the model became more sophisticated.

---

## 15. Value Added Score

Each iteration can receive a value-added score.

Criteria:

```text
decision impact
uncertainty reduction
downstream leverage
constraint improvement
recommendation improvement
build readiness improvement
validation confidence
```

Conceptual formula:

```text
Iteration Value =
decision impact
+ uncertainty reduction
+ downstream leverage
+ confidence gain
+ build readiness improvement
- complexity added
```

---

## 16. Next Iteration Recommendation

The system should recommend what to do next.

Examples:

```text
Run deeper causal model
Validate selected target user
Compare against new alternative
Repair weak feature mechanism
Generate feature cards
Export build spec
```

The next iteration should be chosen by highest expected value.

---

## 17. Prompt for Iteration Timeline / Situation Model Deepening

```text
You are the Iteration Timeline / Situation Model Deepening system for SpecForge.

Given:
- previous project state
- current project state
- changed nodes
- validation results
- user edits
- quality gate results
- evaluation scores
- recommendation changes

Summarize how the model evolved.

Return:
{
  "iteration_summary": "",
  "trigger": "",
  "changed_nodes": [],
  "new_nodes": [],
  "removed_nodes": [],
  "graph_growth": {},
  "constraints_changed": [],
  "uncertainties_reduced": [],
  "new_uncertainties": [],
  "recommendation_before": "",
  "recommendation_after": "",
  "why_recommendation_changed": "",
  "confidence_before": 0,
  "confidence_after": 0,
  "value_added": "",
  "value_added_score": 0,
  "next_recommended_iteration": ""
}

Rules:
- Explain what changed and why.
- Highlight only meaningful changes.
- Show whether the model became better, clearer, or just more complex.
- Recommend the next highest-value deepening action.
```

---

## 18. Quality Gates

Timeline output fails if:

```text
- it lists changes without explaining value
- it does not show what recommendation changed
- it ignores confidence changes
- it treats added complexity as automatically good
- it does not identify next action
- it does not connect changes to graph nodes
- it does not track uncertainty reduced
```

---

## 19. Repair Prompt

```text
You are the Iteration Timeline Quality Critic.

Review the iteration summary.

Reject or repair it if:
- it does not explain what changed
- it does not explain why changes matter
- it does not identify value added
- it does not track confidence or uncertainty
- it does not explain recommendation changes
- it does not recommend a next iteration
- it confuses more complexity with better model quality

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_iteration_summary": {},
  "confidence_after_repair": ""
}
```

---

## 20. Whiteboard Visualization

### Timeline Strip

A compact strip at the bottom or side of the board:

```text
v1 Prompt
→ v2 User Model
→ v3 Causal Model
→ v4 Differentiation
→ v5 MVP Selection
```

### Iteration Badge

Cards can show:

```text
updated in v4
stale since v3
confidence improved
needs validation
```

### Growth Indicator

```text
Problem Model Depth:
Basic → Strategic → Validated
```

---

## 21. Side Panel Actions

```text
View iteration history
Compare versions
Restore previous version
Branch from version
Show what changed
Show why recommendation changed
Show value added
Show graph growth
Run next suggested iteration
Mark validation result
```

---

## 22. Graph Updates

The Iteration Timeline creates graph nodes:

```text
Iteration
Version Snapshot
Model Change
Value Added
Confidence Change
Recommendation Change
Validation Result
Next Iteration Recommendation
```

It creates edges:

```text
updated
changed
added
removed
improved
reduced_uncertainty
changed_recommendation
created_snapshot
suggests_next
```

---

## 23. Interweaving with Other Modules

### With Knowledge Graph

The timeline depends on graph updates and snapshots.

### With Side Panel

The side panel displays selected-node version history.

### With Evaluation Lab

Evaluation confidence changes are tracked over time.

### With Validation Lab

Experiment results trigger model updates and new iterations.

### With Quality Critic

Repairs become iterations and are logged.

### With Spec Exporter

Specs should identify which model version they were exported from.

---

## 24. Minimum Implementation Requirements

For the first implementation, the timeline must track:

```text
1. iteration number
2. trigger
3. changed nodes
4. summary
5. recommendation before / after
6. confidence before / after
7. value added
8. next recommended action
```

Do not build a complex timeline UI first. Start with structured trace and version snapshots.

---

## 25. Acceptance Criteria

The module is complete when:

```text
- every major change creates an iteration event
- the system can show what changed and why
- recommendation changes are explainable
- confidence changes are tracked
- value added is summarized
- graph growth can be inspected
- previous versions can be compared
- next iteration is recommended
- specs can reference model version
```

---

## 26. Final Instruction

The Iteration Timeline / Situation Model Deepening system exists to make SpecForge improve over time.

It should force the system to ask:

```text
What changed?
Why does it matter?
Did the model become better or only more complex?
Which uncertainty was reduced?
Which recommendation changed?
What should we deepen next?
```

The goal is not endless iteration.
The goal is compounding model quality.
