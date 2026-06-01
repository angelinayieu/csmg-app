# SpecForge — Differentiation Intelligence Engine

## 1. Purpose

The **Differentiation Intelligence Engine** determines why a product idea deserves to exist compared with existing alternatives, indirect workarounds, and familiar analogical models.

It prevents SpecForge from generating products that are internally interesting but externally weak.

The module answers:

> What do existing alternatives already solve, what deeper problem remains unsolved, why is this product meaningfully better, and how should that difference constrain MVP direction, feature design, mechanism design, positioning, and evaluation?

This module should not produce shallow competitor tables. It must compare at the level of **problem depth, mechanism depth, user outcome, and root-cause coverage**.

---

## 2. Core Thesis

Differentiation is not just feature comparison.

Weak differentiation:

```text
Our app has a knowledge graph and competitors do not.
```

Strong differentiation:

```text
Existing tools help users generate, organize, or build ideas, but they do not consistently model the causal structure behind user problems, desired results, alternative gaps, and build priorities. SpecForge differentiates by turning product ambiguity into a causally justified build decision.
```

The key question is not:

```text
What features do we have that they do not?
```

The key question is:

```text
What deeper problem do we solve that alternatives only partially address?
```

---

## 3. Position in SpecForge Pipeline

The Differentiation Intelligence Engine runs after Convergence and before Divergence / Solution Families.

```text
Raw Prompt
↓
Prompt Power-Up Analyzer
↓
Depth Selection Controller
↓
Target User Layering Modeler
↓
Multifactor Problem Causal Modeling Engine
↓
Desired Result Layering Modeler
↓
Cross-Analysis Engine
↓
Convergence Engine
↓
Differentiation Intelligence Engine
↓
Divergence / Solution Family Generator
↓
MVP App Direction Generator
↓
Evaluation Lab / Narrowing Engine
↓
Feature Card System
↓
Spec Exporter
```

Why it runs here:

- It needs the root constraint before comparing alternatives.
- It should compare alternatives against the deeper problem, not surface features.
- It should shape solution families before MVPs are generated.
- It prevents MVPs from becoming generic or redundant.

---

## 4. Main Output

The module outputs a **Differentiation Model**:

```text
Alternative Landscape
↓
Direct Alternatives
↓
Indirect Workarounds
↓
Analogical Examples
↓
Existing Strengths
↓
Existing Gaps
↓
Deeper Problem Not Solved
↓
Proposed Product Advantage
↓
Differentiation Thesis
↓
Positioning Options
↓
MVP Implications
↓
Constraints Passed Down
```

---

## 5. Alternative Landscape

The system should map all relevant alternatives.

### 5.1 Direct Alternatives

Products or tools solving the same obvious problem.

Examples for SpecForge:

```text
ChatGPT
Claude
Notion AI
FigJam / Miro
Product planning templates
AI coding agents with planning mode
Startup idea validators
Product management tools
```

### 5.2 Indirect Workarounds

What users do instead without using a direct product.

Examples:

```text
ask mentors
write notes manually
use Figma / FigJam boards
use Notion docs
ask ChatGPT repeatedly
watch startup content
start coding immediately
compare ideas mentally
ask friends for feedback
```

### 5.3 Analogical Examples

Products from other categories that provide useful mental models.

Examples:

```text
Figma for visual collaboration
Notion for structured knowledge
YouTube for feedback loops
Linear for execution clarity
Duolingo for guided progression
App Store editorial for polished discovery
GitHub Issues for traceable work
```

Analogies should be treated carefully. They are tools for understanding, not proof of differentiation.

---

## 6. Comparison Dimensions

The Differentiation Intelligence Engine should compare alternatives across these dimensions:

```text
Problem solved
Problem not solved
Target user fit
Depth of causal reasoning
Decision support quality
Mechanism sophistication
Traceability
Speed to value
User control
Buildability support
Evidence / research support
Positioning clarity
Retention potential
Differentiation strength
```

---

## 7. Deeper Problem Comparison

The most important output is the deeper problem gap.

Example for SpecForge:

```text
ChatGPT solves:
Generating ideas, text, lists, and strategic suggestions.

What ChatGPT does not deeply solve:
It does not maintain a structured causal decision model that connects target user, problem causes, desired results, alternative gaps, solution families, MVP directions, and feature mechanisms.

SpecForge solves:
The deeper problem of converting vague product ambiguity into a causally justified build decision.
```

Example for low-pressure social app:

```text
Instagram / TikTok solve:
Reach, entertainment, social performance, content discovery.

BeReal solves:
A lightweight authenticity ritual.

Private group chats solve:
Safe small-audience sharing.

What they do not deeply solve:
The contradiction between wanting to feel seen and not wanting to be publicly scored.

Proposed product solves:
Low-pressure social aliveness: users can receive meaningful social response without entering public performance loops.
```

---

## 8. Alternative Gap Types

The module should identify the type of gap each alternative leaves.

### 8.1 Depth Gap

The alternative solves a surface problem but not the root cause.

Example:

```text
ChatGPT generates ideas but does not build a causal decision structure.
```

### 8.2 Mechanism Gap

The alternative has the right intention but weak internal mechanism.

Example:

```text
A social app may hide likes but still use engagement-based ranking, leaving the performance loop intact.
```

### 8.3 Representation Gap

The alternative represents value in the wrong way.

Example:

```text
Social platforms represent social value through likes, comments, views, and follower counts instead of resonance, warmth, or presence.
```

### 8.4 Workflow Gap

The alternative helps one step but not the full transformation.

Example:

```text
A whiteboard helps organize thinking but does not guide convergence into a build decision.
```

### 8.5 Trust Gap

The alternative gives outputs but does not explain why they should be trusted.

Example:

```text
Generic AI recommendations may sound smart but do not show rejected alternatives or causal reasoning.
```

### 8.6 Execution Gap

The alternative helps decide but not build, or helps build but not decide.

Example:

```text
Coding agents accelerate implementation but do not determine what should be built first.
```

---

## 9. Analogical Framing

The system should generate analogies using this structure:

```text
Analogy:
[Product / pattern]

What transfers:
[Useful pattern]

What does not transfer:
[Misleading or irrelevant aspects]

Useful product insight:
[What this analogy teaches]

Risk:
[How the analogy could mislead product design]
```

Example:

```text
Analogy:
Figma for causal product reasoning.

What transfers:
visual canvas, editable objects, spatial thinking, collaboration, object-based manipulation.

What does not transfer:
pure design-file editing, pixel-level design focus, visual-first artifact creation.

Useful product insight:
The board should allow users to manipulate reasoning objects, not just read a report.

Risk:
Could over-prioritize visual polish before causal reasoning quality.
```

---

## 10. Differentiation Thesis

The module should distill all comparison into one clear thesis.

A strong differentiation thesis must include:

```text
selected target user
deeper problem
what alternatives solve
what alternatives miss
proposed product advantage
mechanism that creates the advantage
desired result enabled
```

Example:

```text
For solo founders with vague app ideas, existing tools help generate, organize, or build ideas, but they do not consistently convert ambiguity into causally justified build decisions. SpecForge differentiates by modeling target user, problem causes, desired results, alternative gaps, and MVP directions as one traceable decision system.
```

---

## 11. Positioning Options

The engine should generate multiple positioning options.

### 11.1 Direct Positioning

```text
SpecForge is a causal product decision workspace for turning vague app ideas into buildable MVP directions.
```

### 11.2 Contrast Positioning

```text
Not another idea generator — a causal decision system for choosing what to build first.
```

### 11.3 Analogy Positioning

```text
Figma for product reasoning: a visual canvas where ideas become causal models, MVP directions, and build decisions.
```

### 11.4 Outcome Positioning

```text
Move from vague idea to confident build path.
```

### 11.5 Category-Creation Positioning

```text
Causal product intelligence for early builders.
```

---

## 12. MVP Implications

Differentiation must affect MVP scope.

Example for SpecForge:

```text
If the differentiation is causal decision confidence, then the MVP must include:
- target user model
- multifactor problem causal model
- desired result stack
- convergence card
- alternative comparison
- MVP app direction recommendation

The MVP should not start with:
- full graph database
- collaboration
- spec export
- generic idea generation
```

Example for low-pressure social app:

```text
If the differentiation is social presence without scoring, then the MVP must include:
- bounded audience context
- soft feedback mechanism
- non-ranked response display
- posting flow that reduces self-presentation effort

The MVP should not start with:
- public follower system
- engagement feed ranking
- public like counts
- creator growth tools
```

---

## 13. Differentiation Quality Gates

The Differentiation Model fails if:

```text
- comparison is only feature-level
- alternatives are not clearly identified
- indirect workarounds are missing
- analogies are decorative
- deeper problem gap is missing
- product advantage is unsupported
- no positioning thesis is created
- no MVP implications are generated
- no constraints are passed downstream
- current market claims are made without marking research needs
```

If it fails, run the repair prompt.

---

## 14. Repair Prompt

```text
You are the Differentiation Quality Critic.

Review the differentiation model.

Reject or repair it if:
- it compares only surface features
- it does not identify direct alternatives
- it does not identify indirect workarounds
- it does not explain the deeper problem alternatives fail to solve
- it claims superiority without causal basis
- analogies are used decoratively
- misleading analogies are not flagged
- no MVP implications are produced
- no constraints are passed downstream

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_differentiation_model": {},
  "confidence_after_repair": ""
}
```

---

## 15. Prompt for Differentiation Intelligence Engine

```text
You are the Differentiation Intelligence Engine for SpecForge.

Given:
- target user model
- multifactor causal problem model
- desired result stack
- root constraint
- first-principles need
- convergence thesis

Compare the proposed product direction against direct alternatives, indirect workarounds, and analogical products.

Do not compare only surface features.
Compare by:
1. what problem each alternative solves
2. what deeper problem it does not solve
3. what user need remains unmet
4. what mechanisms the proposed product uses to solve the deeper problem
5. why the proposed product is meaningfully better for the selected target user
6. which analogies help explain the product
7. which analogies are misleading
8. what positioning statement best captures the advantage
9. what MVP implications follow

Return structured JSON:
{
  "direct_alternatives": [],
  "indirect_workarounds": [],
  "analogical_examples": [],
  "existing_solution_strengths": [],
  "existing_solution_gaps": [],
  "alternative_gap_types": [],
  "deeper_problem_not_solved": "",
  "proposed_product_advantage": "",
  "differentiation_thesis": "",
  "positioning_options": [],
  "analogy_framings": [],
  "misleading_analogies": [],
  "mvp_implications": [],
  "constraints_passed_down": [],
  "research_needed": []
}

Rules:
- Do not claim superiority without explaining the deeper problem solved.
- Do not use analogies as decoration.
- Every comparison must connect to target user, root constraint, desired result, and first-principles need.
- If current market facts are needed, mark them as requiring research.
```

---

## 16. Research Trigger Rules

The engine should trigger research when:

```text
- comparing against a real current company or product
- making claims about market position
- making claims about current features
- making claims about pricing
- making claims about user adoption
- making claims about recent AI/product tools
```

If research is not available, output:

```text
Research needed before confirming this claim.
```

This preserves trust.

---

## 17. Constraints Passed Down

Differentiation should create constraints.

Examples for SpecForge:

```text
Alternative gap constraint:
The product must do more than generate ideas; it must show causal decision reasoning.

Traceability constraint:
The product must show why recommendations follow from root causes.

Positioning constraint:
The MVP must be explainable as a differentiated category, not just a ChatGPT wrapper.

MVP scope constraint:
The first version must include enough causal modeling to prove the differentiation.
```

Examples for low-pressure social app:

```text
Representation constraint:
Do not use public likes as the primary value representation.

Feedback constraint:
Preserve aliveness while reducing scoring pressure.

Audience constraint:
Reduce audience ambiguity.

Incentive constraint:
Avoid engagement-maximizing loops in the first MVP.
```

---

## 18. Whiteboard Visualization

### Default Card

```text
Differentiation Intelligence

Existing alternatives:
[top 3–5 alternatives]

Deeper gap:
[deeper problem alternatives fail to solve]

Product advantage:
[why this product is meaningfully better]

Positioning:
[one-line thesis]
```

### Expanded Card

```text
Direct alternatives
Indirect workarounds
Analogical examples
Existing strengths
Existing gaps
Deeper problem not solved
Differentiation thesis
MVP implications
Constraints passed down
```

### Side Panel

Shows:

```text
alternative matrix
analogy analysis
misleading analogies
positioning options
research needed
MVP implications
constraints passed down
```

### Side Panel Actions

```text
Add alternative
Compare against selected alternative
Generate deeper gap
Generate stronger positioning
Generate analogies
Flag analogy as misleading
Send implications to MVP generator
Turn gap into constraint
Run research
```

---

## 19. Graph Updates

The Differentiation Intelligence Engine creates graph nodes:

```text
Alternative
Direct Alternative
Indirect Workaround
Analogical Example
Alternative Strength
Alternative Gap
Deeper Problem
Differentiation Thesis
Positioning Option
MVP Implication
Differentiation Constraint
Research Need
```

It creates edges:

```text
compared_against
solves
fails_to_solve
leaves_gap
differentiates_from
outperforms_on
misleads_if_used_as
implies
constrains
passes_constraint_to
requires_research
```

---

## 20. Interweaving with Other Modules

### With Target User Layering

Target user determines which alternatives matter.

Example:

```text
Solo founder → compare against ChatGPT, Notion, FigJam, coding agents, mentor feedback.
Creator → compare against Instagram, TikTok, BeReal, group chats.
```

### With Multifactor Causal Modeling

The root causal model determines whether an alternative is solving a symptom or root constraint.

### With Desired Result Layering

Desired result determines which alternative gaps matter.

Example:

```text
If desired result is structured confidence, alternatives are judged by whether they create decision confidence.
```

### With Convergence Engine

Convergence provides the root product thesis that alternatives must be compared against.

### With Divergence / Solution Families

Differentiation creates solution-family constraints.

Example:

```text
If alternatives lack causal traceability, a solution family should preserve visible reasoning traces.
```

### With MVP App Direction Generator

MVPs must exploit the most important alternative gaps.

### With Feature Card System

Feature cards must show which alternative gap they address.

### With Evaluation Lab

Evaluation Lab scores differentiation strength and downgrades undifferentiated solutions.

---

## 21. Evaluation Lab Integration

Evaluation should score:

```text
alternative gap strength
differentiation clarity
depth of problem solved
strength against direct alternatives
strength against indirect workarounds
analogy usefulness
positioning clarity
MVP implication strength
research confidence
```

No MVP direction should win if it is not meaningfully better than existing alternatives for the selected user.

---

## 22. Minimum Implementation Requirements

For the first implementation, Differentiation Intelligence must generate:

```text
1. at least 3 direct or indirect alternatives
2. at least 2 analogical examples
3. existing strengths
4. existing gaps
5. deeper problem not solved
6. one differentiation thesis
7. at least 3 MVP implications
8. at least 3 constraints passed downstream
9. research-needed flags where relevant
```

---

## 23. Acceptance Criteria

The module is complete when:

```text
- alternatives are compared causally, not only by feature
- deeper unsolved problem is identified
- differentiation thesis is specific and useful
- analogies include what transfers and what does not
- MVP implications are generated
- constraints are passed downstream
- weak or unsupported superiority claims trigger repair
- the differentiation card is visible and interactive on the whiteboard
```

---

## 24. Final Instruction

The Differentiation Intelligence Engine exists to prevent SpecForge from building impressive but unnecessary products.

It should force the system to ask:

```text
What already exists?
What does it solve?
What deeper problem remains unsolved?
Why does our product solve that deeper problem better?
What analogies help explain this?
What analogies mislead us?
What does this force the MVP to include or avoid?
```

Differentiation becomes a constraint on every downstream solution.
