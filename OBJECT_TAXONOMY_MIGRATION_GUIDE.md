# Object Taxonomy Migration Guide

## Overview

The **Object Taxonomy** (`src/types/object-taxonomy.ts`) replaces ad-hoc `entity_type` strings with a **strict, discriminated-union schema**. This ensures every card on the canvas has a well-defined type with specific invariants, required fields, and lifecycle rules.

---

## The 13 Card Types

| Type | Label | Meaning | Source | Example |
|------|-------|---------|--------|---------|
| `raw_input` | Input | What the user originally said | User input, imports | "I want to ship faster" |
| `pain_point` | Pain Point | A specific problem/friction | AI analysis, user | "Deployments take 4 hours" |
| `desired_result` | Desired Result | What success looks like | User, AI inversion | "Deploy in < 15 min" |
| `variable` | Variable | A factor influencing outcomes | AI reasoning | "CI/CD tool performance" |
| `lever` | Leverage Point | High-impact controllable action | AI scoring | "Switch to parallel tests" |
| `assumption` | Assumption | Something believed, unproven | AI reasoning | "Tests are 60% of build time" |
| `uncertainty` | Uncertainty | Something unclear/ambiguous | AI flagging | "Will 2x parallel hurt stability?" |
| `mechanism` | Mechanism | How an action produces effect | AI causal reasoning | "Parallel tests → faster CI" |
| `feature` | Feature | Buildable product capability | Product planning | "Multi-stage CI pipeline" |
| `experiment` | Experiment | Test for assumptions/mechanisms | User/AI planning | "Run tests in 4 parallel blocks" |
| `evidence` | Evidence | Research, metrics, feedback | Literature, metrics, experiments | "Case study: X reduced CI 50%" |
| `decision` | Decision | Locked-in choice | User choice, locked | "We'll use GitHub Actions" |
| `spec` | Spec | Implementation-ready instruction | Product eng | "Add parallelization to CI.yml" |

---

## Type Invariants

Each type enforces constraints that must be respected:

### Raw Input
- **Source**: always `user_input` or `imported`
- **Confidence**: HIGH (user stated it)
- **Status**: typically `active` or `locked`
- **Mutability**: immutable after creation (audit trail)

### Pain Point
- **Must be concrete**: "Slow login" ✓; "Things are bad" ✗
- **Implies**: a Desired Result exists that inverts it
- **Can have**: severity (1–10), frequency, affected parties, quantified impact

### Desired Result
- **Outcome-focused**: "Deploy instantly" not "add cache"
- **Measurable**: should have success metric, evidence of success
- **Pairs with**: a Pain Point

### Variable
- **Controllability**: can be controllable/partially/uncontrollable
- **Domain**: optional grouping (e.g., "infrastructure")
- **Influence**: optional description of how it affects outcomes

### Lever
- **Must be controllable** (by definition)
- **Must have high ROI**: expected impact × activation cost
- **Affects**: other variables, mechanisms, or outcomes
- **Time horizon**: immediate, short/medium/long term

### Assumption
- **Falsifiable**: must be disprovable (if not, it's not an assumption)
- **Critical**: existential/high/medium/low — how much does strategy depend on it?
- **Validation**: what evidence would prove/disprove it?

### Uncertainty
- **Less crisp than Assumption**: no clear test yet
- **Blocking severity**: blocks_all / blocks_major / blocks_minor / cosmetic
- **Resolution path**: what would clarify this?

### Mechanism
- **Causal claim**: "if X, then Y because Z"
- **Input**: lever, action, or external event
- **Output**: desired result or intermediate state
- **Embedded assumptions**: what does this mechanism assume?
- **Precedent**: is there prior evidence this works?

### Feature
- **Buildable & scoped**: can a team execute this in 1–2 weeks?
- **Traces back**: to a Desired Result via a Mechanism
- **Has dependencies**: other features or systems that must exist first

### Experiment
- **Clear hypothesis**: what are we testing?
- **Success criterion**: how will we know it worked?
- **Targets**: which assumptions or uncertainties does it reduce?
- **Scope**: cost, duration, sample size

### Evidence
- **Type**: research_study, user_feedback, metric, precedent, expert_opinion, experiment_result, other
- **Bears on**: what does this support/contradict? (array of card IDs)
- **Strength**: strong / moderate / weak
- **Citation**: where did this come from?

### Decision
- **Rationale**: why was this choice made (must be present)?
- **Alternatives**: what were the other options?
- **Revisit trigger**: when can we reconsider?
- **Status**: usually `locked` (ground truth for downstream reasoning)

### Spec
- **Unambiguous**: specific enough for execution without questions
- **Single piece of work**: ~1–2 weeks for one dev
- **Acceptance criteria**: how do we know it's done?
- **Priority**: must_have / should_have / nice_to_have

---

## Common Fields

Every card has these base fields (see `ObjectBaseFields` in `object-taxonomy.ts`):

```typescript
{
  id: "var_123",                              // Prefixed by type
  type: "variable",                           // Discriminator
  title: "User uncertainty about next step",  // Headline
  description: "...",                         // Optional longer explanation
  status: "exploratory",                      // Current lifecycle state
  source: "ai_generated",                     // Origin
  confidence: 0.72,                           // AI confidence (0..1)
  relevance_score: 0.84,                      // Relevance to objective (0..1)
  connected_to: ["pain_012", "feature_041"],  // References to other cards
  visibility: "user_visible",                 // Who sees it?
  created_at: "2026-06-06T...",               // Timestamps
  updated_at: "2026-06-06T...",
  tags: ["risk", "urgent"],                   // Optional grouping
  notes: "...",                               // User annotations
}
```

---

## Migration from Legacy `entity_type`

### Old System
- `entity_type` was a free-form string
- No validation; could be anything ("foo", "bar", "problem_v2", etc.)
- Generic `entity_category` enum (concrete/abstract/process/relational/epistemic)
- No type-specific fields; everything shoved into JSONB `parameters`

### New System
- `type` is a strict discriminator (13 valid values)
- Each type has its own fields & invariants
- Validation at write time
- Type guards in TypeScript for safe polymorphic handling

### Mapping

Old → New mapping is in `LEGACY_TYPE_TO_NEW` in `object-taxonomy.ts`:

```
"user_input" → "raw_input"
"problem" → "pain_point"
"goal" → "desired_result"
"variable" → "variable"
"lever" → "lever"
"assumption" → "assumption"
"uncertainty" → "uncertainty"
"mechanism" → "mechanism"
"feature" → "feature"
"experiment" → "experiment"
"evidence" → "evidence"
"decision" → "decision"
"spec" → "spec"
```

Use `migrateEntityType(legacyString)` to convert:

```typescript
import { migrateEntityType } from "@/types/object-taxonomy";

const oldType = "problem";
const newType = migrateEntityType(oldType); // "pain_point"
```

---

## Database Migration Path

When updating the `entities` table schema:

1. **Add a new column** `new_type VARCHAR(50)` with a CHECK constraint
2. **Backfill** using the mapping above
3. **Validate** all rows have valid values
4. **Test** on a staging DB first
5. **Soft-cutover**: code reads both `entity_type` and `new_type`, prefers `new_type`
6. **Hard-cutover**: drop old column after a grace period

---

## Using the Type in Code

### Type Guards

```typescript
import {
  isVariable,
  isPainPoint,
  isDecision,
  type ObjectiveCanvasCard,
} from "@/types/object-taxonomy";

const card: ObjectiveCanvasCard = ...;

if (isVariable(card)) {
  console.log(card.controllability); // ✓ TypeScript knows this field exists
}

if (isPainPoint(card)) {
  console.log(card.severity); // ✓ Type-safe
}
```

### Pattern Matching

```typescript
function renderCard(card: ObjectiveCanvasCard) {
  switch (card.type) {
    case "raw_input":
      return <RawInputRenderer card={card} />;
    case "pain_point":
      return <PainPointRenderer card={card} />;
    case "lever":
      return <LeverRenderer card={card} />;
    // ... all 13 types
    default:
      const _exhaustive: never = card;
      return _exhaustive;
  }
}
```

### Filtering

```typescript
import { type ObjectTypeDiscriminator } from "@/types/object-taxonomy";

const painPoints = cards.filter((c) => c.type === "pain_point");
const userDecisions = cards.filter(
  (c) => c.type === "decision" && c.visibility === "user_visible"
);
```

### Metadata Lookup

```typescript
import { OBJECT_TYPE_METADATA } from "@/types/object-taxonomy";

const typeInfo = OBJECT_TYPE_METADATA["lever"];
// {
//   label: "Leverage Point",
//   description: "A high-impact variable or action the user can control",
//   icon: "zap",
//   color: "#ec4899",
//   plural: "Leverage Points",
//   default_visibility: "user_visible"
// }
```

---

## Implementation Checklist

When adopting this schema:

- [ ] Import `object-taxonomy.ts` into component files that render cards
- [ ] Replace generic `entity_type` checks with discriminator checks
- [ ] Use type guards for safe property access
- [ ] Update card generation code to emit the correct type
- [ ] Add schema validation at API endpoints (validate `required` fields per type)
- [ ] Update UI components to handle type-specific fields
- [ ] Migrate existing data (backfill `entity_type` → new types)
- [ ] Write tests for type guards and conversions
- [ ] Update documentation for AI agents on which type to emit when
- [ ] Run `npx tsc --noEmit` to verify no TypeScript errors

---

## Example: Creating a Lever Card

```typescript
import { type LeverCard } from "@/types/object-taxonomy";

const myLever: LeverCard = {
  id: "lever_abc123",
  type: "lever",
  title: "Parallelize test execution",
  description: "Run tests in 4 parallel blocks to reduce CI time",
  status: "active",
  source: "ai_generated",
  confidence: 0.85,
  relevance_score: 0.92,
  visibility: "user_visible",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  // Lever-specific fields:
  expected_impact: "high",
  activation_cost: "medium",
  impact_to_effort_ratio: 2.5,
  affects: ["var_ci_time", "var_resource_cost"],
  time_horizon: "short_term",
  connected_to: ["pain_slow_deploy", "mech_parallel_pipeline"],
};
```

---

## Questions?

- **Where do I put new card types?** Add them to the discriminator at the top of `object-taxonomy.ts`, then add the interface & type guard.
- **Can a card be multiple types?** No. Use `connected_to` to link related cards.
- **What if a card doesn't fit any type?** That's a sign your taxonomy is incomplete — discuss with the team and extend it.
- **How do AI agents know which type to emit?** Document in agent system prompts + examples. Include the type table + invariants.
- **What about the visualization/rendering?** Use `OBJECT_TYPE_METADATA` for color, icon, label. Each component renders type-specific fields.

---

## Further Reading

- **AGENTS.md** — "Object Taxonomy" section (source of truth for why this matters)
- **src/types/object-taxonomy.ts** — Full schema definition + type guards
- **Objective Canvas Operation Map** — How cards flow through generation/persistence
