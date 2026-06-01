# SpecForge — Whiteboard Unfurl System v2

## 1. Purpose

The **Whiteboard Unfurl System v2** defines how SpecForge visually transforms a messy product idea into a structured, causal, interactive product decision workspace.

It upgrades the whiteboard from a shallow vertical report into a **graph-backed reasoning canvas** where the user can see the most important reasoning objects, inspect deeper layers, interact with cards, and guide the system toward a stronger product decision.

The module answers:

> What appears on the whiteboard, in what order, with what depth, how cards connect, how users interact, and how the board stays readable while exposing enough causal depth to be useful?

---

## 2. Core Thesis

The whiteboard is not a report.

It is the main operating surface for:

```text
reasoning
brainstorming
causal modeling
constraint narrowing
differentiation
MVP selection
feature shaping
```

Weak whiteboard:

```text
A vertical stack of generated text cards.
```

Strong whiteboard:

```text
A graph-backed, converge-diverge canvas where each card is a reasoning object connected to upstream causes, downstream outputs, constraints, evaluation status, and user actions.
```

---

## 3. Relationship to Knowledge Graph

Every visible whiteboard card must map to a graph node or reasoning artifact.

```text
Graph node / artifact
↓
Whiteboard card
↓
Side panel detail
↓
User action
↓
Graph update
↓
Downstream recalculation
```

Cards should not store independent logic. The graph/state model is the source of truth.

---

## 4. Final Board Shape

The default board should use a **converge → compare → diverge → select → build** structure.

```text
                                  [Target User Model]
                                           \
                                            \
[Raw Idea] → [Prompt Power-Up] → [Problem Causal Model] → [Root Constraint] → [First-Principles Need]
                                            /                                      ↓
                                           /                              [Alternative Comparison]
                         [Desired Result Stack]                                      ↓
                                                                            [Differentiation Thesis]
                                                                                     ↓
                                                                            [Solution Families]
                                                                                     ↓
                                                                           [MVP App Directions]
                                                                                     ↓
                                                                            [Selected MVP App]
                                                                                     ↓
                                                                          [Feature Card System]
                                                                                     ↓
                                                                            [Build Sequence]
```

This layout must show:

```text
sequence
causality
convergence
comparison
divergence
selection
execution path
```

---

## 5. Board Zones

The whiteboard should be organized into zones.

### Zone 1 — Input / Interpretation

Purpose:

```text
Preserve the raw idea and show how SpecForge interpreted it.
```

Visible cards:

```text
Raw Idea
Clean Summary
Root Intent
Main Ambiguity
Hidden Assumption
```

---

### Zone 2 — User / Problem / Result Modeling

Purpose:

```text
Model the target user, causal problem structure, and desired result before solution generation.
```

Visible cards:

```text
Target User Model
Problem Causal Model
Desired Result Stack
```

---

### Zone 3 — Convergence

Purpose:

```text
Distill the deepest actionable product thesis.
```

Visible cards:

```text
Root Constraint
First-Principles Need
Highest-Leverage Intervention
```

---

### Zone 4 — Differentiation

Purpose:

```text
Compare against alternatives and define why the product deserves to exist.
```

Visible cards:

```text
Alternative Comparison
Differentiation Thesis
Useful Analogy
Alternative Gap
```

---

### Zone 5 — Divergence

Purpose:

```text
Generate solution families from the first-principles need, not from surface brainstorming.
```

Visible cards:

```text
Solution Families
Leverage Points
Top Questions
```

---

### Zone 6 — MVP Selection

Purpose:

```text
Generate full MVP app directions and select the strongest first product experience.
```

Visible cards:

```text
Top 3 MVP App Directions
Selected MVP App
Why This Won
Delayed Scope
```

---

### Zone 7 — Feature / Build Path

Purpose:

```text
Turn the selected MVP app into traceable feature modules and build sequence.
```

Visible cards:

```text
Feature Cards
Core Mechanism Cards
Data Dependency Chips
Build Sequence
```

---

## 6. Default Visible Cards

The default board should show only high-leverage cards:

```text
1. Raw Idea
2. Clean Summary
3. Target User Model
4. Problem Causal Model
5. Desired Result Stack
6. Root Constraint
7. First-Principles Need
8. Alternative Comparison
9. Differentiation Thesis
10. Solution Families
11. Top 3 MVP App Directions
12. Selected MVP App
13. Feature Cards Summary
14. Recommended Build Sequence
```

The goal is to show the full reasoning arc without overwhelming the user.

---

## 7. Hidden by Default

Hide unless clicked:

```text
full JSON
all generated questions
all assumptions
full prompt text
all causal variables
all causal links
all low-priority graph nodes
full evaluation tables
all rejected alternatives
all mechanism candidates
all data point details
all trace logs
token usage
debug metadata
```

These should appear in the side panel, deep inspect, or mode-specific views.

---

## 8. Card Depth System

Every card should support three depth levels.

### Depth 1 — Collapsed Card

Shows:

```text
title
one-line thesis
top signal
quality badge
primary action
```

Example:

```text
Problem Causal Model
Thesis: Expression becomes public performance.
Depth: Strategic
Status: Needs 2 evidence checks
Action: Inspect causal loops
```

---

### Depth 2 — Expanded Card

Shows:

```text
top sublayers
key constraints
top alternatives
downstream effect
confidence
```

Example:

```text
Problem Causal Model

Top variables:
- audience ambiguity
- public metric visibility
- feedback volatility

Top loops:
- performance pressure loop
- lurking confidence decay

Root constraint:
expression becomes public performance

Action:
Open full causal model
```

---

### Depth 3 — Deep Inspect

Shown in side panel or modal.

Shows:

```text
full reasoning
all sublayers
all alternatives
quality gate status
graph edges
constraints
evidence needed
activity trace
```

---

## 9. Card Types

The whiteboard should support typed cards.

```text
RawIdeaCard
PromptPowerUpCard
TargetUserModelCard
ProblemCausalModelCard
DesiredResultStackCard
ConvergenceCard
AlternativeComparisonCard
DifferentiationThesisCard
SolutionFamilyCard
MVPAppDirectionCard
SelectedMVPAppCard
FeatureCard
MechanismCard
EvaluationCard
ConstraintCard
GraphSummaryCard
BuildSequenceCard
```

Each card type has its own visible fields, actions, and side-panel behavior.

---

## 10. Problem Causal Model Card

The old Problem Cause Tree should not be shown as only a linear list.

The upgraded card should summarize a multifactor causal model.

### Collapsed

```text
Problem Causal Model

Core thesis:
[problem system thesis]

Root constraint:
[distilled root constraint]

First-principles need:
[need]

Action:
Inspect variables / loops / contradictions
```

### Expanded

```text
Variables:
[top 5]

Feedback loops:
[top 3]

Contradictions:
[top 3]

Root constraint candidates:
[top 3]

Leverage points:
[top 3]
```

### Deep Inspect

Shows:

```text
phenomenon
stakeholder variants
variables
causal links
feedback loops
contradictions
incentives
representations
worldview layer
counterfactuals
root constraint tournament
leverage point ranking
evidence needed
solution constraints
```

---

## 11. Target User Model Card

### Collapsed

```text
Target User Model

Primary user:
[segment]

Core need:
[need]

Urgency:
[score]
```

### Expanded

```text
Context
Behavior
Motivation
Constraint
Decision trigger
Current workaround
Emotional state
Product implications
```

### Deep Inspect

Shows:

```text
user variants
variant scores
highest-pain user
highest-paying user
easiest-to-reach user
constraints passed downstream
```

---

## 12. Desired Result Stack Card

### Collapsed

```text
Desired Result Stack

First-principles result:
[result]

Decision result:
[result]

Behavior change:
[result]
```

### Expanded

```text
Surface output
Functional result
Decision result
Emotional result
Behavior change
Measurable success
Strategic outcome
Constraints passed downstream
```

### Deep Inspect

Shows:

```text
result-to-cause links
success metrics
failure conditions
MVP implications
evaluation criteria
```

---

## 13. Convergence Card

### Collapsed

```text
Convergence

Root constraint:
[...]

First-principles need:
[...]

Highest-leverage intervention:
[...]
```

### Expanded

```text
Why this root constraint won
What weaker interpretations were rejected
What this rules out
What this implies
```

### Deep Inspect

Shows:

```text
root constraint tournament
alternative root constraints
cross-analysis evidence
confidence
repair suggestions
```

---

## 14. Differentiation Card

### Collapsed

```text
Differentiation Intelligence

Existing alternatives:
[top 3]

Deeper gap:
[...]

Product advantage:
[...]
```

### Expanded

```text
direct alternatives
indirect workarounds
analogical examples
existing strengths
existing gaps
differentiation thesis
MVP implications
```

### Deep Inspect

Shows:

```text
alternative matrix
analogy analysis
misleading analogies
research needed
positioning options
constraints passed downstream
```

---

## 15. MVP App Direction Card

### Collapsed

```text
MVP App Direction

[name]

Root cause attacked:
[...]

Core product loop:
[...]

Score:
[...]
```

### Expanded

```text
target user
desired result enabled
alternative gap exploited
required modules
validation goal
main risk
build difficulty
```

### Deep Inspect

Shows:

```text
candidate comparison
why this could win
why this could fail
why others lost
first-build scope
delayed scope
constraints passed to feature cards
```

---

## 16. Selected MVP App Card

### Collapsed

```text
Selected MVP App

[name]

Why this won:
[...]

Next:
Turn into Feature Cards
```

### Expanded

```text
core product loop
first-build scope
delayed scope
required modules
success signals
risks
```

### Deep Inspect

Shows:

```text
full evaluation
rejected candidates
constraint satisfaction
build sequence implications
```

---

## 17. Feature Card Summary

The default board should not show every full feature detail unless the user is in Feature View.

Collapsed summary:

```text
Feature Cards

Core modules:
1. [...]
2. [...]
3. [...]

Coverage:
[root causes / desired results covered]

Action:
Open Feature Card View
```

Expanded:

```text
feature name
function
macro objective
micro objective
recommended mechanism
upstream inputs
downstream outputs
quality status
```

---

## 18. Constraint Strip

The board should include a compact constraint strip.

Example:

```text
Active Constraints

Hard:
- Must attack root constraint
- Must enable desired result
- Must be differentiated from alternatives

Strong:
- Must be buildable as first MVP
- Must reduce user overwhelm
- Must preserve traceability
```

Clicking a constraint opens the side panel.

---

## 19. Quality Gate Badges

Every major card should show a quality badge.

Examples:

```text
Passed
Needs repair
Low confidence
Research needed
Stale
Constraint violation
```

Quality badges help users know where reasoning is strong or weak.

---

## 20. Stale Card Behavior

If an upstream node changes, dependent cards become stale.

Example:

```text
Target User changed.
Problem Causal Model, MVP App Directions, and Recommendation may be stale.
```

Card badge:

```text
Needs recalculation
```

Actions:

```text
Recalculate
Keep old version
Compare old vs new
Branch
```

---

## 21. Whiteboard Edges

Cards should use meaningful edges.

Required edge labels:

```text
interpreted_as
experiences
causes
blocks
explains
creates_need_for
enables_result
compared_against
differentiates_from
attacks_cause
exploits_gap
implements_thesis
selected_as
passes_constraint_to
prepares_for
```

Only show major edges by default.

Additional edges appear on hover, selection, or Graph View.

---

## 22. Card Actions

Every card should have context-specific actions.

Examples:

### Problem Causal Model

```text
Inspect variables
Generate more loops
Challenge root constraint
Run root tournament
Find leverage points
Turn leverage point into solution family
```

### Differentiation

```text
Compare alternative
Generate deeper gap
Generate positioning
Add analogy
Mark analogy misleading
Send constraints to MVP generator
```

### MVP App Direction

```text
Compare
Re-score
Simplify
Make more ambitious
Merge with another
Select
Turn into Feature Cards
```

### Feature Card

```text
Explain mechanism
Generate alternatives
Show data flow
Find failure modes
Convert to tasks
```

---

## 23. Brainstorm Tray on Whiteboard

The board should include a temporary brainstorm tray when the user generates alternatives.

The tray should hold:

```text
candidate options
short rationale
scores
add to board
reject
merge
compare
select
```

Unselected brainstorm outputs should not become permanent board clutter.

---

## 24. Board Modes

The whiteboard should support several modes.

### 24.1 Default Decision View

Shows the main converge-diverge flow.

### 24.2 Causal Model View

Focuses on:

```text
variables
loops
contradictions
root constraints
leverage points
```

### 24.3 Evaluation View

Focuses on:

```text
criteria
weights
scores
tradeoffs
why this won
why others lost
```

### 24.4 Feature View

Focuses on:

```text
feature cards
mechanisms
data flows
dependencies
test methods
```

### 24.5 Graph View

Focuses on:

```text
nodes
edges
clusters
filters
relationships
```

### 24.6 Timeline View

Focuses on:

```text
iterations
changes
value added
stale nodes
recommendation changes
```

MVP should start with Default Decision View, Causal Model View, and Side Panel.

---

## 25. Layout Rules

### Rule 1: Use zones, not random placement.

Cards belong to defined reasoning zones.

### Rule 2: Show the spine.

The user should always see:

```text
Raw Idea → Problem Model → Root Constraint → Differentiation → MVP → Build
```

### Rule 3: Keep card text short.

Use side panel for depth.

### Rule 4: Use sequence and causality.

Avoid flat note clouds.

### Rule 5: Show only high-value connections.

Too many edges reduce clarity.

### Rule 6: Make selected path visible.

When a card is selected, highlight its upstream and downstream path.

---

## 26. Visual Priority Score

Each card gets a visibility priority score.

```text
Visibility Priority =
decision impact
+ downstream leverage
+ uncertainty
+ user-edit value
+ root-cause proximity
+ active focus relevance
```

High-priority cards are visible by default.

Low-priority cards are collapsed, hidden, or moved to side panel.

---

## 27. Card Schema

```json
{
  "card_id": "",
  "node_id": "",
  "card_type": "",
  "zone": "",
  "title": "",
  "one_line_thesis": "",
  "visible_fields": [],
  "expanded_fields": [],
  "quality_badges": [],
  "constraint_badges": [],
  "confidence": 0,
  "priority_score": 0,
  "actions": [],
  "connected_card_ids": [],
  "view_state": "collapsed | expanded | selected | stale",
  "position": {
    "x": 0,
    "y": 0
  }
}
```

---

## 28. Unfurl Sequence

The board should reveal in this order:

```text
1. Raw Idea
2. Clean Summary
3. Target User Model
4. Problem Causal Model
5. Desired Result Stack
6. Root Constraint
7. First-Principles Need
8. Alternative Comparison
9. Differentiation Thesis
10. Solution Families
11. MVP App Directions
12. Selected MVP App
13. Feature Card Summary
14. Build Sequence
```

Do not reveal all at once. The staged unfurl helps users understand the reasoning sequence.

---

## 29. Side Panel Integration

Clicking any card should open the Side Panel.

The side panel handles:

```text
deep details
actions
brainstorming
comparison
evaluation
trace
version history
data flow
constraints
```

The board should never try to contain every detail directly.

---

## 30. Graph Summary Strip

The board should include a compact graph summary:

```text
Core Chain:
Target User → Root Constraint → First-Principles Need → Differentiation Thesis → Selected MVP App → Feature Cards
```

This strip helps the user understand the current model at a glance.

---

## 31. Minimum Implementation Requirements

The first implementation of Whiteboard Unfurl v2 must support:

```text
1. graph-backed cards
2. converge-diverge layout
3. typed cards
4. quality badges
5. constraint strip
6. selected path highlighting
7. staged unfurl sequence
8. side panel opening on card click
9. stale card indicator
10. brainstorm tray
```

Do not build full freeform graph editing first.

---

## 32. Acceptance Criteria

The Whiteboard Unfurl System is complete when:

```text
- the board shows the full reasoning arc
- cards are graph-backed
- the user can see causal sequence
- the user can inspect deeper layers
- the user can interact with important cards
- constraints and quality status are visible
- stale downstream cards are marked after upstream changes
- MVP app direction is clearly separated from feature cards
- feature cards can be opened after MVP app selection
- the board remains readable with deep reasoning available on demand
```

---

## 33. Final Instruction

The Whiteboard Unfurl System v2 exists to make SpecForge’s reasoning visible, editable, and useful.

It should force the interface to show:

```text
what the idea is
who it is for
what causal problem exists
what result matters
what root constraint was found
why alternatives are insufficient
what solution families follow
which MVP app direction wins
which feature modules should be built first
```

The whiteboard should make deep product reasoning feel clear, not overwhelming.
