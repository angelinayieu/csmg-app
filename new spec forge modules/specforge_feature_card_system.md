# SpecForge Autopilot — Feature Card System

## 1. Purpose

This document defines the **Feature Card System** for SpecForge Autopilot.

The Feature Card is not a normal product feature description. It is a **traceable optimization object** that connects a selected MVP app direction to the macro objective, micro objective, mechanism, data flow, evaluation criteria, and build requirements.

A Feature Card should answer:

```text
Why should this feature exist?
Which macro objective does it serve?
Which micro objective does it optimize?
What mechanism makes it work?
What upstream inputs does it require?
What downstream outputs does it improve?
Why is this the recommended mechanism over alternatives?
How will we know if it works?
```

The purpose of the Feature Card System is to prevent SpecForge from generating shallow feature names. Every feature must be causally grounded, mechanism-defined, evaluated, and buildable.

---

## 2. Core Principle

A feature is valid only if it can trace back to:

```text
Macro Objective
→ Micro Objective
→ Root Constraint / First-Principles Need
→ Selected MVP App Direction
→ Mechanism
→ Data Flow
→ User Behavior Change
→ Evaluation Metric
→ Build Requirement
```

If a feature cannot trace through this chain, it should be rejected, delayed, or converted into an exploratory idea.

---

## 3. Where Feature Cards Fit in the Pipeline

Feature Cards should be generated **after** the system selects an MVP app direction.

Correct sequence:

```text
Raw Prompt
↓
Prompt Power-Up Analyzer
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
Differentiation Intelligence
↓
Recursive Layer Optimization
↓
Solution Families
↓
MVP App Direction Generator
↓
Evaluation Lab / Narrowing Engine
↓
Selected MVP App
↓
Feature Card System
↓
Feature Mechanism Generator
↓
Data Point Optimization
↓
Spec Exporter
```

Feature Cards should not be generated directly from the raw idea.

---

## 4. Feature Card Definition

A Feature Card is a structured object containing:

```text
Feature name
Concise function
Macro objective served
Micro objective served
Root cause attacked
Alternative gap addressed
Optimization objectives
Recommended mechanism
Mechanism system flow
Upstream inputs
Internal processing
Downstream outputs
Data dependencies
User behavior changed
Evaluation criteria used
Why this mechanism won
Rejected mechanism alternatives
Risks
Failure modes
Implementation difficulty
Validation method
Build priority
```

The card should be visible on the whiteboard as a compact, interactive object, with deeper layers available through expansion and side-panel inspection.

---

## 5. Feature Card Generation Logic

Feature Cards are generated through the following layered process:

```text
Selected MVP App Direction
↓
Extract required micro-objectives
↓
Generate candidate feature modules
↓
Map each feature to macro and micro objectives
↓
Generate mechanism candidates
↓
Evaluate mechanisms against objectives
↓
Select recommended mechanism
↓
Define upstream / internal / downstream flow
↓
Attach data requirements
↓
Attach risks, failure modes, and validation method
↓
Create polished Feature Card
```

The system should generate more candidate features internally than it surfaces. Only features that pass the quality gate should appear on the board.

---

## 6. Macro Layer Connection

Every Feature Card must declare the macro objective it serves.

### Macro fields

```json
{
  "macro_objective": "",
  "mission_alignment": "",
  "final_outcome_supported": "",
  "philosophy_connection": "",
  "strategic_constraint_respected": ""
}
```

### Example

```text
Feature:
Problem Cause Tree Spine

Macro Objective:
Help the user convert ambiguity into structured confidence.

Mission Alignment:
The feature helps the user understand the deeper problem before building.

Strategic Constraint:
Do not generate MVPs or features before the problem model is deep enough.
```

If the macro connection is weak, the feature should not be prioritized.

---

## 7. Micro Layer Connection

Every Feature Card must identify the micro-objective it optimizes.

### Micro fields

```json
{
  "micro_objective": "",
  "sub_problem_addressed": "",
  "optimization_factors": [],
  "micro_constraints": [],
  "decision_supported": "",
  "downstream_dependency": ""
}
```

### Example

```text
Micro Objective:
Decompose the surface problem into a causal model deep enough to identify a root constraint.

Sub-problem addressed:
The user cannot tell whether a proposed solution attacks a root cause or only a symptom.

Decision supported:
Whether the selected MVP app direction is causally justified.
```

---

## 8. Mechanism Layer Connection

Every Feature Card must include a recommended mechanism.

### Mechanism fields

```json
{
  "recommended_mechanism": "",
  "mechanism_type": "",
  "trigger": "",
  "user_action": "",
  "system_process": [],
  "ai_reasoning_steps": [],
  "data_required": [],
  "output_created": [],
  "downstream_effect": "",
  "mechanism_alternatives": [],
  "why_selected": "",
  "why_rejected": []
}
```

### Example

```text
Recommended Mechanism:
Depth-layered branching causal model with root-constraint tournament.

Trigger:
User asks the system to model the problem.

System Process:
1. Extract surface phenomenon.
2. Generate stakeholder variants.
3. Identify causal variables.
4. Map causal links.
5. Detect feedback loops.
6. Extract contradictions.
7. Generate root constraint candidates.
8. Score root constraints.
9. Distill first-principles need.
10. Generate leverage points.

Output:
Problem Causal Model card + Root Constraint card + Leverage Point card.
```

---

## 9. Upstream / Internal / Downstream Flow

Each Feature Card must include a traceable system flow.

### Flow format

```text
Upstream Inputs
→ Internal Processing
→ Downstream Outputs
```

### Required fields

```json
{
  "upstream_inputs": [],
  "internal_transformations": [],
  "downstream_outputs": [],
  "downstream_modules_improved": [],
  "feedback_to_previous_layers": []
}
```

### Example

```text
Upstream Inputs:
Raw idea, target user model, desired result stack, known assumptions.

Internal Processing:
Generate variables, causal loops, contradictions, root constraint candidates, leverage points.

Downstream Outputs:
Root constraint, first-principles need, solution constraints, solution family seeds.

Downstream Modules Improved:
Differentiation Intelligence, Solution Family Generator, MVP App Direction Generator, Evaluation Lab.
```

This makes feature value traceable.

---

## 10. Data Dependency Modeling

If a feature uses or produces data, the card must specify the data point and how it is handled.

### Data fields

```json
{
  "data_dependencies": [
    {
      "data_point": "",
      "concept_definition": "",
      "variables": [],
      "collection_method": "",
      "collection_friction": "",
      "reliability_risk": "",
      "privacy_risk": "",
      "downstream_use": "",
      "transformation_process": "",
      "selected_handling_method": ""
    }
  ]
}
```

### Example

```text
Data Point:
User-provided target audience.

Concept:
The group of people the product is meant to serve.

Variables:
segment, context, urgency, current workaround, willingness to pay, emotional state.

Collection Method:
User enters rough target user; system infers variants and asks clarification only for high-impact gaps.

Downstream Use:
Controls problem modeling, MVP ranking, differentiation, and feature prioritization.
```

---

## 11. Evaluation Criteria for Feature Cards

Each Feature Card must be evaluated before surfacing.

### Required scores

```text
Macro alignment
Micro objective alignment
Root cause alignment
Mechanism clarity
Downstream leverage
Data feasibility
User value
Speed to value
Differentiation contribution
Buildability
Risk
Evidence strength
Confidence
```

### Recommended scoring formula

```text
Feature Priority Score =
macro alignment
+ micro objective alignment
+ root cause alignment
+ mechanism clarity
+ downstream leverage
+ differentiation contribution
+ speed to value
- implementation complexity
- risk
- uncertainty
```

The score should not be shown as a single unexplained number. The UI should show why a feature won or lost.

---

## 12. Feature Card Quality Gate

A Feature Card fails if:

```text
It only names a feature.
It does not define a mechanism.
It does not connect to a macro objective.
It does not connect to a micro objective.
It does not attack a root cause or enable a desired result.
It does not explain upstream inputs and downstream outputs.
It cannot explain why its mechanism won.
It has no evaluation metric.
It has no failure mode.
It has no test method.
It creates more complexity than value.
It is downstream-dependent on a module that does not exist yet.
```

If a Feature Card fails, the system should either:

```text
repair the feature,
downgrade it,
merge it with another feature,
delay it,
or reject it.
```

---

## 13. Feature Card Repair Logic

### Repair prompt behavior

If a card is weak, the repair engine should ask:

```text
Which macro objective is missing?
Which micro objective is this supposed to serve?
Which root cause does this attack?
What is the actual mechanism?
What upstream data is required?
What downstream output is improved?
Why is this better than alternative mechanisms?
What failure mode remains?
Can this be built in the current MVP scope?
```

### Repair outcomes

```text
Pass after repair
Needs more causal modeling
Needs mechanism generation
Needs data modeling
Needs evaluation
Rejected
Delayed
Merged
```

---

## 14. Feature Card Whiteboard Design

### Collapsed card

The collapsed card should show only:

```text
Feature name
Concise function
Macro objective served
Micro objective served
Recommended mechanism
Priority badge
Risk badge
```

### Expanded card

The expanded card should show:

```text
Optimization objectives
Root cause attacked
System flow
Upstream inputs
Downstream outputs
Why this mechanism won
Top risk
Next action
```

### Deep inspect view

The deep inspect view should show:

```text
Full mechanism candidates
Rejected mechanisms
Data dependencies
Evaluation scores
Evidence gaps
Graph connections
Build requirements
Test method
Prompt checkpoint
Activity trace
```

This follows progressive disclosure: the board stays readable while deeper reasoning remains accessible on demand.

---

## 15. Side Panel Actions

When a user selects a Feature Card, the side panel should provide:

```text
Ask why this feature exists
Show causal trace
Show macro / micro alignment
Show mechanism flow
Generate alternative mechanisms
Compare mechanisms
Go deeper on data requirements
Find failure modes
Re-score
Simplify for MVP
Make more ambitious
Convert to build task
Send to spec
Reject / delay / merge
```

These actions make the feature operational, not decorative.

---

## 16. Feature Card Graph Connections

Every Feature Card must generate or update graph nodes.

### Required graph edges

```text
Feature → serves → Macro Objective
Feature → optimizes → Micro Objective
Feature → attacks_cause → Root Cause / Root Constraint
Feature → enables_result → Desired Result
Feature → uses → Mechanism
Feature → requires_data → Data Point
Feature → produces → Output Artifact
Feature → measured_by → Metric
Feature → risks → Risk
Feature → prepares_for → Spec Output
Feature → differentiates_from → Alternative
```

The graph should allow the user to see why a feature belongs in the product.

---

## 17. Feature Card Relationship to MVP App Direction

Feature Cards are generated **inside** the selected MVP app direction.

The system must distinguish:

```text
MVP App Direction:
The smallest complete product experience that can prove the value.

Feature Card:
A module inside that MVP app that helps the product achieve its objective.
```

### Example

```text
MVP App Direction:
Causal Product Modeling Workspace.

Feature Cards:
- Prompt Power-Up Analyzer
- Target User Layering Card
- Multifactor Problem Causal Model Card
- Desired Result Stack
- Convergence Card
- Differentiation Thesis Card
- MVP App Direction Generator
```

The MVP app is the product loop. Feature Cards are the modules that make the loop work.

---

## 18. Feature Card Example: Problem Causal Model Card

### Collapsed

```text
Feature:
Problem Causal Model

Function:
Models the user's problem as variables, loops, contradictions, root constraints, and leverage points.

Macro objective:
Convert ambiguity into structured confidence.

Micro objective:
Find the deepest solvable problem before solution generation.

Recommended mechanism:
Multifactor causal model + root constraint tournament.

Priority:
Critical

Risk:
May become too complex if not progressively disclosed.
```

### Expanded

```text
Root cause attacked:
Shallow problem understanding.

System flow:
Raw idea + target user + desired result
→ variables
→ causal links
→ feedback loops
→ contradictions
→ root constraint candidates
→ first-principles need
→ leverage points

Why this mechanism won:
It generates more non-obvious solution constraints than a linear cause tree.

Downstream outputs:
Solution constraints, differentiated solution families, MVP app direction criteria.

Failure mode:
The system may overgenerate variables and loops without narrowing.

Test method:
Compare generated MVPs from shallow cause tree vs multifactor causal model and assess which produces more differentiated and buildable directions.
```

---

## 19. Feature Card Example: Differentiation Intelligence Card

### Collapsed

```text
Feature:
Differentiation Intelligence

Function:
Compares the product against current alternatives and analogical models.

Macro objective:
Build products that are meaningfully better, not just different.

Micro objective:
Identify the deeper problem existing alternatives do not solve.

Recommended mechanism:
Alternative gap mapping + analogy transfer analysis.

Priority:
High

Risk:
Can become shallow if it only compares surface features.
```

### Expanded

```text
Root cause attacked:
Weak proof of superiority over existing options.

System flow:
Root constraint + first-principles need
→ direct alternatives
→ indirect workarounds
→ analogical products
→ existing gaps
→ deeper unsolved problem
→ differentiation thesis
→ MVP implications

Why this mechanism won:
It forces the product to justify why it should exist before generating final MVP directions.

Downstream outputs:
Differentiation thesis, positioning options, MVP constraints.

Failure mode:
May claim superiority without evidence.

Test method:
Ask whether the differentiation thesis clearly explains why the product beats ChatGPT / Notion / Figma / manual alternatives for the target user.
```

---

## 20. Feature Card Example: Soft Feedback Loop

For a low-pressure social app.

### Collapsed

```text
Feature:
Soft Feedback Loop

Function:
Lets users receive response without public scoring pressure.

Macro objective:
Create low-pressure social aliveness.

Micro objective:
Preserve feeling seen while reducing performance anxiety.

Recommended mechanism:
Small-context qualitative feedback + non-ranked response summary.

Priority:
Critical

Risk:
May reduce aliveness if feedback feels too muted.
```

### Expanded

```text
Root cause attacked:
Expression becomes public performance.

System flow:
User posts into bounded context
→ audience is constrained
→ responses are qualitative or low-intensity
→ public score is suppressed
→ system summarizes warmth / resonance
→ user feels seen without being ranked

Upstream data:
Post context, selected audience, desired feedback type.

Downstream output:
Low-pressure response experience.

Why this mechanism won:
It resolves the contradiction: users want feedback, but not judgment.

Rejected mechanisms:
- Hide all feedback: lowers pressure but kills aliveness.
- Public likes without counts: still creates social comparison.
- Private comments only: can preserve safety but may lack social energy.

Test method:
Measure posting frequency, deletion rate, response satisfaction, and anxiety self-report before and after feature use.
```

---

## 21. Implementation Sequence

Build the Feature Card System in this order:

```text
1. Feature Card schema
2. Macro / micro / mechanism alignment fields
3. Collapsed card UI
4. Expanded card UI
5. Side panel actions
6. Graph edge generation
7. Mechanism candidate comparison
8. Evaluation score display
9. Repair logic
10. Convert to build task
11. Send to spec exporter
```

Do not implement advanced data dependency views before the basic feature card trace works.

---

## 22. Acceptance Criteria

The Feature Card System is complete when:

```text
Every feature has a macro objective.
Every feature has a micro objective.
Every feature has a recommended mechanism.
Every feature explains upstream and downstream flow.
Every feature includes at least one rejected alternative mechanism.
Every feature has a quality gate result.
Every feature has a risk and failure mode.
Every feature has a test method.
Every feature updates the graph.
Every feature can be converted into a build task.
```

The system fails if it outputs:

```text
feature names without mechanisms,
mechanisms without objectives,
objectives without evaluation,
or feature cards that cannot become implementation tasks.
```

---

## 23. Final Instruction to Builder Agent

When implementing Feature Cards, do not treat them as UI decoration.

A Feature Card is a reasoning artifact, evaluation artifact, graph node, and implementation seed at the same time.

Every Feature Card must prove:

```text
why it exists,
how it works,
what it optimizes,
what it depends on,
what it improves downstream,
why it is better than alternatives,
and how it will be tested.
```

SpecForge’s feature quality depends on whether Feature Cards preserve the causal reasoning chain from macro intent to buildable mechanism.
