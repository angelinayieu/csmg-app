# SpecForge — Divergence / Solution Family Generator

## 1. Purpose

The **Divergence / Solution Family Generator** expands from the converged product thesis into a controlled set of solution families.

It prevents SpecForge from returning to random brainstorming after convergence.

The module answers:

> Given the selected root constraint, first-principles need, highest-leverage intervention, differentiation thesis, and accumulated constraints, what families of solutions could solve the problem, how do they differ, what mechanisms do they imply, and which families should be considered for MVP app directions?

Divergence should happen only after convergence.

---

## 2. Core Thesis

Divergence is not freeform ideation.

It is **structured expansion from the first-principles need**.

Weak divergence:

```text
Here are 10 cool feature ideas.
```

Strong divergence:

```text
Starting from the first-principles need “structured confidence,” generate solution families that attack different leverage points:
- causal modeling
- decision support
- differentiation comparison
- feature mechanism design
- execution export

Then evaluate which families best satisfy the root constraint, desired result, differentiation thesis, buildability, and first-MVP scope.
```

The system should generate breadth, but only within the boundaries established by convergence.

---

## 3. Position in SpecForge Pipeline

The Divergence / Solution Family Generator runs after:

```text
Convergence Engine
↓
Differentiation Intelligence Engine
```

and before:

```text
MVP App Direction Generator
```

Pipeline:

```text
Prompt Power-Up
↓
Target User Layering
↓
Multifactor Problem Causal Modeling
↓
Desired Result Layering
↓
Cross-Analysis
↓
Convergence
↓
Differentiation Intelligence
↓
Divergence / Solution Family Generator
↓
MVP App Direction Generator
↓
Feature Card System
```

Why here:

```text
- convergence defines what matters
- differentiation defines what alternatives miss
- divergence creates possible solution families
- MVP generator converts top families into complete app directions
```

---

## 4. Main Output

The module outputs:

```text
Solution Family Candidates
↓
Family Mechanism Direction
↓
Root Cause Attacked
↓
Desired Result Enabled
↓
Alternative Gap Exploited
↓
User Behavior Changed
↓
Risks Introduced
↓
Family Evaluation
↓
Recommended Families
↓
Rejected Families
↓
MVP Seeds
```

---

## 5. Required Inputs

The generator requires:

```text
Selected Root Constraint
First-Principles Need
Highest-Leverage Intervention
Distilled Product Thesis
Differentiation Thesis
Alternative Gaps
Desired Result Stack
Target User Model
Leverage Points
Accumulated Constraints
Complexity Allocation
Evaluation Criteria
```

If convergence is missing, divergence should block.

---

## 6. Solution Family Definition

A solution family is a category of product approach that solves the root constraint through a distinct mechanism direction.

It is not a single feature.

A solution family includes:

```text
family name
thesis
root cause attacked
leverage point used
mechanism direction
user behavior changed
desired result enabled
alternative gap exploited
example MVP seeds
risks
constraints
```

---

## 7. Solution Family Candidate Structure

Each candidate must include:

```json
{
  "family_name": "",
  "family_thesis": "",
  "root_constraint_attacked": "",
  "first_principles_need_served": "",
  "leverage_point": "",
  "mechanism_direction": "",
  "target_user_behavior_changed": "",
  "desired_result_enabled": "",
  "alternative_gap_exploited": "",
  "example_mvp_seeds": [],
  "risks_introduced": [],
  "constraints_satisfied": [],
  "constraints_violated": [],
  "buildability": "",
  "differentiation_strength": "",
  "downstream_leverage": "",
  "why_this_family_matters": ""
}
```

---

## 8. Required Divergence Modes

The system should generate solution families across several modes.

### 8.1 Root-Cause Attack Mode

Generate families by attacking different root-cause components.

Example:

```text
If root constraint is “no causal decision system,” solution families may attack:
- weak problem modeling
- weak comparison criteria
- weak differentiation
- weak mechanism reasoning
- weak execution path
```

### 8.2 Leverage Point Mode

Generate families from ranked leverage points.

Example:

```text
Leverage point:
Problem causal model

Family:
Causal Modeling Workspace
```

### 8.3 Desired Result Mode

Generate families by enabling different desired result layers.

Example:

```text
Decision result → Decision Support Family
Emotional confidence → Trust / Explanation Family
Behavior change → Workflow Commitment Family
```

### 8.4 Differentiation Gap Mode

Generate families from alternative gaps.

Example:

```text
Alternative gap:
ChatGPT generates ideas but lacks persistent causal trace.

Family:
Traceable Reasoning Workspace
```

### 8.5 Mechanism Innovation Mode

Generate families based on different mechanism principles.

Example:

```text
- modeling
- scoring
- visualization
- simulation
- validation
- automation
```

### 8.6 Constraint Resolution Mode

Generate families that resolve contradictions.

Example:

```text
Contradiction:
Need deep reasoning but low overwhelm.

Family:
Progressive Disclosure Causal Board
```

---

## 9. Example: SpecForge Solution Families

### Family A — Causal Modeling

```text
Thesis:
Help users understand the real problem before generating solutions.

Root constraint attacked:
No causal decision structure.

Mechanism direction:
Model target user, causal variables, loops, contradictions, root constraint candidates, and leverage points.

User behavior changed:
User stops surface brainstorming and reasons from causal structure.

MVP seed:
Causal Product Modeling Workspace.
```

### Family B — Decision Support

```text
Thesis:
Help users choose the best MVP direction from competing alternatives.

Root constraint attacked:
No comparison and prioritization system.

Mechanism direction:
Generate MVP app directions, score them, explain winner and losers.

User behavior changed:
User stops keeping all options alive and commits to one direction.

MVP seed:
Value-Ranked MVP Decision Engine.
```

### Family C — Differentiation Intelligence

```text
Thesis:
Help users prove why their product is meaningfully better than alternatives.

Root constraint attacked:
Weak understanding of current alternatives and deeper unsolved gaps.

Mechanism direction:
Compare direct alternatives, indirect workarounds, analogies, and deeper problem gaps.

User behavior changed:
User stops building clever but redundant products.

MVP seed:
Differentiation Intelligence Workspace.
```

### Family D — Mechanism Design

```text
Thesis:
Help users turn feature ideas into mechanisms with input → process → output logic.

Root constraint attacked:
Features are not connected to how value is created.

Mechanism direction:
Generate, compare, and select feature mechanisms tied to root causes and desired results.

User behavior changed:
User stops naming features and starts designing systems.

MVP seed:
Feature Mechanism Forge.
```

### Family E — Execution Export

```text
Thesis:
Help users turn selected MVP and features into buildable specs.

Root constraint attacked:
Execution friction after product direction is selected.

Mechanism direction:
Convert feature cards and mechanisms into technical specs, tasks, and coding-agent prompts.

User behavior changed:
User moves from strategy to build.

MVP seed:
Spec-to-Prototype Exporter.
```

---

## 10. Example: Low-Pressure Social App Solution Families

### Family A — Soft Feedback Systems

```text
Thesis:
Let users feel seen without being publicly scored.

Root constraint attacked:
Expression is represented as public performance.

Mechanism direction:
Non-ranked, contextual, private or semi-private feedback.

MVP seed:
Soft Feedback Posting Rooms.
```

### Family B — Audience Boundary Systems

```text
Thesis:
Reduce audience ambiguity so users know who they are sharing with.

Root constraint attacked:
Audience collapse and fear of misinterpretation.

Mechanism direction:
Small context rooms, sharing circles, audience-intent matching.

MVP seed:
Small-Room Social Sharing.
```

### Family C — Representation Replacement

```text
Thesis:
Replace public metrics with representations of presence, warmth, resonance, or continuity.

Root constraint attacked:
Social value is represented as status score.

Mechanism direction:
Qualitative feedback summaries, mutuality indicators, memory threads.

MVP seed:
Resonance-Based Social Journal.
```

### Family D — Posting Pressure Reduction

```text
Thesis:
Make sharing lightweight enough that users do not over-edit or perform.

Root constraint attacked:
High self-presentation effort.

Mechanism direction:
low-friction composer, ephemeral drafts, casual prompts, no public ranking.

MVP seed:
Low-Pressure Moment Composer.
```

---

## 11. Family Evaluation Criteria

Each family should be scored by:

```text
root constraint alignment
first-principles need fit
desired result enablement
target user fit
alternative gap exploitation
mechanism distinctiveness
downstream leverage
buildability
risk
complexity fit
differentiation strength
validation clarity
```

---

## 12. Hard Rejection Rules

Reject a solution family if:

```text
- it does not attack the selected root constraint
- it does not serve the first-principles need
- it is only a feature category
- it is not meaningfully different from another family
- it violates hard constraints
- it creates more ambiguity than it resolves
- it depends on delayed infrastructure
- it cannot become an MVP app direction
```

---

## 13. Solution Family Ranking

Conceptual formula:

```text
Family Score =
root constraint alignment
+ first-principles need fit
+ desired result enablement
+ differentiation strength
+ downstream leverage
+ validation clarity
- complexity cost
- risk
- constraint violations
```

The output should include ranked families and explanation.

---

## 14. Prompt for Divergence / Solution Family Generator

```text
You are the Divergence / Solution Family Generator for SpecForge.

Given:
- selected root constraint
- first-principles need
- highest-leverage intervention
- distilled product thesis
- desired result stack
- target user model
- differentiation thesis
- alternative gaps
- leverage points
- accumulated constraints
- complexity allocation

Generate 4–7 solution family candidates.

Do not generate isolated features.
Each family must represent a distinct product approach or mechanism direction.

Generate across:
1. root-cause attack mode
2. leverage point mode
3. desired result mode
4. differentiation gap mode
5. mechanism innovation mode
6. constraint resolution mode

For each family, return:
{
  "family_name": "",
  "family_thesis": "",
  "root_constraint_attacked": "",
  "first_principles_need_served": "",
  "leverage_point": "",
  "mechanism_direction": "",
  "target_user_behavior_changed": "",
  "desired_result_enabled": "",
  "alternative_gap_exploited": "",
  "example_mvp_seeds": [],
  "risks_introduced": [],
  "constraints_satisfied": [],
  "constraints_violated": [],
  "buildability": "",
  "differentiation_strength": "",
  "downstream_leverage": "",
  "why_this_family_matters": ""
}

Then rank families and recommend which should feed MVP App Direction generation.

Rules:
- Every family must trace to the root constraint.
- Every family must serve the first-principles need.
- Reject families that are only feature bundles.
- Prefer families that solve multiple downstream problems.
- Preserve buildability for first MVP.
```

---

## 15. Quality Gates

The output fails if:

```text
- families are random brainstormed ideas
- families are just features
- families do not trace to root constraint
- first-principles need is not referenced
- no mechanism direction is defined
- no risks are identified
- no ranking is provided
- no families are rejected
- MVP seeds are missing
- constraints are ignored
```

---

## 16. Repair Prompt

```text
You are the Solution Family Quality Critic.

Review the generated solution families.

Reject or repair them if:
- they are not grounded in the root constraint
- they do not serve the first-principles need
- they are isolated features rather than solution families
- they are not meaningfully different
- they ignore differentiation gaps
- they ignore constraints
- they do not produce MVP seeds
- they are overbuilt for first MVP

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_solution_families": [],
  "ranked_families": [],
  "recommended_for_mvp_generation": [],
  "confidence_after_repair": ""
}
```

---

## 17. Whiteboard Visualization

### Default Section

```text
Solution Families

1. [Family A]
2. [Family B]
3. [Family C]

Recommended:
[Family]
```

### Family Card

```text
Family Name

Thesis:
[...]

Root cause attacked:
[...]

Mechanism direction:
[...]

MVP seed:
[...]
```

### Expanded Family Card

```text
first-principles need served
desired result enabled
alternative gap exploited
risks introduced
constraints satisfied
buildability
```

---

## 18. Side Panel Actions

```text
Generate more families
Compare families
Merge families
Reject family
Show root cause attacked
Show mechanism direction
Show risks
Show MVP seeds
Re-rank families
Send family to MVP App Direction Generator
Turn family into feature candidates
```

---

## 19. Graph Updates

The Divergence / Solution Family Generator creates graph nodes:

```text
Solution Family
Mechanism Direction
MVP Seed
Family Risk
Rejected Family
Recommended Family
```

It creates edges:

```text
attacks_cause
serves_need
uses_leverage_point
enables_result
exploits_gap
satisfies_constraint
violates_constraint
risks
generates_mvp_seed
recommended_for
rejected_because
```

---

## 20. Interweaving with Other Modules

### With Convergence

Convergence defines the root constraint and first-principles need that guide divergence.

### With Differentiation

Differentiation gaps help define solution family opportunity.

### With Evaluation Lab

Evaluation ranks solution families and rejects weak ones.

### With MVP App Direction Generator

Recommended solution families become inputs for complete MVP app directions.

### With Feature Card System

Later, selected MVP direction translates family logic into features.

### With Complexity Allocation

Complexity budget determines which families are feasible for v1.

---

## 21. Minimum Implementation Requirements

For first implementation, the module must generate:

```text
1. at least 4 solution families
2. root constraint attacked for each
3. mechanism direction for each
4. desired result enabled for each
5. alternative gap exploited for each
6. at least one MVP seed per family
7. ranking
8. recommended families for MVP generation
9. rejected family reasons
```

---

## 22. Acceptance Criteria

The module is complete when:

```text
- solution families are grounded in convergence
- families are meaningfully different
- every family has a mechanism direction
- every family has an MVP seed
- weak families are rejected
- recommended families feed MVP App Direction generation
- random brainstorming is prevented
```

---

## 23. Final Instruction

The Divergence / Solution Family Generator exists to expand intelligently after convergence.

It should force the system to ask:

```text
What families of solutions follow from the root constraint?
Which leverage points can be attacked?
Which desired results can be enabled?
Which alternative gaps can be exploited?
Which families deserve MVP exploration?
Which should be rejected?
```

Divergence should increase option quality, not option noise.
