# SpecForge — Final Implementation Sequence / Reading Guide

## 1. Purpose

This document is the master guide for reading, sequencing, and implementing the SpecForge module documents.

It answers:

> In what order should a developer read the SpecForge architecture docs, what should be implemented first, how do the modules interweave, what belongs in MVP v1, what should be delayed, and what agent skills are required to build the system correctly?

SpecForge now has many specialized optimization documents. This guide prevents fragmentation.

---

## 2. Core Thesis

SpecForge should be implemented as a **graph-backed, quality-gated, causal reasoning workspace**, not as a collection of disconnected AI-generated cards.

The core product loop is:

```text
Raw idea
→ interpreted structured state
→ target user model
→ multifactor causal problem model
→ desired result stack
→ cross-analysis
→ convergence
→ differentiation
→ solution families
→ MVP app directions
→ selected MVP app
→ feature cards
→ mechanisms
→ data points
→ evaluation
→ validation
→ build spec
```

The whiteboard is the user-facing surface.

The knowledge graph/state model is the internal memory.

The side panel is the control surface.

The quality critic prevents shallow output.

The evaluation lab narrows options.

The constraint system defines what the “right” solution must satisfy.

---

## 3. Current Document Set

### Core System / Coordination Docs

```text
specforge_recursive_layer_optimization_engine.md
specforge_evaluation_lab_narrowing_engine.md
specforge_constraint_accumulation_system.md
specforge_knowledge_graph_state_model.md
specforge_causal_quality_critic_repair_engine.md
specforge_complexity_allocation_engine.md
specforge_operation_card_system.md
```

### Core Reasoning Docs

```text
specforge_prompt_power_up_analyzer.md
specforge_depth_selection_controller.md
specforge_target_user_layering_modeler.md
specforge_multifactor_causal_modeling_engine.md
specforge_desired_result_layering_modeler.md
specforge_cross_analysis_engine.md
specforge_convergence_engine.md
```

### Differentiation / Solution / MVP Docs

```text
specforge_differentiation_intelligence_engine.md
specforge_divergence_solution_family_generator.md
specforge_mvp_app_direction_generator.md
```

### Feature / Data / Build Docs

```text
specforge_feature_card_system.md
specforge_feature_mechanism_generator.md
specforge_data_point_optimization_model.md
specforge_spec_exporter_build_instruction_generator.md
```

### Interaction / Interface Docs

```text
specforge_whiteboard_unfurl_system_v2.md
specforge_side_panel_interaction_system.md
```

### Learning / Iteration Docs

```text
specforge_question_expansion_engine.md
specforge_experimentation_validation_lab.md
specforge_iteration_timeline_situation_model_deepening.md
```

---

## 4. Reading Order for a Developer

A developer should not read the docs alphabetically.

Use this order.

### Phase 1 — Understand the Overall System

Read:

```text
1. specforge_recursive_layer_optimization_engine.md
2. specforge_knowledge_graph_state_model.md
3. specforge_whiteboard_unfurl_system_v2.md
4. specforge_side_panel_interaction_system.md
```

Goal:

```text
Understand the operating model, data backbone, visible interface, and interaction model.
```

---

### Phase 2 — Understand the Core Reasoning Pipeline

Read:

```text
5. specforge_prompt_power_up_analyzer.md
6. specforge_depth_selection_controller.md
7. specforge_target_user_layering_modeler.md
8. specforge_multifactor_causal_modeling_engine.md
9. specforge_desired_result_layering_modeler.md
10. specforge_cross_analysis_engine.md
11. specforge_convergence_engine.md
```

Goal:

```text
Understand how the system gets from raw idea to root constraint and first-principles need.
```

---

### Phase 3 — Understand Differentiation and MVP Selection

Read:

```text
12. specforge_differentiation_intelligence_engine.md
13. specforge_divergence_solution_family_generator.md
14. specforge_mvp_app_direction_generator.md
15. specforge_evaluation_lab_narrowing_engine.md
16. specforge_constraint_accumulation_system.md
17. specforge_complexity_allocation_engine.md
```

Goal:

```text
Understand how the system compares alternatives, branches into solution families, selects a full MVP app direction, and controls scope.
```

---

### Phase 4 — Understand Feature, Mechanism, Data, and Build Output

Read:

```text
18. specforge_feature_card_system.md
19. specforge_feature_mechanism_generator.md
20. specforge_data_point_optimization_model.md
21. specforge_spec_exporter_build_instruction_generator.md
```

Goal:

```text
Understand how the selected MVP app becomes traceable feature modules and build instructions.
```

---

### Phase 5 — Understand Quality, Iteration, and Learning

Read:

```text
22. specforge_causal_quality_critic_repair_engine.md
23. specforge_question_expansion_engine.md
24. specforge_experimentation_validation_lab.md
25. specforge_iteration_timeline_situation_model_deepening.md
26. specforge_operation_card_system.md
```

Goal:

```text
Understand how the system repairs weak outputs, asks better questions, validates assumptions, tracks improvement, and exposes engine operations.
```

---

## 5. Implementation Priority

Do not implement everything at once.

The correct build order is:

```text
Build 1:
Graph-backed state model

Build 2:
Whiteboard card system + side panel

Build 3:
Prompt Power-Up + Depth Selection

Build 4:
Target User + Multifactor Problem Causal Model + Desired Result

Build 5:
Cross-Analysis + Convergence

Build 6:
Differentiation + Solution Families + MVP App Direction

Build 7:
Evaluation Lab + Constraint Accumulation + Quality Critic

Build 8:
Feature Cards + Feature Mechanisms + Data Point Optimization

Build 9:
Spec Exporter

Build 10:
Validation Lab + Iteration Timeline
```

This order matters because downstream modules depend on upstream reasoning quality.

---

## 6. MVP v1 Scope

The first usable SpecForge MVP should be:

```text
Causal Product Modeling Workspace
```

It should include:

```text
Raw prompt input
Prompt Power-Up card
Depth badge
Target User Model card
Problem Causal Model card
Desired Result Stack card
Cross-Analysis card
Convergence card
Differentiation card
Solution Families card
MVP App Direction cards
Selected MVP App card
Constraint strip
Quality badges
Side panel
Graph-backed state
Activity trace
Basic evaluation
Basic repair
```

Do not include full advanced systems yet.

---

## 7. Delay from MVP v1

Delay:

```text
Full graph editor
Real-time collaboration
Automated external research
Advanced spec export
Coding-agent prompt export
Iteration timeline UI
Full validation lab
Multi-agent orchestration UI
Advanced analytics
Team workspaces
```

These are valuable later, but they should not consume first-build complexity.

---

## 8. Core Data Model to Implement First

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
QualityGateResult
EvaluationScore
```

These are required before the board can become coherent.

---

## 9. Required First Card Types

Implement these first:

```text
RawIdeaCard
PromptPowerUpCard
DepthBadgeCard
TargetUserModelCard
ProblemCausalModelCard
DesiredResultStackCard
CrossAnalysisCard
ConvergenceCard
DifferentiationCard
SolutionFamilyCard
MVPAppDirectionCard
SelectedMVPAppCard
ConstraintStripCard
QualityBadge
```

Feature cards can come immediately after MVP app direction selection works.

---

## 10. Required First Side Panel Features

The first side panel should support:

```text
selected node header
why it matters
current content
related nodes
constraints in/out
quality status
node-specific actions
brainstorm tray
activity trace
context-aware chat input
```

Do not build every mode first.

Start with:

```text
Inspect Mode
Brainstorm Mode
Evaluate Mode
Trace preview
```

---

## 11. Required First Engine Sequence

The first fully implemented run should execute:

```text
1. Prompt Power-Up Analyzer
2. Depth Selection Controller
3. Target User Layering Modeler
4. Multifactor Problem Causal Modeling Engine
5. Desired Result Layering Modeler
6. Cross-Analysis Engine
7. Convergence Engine
8. Differentiation Intelligence Engine
9. Divergence / Solution Family Generator
10. MVP App Direction Generator
11. Evaluation Lab / Narrowing Engine
12. Causal Quality Critic
```

Then render whiteboard cards.

---

## 12. Required First Quality Gates

Implement quality gates for:

```text
Prompt Power-Up
Target User Model
Problem Causal Model
Desired Result Stack
Cross-Analysis
Convergence
Differentiation
MVP App Direction
Evaluation
```

Quality gates should return:

```text
pass / fail / repair_needed
issues
severity
repair strategy
confidence
stale downstream nodes
```

---

## 13. Required First Constraints

The system should accumulate constraints from:

```text
Prompt Power-Up
Target User
Problem Causal Model
Desired Result
Convergence
Differentiation
MVP Direction
Evaluation
```

Each constraint should have:

```text
statement
source
priority
applies to
satisfied by
violated by
passed downstream
```

Show active constraints in a compact board strip.

---

## 14. Required First Whiteboard Layout

Use this layout:

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
```

Keep text concise.

Depth goes in side panel.

---

## 15. Required First Problem Causal Model Depth

The Problem Causal Model must not be a simple cause chain.

Minimum output:

```text
surface phenomenon
stakeholder variants
causal variables
causal links
feedback loops
contradictions
incentives
representation layer
counterfactuals
root constraint candidates
root constraint tournament
first-principles need
leverage points
solution constraints
```

If this is missing, the model should fail quality gate.

---

## 16. How Modules Interweave

### Prompt Power-Up → Depth Selection

Prompt Power-Up identifies ambiguity and assumptions.

Depth Selection decides which modules to run.

### Target User → Problem Causal Model

Target user determines which causes matter.

### Problem Causal Model → Desired Result

Problem causes show what blocks the desired result.

### Target User + Problem + Result → Cross-Analysis

Cross-analysis checks fit, contradictions, weak links, and leverage.

### Cross-Analysis → Convergence

Convergence selects root constraint and first-principles need.

### Convergence → Differentiation

Differentiation compares alternatives against the selected deeper problem.

### Differentiation → Solution Families

Solution families exploit alternative gaps and root leverage points.

### Solution Families → MVP App Directions

MVP directions become complete first product experiences.

### MVP App Direction → Feature Cards

Feature Cards only generate after an MVP app is selected.

### Feature Cards → Mechanisms → Data Points → Spec

Features become mechanisms, mechanisms define data, data and mechanisms become build specs.

### Quality Critic + Evaluation Lab

Run across all major transitions.

---

## 17. Required Agent Skills

SpecForge agents should have these skills.

### 17.1 Interpretation Skill

Can separate explicit and inferred information.

### 17.2 Causal Modeling Skill

Can model variables, links, loops, contradictions, incentives, and leverage points.

### 17.3 Recursive Layer Optimization Skill

Can optimize macro, micro, and mechanism layers.

### 17.4 Evaluation Skill

Can define criteria, weights, tradeoffs, rejection rules, and why one option wins.

### 17.5 Differentiation Skill

Can compare alternatives by deeper unsolved problem, not only features.

### 17.6 Mechanism Design Skill

Can convert feature ideas into input → process → output mechanisms.

### 17.7 Constraint Reasoning Skill

Can accumulate, pass down, detect violations, and repair constraints.

### 17.8 Interaction Design Skill

Can decide what belongs on the whiteboard vs side panel.

### 17.9 Validation Skill

Can convert assumptions into experiments and update the model from results.

### 17.10 Build Translation Skill

Can turn selected MVP and feature mechanisms into implementation tasks.

---

## 18. Developer Implementation Principles

### Principle 1: Structured outputs first

Every engine should return JSON-like structured artifacts, not only prose.

### Principle 2: Graph-backed cards

Every visible card should map to graph nodes and artifacts.

### Principle 3: Quality gates before downstream use

No major artifact should feed downstream modules without a quality status.

### Principle 4: Side panel for depth

Do not overload the whiteboard with full reasoning.

### Principle 5: Constraints accumulate

Each layer should pass constraints downstream.

### Principle 6: Evaluation narrows

The system should choose, reject, and explain.

### Principle 7: MVP app before features

Never generate feature cards before selecting the MVP app direction.

### Principle 8: Research only when needed

Trigger research when current alternatives, market facts, or competitor claims matter.

### Principle 9: Complexity is allocated, not spread evenly

Deepen core reasoning modules first.

### Principle 10: Preserve traceability

Every recommendation should trace back to target user, root constraint, desired result, and differentiation thesis.

---

## 19. Build Milestones

### Milestone 1 — Static Graph-Backed Board

```text
Render graph-backed cards from mocked engine outputs.
Card click opens side panel.
Show constraint strip and quality badges.
```

### Milestone 2 — Prompt Pipeline v1

```text
Implement Prompt Power-Up, Depth Selection, Target User, Desired Result.
```

### Milestone 3 — Causal Model v1

```text
Implement Multifactor Problem Causal Model with variables, loops, contradictions, and root tournament.
```

### Milestone 4 — Convergence + Differentiation

```text
Implement Cross-Analysis, Convergence, Differentiation.
```

### Milestone 5 — MVP Direction Selection

```text
Implement Solution Families, MVP App Direction Generator, Evaluation Lab.
```

### Milestone 6 — Feature Card System

```text
Generate features only after selected MVP app.
Add mechanisms and data points.
```

### Milestone 7 — Export + Validation

```text
Implement spec export and validation planning.
```

---

## 20. Acceptance Criteria for v1

SpecForge v1 is successful when:

```text
- user can enter a messy product idea
- system generates graph-backed reasoning cards
- system models target user, problem, and desired result
- problem model includes multifactor causal depth
- convergence selects a root constraint and first-principles need
- differentiation compares alternatives by deeper gap
- MVP app directions are generated and ranked
- one selected MVP app is recommended
- feature generation is separated from MVP app selection
- side panel allows inspection and refinement
- quality badges show weak/strong artifacts
- constraints are visible
- recommendation is traceable
```

---

## 21. What Not to Build First

Do not prioritize:

```text
pixel-perfect graph editor
complex animations
collaboration
full marketplace
full spec exporter
advanced timeline UI
external research automation
multi-agent debate theater
```

Build the reasoning core first.

---

## 22. Final Instruction

This guide exists to keep SpecForge implementation focused.

Build in this order:

```text
state model
whiteboard
side panel
prompt pipeline
causal model
convergence
differentiation
MVP app selection
evaluation / quality gates
feature cards
mechanisms
data
spec
validation
iteration
```

Do not switch into visual polish before the reasoning core works.

The ultimate goal is:

```text
A graph-backed causal product reasoning workspace that turns vague ideas into confident, differentiated, buildable MVP app directions.
```
