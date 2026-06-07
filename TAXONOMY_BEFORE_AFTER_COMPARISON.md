# What Actually Exists Now vs. The New Taxonomy

## Current State: What's Actually Enforced

### Database Level (Very Limited)
- `entities.entity_type` — **free-form string**, NO CHECK constraint
- `entities.entity_category` — enum restricted to 5 values: `concrete | abstract | process | relational | epistemic`
- `entities.causal_chain` — JSONB blob (stores anything, no schema)
- **No type-specific field validation** at the database level

### Generation Level (Current System)
The LLM generates **exactly 4 types** based on the room lane:
1. **Pain points** — what gets generated for the `pain` lane
2. **Outcomes** — what gets generated for the `outcomes` lane  
3. **Features** — what gets generated for the `features` lane
4. **Objective anchor** — one entry for the `objective` lane

Each has shape stored in `causal_chain`:
```typescript
// Pain
{ negative_outcome, root_causes[], influence_rank, sub_category? }

// Feature  
{ positive_outcome, first_principles[], sub_category? }

// Outcome
{ measured_by, indicators[], indicator_specs[] }

// Objective
{ (minimal; just anchor title) }
```

**The LLM doesn't emit a `type` field.** The system infers type from which lane the entity landed in.

### Rendering Level (Current System)
In `sub-objective-room-view.tsx`:
```typescript
interface LayerItem {
  id: string;
  name: string;
  entity_type: string;  // ← never used for dispatch; just carried
  causal_chain?: Record<string, unknown> | null;  // ← polymorphic blob
}
```

The UI dispatches **based on the lane, NOT the entity_type**:
```tsx
if (lane.slug === "pain") {
  // Render pain card with causal_chain.negative_outcome
} else if (lane.slug === "features") {
  // Render feature card with causal_chain.positive_outcome
} else if (lane.slug === "outcomes") {
  // Render outcome card with causal_chain.measured_by + indicators[]
}
```

**`entity_type` is ignored for rendering.** It's just a string field that goes unparsed.

### Outside the Canvas (New Types You Don't Have)
These objects exist in OTHER modules but NOT on the objective canvas:
- **Evidence** — in research/citation systems
- **Decisions** — in approval flows, strategy commits
- **Experiments** — in testing / validation workflows
- **Specs** — in product eng / implementation tracking
- **Assumptions**, **Uncertainties** — only in AI reasoning, not persisted on canvas
- **Mechanisms** (causal claims) — partially embedded in feature `first_principles[]`, but not standalone objects
- **Variables** / **Levers** — scattered across different analysis systems, not unified

---

## What The New Taxonomy Adds

### 1. **Explicit Type Discriminator**
```typescript
// BEFORE (current)
{
  id: "entity_123",
  entity_type: "xyz_random_string",  // ← meaningless
  causal_chain: { ... }  // ← polymorphic blob
}

// AFTER (with taxonomy)
{
  id: "pain_123",
  type: "pain_point",  // ← strict enum, type-safe
  title: "...",
  causal_chain: { negative_outcome, root_causes[], ... }  // ← still same shape
}
```

### 2. **Type-Safe Polymorphism in Code**
```typescript
// BEFORE — no type guards, no safety
const handleEntity = (entity: LayerItem) => {
  if (entity.causal_chain?.negative_outcome) {
    // Hope this is a pain? Could be anything.
  }
}

// AFTER — discriminated union, safe dispatch
const handleEntity = (entity: ObjectiveCanvasCard) => {
  switch (entity.type) {
    case "pain_point":
      console.log(entity.severity);  // ✓ TypeScript knows this exists
    case "lever":
      console.log(entity.impact_to_effort_ratio);  // ✓ Type-safe
  }
}
```

### 3. **Type-Specific Required Fields**
```typescript
// BEFORE — causal_chain is a free-form blob
{
  "causal_chain": {
    "anything_goes": true,
    "no_schema": "enforced",
    "field_order": "random"
  }
}

// AFTER — each type has explicit required fields
// Pain point MUST have:
{
  "type": "pain_point",
  "severity"?: number,
  "frequency"?: "constant" | "often" | "sometimes" | "rare",
  "quantified_impact"?: string
}

// Lever MUST have:
{
  "type": "lever",
  "expected_impact"?: "high" | "medium" | "low",
  "activation_cost"?: "high" | "medium" | "low",
  "impact_to_effort_ratio"?: number
}
```

### 4. **Unified Type Metadata Registry**
```typescript
// BEFORE — no metadata, every component duplicates color/icon logic
// In CardA.tsx: color = "#ef4444", icon = "alert-circle"
// In CardB.tsx: color = "#ef4444", icon = "alert-circle" (copy-paste)
// In CardC.tsx: color = "#ef4444", icon = "alert" (oops, typo)

// AFTER — single source of truth
const OBJECT_TYPE_METADATA = {
  "pain_point": {
    label: "Pain Point",
    icon: "alert-circle",
    color: "#ef4444",
    plural: "Pain Points",
    default_visibility: "user_visible"
  }
}

// Use everywhere:
const meta = OBJECT_TYPE_METADATA[card.type];
<Icon name={meta.icon} color={meta.color} />
```

### 5. **13 Types Instead of 4**
Current system only supports what's on the canvas:
- Pain, Feature, Outcome, Objective anchor

New taxonomy enables:
- Raw Input, Pain Point, Desired Result
- Variable, Lever
- Assumption, Uncertainty
- Mechanism, Feature, Experiment
- Evidence, Decision, Spec

Can now represent the **entire reasoning flow** on one canvas.

---

## Practical Comparison: What Would Change When You Use It

### Current Flow (Today)
```
1. User enters prompt → Raw text stored as space.synthesis_data
2. LLM generates pain/feature/outcome → Entities created via room/generate
3. Entity lands in database:
   {
     id: "abc123",
     entity_type: "generated_pain_v2",  // ← arbitrary string
     causal_chain: { negative_outcome, root_causes[], ... }
   }
4. UI reads from DB → checks lane.slug, renders based on LANE not entity_type
5. No type validation; no type safety; entity_type field goes unused
```

### Future Flow (With Taxonomy, Step-by-Step)

**Step 1: Generate with explicit types**
```typescript
// LLM generation now outputs:
const painCard: PainPointCard = {
  id: "pain_001",
  type: "pain_point",  // ← explicit discriminator
  title: "Users abandon search after first non-goal result",
  severity: 8,
  frequency: "often",
  quantified_impact: "40% of searches have ≤1 result check",
  causal_chain: { negative_outcome, root_causes[] }
}

const leverCard: LeverCard = {
  id: "lever_042", 
  type: "lever",  // ← explicit discriminator
  title: "Re-rank by stated goal weight",
  expected_impact: "high",
  activation_cost: "medium",
  impact_to_effort_ratio: 2.5
}
```

**Step 2: Validate at API boundary**
```typescript
// POST /api/brainstorm/room/generate
// Validate every card:
if (card.type === "pain_point") {
  // MUST have: negative_outcome, root_causes
  assert(card.severity !== undefined, "pain_point requires severity");
  assert(card.frequency !== undefined, "pain_point requires frequency");
} else if (card.type === "lever") {
  // MUST have: expected_impact, activation_cost
  assert(card.impact_to_effort_ratio !== undefined);
}
```

**Step 3: Render with type safety**
```typescript
// OLD: room-view dispatches by lane
if (lane.slug === "pain") {
  return <PainCardRenderer item={item} />;  // ← hope item is pain-shaped
}

// NEW: room-view dispatches by type with guards
import { isPainPoint, isLever, type ObjectiveCanvasCard } from "@/types/object-taxonomy";

if (isPainPoint(card)) {
  return <PainCardRenderer card={card} />;  // ← TypeScript KNOWS card.severity exists
} else if (isLever(card)) {
  return <LeverCardRenderer card={card} />;  // ← TypeScript KNOWS card.impact_to_effort_ratio exists
}
```

**Step 4: Use metadata for consistent UI**
```typescript
// OLD: Each card component has hardcoded colors/icons
export function PainCardRenderer({ card }) {
  return (
    <div style={{ borderColor: "#ef4444" }}>
      <AlertCircle size={24} className="text-red-600" />
    </div>
  );
}

// NEW: All cards use registry
import { OBJECT_TYPE_METADATA } from "@/types/object-taxonomy";

export function ObjectiveCard({ card }) {
  const meta = OBJECT_TYPE_METADATA[card.type];
  return (
    <div style={{ borderColor: meta.color }}>
      <Icon name={meta.icon} size={24} className={`text-[${meta.color}]`} />
      <span>{meta.label}</span>
    </div>
  );
}
```

**Step 5: Cross-room analysis becomes easier**
```typescript
// Find all levers across the entire space
const allCards = await loadAllCanvasCards(spaceId);
const levers = allCards.filter(isLever);  // ← type guard, safe
const topLevers = levers
  .sort((a, b) => (b.impact_to_effort_ratio ?? 0) - (a.impact_to_effort_ratio ?? 0))
  .slice(0, 5);
```

---

## Why This Matters: The Gap

### What You Have Today
✅ 4 lane-based types (pain/feature/outcome/anchor)  
✅ Causal chains with structured JSONB per lane  
❌ No type safety in code — dispatching by lane, not type  
❌ No validation of required fields per type  
❌ Can't represent the full reasoning lifecycle (assumptions, experiments, evidence, specs)  
❌ entity_type field is meaningless, never checked or validated  
❌ Metadata (colors, icons) duplicated across UI components  

### What The Taxonomy Gives You
✅ 13 types covering the full lifecycle  
✅ Type-safe discriminated unions  
✅ Explicit required fields per type, validated at API boundaries  
✅ Single metadata registry for consistent UI  
✅ Can now represent decisions, experiments, evidence, assumptions on the same canvas  
✅ entity_type becomes meaningful; validates against strict enum  
✅ Migration path from current system (existing pain/feature/outcome keep working)  

---

## How to Actually Start Using It

### Phase 1: Adopt in New Code (No Breaking Changes)
```typescript
// New card rendering components:
import { OBJECT_TYPE_METADATA, isPainPoint, isLever, type ObjectiveCanvasCard } from "@/types/object-taxonomy";

// Use type guards + metadata in any new component
export function SmartCardRenderer({ card }: { card: ObjectiveCanvasCard }) {
  const meta = OBJECT_TYPE_METADATA[card.type];
  // ... type-safe rendering
}
```

### Phase 2: Migrate Existing Entities (Gradual)
```typescript
// When loading entities, convert old system to new:
const loadRoomCards = async (...): Promise<ObjectiveCanvasCard[]> => {
  const rows = await db.from("entities").select("*");
  return rows.map(row => {
    const type = migrateEntityType(row.entity_type);  // Converts old → new
    return {
      ...row,
      type,
      confidence: row.confidence ?? 0.5,
      relevance_score: row.relevance ?? 0.5,
      // ... rest of taxonomy fields
    };
  });
};
```

### Phase 3: Update Generation Code
```typescript
// In room/generate, emit explicit types:
const painCards: PainPointCard[] = pains.map(p => ({
  id: generateId("pain"),
  type: "pain_point",  // ← explicit
  title: p.name,
  severity: Math.round(p.influence_rank),
  frequency: p.influence_rank > 3 ? "often" : "sometimes",
  causal_chain: { negative_outcome: p.negative_outcome, root_causes: p.root_causes }
}));
```

### Phase 4: Add Validation
```typescript
// At API boundaries, validate types:
function validateObjectiveCard(card: unknown): ObjectiveCanvasCard {
  const parsed = parseJSON(card);
  if (!isValidObjectType(parsed.type)) {
    throw new Error(`Invalid type: ${parsed.type}`);
  }
  if (parsed.type === "pain_point" && !parsed.severity) {
    throw new Error("pain_point requires severity field");
  }
  return parsed;
}
```

---

## Summary: What Changes, What Doesn't

| What | Today | With Taxonomy | Impact |
|------|-------|---------------|--------|
| Canvas still has 4 lanes (pain/features/outcomes/anchor) | ✓ | ✓ | **No breaking change** |
| Entities still live in `entities` table | ✓ | ✓ | **No migration needed** |
| Generation still produces room items | ✓ | ✓ | **No API change** |
| **Type safety in code** | ✗ | ✓ | **Better bugs caught at compile time** |
| **Type validation at API** | ✗ | ✓ | **Bad data rejected before DB** |
| **Unified metadata** | ✗ | ✓ | **Easier UI consistency** |
| **Can represent full lifecycle** | ✗ | ✓ | **Assumptions, experiments, decisions on canvas** |
| **entity_type has meaning** | ✗ | ✓ | **Strict enum, no random strings** |

---

## TL;DR

You already have a **working 4-type system** hardcoded by lane + shape. The taxonomy:
1. **Makes that system type-safe** (discriminated union instead of magic lane dispatch)
2. **Validates fields per type** (required fields enforced, not blob of JSONB)
3. **Extends it to 13 types** (pains/features/outcomes + assumptions/experiments/evidence/specs/decisions/etc.)
4. **Unifies metadata** (one registry instead of duplicated colors/icons)
5. **Doesn't break anything** — gradual adoption path

You don't HAVE to use it yet. But when you want type safety + the full lifecycle on one canvas, it's ready to plug in.
