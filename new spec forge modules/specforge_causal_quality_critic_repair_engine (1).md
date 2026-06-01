# SpecForge — Causal Quality Critic / Repair Engine

## 1. Purpose

The **Causal Quality Critic / Repair Engine** reviews SpecForge outputs before they are surfaced, accepted, passed downstream, or converted into implementation artifacts.

It prevents shallow, generic, unsupported, premature, or misaligned outputs from contaminating the reasoning chain.

The module answers:

> Is this output deep enough, specific enough, causally grounded enough, differentiated enough, constrained enough, and useful enough to move downstream? If not, what exactly failed and how should it be repaired?

This engine is not optional. It should run after every major reasoning module.

---

## 2. Core Thesis

SpecForge is only as strong as its weakest accepted reasoning artifact.

If a weak target user model is accepted, the problem model becomes weak.

If a weak problem model is accepted, the root constraint becomes weak.

If a weak root constraint is accepted, solution families become generic.

If solution families are generic, MVP directions and feature cards become polished but shallow.

Therefore, every major output must pass a quality gate.

---

## 3. Position in SpecForge System

The Causal Quality Critic runs after these modules:

```text
Prompt Power-Up Analyzer
Target User Layering Modeler
Multifactor Problem Causal Modeling Engine
Desired Result Layering Modeler
Cross-Analysis Engine
Convergence Engine
Differentiation Intelligence Engine
Question Expansion Engine
MVP App Direction Generator
Feature Card System
Feature Mechanism Generator
Data Point Optimization Model
Evaluation Lab
Experimentation / Validation Lab
Spec Exporter
```

It also runs when the user manually edits or accepts a major node.

---

## 4. Main Output

The critic outputs:

```text
Pass / Fail
↓
Issues Found
↓
Severity
↓
Repair Required
↓
Repair Strategy
↓
Repaired Output
↓
Confidence After Repair
↓
Constraints Added
↓
Downstream Staleness Warning
```

---

## 5. Quality Dimensions

Every output should be evaluated across these dimensions:

```text
specificity
causal depth
target user alignment
desired result alignment
root constraint alignment
differentiation strength
constraint satisfaction
evidence honesty
uncertainty visibility
downstream usefulness
buildability
non-genericness
traceability
```

---

## 6. Universal Failure Conditions

The critic should reject outputs that:

```text
- are generic
- repeat obvious common-sense statements
- skip required layers
- jump to solutions too early
- hide uncertainty
- fail to identify assumptions
- fail to connect to target user
- fail to connect to desired result
- fail to connect to root constraint
- fail to compare against alternatives when needed
- produce feature names without mechanisms
- produce MVP features instead of MVP app directions
- score based on vibes
- lack hard rejection rules
- lack downstream implications
- are too broad to guide decisions
- are too complex for the selected MVP scope
```

---

## 7. Severity Levels

### Critical

The output cannot move downstream.

Examples:

```text
No root constraint.
No target user.
No desired result.
No mechanism behind feature.
No selected MVP app direction.
```

### High

The output can be repaired but should not be accepted as-is.

Examples:

```text
Root constraint is vague.
Causal model lacks loops and contradictions.
Differentiation is only feature-level.
MVP candidates are not meaningfully different.
```

### Medium

The output is usable but needs refinement.

Examples:

```text
Some assumptions are missing.
A few constraints are not passed downstream.
Scores lack explanation.
```

### Low

Minor polish issue.

Examples:

```text
Card wording is too long.
A label is unclear.
```

---

## 8. Module-Specific Quality Gates

## 8.1 Prompt Power-Up Gate

Fails if:

```text
- raw intent is misread
- explicit and inferred information are not separated
- assumptions are missing
- ambiguities are hidden
- features are generated too early
```

Repair:

```text
re-extract explicit facts
mark inferences
list ambiguities
delay feature generation
```

---

## 8.2 Target User Gate

Fails if:

```text
- user is too broad
- no behavior pattern
- no current workaround
- no urgency
- no emotional state
- no user variants
- no downstream constraints
```

Repair:

```text
generate user variants
score variants
select primary user
create constraints passed downstream
```

---

## 8.3 Multifactor Problem Causal Model Gate

Fails if:

```text
- model is only a linear cause chain
- fewer than 12 causal variables
- no stakeholder variants
- no feedback loops
- no contradictions
- no incentive layer
- no representation layer
- no counterfactuals
- no root constraint candidates
- no leverage point ranking
- no evidence needs
```

Repair:

```text
expand variables
generate loops
extract contradictions
run root constraint tournament
rank leverage points
```

---

## 8.4 Desired Result Gate

Fails if:

```text
- result is vague
- no decision result
- no behavior change
- no measurable success
- no first-principles result
- no result-to-cause mapping
- no constraints passed downstream
```

Repair:

```text
convert surface output into result stack
generate metrics
connect blocked causes
create downstream constraints
```

---

## 8.5 Cross-Analysis Gate

Fails if:

```text
- models are summarized separately but not interwoven
- no contradictions identified
- no highest-leverage intervention
- no confidence score
- no unresolved questions
```

Repair:

```text
compare user ↔ problem ↔ result
identify contradictions
select highest-leverage intervention
mark uncertainties
```

---

## 8.6 Convergence Gate

Fails if:

```text
- no dominant thesis selected
- too many equal root constraints
- root constraint is vague
- no first-principles need
- no implications
- no weaker interpretations rejected
```

Repair:

```text
run root constraint tournament
select dominant thesis
explain rejected interpretations
create implications
```

---

## 8.7 Differentiation Gate

Fails if:

```text
- comparison is only feature-level
- direct alternatives are missing
- indirect workarounds are missing
- deeper unsolved problem is missing
- analogy is decorative
- superiority is claimed without causal basis
- no MVP implications
```

Repair:

```text
map alternatives
identify alternative gaps
compare deeper problem solved
generate positioning thesis
create MVP constraints
```

---

## 8.8 Question Expansion Gate

Fails if:

```text
- questions are generic
- questions do not affect decisions
- no priority
- no related node
- no answer source
- no downstream effect
```

Repair:

```text
rank questions by decision impact
hide low-value questions
connect questions to nodes
mark research or experiment source
```

---

## 8.9 MVP App Direction Gate

Fails if:

```text
- candidates are only features
- no core product loop
- no root cause attacked
- no desired result enabled
- no differentiation
- no selected winner
- no first-build scope
- no delayed scope
```

Repair:

```text
regenerate complete app directions
compare candidates
select winner
define scope boundary
```

---

## 8.10 Feature Card Gate

Fails if:

```text
- feature has no macro objective
- feature has no micro objective
- no mechanism
- no upstream / downstream flow
- no evaluation criteria
- no rejected mechanism alternatives
- no test method
```

Repair:

```text
add traceability
generate mechanism alternatives
define input → process → output
define test method
```

---

## 8.11 Feature Mechanism Gate

Fails if:

```text
- trigger is unclear
- inputs are missing
- processing steps are vague
- output artifact is missing
- no user behavior change
- no failure modes
- no test method
```

Repair:

```text
create mechanism layers
define trigger / input / process / output
identify failure modes
create test method
```

---

## 8.12 Data Point Gate

Fails if:

```text
- data point lacks concept definition
- variables are not decomposed
- collection friction ignored
- privacy ignored
- reliability ignored
- downstream use unclear
- no lower-friction proxy considered
```

Repair:

```text
define concept
decompose variables
evaluate friction / privacy / reliability
find proxy
create data constraints
```

---

## 8.13 Evaluation Lab Gate

Fails if:

```text
- criteria are vague
- weights are missing
- scores are unexplained
- no tradeoffs
- no why-this-won
- no why-others-lost
- no assumptions that could reverse decision
```

Repair:

```text
generate criteria
weight criteria
re-score
explain tradeoffs
identify reversal assumptions
```

---

## 8.14 Validation Lab Gate

Fails if:

```text
- assumption not named
- no hypothesis
- success criteria vague
- failure criteria missing
- wrong user tested
- result will not change decision
- experiment tests downstream feature before upstream problem
```

Repair:

```text
name assumption
create hypothesis
define success / failure criteria
link result to model update
```

---

## 8.15 Spec Export Gate

Fails if:

```text
- spec loses causal model
- build tasks do not map to root cause or feature card
- unvalidated features are treated as core
- no data schema
- no acceptance criteria
- no non-goals
```

Repair:

```text
restore causal trace
map tasks to features
mark experimental features
add acceptance criteria
```

---

## 9. Critic Prompt

```text
You are the Causal Quality Critic for SpecForge.

Review the provided output from [module_name].

Evaluate it against:
- required schema
- module-specific quality gates
- causal depth
- target user alignment
- desired result alignment
- root constraint alignment
- differentiation strength
- constraint satisfaction
- evidence honesty
- downstream usefulness
- buildability
- traceability

Reject or repair it if:
- it is generic
- it skips required layers
- it jumps to solutions too early
- it lacks root cause alignment
- it hides uncertainty
- it cannot guide downstream decisions
- it violates accumulated constraints

Return:
{
  "module_name": "",
  "pass_or_fail": "pass | fail | repair_needed",
  "severity": "critical | high | medium | low",
  "issues": [],
  "missing_required_elements": [],
  "constraint_violations": [],
  "downstream_risks": [],
  "repair_strategy": "",
  "repaired_output": {},
  "confidence_after_repair": "",
  "new_constraints_created": [],
  "stale_downstream_nodes": []
}
```

---

## 10. Repair Strategy Types

The critic can choose repair strategies:

```text
rerun_module
expand_depth
generate_alternatives
run_tournament
add_constraints
re-score
simplify_scope
mark_uncertainty
trigger_research
trigger_validation
send_back_to_previous_module
```

---

## 11. Downstream Staleness Handling

If a repair changes an important upstream output, downstream nodes should be marked stale.

Example:

```text
Root constraint changed.
Stale downstream:
- First-Principles Need
- Differentiation Thesis
- Solution Families
- MVP App Directions
- Feature Cards
- Evaluation Scores
```

The user should be prompted:

```text
This repair changes upstream logic. Recalculate affected cards?
```

---

## 12. Whiteboard Visualization

### Quality Badge

Every major card should show:

```text
Passed
Needs repair
Low confidence
Research needed
Validation needed
Constraint violation
Stale
```

### Critic Card

Optional system card:

```text
Quality Critic

Current issue:
Problem Causal Model is underbuilt.

Reason:
No feedback loops or root constraint tournament.

Action:
Repair model.
```

### Side Panel

Shows:

```text
quality status
issues found
severity
repair recommendation
constraints violated
downstream risks
repair action
```

---

## 13. Side Panel Actions

```text
Run quality check
Repair output
Show issues
Show missing layers
Show constraint violations
Show downstream risk
Accept despite warning
Send back to previous module
Trigger research
Trigger validation
Recalculate downstream nodes
```

---

## 14. Graph Updates

The Causal Quality Critic creates graph nodes:

```text
Quality Gate Result
Quality Issue
Repair Strategy
Constraint Violation
Downstream Risk
Stale Node Warning
Repaired Output
```

It creates edges:

```text
evaluates
fails_because
repairs
violates_constraint
creates_downstream_risk
marks_stale
requires_repair
requires_research
requires_validation
```

---

## 15. Interweaving with Other Modules

### With Constraint Accumulation

The critic checks whether outputs violate active constraints.

### With Evaluation Lab

The critic can force re-scoring if evaluation is weak.

### With Validation Lab

The critic can trigger validation when confidence is too low.

### With Knowledge Graph

The critic updates graph nodes, quality statuses, and stale dependencies.

### With Side Panel

The critic powers quality badges, warnings, and repair actions.

### With Whiteboard

The critic determines which cards are safe, uncertain, or stale.

---

## 16. Minimum Implementation Requirements

For the first implementation, the critic must support:

```text
1. pass / fail / repair_needed status
2. severity
3. issue list
4. missing required elements
5. constraint violations
6. downstream risks
7. repair strategy
8. quality badge
9. stale downstream nodes
10. repaired output
```

---

## 17. Acceptance Criteria

The Causal Quality Critic is complete when:

```text
- every major module can be checked
- shallow outputs are rejected
- missing layers are identified
- repair strategies are generated
- downstream stale nodes are marked
- quality badges appear on the whiteboard
- users can inspect and trigger repairs from side panel
- repaired outputs update graph state
```

---

## 18. Final Instruction

The Causal Quality Critic / Repair Engine exists to keep SpecForge honest and deep.

It should force the system to ask:

```text
Is this specific enough?
Is this causal enough?
Is this constrained enough?
Is this differentiated enough?
Is this actionable enough?
Can it safely move downstream?
If not, how should it be repaired?
```

No major artifact should be trusted until it passes its quality gate.
