# SpecForge — Side Panel Interaction System

## 1. Purpose

The **Side Panel Interaction System** is the control layer that makes the SpecForge whiteboard operative.

The whiteboard shows the most important reasoning artifacts.

The side panel lets the user:

```text
inspect
challenge
brainstorm
compare
refine
accept
reject
regenerate
connect
re-score
send downstream
```

Without the side panel, the whiteboard becomes a static report.

With the side panel, every important card becomes an interactive reasoning object.

The module answers:

> When the user clicks any reasoning card, what should they be able to understand, change, deepen, compare, and send downstream?

---

## 2. Core Thesis

The side panel is not a chat box beside the board.

It is the **interaction engine** for causal product reasoning.

Weak version:

```text
A chat box where users ask follow-up questions.
```

Strong version:

```text
A contextual control panel that understands the selected node, shows why it matters, exposes its relationships, offers node-specific brainstorm actions, captures user edits, updates the graph, recalculates downstream cards, and records every change in the activity trace.
```

---

## 3. Position in SpecForge System

The Side Panel Interaction System runs across every module.

It connects:

```text
Whiteboard Cards
↓
Reasoning Artifacts
↓
Knowledge Graph
↓
User Edits
↓
Agent Actions
↓
Evaluation Lab
↓
Downstream Recalculation
↓
Activity Trace
```

It is not one pipeline step. It is a persistent interface system.

---

## 4. Main Responsibilities

The side panel must support:

```text
1. selected node inspection
2. node-specific explanation
3. node-specific brainstorm actions
4. alternatives and rejected options
5. related graph nodes
6. constraints passed in and out
7. evaluation / quality gate status
8. user edits
9. agent chat with selected context
10. downstream recalculation
11. activity trace
12. version history for the selected node
```

---

## 5. Panel Structure

The side panel should use a consistent structure for every selected card.

```text
Selected Object Header
↓
Meaning / Why It Matters
↓
Current Content
↓
Layer Context
↓
Related Nodes
↓
Constraints
↓
Brainstorm / Action Buttons
↓
Alternatives / Comparisons
↓
Evaluation Status
↓
Activity Trace
↓
Chat Input
```

---

## 6. Selected Object Header

The header should show:

```text
node title
node type
module origin
confidence
quality gate status
depth / layer level
```

Example:

```text
Problem Causal Model
Type: Causal Model
Origin: Multifactor Causal Modeling Engine
Confidence: Medium-high
Quality Gate: Passed with 2 uncertainties
Depth: Full Strategic Model
```

---

## 7. Meaning / Why It Matters

Every selected object should explain why it matters.

Example for Root Constraint:

```text
Why this matters:
The root constraint determines which solution families are valid. If this is wrong, MVP ranking and feature design become shallow.
```

Example for Target User:

```text
Why this matters:
Changing the target user changes the problem model, desired result, differentiation comparison, MVP direction, and feature priorities.
```

Example for Feature Card:

```text
Why this matters:
This feature is only valid if its mechanism satisfies the selected micro-objective and traces back to the root constraint.
```

---

## 8. Current Content

The panel should show the selected card’s full content.

Board cards stay short.

The side panel shows:

```text
full reasoning
expanded details
generated alternatives
rejected options
assumptions
uncertainties
evidence needed
```

---

## 9. Layer Context

Every selected object belongs to a layer.

The side panel should show:

```text
macro layer
micro layer
mechanism layer
data layer
evaluation layer
cross-layer connection
```

Example:

```text
Layer context:
Macro objective → structured confidence
Micro objective → identify the highest-leverage root constraint
Mechanism objective → generate and evaluate root constraint candidates
```

---

## 10. Related Nodes

The side panel should show graph neighbors.

Examples:

```text
Root Constraint
connected to:
- Target User Model
- First-Principles Need
- Differentiation Thesis
- Solution Families
- MVP App Directions
```

```text
Feature Card
connected to:
- Selected MVP App
- Micro Objective
- Root Cause Attacked
- Data Points
- Evaluation Criteria
- Test Method
```

---

## 11. Constraints

The side panel should show:

```text
constraints passed into this node
constraints created by this node
constraints violated
constraints satisfied
```

Example:

```text
Constraints passed in:
- Must reduce ambiguity
- Must support build decision
- Must be meaningfully better than ChatGPT

Constraints created:
- MVP must show causal trace
- Features must map to root causes
- Evaluation must explain why one path won
```

---

## 12. Node-Specific Action System

Each node type should have its own action set.

Do not show the same actions everywhere.

---

## 13. Actions for Target User Model

```text
Brainstorm more user segments
Compare user variants
Make primary user more specific
Find highest-pain user
Find easiest-to-reach user
Find highest-paying user
Change primary user
Show how this changes the problem model
Show how this changes MVP direction
Pass user constraints downstream
```

---

## 14. Actions for Problem Causal Model

```text
Go deeper
Generate alternative causal variables
Generate feedback loops
Generate stakeholder variants
Identify contradictions
Generate root constraint candidates
Run root constraint tournament
Find leverage points
Show downstream effects
Connect to desired result
Turn leverage point into solution family
Repair shallow model
```

---

## 15. Actions for Desired Result Stack

```text
Make result more measurable
Generate alternative desired results
Connect result to cause model
Show which causes block this result
Turn result into evaluation criteria
Turn result into MVP constraints
Challenge first-principles result
Generate success metrics
Generate failure conditions
```

---

## 16. Actions for Convergence Card

```text
Challenge root constraint
Generate alternative root constraints
Show why this root constraint won
Show what this rules out
Show implications for solution design
Run convergence repair
Send to differentiation
Send to solution families
```

---

## 17. Actions for Differentiation Intelligence

```text
Add alternative
Compare against selected alternative
Generate deeper gap
Generate stronger positioning
Generate analogies
Flag analogy as useful
Flag analogy as misleading
Turn alternative gap into constraint
Send implications to MVP generator
Run research
```

---

## 18. Actions for Solution Family

```text
Generate MVP app directions
Compare solution families
Merge families
Reject family
Show root cause attacked
Show desired result enabled
Show mechanism direction
Show risks introduced
Send to MVP App Direction Generator
```

---

## 19. Actions for MVP App Direction

```text
Compare MVP directions
Generate another MVP candidate
Merge two MVP directions
Make selected MVP simpler
Make selected MVP more ambitious
Show why this won
Show why others lost
Re-score with different criteria
Turn selected MVP into Feature Cards
Define first-build scope
Define delayed scope
```

---

## 20. Actions for Feature Card

```text
Explain mechanism
Make mechanism more technical
Simplify mechanism
Generate mechanism alternatives
Show upstream inputs
Show downstream outputs
Show data dependencies
Find failure modes
Connect to evaluation criteria
Convert to implementation tasks
Send to spec exporter
```

---

## 21. Actions for Data Point Card

```text
Define data concept
List variables inside this data point
Show why this data is needed
Evaluate collection friction
Evaluate reliability risk
Evaluate privacy risk
Generate collection mechanisms
Show downstream uses
Replace data point
Remove data point
Send to mechanism optimization
```

---

## 22. Actions for Evaluation Lab Card

```text
Show criteria
Change criteria weights
Explain score
Show tradeoffs
Show why this won
Show why others lost
Run stricter evaluation
Run buildability-first evaluation
Run differentiation-first evaluation
Run root-cause-first evaluation
Repair weak recommendation
```

---

## 23. Actions for Constraint Card

```text
Show source of constraint
Show affected nodes
Show violated nodes
Mark as hard constraint
Mark as soft constraint
Resolve conflict
Turn into evaluation criterion
Remove constraint
Pass downstream
```

---

## 24. Chat With Selected Context

The chat input should always know what node is selected.

Examples:

If Target User is selected:

```text
Make this user more specific.
Compare this user with students.
Which user has stronger urgency?
Change the primary user to solo founders.
```

If Problem Causal Model is selected:

```text
Generate more non-obvious causal variables.
Find deeper feedback loops.
Challenge the current root constraint.
Show which causes are software-solvable.
```

If MVP App Direction is selected:

```text
Make this MVP simpler.
Show why this is a full app direction, not just a feature.
Merge this with Candidate B.
Re-score for fastest build.
```

If Feature Card is selected:

```text
Generate 3 alternative mechanisms.
Make this technically buildable.
Show data dependencies.
Turn this into implementation tasks.
```

---

## 25. Brainstorm Tray

The side panel should not immediately add every brainstormed idea to the board.

Use a temporary **Brainstorm Tray**.

The tray shows:

```text
generated alternatives
scores
why each option matters
add to board
reject
merge
compare
select
```

Only selected options become permanent graph nodes or board cards.

This prevents clutter.

---

## 26. Downstream Recalculation

When the user changes a node, the system must identify affected downstream nodes.

Example:

User changes primary target user.

Affected downstream nodes:

```text
Problem Causal Model
Desired Result Stack
Differentiation Intelligence
MVP App Directions
Feature Cards
Evaluation Scores
Recommendation
```

The side panel should show:

```text
This change affects 6 downstream cards.
Recalculate now?
```

Actions:

```text
Recalculate affected cards
Preview impact first
Only update selected branch
Cancel change
```

---

## 27. Activity Trace

Every user and agent action should create a trace event.

Trace event should include:

```text
timestamp
actor: user | agent
action type
selected node
previous value
new value
reason
affected downstream nodes
graph changes
confidence change
```

Example:

```text
User changed primary target user from “general founders” to “solo technical founders.”

Affected:
Problem Causal Model, MVP App Directions, Differentiation Thesis.

Result:
MVP Direction A score increased from 7.8 to 8.6.
```

---

## 28. Version History

Each node should keep version history.

Users should be able to:

```text
view previous versions
compare versions
restore version
branch from version
see why recommendation changed
```

This is important for trust.

---

## 29. Side Panel Modes

The panel should support multiple modes:

### 29.1 Inspect Mode

Default mode.

Shows:

```text
meaning
content
related nodes
constraints
actions
```

### 29.2 Brainstorm Mode

Shows:

```text
alternatives
candidate options
scores
select / reject
```

### 29.3 Compare Mode

Shows:

```text
side-by-side alternatives
tradeoffs
evaluation criteria
recommendation
```

### 29.4 Evaluate Mode

Shows:

```text
criteria
scores
weights
why this won
what could reverse decision
```

### 29.5 Trace Mode

Shows:

```text
activity history
changes over time
affected nodes
version history
```

### 29.6 Data Flow Mode

Shows:

```text
upstream inputs
processing
downstream outputs
data dependencies
```

---

## 30. Whiteboard Sync Behavior

The side panel and whiteboard must remain synchronized.

When a side-panel action creates or changes an artifact:

```text
1. update structured artifact
2. update graph nodes / edges
3. update visible card
4. update related cards if needed
5. add activity trace
6. update quality gate status
```

---

## 31. Interaction Priority

Not every node deserves equal interaction depth.

### Deeply Interactive

```text
Target User Model
Problem Causal Model
Desired Result Stack
Root Constraint
Differentiation Thesis
Solution Families
MVP App Directions
Feature Cards
Evaluation Lab
Constraints
```

### Inspectable but Lighter

```text
Raw Idea
Clean Summary
Prompt Power-Up
Prompt Checkpoints
Graph Summary
Activity Trace
```

### Mostly Hidden / System-Level

```text
token usage
internal prompts
full JSON
low-priority questions
debug data
```

---

## 32. Side Panel Data Schema

```json
{
  "selected_node_id": "",
  "selected_node_type": "",
  "origin_module": "",
  "title": "",
  "summary": "",
  "why_it_matters": "",
  "current_content": {},
  "layer_context": {
    "macro_objective": "",
    "micro_objective": "",
    "mechanism_objective": ""
  },
  "related_nodes": [],
  "constraints_in": [],
  "constraints_out": [],
  "evaluation_status": {
    "confidence": 0,
    "quality_gate": "",
    "issues": []
  },
  "available_actions": [],
  "brainstorm_tray": [],
  "activity_trace": [],
  "chat_context": {}
}
```

---

## 33. Action Object Schema

```json
{
  "action_id": "",
  "label": "",
  "action_type": "brainstorm | compare | evaluate | refine | regenerate | connect | accept | reject | send_downstream",
  "target_node_id": "",
  "requires_confirmation": true,
  "expected_output_type": "",
  "affected_downstream_nodes": [],
  "prompt_template": "",
  "quality_gate_required": true
}
```

---

## 34. Quality Gates

The side panel system fails if:

```text
- every node shows the same actions
- user changes do not update the graph
- downstream effects are not shown
- brainstormed alternatives automatically clutter the board
- selected node context is not preserved in chat
- evaluation status is hidden
- constraints are not visible
- trace is missing
- users cannot accept/reject generated alternatives
```

---

## 35. Minimum Implementation Requirements

For the first implementation, the side panel must support:

```text
1. selected node header
2. why it matters
3. current content
4. related nodes
5. node-specific actions
6. brainstorm tray
7. constraints
8. evaluation status
9. activity trace
10. context-aware chat input
```

---

## 36. Acceptance Criteria

The Side Panel Interaction System is complete when:

```text
- clicking any major card opens relevant details
- actions change based on node type
- user can brainstorm alternatives without cluttering the board
- user can accept / reject alternatives
- graph updates after accepted changes
- affected downstream nodes are identified
- activity trace records changes
- chat uses selected-node context
- evaluation and constraints are visible
```

---

## 37. Final Instruction

The Side Panel Interaction System exists to make SpecForge controllable.

It should force the product to support this loop:

```text
Click node
↓
Understand why it matters
↓
Brainstorm / challenge / compare
↓
Select stronger version
↓
Update graph
↓
Recalculate downstream cards
↓
Improve recommendation
```

The side panel is where users actively improve the reasoning system.
