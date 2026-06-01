# SpecForge — Knowledge Graph / State Model

## 1. Purpose

The **Knowledge Graph / State Model** is the structured memory layer of SpecForge.

It defines how every reasoning artifact, user edit, whiteboard card, side-panel interaction, constraint, evaluation, and downstream recommendation is stored, connected, versioned, and updated.

The module answers:

> How does SpecForge preserve relationships between user, problem, causes, desired results, alternatives, constraints, solution families, MVP directions, feature cards, mechanisms, data points, evaluations, and specs so the system can reason, visualize, update, and recalculate coherently?

Without this module, SpecForge becomes a collection of disconnected generated cards.

With this module, SpecForge becomes a living causal product graph.

---

## 2. Core Thesis

SpecForge should not treat outputs as isolated text blocks.

Every output should become:

```text
Reasoning artifact
↓
Graph node(s)
↓
Graph edge(s)
↓
Whiteboard card(s)
↓
Side panel state
↓
Activity trace
↓
Downstream dependency
```

A card is the visual representation.

The graph is the reasoning structure.

The state model is the operating system that keeps everything synchronized.

---

## 3. Position in SpecForge System

The Knowledge Graph / State Model runs underneath every module.

It supports:

```text
Prompt Power-Up
Target User Layering
Multifactor Problem Causal Modeling
Desired Result Layering
Cross-Analysis
Convergence
Differentiation Intelligence
Solution Families
MVP App Direction
Feature Cards
Evaluation Lab
Constraint Accumulation
Side Panel Interaction
Whiteboard Unfurl
Spec Export
Iteration Timeline
```

It is not one step in the pipeline. It is the persistent substrate.

---

## 4. Core Objects

SpecForge should use these foundational objects:

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
UserEdit
QualityGateResult
Constraint
EvaluationScore
VersionSnapshot
```

---

## 5. Project Object

Represents one product-thinking workspace.

```json
{
  "project_id": "",
  "title": "",
  "created_at": "",
  "updated_at": "",
  "current_focus_node_id": "",
  "selected_mvp_app_direction_id": "",
  "graph_id": "",
  "latest_recommendation_id": "",
  "status": "draft | modeling | evaluating | selected | exported"
}
```

---

## 6. RawPrompt Object

Stores the original user input.

```json
{
  "raw_prompt_id": "",
  "project_id": "",
  "content": "",
  "source": "user_input | imported_doc | edited_prompt",
  "created_at": "",
  "version": 1
}
```

Rule:

The raw prompt should never be overwritten. New edits create new versions.

---

## 7. EngineRun Object

Stores a single module execution.

```json
{
  "engine_run_id": "",
  "project_id": "",
  "engine_name": "",
  "input_artifact_ids": [],
  "output_artifact_ids": [],
  "prompt_version": "",
  "quality_gate_result_id": "",
  "started_at": "",
  "completed_at": "",
  "status": "running | passed | failed | repaired",
  "confidence": 0,
  "requires_research": false
}
```

Use this to preserve provenance.

---

## 8. ReasoningArtifact Object

Stores the structured output of an engine.

```json
{
  "artifact_id": "",
  "project_id": "",
  "artifact_type": "",
  "origin_engine_run_id": "",
  "content": {},
  "summary": "",
  "confidence": 0,
  "uncertainties": [],
  "assumptions": [],
  "constraints_created": [],
  "constraints_used": [],
  "created_at": "",
  "version": 1
}
```

Artifact examples:

```text
Target User Model
Problem Causal Model
Desired Result Stack
Root Constraint
Differentiation Thesis
MVP App Direction
Feature Card
Evaluation Result
```

---

## 9. GraphNode Object

Every important reasoning object becomes a graph node.

```json
{
  "node_id": "",
  "project_id": "",
  "node_type": "",
  "title": "",
  "summary": "",
  "content_ref": "",
  "artifact_id": "",
  "origin_engine": "",
  "layer_type": "macro | micro | mechanism | data | evaluation | cross_layer",
  "visibility": "default | collapsed | hidden | deep_inspect",
  "priority": "critical | high | medium | low",
  "confidence": 0,
  "quality_status": "passed | needs_repair | uncertain",
  "created_at": "",
  "updated_at": "",
  "version": 1
}
```

---

## 10. GraphEdge Object

Edges represent relationships between nodes.

```json
{
  "edge_id": "",
  "project_id": "",
  "source_node_id": "",
  "target_node_id": "",
  "edge_type": "",
  "label": "",
  "strength": 0,
  "confidence": 0,
  "evidence_ref": "",
  "created_by_engine": "",
  "created_at": "",
  "version": 1
}
```

---

## 11. Required Node Types

SpecForge should support these node types:

```text
Raw Idea
Clean Summary
Root Intent
Target User
User Segment
Subsegment
Context
Behavior Pattern
Motivation
Constraint
Decision Trigger
Current Workaround
Emotional State
Core Need

Surface Problem
Causal Variable
Causal Link
Feedback Loop
Contradiction
Incentive
Representation
Worldview
Counterfactual
Root Constraint Candidate
Root Constraint
First-Principles Need
Leverage Point

Desired Result
Functional Result
Decision Result
Emotional Result
Behavior Change
Measurable Success
Strategic Outcome
First-Principles Result

Alternative
Direct Alternative
Indirect Workaround
Analogical Example
Alternative Gap
Differentiation Thesis
Positioning Option

Solution Family
MVP App Direction
Selected MVP App
Feature Card
Feature Mechanism
Data Point
Evaluation Criterion
Evaluation Score
Risk
Assumption
Evidence Need
Research Need
Recommendation
Spec Output
```

---

## 12. Required Edge Types

SpecForge should support these edge types:

```text
interpreted_as
experiences
motivated_by
constrained_by
triggered_by
uses_workaround
needs
implies
causes
blocks
reinforces
balances
contradicts
explains
creates_need_for
attacks_cause
enables_result
measured_by
requires
depends_on
compared_against
solves
fails_to_solve
leaves_gap
differentiates_from
outperforms_on
misleads_if_used_as
exploits_gap
implements_thesis
selected_as
rejected_because
passes_constraint_to
violates_constraint
satisfies_constraint
evaluated_by
prepares_for
updates
```

---

## 13. Visibility Levels

Not every graph node should appear on the default whiteboard.

### Default

Critical decision nodes.

```text
Target User Model
Problem Causal Model
Desired Result Stack
Root Constraint
First-Principles Need
Differentiation Thesis
MVP App Directions
Selected MVP App
Recommendation
```

### Collapsed

Useful supporting nodes.

```text
Assumptions
Risks
Questions
Scores
Evidence Needs
Rejected Options
Prompt Checkpoints
```

### Hidden

System internals.

```text
full JSON
low-priority questions
debug values
token usage
repair prompt internals
```

### Deep Inspect

Available only when selected.

```text
full causal variables
all graph edges
all evaluation criteria
all mechanism candidates
full trace history
```

---

## 14. WhiteboardCard Object

A whiteboard card is a visual view of a graph node or artifact.

```json
{
  "card_id": "",
  "project_id": "",
  "node_id": "",
  "card_type": "",
  "title": "",
  "summary": "",
  "visible_fields": [],
  "position": {
    "x": 0,
    "y": 0
  },
  "size": "small | medium | large",
  "view_state": "collapsed | expanded | selected",
  "actions": [],
  "badges": [],
  "created_at": "",
  "updated_at": ""
}
```

Rule:

Do not let cards store independent reasoning state. Cards should reference graph nodes/artifacts.

---

## 15. SidePanelState Object

Tracks the selected node and available actions.

```json
{
  "selected_node_id": "",
  "selected_node_type": "",
  "selected_artifact_id": "",
  "current_mode": "inspect | brainstorm | compare | evaluate | trace | data_flow",
  "available_actions": [],
  "brainstorm_tray": [],
  "related_nodes": [],
  "constraints_in": [],
  "constraints_out": [],
  "evaluation_status": {},
  "activity_trace": []
}
```

---

## 16. ActivityTraceEvent Object

Records user and agent actions.

```json
{
  "trace_event_id": "",
  "project_id": "",
  "actor": "user | agent | system",
  "action_type": "",
  "selected_node_id": "",
  "description": "",
  "previous_value": {},
  "new_value": {},
  "affected_node_ids": [],
  "graph_changes": {
    "nodes_created": [],
    "nodes_updated": [],
    "edges_created": [],
    "edges_updated": []
  },
  "confidence_change": "",
  "created_at": ""
}
```

---

## 17. UserEdit Object

Stores user edits separately from generated artifacts.

```json
{
  "user_edit_id": "",
  "project_id": "",
  "target_node_id": "",
  "edit_type": "rewrite | accept | reject | merge | split | delete | annotate",
  "previous_content": {},
  "new_content": {},
  "reason": "",
  "created_at": ""
}
```

Rule:

User edits should trigger downstream impact detection.

---

## 18. QualityGateResult Object

Stores quality checks.

```json
{
  "quality_gate_result_id": "",
  "project_id": "",
  "target_artifact_id": "",
  "target_node_id": "",
  "gate_name": "",
  "pass_or_fail": "",
  "issues": [],
  "repair_required": false,
  "repair_engine_run_id": "",
  "confidence_after_repair": "",
  "created_at": ""
}
```

---

## 19. Constraint Object

Constraints should be first-class graph objects.

```json
{
  "constraint_id": "",
  "project_id": "",
  "constraint_type": "macro | user | problem | desired_result | differentiation | buildability | mechanism | data | evaluation",
  "statement": "",
  "source_node_id": "",
  "priority": "hard | strong | soft",
  "applies_to_node_types": [],
  "satisfied_by": [],
  "violated_by": [],
  "passed_down_to": [],
  "created_at": "",
  "version": 1
}
```

---

## 20. EvaluationScore Object

Stores scoring decisions.

```json
{
  "evaluation_score_id": "",
  "project_id": "",
  "target_node_id": "",
  "criteria": [],
  "scores": {},
  "weights": {},
  "total_score": 0,
  "why_this_score": "",
  "why_this_won": "",
  "why_others_lost": [],
  "confidence": 0,
  "created_at": ""
}
```

---

## 21. VersionSnapshot Object

Stores historical states.

```json
{
  "snapshot_id": "",
  "project_id": "",
  "snapshot_type": "node | artifact | graph | recommendation",
  "target_id": "",
  "content": {},
  "reason_for_snapshot": "",
  "created_at": ""
}
```

---

## 22. Graph Update Rules

### Rule 1: Every engine output creates artifacts.

No engine should return only text.

### Rule 2: Every important artifact creates graph nodes.

If it affects decisions, it becomes a node.

### Rule 3: Every dependency creates an edge.

If one thing affects another, create an edge.

### Rule 4: Every user edit creates a trace event.

No silent edits.

### Rule 5: Every accepted brainstorm item becomes a node.

Rejected brainstorm items stay in history but do not clutter the graph.

### Rule 6: Every downstream change must be detectable.

If a node changes, the system should identify affected nodes.

---

## 23. Downstream Dependency Rules

When a node changes, the system should find dependent nodes.

Example:

If `Target User` changes, affected nodes may include:

```text
Problem Causal Model
Desired Result Stack
Differentiation Intelligence
MVP App Directions
Feature Cards
Evaluation Scores
Recommendation
```

If `Root Constraint` changes, affected nodes may include:

```text
First-Principles Need
Leverage Points
Differentiation Thesis
Solution Families
MVP App Directions
Feature Cards
Evaluation Scores
Recommendation
```

If `Selected MVP App` changes, affected nodes may include:

```text
Feature Cards
Mechanisms
Data Points
Spec Output
Build Sequence
```

---

## 24. Recalculation Policy

After a node change, the system should offer:

```text
Recalculate affected cards
Preview impact first
Only update selected branch
Cancel change
```

Do not automatically overwrite major downstream outputs without user confirmation.

---

## 25. Duplicate Prevention

Before creating a node, check:

```text
same node type
similar title
similar semantic content
same parent context
same source artifact
```

If a duplicate is likely, either:

```text
merge
link as variant
create alternative
reject duplicate
```

---

## 26. Provenance

Every node must know:

```text
which engine created it
which input artifacts produced it
which prompt version was used
whether it was edited by user
whether it passed quality gate
```

This builds trust and enables debugging.

---

## 27. Confidence Metadata

Each node and edge should include:

```text
confidence score
uncertainty notes
evidence needed
research needed
assumptions
quality gate status
```

Low-confidence nodes should be visually marked.

---

## 28. Graph Clusters

The system should support clusters:

```text
Target User Cluster
Problem Causal Model Cluster
Desired Result Cluster
Convergence Cluster
Differentiation Cluster
Solution Family Cluster
MVP App Direction Cluster
Feature Mechanism Cluster
Data Flow Cluster
Evaluation Cluster
Spec Cluster
```

Clusters help the whiteboard stay readable.

---

## 29. Graph Summary Strip

The default whiteboard should include a compact graph summary:

```text
Graph Summary

Core chain:
Target User → Root Constraint → First-Principles Need → Differentiation Thesis → Selected MVP App → Feature Cards
```

Clicking opens Graph View.

---

## 30. Graph View

Graph View should show:

```text
clusters
nodes
edges
filters
selected path
confidence overlays
constraint overlays
evaluation overlays
```

Filters:

```text
layer
module
node type
edge type
priority
confidence
constraint status
current focus
```

---

## 31. Whiteboard Sync

When graph changes:

```text
1. update affected whiteboard cards
2. update side panel related nodes
3. update activity trace
4. update quality badges
5. mark downstream nodes stale if needed
```

A stale node means:

```text
This node depends on an upstream artifact that changed.
```

---

## 32. Stale Node Handling

If a downstream node becomes stale, show:

```text
Needs recalculation
Depends on changed node: [node]
```

Actions:

```text
Recalculate
Keep old version
Compare old vs new
Branch
```

---

## 33. Interweaving with Modules

### With Prompt Power-Up

Creates initial nodes:

```text
Raw Idea
Clean Summary
Root Intent
Ambiguity
Assumption
```

### With Target User Layering

Creates user cluster and constraints.

### With Multifactor Causal Modeling

Creates variables, links, loops, contradictions, root constraint candidates, leverage points.

### With Desired Result Layering

Creates result stack and result-to-cause edges.

### With Differentiation Intelligence

Creates alternatives, gaps, thesis, positioning nodes.

### With MVP App Direction

Creates MVP candidates, selected MVP, rejected MVP nodes.

### With Feature Card System

Creates feature nodes, mechanism nodes, data dependency nodes.

### With Evaluation Lab

Creates criteria, scores, rankings, rejected reasons.

### With Side Panel

Provides selected node data, related nodes, constraints, actions, and trace.

---

## 34. Minimum Implementation Requirements

For the first implementation, the state model must support:

```text
1. Project
2. RawPrompt
3. EngineRun
4. ReasoningArtifact
5. GraphNode
6. GraphEdge
7. WhiteboardCard
8. SidePanelState
9. ActivityTraceEvent
10. Constraint
11. QualityGateResult
```

Do not start with full Graph View. Start with graph-backed cards.

---

## 35. Acceptance Criteria

The Knowledge Graph / State Model is complete when:

```text
- every major output is stored as structured artifact
- every visible card maps to graph node/artifact
- node relationships are represented as edges
- user edits update graph state
- affected downstream nodes are detected
- side panel can show related nodes and constraints
- activity trace records major changes
- stale nodes are marked after upstream changes
- duplicate nodes are avoided or merged
```

---

## 36. Final Instruction

The Knowledge Graph / State Model exists to make SpecForge coherent over time.

It should force the system to preserve:

```text
what was generated
why it was generated
what it connects to
what it depends on
what changed
what became stale
what should be recalculated
```

SpecForge’s intelligence depends on the quality of this state model.
