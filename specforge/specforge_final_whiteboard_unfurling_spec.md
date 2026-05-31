# SpecForge Autopilot — Final Whiteboard Unfurling Specification

## 1. Purpose

This document defines how SpecForge's causal reasoning pipeline should unfold on the whiteboard.

The whiteboard should not expose every internal prompt, schema, or processing step. It should show the **decision-relevant reasoning artifacts** produced by the system.

The user should be able to understand:

> How did the agent move from my messy idea to a deeper first-principles product direction, how does this compare to existing alternatives, and what should I build next?

---

## 2. Core Whiteboard Principle

The whiteboard is for **brainstorming and decision-making**, not for showing the entire machine.

Show outputs, not prompt code.

The main whiteboard should unfurl:

```text
Raw Idea
↓
Prompt Power-Up
↓
Target User Layers
↓
Problem Cause Tree
↓
Desired Result Stack
↓
Convergence
↓
Alternative Comparison
↓
Differentiation Thesis
↓
Divergence
↓
MVP Variations
↓
Recommendation
```

---

## 3. Final Whiteboard Shape

Use a **converge-then-diverge layout**.

```text
                         [Target User Layers]
                                  \
                                   \
[Raw Idea] → [Prompt Power-Up] → [Problem Cause Tree] → [Root Constraint] → [First-Principles Need]
                                   /                                      ↓
                                  /                         [Alternative Comparison]
                    [Desired Result Stack]                              ↓
                                                              [Differentiation Thesis]
                                                                       ↓
                                                              [Leverage Intervention]
                                                                       ↓
                                                               [Solution Families]
                                                                       ↓
                                                                 [MVP Variations]
                                                                       ↓
                                                               [Recommendation]
```

This layout shows sequence, causality, convergence, comparison, and downstream divergence.

---

## 4. What Should Be Visible by Default

The default board should show only the highest-leverage reasoning objects:

1. Raw Idea
2. Clean Summary
3. Target User Model
4. Problem Cause Tree
5. Desired Result Stack
6. Root Constraint
7. First-Principles Need
8. Alternative Comparison
9. Differentiation Thesis
10. Solution Families
11. Top 3 MVP Variations
12. Recommended First Build

This is enough for the user to brainstorm and make decisions.

---

## 5. What Should Be Hidden by Default

Hide these unless clicked:

- full raw prompt
- full powered-up prompt
- full JSON schemas
- all generated questions
- all assumptions
- all solution family details
- all MVP scoring details
- all direct competitors and research evidence
- full knowledge graph node list
- all internal prompts
- repair prompts
- trace logs
- token usage
- deep mechanism internals

These belong in the side panel or deep inspect drawer.

---

## 6. Stage 1 — Raw Idea

### Purpose

Preserve the original user input as the source of truth.

### Whiteboard card

```text
Raw Idea

“I want to create an app idea optimizer agent using a knowledge graph, questions, MVP variations, feature scoring, and tech specs.”
```

### Side trace

```text
Step 1: Received raw prompt.
Preserving original wording before interpretation.
```

### Actions

- Edit original idea
- Re-run analysis
- Compare before / after

---

## 7. Stage 2 — Prompt Power-Up

### Purpose

Clarify the prompt before deep modeling.

### Cards to unfurl

```text
Clean Summary
The user wants an AI product intelligence agent that turns vague app ideas into structured, value-ranked MVP directions and buildable specs.
```

```text
Root Intent
Improve product decisions before users start building.
```

```text
Main Ambiguity
Is the product primarily a prompt analyzer, graph workspace, MVP generator, or prototype exporter?
```

```text
Hidden Assumption
A knowledge graph will improve decision quality enough to justify added complexity.
```

### Whiteboard rule

Do not show the full powered-up prompt on the main board. Put it in the side panel or a collapsed card.

---

## 8. Stage 3 — Target User Layering

### Purpose

Model the user deeply enough to make later problem and MVP decisions accurate.

### Main card

```text
Target User Model

Primary user:
Solo founder / technical builder with vague app ideas.
```

### Expandable layers

```text
User category → founder / builder
Segment → solo founder
Context → many ideas, limited time, unclear product direction
Behavior → uses ChatGPT, notes, whiteboards, coding agents
Motivation → wants to ship something valuable quickly
Constraint → lacks product decision structure
Decision trigger → needs to choose what to prototype first
Current workaround → repeated prompting, scattered docs, mentor feedback
Core need → confident next build action
```

### Side panel actions

- Brainstorm more user segments
- Compare users
- Make this user more specific
- Find highest-pain user
- Show how this user changes MVP direction

---

## 9. Stage 4 — Problem Cause Tree

### Purpose

Show the causal decomposition from surface problem to first-principles need.

This should be the main visual focus.

### Vertical cause spine

```text
Surface Problem
User cannot decide what app / feature / MVP to build first.
↓
Task Failure
Cannot convert vague idea into a clear MVP direction.
↓
Decision Failure
Cannot choose between user segments, problems, features, or MVP paths.
↓
Comparison Failure
No reliable way to compare options.
↓
Criteria Failure
No explicit criteria for value, risk, buildability, and differentiation.
↓
Causal-Model Failure
Does not know which problem causes matter most.
↓
User-Model Failure
Target user is not modeled deeply enough.
↓
Desired-Result Failure
Success outcome is vague.
↓
Representation Failure
Idea exists as messy language, not structured relationships.
↓
Mechanism Failure
Features are not connected to how they create value.
↓
Confidence Failure
User cannot trust the recommendation enough to commit.
↓
Workflow Failure
No repeatable path from ambiguity to build decision.
↓
Root Constraint
No causal decision system for converting vague ideas into value-ranked build priorities.
```

### Card rule

Each cause node should show:

- layer name
- one-line failure
- confidence / depth badge

### Cause node actions

- Go deeper
- Generate alternative causes
- Show downstream effects
- Connect to target user
- Connect to desired result
- Turn into solution direction
- Test assumption

---

## 10. Stage 5 — Desired Result Stack

### Purpose

Show what the user actually needs after the problem is solved.

### Main card

```text
Desired Result Stack
```

### Layers

```text
Surface Output
A better app idea.
↓
Functional Result
A ranked MVP path with feature logic.
↓
Decision Result
Know what to build first and why.
↓
Emotional Result
Feel less overwhelmed and more confident.
↓
Behavior Change
Stop scattered brainstorming and start structured prototyping.
↓
Measurable Success
Move from vague idea to buildable MVP spec in under 15 minutes.
↓
Strategic Outcome
Build higher-quality products faster by solving root causes first.
↓
First-Principles Result
Structured confidence.
```

### Relationship connectors

Show a few important connectors:

```text
Decision Failure → blocks → Decision Result
Criteria Failure → blocks → Ranked MVP Path
Confidence Failure → blocks → Emotional Confidence
Workflow Failure → blocks → Behavior Change
```

---

## 11. Stage 6 — Convergence Zone

### Purpose

Create the “aha” moment.

The user should see that the real problem is deeper than lack of ideas.

### Cards

```text
Root Constraint

The user lacks a causal decision system for converting vague ideas into value-ranked build priorities.
```

```text
First-Principles Need

Structured confidence: enough causal clarity to choose the next build action.
```

```text
Highest-Leverage Intervention

Model the target user, problem causes, and desired result before generating MVPs or features.
```

### Board rule

These cards should be visually prominent and centered.

---

## 12. Stage 7 — Alternative Comparison

### Purpose

Show how the proposed product compares against current alternatives and what deeper problem remains unsolved.

### Default card

```text
Alternative Comparison

Existing tools solve:
Idea generation, organization, whiteboarding, and documentation.

Missing layer:
Causal decision confidence.

SpecForge advantage:
Models the deeper problem before generating MVPs.
```

### Direct alternatives visible by default

Show only 3–5 chips:

```text
ChatGPT
Notion AI
FigJam / Miro
Product templates
Mentors / manual notes
```

### Hidden until clicked

- full competitor matrix
- detailed feature comparisons
- evidence requirements
- pricing / market facts
- extended indirect workaround list

### Side panel actions

- Compare against ChatGPT
- Compare against Notion
- Compare against Figma / FigJam
- Add another alternative
- Find deeper unsolved problem
- Generate differentiation thesis
- Send comparison to MVP generator

---

## 13. Stage 8 — Differentiation Thesis

### Purpose

Turn comparison into a clear reason the proposed product is better.

### Main card

```text
Differentiation Thesis

SpecForge is not an idea generator.
It is a causal product decision system that helps users identify the deepest problem, compare against alternatives, and choose a build path with confidence.
```

### Supporting card

```text
Deeper Problem Not Solved by Alternatives

Existing tools help users generate or organize ideas, but they do not consistently model user, problem causes, desired results, alternative gaps, and build priorities as one causal decision system.
```

### Analogy card

```text
Useful Analogy

Figma for causal product reasoning.

What transfers:
Visual canvas, editable objects, spatial thinking.

What does not transfer:
Pure design-file editing.

Product insight:
The board should represent causal relationships and build decisions, not just notes.
```

### Side panel actions

- Generate stronger positioning
- Compare analogy options
- Mark analogy as useful / misleading
- Generate App Store-style product description
- Update MVP implications

---

## 14. Stage 9 — Divergence Zone

### Purpose

Generate solution families from the first-principles need and differentiation thesis.

### Cards

```text
Solution Family 1
Problem Modeling

Attacks:
Weak problem model.

Possible modules:
Problem Layering Whiteboard
Cause Tree Generator
Root Constraint Finder
```

```text
Solution Family 2
Decision Support

Attacks:
Inability to choose.

Possible modules:
MVP Variation Generator
Value Matrix
Recommendation Explainer
```

```text
Solution Family 3
Representation

Attacks:
Messy unstructured thinking.

Possible modules:
Knowledge Graph Whiteboard
Cause-to-Feature Map
Assumption Graph
```

```text
Solution Family 4
Differentiation / Positioning

Attacks:
Weak proof of superiority.

Possible modules:
Alternative Comparison
Analogy Mapper
Positioning Generator
```

```text
Solution Family 5
Execution

Attacks:
Gap between decision and build.

Possible modules:
Feature Mechanism Generator
Technical Spec Exporter
Claude Code Prompt
```

---

## 15. Stage 10 — MVP Variation Cards

### Purpose

Show only the top MVP options.

### Rule

Show **3 MVPs by default**. Put all others in the side panel.

### Example MVP cards

```text
MVP A
Problem Layering Whiteboard

Core value:
Helps users decompose user, problem, causes, and desired result before generating solutions.

Root cause attacked:
Weak problem model + no decision architecture.

Build difficulty:
Medium

Why it matters:
It improves every downstream output.
```

```text
MVP B
Value-Ranked MVP Generator

Core value:
Creates multiple MVP paths and ranks them by value, buildability, differentiation, and risk.

Root cause attacked:
No comparison criteria.

Build difficulty:
Medium-low
```

```text
MVP C
Differentiation Intelligence Board

Core value:
Compares proposed products against existing alternatives and analogical examples to clarify why the product is better.

Root cause attacked:
Weak differentiation and unclear superiority over existing tools.

Build difficulty:
Medium
```

### MVP card actions

- Compare
- Merge
- Select
- Re-rank
- Show baseline advantage
- Turn into roadmap

---

## 16. Stage 11 — Recommendation

### Purpose

Give the user a decision.

### Final card

```text
Recommended First Build

Problem Layering Whiteboard + Differentiation Intelligence Module

Why:
The Problem Layering Whiteboard attacks the earliest root constraint.
The Differentiation Intelligence Module proves why the product is meaningfully better than alternatives before MVP generation.

Next:
Build the causal decomposition workflow and alternative comparison layer before full graph visualization or tech-spec export.
```

---

## 17. Prompt Engineering Checkpoints on the Board

Do not show every internal prompt.

Instead, show small prompt checkpoint badges on major transformation cards:

- Prompt Power-Up Analyzer
- Problem Cause Tree
- Convergence Engine
- Differentiation Intelligence Engine
- Divergence Engine
- Evaluation Engine

Clicking a badge opens the side panel.

### Example checkpoint panel

```text
Prompt Checkpoint:
Differentiation Intelligence Engine

Purpose:
Compare the proposed product against alternatives and analogical products.

Optimized for:
Deeper-problem comparison, positioning clarity, baseline advantage, and MVP implications.

Quality gate:
Reject if comparison is only feature-level or if superiority is claimed without explaining the deeper problem solved.
```

---

## 18. Side Panel Behavior

The side panel should change based on the selected node.

### If user selects a cause node

Show:

```text
Selected Cause:
Criteria Failure

Meaning:
The user has no explicit criteria for comparing MVPs or features.

Why it matters:
Without criteria, all ideas feel equally possible.

Downstream effects:
- weak MVP ranking
- feature overload
- low decision confidence

Actions:
Go deeper
Generate alternative causes
Connect to user
Connect to desired result
Turn into solution family
```

### If user selects root constraint

Show:

```text
Root Constraint:
No causal decision system for converting vague ideas into value-ranked build priorities.

Why this is deeper:
It explains scattered brainstorming, weak feature ranking, generic AI output, and low confidence.

Actions:
Challenge this
Generate alternative root constraints
Show evidence needed
Diverge into solution families
```

### If user selects alternative comparison

Show:

```text
Alternative Comparison

Current alternatives:
ChatGPT, Notion AI, FigJam, templates, mentors.

What they solve:
Idea generation, writing, organization, visual brainstorming, feedback.

What they do not solve deeply:
Causal decision confidence.

Actions:
Compare another alternative
Generate deeper gap
Create differentiation thesis
Find misleading analogies
Send implications to MVP generator
```

### If user selects analogy card

Show:

```text
Analogy:
Figma for causal product reasoning.

What transfers:
Visual canvas, editable cards, spatial thinking.

What does not transfer:
Pure design editing.

Actions:
Generate more analogies
Mark as useful
Mark as misleading
Turn into positioning statement
```

---

## 19. Main Interaction Loop

The product interaction loop should be:

```text
Click node
↓
Inspect meaning
↓
Brainstorm alternatives
↓
Select stronger version
↓
Update graph
↓
Recalculate downstream cards
↓
Update recommendation
```

Example:

1. User clicks **Differentiation Thesis**.
2. User asks: “Make this stronger against ChatGPT.”
3. Agent generates stronger thesis options.
4. User selects one.
5. MVP ranking updates.
6. Recommendation updates.
7. Activity trace records the change.

---

## 20. Knowledge Graph Visibility

The default whiteboard should not show the full knowledge graph.

Instead, show a compact graph summary strip:

```text
Graph Summary

Core nodes:
Target User → Root Problem → Root Constraint → Alternative Gap → Differentiation Thesis → MVP Direction
```

Clicking opens Graph View.

### Graph View should show

- user nodes
- problem cause nodes
- desired result nodes
- alternative nodes
- alternative gap nodes
- differentiation thesis nodes
- solution family nodes
- MVP nodes
- feature mechanism nodes

### Edge types

- causes
- blocks
- explains
- differentiates_from
- outperforms_on
- attacks_cause
- enables_result
- prepares_for

---

## 21. Visual Design Rules

The UI should feel:

- Apple-tier
- Notion-structured
- ChatGPT-minimal
- Vision Pro-soft
- App Store-polished

### Board rules

- show fewer nodes, better chosen
- use left-to-right and converge-diverge flow
- keep text short on cards
- move detail into side panel
- make decision nodes interactive
- show sequence clearly
- use soft depth and restrained color

### Color semantics

- Input / prompt = soft blue
- Target user = mint
- Problem causes = coral / rose
- Desired result = violet
- Convergence = deep neutral / graphite
- Alternatives = amber
- Differentiation = indigo
- MVPs = warm gold
- Recommendation = green

---

## 22. Final Default Board Content

The final default board should contain:

```text
Raw Idea
Clean Summary
Target User Model
Problem Cause Tree
Desired Result Stack
Root Constraint
First-Principles Need
Alternative Comparison
Differentiation Thesis
Solution Families
Top 3 MVP Variations
Recommended First Build
```

Everything else should be inspectable, not always visible.

---

## 23. Final Product UI Thesis

The whiteboard should show:

> The reasoning objects the user must decide on.

The side panel should show:

> The details, alternatives, comparisons, and brainstorm actions needed to refine those decisions.

The graph should show:

> How user, problem, cause, result, alternative gap, differentiation, MVP, and feature mechanisms connect.

The final result should feel like:

> A calm, premium causal product decision workspace that helps the user move from vague idea to differentiated build path.
