# SpecForge — Operation Card System

## 1. Purpose

The **Operation Card System** standardizes how every SpecForge engine, module, and reasoning operation is represented on the whiteboard and in the side panel.

It prevents the product from showing only final outputs while hiding the transformation process that created them.

The module answers:

> For each SpecForge operation, what did it receive, what did it do, what did it output, what quality gate did it pass, what constraints did it use, and what downstream cards did it affect?

Operation Cards make the reasoning process inspectable without exposing overwhelming internal prompt details by default.

---

## 2. Core Thesis

SpecForge should not only show reasoning artifacts.

It should also show the **operations that produced them**.

Weak version:

```text
Here is the Problem Causal Model.
```

Strong version:

```text
Operation:
Multifactor Problem Causal Modeling

Input:
Target User Model + Initial Problem Guess + Desired Result Guess.

Process:
Generated variables, loops, contradictions, root candidates, leverage points.

Output:
Problem Causal Model + Root Constraint Candidates + Solution Constraints.

Quality Gate:
Passed with 2 evidence gaps.

Downstream:
Feeds Cross-Analysis, Convergence, Differentiation, and MVP App Direction.
```

This gives the user trust and control.

---

## 3. Position in SpecForge System

The Operation Card System is not a single pipeline step.

It is a display and inspection layer used across all engines:

```text
Prompt Power-Up Analyzer
Depth Selection Controller
Target User Layering Modeler
Multifactor Problem Causal Modeling Engine
Desired Result Layering Modeler
Cross-Analysis Engine
Convergence Engine
Differentiation Intelligence Engine
Divergence / Solution Family Generator
MVP App Direction Generator
Feature Card System
Feature Mechanism Generator
Data Point Optimization Model
Evaluation Lab
Validation Lab
Spec Exporter
Quality Critic
```

---

## 4. Operation Card Definition

An Operation Card represents one engine run or reasoning transformation.

It should show:

```text
operation name
purpose
input artifacts
reasoning method
output artifacts
quality gate status
constraints used
constraints created
confidence
downstream effects
available actions
```

---

## 5. Operation Card Object Schema

```json
{
  "operation_card_id": "",
  "engine_run_id": "",
  "operation_name": "",
  "operation_type": "",
  "purpose": "",
  "input_artifact_ids": [],
  "input_summary": "",
  "reasoning_method": "",
  "output_artifact_ids": [],
  "output_summary": "",
  "constraints_used": [],
  "constraints_created": [],
  "quality_gate_status": "",
  "confidence": 0,
  "issues": [],
  "downstream_effects": [],
  "affected_nodes": [],
  "status": "not_started | running | passed | failed | repaired | stale",
  "actions": [],
  "created_at": "",
  "updated_at": ""
}
```

---

## 6. Operation Types

Supported operation types:

```text
interpretation
depth_selection
modeling
causal_modeling
layering
cross_analysis
convergence
differentiation
divergence
mvp_generation
feature_generation
mechanism_generation
data_optimization
evaluation
validation
repair
export
```

---

## 7. Operation Card Depth Levels

### 7.1 Collapsed Operation Card

Shown on board or operation lane.

```text
Operation:
Problem Causal Modeling

Status:
Passed

Output:
Root constraint candidates + leverage points

Action:
Inspect
```

### 7.2 Expanded Operation Card

Shows:

```text
input summary
reasoning method
output summary
quality gate
confidence
downstream effects
```

### 7.3 Deep Inspect

Shown in side panel.

Shows:

```text
full input artifacts
full output artifacts
prompt version
quality gate result
repair history
constraints used
graph changes
affected downstream nodes
activity trace
```

---

## 8. Operation Lane

The whiteboard should include an optional **Operation Lane**.

The lane shows the processing sequence:

```text
Prompt Power-Up
→ Depth Selection
→ Target User
→ Causal Model
→ Desired Result
→ Cross-Analysis
→ Convergence
→ Differentiation
→ Solution Families
→ MVP Directions
→ Feature Cards
```

Each operation has a status:

```text
not started
running
passed
needs repair
stale
repaired
```

This makes the system workflow visible without cluttering the main board.

---

## 9. Operation Card vs Reasoning Card

### Reasoning Card

Represents the artifact.

Example:

```text
Problem Causal Model Card
```

### Operation Card

Represents the engine run that produced the artifact.

Example:

```text
Multifactor Problem Causal Modeling Operation
```

Both should link to each other.

```text
Operation Card → produced → Reasoning Card
Reasoning Card → produced_by → Operation Card
```

---

## 10. Required Operation Card Fields

Every operation card must include:

```text
operation name
purpose
input summary
output summary
quality status
confidence
downstream effect
primary action
```

Optional fields:

```text
prompt version
repair history
constraints used
graph changes
token usage
research needed
validation needed
```

---

## 11. Input Summary

The input summary should explain what the operation used.

Example:

```text
Inputs:
Clean Summary, Target User Model, Initial Problem Guess, Desired Result Guess, Known Constraints.
```

Do not show full JSON by default.

---

## 12. Reasoning Method

The operation card should describe the method used.

Example:

```text
Method:
Generated causal variables, stakeholder variants, feedback loops, contradictions, root constraint candidates, counterfactuals, and leverage points.
```

This makes the process understandable.

---

## 13. Output Summary

The card should summarize what was produced.

Example:

```text
Output:
Problem Causal Model with 18 variables, 4 loops, 5 root constraint candidates, and 6 leverage points.
```

---

## 14. Quality Gate Status

Every operation card should show:

```text
passed
failed
repair needed
repaired
low confidence
research needed
validation needed
stale
```

Quality status should come from the Causal Quality Critic.

---

## 15. Downstream Effects

The operation card should show which modules depend on the output.

Example:

```text
Downstream:
Cross-Analysis, Convergence, Differentiation, Solution Families, MVP App Directions.
```

If the operation changes, these downstream modules may become stale.

---

## 16. Operation Actions

Common actions:

```text
inspect operation
rerun
repair
go deeper
simplify
compare versions
show inputs
show outputs
show graph changes
show downstream effects
mark accepted
mark stale
```

Node-specific actions can be added based on operation type.

---

## 17. Operation-Specific Actions

### Prompt Power-Up

```text
edit interpretation
separate explicit vs inferred
add ambiguity
mark assumption critical
```

### Depth Selection

```text
change depth level
run deeper
run quick mode
enable research mode
```

### Causal Modeling

```text
add variables
generate loops
run root tournament
repair shallow model
```

### Convergence

```text
challenge root constraint
show rejected interpretations
rerun tournament
```

### Differentiation

```text
add alternative
run research
generate deeper gap
```

### MVP Direction

```text
generate another candidate
re-score
select winner
```

### Feature Card

```text
generate mechanism
show data flow
convert to task
```

### Evaluation

```text
change weights
run stricter evaluation
show why this won
```

---

## 18. Prompt for Operation Card Generator

```text
You are the Operation Card Generator for SpecForge.

Given an engine run, create a concise operation card that explains:
- what operation ran
- why it ran
- what inputs it used
- what reasoning method it applied
- what outputs it created
- what quality gate status it received
- what constraints it used or created
- what downstream modules are affected
- what actions the user can take

Return:
{
  "operation_name": "",
  "operation_type": "",
  "purpose": "",
  "input_summary": "",
  "reasoning_method": "",
  "output_summary": "",
  "constraints_used": [],
  "constraints_created": [],
  "quality_gate_status": "",
  "confidence": 0,
  "downstream_effects": [],
  "actions": []
}

Rules:
- Keep board summary concise.
- Do not expose full prompt text by default.
- Make downstream effects clear.
- Mark stale or low-confidence operations visibly.
```

---

## 19. Quality Gates

Operation Card output fails if:

```text
- operation purpose is unclear
- input summary is missing
- output summary is missing
- quality status is missing
- downstream effect is missing
- it exposes too much internal detail on the board
- actions are generic and not useful
- it is not linked to produced artifacts
```

---

## 20. Repair Prompt

```text
You are the Operation Card Quality Critic.

Review the operation card.

Reject or repair it if:
- it does not explain what operation ran
- input and output are unclear
- quality status is missing
- downstream effect is missing
- actions are not relevant
- it overwhelms the board with internal details
- it is not linked to graph nodes or artifacts

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_operation_card": {},
  "confidence_after_repair": ""
}
```

---

## 21. Whiteboard Visualization

### Operation Lane Card

```text
Causal Modeling
Passed
18 variables · 4 loops · 5 root candidates
```

### Expanded

```text
Input:
Target user + prompt summary + result guess

Method:
Multifactor causal modeling

Output:
Problem model + root candidates

Downstream:
Convergence, MVP Directions
```

### Status Badges

```text
Passed
Needs repair
Stale
Research needed
Validation needed
```

---

## 22. Side Panel View

When an operation card is selected, side panel shows:

```text
operation purpose
inputs
outputs
method
quality gate
constraints
graph changes
downstream effects
actions
activity trace
```

---

## 23. Graph Updates

The Operation Card System creates graph nodes:

```text
Operation
Engine Run
Input Artifact
Output Artifact
Quality Gate Status
Downstream Effect
Operation Action
```

It creates edges:

```text
uses_input
produces_output
checked_by
affects
depends_on
can_rerun
can_repair
marks_stale
```

---

## 24. Interweaving with Other Modules

### With Knowledge Graph

Operation Cards are backed by EngineRun and ReasoningArtifact objects.

### With Side Panel

Clicking an operation card opens operation-specific inspection.

### With Quality Critic

Quality status comes from quality gate results.

### With Iteration Timeline

Each operation run can create iteration events.

### With Whiteboard Unfurl

Operation Lane provides workflow transparency while main board shows reasoning artifacts.

---

## 25. Minimum Implementation Requirements

For first implementation, Operation Cards must show:

```text
1. operation name
2. status
3. input summary
4. output summary
5. confidence
6. quality gate
7. downstream effects
8. actions: inspect / rerun / repair
```

---

## 26. Acceptance Criteria

The Operation Card System is complete when:

```text
- every major engine run creates an operation card
- operation cards link to produced reasoning cards
- status and quality are visible
- user can inspect inputs and outputs
- user can rerun or repair operations
- downstream affected nodes are shown
- operation history can be tracked over iterations
```

---

## 27. Final Instruction

The Operation Card System exists to make SpecForge’s process inspectable.

It should force the interface to show:

```text
what ran
why it ran
what it used
what it produced
whether it passed
what it affects next
what the user can do about it
```

Users should not have to trust a black-box sequence of generated cards.
