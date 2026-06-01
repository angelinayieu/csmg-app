# SpecForge — Data Point Optimization Model

## 1. Purpose

The **Data Point Optimization Model** defines how SpecForge evaluates, designs, collects, transforms, and uses data inside feature mechanisms, validation loops, evaluation systems, and downstream outputs.

It prevents SpecForge from casually adding data requirements without understanding:

```text
what the data means
why it exists
how it is collected
what friction it creates
what risk it introduces
what downstream output it improves
whether a lower-friction proxy exists
```

The module answers:

> Which data points are worth collecting, how should they be represented, how should they be transformed, and how do they improve the mechanism, user experience, evaluation, and final product outcome?

---

## 2. Core Thesis

A data point is not just an input field.

A data point is an optimization object.

Weak version:

```text
Collect user mood.
```

Strong version:

```text
Data point:
Posting context / emotional intent.

Variables:
mood, audience sensitivity, desired feedback type, vulnerability level.

Problem:
Direct mood collection can feel high-friction or clinical.

Selected mechanism:
Optional lightweight context chips that help route feedback style without forcing heavy self-reporting.

Downstream value:
Improves feedback personalization while preserving low-pressure posting.
```

SpecForge must model data as part of the mechanism, not as an afterthought.

---

## 3. Position in SpecForge System

The Data Point Optimization Model runs inside:

```text
Feature Card System
Feature Mechanism Generator
Evaluation Lab
Experimentation / Validation Lab
Spec Exporter
Feedback Loop Tracker
```

It is especially important after feature mechanisms are generated and before spec export.

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
Data Point Inventory
↓
Concept Definition
↓
Variable Decomposition
↓
Collection Method Options
↓
Friction / Reliability / Privacy Analysis
↓
Downstream Use Mapping
↓
Transformation Process
↓
Selected Data Handling Method
↓
Data Constraints
↓
Validation Requirements
```

---

## 5. Data Point Object Schema

Every data point should use this schema:

```json
{
  "data_point_id": "",
  "name": "",
  "concept_definition": "",
  "variables": [],
  "why_it_exists": "",
  "when_needed": "",
  "source": "user_input | inferred | integration | system_generated | research | analytics",
  "collection_methods": [],
  "collection_friction": "low | medium | high",
  "reliability_risk": "low | medium | high",
  "privacy_risk": "low | medium | high",
  "downstream_uses": [],
  "transformation_process": "",
  "optimization_value": "",
  "alternative_proxies": [],
  "selected_handling_method": "",
  "why_selected": "",
  "failure_modes": [],
  "validation_needed": [],
  "constraints_created": []
}
```

---

## 6. Data Point Layers

### 6.1 Concept Layer

What does the data point mean?

Ask:

```text
What concept does this data represent?
What variables are inside it?
Is it behavioral, emotional, contextual, technical, evaluative, or strategic?
What would be lost if we did not collect it?
```

Example:

```text
Data point:
User confidence score.

Concept:
The user's perceived ability to commit to a build decision after using the system.

Variables:
decision clarity, trust in recommendation, understanding of tradeoffs, fear of wrong direction.
```

---

### 6.2 Variable Layer

Decompose the concept into variables.

Example:

```text
Concept:
Posting pressure.

Variables:
audience ambiguity
expected judgment
metric visibility
self-presentation effort
feedback volatility
identity exposure
comparison intensity
```

This prevents vague data collection.

---

### 6.3 Collection Layer

How can the system obtain the data?

Methods:

```text
direct user input
quick chips / options
open text
behavioral observation
implicit interaction data
third-party integration
AI inference
research source
manual annotation
analytics
```

Each method must be evaluated.

---

### 6.4 Friction Layer

What cost does collection create for the user?

Examples:

```text
extra typing
privacy discomfort
cognitive load
clinical feeling
interrupting flow
decision fatigue
repeated input burden
```

Rule:

```text
Do not collect high-friction data unless it strongly improves downstream output.
```

---

### 6.5 Reliability Layer

How trustworthy is the data?

Risks:

```text
self-report bias
ambiguous interpretation
outdated context
inference error
missing data
overfitting to one signal
user gaming
small sample size
```

---

### 6.6 Privacy / Sensitivity Layer

Does this data create risk?

Sensitive examples:

```text
emotional state
health data
financial data
location
private messages
identity markers
social graph
work history
personal goals
```

Rule:

```text
If data is sensitive, prefer optional collection, local processing, coarse categories, or lower-risk proxy data.
```

---

### 6.7 Downstream Use Layer

What does the data improve?

Examples:

```text
personalization
routing
evaluation
recommendation
feature mechanism
validation
feedback loop
spec export
```

If the data does not improve a downstream decision or mechanism, do not collect it.

---

### 6.8 Transformation Layer

How is raw data converted into useful system state?

Examples:

```text
raw text → structured intent
mood chip → feedback style
user edits → confidence signal
alternative comparison → differentiation constraints
feature usage → mechanism effectiveness score
```

---

### 6.9 Constraint Layer

What constraints does this data point create?

Examples:

```text
Do not require high-friction input before first value.
Do not expose private data on public cards.
Do not infer emotional state without uncertainty.
Do not make recommendations dependent on unavailable data.
```

---

## 7. Data Point Evaluation Criteria

Each data point should be scored by:

```text
downstream value
necessity
collection friction
reliability
privacy risk
implementation complexity
user trust impact
substitutability
validation importance
```

---

## 8. Data Point Scoring Logic

Conceptual formula:

```text
Data Point Value =
downstream value
+ necessity
+ validation importance
+ trust improvement
- collection friction
- reliability risk
- privacy risk
- implementation complexity
```

Decision:

```text
High value, low friction → collect now.
High value, high friction → find proxy or make optional.
Low value, high friction → remove.
Low value, low friction → collect only if it simplifies workflow.
```

---

## 9. Data Collection Strategy Types

### 9.1 Required

Use only when the product cannot work without it.

Example:

```text
Raw idea prompt for SpecForge.
```

### 9.2 Optional

Use when it improves quality but should not block flow.

Example:

```text
Preferred target user.
```

### 9.3 Inferred

Use when the system can infer from existing input, but must mark uncertainty.

Example:

```text
Likely target user from prompt.
```

### 9.4 Progressive

Collect later when needed.

Example:

```text
Ask for technical constraints only after MVP app direction is selected.
```

### 9.5 Proxy

Use lower-friction substitute.

Example:

```text
Use user edits and reruns as a proxy for low confidence.
```

---

## 10. Example: SpecForge Data Point

### Data Point

```text
User confidence after recommendation.
```

### Concept Definition

```text
The user's perceived readiness to commit to the selected MVP app direction.
```

### Variables

```text
clarity
trust
understanding
reduced ambiguity
comfort with tradeoffs
commitment to next step
```

### Collection Methods

```text
1–10 confidence rating
quick chip: low / medium / high
behavioral proxy: user selects recommendation without regenerating
chat signal: user asks fewer clarification questions
```

### Evaluation

```text
Downstream value: high
Friction: low if chip-based
Reliability: medium
Privacy risk: low
```

### Selected Handling

```text
Use optional confidence chip after recommendation, plus behavioral proxy.
```

### Downstream Use

```text
Evaluation Lab
Iteration Timeline
Recommendation quality tracking
Validation Lab
```

---

## 11. Example: Low-Pressure Social App Data Point

### Data Point

```text
Desired feedback type.
```

### Concept Definition

```text
The kind of response the user wants from the audience after posting.
```

### Variables

```text
comfort
validation need
advice seeking
emotional support
casual acknowledgment
no-response preference
```

### Collection Methods

```text
optional chips:
- just sharing
- want encouragement
- want thoughts
- private response only
- no response needed
```

### Problem

```text
If feedback type is not collected, the system may give the wrong kind of response.
If too much is collected, posting becomes high-friction.
```

### Selected Handling

```text
Optional lightweight feedback-intent chip.
```

### Downstream Use

```text
Routes feedback mechanism.
Controls response style.
Reduces mismatch between vulnerability and audience reaction.
```

---

## 12. Prompt for Data Point Optimization Model

```text
You are the Data Point Optimization Model for SpecForge.

Given:
- selected MVP app direction
- feature card
- feature mechanism
- target user model
- problem causal model
- desired result stack
- evaluation criteria
- validation goals

Identify and optimize the data points required by the feature or mechanism.

For each data point:
1. define the concept
2. decompose variables inside it
3. explain why it exists
4. identify when it is needed
5. list collection methods
6. evaluate collection friction
7. evaluate reliability risk
8. evaluate privacy risk
9. map downstream uses
10. define transformation process
11. identify lower-friction proxies
12. select handling method
13. explain why selected
14. define failure modes
15. define validation needs
16. create constraints

Return:
{
  "data_points": [],
  "required_data": [],
  "optional_data": [],
  "inferred_data": [],
  "progressive_data": [],
  "proxy_data": [],
  "removed_data": [],
  "data_constraints": [],
  "data_flow_summary": "",
  "risks": [],
  "validation_needed": []
}

Rules:
- Do not collect data unless it improves a downstream decision, mechanism, evaluation, or validation.
- Prefer lower-friction collection.
- Mark sensitive or unreliable data.
- Do not make core flows depend on unavailable data unless essential.
```

---

## 13. Quality Gates

The Data Point Optimization output fails if:

```text
- data points are listed without concept definitions
- variables are not decomposed
- collection friction is ignored
- privacy risk is ignored
- reliability risk is ignored
- downstream use is unclear
- no alternative proxy is considered
- unnecessary data is collected
- sensitive data is treated casually
- no constraints are created
```

---

## 14. Repair Prompt

```text
You are the Data Point Quality Critic.

Review the data point model.

Reject or repair it if:
- a data point lacks a concept definition
- variables are vague
- the collection method is high-friction without justification
- privacy or sensitivity risk is ignored
- reliability risk is ignored
- the data does not improve downstream output
- lower-friction proxies are not considered
- the system depends on data that may be unavailable
- no constraints are passed downstream

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_data_point_model": {},
  "confidence_after_repair": ""
}
```

---

## 15. Whiteboard Visualization

### Default Data Chip

Data points should not dominate the main board.

Show them as chips attached to Feature Cards.

```text
Data:
raw idea
target user
confidence score
selected MVP
```

### Expanded Data Card

```text
Data Point:
[user confidence]

Concept:
readiness to commit

Collection:
optional chip + behavioral proxy

Downstream use:
evaluation and validation

Risk:
medium reliability
```

### Data Flow View

When opened, show:

```text
upstream data
↓
collection mechanism
↓
transformation process
↓
feature mechanism
↓
downstream output
↓
evaluation / validation use
```

---

## 16. Side Panel Actions

```text
Define data concept
Decompose variables
Show collection methods
Evaluate friction
Evaluate privacy risk
Evaluate reliability
Find lower-friction proxy
Remove data point
Make data optional
Make data progressive
Show downstream use
Turn into spec requirement
Create validation test
```

---

## 17. Graph Updates

The Data Point Optimization Model creates graph nodes:

```text
Data Point
Data Variable
Collection Method
Data Source
Transformation Process
Data Risk
Data Constraint
Proxy Data
Downstream Use
Validation Need
```

It creates edges:

```text
contains_variable
collected_by
inferred_from
transformed_into
used_by
improves
risks
constrains
proxy_for
requires_validation
```

---

## 18. Interweaving with Other Modules

### With Feature Card System

Feature cards define which data points are needed.

### With Feature Mechanism Generator

Mechanisms define how data moves through the system.

### With Evaluation Lab

Data points provide evidence for scores and decision quality.

### With Validation Lab

Data assumptions become experiments.

### With Constraint Accumulation

Data creates friction, privacy, and reliability constraints.

### With Spec Exporter

Selected data points become schemas, input requirements, and implementation tasks.

---

## 19. Minimum Implementation Requirements

For the first implementation, the model must generate:

```text
1. data point name
2. concept definition
3. variables
4. collection method
5. friction rating
6. reliability rating
7. privacy rating
8. downstream use
9. selected handling method
10. constraints created
```

---

## 20. Acceptance Criteria

The module is complete when:

```text
- every important data point is defined conceptually
- variables are decomposed
- collection method is justified
- friction, reliability, and privacy are evaluated
- downstream use is clear
- unnecessary data is removed
- lower-friction proxies are considered
- data constraints are passed downstream
- data chips/cards appear in Feature View or Data Flow View
```

---

## 21. Final Instruction

The Data Point Optimization Model exists to keep SpecForge from collecting or requiring data casually.

It should force the system to ask:

```text
What does this data actually mean?
Why is it needed?
What variables does it contain?
How hard is it to collect?
How reliable is it?
What risk does it create?
What downstream output does it improve?
Is there a lower-friction proxy?
Should it be required, optional, inferred, progressive, or removed?
```

Every data point must earn its place in the system.
