# SpecForge — Spec Exporter / Build Instruction Generator

## 1. Purpose

The **Spec Exporter / Build Instruction Generator** converts the selected MVP app direction, feature cards, mechanisms, data points, constraints, evaluation decisions, and validation requirements into implementation-ready product documentation.

It prevents SpecForge from losing causal reasoning when moving from strategy to build.

The module answers:

> How do we turn the selected MVP app and its reasoning-backed feature system into a precise, buildable specification that a founder, designer, engineer, or coding agent can implement without reinterpreting the product from scratch?

The Spec Exporter should not create a generic PRD.

It should create a **causally traceable build specification**.

---

## 2. Core Thesis

A build spec is only useful if it preserves why the product should be built, not only what should be built.

Weak spec:

```text
Build a whiteboard with cards and a side panel.
```

Strong spec:

```text
Build a graph-backed causal product modeling workspace where each card represents a reasoning artifact connected to target user, root constraint, desired result, differentiation thesis, selected MVP app direction, feature mechanisms, constraints, and evaluation criteria.
```

The spec must preserve:

```text
why this product exists
who it is for
what root constraint it attacks
what desired result it enables
what alternatives it beats
what feature mechanisms create value
what data is required
what must be included now
what must be delayed
what success means
```

---

## 3. Position in SpecForge Pipeline

The Spec Exporter runs after:

```text
Selected MVP App Direction
↓
Feature Card System
↓
Feature Mechanism Generator
↓
Data Point Optimization Model
↓
Evaluation Lab
↓
Causal Quality Critic
↓
Validation Lab
```

Then outputs:

```text
Product Spec
Technical Spec
Prompt Spec
UI Spec
Data Spec
Build Tasks
Acceptance Criteria
Coding-Agent Prompt
Validation Plan
```

---

## 4. Main Output

The module outputs a complete build package:

```text
Product Summary
↓
Causal Trace
↓
Target User
↓
Root Problem / Root Constraint
↓
Desired Result
↓
Differentiation Thesis
↓
Selected MVP App Direction
↓
First-Build Scope
↓
Delayed Scope
↓
User Flow
↓
Screen / View Requirements
↓
Component Requirements
↓
Feature Card Requirements
↓
Mechanism Requirements
↓
Data Model
↓
Prompt / Agent Schemas
↓
Evaluation / Quality Gates
↓
Validation Plan
↓
Implementation Tasks
↓
Acceptance Criteria
↓
Coding-Agent Prompt
```

---

## 5. Required Inputs

The Spec Exporter requires:

```text
Selected MVP App Direction
Feature Cards
Feature Mechanisms
Data Point Model
Knowledge Graph / State Model
Constraint Accumulation System
Evaluation Lab Results
Causal Quality Critic Results
Validation Lab Plan
Whiteboard Unfurl Plan
Side Panel Interaction Plan
```

If required inputs are missing, the exporter should block or mark sections incomplete.

---

## 6. Product Summary

The spec should begin with a concise product definition.

Required fields:

```text
product name
one-line product description
primary target user
core user problem
root constraint
first-principles need
selected MVP app direction
core product loop
primary desired result
differentiation thesis
```

Example:

```text
SpecForge is a causal product decision workspace for solo builders who have vague app ideas and need to choose a high-leverage MVP app direction.

It helps users transform a messy idea into target user layers, multifactor causal problem model, desired result stack, differentiation thesis, MVP app directions, and feature cards.

Its first-principles need is structured confidence: enough causal clarity to choose the next build action.
```

---

## 7. Causal Trace Section

Every spec should preserve the reasoning chain.

Required trace:

```text
Raw Idea
→ Clean Interpretation
→ Target User
→ Root Problem
→ Root Constraint
→ First-Principles Need
→ Desired Result
→ Differentiation Thesis
→ Selected MVP App
→ Feature Cards
→ Build Tasks
```

The spec should include a table:

```text
Reasoning Artifact | Final Decision It Supports | Build Implication
```

Example:

```text
Root constraint:
No causal decision system for converting vague ideas into value-ranked build priorities.

Build implication:
The MVP must include causal modeling and recommendation explanation before spec export.
```

---

## 8. First-Build Scope

The spec must clearly define what is included in version one.

Required fields:

```text
must build now
should build if simple
must delay
must not build
why delayed
```

Example:

```text
Must build now:
- raw prompt input
- graph-backed whiteboard cards
- target user model card
- multifactor causal model card
- desired result stack card
- convergence card
- differentiation card
- MVP app direction cards
- selected MVP app card
- side panel inspection/actions

Must delay:
- full graph editor
- real-time collaboration
- automated external research
- advanced spec export
- iteration timeline
```

---

## 9. User Flow

The spec should define the primary product flow.

Example:

```text
1. User enters messy product idea.
2. System generates clean interpretation.
3. System generates target user model.
4. System generates multifactor problem causal model.
5. System generates desired result stack.
6. System converges on root constraint and first-principles need.
7. System compares alternatives and creates differentiation thesis.
8. System generates MVP app directions.
9. User selects or refines recommended MVP app.
10. System generates feature cards.
11. User opens side panel to inspect, challenge, and refine.
12. System exports build specification.
```

Each step should include:

```text
user action
system response
visible card
side panel actions
graph update
quality gate
```

---

## 10. Screen / View Requirements

The spec should define required views.

### 10.1 Default Whiteboard View

Must show:

```text
Raw Idea
Clean Summary
Target User Model
Problem Causal Model
Desired Result Stack
Root Constraint
First-Principles Need
Alternative Comparison
Differentiation Thesis
Solution Families
MVP App Directions
Selected MVP App
Feature Card Summary
Build Sequence
```

### 10.2 Side Panel

Must show:

```text
selected node header
why it matters
current content
related nodes
constraints
node-specific actions
brainstorm tray
evaluation status
activity trace
chat input
```

### 10.3 Causal Model View

Must show:

```text
variables
feedback loops
contradictions
root constraint candidates
leverage points
evidence needed
```

### 10.4 Feature View

Must show:

```text
feature cards
mechanism chips
data dependencies
failure modes
test methods
```

### 10.5 Evaluation View

Must show:

```text
criteria
weights
scores
tradeoffs
why this won
why others lost
```

---

## 11. Component Requirements

Each UI component should include:

```text
component name
purpose
input props
state
actions
outputs
graph connections
quality badges
empty state
error state
```

Core components:

```text
WhiteboardCanvas
ReasoningCard
CardConnector
ConstraintStrip
QualityBadge
GraphSummaryStrip
SidePanel
BrainstormTray
EvaluationPanel
FeatureCard
MechanismFlow
DataChip
ActivityTrace
ExportPanel
```

---

## 12. Feature Requirement Format

Every feature requirement should be derived from a Feature Card.

Required fields:

```text
feature name
function
macro objective served
micro objective served
root cause attacked
desired result enabled
alternative gap addressed
recommended mechanism
inputs
outputs
data dependencies
user actions
system actions
quality gates
failure modes
test method
acceptance criteria
```

---

## 13. Mechanism Requirement Format

Every mechanism requirement should include:

```text
trigger
inputs
interpretation steps
processing steps
data transformations
outputs
downstream effects
failure modes
risk controls
test method
implementation difficulty
```

Example:

```text
Mechanism:
Problem Causal Modeling

Trigger:
User submits idea or clicks “Run Causal Model.”

Inputs:
clean summary, target user model, desired result guess, constraints.

Process:
extract phenomenon → generate variables → identify loops → identify contradictions → run root tournament → rank leverage points.

Output:
problem causal model artifact, root constraint, first-principles need, solution constraints.
```

---

## 14. Data Model Section

The spec should define required data structures.

Minimum objects:

```text
Project
RawPrompt
EngineRun
ReasoningArtifact
GraphNode
GraphEdge
WhiteboardCard
SidePanelState
ActivityTraceEvent
Constraint
EvaluationScore
QualityGateResult
FeatureCard
FeatureMechanism
DataPoint
SpecOutput
```

For each object, include:

```text
fields
relationships
created by
updated by
used by
```

---

## 15. Prompt / Agent Schema Section

The spec should include prompt modules required by the selected MVP.

For each prompt module:

```text
module name
purpose
inputs
output schema
quality gate
repair prompt
downstream artifacts
```

Required first-build prompt modules:

```text
Prompt Power-Up Analyzer
Target User Layering Modeler
Multifactor Problem Causal Modeling Engine
Desired Result Layering Modeler
Convergence Engine
Differentiation Intelligence Engine
MVP App Direction Generator
Causal Quality Critic
```

---

## 16. Evaluation / Quality Gate Section

The spec should define required quality gates.

Include:

```text
target user quality gate
problem causal model quality gate
desired result quality gate
differentiation quality gate
MVP app direction quality gate
feature card quality gate
mechanism quality gate
data point quality gate
spec export quality gate
```

For each gate:

```text
failure conditions
repair action
status badge
blocking behavior
```

---

## 17. Validation Plan Section

The spec should include a validation plan.

Required:

```text
top assumptions
experiments
hypotheses
success criteria
failure criteria
metrics
model update rules
```

Example:

```text
Assumption:
Users trust the recommendation more when the causal trace is visible.

Experiment:
Compare static recommendation vs graph-backed causal reasoning board.

Success:
Users can explain why the recommendation won and rate confidence at least 7/10.
```

---

## 18. Implementation Task Format

Every build task should include:

```text
task name
description
source feature card
source mechanism
user value
required data objects
UI components
backend logic
prompt logic
acceptance criteria
dependencies
non-goals
```

Example:

```text
Task:
Build Target User Model Card.

Source:
Target User Layering Modeler.

User value:
Helps users see who the product is actually being optimized for.

Components:
ReasoningCard, SidePanel, QualityBadge.

Acceptance criteria:
Card shows primary user, core need, urgency, current workaround, and product implications.
Clicking opens side panel with user variants and actions.
```

---

## 19. Coding-Agent Prompt Output

The exporter should produce a final coding-agent prompt.

The prompt should include:

```text
project goal
MVP scope
non-goals
architecture
data models
components
user flows
feature requirements
prompt modules
acceptance criteria
build order
testing checklist
```

It should explicitly say:

```text
Do not build delayed features.
Do not create generic cards.
Cards must be graph-backed.
Every major generated output must have quality gate status.
```

---

## 20. Spec Quality Gates

The exported spec fails if:

```text
- causal trace is missing
- target user is missing
- root constraint is missing
- desired result is missing
- differentiation thesis is missing
- MVP app direction is unclear
- feature cards are not traceable
- mechanisms are missing
- data model is missing
- quality gates are missing
- validation plan is missing
- build tasks are not scoped
- delayed scope is not explicit
- acceptance criteria are vague
```

---

## 21. Repair Prompt

```text
You are the Spec Export Quality Critic.

Review the exported build spec.

Reject or repair it if:
- it loses the causal reasoning chain
- it includes features not supported by selected MVP direction
- it omits root constraint, desired result, or differentiation thesis
- feature requirements do not map to feature cards
- mechanisms are not defined
- data requirements are not specified
- validation plan is missing
- first-build scope is too large
- delayed scope is unclear
- acceptance criteria are vague

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_spec": {},
  "confidence_after_repair": ""
}
```

---

## 22. Whiteboard Visualization

The Spec Exporter appears as a final action card.

### Default Card

```text
Build Spec Export

Selected MVP:
[...]

Ready sections:
Product, UI, Data, Prompts, Features

Missing:
[...]

Action:
Generate build spec
```

### Expanded Card

```text
causal trace
feature cards included
mechanisms included
data models included
validation included
build tasks included
```

### Side Panel Actions

```text
Generate spec
Preview spec sections
Export product spec
Export technical spec
Export coding-agent prompt
Show missing sections
Repair incomplete spec
Remove delayed features
```

---

## 23. Graph Updates

The Spec Exporter creates graph nodes:

```text
Spec Output
Product Spec
Technical Spec
Prompt Spec
UI Spec
Data Spec
Build Task
Acceptance Criterion
Coding-Agent Prompt
Non-Goal
Delayed Feature
```

It creates edges:

```text
exports
implements
depends_on
maps_to_feature
maps_to_mechanism
maps_to_constraint
validates
excludes
delays
```

---

## 24. Interweaving with Other Modules

### With MVP App Direction Generator

The selected MVP app defines the spec scope.

### With Feature Card System

Feature Cards define feature requirements.

### With Feature Mechanism Generator

Mechanisms define technical process requirements.

### With Data Point Optimization

Data points define schemas and data handling.

### With Evaluation Lab

Evaluation defines prioritization and acceptance criteria.

### With Validation Lab

Validation defines tests and success thresholds.

### With Knowledge Graph

Graph defines traceability and dependencies.

### With Quality Critic

Spec must pass export quality gate.

---

## 25. Minimum Implementation Requirements

For first implementation, Spec Exporter must generate:

```text
1. product summary
2. causal trace
3. selected MVP app
4. first-build scope
5. delayed scope
6. user flow
7. core components
8. feature requirements
9. mechanism requirements
10. data model summary
11. prompt module list
12. quality gates
13. validation plan
14. implementation tasks
15. coding-agent prompt
```

---

## 26. Acceptance Criteria

The Spec Exporter is complete when:

```text
- selected MVP app becomes buildable
- feature cards become requirements
- mechanisms become process specs
- graph/state model becomes data schema
- quality gates become acceptance criteria
- validation plan is included
- delayed scope is explicit
- exported spec can guide an engineer or coding agent
- causal trace is preserved from idea to build task
```

---

## 27. Final Instruction

The Spec Exporter / Build Instruction Generator exists to turn reasoning into execution without losing the reasoning.

It should force the system to ask:

```text
What are we building?
Why this product?
Who is it for?
What root constraint does it attack?
What result does it enable?
What alternatives does it beat?
Which features are required now?
How do those features work?
What data is needed?
How will we know it works?
What should not be built yet?
```

The final spec should be precise enough to build and traceable enough to trust.
