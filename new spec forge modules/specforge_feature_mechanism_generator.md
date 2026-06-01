# SpecForge — Feature Mechanism Generator

## 1. Purpose

The **Feature Mechanism Generator** defines how each selected feature actually works.

It prevents SpecForge from producing shallow feature names without explaining the internal process that creates user value.

The module answers:

> Given a selected MVP app direction and a Feature Card, what exact mechanism should make the feature work, what inputs does it use, what process does it run, what output does it create, what downstream behavior changes, and why is this mechanism the best option?

A feature without a mechanism is not buildable.

---

## 2. Core Thesis

A feature name is not enough.

Weak version:

```text
Feature:
Problem Cause Tree
```

Strong version:

```text
Feature:
Multifactor Problem Causal Model

Mechanism:
Extract the surface phenomenon, generate causal variables, build causal links, identify feedback loops and contradictions, run a root-constraint tournament, rank leverage points, then output solution constraints that downstream modules must satisfy.
```

The mechanism explains how the feature transforms inputs into useful outputs.

---

## 3. Position in SpecForge Pipeline

The Feature Mechanism Generator runs after:

```text
Selected MVP App Direction
↓
Feature Card System
↓
Data Point Optimization Model
```

Then feeds:

```text
Evaluation Lab
Validation Lab
Spec Exporter
Prototype / Coding Prompt Generator
```

Pipeline position:

```text
Selected MVP App
↓
Feature Card System
↓
Feature Mechanism Generator
↓
Data Point Optimization Model
↓
Evaluation Lab
↓
Validation Lab
↓
Spec Exporter
```

---

## 4. Main Output

The module outputs:

```text
Feature Mechanism
↓
Mechanism Alternatives
↓
Selected Mechanism
↓
System Flow
↓
Input Requirements
↓
Processing Steps
↓
Data Transformations
↓
Output Artifacts
↓
Downstream Effects
↓
Failure Modes
↓
Test Method
↓
Implementation Notes
```

---

## 5. Feature Mechanism Object Schema

Every mechanism should use this schema:

```json
{
  "mechanism_id": "",
  "feature_id": "",
  "feature_name": "",
  "mechanism_name": "",
  "mechanism_thesis": "",
  "root_cause_attacked": "",
  "micro_objective_served": "",
  "macro_objective_served": "",
  "user_action": "",
  "trigger": "",
  "inputs": [],
  "data_points_required": [],
  "system_process": [],
  "ai_reasoning_steps": [],
  "data_transformations": [],
  "outputs_created": [],
  "downstream_effects": [],
  "user_behavior_changed": "",
  "value_metric": "",
  "mechanism_alternatives": [],
  "selected_mechanism_reason": "",
  "failure_modes": [],
  "risk_controls": [],
  "implementation_difficulty": "",
  "test_method": "",
  "constraints_satisfied": [],
  "constraints_violated": []
}
```

---

## 6. Mechanism Layers

Each mechanism should be decomposed into layers.

```text
Trigger Layer
↓
Input Layer
↓
Interpretation Layer
↓
Processing Layer
↓
Transformation Layer
↓
Output Layer
↓
User Behavior Layer
↓
Evaluation Layer
↓
Failure / Repair Layer
```

---

## 7. Trigger Layer

What starts the mechanism?

Examples:

```text
User submits raw idea.
User clicks “Go deeper.”
User selects a root constraint.
User asks to compare alternatives.
User selects an MVP app direction.
User opens a Feature Card.
```

A trigger should be clear and implementable.

---

## 8. Input Layer

What does the mechanism need?

Input types:

```text
user input
selected node
graph context
constraints
previous artifacts
data points
evaluation criteria
external research
user edits
```

Example:

```text
Inputs for Problem Causal Model:
- clean summary
- target user model
- initial problem guess
- desired result guess
- constraints
- current alternatives
```

---

## 9. Interpretation Layer

How does the system understand the input?

Examples:

```text
extract intent
identify explicit vs inferred information
map input to node types
identify missing context
mark uncertainty
detect conflicts
```

This prevents the mechanism from operating on vague text blindly.

---

## 10. Processing Layer

What reasoning steps happen?

Examples:

```text
generate variables
generate causal links
identify feedback loops
generate contradictions
rank root constraints
compare alternatives
score mechanisms
generate feature candidates
```

Processing steps must be ordered and explicit.

---

## 11. Transformation Layer

How does data change form?

Examples:

```text
raw prompt → clean summary
target user label → layered user model
problem statement → causal variable map
causal variables → feedback loops
root constraint → solution constraints
selected MVP → feature cards
feature card → implementation tasks
```

---

## 12. Output Layer

What artifact is created?

Examples:

```text
Target User Model
Problem Causal Model
Desired Result Stack
Differentiation Thesis
MVP App Direction
Feature Card
Data Flow
Evaluation Score
Build Task
```

Outputs should be structured, not only prose.

---

## 13. User Behavior Layer

What does this mechanism help the user do differently?

Examples:

```text
choose a clearer target user
understand root causes
reject weak MVP directions
trust a recommendation
select a build path
understand why a feature exists
turn a feature into implementation tasks
```

If no behavior changes, the mechanism is weak.

---

## 14. Evaluation Layer

How should the mechanism be judged?

Criteria may include:

```text
root-cause alignment
micro-objective fit
macro-objective fit
output usefulness
downstream leverage
user comprehension
buildability
risk
evidence strength
```

---

## 15. Failure / Repair Layer

What can go wrong?

Examples:

```text
output is generic
mechanism skips reasoning steps
input is insufficient
data point is unreliable
user does not understand output
mechanism creates too much complexity
mechanism fails to change behavior
mechanism does not connect to root constraint
```

Each mechanism must include repair paths.

---

## 16. Mechanism Alternative Generation

The system should generate multiple possible mechanisms before selecting one.

Example for Problem Causal Model:

```text
Mechanism A:
Linear 5 Whys chain.

Mechanism B:
Depth-layered cause spine.

Mechanism C:
Multifactor causal model with variables, loops, contradictions, and root tournament.

Mechanism D:
Interactive user-guided causal graph.
```

Evaluation:

```text
A is simple but too shallow.
B is clearer but still linear.
C is strongest reasoning quality.
D is powerful but too complex for v1.
```

Selected:

```text
C for reasoning engine, simplified into board card view.
```

---

## 17. Mechanism Selection Criteria

Select mechanisms by:

```text
root cause alignment
micro objective alignment
macro objective alignment
downstream leverage
user comprehensibility
implementation feasibility
evaluation clarity
data feasibility
risk control
differentiation strength
```

---

## 18. Prompt for Feature Mechanism Generator

```text
You are the Feature Mechanism Generator for SpecForge.

Given:
- selected MVP app direction
- feature card
- macro objective
- micro objective
- root constraint
- first-principles need
- desired result stack
- target user model
- accumulated constraints
- data point model
- evaluation criteria

Design the internal mechanism that makes this feature work.

For the feature:
1. define the mechanism thesis
2. identify the user action and trigger
3. list required inputs and data points
4. define interpretation steps
5. define processing steps
6. define data transformations
7. define outputs created
8. explain downstream effects
9. explain user behavior changed
10. generate mechanism alternatives
11. evaluate alternatives
12. select the best mechanism
13. identify failure modes
14. define risk controls
15. define implementation difficulty
16. define test method

Return:
{
  "feature_name": "",
  "mechanism_name": "",
  "mechanism_thesis": "",
  "root_cause_attacked": "",
  "micro_objective_served": "",
  "macro_objective_served": "",
  "user_action": "",
  "trigger": "",
  "inputs": [],
  "data_points_required": [],
  "interpretation_steps": [],
  "system_process": [],
  "ai_reasoning_steps": [],
  "data_transformations": [],
  "outputs_created": [],
  "downstream_effects": [],
  "user_behavior_changed": "",
  "value_metric": "",
  "mechanism_alternatives": [],
  "selected_mechanism_reason": "",
  "failure_modes": [],
  "risk_controls": [],
  "implementation_difficulty": "",
  "test_method": "",
  "constraints_satisfied": [],
  "constraints_violated": []
}

Rules:
- Do not output feature names without mechanisms.
- Every mechanism must transform inputs into outputs.
- Every mechanism must attack a cause, enable a desired result, or satisfy a micro-objective.
- Compare at least 3 mechanism alternatives.
- Reject mechanisms that are overbuilt for the first MVP.
```

---

## 19. Quality Gates

The Feature Mechanism output fails if:

```text
- it only describes the feature, not the mechanism
- trigger is unclear
- inputs are missing
- processing steps are vague
- output artifact is missing
- downstream effect is missing
- user behavior change is unclear
- no mechanism alternatives are compared
- no failure modes are identified
- no test method is defined
- mechanism does not connect to root constraint or desired result
```

---

## 20. Repair Prompt

```text
You are the Feature Mechanism Quality Critic.

Review the feature mechanism.

Reject or repair it if:
- it is only a feature description
- it lacks explicit input → process → output flow
- it does not explain how user value is created
- it does not connect to root cause, micro objective, or desired result
- it has no mechanism alternatives
- it does not identify failure modes
- it does not define a test method
- it is too complex for the selected MVP app direction

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_feature_mechanism": {},
  "confidence_after_repair": ""
}
```

---

## 21. Example: SpecForge Feature Mechanism

### Feature

```text
Multifactor Problem Causal Model Card
```

### Mechanism Thesis

```text
Transform a vague problem statement into a causal model with variables, loops, contradictions, root constraint candidates, and leverage points.
```

### Trigger

```text
User runs causal modeling after prompt power-up and target user selection.
```

### Inputs

```text
clean summary
target user model
desired result guess
initial problem guess
constraints
current workarounds
```

### System Process

```text
1. Extract surface phenomenon.
2. Generate stakeholder variants.
3. Generate causal variables.
4. Generate causal links.
5. Identify reinforcing and balancing loops.
6. Identify contradictions.
7. Identify incentives and representations.
8. Generate root constraint candidates.
9. Run root constraint tournament.
10. Rank leverage points.
11. Output solution constraints.
```

### Output

```text
Problem Causal Model artifact
Root Constraint candidates
First-Principles Need
Leverage Points
Solution Constraints
```

### User Behavior Changed

```text
User stops accepting surface problem statements and starts reasoning from causal structure.
```

### Failure Modes

```text
model is too abstract
causal links are speculative
too many variables overwhelm user
root constraint is still vague
```

### Test Method

```text
Compare user confidence and MVP quality after using shallow cause tree vs multifactor causal model.
```

---

## 22. Example: Low-Pressure Social App Feature Mechanism

### Feature

```text
Soft Feedback Loop
```

### Mechanism Thesis

```text
Give users social response without converting expression into public score.
```

### Trigger

```text
User posts into a small context room.
```

### Inputs

```text
post content
selected audience
feedback intent
room context
user sensitivity settings
```

### System Process

```text
1. User posts into bounded audience.
2. System hides public metric counts.
3. Responses are collected as low-intensity reactions or short contextual replies.
4. System avoids ranking responses by popularity.
5. User receives qualitative summary of warmth, resonance, or presence.
6. Feedback is paced to reduce compulsive checking.
```

### Output

```text
soft feedback summary
private / semi-private responses
no public score display
```

### User Behavior Changed

```text
User feels seen without needing to optimize for public engagement.
```

### Failure Modes

```text
feedback feels too weak
private context feels dead
summary feels fake
users still compare response volume
```

### Test Method

```text
Prototype test comparing normal likes vs soft feedback summary and measuring posting comfort, perceived aliveness, and desire to post again.
```

---

## 23. Whiteboard Visualization

### Default Mechanism Chip

Mechanisms should be visible inside Feature Cards as compact chips.

```text
Mechanism:
input → process → output
```

### Expanded Mechanism Card

```text
Mechanism:
[mechanism name]

Input:
[...]

Process:
[...]

Output:
[...]

Why selected:
[...]
```

### Data Flow View

```text
Upstream inputs
↓
Mechanism process
↓
Generated output
↓
Downstream evaluation / user behavior
```

---

## 24. Side Panel Actions

```text
Explain mechanism
Make mechanism more technical
Simplify mechanism
Generate mechanism alternatives
Compare mechanisms
Show input → process → output
Show upstream data
Show downstream effect
Find failure modes
Generate risk controls
Create test method
Convert to implementation tasks
```

---

## 25. Graph Updates

The Feature Mechanism Generator creates graph nodes:

```text
Feature Mechanism
Trigger
Input
Data Point
System Process
AI Reasoning Step
Data Transformation
Output Artifact
Downstream Effect
Failure Mode
Risk Control
Test Method
```

It creates edges:

```text
triggered_by
requires_input
uses_data_point
transforms
produces
enables_result
changes_behavior
attacks_cause
risks
controlled_by
tested_by
implemented_by
```

---

## 26. Interweaving with Other Modules

### With Feature Card System

Feature Cards define the objective; mechanisms define how the feature works.

### With Data Point Optimization

Data points specify what inputs the mechanism needs and how to handle them.

### With Evaluation Lab

Mechanisms are scored by alignment, value, risk, and buildability.

### With Validation Lab

Mechanism assumptions become tests.

### With Spec Exporter

Mechanisms become technical requirements, process flows, and implementation tasks.

### With Complexity Allocation

Mechanisms can be simplified, delayed, or deepened based on complexity budget.

---

## 27. Minimum Implementation Requirements

For the first implementation, each mechanism must include:

```text
1. mechanism name
2. root cause attacked
3. user action / trigger
4. inputs
5. process steps
6. output artifact
7. downstream effect
8. mechanism alternatives
9. selected mechanism reason
10. failure modes
11. test method
```

---

## 28. Acceptance Criteria

The module is complete when:

```text
- every major feature has a mechanism
- every mechanism has input → process → output
- every mechanism connects to root cause or desired result
- mechanism alternatives are compared
- selected mechanism is justified
- failure modes are identified
- mechanisms can become spec requirements
- shallow feature descriptions trigger repair
```

---

## 29. Final Instruction

The Feature Mechanism Generator exists to make features real.

It should force the system to ask:

```text
What exactly happens?
What does the user do?
What does the system do?
What data is needed?
How is input transformed?
What output is created?
What user behavior changes?
Why is this mechanism better than alternatives?
How could it fail?
How do we test it?
```

No feature should move to implementation without a mechanism.
