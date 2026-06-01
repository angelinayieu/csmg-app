# SpecForge — Constraint Accumulation System

## 1. Purpose

The Constraint Accumulation System defines how SpecForge progressively narrows the definition of the “right” product, MVP, feature, mechanism, and build path.

SpecForge should not choose solutions by vibes, aesthetic preference, or generic scoring. It should accumulate constraints from every reasoning layer and use those constraints to eliminate weak options, repair misaligned ideas, and converge on the highest-leverage product direction.

The system exists to answer:

```text
What must the final solution satisfy to be considered right?
```

The answer should become more precise as the project moves through:

```text
Raw prompt
→ macro intention
→ target user
→ multifactor problem causal model
→ desired result
→ root constraint
→ first-principles need
→ differentiation
→ solution families
→ MVP app direction
→ feature cards
→ mechanisms
→ build spec
```

---

## 2. Core Thesis

A world-class product is created by constraint accumulation, not open-ended ideation.

SpecForge should generate many possibilities internally, but each layer should add constraints that make the solution space smaller, sharper, and more defensible.

The product should move from:

```text
many possible ideas
→ fewer plausible directions
→ one strongest MVP app direction
→ selected core features
→ selected mechanisms
→ buildable spec
```

The system should constantly ask:

```text
Given everything we now know, what can no longer be accepted as a valid solution?
```

---

## 3. Definition of Constraint

A constraint is any requirement, boundary, condition, tradeoff, or rule that determines whether a solution is acceptable.

Constraints can come from:

- user needs
- target-user behavior
- root problem causes
- desired result
- first-principles need
- differentiation requirements
- buildability limits
- data availability
- privacy or trust requirements
- technical feasibility
- market alternatives
- emotional or behavioral friction
- evidence confidence
- time and scope limits
- macro mission / philosophy

Constraints are not only limitations. They are also design intelligence.

A good constraint makes the product better by preventing generic or misaligned solutions.

---

## 4. Constraint Types

### 4.1 Macro Constraints

Macro constraints come from the overall mission, philosophy, and final user transformation.

They answer:

```text
What must every solution serve at the highest level?
```

Example for SpecForge:

```text
The product must help users move from vague product ambiguity to a confident build decision.
```

Example for a low-pressure social app:

```text
The product must help users feel socially alive without feeling publicly scored.
```

Macro constraints reject solutions that are impressive but off-mission.

---

### 4.2 Target-User Constraints

Target-user constraints come from the user model.

They answer:

```text
What must be true for this solution to fit the selected user?
```

Examples:

```text
The solution must work for solo builders with limited time.
The solution must reduce cognitive load, not add more planning overhead.
The solution must create value before the user has a finished product.
```

For a social app:

```text
The solution must reduce posting anxiety for users who want expression but fear judgment.
The solution must preserve enough feedback to feel socially alive.
```

---

### 4.3 Problem-Cause Constraints

Problem-cause constraints come from the Multifactor Causal Modeling Engine.

They answer:

```text
Which root causes must the solution attack?
```

Examples:

```text
The solution must attack the absence of a causal decision model.
The solution must not only generate more ideas.
The solution must connect features to root causes and desired outcomes.
```

For a social app:

```text
The solution must reduce audience ambiguity.
The solution must reduce metric-driven comparison.
The solution must change the feedback loop, not merely hide likes.
```

Problem-cause constraints are among the most important constraints in SpecForge.

---

### 4.4 Desired-Result Constraints

Desired-result constraints come from the Desired Result Layering Modeler.

They answer:

```text
What user outcome must the solution enable?
```

Examples:

```text
The user must know what to build first and why.
The user must feel confident enough to commit to a build path.
The system must produce a buildable MVP direction, not only a strategy explanation.
```

For a social app:

```text
The user must be able to post more naturally.
The user must feel seen without feeling ranked.
The app must increase authentic sharing without increasing anxiety.
```

---

### 4.5 Differentiation Constraints

Differentiation constraints come from the Differentiation Intelligence Engine.

They answer:

```text
Why is this better than current alternatives?
```

Examples:

```text
The solution must be meaningfully better than asking ChatGPT.
The solution must do more than organize notes like Notion.
The solution must solve a deeper decision problem than whiteboarding tools.
```

For a social app:

```text
The solution must do more than copy Instagram with hidden likes.
The solution must solve a deeper feedback-pressure problem than BeReal-style authenticity alone.
```

---

### 4.6 Buildability Constraints

Buildability constraints determine whether the solution can be built in a first MVP.

They answer:

```text
Can this be implemented without overbuilding?
```

Examples:

```text
The first version should not require a full graph database if structured JSON can prove value.
The first version should not require collaboration, accounts, or complex real-time syncing.
The first version should prove the core reasoning loop before adding research automation.
```

---

### 4.7 Mechanism Constraints

Mechanism constraints determine how a feature or system process must work internally.

They answer:

```text
What must the mechanism do to satisfy the feature objective?
```

Examples:

```text
The Problem Causal Modeler must generate variables, loops, contradictions, root-constraint candidates, and leverage points.
The Feature Card must show upstream inputs, internal process, downstream output, and why the mechanism won.
```

For a social app:

```text
The feedback mechanism must preserve aliveness while reducing public scoring.
The posting mechanism must reduce context ambiguity without increasing posting friction.
```

---

### 4.8 Data Constraints

Data constraints define what data should be collected, inferred, transformed, or avoided.

They answer:

```text
What data is worth collecting, and at what cost?
```

Examples:

```text
Do not collect a data point unless it improves downstream output enough to justify friction.
Data should be optional if direct collection creates user burden.
Sensitive data should require clear downstream value and trust justification.
```

---

### 4.9 Evaluation Constraints

Evaluation constraints define what the evaluator must enforce.

They answer:

```text
What conditions must a solution pass to survive narrowing?
```

Examples:

```text
A solution cannot win if it does not attack the root constraint.
A solution cannot win if it is not differentiated from alternatives.
A solution cannot win if it creates more ambiguity than it resolves.
A solution cannot win if it is too complex for the first MVP.
```

---

## 5. Constraint Accumulation Flow

Constraints should accumulate in this sequence:

```text
Prompt Power-Up
→ initial ambiguity and assumption constraints

Target User Layering
→ user-fit and behavior constraints

Multifactor Problem Causal Modeling
→ root-cause and leverage constraints

Desired Result Layering
→ outcome and success constraints

Cross-Analysis
→ alignment and contradiction constraints

Convergence
→ root constraint and first-principles need constraints

Differentiation Intelligence
→ alternative-gap and positioning constraints

Divergence
→ solution-family constraints

MVP App Direction Generator
→ app-scope and value-to-complexity constraints

Feature Card System
→ feature-objective and mechanism constraints

Evaluation Lab
→ narrowing and rejection constraints

Spec Exporter
→ implementation and validation constraints
```

Each stage should add constraints, not just add content.

---

## 6. Constraint Object Schema

Every constraint should be stored as a structured object.

```json
{
  "constraint_id": "",
  "constraint_text": "",
  "constraint_type": "macro | target_user | problem_cause | desired_result | differentiation | buildability | mechanism | data | evaluation | evidence | risk",
  "source_module": "",
  "source_node_id": "",
  "priority": "critical | high | medium | low",
  "confidence": 0,
  "why_it_matters": "",
  "what_it_rules_out": [],
  "what_it_requires": [],
  "downstream_modules_affected": [],
  "related_constraints": [],
  "conflicting_constraints": [],
  "validation_needed": "",
  "status": "active | provisional | violated | resolved | rejected"
}
```

---

## 7. Constraint Priority Levels

### Critical Constraint

A solution cannot pass if this constraint is violated.

Example:

```text
The first MVP must attack the root constraint.
```

### High Constraint

A solution is strongly downgraded if this is violated.

Example:

```text
The solution should be visibly better than ChatGPT for product decision-making.
```

### Medium Constraint

A solution should satisfy this if possible, but it may be traded off.

Example:

```text
The first version should include a compact graph summary.
```

### Low Constraint

A preference, not a decision rule.

Example:

```text
The interface should include a polished animation during card unfurling.
```

---

## 8. Constraint Conflict Handling

Constraints will often conflict.

SpecForge must explicitly surface conflict rather than hiding it.

Example:

```text
Constraint A:
Show more reasoning on the whiteboard so users can brainstorm.

Constraint B:
Keep the whiteboard readable and not overwhelming.
```

Resolution:

```text
Use layered progressive disclosure:
- core nodes visible by default
- micro-layers expandable
- full reasoning in side panel
```

Another example:

```text
Constraint A:
Collect enough user context to personalize feedback.

Constraint B:
Do not make posting feel like filling out a form.
```

Resolution:

```text
Use optional lightweight context chips instead of long forms.
```

---

## 9. Constraint-to-Evaluation Conversion

Constraints should become evaluation criteria.

Example:

```text
Constraint:
The MVP must attack the root constraint.

Evaluation criterion:
Root Constraint Alignment Score.
```

```text
Constraint:
The feature must reduce posting pressure without killing social aliveness.

Evaluation criteria:
Pressure Reduction Score
Aliveness Preservation Score
Tradeoff Balance Score
```

This is how constraints directly shape narrowing.

---

## 10. Constraint-to-Feature Conversion

Constraints should also generate feature requirements.

Example:

```text
Constraint:
Users need to feel seen without feeling scored.

Feature requirement:
Feedback should be qualitative, contextual, or softly summarized rather than publicly ranked.
```

```text
Constraint:
Users need to understand why an MVP direction won.

Feature requirement:
Recommendation card must include why this won, why others lost, and what assumptions could reverse the decision.
```

---

## 11. Constraint-to-Mechanism Conversion

Constraints must shape mechanism selection.

Example:

```text
Constraint:
Reduce audience ambiguity without increasing posting friction.

Rejected mechanism:
Require users to manually configure detailed audience settings every time.

Selected mechanism:
Use lightweight room selection and optional audience chips.
```

```text
Constraint:
Model problem complexity without overwhelming the board.

Rejected mechanism:
Show full causal graph by default.

Selected mechanism:
Show causal model summary + expandable clusters + side-panel deep inspect.
```

---

## 12. Constraint Accumulation Example: SpecForge

### Raw Intent

```text
Build an app idea optimizer agent.
```

### Accumulated Constraints

#### Macro Constraint

```text
Must help users move from ambiguity to confident build decision.
```

#### Target-User Constraint

```text
Must work for solo builders with limited time and uncertain product judgment.
```

#### Problem-Cause Constraint

```text
Must attack absence of a causal decision model, not merely produce more ideas.
```

#### Desired-Result Constraint

```text
Must produce an actionable MVP app direction and explain why it wins.
```

#### Differentiation Constraint

```text
Must be meaningfully better than ChatGPT, Notion, FigJam, and generic templates.
```

#### Buildability Constraint

```text
Must be possible to build without full graph database, collaboration, or research automation in v1.
```

#### Mechanism Constraint

```text
Must show user/problem/result/root-constraint relationships in an operative whiteboard format.
```

### Resulting Narrowed MVP

```text
Causal Product Modeling Workspace
```

### Resulting First Modules

```text
Prompt Power-Up Analyzer
Target User Layering Card
Multifactor Problem Causal Model Card
Desired Result Stack
Convergence Card
Differentiation Card
MVP App Direction Cards
```

---

## 13. Constraint Accumulation Example: Low-Pressure Social App

### Raw Intent

```text
Create a low-pressure, vivid posting social model.
```

### Accumulated Constraints

#### Macro Constraint

```text
Must create low-pressure social aliveness.
```

#### Target-User Constraint

```text
Must serve users who want expression but fear public judgment.
```

#### Problem-Cause Constraint

```text
Must reduce audience ambiguity, public scoring, comparison pressure, and feedback volatility.
```

#### Desired-Result Constraint

```text
Must help users feel seen without feeling scored.
```

#### Differentiation Constraint

```text
Must solve a deeper feedback-pressure problem than Instagram, TikTok, or BeReal.
```

#### Buildability Constraint

```text
Must avoid building a full social network before testing the core posting-feedback loop.
```

#### Mechanism Constraint

```text
Must preserve social response while reducing public metric salience.
```

### Resulting MVP Direction

```text
Low-Pressure Posting Rooms
```

### Resulting Core Mechanism

```text
Small-context, non-ranked, soft feedback loop.
```

---

## 14. Whiteboard Visualization

The Constraint Accumulation System should not dominate the whiteboard, but it should be visible.

### Default Board Element

Show a compact constraint strip:

```text
Active Constraints
Macro: structured confidence
User: solo builders with limited time
Problem: no causal decision model
Result: confident build decision
Differentiation: better than generic AI brainstorming
Buildability: no full graph DB in v1
```

### Expanded Constraint Card

When clicked, show:

```text
Constraint Accumulation

Critical Constraints:
1. Must attack root constraint.
2. Must produce a build decision.
3. Must be differentiated from alternatives.
4. Must be buildable in v1.

Conflicts:
- show reasoning depth vs maintain readability

Resolution:
- show core nodes on board, micro-layers in expansion, full reasoning in side panel
```

### Side Panel Actions

```text
View constraint source
Show what this rules out
Show affected downstream modules
Challenge constraint
Mark as critical
Convert to evaluation criterion
Find conflicting constraints
Repair violated constraint
```

---

## 15. Constraint Badges

Each major card should display badges when relevant.

Examples:

```text
Root-cause aligned
Differentiation required
Buildability risk
Constraint violation
Needs evidence
Critical constraint
```

These badges make narrowing visible without cluttering the board.

---

## 16. Constraint Violations

SpecForge should actively detect constraint violations.

Examples:

```text
Violation:
MVP Variation does not attack the root constraint.

Action:
Downgrade or reject.
```

```text
Violation:
Feature adds complexity but does not improve downstream outcome.

Action:
Move to later version or remove.
```

```text
Violation:
Mechanism requires too much user data and creates friction.

Action:
Generate lower-friction mechanism alternatives.
```

---

## 17. Constraint Repair

When a solution violates constraints, the system should repair it.

Repair options:

```text
Reduce scope
Change mechanism
Change target user
Reframe desired result
Add missing evaluation criterion
Move feature later
Split MVP into smaller app direction
Request research
Mark assumption risky
```

---

## 18. Integration with Recursive Layer Optimization

The Recursive Layer Optimization Engine uses constraints at every layer.

```text
Macro layer creates mission constraints.
Micro layer creates module constraints.
Mechanism layer creates process constraints.
Cross-layer evaluation checks whether constraints remain aligned.
```

The Constraint Accumulation System stores and enforces these constraints.

---

## 19. Integration with Evaluation Lab

The Evaluation Lab converts constraints into scoring and rejection rules.

Example:

```text
Constraint:
Must be meaningfully better than current alternatives.

Evaluation Lab:
Differentiation Score must be high, or the MVP cannot win.
```

```text
Constraint:
Must be buildable in v1.

Evaluation Lab:
Complexity penalty increases if solution requires full graph DB, research automation, or collaboration.
```

---

## 20. Integration with Feature Cards

Each Feature Card should show which constraints it satisfies.

Feature Card section:

```text
Constraints satisfied:
- attacks root cause
- enables desired result
- fits target user
- improves differentiation
- buildable in v1

Constraints at risk:
- may increase cognitive load
- may require user trust
```

A feature cannot become part of the selected MVP unless it satisfies enough critical constraints.

---

## 21. Integration with Multifactor Causal Modeling

The Multifactor Causal Modeling Engine generates problem-cause constraints.

Example:

```text
Causal model finding:
Public metrics increase comparison pressure.

Constraint created:
The solution must reduce public metric salience or change how feedback is represented.
```

```text
Causal model finding:
Too much privacy reduces social aliveness.

Constraint created:
The solution must reduce pressure without eliminating feedback.
```

These are high-value constraints because they come from the causal structure of the problem.

---

## 22. Minimum Implementation Requirements

The first implementation should include:

```text
1. Constraint object schema
2. Constraint generation from key modules
3. Constraint strip on whiteboard
4. Constraint badges on cards
5. Constraint-to-evaluation conversion
6. Constraint violation detection
7. Side panel constraint inspection
8. Constraint repair suggestions
```

Do not build a massive constraint dashboard first.

Start with a compact constraint strip and card-level badges.

---

## 23. Acceptance Criteria

The Constraint Accumulation System is working if:

```text
A raw idea produces active constraints.
Constraints come from multiple layers.
Constraints are visible on the board.
Each MVP direction can be evaluated against constraints.
Weak ideas are rejected because they violate constraints.
Features show which constraints they satisfy.
The final recommendation explains which constraints caused it to win.
Constraint conflicts are surfaced instead of hidden.
```

The system fails if:

```text
Constraints are only generic labels.
The system still recommends solutions that do not attack the root constraint.
Constraint conflicts are hidden.
The evaluator ignores constraints.
Features do not show constraint traceability.
The user cannot inspect why something was rejected.
```

---

## 24. Final Instruction

The Constraint Accumulation System should make SpecForge stricter over time.

Every reasoning layer should add requirements that narrow the solution space.

Every selected MVP, feature, mechanism, and spec should be able to answer:

```text
Which constraints does this satisfy?
Which constraints does it violate?
Which constraints made it win?
Which constraints made alternatives lose?
```

SpecForge should win by helping users make better build decisions through accumulated causal, user, outcome, differentiation, and buildability constraints.
