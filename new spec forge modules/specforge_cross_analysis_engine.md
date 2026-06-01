# SpecForge — Cross-Analysis Engine

## 1. Purpose

The **Cross-Analysis Engine** interweaves the major SpecForge models before convergence.

It prevents the system from producing separate impressive-looking sections that do not actually align.

The module answers:

> Do the target user, causal problem model, desired result, constraints, differentiation gaps, assumptions, and solution implications actually fit together? Which relationships are strongest, which contradictions matter, and what should be passed into convergence?

Cross-analysis is the bridge between:

```text
layered modeling
```

and:

```text
root thesis selection
```

Without it, SpecForge risks generating disconnected analysis.

---

## 2. Core Thesis

The quality of SpecForge depends on relationships, not isolated artifacts.

A target user model is only useful if it changes the problem model.

A problem causal model is only useful if it explains what blocks the desired result.

A desired result is only useful if the selected user truly wants it.

A differentiation thesis is only useful if it solves a deeper problem alternatives miss.

Cross-analysis forces the system to ask:

```text
What connects?
What conflicts?
What depends on what?
What changes downstream?
What should dominate the final product thesis?
```

---

## 3. Position in SpecForge Pipeline

The Cross-Analysis Engine runs after:

```text
Target User Layering
Multifactor Problem Causal Modeling
Desired Result Layering
```

and before:

```text
Convergence Engine
Differentiation Intelligence
Solution Families
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
Cross-Analysis Engine
↓
Convergence Engine
↓
Differentiation Intelligence
↓
Solution Families
↓
MVP App Directions
```

---

## 4. Main Output

The module outputs:

```text
User ↔ Problem Fit
↓
Problem ↔ Desired Result Fit
↓
User ↔ Desired Result Fit
↓
Cause ↔ Result Blockage Map
↓
Constraint ↔ Solution Implication Map
↓
Contradiction Inventory
↓
Leverage Alignment
↓
Weak Links / Uncertainties
↓
Highest-Leverage Intervention
↓
Convergence Inputs
```

---

## 5. Required Inputs

The engine requires:

```text
Target User Model
User Variants
Multifactor Problem Causal Model
Causal Variables
Feedback Loops
Contradictions
Root Constraint Candidates
Desired Result Stack
Constraints Accumulated
Questions / Assumptions
Current Workarounds
```

If any core input is missing, the engine should mark the analysis incomplete.

---

## 6. Cross-Analysis Dimensions

## 6.1 User ↔ Problem Fit

Question:

```text
Does this problem actually occur for this user, and is it painful enough to matter?
```

Evaluate:

```text
pain intensity
frequency
urgency
current workaround weakness
behavioral evidence
emotional pressure
switching motivation
```

Example:

```text
Solo technical founders strongly fit the problem because vague product direction blocks immediate building and creates high opportunity cost.
```

Failure condition:

```text
The user is plausible but not urgent enough.
```

---

## 6.2 User ↔ Desired Result Fit

Question:

```text
Does this user actually care about this result?
```

Evaluate:

```text
functional value
emotional value
decision value
strategic value
willingness to change behavior
willingness to pay / return
```

Example:

```text
Solo founders care about structured confidence because it lets them commit to a build direction and reduce wasted effort.
```

Failure condition:

```text
The result is attractive in theory but not urgent for this user.
```

---

## 6.3 Problem ↔ Desired Result Fit

Question:

```text
If this problem is solved, does the desired result actually happen?
```

Evaluate:

```text
which causes block which results
which causes most directly prevent behavior change
which root constraint must be addressed
which desired result is unrealistic
```

Example:

```text
If the user lacks comparison criteria, then ranked MVP selection is blocked. Solving comparison criteria supports the decision result.
```

---

## 6.4 Cause ↔ Result Blockage Map

The system should create explicit edges:

```text
cause → blocks → result
```

Example:

```text
Audience ambiguity → blocks → safe expression
Public metric visibility → blocks → expression without scoring
Weak problem model → blocks → confident build decision
No comparison criteria → blocks → ranked MVP path
```

This map becomes evaluation input.

---

## 6.5 Constraint ↔ Solution Implication Map

Question:

```text
What does each constraint force future solutions to include, avoid, simplify, or delay?
```

Example:

```text
Constraint:
Must reduce user overwhelm.

Solution implication:
Default whiteboard must show high-level cards, while deep detail lives in side panel.

Constraint:
Must be differentiated from ChatGPT.

Solution implication:
Must show causal trace and evaluation rationale, not just generated text.
```

---

## 6.6 Contradiction Analysis

Question:

```text
Which tensions must be resolved rather than ignored?
```

Examples:

```text
Need depth but must avoid overwhelm.
Need automation but must preserve user control.
Need graph visibility but must avoid graph clutter.
Need fast MVP but must prove deep differentiation.
Need user feedback but must reduce social scoring.
```

Contradictions should become mechanism design constraints.

---

## 6.7 Leverage Alignment

Question:

```text
Which cause, constraint, or intervention improves the most downstream modules?
```

Evaluate:

```text
upstream leverage
number of downstream outputs affected
risk if wrong
software-solvability
differentiation contribution
buildability
```

Example:

```text
Problem Causal Modeling has high leverage because it improves convergence, differentiation, MVP ranking, feature mechanisms, and spec quality.
```

---

## 6.8 Weak Link Detection

Question:

```text
Where does the model look smart but rest on weak assumptions?
```

Examples:

```text
Target user urgency is inferred, not evidenced.
Differentiation against alternatives is not researched.
Desired result is measurable but not validated.
Root constraint has multiple plausible candidates.
```

Weak links should become questions, validation tasks, or research needs.

---

## 7. Cross-Analysis Object Schema

```json
{
  "cross_analysis_id": "",
  "user_problem_fit": {
    "score": 0,
    "reason": "",
    "evidence": [],
    "uncertainties": []
  },
  "user_result_fit": {
    "score": 0,
    "reason": "",
    "evidence": [],
    "uncertainties": []
  },
  "problem_result_fit": {
    "score": 0,
    "reason": "",
    "blocked_results": []
  },
  "cause_result_blockage_map": [],
  "constraint_solution_implications": [],
  "contradictions": [],
  "leverage_alignment": [],
  "weak_links": [],
  "highest_leverage_intervention": "",
  "convergence_inputs": [],
  "questions_to_resolve": [],
  "constraints_created": [],
  "confidence": 0
}
```

---

## 8. Scoring Criteria

Cross-analysis scores should include:

```text
fit strength
causal clarity
desired result relevance
constraint usefulness
contradiction importance
leverage
evidence strength
uncertainty risk
downstream impact
```

---

## 9. Highest-Leverage Intervention Selection

The engine should select the strongest intervention candidate before convergence.

Candidate types:

```text
target user refinement
root constraint selection
desired result refinement
differentiation focus
solution family direction
mechanism focus
evaluation criterion
validation task
```

Example:

```text
Highest-leverage intervention:
Model the problem causally before generating MVP directions.

Reason:
A weak problem model makes differentiation, MVP ranking, feature generation, and spec export shallow.
```

---

## 10. Prompt for Cross-Analysis Engine

```text
You are the Cross-Analysis Engine for SpecForge.

Given:
- target user model
- user variants
- multifactor problem causal model
- desired result stack
- constraints
- assumptions
- current workarounds
- root constraint candidates

Interweave the models.

Analyze:
1. user ↔ problem fit
2. user ↔ desired result fit
3. problem ↔ desired result fit
4. cause ↔ result blockage map
5. constraint ↔ solution implications
6. contradictions
7. leverage alignment
8. weak links and uncertainties
9. highest-leverage intervention
10. inputs for convergence

Return:
{
  "user_problem_fit": {},
  "user_result_fit": {},
  "problem_result_fit": {},
  "cause_result_blockage_map": [],
  "constraint_solution_implications": [],
  "contradictions": [],
  "leverage_alignment": [],
  "weak_links": [],
  "highest_leverage_intervention": "",
  "convergence_inputs": [],
  "questions_to_resolve": [],
  "constraints_created": [],
  "confidence": 0
}

Rules:
- Do not summarize models separately.
- Focus on relationships.
- Identify contradictions and weak links.
- Select one highest-leverage intervention.
- Mark uncertainty.
- Generate constraints for downstream modules.
```

---

## 11. Quality Gates

The Cross-Analysis output fails if:

```text
- it summarizes each model separately instead of interweaving them
- no user-problem fit is evaluated
- no user-result fit is evaluated
- no problem-result fit is evaluated
- cause-result blockage map is missing
- contradictions are missing
- highest-leverage intervention is missing
- weak links are missing
- no constraints are passed downstream
- confidence is not stated
```

---

## 12. Repair Prompt

```text
You are the Cross-Analysis Quality Critic.

Review the cross-analysis output.

Reject or repair it if:
- it does not interweave models
- it lacks relationship analysis
- it does not identify cause-result blockages
- it does not identify contradictions
- it does not select a highest-leverage intervention
- it does not identify weak links
- it does not create constraints for convergence or downstream modules

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_cross_analysis": {},
  "confidence_after_repair": ""
}
```

---

## 13. Whiteboard Visualization

### Default Card

```text
Cross-Analysis

Strongest fit:
[target user] ↔ [problem]

Key blockage:
[cause] blocks [desired result]

Highest-leverage intervention:
[...]

Confidence:
[...]
```

### Expanded Card

```text
user-problem fit
user-result fit
problem-result fit
contradictions
weak links
highest-leverage intervention
```

### Deep Inspect

Shows:

```text
cause-result map
constraint implications
leverage ranking
weak link list
questions to resolve
confidence basis
```

---

## 14. Side Panel Actions

```text
Show relationship map
Show contradictions
Show weak links
Show cause-result blockages
Generate deeper cross-analysis
Challenge highest-leverage intervention
Turn weak link into question
Turn weak link into validation task
Send to convergence
Re-run after user edit
```

---

## 15. Graph Updates

The Cross-Analysis Engine creates graph nodes:

```text
Cross-Analysis
Fit Assessment
Cause-Result Blockage
Contradiction
Weak Link
Leverage Alignment
Highest-Leverage Intervention
Convergence Input
```

It creates edges:

```text
fits
misfits
blocks
supports
contradicts
depends_on
creates_implication_for
high_leverage_for
passes_to_convergence
requires_question
requires_validation
```

---

## 16. Interweaving with Other Modules

### With Target User Layering

Determines whether selected user is actually strong enough.

### With Multifactor Causal Modeling

Determines which causes matter most for the selected user and result.

### With Desired Result Layering

Determines which causes block the result and which results are realistic.

### With Convergence Engine

Provides the relationship evidence used to select root constraint and product thesis.

### With Evaluation Lab

Produces criteria and weak links used for scoring and uncertainty.

### With Question Expansion

Weak links become high-value questions.

### With Validation Lab

Unverified fit assumptions become validation tests.

---

## 17. Minimum Implementation Requirements

For first implementation, Cross-Analysis must generate:

```text
1. user-problem fit
2. user-result fit
3. problem-result fit
4. at least 3 cause-result blockages
5. at least 3 contradictions or tradeoffs
6. at least 3 weak links
7. highest-leverage intervention
8. constraints passed to convergence
```

---

## 18. Acceptance Criteria

The module is complete when:

```text
- target user, problem, and result are interwoven
- cause-result blockages are explicit
- contradictions are identified
- weak links are surfaced
- one highest-leverage intervention is selected
- convergence receives clear inputs
- shallow relationship analysis triggers repair
```

---

## 19. Final Instruction

The Cross-Analysis Engine exists to make SpecForge coherent.

It should force the system to ask:

```text
Do these models actually fit together?
Which relationships matter most?
Which contradictions shape the solution?
Which weak links could break the recommendation?
What should convergence prioritize?
```

No convergence should happen before cross-analysis.
