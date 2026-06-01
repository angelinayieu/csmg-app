# SpecForge — Question Expansion Engine

## 1. Purpose

The **Question Expansion Engine** generates high-value questions that improve the reasoning model, reduce uncertainty, expose hidden assumptions, and change downstream product decisions.

It prevents SpecForge from producing generic question lists.

The module answers:

> What questions should be asked to deepen the target user model, causal problem model, desired result model, differentiation thesis, MVP direction, feature mechanisms, evaluation criteria, and validation plan?

Questions are not filler.
Questions are **optimization tools**.

A good question should change what SpecForge believes, builds, evaluates, rejects, or prioritizes.

---

## 2. Core Thesis

SpecForge should not ask more questions for the sake of appearing thoughtful.

Weak question:

```text
Who is the target user?
```

Strong question:

```text
Which user segment experiences the highest decision urgency, weakest current workaround, and strongest willingness to change behavior now?
```

Weak question:

```text
What features should we build?
```

Strong question:

```text
Which feature mechanism attacks the highest-leverage root constraint while preserving buildability for the first MVP app?
```

The Question Expansion Engine must generate questions that improve the model.

---

## 3. Position in SpecForge Pipeline

The Question Expansion Engine can run at multiple points.

Primary position:

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
Question Expansion
↓
Convergence
↓
Differentiation
↓
Solution Families
↓
MVP App Directions
↓
Feature Cards
```

It can also run inside any selected node when the user asks to go deeper.

---

## 4. Question Types

SpecForge should support these question categories:

```text
Macro Objective Questions
Target User Questions
Problem Causal Model Questions
Desired Result Questions
Differentiation Questions
Solution Family Questions
MVP App Direction Questions
Feature Mechanism Questions
Data Point Questions
Evaluation Questions
Constraint Questions
Research Questions
Validation Questions
```

---

## 5. Question Quality Rule

A question is high quality only if it satisfies at least one of these:

```text
- changes MVP direction
- changes target user selection
- changes root constraint
- changes desired result
- changes differentiation thesis
- changes feature mechanism
- changes evaluation criteria
- exposes a hidden assumption
- identifies an evidence gap
- reduces decision uncertainty
- improves downstream output quality
```

Questions that only produce more description should be downgraded or hidden.

---

## 6. Question Object Schema

Every question should be stored as a structured object:

```json
{
  "question_id": "",
  "question": "",
  "category": "",
  "target_node_id": "",
  "why_it_matters": "",
  "what_answer_would_change": "",
  "priority": "critical | high | medium | low",
  "uncertainty_reduced": "",
  "downstream_effect": "",
  "suggested_action": "",
  "answer_status": "unanswered | answered | assumed | research_needed | dismissed",
  "generated_by_module": "",
  "related_nodes": [],
  "constraints_created_if_answered": []
}
```

---

## 7. Priority Levels

### Critical

Questions that can change the final recommendation.

Example:

```text
Is the selected target user actually the highest-pain user, or only the easiest one to imagine?
```

### High

Questions that affect MVP direction or core feature mechanisms.

Example:

```text
Does the root constraint come from weak problem modeling, weak comparison criteria, or low trust in recommendations?
```

### Medium

Questions that improve detail but may not change the selected direction.

Example:

```text
What onboarding language would best explain the causal model?
```

### Low

Questions that are interesting but not decision-critical.

Example:

```text
What color should the cards be?
```

Low-priority questions should not be visible by default.

---

## 8. Macro Objective Questions

Purpose:

```text
Clarify the larger mission, philosophy, objective, and final transformation.
```

Examples:

```text
What is the highest-level transformation this product should create?
What must the product never become?
What final user decision should the product support?
What deeper belief or philosophy should constrain the product?
What would make this product world-class instead of merely useful?
```

Outputs influence:

```text
Recursive Layer Optimization
Constraint Accumulation
MVP App Direction
Evaluation Lab
```

---

## 9. Target User Questions

Purpose:

```text
Deepen the target user model and select the strongest first user.
```

Examples:

```text
Which user segment experiences the problem most painfully?
Which user has the weakest current workaround?
Which user has urgency right now?
Which user is easiest to reach for the first MVP?
Which user would return repeatedly?
Which user changes the MVP direction most?
Which user would pay or commit attention?
```

Outputs influence:

```text
Target User Model
Problem Causal Model
Differentiation
MVP Direction
Feature Priorities
```

---

## 10. Problem Causal Model Questions

Purpose:

```text
Generate deeper variables, causal links, feedback loops, contradictions, root constraint candidates, and leverage points.
```

Examples:

```text
Which variables are actually moving inside this problem?
Which feedback loops sustain the problem over time?
Which causes are symptoms rather than generators?
Which contradictions make the problem difficult to solve?
Which stakeholder benefits from the current system?
Which incentive keeps the bad pattern in place?
Which root constraint explains the most downstream failures?
Which intervention point has the highest upstream leverage?
What counterfactual world would make this problem disappear?
```

Outputs influence:

```text
Root Constraint
First-Principles Need
Leverage Points
Solution Families
Feature Mechanisms
Evaluation Criteria
```

---

## 11. Desired Result Questions

Purpose:

```text
Transform vague outcomes into measurable, behavioral, emotional, and strategic results.
```

Examples:

```text
What should the user be able to decide after using the product?
What behavior should change?
What emotional state should improve?
What measurable success signal proves the result occurred?
Which desired result matters most to the selected target user?
Which result would make the product feel immediately valuable?
Which result should constrain MVP selection?
```

Outputs influence:

```text
Desired Result Stack
Evaluation Criteria
MVP App Direction
Feature Card Design
Validation Plan
```

---

## 12. Differentiation Questions

Purpose:

```text
Identify what alternatives solve, what they miss, and why this product is meaningfully better.
```

Examples:

```text
What current tools does the user already use to solve this?
What do those alternatives solve well?
What deeper problem do they fail to solve?
What gap is structural rather than feature-level?
What analogy helps explain the product?
What analogy would mislead the product direction?
Why would the user switch from their current workaround?
What must this product prove to avoid becoming a generic AI wrapper?
```

Outputs influence:

```text
Differentiation Thesis
Positioning
MVP Scope
Feature Mechanisms
Evaluation Lab
```

---

## 13. Solution Family Questions

Purpose:

```text
Generate solution families from the root constraint and first-principles need.
```

Examples:

```text
Which solution families attack the root constraint directly?
Which family changes user behavior fastest?
Which family exploits the strongest alternative gap?
Which family is overbuilt for v1?
Which family has the most downstream leverage?
Which family preserves the product philosophy best?
```

Outputs influence:

```text
Solution Family Generator
MVP App Direction Generator
Complexity Allocation
Evaluation Lab
```

---

## 14. MVP App Direction Questions

Purpose:

```text
Ensure the system generates complete MVP app directions, not isolated features.
```

Examples:

```text
What is the smallest complete product experience that proves the thesis?
Which MVP app direction attacks the root constraint most directly?
Which direction enables the desired result fastest?
Which direction is meaningfully differentiated from alternatives?
Which direction is buildable first?
Which direction creates the strongest validation signal?
Which direction depends on unsolved upstream modules?
```

Outputs influence:

```text
MVP App Direction Selection
Feature Card System
First-Build Scope
Delayed Scope
```

---

## 15. Feature Mechanism Questions

Purpose:

```text
Design the internal mechanism that allows a feature to satisfy micro and macro objectives.
```

Examples:

```text
What is the feature’s actual job?
What upstream data does it need?
What internal process creates value?
What downstream output does it produce?
Which micro-objective does this mechanism satisfy?
Which root cause does it attack?
What mechanism alternatives exist?
Which mechanism best balances value, simplicity, and risk?
What failure mode could make this feature harmful or useless?
```

Outputs influence:

```text
Feature Cards
Mechanism Design
Data Point Optimization
Spec Export
Validation Plan
```

---

## 16. Data Point Questions

Purpose:

```text
Determine whether a data point is worth collecting, how it should be collected, and how it improves downstream outputs.
```

Examples:

```text
What does this data point actually represent?
Which variables are inside it?
Why does this variable exist?
When is it needed?
How can it be collected with lowest user friction?
What privacy or reliability risk does it create?
What downstream decision does it improve?
Is there a lower-friction proxy?
What happens if the system does not collect it?
```

Outputs influence:

```text
Data Point Optimization
Feature Mechanisms
Evaluation Lab
Spec Export
```

---

## 17. Evaluation Questions

Purpose:

```text
Improve criteria, weights, tradeoff logic, and final narrowing.
```

Examples:

```text
What criteria should decide the winner?
Which criterion matters most to the macro objective?
Which criterion matters most to the selected user?
Which solution wins only because it sounds impressive?
Which solution fails because it does not attack the root constraint?
Which solution is best for speed but weak for differentiation?
Which assumption could reverse the ranking?
What evidence would raise confidence?
```

Outputs influence:

```text
Evaluation Lab
Constraint Accumulation
MVP Selection
Feature Prioritization
Complexity Allocation
```

---

## 18. Constraint Questions

Purpose:

```text
Identify what the right solution must satisfy and what it must avoid.
```

Examples:

```text
What must every downstream solution satisfy?
Which constraints are hard vs soft?
Which constraints conflict?
Which constraint comes from the target user?
Which constraint comes from the root cause?
Which constraint comes from differentiation?
Which constraint should become an evaluation criterion?
Which candidate violates a hard constraint?
```

Outputs influence:

```text
Constraint Accumulation
Evaluation Lab
Feature Cards
MVP Scope Control
```

---

## 19. Research Questions

Purpose:

```text
Identify what must be checked externally before claims are trusted.
```

Examples:

```text
What current alternatives must be researched?
Which market claim needs validation?
Which user behavior assumption needs evidence?
Which competitor feature claim might be outdated?
Which analogy depends on current product behavior?
Which research result would change the recommendation?
```

Outputs influence:

```text
Differentiation Intelligence
Evaluation Confidence
Validation Lab
```

---

## 20. Validation Questions

Purpose:

```text
Convert assumptions into tests.
```

Examples:

```text
What assumption is most likely to invalidate the MVP?
What experiment can test this assumption fastest?
What user behavior would confirm the desired result?
What signal would prove the mechanism works?
What failure signal should stop development?
What is the smallest test before building the full feature?
```

Outputs influence:

```text
Experimentation / Validation Lab
Feedback Loop Tracker
MVP Scope
Feature Card Test Methods
```

---

## 21. Question Generation Prompt

```text
You are the Question Expansion Engine for SpecForge.

Given:
- selected node
- target user model
- problem causal model
- desired result stack
- root constraint
- differentiation thesis
- current uncertainty
- downstream module to improve

Generate high-value questions that improve the reasoning model or change downstream decisions.

Do not generate generic questions.
For each question, explain:
- why it matters
- what answer would change
- which node it relates to
- what downstream output it affects
- whether it should be answered by user, agent reasoning, research, or experiment

Return:
{
  "questions": [
    {
      "question": "",
      "category": "",
      "priority": "",
      "why_it_matters": "",
      "what_answer_would_change": "",
      "related_nodes": [],
      "downstream_effect": "",
      "suggested_action": "",
      "answer_source": "user | agent_reasoning | research | experiment"
    }
  ],
  "top_critical_questions": [],
  "hidden_low_value_questions": [],
  "recommended_next_action": ""
}

Rules:
- Prioritize questions that can change MVP direction, root constraint, differentiation, mechanism design, or evaluation.
- Hide low-value questions by default.
- If a question requires current external facts, mark research needed.
- If a question tests a product assumption, mark experiment needed.
```

---

## 22. Question Evaluation Criteria

Each question should be scored by:

```text
decision impact
uncertainty reduction
downstream leverage
root-cause relevance
target-user relevance
differentiation relevance
answerability
cost to answer
risk if unanswered
```

---

## 23. Question Ranking

Use this conceptual formula:

```text
Question Priority =
decision impact
+ uncertainty reduction
+ downstream leverage
+ risk if unanswered
- cost to answer
```

---

## 24. Question Quality Gates

Question expansion fails if:

```text
- questions are generic
- too many questions are surfaced
- priority is not assigned
- questions do not say what answer would change
- questions are not connected to graph nodes
- questions do not affect downstream decisions
- low-value questions are not hidden
- research-needed questions are not marked
- experiment-needed questions are not marked
```

---

## 25. Repair Prompt

```text
You are the Question Quality Critic.

Review the generated questions.

Reject or repair them if:
- they are generic
- they do not reduce uncertainty
- they do not connect to target user, root problem, desired result, differentiation, MVP direction, or feature mechanism
- they do not indicate what answer would change
- they do not identify answer source
- too many low-value questions are shown
- critical questions are missing

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_questions": [],
  "top_critical_questions": [],
  "confidence_after_repair": ""
}
```

---

## 26. Whiteboard Visualization

### Default Question Card

Show only top 3 critical questions.

```text
Critical Questions

1. [question]
2. [question]
3. [question]

Action:
Open question map
```

### Expanded Card

```text
question
priority
why it matters
what answer would change
related node
suggested action
```

### Side Panel

Shows:

```text
all questions
filters
priority
answer source
related nodes
answer status
convert to research
convert to experiment
answer now
dismiss
```

---

## 27. Question Map

The Question Map groups questions by category:

```text
Target User
Problem Causal Model
Desired Result
Differentiation
MVP Direction
Feature Mechanism
Evaluation
Validation
```

Each question should connect to the node it improves.

---

## 28. Side Panel Actions

```text
Generate more questions
Answer question
Brainstorm possible answers
Mark as critical
Dismiss
Convert to research task
Convert to experiment
Connect to node
Send answer downstream
Re-rank questions
```

---

## 29. Graph Updates

The Question Expansion Engine creates graph nodes:

```text
Question
Critical Question
Research Question
Validation Question
Answered Question
Dismissed Question
```

It creates edges:

```text
asks_about
reduces_uncertainty_for
affects
requires_research
requires_experiment
answers
dismissed_because
passes_constraint_to
```

---

## 30. Interweaving with Other Modules

### With Target User Layering

Questions deepen user specificity and variant selection.

### With Multifactor Causal Modeling

Questions identify missing variables, loops, contradictions, and root constraint candidates.

### With Desired Result Layering

Questions improve measurability, behavior change, and success criteria.

### With Differentiation Intelligence

Questions identify missing alternatives, weak analogies, and deeper gaps.

### With MVP App Direction

Questions clarify which MVP direction is strongest.

### With Feature Card System

Questions deepen mechanisms, data needs, and failure modes.

### With Evaluation Lab

Questions generate or refine criteria and identify assumptions that could reverse rankings.

### With Validation Lab

Questions become experiments when they cannot be answered by reasoning alone.

---

## 31. Minimum Implementation Requirements

For the first implementation, Question Expansion must generate:

```text
1. top 3 critical questions
2. category for each question
3. priority
4. why it matters
5. what answer would change
6. related node
7. answer source
8. suggested action
```

Do not show all generated questions on the main board.

---

## 32. Acceptance Criteria

The module is complete when:

```text
- questions are decision-relevant
- top questions are visible
- low-value questions are hidden
- every question has a related node
- every question says what answer would change
- answer source is identified
- questions can become research or experiment tasks
- questions can update downstream reasoning when answered
```

---

## 33. Final Instruction

The Question Expansion Engine exists to help SpecForge go deeper only where depth changes the decision.

It should force the system to ask:

```text
What are we uncertain about?
Which uncertainty matters?
What question would change the recommendation?
Who should answer it?
What happens downstream when it is answered?
```

The goal is not more questions.
The goal is better decisions.
