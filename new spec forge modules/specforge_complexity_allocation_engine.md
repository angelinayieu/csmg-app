# SpecForge — Complexity Allocation Engine

## 1. Purpose

The **Complexity Allocation Engine** decides where SpecForge should spend product, technical, reasoning, UI, and implementation complexity.

It prevents the system from overbuilding impressive but low-leverage areas while underbuilding the core reasoning modules that determine output quality.

The module answers:

> Given the macro objective, root constraint, first-principles need, MVP app direction, and accumulated constraints, where should complexity be increased, reduced, delayed, or removed?

---

## 2. Core Thesis

A world-class product is not created by making every part complex.

It is created by allocating complexity where it creates the most leverage.

Weak complexity allocation:

```text
Build the full graph view, multi-agent system, spec exporter, collaboration, research agent, and advanced UI all at once.
```

Strong complexity allocation:

```text
Put high complexity into the causal model, convergence, evaluation, and interaction loop. Keep graph visualization, spec export, collaboration, and automation lightweight until the core reasoning loop proves value.
```

SpecForge must treat complexity as a limited budget.

---

## 3. Position in SpecForge System

The Complexity Allocation Engine runs throughout the system.

It should be used during:

```text
Recursive Layer Optimization
Multifactor Problem Causal Modeling
Differentiation Intelligence
MVP App Direction Selection
Feature Card Generation
Evaluation Lab
Spec Export
Roadmap Planning
```

It is especially important after MVP App Direction selection and before Feature Card generation.

---

## 4. Main Output

The engine outputs:

```text
Complexity Budget
↓
Module Complexity Scores
↓
Value Return Scores
↓
Downstream Leverage Scores
↓
Overbuilt Warnings
↓
Underbuilt Warnings
↓
Complexity Reallocation Recommendations
↓
First-Build Scope
↓
Delayed Scope
```

---

## 5. Complexity Types

SpecForge should distinguish several types of complexity.

### 5.1 Reasoning Complexity

How much analytical depth the module requires.

Examples:

```text
causal variables
feedback loops
root constraint tournament
counterfactuals
cross-layer evaluation
```

### 5.2 UI Complexity

How complex the interface is.

Examples:

```text
freeform graph editing
multiple view modes
drag-and-drop cards
animated unfurling
advanced filtering
```

### 5.3 Technical Complexity

How difficult the implementation is.

Examples:

```text
graph database
real-time collaboration
multi-agent orchestration
research automation
version branching
```

### 5.4 Interaction Complexity

How many actions the user must understand.

Examples:

```text
compare
challenge
merge
branch
re-score
repair
send downstream
```

### 5.5 Data Complexity

How much data is required, collected, transformed, or stored.

Examples:

```text
user preferences
feedback loops
third-party integrations
market research
usage analytics
```

### 5.6 Evaluation Complexity

How many criteria, weights, tradeoffs, and scoring passes are required.

Examples:

```text
root-cause alignment
differentiation strength
buildability
risk
evidence strength
downstream leverage
```

---

## 6. Complexity Budget

Every MVP should define a complexity budget.

```json
{
  "total_complexity_budget": 100,
  "reasoning_complexity_budget": 40,
  "ui_complexity_budget": 20,
  "technical_complexity_budget": 20,
  "interaction_complexity_budget": 10,
  "evaluation_complexity_budget": 10
}
```

For SpecForge’s first MVP, recommended allocation:

```text
Reasoning complexity: high
UI complexity: medium-low
Technical complexity: medium-low
Interaction complexity: medium
Evaluation complexity: high
```

Reason:

```text
The product wins through better reasoning and narrowing, not through a full visual graph database in version one.
```

---

## 7. Module Complexity Score

Each module should be scored by:

```text
implementation difficulty
UI difficulty
reasoning difficulty
data dependency
user comprehension cost
maintenance cost
risk of failure
```

Example scoring:

```text
Multifactor Causal Modeling:
Reasoning complexity: high
UI complexity: medium
Technical complexity: medium
User comprehension cost: medium-high
Downstream leverage: very high

Full Graph View:
Reasoning complexity: medium
UI complexity: high
Technical complexity: high
User comprehension cost: high
Downstream leverage: medium for v1
```

---

## 8. Value Return Score

Each module should be scored by the value it creates.

```text
root-cause impact
desired-result fit
user decision impact
differentiation contribution
downstream leverage
speed to value
repeat-use potential
validation importance
```

A module deserves high complexity only if it has high value return.

---

## 9. Complexity-to-Value Ratio

Use this rule:

```text
Complexity-to-Value Ratio =
value return / complexity cost
```

High ratio:

```text
Build now.
```

Medium ratio:

```text
Simplify or build partial version.
```

Low ratio:

```text
Delay or remove.
```

---

## 10. Downstream Leverage Score

Some modules improve many later outputs.

These deserve more complexity.

For SpecForge:

```text
Problem Causal Modeling
→ improves convergence
→ improves differentiation
→ improves solution families
→ improves MVP directions
→ improves feature cards
→ improves spec quality
```

This has high downstream leverage.

Spec Exporter:

```text
Spec Exporter
→ useful after MVP selected
→ weak if upstream reasoning is wrong
```

This has lower first-build leverage.

---

## 11. Overbuilt Warning

The engine should warn when a module receives too much complexity too early.

A module may be overbuilt if:

```text
- it is visually impressive but not decision-critical
- it depends on unresolved upstream reasoning
- it increases user confusion
- it delays proving the core value
- it adds implementation risk without strong learning value
- it serves power users before basic users understand the workflow
```

Example:

```text
Warning:
Full Graph View is overbuilt for v1.

Reason:
The core value depends on causal modeling and evaluation, not freeform graph exploration. Use graph-backed cards and a summary strip first.
```

---

## 12. Underbuilt Warning

The engine should warn when a core module is too shallow.

A module may be underbuilt if:

```text
- downstream modules depend on it
- it determines recommendation quality
- it creates the main differentiation
- shallow output causes generic solutions
- it lacks quality gates
- it lacks user interaction
```

Example:

```text
Warning:
Problem Causal Model is underbuilt.

Reason:
It lacks variables, feedback loops, contradictions, root constraint tournament, and leverage point ranking. MVP recommendations will become generic.
```

---

## 13. Complexity Reallocation

The engine should recommend moving complexity.

Example:

```text
Reduce complexity:
- full graph visualization
- advanced spec exporter
- collaboration
- research automation

Increase complexity:
- multifactor causal model
- evaluation lab
- side panel interactions
- constraint accumulation
- feature card traceability
```

---

## 14. First-Build Scope Rules

The engine should enforce first-build scope.

Include now if:

```text
- required to prove core thesis
- attacks root constraint
- enables desired result
- differentiates from alternatives
- has high downstream leverage
- can be built without massive infrastructure
```

Delay if:

```text
- useful only after selected MVP exists
- mostly visual polish
- requires complex infrastructure
- creates user confusion
- does not directly improve first decision quality
```

Remove if:

```text
- violates accumulated constraints
- duplicates alternative products
- does not connect to root constraint
- creates more ambiguity
```

---

## 15. Complexity Allocation for SpecForge v1

### High Complexity

```text
Multifactor Causal Modeling Engine
Evaluation Lab / Narrowing Engine
Constraint Accumulation System
Side Panel Interaction System
Feature Card System
```

### Medium Complexity

```text
Target User Layering
Desired Result Layering
Differentiation Intelligence
MVP App Direction Generator
Whiteboard Unfurl System
Knowledge Graph / State Model
```

### Low Complexity for v1

```text
Graph View
Spec Exporter
Prototype Prompt Generator
Research Automation
Iteration Timeline
Collaboration
```

This does not mean they are unimportant. It means they are not the first complexity sink.

---

## 16. Prompt for Complexity Allocation Engine

```text
You are the Complexity Allocation Engine for SpecForge.

Given:
- macro objective
- target user model
- problem causal model
- desired result stack
- root constraint
- first-principles need
- differentiation thesis
- selected MVP app direction
- accumulated constraints
- candidate modules / features

Decide where complexity should be increased, reduced, delayed, or removed.

For each module or feature, evaluate:
1. root-cause impact
2. desired-result fit
3. downstream leverage
4. differentiation contribution
5. speed to user value
6. buildability
7. user comprehension cost
8. technical difficulty
9. risk
10. dependency on unresolved upstream modules
11. validation importance

Return:
{
  "complexity_budget": {},
  "module_scores": [],
  "high_complexity_modules": [],
  "medium_complexity_modules": [],
  "low_complexity_modules": [],
  "overbuilt_warnings": [],
  "underbuilt_warnings": [],
  "reallocation_recommendations": [],
  "first_build_scope": [],
  "delayed_scope": [],
  "removed_scope": [],
  "rationale": ""
}

Rules:
- Do not allocate complexity evenly.
- Prioritize modules with high downstream leverage.
- Downgrade modules that are impressive but not required for the core thesis.
- Flag modules that are too shallow to support downstream quality.
- Preserve buildability for the first MVP.
```

---

## 17. Quality Gates

The Complexity Allocation output fails if:

```text
- every module receives similar priority
- overbuilt risks are not identified
- underbuilt core modules are not identified
- downstream leverage is ignored
- first-build scope is too large
- delayed scope is not specified
- complexity is allocated to visual polish before core reasoning quality
- no rationale is provided
```

---

## 18. Repair Prompt

```text
You are the Complexity Allocation Quality Critic.

Review the complexity allocation output.

Reject or repair it if:
- it spreads complexity evenly
- it does not identify overbuilt modules
- it does not identify underbuilt modules
- it ignores downstream leverage
- it does not distinguish first-build scope from delayed scope
- it prioritizes impressive features over core product value
- it does not protect buildability
- it does not explain why complexity is allocated where it is

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_complexity_allocation": {},
  "confidence_after_repair": ""
}
```

---

## 19. Whiteboard Visualization

### Complexity Strip

Show a compact strip on the board:

```text
Complexity Allocation

High:
Problem Causal Model, Evaluation Lab

Medium:
Differentiation, MVP Directions, Feature Cards

Delay:
Full Graph View, Spec Export, Collaboration
```

### Card Badges

Add badges to cards:

```text
High leverage
Underbuilt
Overbuilt
Delay
Build now
Simplify
```

### Side Panel

When selected, show:

```text
complexity score
value return score
downstream leverage
risk
recommendation
why build now / delay
```

---

## 20. Side Panel Actions

```text
Show complexity budget
Reallocate complexity
Explain why this is high priority
Explain why this is delayed
Simplify module
Make module more advanced
Show overbuilt risk
Show underbuilt risk
Re-score for fastest MVP
Re-score for world-class depth
```

---

## 21. Graph Updates

The Complexity Allocation Engine creates graph nodes:

```text
Complexity Budget
Complexity Score
Value Return Score
Downstream Leverage Score
Overbuilt Warning
Underbuilt Warning
Reallocation Recommendation
First-Build Scope
Delayed Scope
Removed Scope
```

It creates edges:

```text
allocates_complexity_to
overbuilt_if
underbuilt_if
delays
prioritizes
downgrades
depends_on
improves_downstream
```

---

## 22. Interweaving with Other Modules

### With Recursive Layer Optimization

Complexity allocation determines how much depth each macro, micro, and mechanism layer deserves.

### With Evaluation Lab

Evaluation Lab uses complexity scores to judge whether a solution is worth building.

### With MVP App Direction Generator

MVP candidates are rejected if they require too much complexity for first validation.

### With Feature Card System

Feature cards receive complexity levels and build priority.

### With Whiteboard Unfurl

Only high-priority and high-leverage cards should be visually prominent.

### With Spec Export

Spec export should include what to build now and what to delay.

---

## 23. Minimum Implementation Requirements

For first implementation, the engine must produce:

```text
1. high / medium / low complexity module list
2. overbuilt warnings
3. underbuilt warnings
4. first-build scope
5. delayed scope
6. rationale for allocation
7. complexity badges for whiteboard cards
```

---

## 24. Acceptance Criteria

The module is complete when:

```text
- high-complexity areas are justified by downstream leverage
- low-complexity areas are intentionally delayed
- overbuilt modules are flagged
- underbuilt core modules are flagged
- first-build scope is realistic
- visual prominence follows complexity/value priority
- evaluation can use complexity scores
- feature cards inherit complexity priority
```

---

## 25. Final Instruction

The Complexity Allocation Engine exists to protect SpecForge from building the wrong complexity.

It should force the system to ask:

```text
Where does complexity create the most product value?
Where is complexity just impressive?
Where is the system too shallow to produce strong outputs?
What must be built now?
What should be delayed?
What should be removed?
```

SpecForge should become deep where depth matters and simple where simplicity protects the product.
