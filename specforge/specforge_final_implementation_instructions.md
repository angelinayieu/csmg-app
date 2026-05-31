# SpecForge Autopilot — Final Implementation Instructions

## 1. Purpose of This Document

This document explains how to use the three final SpecForge architecture documents together and how to implement the system in the correct order.

Use this file as the **developer / agent instruction guide**.

The three source documents are:

1. `specforge_final_causal_architecture_plan.md`  
   Defines the product logic, engine sequence, causal modeling structure, and final system architecture.

2. `specforge_final_prompt_optimization_architecture.md`  
   Defines the optimized prompts, schemas, quality gates, critique prompts, and prompt chaining strategy.

3. `specforge_final_whiteboard_unfurling_spec.md`  
   Defines how the reasoning should visually unfold on the whiteboard, what should be visible, what should be hidden, and how users interact with nodes.

This document tells the builder how to weave those documents together into an implementation plan.

---

## 2. Core Build Principle

SpecForge must not be implemented as a generic brainstorming app.

It should be implemented as a **causal product decision system**.

The system must follow this transformation:

```text
messy idea
→ clarified intent
→ target user layers
→ problem cause layers
→ desired result layers
→ root constraint
→ first-principles need
→ alternative comparison
→ differentiation thesis
→ solution families
→ MVP variations
→ feature mechanisms
→ buildable spec
```

The product should only surface the reasoning artifacts that help the user make better build decisions.

The whiteboard is for decision-making and brainstorming.
The side panel is for inspection, explanation, and interaction.
The prompt engine is for structured reasoning.
The knowledge graph is for preserving relationships and dependencies.

---

## 3. How to Read the Documents

### Step 1 — Read the Causal Architecture Plan First

Start with:

```text
specforge_final_causal_architecture_plan.md
```

Use it to understand:

- the full engine sequence,
- the causal product thesis,
- the target user / problem / result layering logic,
- the convergence and divergence model,
- where the Differentiation Intelligence Engine fits,
- what each engine is supposed to produce,
- why feature generation must come after causal modeling.

This document defines **what the system is**.

---

### Step 2 — Read the Prompt Optimization Architecture Second

Then read:

```text
specforge_final_prompt_optimization_architecture.md
```

Use it to implement:

- the prompt chain,
- each engine's system prompt,
- each engine's output schema,
- quality gates,
- critique / repair prompts,
- depth selection logic,
- causal convergence and divergence prompts,
- final spec export prompts.

This document defines **how the agent thinks**.

---

### Step 3 — Read the Whiteboard Unfurling Specification Third

Then read:

```text
specforge_final_whiteboard_unfurling_spec.md
```

Use it to implement:

- what appears on the whiteboard,
- the order in which cards unfurl,
- the convergence-divergence board layout,
- which nodes are interactive,
- what stays hidden by default,
- how the side panel behaves,
- how graph nodes connect,
- how agent trace and chat should work.

This document defines **how the user sees and controls the reasoning**.

---

## 4. Implementation Sequence

Build SpecForge in this order.

Do not skip ahead to the full graph, full autopilot, or spec export before the causal modeling loop works.

---

## Phase 0 — Data Model Foundation

### Goal

Create the internal object model that all engines, whiteboard nodes, graph relationships, and side-panel interactions will use.

### Build

Implement these core objects:

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
```

### Required Node Types

```text
Raw Idea
Clean Summary
Root Intent
Target User
User Constraint
Surface Problem
Cause
Root Constraint
First-Principles Need
Desired Result
Assumption
Risk
Question
Alternative
Differentiation Thesis
Solution Family
MVP Variation
Feature Mechanism
Metric
Recommendation
Spec Output
```

### Required Edge Types

```text
interpreted_as
causes
blocks
depends_on
explains
creates_need_for
attacks_cause
enables_result
competes_with
compared_against
solves
risks
measured_by
validates
contradicts
prepares_for
selected_as
```

### Acceptance Criteria

- Every engine output can be stored as structured JSON.
- Every whiteboard card is generated from an artifact or graph node.
- Every node can be connected to other nodes.
- Every user edit can update the graph and trace.

---

## Phase 1 — Prompt Power-Up Analyzer

### Goal

Turn a messy raw prompt into a structured starting state.

### Input

```text
Raw user idea / prompt
```

### Output

```text
Clean Summary
Root Intent
Desired Result Guess
Target User Guess
Core Problem Guess
Baseline Guess
Ambiguities
Hidden Assumptions
Missing Questions
Powered-Up Prompt
Recommended Next Module
```

### Whiteboard Unfurl

Create these cards:

```text
Raw Idea
Clean Summary
Root Intent
Main Ambiguity
Hidden Assumption
Powered-Up Prompt Preview
```

### Side Panel Actions

```text
Edit raw prompt
Ask why this interpretation was chosen
Regenerate summary
Clarify ambiguity
Accept prompt interpretation
Run depth selection
```

### Acceptance Criteria

- The system does not generate features yet.
- The system clearly separates explicit information from inferred information.
- Ambiguities and assumptions are visible.
- The powered-up prompt is usable by the next engine.

---

## Phase 2 — Depth Selection Controller

### Goal

Decide how deeply the system should model before generating MVPs or features.

### Input

```text
Prompt Power-Up output
```

### Output

```text
Depth Level
Depth Reason
Required Modules
Modules to Skip
Risk if Too Shallow
```

### Depth Levels

```text
Level 1: Surface Model
Level 2: Causal Model
Level 3: Strategic Model
Level 4: Research-Backed Model
```

### Acceptance Criteria

- The system increases depth when ambiguity, uncertainty, causal complexity, or decision impact is high.
- The user can override the depth level.
- The selected depth controls how much of the later pipeline runs.

---

## Phase 3 — Target User Layering Modeler

### Goal

Break the target user into behaviorally useful layers.

### Output

```text
User Category
Primary Segment
Subsegments
Context
Behavior Patterns
Motivations
Constraints
Decision Triggers
Current Workarounds
Urgency / Willingness
Core Need
User Variants
Product Implications
```

### Whiteboard Unfurl

Create a compact Target User Model card.

Inside the card, show:

```text
Segment
Context
Behavior
Constraint
Decision Trigger
Core Need
```

Hide deeper variants inside the side panel.

### Side Panel Actions

```text
Brainstorm more segments
Compare user variants
Make user more specific
Find highest-pain user
Show how this user changes MVP direction
```

### Acceptance Criteria

- The target user is not a flat persona.
- The system identifies variables that affect value, feature priority, and MVP direction.
- At least one primary segment is selected or recommended.

---

## Phase 4 — Problem Cause Tree Modeler

### Goal

Decompose the core problem into deep causal layers and converge toward a root constraint.

### Required Cause Layers

```text
Surface Problem
Task-Level Failure
Decision-Level Failure
Comparison Failure
Criteria Failure
Causal-Model Failure
User-Model Failure
Desired-Result Failure
Representation Failure
Mechanism Failure
Confidence Failure
Workflow Failure
Root Constraint
First-Principles Need
```

### Output

```text
Surface Problem
Cause Tree
Causal Branches
Repeated Causes
Root Constraint
First-Principles Need
Highest-Leverage Cause
Uncertainty Points
Assumptions
Evidence Needed
```

### Whiteboard Unfurl

This is the main visible reasoning spine.

Show:

```text
Surface Problem
↓
Task Failure
↓
Decision Failure
↓
Comparison Failure
↓
Criteria Failure
↓
Causal-Model Failure
↓
Representation Failure
↓
Confidence Failure
↓
Workflow Failure
↓
Root Constraint
↓
First-Principles Need
```

The full branch tree should be inspectable, not all visible by default.

### Side Panel Actions

```text
Go deeper
Generate alternative causes
Show downstream effects
Connect to target user
Connect to desired result
Turn into solution direction
Test assumption
Challenge root constraint
```

### Acceptance Criteria

- The system does not stop at immediate causes.
- The root constraint is causal, actionable, software-solvable, and specific.
- The first-principles need is distilled and usable for solution generation.
- If the root constraint is vague, the engine must run a repair prompt.

---

## Phase 5 — Desired Result Layering Modeler

### Goal

Turn vague desired outcomes into layered, measurable, decision-useful results.

### Required Layers

```text
Surface Output
Functional Result
Decision Result
Emotional Result
Behavior Change
Measurable Success
Strategic Outcome
First-Principles Result
```

### Output

```text
Desired Result Stack
Success Metrics
Failure Conditions
Result-to-Cause Connections
```

### Whiteboard Unfurl

Place Desired Result Stack parallel to the Problem Cause Tree.

Show connections like:

```text
Decision Failure → blocks → Decision Result
Criteria Failure → blocks → Ranked MVP Path
Confidence Failure → blocks → Emotional Confidence
Workflow Failure → blocks → Behavior Change
```

### Acceptance Criteria

- The desired result is measurable or observable.
- The result can guide MVP ranking.
- Each important cause links to a blocked result.

---

## Phase 6 — Cross-Analysis Engine

### Goal

Interweave target user, problem causes, desired result, assumptions, and constraints.

### Analyze

```text
User ↔ Problem
Problem ↔ Desired Result
Target User ↔ Desired Result
Cause ↔ Potential Solution
Assumption ↔ Risk
```

### Output

```text
Strongest User-Problem Fit
Weakest Fit
Cause-Result Alignment
Contradictions
Highest-Leverage Intervention
Root Product Thesis
Confidence Score
Unresolved Questions
```

### Acceptance Criteria

- The system identifies contradictions instead of smoothing them over.
- The highest-leverage intervention is justified causally.
- The root product thesis is ready for convergence.

---

## Phase 7 — Convergence Engine

### Goal

Distill the layered models into one strongest underlying product thesis.

### Output

```text
Root Constraint
First-Principles Need
Highest-Leverage Intervention
Distilled Product Thesis
What This Rules Out
What This Implies for Solution Design
```

### Whiteboard Unfurl

Create a prominent convergence zone:

```text
Root Constraint
↓
First-Principles Need
↓
Highest-Leverage Intervention
```

### Acceptance Criteria

- The system chooses one dominant thesis.
- It explains why weaker interpretations are less fundamental.
- The thesis can generate solution families.

---

## Phase 8 — Differentiation Intelligence Engine

### Goal

Compare the proposed product direction against existing alternatives, indirect workarounds, and analogical examples.

### Position in Pipeline

This must run **after convergence** and **before solution-family divergence**.

### Compare

```text
Direct Alternatives
Indirect Workarounds
Analogical Products
Existing Strengths
Existing Gaps
Deeper Problem Not Solved
Proposed Product Advantage
Differentiation Thesis
Misleading Analogies
Implications for MVP
```

### Output

```text
Alternative Map
Comparison Matrix
Deeper Problem Comparison
Differentiation Thesis
Analogy Framings
MVP Implications
```

### Whiteboard Unfurl

Show one compact card:

```text
Alternative Comparison

Existing tools solve:
[what they solve]

Missing layer:
[deeper unsolved problem]

SpecForge advantage:
[why this product solves deeper]
```

### Side Panel Actions

```text
Add alternative
Compare against ChatGPT / Notion / Figma / Miro / competitor
Generate analogical framing
Show what existing tools miss
Explain why our product goes deeper
Turn differentiation into positioning
```

### Acceptance Criteria

- The system does not compare only surface features.
- Every comparison connects to target user, root constraint, and desired result.
- Analogies are marked as useful or misleading.
- MVP implications are updated based on comparison.

---

## Phase 9 — Divergence / Solution Family Generator

### Goal

Generate solution families from the first-principles need, not from the raw idea.

### Output

```text
Solution Families
Root Cause Attacked
User Behavior Changed
Mechanism Used
MVP Seeds
Risks Introduced
Recommended Family
```

### Example Families

```text
Problem Modeling
Decision Support
Representation / Knowledge Graph
Confidence Building
Execution / Spec Export
```

### Whiteboard Unfurl

Show solution families branching from the first-principles need.

### Acceptance Criteria

- Every solution family traces back to the root constraint.
- Families are meaningfully different, not renamed versions of the same idea.
- The system recommends which family should produce the first MVP.

---

## Phase 10 — Question Expansion Engine

### Goal

Generate questions only where they reduce uncertainty or change the build decision.

### Output

```text
Question
Category
Priority
Why It Matters
What Answer Would Change
Related Nodes
Suggested Action
```

### Question Categories

```text
Target User
Problem Cause
Desired Result
Assumption
Value
Mechanism
Risk
MVP Direction
Technical Feasibility
Research Evidence
```

### Acceptance Criteria

- Questions are not generic.
- Top questions are linked to graph nodes.
- Low-value questions are hidden by default.

---

## Phase 11 — Knowledge Graph Builder

### Goal

Convert the causal model into graph nodes and edges for reasoning, not decoration.

### Output

```text
Nodes
Edges
Clusters
Hidden Nodes
Recommended View
```

### Graph Rule

Each MVP or feature must connect back to:

```text
Target User
→ Problem Cause
→ Root Constraint
→ Desired Result
→ Leverage Point
```

### Acceptance Criteria

- The graph avoids duplicate nodes.
- The graph does not include every sentence.
- The graph supports filtering by layer, priority, confidence, and node type.

---

## Phase 12 — MVP Variation Generator

### Goal

Generate 3–5 causally grounded MVP variations.

### Each MVP Must Include

```text
Target User
Root Cause Attacked
Desired Result Enabled
Core Mechanism
Simplest Version
Why It Is Valuable
Build Difficulty
Risk
Value Score
Difference from Baseline Tools
```

### Whiteboard Unfurl

Show only the top 3 MVP cards by default.

### Acceptance Criteria

- MVPs are not random feature bundles.
- Each MVP attacks a clear cause or leverage point.
- The system ranks MVPs by value-to-complexity ratio.

---

## Phase 13 — Feature Mechanism Generator

### Goal

Generate feature mechanisms only after an MVP direction is selected.

### Each Feature Must Include

```text
Feature Name
Root Cause Attacked
User Action
System Process
AI Reasoning Step
Data Required
Output Created
User Behavior Changed
Value Metric
Failure Mode
Implementation Difficulty
Test Method
```

### Acceptance Criteria

- No feature appears without a mechanism.
- Every feature attacks a cause or enables a desired result.
- Features that do not connect to the root constraint are removed.

---

## Phase 14 — Evaluation Engine

### Goal

Score MVPs and features using causal quality criteria.

### Score

```text
Root Cause Alignment
Target User Fit
Desired Result Fit
Speed to Value
Differentiation
Buildability
Risk
Evidence Strength
Confidence
Downstream Leverage
```

### Output

```text
Scores
Recommendation
Why This Won
Why Others Lost
Assumptions to Test
Confidence Level
Next Best Action
```

### Acceptance Criteria

- The system does not score based on vibes.
- Every recommendation explains the causal basis.
- Low-confidence outputs trigger deeper modeling or research.

---

## Phase 15 — Spec / Prototype Exporter

### Goal

Convert the selected MVP and feature mechanisms into a buildable spec.

### Output

```text
Product Summary
User Flow
Screens
Components
Data Schema
Prompt Schemas
Feature Requirements
Build Tasks
Validation Plan
Coding Agent Prompt
```

### Acceptance Criteria

- The spec preserves the causal model.
- Every build task maps to a user value, root cause, or selected mechanism.
- Unvalidated features are marked as optional or experimental.

---

## 5. How to Weave the Documents During Development

Use the documents together like this:

```text
For every engine:
1. Use the causal architecture doc to understand the engine's role.
2. Use the prompt optimization doc to implement the engine's prompt and schema.
3. Use the whiteboard unfurling doc to decide what appears visually.
4. Use this instruction doc to decide build order and acceptance criteria.
```

Example for Problem Cause Tree:

```text
Causal Architecture Doc:
Defines why problem modeling is central.

Prompt Optimization Doc:
Defines the Problem Cause Tree prompt and repair prompt.

Whiteboard Spec:
Defines the vertical cause spine and side-panel interactions.

Implementation Instructions:
Defines the exact phase, outputs, acceptance criteria, and what to build first.
```

---

## 6. Agent Skills Required During Development

The development agent should not act like a normal code assistant. It needs specific skills.

### Skill 1 — Causal Product Reasoning

The agent must understand:

- surface problem vs root constraint,
- symptom vs cause,
- cause vs mechanism,
- user need vs feature,
- root need vs surface request.

### Skill 2 — Schema-First Prompt Engineering

The agent must build every AI module with:

- a system prompt,
- an input contract,
- an output schema,
- a quality gate,
- a repair path,
- graph-update behavior.

### Skill 3 — Graph-Aware State Management

The agent must treat every output as a graph update.

It should know how to:

- create nodes,
- create edges,
- avoid duplicates,
- preserve provenance,
- update downstream recommendations when upstream nodes change.

### Skill 4 — Progressive Disclosure UI Design

The agent must not expose every internal object on the whiteboard.

It should know:

- what belongs on the board,
- what belongs in the side panel,
- what belongs in deep inspect,
- what should stay hidden unless requested.

### Skill 5 — Interaction Design for Brainstorming

The agent must design interactions around decision nodes:

- target user,
- problem cause,
- desired result,
- root constraint,
- differentiation thesis,
- MVP variation,
- feature mechanism,
- recommendation.

### Skill 6 — Quality Gate Enforcement

The agent must reject shallow outputs.

It should fail outputs that:

- skip causal layers,
- jump to features too early,
- do not connect to target user,
- do not explain the deeper problem,
- do not compare against alternatives,
- lack a clear root constraint,
- cannot generate meaningful solution families.

### Skill 7 — Product Differentiation Reasoning

The agent must compare against alternatives causally, not superficially.

It should analyze:

- what existing tools solve,
- what they miss,
- what deeper problem remains,
- why SpecForge is meaningfully better,
- which analogies help users understand the product,
- which analogies are misleading.

### Skill 8 — Implementation Discipline

The agent must build in phases and not overbuild.

It should prioritize:

1. structured outputs,
2. causal modeling,
3. whiteboard card generation,
4. side-panel interaction,
5. graph persistence,
6. MVP generation,
7. spec export.

Do not build the full visual graph first.
Do not build full multi-agent orchestration first.
Do not build the tech spec exporter before problem modeling works.

---

## 7. Minimal Vertical Slice

The first working prototype should include only this:

```text
Raw prompt input
↓
Prompt Power-Up Analyzer
↓
Target User Layering
↓
Problem Cause Tree
↓
Desired Result Stack
↓
Convergence: Root Constraint + First-Principles Need
↓
Differentiation Intelligence Card
↓
Top 3 Solution Families
↓
Recommended First MVP
```

### UI

Whiteboard:

- Raw Idea
- Clean Summary
- Target User Model
- Problem Cause Spine
- Desired Result Stack
- Root Constraint
- First-Principles Need
- Alternative Comparison
- Solution Families
- Recommendation

Side Panel:

- selected node details,
- brainstorm actions,
- alternatives,
- graph connections,
- activity trace,
- chat.

### Do Not Include Yet

- full graph database UI,
- full spec exporter,
- multi-agent debate,
- research automation,
- collaboration,
- accounts,
- social sharing.

---

## 8. MVP Acceptance Test

The first implementation is successful only if a messy idea can become:

```text
1. a clarified product intent,
2. a layered target user model,
3. a deep problem cause tree,
4. a desired result stack,
5. a root constraint,
6. a first-principles need,
7. a causal comparison against alternatives,
8. solution families,
9. top MVP direction,
10. a clear recommendation for what to build first.
```

The system fails if it only produces:

- generic app ideas,
- generic feature lists,
- shallow competitor comparisons,
- vague personas,
- vague problem statements,
- graph visuals with no causal reasoning.

---

## 9. Development Rule

When implementing any new feature, ask:

```text
Does this help the user move from ambiguity to a confident build decision?
```

If yes, build it.

If no, delay it.

---

## 10. Final Build Priority

Build in this order:

```text
1. Shared data model and graph node schema
2. Prompt Power-Up Analyzer
3. Depth Selection Controller
4. Target User Layering Modeler
5. Problem Cause Tree Modeler
6. Desired Result Layering Modeler
7. Cross-Analysis + Convergence Engine
8. Differentiation Intelligence Engine
9. Whiteboard unfurl cards
10. Side panel interactions
11. Solution Family Generator
12. MVP Variation Generator
13. Evaluation Engine
14. Feature Mechanism Generator
15. Spec / Prototype Exporter
```

This is the implementation sequence.

Do not reorder it unless there is a strong engineering constraint.

---

## 11. Final Instruction to Builder Agent

You are building SpecForge Autopilot, a causal product decision workspace.

Do not implement it as a generic prompt wrapper.

Every module must preserve the chain:

```text
user → problem → cause → root constraint → desired result → first-principles need → alternatives → differentiation → solution family → MVP → feature mechanism → spec
```

Every visible whiteboard card must help the user understand or improve that chain.

Every side-panel interaction must help the user refine, challenge, compare, deepen, or select a reasoning artifact.

Every final recommendation must explain why it is better than alternatives and which deeper problem it solves.

SpecForge wins by producing **better build decisions**, not longer outputs.
