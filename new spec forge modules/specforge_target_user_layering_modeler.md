# SpecForge — Target User Layering Modeler

## 1. Purpose

The **Target User Layering Modeler** is the SpecForge module that transforms a vague target user into a layered, behaviorally useful, decision-relevant user model.

It prevents SpecForge from generating solutions for a generic persona.

The module answers:

> Who is the product really for, what variables shape their problem, what constraints define their behavior, and how does this user model change the problem model, desired result, MVP direction, feature priorities, and evaluation criteria?

This module must run before deep problem modeling, MVP generation, feature generation, and final evaluation.

---

## 2. Core Thesis

A target user is not a flat label.

Weak version:

```text
Target user: founders
```

Strong version:

```text
Target user:
Early-stage solo technical founders with many app ideas, limited product judgment, limited time, strong ambition to ship, and high anxiety about building the wrong thing.

Core user need:
A structured decision system that turns vague product thinking into a confident next build action.
```

SpecForge must model the target user as a system of variables, not as a demographic category.

---

## 3. Position in SpecForge Pipeline

The Target User Layering Modeler runs after Prompt Power-Up and Depth Selection, and before Multifactor Problem Causal Modeling.

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
Desired Result Layering
↓
Cross-Analysis
↓
Convergence
↓
Differentiation Intelligence
↓
Solution Families
↓
MVP App Directions
↓
Feature Cards
```

Why it comes early:

- Different users experience different root problems.
- Different users value different results.
- Different users change what an MVP should be.
- Different users change which features are worth building.
- Different users change willingness to pay, urgency, and retention potential.

---

## 4. Main Output

The module outputs a **Target User Model** with layered structure:

```text
User Category
↓
Primary Segment
↓
Subsegments
↓
Context
↓
Behavior Pattern
↓
Motivations
↓
Constraints
↓
Decision Triggers
↓
Current Workarounds
↓
Emotional State
↓
Urgency / Willingness
↓
Adjacent Interests / Consumer Behavior
↓
Core Need
↓
Product Implications
```

---

## 5. Target User Layer Definitions

### 5.1 User Category

Broad class of person or organization.

Examples:

```text
Founder / builder
Student
Product manager
Creator
Small business owner
Social media user
Researcher
Developer
```

Use this only as the starting point. Do not stop here.

---

### 5.2 Primary Segment

The most important first user segment.

A strong segment includes:

- role
- current situation
- pain intensity
- urgency
- behavior pattern
- decision context

Example:

```text
Solo technical founder with a vague app idea who wants to prototype quickly but lacks confidence in which MVP direction to choose.
```

---

### 5.3 Subsegments

Variants inside the primary segment.

Example for SpecForge:

```text
- solo founder with technical skills but weak product judgment
- student builder creating portfolio projects
- indie hacker trying to ship quickly
- product manager exploring internal tools
- nontechnical founder trying to brief a developer
```

Each subsegment should be evaluated separately because it may imply a different MVP.

---

### 5.4 Context

The situation in which the problem appears.

Ask:

```text
When does this user experience the problem?
What are they trying to do?
What time pressure exists?
What information do they have?
What decision do they need to make?
What tools are they currently using?
```

Example:

```text
The user has an app idea, multiple possible directions, and wants to quickly decide what to prototype before spending time building.
```

---

### 5.5 Behavior Pattern

What the user actually does today.

Examples:

```text
- asks ChatGPT repeatedly
- creates scattered notes
- opens Figma/FigJam and maps ideas loosely
- asks mentors or friends
- jumps into coding too early
- switches between product directions
- overbuilds before validating
- abandons ideas when uncertainty rises
```

Behavior matters more than self-reported intention.

---

### 5.6 Motivations

Why the user cares.

Types:

```text
Functional motivation:
I want a buildable product direction.

Emotional motivation:
I want confidence and reduced overwhelm.

Social motivation:
I want to appear competent, ambitious, original, or impressive.

Economic motivation:
I want to build something valuable, fundable, monetizable, or career-relevant.

Identity motivation:
I want to become the kind of person who builds serious products.
```

---

### 5.7 Constraints

What limits the user.

Examples:

```text
- limited time
- limited technical skill
- limited product judgment
- limited money
- limited user research access
- too many competing ideas
- fear of wasting effort
- low confidence in decision-making
- uncertainty about market alternatives
- unclear distribution path
```

Constraints are essential because they narrow the solution.

---

### 5.8 Decision Triggers

What causes the user to seek help now.

Examples:

```text
- has to decide what to build this week
- wants to start coding
- wants to apply to a program
- wants to impress a mentor/investor
- wants to choose between several ideas
- realizes ChatGPT output is too generic
- feels overwhelmed by possibilities
```

High-quality MVPs should attach to real decision triggers.

---

### 5.9 Current Workarounds

What the user does instead.

Examples:

```text
- ChatGPT brainstorming
- Notion planning
- Figma / FigJam whiteboarding
- Miro boards
- mentor feedback
- YC templates
- manual product docs
- coding first and fixing later
```

Current workarounds become comparison targets for Differentiation Intelligence.

---

### 5.10 Emotional State

What the user feels during the problem.

Examples:

```text
- excited but scattered
- ambitious but uncertain
- overwhelmed by options
- afraid of building the wrong thing
- embarrassed that the idea is vague
- impatient to start building
- frustrated by generic AI advice
```

Emotional state affects interface, tone, and output design.

---

### 5.11 Urgency / Willingness

How strong the need is.

Score:

```text
Urgency: 1–10
Willingness to use: 1–10
Willingness to pay: 1–10
Likelihood of repeat use: 1–10
```

The model should explain the score.

Example:

```text
Urgency: 8/10
Reason: The user is actively deciding what to prototype, so the problem blocks immediate action.
```

---

### 5.12 Adjacent Interests / Consumer Behavior

What else the user likely engages with.

This helps identify distribution, positioning, analogies, and feature expectations.

Examples for SpecForge users:

```text
- AI tools
- coding agents
- startup advice
- productivity systems
- Notion templates
- Figma/FigJam
- YC content
- indie hacker communities
- product management frameworks
- personal knowledge management
```

This is not decorative. It affects product positioning and onboarding.

---

### 5.13 Core Need

The deepest need that explains why the user wants this product.

Example:

```text
Structured confidence:
enough causal clarity to choose the next build action.
```

This should connect directly to the root constraint and desired result.

---

### 5.14 Product Implications

How the target user model changes product decisions.

Examples:

```text
If the first user is a solo founder:
- prioritize decision confidence and MVP selection
- generate buildable specs after causal modeling
- emphasize speed, leverage, and differentiation

If the first user is a student:
- emphasize learning, guidance, portfolio value, and step-by-step explanation

If the first user is a product manager:
- emphasize stakeholder-ready rationale, market logic, and defensible prioritization
```

---

## 6. User Variant Modeling

The system should generate multiple user variants and evaluate them.

### Required Variants

For every product idea, generate at least:

```text
1. highest-pain user
2. highest-willingness-to-pay user
3. easiest-to-reach user
4. fastest-to-serve MVP user
5. most strategically valuable user
```

These may be the same person, but often they are different.

---

## 7. User Variant Evaluation Criteria

Each variant should be scored by:

```text
Pain intensity
Problem frequency
Urgency
Current workaround weakness
Willingness to use
Willingness to pay
Reachability
Retention potential
Differentiation opportunity
Fit with macro objective
Fit with root constraint
Buildability for first MVP
```

---

## 8. User Variant Output Example

```json
{
  "variant_name": "Solo technical founder",
  "pain_intensity": 9,
  "urgency": 8,
  "willingness_to_use": 9,
  "willingness_to_pay": 6,
  "reachability": 8,
  "retention_potential": 7,
  "current_workarounds": ["ChatGPT", "Notion", "Figma", "mentor feedback"],
  "main_constraint": "Cannot confidently choose the right MVP direction",
  "core_need": "Structured confidence to choose what to build next",
  "mvp_implications": [
    "Prioritize problem causal modeling",
    "Prioritize MVP direction ranking",
    "Delay heavy collaboration features"
  ]
}
```

---

## 9. Target User Quality Gates

The Target User Model fails if:

```text
- the user is too broad
- no behavior pattern is defined
- no current workaround is identified
- no urgency is explained
- no constraints are modeled
- no emotional state is captured
- no user variants are compared
- no product implications are produced
- no connection is made to problem modeling
```

If it fails, the system must run a repair prompt.

---

## 10. Repair Prompt

```text
You are the Target User Quality Critic.

Review the target user model.

Reject or repair it if:
- the user is too broad
- behavior is missing
- constraints are missing
- current workaround is missing
- urgency is unsupported
- emotional state is missing
- no user variants are compared
- no product implications are produced
- it does not affect the problem model or MVP direction

Return:
{
  "pass_or_fail": "",
  "issues": [],
  "repaired_target_user_model": {},
  "confidence_after_repair": ""
}
```

---

## 11. Prompt for Target User Layering Modeler

```text
You are the Target User Layering Modeler for SpecForge.

Your job is to transform a vague target user into a layered, behaviorally useful model that can guide problem modeling, desired result modeling, MVP selection, feature generation, differentiation, and evaluation.

Do not stop at demographics or broad labels.

Analyze:
1. user category
2. primary segment
3. subsegments
4. context
5. behavior patterns
6. motivations
7. constraints
8. decision triggers
9. current workarounds
10. emotional state
11. urgency and willingness
12. adjacent interests / consumer behavior
13. core need
14. product implications

Generate multiple user variants:
- highest-pain user
- highest-willingness-to-pay user
- easiest-to-reach user
- fastest-to-serve MVP user
- most strategically valuable user

Evaluate each variant by:
- pain intensity
- frequency
- urgency
- workaround weakness
- willingness to use
- willingness to pay
- reachability
- retention potential
- differentiation opportunity
- fit with macro objective
- fit with root constraint
- buildability for first MVP

Return structured JSON:
{
  "user_category": "",
  "primary_segment": "",
  "subsegments": [],
  "context": "",
  "behavior_patterns": [],
  "motivations": [],
  "constraints": [],
  "decision_triggers": [],
  "current_workarounds": [],
  "emotional_state": "",
  "urgency": {
    "score": 0,
    "reason": ""
  },
  "willingness": {
    "use_score": 0,
    "pay_score": 0,
    "reason": ""
  },
  "adjacent_interests": [],
  "core_need": "",
  "user_variants": [],
  "variant_scores": [],
  "recommended_primary_user": "",
  "why_this_user": "",
  "product_implications": [],
  "constraints_passed_down": []
}

Rules:
- Separate explicit information from inferred information.
- Mark uncertainty.
- Do not generate features yet.
- Explain how user choice changes the problem model and MVP direction.
```

---

## 12. Constraints Passed Down

The Target User Model should produce constraints for later modules.

Examples:

```text
Target user constraint:
First product must serve users actively trying to decide what to build, not passive brainstormers.

Behavior constraint:
The workflow must reduce scattered prompting and repeated re-explanation.

Emotional constraint:
The output must create confidence without overwhelming the user.

Workaround constraint:
The product must be meaningfully better than ChatGPT + Notion + whiteboard planning.

Buildability constraint:
The first MVP should focus on one high-urgency user segment.
```

These constraints feed into:

```text
Problem Causal Modeling
Desired Result Layering
Differentiation Intelligence
MVP App Direction Generator
Feature Card System
Evaluation Lab
```

---

## 13. Whiteboard Visualization

### Default Card

```text
Target User Model

Primary user:
[recommended primary segment]

Core need:
[deepest user need]

Current workaround:
[current workaround]

Decision trigger:
[why now]

Urgency:
[score]
```

### Expanded Card

```text
User category
Segment
Context
Behavior
Motivation
Constraint
Decision trigger
Current workaround
Emotional state
Core need
Product implications
```

### Side Panel

Shows:

```text
User variants
Variant scores
Why this user was selected
What this user changes downstream
Assumptions
Uncertainty
Brainstorm actions
```

### Side Panel Actions

```text
Brainstorm more segments
Compare user variants
Make this user more specific
Find highest-pain user
Find easiest-to-reach user
Find highest-paying user
Change primary user
Show how this changes the problem model
Show how this changes the MVP direction
```

---

## 14. Graph Updates

The Target User Modeler creates graph nodes:

```text
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
Product Implication
```

It creates edges:

```text
experiences
constrained_by
motivated_by
uses_workaround
triggered_by
needs
implies
changes_mvp_direction
passes_constraint_to
```

---

## 15. Interweaving with Other Modules

### With Multifactor Causal Modeling

Target user variables determine:

```text
which causes matter
which feedback loops apply
which contradictions are strongest
which root constraints are plausible
```

### With Desired Result Layering

Target user motivations determine:

```text
which outcomes matter most
which emotional results matter
which measurable results are useful
```

### With Differentiation Intelligence

Current workarounds determine:

```text
which alternatives must be compared
what the product must beat
what analogies help positioning
```

### With MVP App Direction Generator

User urgency and constraints determine:

```text
which MVP app direction is viable first
which version is overbuilt
which version creates fastest value
```

### With Feature Card System

Target user behavior determines:

```text
which features are necessary
which mechanisms reduce friction
which data points are acceptable
which interface should be shown first
```

---

## 16. Evaluation Lab Integration

The Evaluation Lab should use the Target User Model to score:

```text
target user fit
urgency
workaround weakness
willingness to use
willingness to pay
behavior-change potential
retention potential
MVP fit
```

No MVP app direction should win if it does not strongly serve the selected primary user.

---

## 17. Minimum Implementation Requirements

For the first implementation, Target User Layering must generate:

```text
1. primary user segment
2. at least 3 user variants
3. context
4. behavior pattern
5. constraint
6. current workaround
7. decision trigger
8. core need
9. product implications
10. constraints passed downstream
```

Do not implement full user research automation yet.

---

## 18. Acceptance Criteria

The module is complete when:

```text
- a vague target user becomes a specific primary segment
- at least 3 user variants are evaluated
- the selected user is justified
- the selected user changes the problem model
- constraints are passed downstream
- the user card is visible and interactive on the whiteboard
- the side panel allows comparison and refinement
- shallow user models trigger repair
```

---

## 19. Final Instruction

The Target User Layering Modeler exists to prevent SpecForge from building for a generic imaginary user.

It should force the system to ask:

```text
Who feels this problem most painfully?
Who needs this now?
Who has weak current alternatives?
Who will change behavior?
Who makes the first MVP strongest?
```

The selected target user becomes a constraint on everything downstream.
