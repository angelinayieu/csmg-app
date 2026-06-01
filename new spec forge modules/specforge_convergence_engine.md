# SpecForge — Convergence Engine

## 1. Purpose

The **Convergence Engine** distills SpecForge’s layered analysis into the strongest actionable product thesis.

It takes the outputs from target user modeling, multifactor causal modeling, desired result layering, cross-analysis, constraints, weak links, and leverage analysis, then selects:

```text
Root Constraint
↓
First-Principles Need
↓
Highest-Leverage Intervention
↓
Distilled Product Thesis
↓
Solution Design Implications
```

The module answers:

> After analyzing all layers, what is the deepest actionable constraint that should shape the product, what user need does it reveal, and what product thesis should everything downstream optimize for?

---

## 2. Core Thesis

Convergence is not summarization.

It is **strategic selection**.

Weak convergence:

```text
The user needs a better app idea and clearer features.
```

Strong convergence:

```text
The user lacks a causal decision system for transforming vague product ideas into value-ranked build priorities. The first-principles need is structured confidence. Therefore, the product should first model user, problem causes, desired result, differentiation, and MVP directions before generating build specs.
```

The Convergence Engine must narrow the model into one dominant thesis.

---

## 3. Position in SpecForge Pipeline

The Convergence Engine runs after Cross-Analysis and before Differentiation Intelligence.

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
Convergence Engine
↓
Differentiation Intelligence
↓
Solution Families
↓
MVP App Directions
↓
Evaluation Lab
↓
Feature Cards
```

Why it runs here:

```text
- The system must understand relationships before selecting the thesis.
- Differentiation must compare alternatives against the converged thesis.
- Solution families must branch from the first-principles need, not from raw brainstorming.
```

---

## 4. Main Output

The module outputs:

```text
Root Constraint
↓
First-Principles Need
↓
Highest-Leverage Intervention
↓
Distilled Product Thesis
↓
Rejected Interpretations
↓
What This Rules Out
↓
What This Implies
↓
Constraints Passed Down
↓
Confidence / Uncertainty
```

---

## 5. Required Inputs

The Convergence Engine requires:

```text
Target User Model
Multifactor Problem Causal Model
Root Constraint Candidates
Desired Result Stack
Cross-Analysis Output
Cause-Result Blockage Map
Contradictions
Weak Links
Constraints Accumulated
Questions / Assumptions
Leverage Alignment
```

If these are missing or shallow, the engine should block or request repair.

---

## 6. Convergence Components

## 6.1 Root Constraint

The deepest actionable blocker that explains the most important downstream failures.

A root constraint must be:

```text
causal
specific
user-relevant
software-solvable
downstream-powerful
differentiation-relevant
able to generate solution families
```

Weak root constraint:

```text
The user needs clarity.
```

Strong root constraint:

```text
The user lacks a causal decision system for converting vague product ideas into value-ranked build priorities.
```

---

## 6.2 First-Principles Need

The deepest need revealed by the root constraint.

Examples:

```text
Structured confidence
Expression without scoring
Decision compression
Social presence without social pressure
Causal clarity
High-leverage build commitment
```

A first-principles need should be short, memorable, and generative.

It should explain why the product matters.

---

## 6.3 Highest-Leverage Intervention

The best product-level intervention point.

Examples:

```text
Model problem causes before generating MVPs.
Replace public scoring with contextual social feedback.
Make reasoning traceable before exporting specs.
Turn weak questions into validation tasks.
```

This should guide product architecture.

---

## 6.4 Distilled Product Thesis

A one-paragraph thesis connecting:

```text
target user
root constraint
first-principles need
intervention
desired result
differentiation direction
```

Example:

```text
SpecForge helps solo builders convert vague product ideas into confident build decisions by modeling the target user, causal problem structure, desired result, alternative gaps, and MVP app directions as one traceable reasoning system before feature generation or spec export.
```

---

## 6.5 Rejected Interpretations

The engine must explicitly reject weaker interpretations.

Examples:

```text
Rejected:
This is just an idea generator.

Why rejected:
More idea generation does not solve the root issue of decision confidence.

Rejected:
This is mainly a graph visualization tool.

Why rejected:
The graph is a representation layer, not the core value. The core value is causal decision reasoning.

Rejected:
This should begin with spec export.

Why rejected:
Spec export depends on selecting the right MVP app direction first.
```

Rejected interpretations help prevent product drift.

---

## 6.6 What This Rules Out

Convergence should eliminate directions.

Examples:

```text
Rules out:
- generic brainstorming app
- full graph editor as first MVP
- spec exporter as first core feature
- feature list generator without causal trace
- collaboration before individual decision loop is proven
```

---

## 6.7 What This Implies

Convergence should create design implications.

Examples:

```text
Implies:
- whiteboard must show causal trace
- root constraint must be visible
- MVP app directions must be ranked
- feature cards must map to root causes
- evaluation must explain why one path won
```

---

## 7. Root Constraint Tournament

The Convergence Engine should not automatically accept the first root constraint.

It should compare candidates.

### Candidate Structure

```json
{
  "candidate": "",
  "explains_symptoms": 0,
  "blocks_desired_result": 0,
  "applies_to_target_user": 0,
  "software_solvable": 0,
  "downstream_leverage": 0,
  "differentiation_potential": 0,
  "buildability": 0,
  "risk": 0,
  "why_it_might_win": "",
  "why_it_might_fail": ""
}
```

### Tournament Criteria

```text
explanatory power
user relevance
result blockage
downstream leverage
solution generativity
software-solvability
differentiation potential
evidence confidence
buildability
```

---

## 8. Convergence Scoring

Use this conceptual formula:

```text
Root Constraint Score =
explanatory power
+ desired result blockage
+ target user relevance
+ downstream leverage
+ solution generativity
+ differentiation potential
+ software-solvability
- risk
- uncertainty
```

The number is secondary. The reasoning matters more.

---

## 9. Convergence Output Schema

```json
{
  "root_constraint_candidates": [],
  "selected_root_constraint": "",
  "why_selected": "",
  "first_principles_need": "",
  "highest_leverage_intervention": "",
  "distilled_product_thesis": "",
  "rejected_interpretations": [],
  "what_this_rules_out": [],
  "what_this_implies": [],
  "constraints_passed_down": [],
  "confidence": 0,
  "uncertainties": [],
  "questions_to_resolve": [],
  "research_needed": [],
  "validation_needed": []
}
```

---

## 10. Prompt for Convergence Engine

```text
You are the Convergence Engine for SpecForge.

Given:
- target user model
- multifactor problem causal model
- desired result stack
- cross-analysis output
- cause-result blockage map
- contradictions
- weak links
- root constraint candidates
- accumulated constraints

Distill the strongest actionable product thesis.

Do not summarize everything equally.
You must select one dominant root constraint and one first-principles need.

Evaluate root constraint candidates by:
1. explanatory power
2. target user relevance
3. desired result blockage
4. downstream leverage
5. software-solvability
6. differentiation potential
7. solution generativity
8. evidence confidence
9. buildability
10. risk

Return:
{
  "root_constraint_candidates": [],
  "selected_root_constraint": "",
  "why_selected": "",
  "first_principles_need": "",
  "highest_leverage_intervention": "",
  "distilled_product_thesis": "",
  "rejected_interpretations": [],
  "what_this_rules_out": [],
  "what_this_implies": [],
  "constraints_passed_down": [],
  "confidence": 0,
  "uncertainties": [],
  "questions_to_resolve": [],
  "research_needed": [],
  "validation_needed": []
}

Rules:
- Do not leave multiple equal root constraints.
- Do not use vague phrases like “more clarity” unless defined causally.
- Explain why weaker interpretations were rejected.
- Create constraints for Differentiation, Solution Families, MVP Directions, and Feature Cards.
- Mark uncertainty honestly.
```

---

## 11. Quality Gates

The Convergence output fails if:

```text
- no root constraint is selected
- multiple root constraints remain equal
- root constraint is vague
- first-principles need is missing
- no highest-leverage intervention is selected
- product thesis is generic
- weaker interpretations are not rejected
- no directions are ruled out
- no downstream implications are created
- no constraints are passed down
- confidence and uncertainty are missing
```

---

## 12. Repair Prompt

```text
You are the Convergence Quality Critic.

Review the convergence output.

Reject or repair it if:
- it summarizes instead of selecting
- root constraint is vague
- multiple root constraints remain equally weighted
- first-principles need is not distilled
- highest-leverage intervention is missing
- product thesis does not guide solution generation
- no weaker interpretations are rejected
- no downstream constraints are created

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_convergence": {},
  "confidence_after_repair": ""
}
```

---

## 13. Whiteboard Visualization

### Default Convergence Card

```text
Convergence

Root Constraint:
[...]

First-Principles Need:
[...]

Highest-Leverage Intervention:
[...]

Confidence:
[...]
```

### Expanded Card

```text
Why this root constraint won
Root constraint candidates
Rejected interpretations
What this rules out
What this implies
Constraints passed downstream
```

### Deep Inspect

Shows:

```text
root constraint tournament
candidate scoring
cause-result evidence
contradictions
weak links
uncertainties
validation needed
```

---

## 14. Side Panel Actions

```text
Challenge root constraint
Generate alternative root constraints
Run root constraint tournament
Show why this won
Show rejected interpretations
Show what this rules out
Show implications
Turn thesis into differentiation criteria
Turn thesis into solution family constraints
Send to MVP generator
Mark uncertainty
Create validation test
```

---

## 15. Graph Updates

The Convergence Engine creates graph nodes:

```text
Root Constraint Candidate
Selected Root Constraint
First-Principles Need
Highest-Leverage Intervention
Distilled Product Thesis
Rejected Interpretation
Ruled-Out Direction
Solution Design Implication
Convergence Constraint
```

It creates edges:

```text
selected_over
rejected_because
explains
blocks
creates_need_for
implies
rules_out
passes_constraint_to
requires_validation
requires_research
```

---

## 16. Interweaving with Other Modules

### With Cross-Analysis

Cross-analysis supplies relationship evidence and weak links.

### With Multifactor Causal Modeling

Root constraint candidates come from causal variables, loops, contradictions, and leverage points.

### With Desired Result Layering

The selected root constraint must explain what blocks the desired result.

### With Differentiation Intelligence

Differentiation compares alternatives against the converged product thesis.

### With Solution Families

Solution families branch from first-principles need and highest-leverage intervention.

### With MVP App Direction

MVP candidates must satisfy convergence constraints.

### With Evaluation Lab

Evaluation scores root-cause alignment and thesis fit.

### With Constraint Accumulation

Convergence creates high-priority constraints.

---

## 17. Constraints Passed Down

Examples:

```text
Root-cause constraint:
Every MVP direction must attack the selected root constraint.

Need constraint:
Every solution family must serve the first-principles need.

Traceability constraint:
The interface must show why the selected MVP follows from the root constraint.

Scope constraint:
Do not build downstream execution tools before causal decision quality is proven.

Differentiation constraint:
Alternatives must be compared against the deeper problem, not feature lists.
```

---

## 18. Minimum Implementation Requirements

For first implementation, Convergence must generate:

```text
1. at least 3 root constraint candidates
2. selected root constraint
3. why selected
4. first-principles need
5. highest-leverage intervention
6. distilled product thesis
7. at least 3 rejected interpretations
8. at least 3 things ruled out
9. at least 3 implications
10. at least 3 constraints passed downstream
```

---

## 19. Acceptance Criteria

The module is complete when:

```text
- it selects one dominant root constraint
- it distills a first-principles need
- it selects a highest-leverage intervention
- it produces a product thesis
- it rejects weaker interpretations
- it rules out product directions
- it creates downstream constraints
- it powers differentiation and solution generation
- shallow convergence triggers repair
```

---

## 20. Final Instruction

The Convergence Engine exists to force SpecForge to choose.

It should ask:

```text
What is the deepest actionable constraint?
What need does that reveal?
What intervention changes the most downstream outcomes?
What thesis should guide the product?
What should we stop considering?
What must every downstream solution satisfy?
```

No solution family, MVP app direction, or feature card should be generated before convergence is complete.
