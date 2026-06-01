# SpecForge — Evaluation Lab / Narrowing Engine

## 1. Purpose

The Evaluation Lab / Narrowing Engine is the module that prevents SpecForge from becoming a broad brainstorming system.

Its purpose is to consistently convert many possible users, problems, mechanisms, solution families, MVP directions, and features into the strongest justified build path.

The Evaluation Lab does not simply assign scores. It creates the decision logic for what should survive, what should be rejected, what should be repaired, and what should be tested.

SpecForge should use evaluation at every layer:

```text
macro layer
→ micro layer
→ mechanism layer
→ data layer
→ solution family layer
→ MVP app direction layer
→ feature card layer
→ final recommendation layer
```

The final goal is to enforce world-class narrowing:

```text
generate many possibilities
→ evaluate by explicit criteria
→ reject weak or misaligned options
→ repair promising options
→ select the strongest path
→ explain why it won
```

---

## 2. Core Thesis

A strong product is not produced by generating more ideas.

A strong product is produced by placing increasingly strict constraints on what counts as the right solution.

The Evaluation Lab should ensure every surviving idea satisfies:

```text
1. macro mission alignment
2. target user fit
3. root problem / root constraint alignment
4. desired result enablement
5. differentiation from alternatives
6. downstream leverage
7. mechanism clarity
8. evidence strength
9. buildability
10. acceptable risk
```

The Evaluation Lab is the system that turns SpecForge from:

```text
creative brainstorming
```

into:

```text
causally justified product decision-making
```

---

## 3. Evaluation Is Not One Final Step

Evaluation must happen throughout the system.

### 3.1 Local Evaluation

Each module evaluates its own output.

Examples:

```text
Target User Layering → Which segment is highest urgency?
Problem Causal Model → Which root constraint candidate is strongest?
Differentiation Engine → Which alternative gap is most meaningful?
Feature Mechanism Generator → Which mechanism best satisfies the micro-objective?
```

### 3.2 Cross-Layer Evaluation

Each layer is evaluated against the layers above and below it.

Examples:

```text
Does this mechanism satisfy the micro-objective?
Does this feature satisfy the macro mission?
Does this MVP app direction attack the root constraint?
Does this data point improve downstream output enough to justify collection friction?
```

### 3.3 Final Narrowing Evaluation

The final evaluator chooses what should be built first.

It must answer:

```text
What won?
Why did it win?
Why did the others lose?
What assumptions could reverse the decision?
What should be built first?
What should be delayed?
What evidence is missing?
```

---

## 4. Evaluation Operating Cycle

Every evaluation run should follow the same cycle.

```text
1. Define decision object
2. Define evaluation context
3. Generate criteria
4. Weight criteria
5. Score candidates
6. Identify tradeoffs
7. Reject weak candidates
8. Repair promising candidates
9. Select winner
10. Explain decision
11. Pass constraints downstream
12. Log confidence and evidence gaps
```

---

## 5. Evaluation Object Types

The engine must support different evaluation object types.

### 5.1 Target User Evaluation

Evaluates which user segment should be prioritized.

Criteria:

```text
pain intensity
urgency
frequency of problem
willingness to use
willingness to pay
reachability
clarity of use case
problem specificity
fit with macro mission
MVP implication strength
```

Output:

```text
primary user segment
secondary segments
rejected segments
why the primary user won
how this changes the product direction
```

---

### 5.2 Problem / Root Constraint Evaluation

Evaluates which root constraint best explains the problem.

Criteria:

```text
explains multiple symptoms
applies to target user
software-solvable
upstream leverage
specificity
non-obviousness
causal depth
connection to desired result
ability to generate solution families
evidence confidence
```

Output:

```text
winning root constraint
alternative root constraints
why winner is deeper
why others are weaker
assumptions to test
leverage points created
```

---

### 5.3 Desired Result Evaluation

Evaluates whether the desired result is specific and useful enough.

Criteria:

```text
functional clarity
decision usefulness
emotional relevance
behavior change
measurability
strategic value
alignment with target user
ability to constrain MVP selection
```

Output:

```text
selected desired result stack
success metrics
failure conditions
blocked-result mappings
```

---

### 5.4 Differentiation Evaluation

Evaluates whether the product is meaningfully better than alternatives.

Criteria:

```text
deeper problem solved
alternative gap strength
user-visible advantage
mechanism advantage
positioning clarity
analogy usefulness
risk of being a wrapper
proof strength
MVP implication strength
```

Output:

```text
differentiation thesis
alternative gaps
strongest analogy
misleading analogies
why the product deserves to exist
```

---

### 5.5 Solution Family Evaluation

Evaluates which solution family should generate MVP app directions.

Criteria:

```text
root constraint alignment
user behavior changed
downstream leverage
differentiation
mechanism clarity
buildability
risk
scope control
ability to generate strong MVPs
```

Output:

```text
recommended solution family
ranked solution families
rejected families
constraints for MVP generation
```

---

### 5.6 MVP App Direction Evaluation

Evaluates the full MVP app direction, not just individual features.

Criteria:

```text
target user fit
root cause attacked
desired result enabled
complete product loop
speed to value
differentiation
buildability
risk
evidence strength
downstream leverage
ability to become a real product
```

Output:

```text
selected MVP app direction
why it won
why alternatives lost
first-build scope
what to delay
validation assumptions
```

---

### 5.7 Feature Card Evaluation

Evaluates whether a feature belongs inside the selected MVP app.

Criteria:

```text
macro objective served
micro objective served
root cause attacked
mechanism clarity
user action clarity
upstream input clarity
downstream output clarity
value metric
buildability
failure mode awareness
testability
```

Output:

```text
accepted features
rejected features
feature build order
feature dependencies
mechanism repair notes
```

---

### 5.8 Mechanism Evaluation

Evaluates possible mechanisms for a feature.

Criteria:

```text
micro-objective alignment
macro-objective alignment
process clarity
input quality
output quality
data friction
user friction
downstream usefulness
risk
implementation complexity
inspectability
```

Output:

```text
selected mechanism
rejected mechanisms
why mechanism won
mechanism flow
constraints passed to implementation
```

---

### 5.9 Data Point Evaluation

Evaluates whether a data point is worth collecting or using.

Criteria:

```text
concept clarity
variable usefulness
collection friction
privacy risk
reliability
required timing
downstream value
alternative collection mechanisms
transformation usefulness
risk if inaccurate
```

Output:

```text
accepted data points
rejected data points
selected collection method
data transformation process
privacy / friction notes
```

---

## 6. Standard Evaluation Schema

Every evaluation run should use this schema.

```json
{
  "evaluation_id": "",
  "object_type": "target_user | root_constraint | desired_result | differentiation | solution_family | mvp_app | feature | mechanism | data_point | final_system",
  "decision_context": "",
  "parent_objective": "",
  "downstream_objective": "",
  "candidates": [
    {
      "id": "",
      "name": "",
      "description": "",
      "scores": {},
      "weighted_score": 0,
      "strengths": [],
      "weaknesses": [],
      "risks": [],
      "evidence_strength": "low | medium | high",
      "confidence": 0
    }
  ],
  "criteria": [
    {
      "name": "",
      "weight": 0,
      "why_it_matters": "",
      "scoring_guidance": ""
    }
  ],
  "tradeoffs": [],
  "winner": "",
  "why_winner_won": "",
  "why_others_lost": [],
  "assumptions_that_could_reverse_decision": [],
  "evidence_needed": [],
  "constraints_passed_downstream": [],
  "recommendation": "",
  "confidence_level": "low | medium | high",
  "repair_required": false
}
```

---

## 7. Core Scoring Dimensions

These dimensions should be reused across the system.

### 7.1 Alignment Scores

```text
macro mission alignment
micro objective alignment
root constraint alignment
desired result alignment
target user alignment
```

### 7.2 Leverage Scores

```text
upstream leverage
downstream leverage
cross-layer leverage
problem-depth leverage
system-wide improvement potential
```

### 7.3 Feasibility Scores

```text
buildability
technical complexity
interaction complexity
data availability
user friction
operational cost
```

### 7.4 Differentiation Scores

```text
alternative gap strength
non-obviousness
competitive advantage
positioning clarity
analogy usefulness
wrapper-risk reduction
```

### 7.5 Evidence Scores

```text
evidence strength
confidence
uncertainty
research need
assumption risk
```

### 7.6 Product Quality Scores

```text
speed to value
retention potential
clarity
trustworthiness
inspectability
polish potential
```

---

## 8. Evaluation Weighting

Not every criterion should matter equally.

Weights depend on the evaluation object.

### 8.1 MVP App Direction Weights

```text
root constraint alignment: 20%
target user fit: 15%
desired result enablement: 15%
differentiation: 15%
downstream leverage: 15%
buildability: 10%
risk: 5%
evidence strength: 5%
```

### 8.2 Feature Card Weights

```text
micro objective alignment: 20%
root cause attacked: 20%
mechanism clarity: 20%
speed to value: 15%
buildability: 10%
testability: 10%
risk: 5%
```

### 8.3 Mechanism Weights

```text
micro objective alignment: 20%
process clarity: 15%
downstream usefulness: 15%
user friction: 15%
data quality: 10%
inspectability: 10%
buildability: 10%
risk: 5%
```

### 8.4 Root Constraint Weights

```text
explains multiple symptoms: 20%
upstream leverage: 20%
software-solvability: 15%
specificity: 15%
target user fit: 10%
desired result connection: 10%
evidence confidence: 10%
```

Weights should be adjustable by the user or by depth mode.

---

## 9. Hard Rejection Rules

Some outputs must fail regardless of score.

### 9.1 General Rejection Rules

Reject if:

```text
it is generic
it skips necessary layers
it hides uncertainty
it does not connect to target user
it does not connect to desired result
it cannot explain downstream impact
it is not inspectable by the user
```

### 9.2 Solution Rejection Rules

Reject if:

```text
it does not attack the root constraint
it only improves appearance
it creates more ambiguity than it resolves
it is a downstream feature pretending to be the MVP app
it is too complex for the first build
it is not meaningfully different from alternatives
it has no clear mechanism
it cannot be tested
```

### 9.3 Feature Rejection Rules

Reject if:

```text
it has no user action
it has no mechanism
it has no value metric
it does not map to a micro-objective
it does not map to the selected MVP app
it depends on unbuilt upstream modules
it is not needed for the first product loop
```

### 9.4 Mechanism Rejection Rules

Reject if:

```text
its process is vague
its inputs are undefined
its outputs are undefined
it creates unnecessary user friction
it does not improve downstream output
it cannot be visualized or inspected
it cannot be implemented in the current build stage
```

---

## 10. Repair Rules

If an item is promising but weak, repair before rejecting.

### 10.1 Repair Types

```text
deepen causal reasoning
make target user more specific
add desired result mapping
clarify mechanism
reduce scope
change data collection method
strengthen differentiation
add evidence requirement
reframe as later-stage feature
merge with stronger candidate
```

### 10.2 Repair Prompt

```text
You are the Evaluation Repair Engine.

The candidate is promising but failed one or more quality gates.

Repair it by:
1. identifying why it failed,
2. preserving the useful core,
3. modifying the candidate to better satisfy the parent objective,
4. reducing unnecessary complexity,
5. strengthening root-cause alignment,
6. clarifying mechanism and downstream impact.

Return:
{
  "failure_reason": "",
  "preserved_core": "",
  "repair_actions": [],
  "repaired_candidate": {},
  "new_score_estimate": 0,
  "still_risky_because": []
}
```

---

## 11. Tradeoff Modeling

Evaluation must explicitly surface tradeoffs.

### Tradeoff Types

```text
speed vs depth
simplicity vs power
privacy vs personalization
feedback richness vs user friction
graph complexity vs readability
differentiation vs buildability
automation vs user control
vision ambition vs MVP feasibility
```

### Tradeoff Output

```json
{
  "tradeoff": "",
  "option_a": "",
  "option_b": "",
  "what_a_optimizes": "",
  "what_b_optimizes": "",
  "risk_of_a": "",
  "risk_of_b": "",
  "recommended_balance": ""
}
```

---

## 12. Consequential Evaluation

Every output must be evaluated by how it affects downstream operations.

Ask:

```text
If this output is weak, what downstream modules fail?
If this output improves, what downstream modules improve?
Does this output reduce or increase uncertainty?
Does this output create better solution families?
Does this output improve MVP ranking?
Does this output improve feature mechanism quality?
Does this output improve spec quality?
```

### Downstream Impact Schema

```json
{
  "artifact": "",
  "downstream_modules_affected": [],
  "positive_downstream_effects": [],
  "negative_downstream_risks": [],
  "dependency_level": "low | medium | high",
  "must_be_high_quality_before_next_step": true
}
```

---

## 13. Constraint Accumulation

The Evaluation Lab must add constraints as the system narrows.

Examples:

```text
Macro constraint:
Product must convert ambiguity into structured confidence.

Target user constraint:
Must work for solo builders with vague product ideas and limited product judgment.

Problem constraint:
Must attack the causal decision system gap, not just generate more ideas.

Differentiation constraint:
Must be meaningfully better than ChatGPT / Notion / FigJam for build-decision confidence.

MVP constraint:
Must produce a complete first product loop without full graph database or spec export.

Feature constraint:
Each feature must connect to a micro-objective and root cause.
```

These constraints should be passed downstream and visible in a constraint summary card.

---

## 14. Evaluation Lab Whiteboard Card

The Evaluation Lab should appear as a reusable card.

### Collapsed Card

```text
Evaluation Lab

Current decision:
Select strongest MVP app direction.

Winner:
Causal Product Modeling Workspace.

Why:
Best root-cause alignment + downstream leverage.
```

### Expanded Card

```text
Candidates evaluated:
4

Top criteria:
Root cause alignment
Desired result fit
Differentiation
Buildability
Downstream leverage

Winner:
Causal Product Modeling Workspace

Rejected:
Spec Exporter first — too downstream-dependent
Knowledge Graph first — too visually complex for v1
Generic MVP Generator — weak problem-depth advantage

Confidence:
Medium-high

Next:
Generate feature cards for selected MVP app.
```

---

## 15. Side Panel Behavior

When the user selects the Evaluation Lab card, the side panel should show:

```text
Decision object
Candidates
Criteria
Weights
Scores
Tradeoffs
Why winner won
Why others lost
Assumptions that could reverse decision
Evidence needed
Repair options
Re-score controls
```

### Side Panel Actions

```text
Change weights
Re-score
Show rejected alternatives
Repair candidate
Make winner simpler
Make winner more ambitious
Compare two options
Add criterion
Remove criterion
Send constraints downstream
```

---

## 16. Evaluation Lab View Mode

Create a dedicated view mode for deep evaluation.

### View Sections

```text
Decision Context
Criteria + Weights
Candidate Comparison
Tradeoff Map
Rejected Alternatives
Constraint Summary
Evidence Gaps
Final Recommendation
```

Use this for serious decisions such as:

```text
selecting MVP app direction
selecting core feature modules
selecting mechanism system
selecting data collection approach
selecting final build sequence
```

---

## 17. Integration With Recursive Layer Optimization

The Evaluation Lab is the evaluation step inside the recursive optimization cycle.

```text
Discover
→ Evaluate  ← Evaluation Lab runs here
→ Generate
→ Distill   ← Evaluation Lab also supports final selection here
```

It receives:

```text
candidate objectives
candidate mechanisms
candidate MVPs
candidate features
candidate data strategies
```

It returns:

```text
ranked candidates
winner
rejected options
constraints passed downward
repair requirements
confidence score
```

---

## 18. Integration With Multifactor Causal Modeling

The Evaluation Lab should use the multifactor causal model to avoid shallow scoring.

It should evaluate:

```text
Which variables matter most?
Which feedback loops should be interrupted?
Which contradictions should the solution resolve?
Which root constraint candidate explains the most?
Which leverage point creates the most downstream effect?
```

This prevents the system from choosing solutions that sound good but only attack surface symptoms.

---

## 19. Integration With Feature Card System

Every feature card should inherit Evaluation Lab outputs.

A feature card should show:

```text
optimization objectives
selected mechanism
why this mechanism won
rejected mechanisms
evaluation criteria used
constraint trace
confidence
```

This makes features traceable to the reasoning system.

---

## 20. Minimum Implementation Requirements

First implementation must include:

```text
standard evaluation schema
criteria + weights
candidate scoring
hard rejection rules
why this won / why others lost
constraint output
confidence level
side-panel evaluation view
```

Do not implement advanced visualization first.

---

## 21. Build Order

Build in this order:

```text
1. Evaluation schema
2. Criteria generator
3. Weighting logic
4. Candidate scoring
5. Hard rejection rules
6. Repair prompt
7. Tradeoff output
8. Constraint accumulation output
9. Evaluation Lab card
10. Evaluation side panel
11. Evaluation Lab view mode
```

---

## 22. Acceptance Criteria

The Evaluation Lab is successful only if it can:

```text
compare multiple candidates
rank them by explicit criteria
explain why the winner won
explain why others lost
surface tradeoffs
reject shallow options
repair promising weak options
pass constraints downstream
show confidence and evidence gaps
update the whiteboard recommendation
```

It fails if it:

```text
uses vague scoring
selects based on vibes
hides tradeoffs
keeps all options alive equally
does not reject anything
does not explain downstream consequences
ignores root constraint alignment
```

---

## 23. Final Instruction

The Evaluation Lab / Narrowing Engine should be treated as the system’s decision authority.

It should not make the product less creative.

It should make creativity useful by forcing every generated idea to survive clear constraints, tradeoffs, root-cause alignment, differentiation, and buildability.

SpecForge should generate broadly, but only ship what the Evaluation Lab can defend.
