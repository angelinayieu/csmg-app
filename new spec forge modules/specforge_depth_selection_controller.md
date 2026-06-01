# SpecForge — Depth Selection Controller

## 1. Purpose

The **Depth Selection Controller** decides how deeply SpecForge should analyze a product idea before generating solutions, MVP app directions, feature cards, or build specs.

It prevents two failure modes:

```text
Too shallow:
The system produces obvious, generic, low-quality outputs.

Too deep:
The system over-analyzes low-stakes or simple ideas and overwhelms the user.
```

The module answers:

> Given the prompt, ambiguity, decision stakes, causal complexity, uncertainty, and user goal, what level of modeling depth is required before downstream generation is allowed?

Depth is not a style choice.
Depth is an operational decision.

---

## 2. Core Thesis

SpecForge should not always run the same analysis depth.

Weak behavior:

```text
Run the same full pipeline for every prompt.
```

Strong behavior:

```text
Choose the minimum depth required to produce a trustworthy decision, then escalate only when ambiguity, causal complexity, decision stakes, or confidence risk are high.
```

Depth selection controls cost, speed, clarity, and output quality.

---

## 3. Position in SpecForge Pipeline

The Depth Selection Controller runs after Prompt Power-Up and before deeper modeling.

```text
Raw Prompt
↓
Prompt Power-Up Analyzer
↓
Depth Selection Controller
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
Differentiation
↓
Solution Families
↓
MVP App Directions
```

It also runs again when the user asks to:

```text
go deeper
simplify
run full autopilot
run quick mode
research competitors
generate spec
```

---

## 4. Main Output

The module outputs:

```text
Depth Level
↓
Reason for Depth
↓
Required Modules
↓
Modules to Skip or Delay
↓
Risk if Too Shallow
↓
Risk if Too Deep
↓
Escalation Conditions
↓
User Override Options
```

---

## 5. Depth Levels

## Level 1 — Surface Clarification

Use when:

```text
idea is simple
user only needs quick clarification
decision stakes are low
few variables are involved
no MVP decision is needed yet
```

Runs:

```text
Prompt Power-Up
Basic Target User Guess
Basic Desired Result Guess
Light Recommendation
```

Does not run:

```text
full causal model
root tournament
differentiation engine
MVP app direction generator
feature mechanisms
```

---

## Level 2 — Structured Product Model

Use when:

```text
user wants a more organized product idea
some ambiguity exists
a simple MVP suggestion is needed
target user is somewhat clear
problem is not deeply systemic
```

Runs:

```text
Prompt Power-Up
Target User Layering
Basic Problem Cause Model
Desired Result Stack
Basic Differentiation
MVP App Direction Options
```

Does not require:

```text
full multifactor causal model
feedback loops
root constraint tournament
complex mechanism analysis
```

---

## Level 3 — Multifactor Causal Model

Use when:

```text
problem has multiple interacting variables
user wants deep first-principles reasoning
solution quality depends on understanding causes
the idea risks becoming shallow or generic
the user wants world-class product direction
```

Runs:

```text
Prompt Power-Up
Target User Layering
Multifactor Problem Causal Modeling
Desired Result Layering
Cross-Analysis
Convergence
Differentiation
Solution Families
MVP App Directions
Evaluation Lab
```

Required for:

```text
SpecForge core product work
social system design
complex product strategy
agent architecture
multi-module apps
```

---

## Level 4 — Research-Backed Strategic Model

Use when:

```text
current alternatives must be verified
market facts may have changed
competitor claims matter
public products are being compared
financial or strategic stakes are high
the user needs external evidence
```

Runs everything in Level 3 plus:

```text
external research
competitor verification
market comparison
evidence confidence scoring
research-needed flags
validation plan
```

Required for:

```text
competitor comparison
market positioning
current product feature claims
investment/funding decisions
public launch strategy
```

---

## Level 5 — Iterative Validation Model

Use when:

```text
the product is being built or tested
real user feedback exists
validation results should update the model
multiple iterations are expected
the system needs to track learning over time
```

Runs:

```text
Level 4 where needed
Validation Lab
Iteration Timeline
Feedback Loop Tracker
Model Versioning
Recommendation Recalculation
```

---

## 6. Depth Selection Criteria

Score each criterion from 1 to 5.

```text
ambiguity
target user uncertainty
causal complexity
desired result vagueness
differentiation uncertainty
decision stakes
implementation cost
confidence risk
need for current research
user requested depth
```

---

## 7. Depth Scoring Logic

Conceptual formula:

```text
Depth Need =
ambiguity
+ target user uncertainty
+ causal complexity
+ desired result vagueness
+ differentiation uncertainty
+ decision stakes
+ implementation cost
+ confidence risk
+ research need
```

Suggested mapping:

```text
0–12: Level 1
13–20: Level 2
21–32: Level 3
33–40: Level 4
41+: Level 5
```

The exact numbers can be tuned.

---

## 8. Trigger Rules

### Trigger Level 3 automatically if:

```text
user asks for first principles
user asks for deep causal modeling
user asks for sophisticated product optimization
user asks why current solutions are shallow
user is designing a multi-module agent/product
user wants world-class quality
```

### Trigger Level 4 automatically if:

```text
user asks about current competitors
user asks to compare against real products
market claims are needed
current feature claims are needed
public companies or product alternatives are discussed
```

### Trigger Level 5 automatically if:

```text
validation data exists
user asks to update based on feedback
user asks how model changed over time
user asks to track iterations
```

---

## 9. Module Selection by Depth

### Level 1 Modules

```text
Prompt Power-Up Analyzer
Light Target User Guess
Light Desired Result Guess
Quick Recommendation
```

### Level 2 Modules

```text
Prompt Power-Up Analyzer
Target User Layering Modeler
Basic Problem Cause Model
Desired Result Layering Modeler
Basic Differentiation
MVP App Direction Generator
```

### Level 3 Modules

```text
Prompt Power-Up Analyzer
Target User Layering Modeler
Multifactor Problem Causal Modeling Engine
Desired Result Layering Modeler
Cross-Analysis Engine
Convergence Engine
Differentiation Intelligence Engine
Divergence / Solution Family Generator
MVP App Direction Generator
Evaluation Lab
Causal Quality Critic
```

### Level 4 Modules

```text
All Level 3 modules
Research triggers
Evidence confidence scoring
Competitor verification
Alternative landscape verification
Validation Lab
```

### Level 5 Modules

```text
All relevant prior modules
Experimentation / Validation Lab
Feedback Loop Tracker
Iteration Timeline
Model Versioning
Recommendation Recalculation
```

---

## 10. Risk if Too Shallow

The controller must explain the risk of under-analysis.

Examples:

```text
If we stay shallow, the system may generate generic features instead of solving the root constraint.

If we skip differentiation, the product may duplicate existing alternatives.

If we skip target user layering, the MVP may optimize for an imaginary average user.

If we skip causal modeling, feature mechanisms may attack symptoms instead of root causes.
```

---

## 11. Risk if Too Deep

The controller must also explain the risk of over-analysis.

Examples:

```text
If we run full causal modeling on a simple prompt, the user may feel overwhelmed.

If we research before clarifying the product thesis, research may focus on the wrong alternatives.

If we generate too many layers before showing value, the product may feel slow or academic.
```

---

## 12. Escalation Conditions

The system should escalate depth when:

```text
quality critic fails output as shallow
root constraint remains vague
MVP candidates look generic
differentiation is weak
user asks for deeper reasoning
confidence is low
high-stakes decision is detected
research-needed flags appear
```

---

## 13. De-Escalation Conditions

The system should reduce depth when:

```text
user asks for quick mode
task is low-stakes
user only wants a summary
analysis is becoming repetitive
next action is already clear
additional depth would not change recommendation
```

---

## 14. Depth Recommendation Object Schema

```json
{
  "depth_level": "",
  "depth_name": "",
  "reason": "",
  "scores": {
    "ambiguity": 0,
    "target_user_uncertainty": 0,
    "causal_complexity": 0,
    "desired_result_vagueness": 0,
    "differentiation_uncertainty": 0,
    "decision_stakes": 0,
    "implementation_cost": 0,
    "confidence_risk": 0,
    "research_need": 0,
    "user_requested_depth": 0
  },
  "required_modules": [],
  "modules_to_skip_or_delay": [],
  "risk_if_too_shallow": "",
  "risk_if_too_deep": "",
  "escalation_conditions": [],
  "user_override_options": [],
  "confidence": 0
}
```

---

## 15. Prompt for Depth Selection Controller

```text
You are the Depth Selection Controller for SpecForge.

Given:
- raw prompt
- prompt power-up output
- ambiguity list
- hidden assumptions
- target user uncertainty
- problem complexity
- desired result vagueness
- differentiation uncertainty
- user requested depth
- implementation stakes

Select the appropriate analysis depth before solution generation.

Evaluate:
1. ambiguity
2. target user uncertainty
3. causal complexity
4. desired result vagueness
5. differentiation uncertainty
6. decision stakes
7. implementation cost
8. confidence risk
9. research need
10. user requested depth

Choose:
Level 1 — Surface Clarification
Level 2 — Structured Product Model
Level 3 — Multifactor Causal Model
Level 4 — Research-Backed Strategic Model
Level 5 — Iterative Validation Model

Return:
{
  "depth_level": "",
  "depth_name": "",
  "reason": "",
  "scores": {},
  "required_modules": [],
  "modules_to_skip_or_delay": [],
  "risk_if_too_shallow": "",
  "risk_if_too_deep": "",
  "escalation_conditions": [],
  "user_override_options": [],
  "confidence": 0
}

Rules:
- Do not over-analyze simple low-stakes prompts.
- Do not under-analyze complex product architecture.
- Trigger research-backed depth when current competitors or market facts matter.
- Explain what will be skipped or delayed.
```

---

## 16. Quality Gates

Depth selection fails if:

```text
- no level is selected
- reason is generic
- required modules are missing
- risks are not explained
- shallow depth is selected despite high causal complexity
- research mode is skipped despite current competitor claims
- no user override options are provided
```

---

## 17. Repair Prompt

```text
You are the Depth Selection Quality Critic.

Review the depth selection.

Reject or repair it if:
- selected depth does not match ambiguity or complexity
- risk if too shallow is missing
- risk if too deep is missing
- module list is inconsistent with depth level
- research need is ignored
- user requested depth is ignored
- no escalation conditions are provided

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_depth_selection": {},
  "confidence_after_repair": ""
}
```

---

## 18. Whiteboard Visualization

### Depth Badge

Show near Prompt Power-Up:

```text
Depth:
Level 3 — Multifactor Causal Model
```

### Expanded Depth Card

```text
Why:
High ambiguity, high causal complexity, high decision impact.

Will run:
Target User, Causal Model, Desired Result, Cross-Analysis, Convergence, Differentiation, MVP Directions.

Will delay:
Full Spec Export, Iteration Timeline.
```

### Side Panel

Shows:

```text
scores
required modules
skipped modules
risk if shallow
risk if too deep
override options
```

---

## 19. Side Panel Actions

```text
Run quick mode
Run deeper model
Enable research-backed mode
Skip module
Add module
Explain depth choice
Change depth level
Recalculate depth after edit
```

---

## 20. Graph Updates

The Depth Selection Controller creates graph nodes:

```text
Depth Recommendation
Depth Score
Required Module
Skipped Module
Escalation Condition
Depth Risk
```

It creates edges:

```text
requires
skips
delays
escalates_if
chosen_because
risks_if_skipped
prepares_for
```

---

## 21. Interweaving with Other Modules

### With Prompt Power-Up

Uses ambiguity, assumptions, and inferred intent.

### With Causal Quality Critic

Escalates if outputs are shallow.

### With Complexity Allocation

Controls how much reasoning and UI complexity is appropriate.

### With Question Expansion

Determines how many and what type of questions to generate.

### With Research / Validation

Triggers Level 4 or Level 5 when external evidence or real feedback is needed.

---

## 22. Minimum Implementation Requirements

For first implementation, Depth Selection must generate:

```text
1. selected depth level
2. reason
3. score summary
4. required modules
5. skipped/delayed modules
6. risk if too shallow
7. risk if too deep
8. override options
```

---

## 23. Acceptance Criteria

The module is complete when:

```text
- every project has a depth level
- depth level changes module execution
- users can override depth
- shallow outputs can trigger escalation
- research needs trigger research-backed mode
- depth badge appears on the whiteboard
- skipped modules are explicit
```

---

## 24. Final Instruction

The Depth Selection Controller exists to protect SpecForge from both shallow thinking and unnecessary complexity.

It should force the system to ask:

```text
How deep does this need to go?
What happens if we go too shallow?
What happens if we go too deep?
Which modules are actually required?
Which modules should be delayed?
When should we escalate?
```

Depth should be intentional, not automatic.
