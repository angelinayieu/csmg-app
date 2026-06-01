# SpecForge — Multifactor Causal Modeling Engine

## 1. Purpose

This document finalizes the upgraded **Multifactor Causal Modeling Engine** for SpecForge.

The goal is to replace shallow “problem cause trees” with a sophisticated causal modeling system that can:

1. identify non-obvious problem dynamics,
2. model multiple interacting causes,
3. expose feedback loops and contradictions,
4. generate root-constraint candidates,
5. score leverage points,
6. convert causal insight into constraints,
7. use those constraints to pressure the creation of innovative, polished solutions.

This engine is the core of SpecForge’s ability to produce better product decisions.

SpecForge should not merely answer:

```text
What is the user's problem?
```

It should answer:

```text
Which interacting causal variables create this problem, which loops reinforce it, which contradictions make it hard to solve, which root constraint explains the most downstream symptoms, and which intervention would produce the highest-leverage product solution?
```

---

## 2. Why the Old Problem Cause Tree Is Not Enough

A simple problem cause tree usually looks like this:

```text
Surface Problem
↓
Immediate Cause
↓
Deeper Cause
↓
Root Cause
```

This is useful for basic reasoning, but it is not enough for SpecForge because it often produces:

- obvious inferences,
- linear cause chains,
- generic root causes,
- weak solution constraints,
- shallow feature ideas,
- little differentiation from normal AI brainstorming.

SpecForge needs to model the problem as a **system**, not a sentence.

A stronger causal model should include:

- causal variables,
- stakeholder variants,
- behavioral mechanisms,
- social / economic / technical incentives,
- reinforcing loops,
- balancing loops,
- contradictions,
- worldview assumptions,
- counterfactuals,
- root-constraint candidates,
- leverage-point rankings,
- evidence confidence,
- solution implications.

Causal-loop diagramming is relevant because it models variables, causal links, link signs, and feedback loops rather than only linear causes. Systems mapping helps expose the structural forces that produce persistent problems. Sources: The Systems Thinker on causal-loop construction; Cascade Institute Causal Loop Diagrams Handbook.

---

## 3. Final Module Name

Use this module name:

```text
Problem Causal Modeling Engine
```

The old name, `Problem Cause Tree Modeler`, can remain as a visible board view, but the internal reasoning engine should be upgraded.

### Relationship between the two

```text
Problem Causal Modeling Engine = full reasoning system
Problem Cause Tree = simplified visible spine extracted from the causal model
```

The cause tree becomes one view, not the entire model.

---

## 4. Core Thesis

The engine should operate on this thesis:

```text
World-class product solutions come from identifying the highest-leverage causal constraint, not from brainstorming features around surface problems.
```

The system should move through this transformation:

```text
Surface phenomenon
↓
Causal variables
↓
Causal links
↓
Feedback loops
↓
Contradictions
↓
System incentives
↓
Root-constraint candidates
↓
First-principles need
↓
Leverage points
↓
Solution constraints
↓
Mechanism candidates
↓
Polished solution families
```

---

## 5. Multifactor Causal Modeling Stack

The engine should generate the following layers.

---

## 5.1 Phenomenon Layer

### Purpose

Capture what is visibly happening before explaining it.

### Questions

```text
What behavior is observable?
What is the user saying?
What is the user doing?
What is the user avoiding?
What pattern repeats?
What symptom is most visible?
```

### Output

```json
{
  "phenomenon_statement": "",
  "observable_behaviors": [],
  "symptoms": [],
  "initial_problem_frame": ""
}
```

### Example

```text
Users want to share real moments online but feel pressure, overthink posts, compare themselves, and often retreat into lurking.
```

---

## 5.2 Actor / Stakeholder Variant Layer

### Purpose

Model how the problem differs across user variants and stakeholders.

A problem is rarely the same for all users. The same surface problem may have different causes for casual users, creators, lurkers, teams, buyers, operators, or platforms.

### Questions

```text
Which user types experience this problem?
Which user type feels it most intensely?
Which user benefits from the current system?
Which stakeholder resists change?
Which user has urgency?
Which user would pay, use, return, or switch?
```

### Output

```json
{
  "stakeholder_variants": [
    {
      "name": "",
      "role_in_system": "",
      "problem_experience": "",
      "motivation": "",
      "constraint": "",
      "current_workaround": "",
      "urgency": "low | medium | high",
      "solution_implication": ""
    }
  ]
}
```

### Example

```text
Casual users want to share but avoid judgment.
Creators want expression and reach but feel forced into performance.
Lurkers want connection without exposure.
Platforms want engagement, retention, and monetizable activity.
```

---

## 5.3 Variable Layer

### Purpose

Break the problem into variables that can move, increase, decrease, interact, or be changed by product mechanisms.

### Variable categories

The engine should look for variables across:

```text
behavioral variables
emotional variables
social variables
economic variables
technical variables
interface variables
data variables
incentive variables
cultural variables
trust variables
friction variables
feedback variables
```

### Questions

```text
What variables influence the problem?
Which variables are upstream?
Which variables are downstream symptoms?
Which variables are user-controlled?
Which variables are platform-controlled?
Which variables are measurable?
Which variables can software affect?
```

### Output

```json
{
  "variables": [
    {
      "name": "",
      "category": "behavioral | emotional | social | economic | technical | interface | data | incentive | cultural | trust | friction | feedback",
      "definition": "",
      "directionality": "increases | decreases | varies | unknown",
      "controllability": "user | platform | environment | mixed",
      "measurability": "low | medium | high",
      "software_solvability": "low | medium | high",
      "notes": ""
    }
  ]
}
```

### Example variables

```text
posting friction
audience ambiguity
metric visibility
social comparison intensity
fear of judgment
self-presentation effort
algorithmic exposure uncertainty
feedback volatility
authenticity confidence
emotional safety
felt social aliveness
return motivation
passive consumption
posting frequency
```

---

## 5.4 Causal Link Layer

### Purpose

Define how variables influence each other.

A variable list is not enough. The system must model directional influence.

### Questions

```text
If this variable increases, what changes?
If this variable decreases, what changes?
What does this variable cause downstream?
What causes this variable upstream?
Which links are strong, weak, or uncertain?
Which links are assumptions?
```

### Output

```json
{
  "causal_links": [
    {
      "source_variable": "",
      "target_variable": "",
      "relationship": "increases | decreases | amplifies | reduces | enables | blocks | destabilizes",
      "strength": "low | medium | high",
      "confidence": 0,
      "assumption": true,
      "evidence_needed": ""
    }
  ]
}
```

### Example

```text
Public metric visibility → increases social comparison intensity.
Social comparison intensity → increases self-presentation effort.
Self-presentation effort → increases posting friction.
Posting friction → decreases authentic posting frequency.
```

---

## 5.5 Feedback Loop Layer

### Purpose

Identify reinforcing and balancing loops that sustain the problem.

Feedback loops are critical because many product problems persist not from one cause, but because the system reinforces itself.

### Loop types

```text
Reinforcing loop:
A loop that amplifies behavior over time.

Balancing loop:
A loop that stabilizes, limits, or counteracts behavior.
```

### Questions

```text
Which variables form a loop?
What reinforces the problem?
What stabilizes the problem?
What tradeoff appears when we reduce one variable?
Which loops create addiction, avoidance, escalation, or decay?
Which loops should the product break, soften, or redirect?
```

### Output

```json
{
  "feedback_loops": [
    {
      "loop_name": "",
      "loop_type": "reinforcing | balancing",
      "loop_sequence": [],
      "behavior_over_time": "",
      "problem_effect": "",
      "intervention_implication": ""
    }
  ]
}
```

### Example loops

#### Performance Standard Escalation Loop

```text
Public metrics
→ social comparison
→ pressure to optimize posts
→ more polished content
→ higher perceived posting standard
→ more social comparison
```

#### Lurking Confidence Decay Loop

```text
Posting anxiety
→ less posting
→ less positive feedback
→ lower confidence
→ more posting anxiety
```

#### Safety-Aliveness Tradeoff Loop

```text
Smaller audience
→ lower social risk
→ more posting comfort
→ lower reach / aliveness
→ lower motivation to post
```

---

## 5.6 Contradiction Layer

### Purpose

Identify tensions where solving one need worsens another.

Innovative solutions often emerge from resolving contradictions, not from optimizing one variable in isolation.

### Questions

```text
What does the user want that conflicts with another thing they want?
What does the product need to increase without increasing the negative side effect?
What existing solution solves one side but worsens another?
What contradiction explains why current alternatives are insufficient?
```

### Output

```json
{
  "contradictions": [
    {
      "contradiction": "",
      "side_a": "",
      "side_b": "",
      "why_it_matters": "",
      "current_solution_failure": "",
      "resolution_principle": ""
    }
  ]
}
```

### Example contradictions

```text
Users want to be seen, but not scored.
Users want feedback, but not judgment.
Users want audience, but not exposure.
Users want authenticity, but not vulnerability cost.
Users want social aliveness, but not addictive pressure.
Users want lightweight posting, but still meaningful response.
```

---

## 5.7 Incentive Layer

### Purpose

Understand what keeps the current system in place.

Many existing products fail to solve deeper problems because their incentives reward the current behavior.

### Questions

```text
Who benefits from the current system?
What does the platform optimize for?
What business model reinforces the problem?
Which metrics are rewarded?
Which user behaviors are encouraged?
What incentives conflict with the user's deeper need?
```

### Output

```json
{
  "system_incentives": [
    {
      "incentive": "",
      "beneficiary": "",
      "behavior_encouraged": "",
      "problem_reinforced": "",
      "solution_constraint": ""
    }
  ]
}
```

### Example

```text
Visible metrics increase return checking.
Return checking increases session frequency.
Session frequency increases monetizable attention.
Engagement ranking rewards high-reaction content.
High-reaction content raises performance standards.
```

---

## 5.8 Representation Layer

### Purpose

Identify how the current system represents value and how that representation shapes behavior.

Product interfaces do not merely display information. They define what counts.

### Questions

```text
What does the current system make visible?
What does it hide?
What does it count?
What does it rank?
What does it reward?
What does the user learn to optimize for?
What should the new product represent instead?
```

### Output

```json
{
  "current_value_representations": [],
  "behavior_created_by_current_representation": [],
  "alternative_value_representations": [],
  "solution_implications": []
}
```

### Example

Current platforms represent value through:

```text
likes
comments
views
followers
shares
public reactions
ranking
algorithmic reach
```

A deeper product could represent value through:

```text
warmth
resonance
presence
contextual response
continuity
small-group memory
mutuality
felt connection
```

---

## 5.9 Worldview / Narrative Layer

### Purpose

Model the deeper belief system or metaphor that makes the current problem feel normal.

This layer helps produce less obvious product theses.

### Questions

```text
What worldview does the current system assume?
What metaphor shapes the user behavior?
What cultural story reinforces the problem?
What would a different worldview imply for product design?
```

### Output

```json
{
  "dominant_worldview": "",
  "underlying_metaphors": [],
  "cultural_assumptions": [],
  "alternative_worldviews": [],
  "product_thesis_implications": []
}
```

### Example

```text
Dominant worldview:
Social value is proven by visibility and reaction.

Metaphor:
Life as a stage; identity as performance; popularity as proof of value.

Alternative worldview:
Social sharing as presence, resonance, and continuity.
```

---

## 5.10 Counterfactual Layer

### Purpose

Generate alternative worlds where the problem disappears or weakens.

Counterfactuals help produce non-obvious solution principles.

### Questions

```text
What would need to be true for the problem to disappear?
What variable would need to change?
What mechanism would make this easier?
What alternative environment would reduce the problem?
What existing assumption would no longer hold?
```

### Output

```json
{
  "counterfactuals": [
    {
      "counterfactual_world": "",
      "changed_variable": "",
      "why_problem_reduces": "",
      "solution_principle": "",
      "risk": ""
    }
  ]
}
```

### Example

```text
If users knew exactly who they were sharing with, audience ambiguity would decrease.
If feedback were qualitative rather than quantified, comparison would decrease.
If posts were routed by context instead of popularity, performance pressure would decrease.
If social value were represented as resonance, users would not need public score validation.
```

---

## 5.11 Root Constraint Tournament

### Purpose

Prevent the system from selecting the first obvious root cause.

The engine should generate multiple root-constraint candidates, score them, reject weak ones, and synthesize the strongest.

### Questions

```text
Which root constraint explains the most symptoms?
Which is most upstream?
Which is most software-solvable?
Which is differentiated?
Which creates the best solution families?
Which has the highest confidence?
Which is too vague or too broad?
```

### Output

```json
{
  "root_constraint_candidates": [
    {
      "candidate": "",
      "explains_symptoms_score": 0,
      "upstream_leverage_score": 0,
      "software_solvability_score": 0,
      "differentiation_score": 0,
      "solution_generation_score": 0,
      "confidence_score": 0,
      "risk": "",
      "verdict": "keep | reject | merge"
    }
  ],
  "selected_root_constraint": "",
  "why_selected": "",
  "rejected_candidates": []
}
```

### Example candidates

```text
Candidate A:
The product environment turns expression into measurable status.

Candidate B:
Audience ambiguity makes users unable to calibrate vulnerability.

Candidate C:
Feedback systems optimize for engagement intensity rather than emotional safety.

Candidate D:
Current social products collapse multiple social contexts into one public performance surface.

Candidate E:
Users lack a low-friction way to receive response without entering comparison loops.
```

### Example selected root constraint

```text
Current social platforms make expression feel like public performance by combining audience ambiguity, visible metrics, and engagement-optimized feedback.
```

---

## 5.12 First-Principles Need Layer

### Purpose

Distill the selected root constraint into the deepest user need that product design should serve.

### Questions

```text
What does the user fundamentally need once the system noise is stripped away?
What need explains the desired result?
What need generates solution families?
What need is deeper than the surface problem?
```

### Output

```json
{
  "first_principles_need_candidates": [],
  "selected_first_principles_need": "",
  "why_selected": "",
  "solution_implications": []
}
```

### Example

```text
Users need social presence without social scoring.
```

---

## 5.13 Leverage Point Ranking

### Purpose

Identify where to intervene for maximum downstream effect.

### Questions

```text
Which intervention point changes the most downstream variables?
Which point is upstream enough to matter?
Which point is buildable?
Which point differentiates the product?
Which point avoids creating new problems?
```

### Output

```json
{
  "leverage_points": [
    {
      "name": "",
      "root_constraint_addressed": "",
      "variables_changed": [],
      "downstream_effects": [],
      "buildability": 0,
      "differentiation": 0,
      "risk": 0,
      "overall_score": 0
    }
  ],
  "recommended_leverage_point": ""
}
```

### Example leverage points

```text
feedback representation
audience boundary
distribution mechanism
response pacing
social context framing
posting composer design
memory / continuity system
```

---

## 6. Required Quality Gate

The Problem Causal Modeling Engine fails if it does not produce enough depth.

### Minimum requirements

```text
At least 12 causal variables
At least 3 stakeholder / user variants
At least 8 directional causal links
At least 3 reinforcing loops
At least 1 balancing loop
At least 3 contradictions
At least 3 system incentives
At least 2 representation insights
At least 1 worldview / metaphor layer
At least 5 counterfactuals
At least 5 root-constraint candidates
At least 5 leverage points
At least 1 first-principles need
At least 1 evidence-needed section
```

### Reject output if

```text
It is mostly linear.
It only states common-sense causes.
It selects the first root cause without alternatives.
It lacks feedback loops.
It lacks contradictions.
It lacks stakeholder variants.
It does not explain what current systems incentivize.
It does not identify representation-level causes.
It cannot generate solution constraints.
It cannot generate differentiated solution families.
```

---

## 7. How the Causal Model Creates Solution Constraints

The main purpose of this engine is not only to understand the problem. It is to create constraints that pressure better solutions.

### Constraint types

```text
Root constraint
First-principles need
Behavioral constraint
Emotional constraint
Social constraint
Incentive constraint
Representation constraint
Mechanism constraint
Data constraint
Differentiation constraint
Buildability constraint
Risk constraint
```

### Example constraints for the social app

```text
Root constraint:
Expression currently becomes public performance.

First-principles need:
Users need social presence without social scoring.

Behavioral constraint:
The product must reduce overthinking before posting.

Emotional constraint:
The user must feel seen without feeling judged.

Social constraint:
The audience must feel bounded enough to reduce risk but alive enough to create response.

Incentive constraint:
The system must not reward public attention-maximization as the primary success signal.

Representation constraint:
The interface must avoid turning social value into visible public scores.

Mechanism constraint:
Feedback must be meaningful without being directly rankable.

Data constraint:
Any context data collected must improve feedback routing without making posting feel like a form.

Differentiation constraint:
The product must solve more than private sharing; it must preserve aliveness while reducing scoring.

Buildability constraint:
The first MVP must test the feedback model without requiring a full social network.
```

These constraints narrow solution space and improve innovation quality.

---

## 8. How Constraints Pressure Innovative Solutions

A weak product brainstorm might produce:

```text
Remove likes.
Make posts private.
Create close friends groups.
Add mood tags.
```

The multifactor model pressures stronger solution design:

```text
The solution must:
- reduce public scoring,
- preserve social aliveness,
- reduce audience ambiguity,
- avoid engagement-maximizing incentives,
- offer qualitative feedback,
- make response feel human but not evaluative,
- avoid making posting feel like a form,
- test the mechanism without a full network.
```

This produces more polished solution families:

```text
Small-context soft feedback rooms
Qualitative resonance summaries
Delayed low-intensity response loops
Contextual audience boundaries
Non-ranked social memory
Private warmth signals instead of public scores
```

---

## 9. Solution Evaluation From the Causal Model

Every solution should be evaluated against the constraints created by the causal model.

### Evaluation dimensions

```text
Root constraint alignment
First-principles need alignment
Variables improved
Loops broken or redirected
Contradictions resolved
Incentive fit
Representation shift
User behavior changed
Differentiation strength
Buildability
Risk of new negative loop
Evidence confidence
```

### Solution score formula

```text
Solution Quality Score =
root constraint alignment
+ first-principles need alignment
+ downstream variable improvement
+ contradiction resolution
+ differentiation strength
+ buildability
- complexity
- risk of new negative loop
- evidence uncertainty
```

### Required evaluator questions

```text
Which root constraint does this solution attack?
Which causal variables does it change?
Which feedback loop does it break, soften, or redirect?
Which contradiction does it resolve?
Which existing alternative gap does it exploit?
What new risk or negative loop might it create?
What evidence would validate it?
Why is this more innovative than obvious solutions?
```

---

## 10. Board Visualization

The whiteboard should show the multifactor causal model as a cluster, not only a vertical tree.

### Default visible cluster

```text
Problem Causal Model
├── Phenomenon
├── Key Variables
├── Feedback Loops
├── Contradictions
├── Root Constraint Tournament
├── First-Principles Need
└── Leverage Points
```

### Expanded view

```text
Variables panel
Feedback loops panel
Contradictions panel
Root candidates panel
Leverage ranking panel
Constraints generated panel
```

### Side panel

When a user clicks a causal object, show:

```text
Definition
Why it matters
Upstream causes
Downstream effects
Related variables
Related loops
Related contradictions
Evidence needed
Possible interventions
Actions
```

### Actions

```text
Go deeper
Generate alternative causal hypothesis
Find feedback loop
Find contradiction
Generate counterfactual
Turn into constraint
Turn into solution family
Test assumption
Rank leverage
```

---

## 11. Prompt for the Problem Causal Modeling Engine

Use this prompt as the core engine prompt.

```text
You are the Problem Causal Modeling Engine for SpecForge.

Your job is to model the user's problem as a multifactor causal system, not as a simple list of causes.

Do not stop at obvious explanations.
Do not generate product features yet.
First build a causal model deep enough to create strong solution constraints.

Analyze the problem through these layers:

1. Phenomenon Layer
What is visibly happening?
What behaviors, symptoms, frictions, and repeated patterns appear?

2. Actor / Stakeholder Variant Layer
Who experiences the problem differently?
Who benefits from the current system?
Who has urgency?
Who would resist change?

3. Variable Layer
List behavioral, emotional, social, economic, interface, technical, data, incentive, cultural, trust, friction, and feedback variables.

4. Causal Link Layer
Explain how variables influence each other directionally.
Mark link strength, uncertainty, and assumptions.

5. Feedback Loop Layer
Identify reinforcing and balancing loops that sustain, amplify, stabilize, or counteract the problem.

6. Contradiction Layer
Identify tensions where solving one need worsens another.
Generate resolution principles.

7. Incentive Layer
Identify what current systems reward and why the problem persists.

8. Representation Layer
Identify what the current system makes visible, counts, ranks, hides, and teaches users to optimize for.

9. Worldview / Narrative Layer
Identify the deeper belief, metaphor, or cultural story behind the current system.

10. Counterfactual Layer
Generate counterfactual worlds where the problem disappears or weakens.
Extract solution principles from those counterfactuals.

11. Root Constraint Tournament
Generate at least five root-constraint candidates.
Score and reject weak candidates.
Synthesize the strongest root constraint.

12. First-Principles Need Layer
Distill the root constraint into the deepest user need that can guide solution design.

13. Leverage Point Ranking
Rank intervention points by downstream impact, buildability, differentiation, risk, and evidence confidence.

Return a structured output with:
- phenomenon statement
- stakeholder variants
- causal variables
- causal links
- feedback loops
- contradictions
- system incentives
- representation insights
- worldview / narrative layer
- counterfactuals
- root constraint candidates
- selected root constraint
- first-principles need
- leverage points
- constraints generated for solution design
- evidence needed

Quality rules:
- Include at least 12 variables.
- Include at least 3 stakeholder variants.
- Include at least 8 causal links.
- Include at least 3 reinforcing loops.
- Include at least 1 balancing loop.
- Include at least 3 contradictions.
- Include at least 5 root-constraint candidates.
- Include at least 5 leverage points.
- Reject shallow, obvious, linear explanations.
- Do not generate features until the causal model produces constraints.
```

---

## 12. Output Schema

```json
{
  "phenomenon": {
    "phenomenon_statement": "",
    "observable_behaviors": [],
    "symptoms": [],
    "initial_problem_frame": ""
  },
  "stakeholder_variants": [],
  "variables": [],
  "causal_links": [],
  "feedback_loops": [],
  "contradictions": [],
  "system_incentives": [],
  "representation_layer": {
    "current_value_representations": [],
    "behavior_created_by_current_representation": [],
    "alternative_value_representations": [],
    "solution_implications": []
  },
  "worldview_layer": {
    "dominant_worldview": "",
    "underlying_metaphors": [],
    "cultural_assumptions": [],
    "alternative_worldviews": [],
    "product_thesis_implications": []
  },
  "counterfactuals": [],
  "root_constraint_tournament": {
    "candidates": [],
    "selected_root_constraint": "",
    "why_selected": "",
    "rejected_candidates": []
  },
  "first_principles_need": {
    "candidates": [],
    "selected": "",
    "why_selected": "",
    "solution_implications": []
  },
  "leverage_points": [],
  "solution_constraints": [],
  "evidence_needed": [],
  "quality_gate": {
    "passes": true,
    "depth_score": 0,
    "causal_specificity_score": 0,
    "non_obviousness_score": 0,
    "solution_constraint_strength": 0,
    "issues": []
  }
}
```

---

## 13. Integration With SpecForge Pipeline

The upgraded module should sit here:

```text
Raw Prompt
↓
Prompt Power-Up Analyzer
↓
Target User Layering
↓
Problem Causal Modeling Engine
↓
Desired Result Stack
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
Feature Mechanisms
↓
Evaluation
↓
Spec Export
```

The engine must run before MVP generation and feature generation.

---

## 14. Acceptance Criteria

The module is successful only if it can:

```text
Generate non-obvious causal variables.
Model multiple user / stakeholder variants.
Identify directional causal links.
Detect feedback loops.
Identify contradictions.
Explain system incentives.
Analyze representation-level causes.
Generate counterfactual solution principles.
Run a root constraint tournament.
Distill a first-principles need.
Rank leverage points.
Create constraints that meaningfully narrow solution design.
Improve MVP and feature generation downstream.
```

The module fails if it only generates:

```text
surface-level user problems,
linear 5-why chains,
obvious causes,
generic root constraints,
feature ideas without constraints,
solutions that do not trace back to causal variables.
```

---

## 15. Final Instruction

SpecForge should not ask:

```text
What feature solves this problem?
```

It should ask:

```text
What causal system produces this problem, what constraints does that system impose, and which intervention changes the most important variables with the least destructive tradeoff?
```

That is how SpecForge pressures the creation of innovative, polished solutions.

