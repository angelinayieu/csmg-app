# SpecForge — Experimentation / Validation Lab

## 1. Purpose

The **Experimentation / Validation Lab** converts uncertain assumptions, unanswered questions, risky mechanisms, and weak evidence points into structured tests.

It prevents SpecForge from treating reasoning as proof.

The module answers:

> Which assumptions must be tested, what experiment should test them, what evidence would validate or invalidate them, and how should the result update the product model, MVP direction, feature cards, evaluation scores, and roadmap?

The lab is not only for final product validation. It applies across:

```text
target user assumptions
problem causal model assumptions
desired result assumptions
differentiation assumptions
MVP app direction assumptions
feature mechanism assumptions
data point assumptions
business model assumptions
```

---

## 2. Core Thesis

SpecForge should not stop at “this seems like the best solution.”

It should identify what could make the recommendation wrong and design the smallest test that can reduce that uncertainty.

Weak validation:

```text
Ask users if they like the idea.
```

Strong validation:

```text
Test whether the selected target user can move from a vague idea to a confident MVP app direction faster using the causal modeling workflow than with their current ChatGPT + Notion workaround.
```

The goal is not to prove the product is good.
The goal is to learn which assumptions are true, false, or still uncertain.

---

## 3. Grounding Principle

The Experimentation / Validation Lab is grounded in validated learning.

Lean Startup defines the minimum viable product as the version of a product that allows a team to collect maximum validated learning about customers with the least effort. Validation is therefore not decoration after building; it is a core reason to build the MVP.

Usability testing is also relevant because it observes users performing tasks and listening to feedback while they use an interface. This matters for SpecForge because many assumptions are not only about market demand, but about whether users can understand, trust, and operate the reasoning workflow.

---

## 4. Position in SpecForge Pipeline

The Validation Lab runs after evaluation, but it can be triggered earlier whenever uncertainty is high.

Primary position:

```text
Question Expansion
↓
Evaluation Lab
↓
Experimentation / Validation Lab
↓
Iteration / Feedback Loop Tracker
```

It also receives inputs from:

```text
Target User Layering
Problem Causal Modeling
Desired Result Layering
Differentiation Intelligence
MVP App Direction Generator
Feature Card System
Data Point Optimization
```

---

## 5. Main Output

The module outputs:

```text
Assumption Inventory
↓
Risk Inventory
↓
Validation Questions
↓
Experiment Candidates
↓
Experiment Ranking
↓
Selected Tests
↓
Success / Failure Criteria
↓
Evidence Requirements
↓
Learning Plan
↓
Model Update Rules
```

---

## 6. Assumption Types

SpecForge should validate several assumption types.

### 6.1 Target User Assumptions

Examples:

```text
The selected user actually feels this problem urgently.
The selected user has weak current workarounds.
The selected user would change behavior.
The selected user would pay or repeatedly use the product.
```

### 6.2 Problem Assumptions

Examples:

```text
The root constraint is actually causing the surface problem.
The causal loops identified are real enough to design around.
The problem occurs frequently enough to matter.
The problem is painful enough to justify switching behavior.
```

### 6.3 Desired Result Assumptions

Examples:

```text
The desired result is what the user actually wants.
The measurable success signal reflects real value.
The emotional result matters enough to drive use.
```

### 6.4 Differentiation Assumptions

Examples:

```text
Existing alternatives fail to solve the deeper problem.
The product advantage is meaningful to the selected user.
The analogy helps understanding instead of misleading.
```

### 6.5 MVP App Direction Assumptions

Examples:

```text
This MVP app direction is the smallest complete product loop.
The first-build scope is enough to prove value.
The delayed scope is not required for first validation.
```

### 6.6 Feature Mechanism Assumptions

Examples:

```text
The feature mechanism actually attacks the selected root cause.
The user understands how to use the feature.
The mechanism creates the desired behavior change.
The mechanism does not introduce new friction or risk.
```

### 6.7 Data Point Assumptions

Examples:

```text
This data point is necessary.
Users will provide it.
It can be inferred reliably.
The privacy/friction cost is justified.
The data improves downstream output quality.
```

### 6.8 Business / Distribution Assumptions

Examples:

```text
The user can be reached through the assumed channel.
The product has a plausible wedge.
The user will return after initial use.
```

---

## 7. Experiment Types

The Validation Lab should generate different experiment types.

### 7.1 Interview Test

Purpose:

```text
Understand user pain, current workaround, decision process, language, and urgency.
```

Best for:

```text
target user assumptions
problem assumptions
desired result assumptions
```

### 7.2 Usability Test

Purpose:

```text
Observe users trying to complete tasks with the prototype.
```

Best for:

```text
interface clarity
workflow friction
side-panel interaction
feature comprehension
trust in recommendation
```

### 7.3 Concept Test

Purpose:

```text
Test whether the product thesis and positioning make sense before building.
```

Best for:

```text
differentiation
positioning
macro objective
MVP direction
```

### 7.4 Concierge / Wizard-of-Oz Test

Purpose:

```text
Manually simulate the system before full automation.
```

Best for:

```text
AI reasoning workflow
causal modeling output quality
MVP recommendation quality
feature card usefulness
```

### 7.5 Prototype Task Test

Purpose:

```text
Give user a prototype and ask them to complete a target task.
```

Best for:

```text
workflow completion
decision confidence
time to value
understandability
```

### 7.6 A/B or Comparison Test

Purpose:

```text
Compare SpecForge output against an alternative workflow.
```

Best for:

```text
ChatGPT vs SpecForge
static report vs whiteboard
shallow cause tree vs multifactor causal model
feature list vs feature cards
```

### 7.7 Fake Door Test

Purpose:

```text
Test demand for a feature or direction before building it.
```

Best for:

```text
advanced graph view
spec exporter
research automation
collaboration
```

### 7.8 Analytics / Usage Test

Purpose:

```text
Measure actual behavior after launch.
```

Best for:

```text
retention
repeat use
feature adoption
conversion
drop-off
```

---

## 8. Experiment Object Schema

```json
{
  "experiment_id": "",
  "name": "",
  "experiment_type": "",
  "assumption_tested": "",
  "related_node_ids": [],
  "hypothesis": "",
  "method": "",
  "target_user": "",
  "sample_size": "",
  "task_or_prompt": "",
  "success_criteria": [],
  "failure_criteria": [],
  "metrics": [],
  "qualitative_signals": [],
  "time_required": "",
  "effort_level": "low | medium | high",
  "confidence_gain": "low | medium | high",
  "risk_if_not_tested": "",
  "decision_that_result_will_change": "",
  "model_update_rule": "",
  "status": "planned | running | completed | dismissed"
}
```

---

## 9. Hypothesis Format

Every experiment should use a hypothesis.

```text
We believe [target user] has [problem / need].
If we provide [intervention / prototype / workflow],
then [behavior / decision / measurable result] will occur,
because [causal mechanism].
We will know this is true if [success criteria].
We will know this is false if [failure criteria].
```

Example:

```text
We believe solo technical founders struggle to choose MVP app directions because they lack a causal decision structure.

If we provide a guided causal modeling whiteboard,
then they will select a build path faster and report higher decision confidence than when using ChatGPT alone,
because the workflow makes target user, root constraint, differentiation, and MVP tradeoffs visible.

We will know this is true if users can select and explain a preferred MVP direction within 15 minutes and rate confidence at least 7/10.

We will know this is false if users still feel confused, cannot explain why the recommendation won, or prefer the ChatGPT-only output.
```

---

## 10. Validation Metrics

### 10.1 Decision Metrics

```text
time to selected MVP direction
confidence before vs after
ability to explain why recommendation won
number of alternatives confidently rejected
decision completion rate
```

### 10.2 Usability Metrics

```text
task completion
time on task
confusion moments
unassisted completion
clicks to desired action
drop-off points
```

### 10.3 Value Metrics

```text
perceived usefulness
willingness to reuse
willingness to pay
perceived improvement over current workaround
quality of final output
```

### 10.4 Mechanism Metrics

```text
root-cause alignment perceived by user
traceability understood
feature mechanism understood
data friction accepted
feedback loop worked as intended
```

### 10.5 Business Metrics

```text
activation
retention
conversion
referral
repeat project creation
export usage
```

---

## 11. Experiment Ranking Criteria

Experiments should be ranked by:

```text
assumption importance
risk if wrong
decision impact
confidence gain
speed
cost
ease of execution
evidence quality
relation to root constraint
relation to MVP selection
```

Formula:

```text
Experiment Priority =
assumption importance
+ risk if wrong
+ decision impact
+ confidence gain
- cost
- time
```

---

## 12. Hard Prioritization Rule

Test assumptions in this order:

```text
1. target user urgency
2. root problem validity
3. desired result value
4. differentiation against current workaround
5. MVP app direction usefulness
6. core feature mechanism usability
7. data collection feasibility
8. pricing / monetization
9. advanced feature demand
```

Do not test advanced features before proving the core user/problem/result loop.

---

## 13. Experiment Quality Gates

An experiment fails quality if:

```text
- no assumption is named
- no hypothesis is stated
- success criteria are vague
- failure criteria are missing
- no decision will change from the result
- sample/user type is unclear
- method is too expensive for the learning value
- result cannot update the graph/model
- experiment tests a feature before testing the problem
```

---

## 14. Repair Prompt

```text
You are the Experimentation Quality Critic.

Review the experiment plan.

Reject or repair it if:
- it does not identify the assumption being tested
- it does not state a testable hypothesis
- success criteria are vague
- failure criteria are missing
- the wrong user is being tested
- the experiment is too expensive for the learning value
- the result will not change a decision
- it tests downstream features before validating upstream user/problem/result assumptions

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_experiment_plan": {},
  "confidence_after_repair": ""
}
```

---

## 15. Prompt for Experimentation / Validation Lab

```text
You are the Experimentation / Validation Lab for SpecForge.

Given:
- target user model
- problem causal model
- desired result stack
- differentiation thesis
- selected MVP app direction
- feature cards
- unanswered questions
- assumptions
- risks
- evaluation confidence

Create a validation plan that tests the most important assumptions in the correct order.

For each assumption:
1. identify why it matters
2. identify what decision it affects
3. generate experiment candidates
4. rank experiments by learning value and cost
5. select the best test
6. define hypothesis
7. define success criteria
8. define failure criteria
9. define metrics
10. define model update rule

Return:
{
  "critical_assumptions": [],
  "risk_inventory": [],
  "experiment_candidates": [],
  "selected_experiments": [],
  "validation_sequence": [],
  "metrics": [],
  "model_update_rules": [],
  "next_action": ""
}

Rules:
- Test upstream assumptions before downstream features.
- Do not recommend expensive experiments when a cheaper test can answer the question.
- Every experiment must update a decision, score, constraint, or graph node.
- Mark research vs user test vs prototype test clearly.
```

---

## 16. Model Update Rules

Every experiment should define how results update SpecForge.

Examples:

```text
If target user urgency is low:
- downgrade selected user
- revisit user variants
- re-run Target User Layering
- mark MVP recommendation stale

If root problem is invalid:
- re-run Problem Causal Modeling
- invalidate related solution families
- re-score MVP directions

If differentiation is weak:
- revisit alternative comparison
- rework positioning
- downgrade MVP confidence

If feature mechanism fails usability:
- repair Feature Card
- generate mechanism alternatives
- update build sequence
```

---

## 17. Whiteboard Visualization

### Default Card

```text
Validation Lab

Top assumption to test:
[...]

Recommended test:
[...]

Why:
[...]

Decision affected:
[...]
```

### Expanded Card

```text
Critical assumptions
Experiment candidates
Selected tests
Success criteria
Failure criteria
Metrics
Model update rule
```

### Side Panel

Shows:

```text
assumption inventory
risk inventory
experiment ranking
hypothesis format
validation sequence
test script
metrics
status
results
model updates
```

---

## 18. Side Panel Actions

```text
Generate validation plan
Create experiment
Rank experiments
Convert question to experiment
Convert assumption to experiment
Define success criteria
Define failure criteria
Generate test script
Mark result passed
Mark result failed
Update model from result
Re-score MVP after result
```

---

## 19. Graph Updates

The Validation Lab creates graph nodes:

```text
Assumption
Risk
Experiment
Hypothesis
Success Criterion
Failure Criterion
Metric
Validation Result
Model Update Rule
```

It creates edges:

```text
tests
validates
invalidates
measured_by
affects_decision
updates
requires_user_test
requires_research
requires_prototype
```

---

## 20. Interweaving with Other Modules

### With Question Expansion

Critical unanswered questions become validation candidates.

### With Evaluation Lab

Low-confidence evaluations become assumptions to test.

### With MVP App Direction

MVP selection is validated by testing whether the product loop creates the desired result.

### With Feature Card System

Feature mechanisms get validation tests and failure signals.

### With Data Point Optimization

Data assumptions get friction, reliability, and privacy tests.

### With Iteration Timeline

Completed experiments create new model versions.

---

## 21. Minimum Implementation Requirements

For the first implementation, Validation Lab must generate:

```text
1. top 5 critical assumptions
2. top 3 experiments
3. hypothesis for each selected experiment
4. success criteria
5. failure criteria
6. metric list
7. decision affected
8. model update rule
9. recommended next validation action
```

---

## 22. Acceptance Criteria

The Validation Lab is complete when:

```text
- every major uncertainty can become an assumption
- assumptions can become experiments
- experiments have hypotheses and success/failure criteria
- experiments are ranked by learning value
- validation sequence starts upstream
- results update graph nodes and recommendations
- failed tests trigger repair or re-modeling
- validation is visible on the whiteboard and actionable in the side panel
```

---

## 23. Final Instruction

The Experimentation / Validation Lab exists to make SpecForge honest.

It should force the system to ask:

```text
What could make this recommendation wrong?
What is the cheapest way to find out?
What evidence would change the decision?
What should update if the result passes or fails?
```

SpecForge should not only generate better ideas.
It should learn which ideas deserve to survive.
