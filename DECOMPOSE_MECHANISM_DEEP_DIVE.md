# DECOMPOSE Mechanism: Deep Technical Dive

## Quick Reference

```
DECOMPOSE   │  2 LLM calls per space (reasoning + structuring)
  │  (parallel)  │  → entities, edges, cycles, structuring metadata → DB
  └──────┬───────┘
```

This document elaborates on what's actually happening in the code when this mechanism executes, emphasizing the details you may have missed.

---

## Architecture Overview: The Two-Pass System

The DECOMPOSE mechanism is **not** a single LLM call. It's a **two-phase pipeline** that exploits the complementary strengths of free-form reasoning vs. JSON structuring:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INPUT TEXT + SPACE CONFIG                         │
│                      (Optional sibling context)                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
        ┌─────▼──────────────┐     ┌───────▼─────────────┐
        │ PASS 1: DECOMPOSER │     │ PASS 2: STRUCTURER  │
        │  (reasoning depth) │     │  (JSON mode)        │
        │                    │     │                     │
        │ • Free-form        │     │ • Zod validation    │
        │   reasoning        │────▶│ • Structural checks │
        │ • 6-tier analysis  │     │ • Integrity repair  │
        │ • Raw output       │     │ • Consistency fix   │
        │ • Temp: 0.5        │     │ • Fallback parsing  │
        │ • ~20s timeout     │     │ • Temp: 0.3         │
        │ • Contextual       │     │ • ~10s timeout      │
        │   sibling-aware    │     │ • Deterministic     │
        └─────┬──────────────┘     └───────┬─────────────┘
              │                            │
              │    rawDecomposition        │
              │                            │
              │         ┌─────────────────┘
              │         │
              └────┬────┘
                   │
         ┌─────────▼──────────────┐
         │ StructuredDecomposition│
         │                        │
         │ • metadata             │
         │ • entities[]           │
         │ • edges[]              │
         │ • cycles[]             │
         │ • leverage_points[]    │
         │ • risk_points[]        │
         │ • propositions[]       │
         │ • contradictions[]     │
         │ • scenarios[]          │
         │ • action_items[]       │
         │ • open_questions[]     │
         │ • shared_variables[]   │
         │ • master_bottleneck    │
         └─────────┬──────────────┘
                   │
              ┌────▼────────────────────────────────────┐
              │   VALIDATION + AUTO-CORRECTION LAYER    │
              │                                         │
              │ 1. validateStructuralIntegrity()        │
              │    - Check all edge refs valid          │
              │    - Check all cycle refs valid         │
              │    - Check leverage/risk/bottleneck     │
              │                                         │
              │ 2. autoCorrectStructuralIssues()        │
              │    - Replace bad refs with placeholder  │
              │    - Filter invalid cycles              │
              │    - Remove dangling leverage/risk pts  │
              │                                         │
              │ 3. validateConsistency()                │
              │    - Verify counts match arrays         │
              │    - Fix off-by-one errors              │
              │    - Normalize confidence scores        │
              └────┬─────────────────────────────────────┘
                   │
        ┌──────────▼────────────────────────┐
        │   DATABASE INSERTION (Atomic)      │
        │                                    │
        │ 1. Space creation + metadata       │
        │ 2. Entities → entities table       │
        │ 3. Edges → edges table             │
        │ 4. Cycles → cycles table           │
        │ 5. Propositions → propositions tbl │
        │ 6. Metadata → synthesis_data JSON  │
        │ 7. Changelog entry                 │
        └──────────────────────────────────────┘
```

---

## Pass 1: The Decomposer (Agent 2)

**Location**: `src/lib/orchestration/agents.ts` → `runDecomposer()`

### What It Does

The Decomposer performs **free-form reasoning** using the full decomposition prompt:

```typescript
export async function runDecomposer(
  input: string,
  spaceScope?: { name: string; description: string; key_concepts: string[] },
  siblingContext?: string,
  reasoningDepth: "quick" | "standard" | "deep" = "standard"
): Promise<string> {
  let systemPrompt = getDecompositionPrompt(reasoningDepth);

  // If analyzing one space among many: add boundary-awareness guidance
  if (spaceScope) {
    const scopePrefix = `You are analyzing ONE specific area of a larger situation...
Area: ${spaceScope.name}
Description: ${spaceScope.description}
Key concepts: ${spaceScope.key_concepts.join(", ")}
${siblingContext}
`;
    systemPrompt = scopePrefix + systemPrompt;
  }

  return llmGenerate({
    system: systemPrompt,
    user: enrichedPrompt,
    maxTokens: reasoningDepth === "deep" ? 16000 : 8192,
    temperature: 0.5,  // ← Higher temp = more creative, exploratory
  });
}
```

### Key Details You Might Have Missed

1. **Temperature 0.5 (not 0.3)**: Unlike the structuring pass, the decomposer uses **higher temperature**. This is intentional—it encourages:
   - Novel connection discovery
   - Alternative interpretations of relationships
   - Exploration of implicit assumptions
   - Creative cycle hypotheses

2. **Sibling Context Injection**: When analyzing multiple spaces (deep tier):
   - Each space gets told what the OTHER spaces are analyzing
   - This prevents redundancy and surfaces cross-domain bridges
   - E.g., "Space A is analyzing Market Dynamics. You are analyzing Product Development. Don't repeat what A will cover."

3. **MaxTokens Scaling**: 
   - `quick` tier: 8192 tokens (~6s reasoning)
   - `standard` tier: 8192 tokens (~8s reasoning)
   - `deep` tier: 16000 tokens (~20s reasoning)
   
   The structurer gets MORE tokens (16000) because it's converting structured output, not exploring.

4. **The 6-Tier Analysis**: Inside the system prompt, the decomposer is instructed to produce:
   - **Tier 1**: Surface parse (what's literally stated)
   - **Tier 2**: Concept extraction (entity identification)
   - **Tier 3**: Relationship mapping (edges)
   - **Tier 4**: Unit breakdown (decomposability flags)
   - **Tier 5**: Constraint identification (cycles, IF-THEN-ELSE)
   - **Tier 6**: Fundamental logic (propositions, leverage/risk points)

   This tiered approach reveals structure at multiple levels of abstraction.

5. **Output Format**: The decomposer outputs **plain text with markdown**, not JSON. This is intentional:
   - Text reasoning is more natural for the LLM
   - Allows the LLM to show work, provide justification
   - Sets up the structurer to have clear prose to convert

---

## Pass 2: The Structurer (Agent 2b)

**Location**: `src/lib/orchestration/agents.ts` → `runStructurer()`

### What It Does

The Structurer takes the raw decomposition text and **converts it to typed, validated JSON**:

```typescript
export async function runStructurer(
  rawDecomposition: string,
  reasoningDepth: "quick" | "standard" | "deep" = "standard"
): Promise<StructuredDecomposition> {
  const result = await llmJSON<StructuredDecomposition>({
    system: getStructuringPrompt(reasoningDepth),
    user: `Convert this analysis to JSON:\n\n${rawDecomposition}`,
    maxTokens: 16000,
    temperature: 0.3,  // ← Lower temp = deterministic, consistent
    validator: validateStructuredDecomposition,  // ← Zod validation
    fallback: createFallbackDecomposition("raw", "Raw Analysis", rawDecomposition.slice(0, 200)),
  });

  // THREE-LAYER VALIDATION
  // Layer 1: Zod schema validation (happens inside llmJSON)
  // Layer 2: Structural integrity check
  const integrityCheck = validateStructuralIntegrity(result);
  if (!integrityCheck.isValid) {
    console.warn("Structural integrity issues detected:", integrityCheck.issues);
    autoCorrectStructuralIssues(result);  // ← In-place mutation
  }

  // Layer 3: Consistency check (counts match arrays)
  const consistencyCheck = validateConsistency(result);
  if (!consistencyCheck.isConsistent) {
    console.warn("Consistency issues corrected:", consistencyCheck.corrections);
  }

  return result;
}
```

### Key Details You Might Have Missed

1. **Temperature 0.3 (not 0.5)**: Lower temperature ensures:
   - Consistent structure across multiple calls
   - Repeatable ID generation (E1, E2, etc.)
   - Deterministic edge classification
   - Stable maturity assignments

2. **Three-Layer Validation** (critical resilience mechanism):
   - **Layer 1 - Zod Schema**: Validates shape at parse time. If invalid, the `llmJSON()` function:
     - Retries with explicit instruction to fix the error
     - Falls back to `createFallbackDecomposition()` if all retries fail
   - **Layer 2 - Structural Integrity**: 
     - Checks that every edge source/target exists in entities list
     - Checks that cycles only reference valid entities
     - Checks that leverage/risk/bottleneck points exist
     - Checks that shared variables are real entities
   - **Layer 3 - Consistency**: 
     - Verifies metadata counts (entity_count, edge_count, etc.) match actual array lengths
     - Normalizes confidence scores to [0, 1]
     - Fixes temporal validity ranges

3. **Auto-Correction is Mutation-Based**: 
   ```typescript
   // This modifies the object IN PLACE, not returning a new object
   autoCorrectStructuralIssues(result);
   ```
   This is efficient but means you must not rely on the original object if auto-correction happened.

4. **Fallback Mechanism**: If structuring completely fails (even after retries):
   ```typescript
   fallback: createFallbackDecomposition(
     "raw",  // type
     "Raw Analysis",  // name
     rawDecomposition.slice(0, 200)  // preview of raw text
   )
   ```
   This creates a minimal but valid `StructuredDecomposition` so the pipeline doesn't crash.

---

## The Actual Output: StructuredDecomposition

**Location**: `src/types/analysis.ts`

### Shape at a Glance

```typescript
interface StructuredDecomposition {
  // 1. METADATA (Core context)
  metadata: {
    name: string;
    description: string;
    space_prefix: string;
    entity_count: number;
    edge_count: number;
    orphan_count: number;
    cycle_count: number;
    maturity: "actionable_now" | "waiting_on_dependency" | "theoretical" | "blocked";
    activation_dependencies?: string[];
    synthesis_text: string;
  };

  // 2. GRAPH STRUCTURE
  entities: StructuredEntity[];        // ~5-50 per space
  edges: StructuredEdge[];             // ~10-200 per space
  cycles: StructuredCycle[];           // ~0-20 per space

  // 3. ANALYTICAL OUTPUT (Tiers 5-6)
  leverage_points: LeveragePoint[];    // High-leverage entities
  risk_points: RiskPoint[];            // High-risk entities
  master_bottleneck: Bottleneck | null;  // THE critical chokepoint

  // 4. REASONING ARTIFACTS
  propositions: Proposition[];         // Logical statements (P1, P2, ...)
  novel_connections: NovelConnection[];  // Hidden bridges
  contradictions: Contradiction[];     // Explicit conflicts
  scenarios: Scenario[];               // Potential futures
  action_items: ActionItem[];          // Recommendations
  open_questions: OpenQuestion[];      // Unknowns

  // 5. CROSS-SPACE METADATA
  shared_variables: SharedVariable[];  // Entities that appear in multiple spaces
}
```

### Why This Structure Matters

1. **Metadata is Predictive**: The `maturity` field tells you if this analysis is actionable:
   - `"actionable_now"` → Can make decisions based on this
   - `"waiting_on_dependency"` → Need answers from another space first
   - `"theoretical"` → Provisional, may change with new info
   - `"blocked"` → Critical unknowns prevent progress

2. **Entities Are Not Equal**: 
   ```typescript
   interface StructuredEntity {
     entity_id: string;  // E1, E2, ... (local to this space)
     is_leverage_point: boolean;  // ← Can move the whole system
     is_risk_point: boolean;      // ← Could crash the whole system
     is_master_bottleneck: boolean;  // ← THE single point of failure
     is_shared_variable: boolean;  // ← Used in multiple spaces
     is_decomposable: boolean;     // ← Can be analyzed as its own space
     // ... 20+ other fields for nuance
   }
   ```

3. **Edges Carry Semantics, Not Just Connections**:
   ```typescript
   interface StructuredEdge {
     dimension: "structural" | "functional" | "temporal" | "causal" | ...;
     polarity: "positive" | "negative" | "neutral" | "conditional";
     strength: number;  // [0, 1]
     confidence: number;  // [0, 1]
     dynamics: "threshold" | "linear" | "compounding" | "exponential" | ...;
     utility: {
       failure_consequence: "catastrophic" | "degrading" | "recoverable" | "negligible";
       propagation_speed: "immediate" | "days" | "weeks" | "months" | "years";
       actionability: "directly_controllable" | "indirectly_influenceable" | ...;
     };
   }
   ```
   Each edge is not just a link—it's a causal vector with failure modes.

4. **Cycles Are Classified**: 
   ```typescript
   cycles[0].classification  
   // "reinforcing_positive" → amplifies itself
   // "reinforcing_negative" → self-correcting (oscillates)
   // "balancing" → dampens perturbations
   ```
   Not all cycles are equal. Understanding their type is critical for intervention.

---

## Parallel Processing: The Per-Space Timeout Mechanism

**Location**: `src/lib/orchestration/pipeline.ts` → `runDeep()` (lines 250-320)

### How Parallelization Actually Works

```typescript
const spaceResults = await Promise.all(
  spaces.map(async (space, i) => {
    // Each space runs in parallel
    const spaceTimeout = 25000;  // 25s max per space

    // DECOMPOSE with timeout
    const decomposeResult = await withTimeout(
      runDecomposer(input, space, siblingContexts[i], "deep"),
      20000,  // ← 20s for decomposition alone
      `Space ${i} decomposition`
    );

    if (!decomposeResult.success) {
      logTimeoutEvent(i, space.name, "decomposition", decomposeResult);
      // Space failed gracefully—doesn't block others
      return null;
    }

    // STRUCTURE with timeout
    const structureResult = await withTimeout(
      runStructurer(raw, "deep"),
      10000,  // ← 10s for structuring alone
      `Space ${i} structuring`
    );

    if (!structureResult.success) {
      logTimeoutEvent(i, space.name, "structuring", structureResult);
      return null;
    }

    // Both passes succeeded
    return { space, decomposition: structureResult.data };
  })
);
```

### Why the Timeouts Are This Specific Value

| Phase | Timeout | Reasoning |
|-------|---------|-----------|
| **Decompose** | 20s | Free-form reasoning is slow, but 20s is usually enough for ~5k tokens. If it hits limit, it's likely stuck in analysis paralysis |
| **Structure** | 10s | Converting to JSON should be fast (just formatting). 10s is generous. If it hits 10s, the prompt is likely malformed |
| **Per-Space Total** | 25s | 20+10 would be 30s ideal, but 25s buys safety margin |
| **All 3 Spaces** | 75s max | 3 × 25s = 75s within Vercel's 120s hard limit |

### Failure Isolation

**Critical detail**: If space A's decomposition times out, it does NOT block spaces B and C:

```
Time 0s   : Space A, B, C start decomposing (parallel)
Time 5s   : Space B finishes decompose → starts structure
Time 10s  : Space C finishes decompose → starts structure
Time 15s  : Space A decompose times out (20s) → Space A returns null
Time 20s  : Space B finishes structure → returns result
Time 23s  : Space C finishes structure → returns result
Final     : Results = [null, Result_B, Result_C] ← Space A excluded but others preserved
```

---

## Database Insertion: The Atomic Part

**Location**: `src/app/api/pipeline/decompose/route.ts` (lines 150-220)

### What Gets Persisted

```typescript
// Step 1: Create space
const { data: spaceData } = await db.from("spaces").insert({
  user_id: user.id,
  name: spaceName,
  description: parsed.metadata?.description,
  space_prefix: prefix,
  input_text: text,
  raw_decomposition: rawDecomposition,  // ← Store full reasoning
  synthesis_text: parsed.metadata?.synthesis_text,
  entity_count: dedupedEntities.length,
  edge_count: dedupedEdges.length,
  orphan_count: parsed.metadata?.orphan_count,
  cycle_count: parsed.cycles?.length,
  maturity: maturity,
}).select("id").single();

const spaceId = spaceData.id;

// Step 2: Insert entities (with resilience)
const entityIdMap = new Map<string, string>();
const sanitizedEntities = dedupedEntities.map((e) => sanitizeEntity(e, spaceId));
const { data: entityData } = await resilientInsert(
  db, "entities", sanitizedEntities, "id, entity_id"
);
// Build UUID → internal ID mapping for edge references
for (const row of entityData) {
  entityIdMap.set(row.entity_id, row.id);  // E1 → uuid-123
}

// Step 3: Insert edges (skip invalid references)
const sanitizedEdges = dedupedEdges
  .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
  .filter((e) => e !== null);  // Filter out bad edges

await resilientInsert(db, "edges", sanitizedEdges, "id");

// Step 4: Insert cycles
const sanitizedCycles = (parsed.cycles ?? [])
  .map((c) => sanitizeCycle(c, spaceId, entityIdMap))
  .filter((c) => c !== null);

await resilientInsert(db, "cycles", sanitizedCycles, "id");

// Step 5: Insert propositions
const propositions = (parsed.propositions ?? [])
  .map((p) => ({
    space_id: spaceId,
    proposition_id: p.proposition_id || `P${Math.random().toString(36).slice(2, 6)}`,
    statement: p.statement,
    proposition_type: p.proposition_type,
    confidence: p.confidence,
    depends_on: p.depends_on,
    entity_ids: p.entity_ids,
  }));

await resilientInsert(db, "propositions", propositions, "id");

// Step 6: Store rich metadata in synthesis_data (JSON column)
const structuringMeta: Record<string, unknown> = {};
if (parsed.leverage_points?.length) structuringMeta.leverage_points = parsed.leverage_points;
if (parsed.risk_points?.length) structuringMeta.risk_points = parsed.risk_points;
if (parsed.master_bottleneck) structuringMeta.master_bottleneck = parsed.master_bottleneck;
// ... all other non-tabular outputs

await db.from("spaces").update({
  entity_count: entityIdMap.size,
  edge_count: edgesInserted,
  cycle_count: cyclesInserted,
  synthesis_data: structuringMeta,  // ← Entire JSON blob
}).eq("id", spaceId);

// Step 7: Log changelog (non-critical)
await db.from("space_changelog").insert({
  space_id: spaceId,
  version: 1,
  change_type: "initial_analysis",
  summary: `Analysis: ${entityIdMap.size} entities, ${edgesInserted} edges, ${cyclesInserted} cycles`,
  details: { entity_count: entityIdMap.size, edge_count: edgesInserted, cycle_count: cyclesInserted },
});
```

### Key Details You Might Have Missed

1. **Raw Decomposition is Stored**: The entire text output from Pass 1 is saved in `raw_decomposition`. Why?
   - Audit trail (what reasoning led to this structure?)
   - Fallback for re-structuring if needed
   - Analysis of LLM reasoning patterns

2. **Entity ID Mapping**: 
   - LLM generates local IDs: E1, E2, E3 (per space)
   - DB auto-generates UUIDs: `uuid-123`, `uuid-456`, etc.
   - The `entityIdMap` bridges these: `E1 → uuid-123`
   - Edges use the mapping to reference correct entities

3. **Resilient Insert Pattern**:
   ```typescript
   // If ANY entity fails to insert, this catches it and logs
   const { data: entityData } = await resilientInsert(
     db, "entities", sanitizedEntities, "id, entity_id"
   );
   // Returns: [{ id: "uuid-123", entity_id: "E1" }, ...]
   ```
   This allows the pipeline to continue even if 1-2 entities fail.

4. **Propositions Get Auto-IDs**: If the LLM didn't generate a proposition_id:
   ```typescript
   proposition_id: p.proposition_id || `P${Math.random().toString(36).slice(2, 6)}`
   // P2x9k, Pa3qm, etc.
   ```

5. **Synthesis Data is a JSON Blob**: Instead of separate tables for leverage_points, risk_points, etc., they're stored as JSON in the `spaces.synthesis_data` column:
   ```json
   {
     "leverage_points": [...],
     "risk_points": [...],
     "master_bottleneck": {...},
     "novel_connections": [...],
     "contradictions": [...],
     "scenarios": [...],
     "action_items": [...]
   }
   ```
   This is intentional—these are non-tabular, semi-structured outputs that don't need to be queried independently.

---

## The Validation + Auto-Correction Pipeline

**Location**: `src/lib/validation/error-recovery.ts`

### Why THREE Layers of Validation?

The structuring phase can produce invalid output even with Zod validation. Here's why:

1. **LLM Hallucination**: Even with JSON mode, the LLM might:
   - Generate an edge referencing entity `E99` that doesn't exist
   - Create a cycle mentioning entities not in the entity list
   - Mark a leverage point on an entity that was filtered out

2. **Edge Cases in Structuring**:
   - Metadata says 10 entities, but only 9 exist
   - Edge count = 15 but 20 edges provided
   - Cycles reference deleted entities

### Layer 1: Structural Integrity Check

```typescript
function validateStructuralIntegrity(decomposition) {
  const issues: string[] = [];
  const entityIds = new Set(
    decomposition.entities.map((e) => e.entity_id)
  );

  // Check edges
  for (let i = 0; i < decomposition.edges.length; i++) {
    const edge = decomposition.edges[i];
    if (!entityIds.has(edge.source_entity_id)) {
      issues.push(`Edge ${i}: source "${edge.source_entity_id}" not found`);
    }
    if (!entityIds.has(edge.target_entity_id)) {
      issues.push(`Edge ${i}: target "${edge.target_entity_id}" not found`);
    }
  }

  // Check cycles reference valid entities
  for (const cycle of decomposition.cycles) {
    for (const entityId of cycle.entity_ids) {
      if (!entityIds.has(entityId)) {
        issues.push(`Cycle: entity "${entityId}" not found`);
      }
    }
  }

  // Check leverage points, risk points, bottleneck
  // ... similar validation

  return { isValid: issues.length === 0, issues };
}
```

### Layer 2: Auto-Correction

If issues found, automatically fix them:

```typescript
function autoCorrectStructuralIssues(decomposition) {
  const entityIds = new Set(decomposition.entities.map((e) => e.entity_id));
  const placeholder = decomposition.entities[0]?.entity_id || "unknown";

  // Replace bad edge references with placeholder
  decomposition.edges = decomposition.edges.map((edge) => ({
    ...edge,
    source_entity_id: entityIds.has(edge.source_entity_id)
      ? edge.source_entity_id
      : placeholder,  // ← Fallback to first entity
    target_entity_id: entityIds.has(edge.target_entity_id)
      ? edge.target_entity_id
      : placeholder,
  }));

  // Filter cycles to only valid entities
  decomposition.cycles = decomposition.cycles.map((cycle) => ({
    ...cycle,
    entity_ids: cycle.entity_ids.filter((id) => entityIds.has(id)),  // ← Drop invalid
  }));

  // Remove leverage/risk points that reference deleted entities
  decomposition.leverage_points = decomposition.leverage_points.filter(
    (lp) => entityIds.has(lp.entity_id)
  );

  // If bottleneck references deleted entity, nullify it
  if (decomposition.master_bottleneck && 
      !entityIds.has(decomposition.master_bottleneck.entity_id)) {
    decomposition.master_bottleneck = null;
  }

  return decomposition;
}
```

### Layer 3: Consistency Check

Verify metadata counts match actual data:

```typescript
function validateConsistency(decomposition) {
  const corrections: string[] = [];

  // Fix entity count
  if (decomposition.metadata.entity_count !== decomposition.entities.length) {
    corrections.push(
      `Entity count: said ${decomposition.metadata.entity_count}, correcting to ${decomposition.entities.length}`
    );
    decomposition.metadata.entity_count = decomposition.entities.length;
  }

  // Fix edge count
  if (decomposition.metadata.edge_count !== decomposition.edges.length) {
    corrections.push(
      `Edge count: said ${decomposition.metadata.edge_count}, correcting to ${decomposition.edges.length}`
    );
    decomposition.metadata.edge_count = decomposition.edges.length;
  }

  // Fix cycle count
  if (decomposition.metadata.cycle_count !== decomposition.cycles.length) {
    decomposition.metadata.cycle_count = decomposition.cycles.length;
  }

  return { isConsistent: corrections.length === 0, corrections };
}
```

---

## Cost Model & Token Usage

| Phase | Tokens | Time | Reason |
|-------|--------|------|--------|
| **Decompose (Pass 1)** | ~2000-4000 | 5-20s | Free-form reasoning, exploratory |
| **Structurer (Pass 2)** | ~2000-3000 | 3-10s | Converting to JSON, deterministic |
| **Per-Space Total** | ~4000-7000 | 8-30s | Depends on input size and depth |
| **3 Spaces Parallel** | ~12000-21000 | 8-30s | All in parallel, bottleneck = slowest |

### Why This Cost Model?

- **Decomposer is slow**: Reasoning is computationally expensive. 20s is typical.
- **Structurer is faster**: It's just formatting—10s is ceiling.
- **Parallel saves time**: 3 spaces sequentially = 24-90s. Parallel = 8-30s.

---

## Common Failure Modes & Recovery

### Failure Mode 1: Entity Orphans

**Symptom**: LLM creates entities with no edges

**Detection**: `validateStructuralIntegrity()` doesn't catch (it's not invalid, just lonely)

**Prevention**: The decomposition prompt has a rule:
> "Zero orphans. Every entity must have at least 2 edges. If you can't find 2 relationships, the entity is either under-analyzed or shouldn't be a standalone entity."

**Recovery**: Manual review—orphans suggest incomplete analysis.

### Failure Mode 2: Dangling Cycle References

**Symptom**: Cycle mentions entity E99 that doesn't exist

**Detection**: `validateStructuralIntegrity()` detects it

**Recovery**: `autoCorrectStructuralIssues()` removes E99 from that cycle's entity_ids

### Failure Mode 3: Count Mismatches

**Symptom**: Metadata says 10 entities but only 8 exist

**Detection**: `validateConsistency()` detects it

**Recovery**: Metadata is auto-corrected to match actual count

### Failure Mode 4: Timeout on Slow Input

**Symptom**: Decomposer hits 20s timeout on very large input

**Detection**: `withTimeout()` catches it

**Recovery**: Space is skipped, returned as `null`. Other spaces continue. Frontend shows "Incomplete analysis for Space A".

---

## Architectural Insights: Why This Design?

### Why Two Passes, Not One?

**Single-pass (❌ doesn't work well)**:
```typescript
// Try to get JSON directly
const result = await llmJSON<StructuredDecomposition>({
  system: decompositionPrompt + structuringPrompt,
  user: input,
  maxTokens: 16000,
});
// ← LLM is confused: should I reason or format?
// ← Output is often structured but shallow
```

**Two-pass (✅ works great)**:
```typescript
// Step 1: Reason freely
const raw = await llmGenerate({ system: decompositionPrompt, ... });

// Step 2: Structure output of reasoning
const structured = await llmJSON({ system: structuringPrompt, user: raw, ... });
// ← Each pass excels at its task
// ← First pass finds insights; second pass formats precisely
```

The two-pass approach exploits **cognitive specialization**:
- Pass 1 LLM: "Explore and reason"
- Pass 2 LLM: "Format and categorize"

### Why Sibling Context?

When analyzing multiple spaces, each decomposer gets:
```
"Other areas being analyzed:
  - Space A (Market Dynamics): focuses on TAM, adoption curves, ...
  - Space B (Product Development): focuses on features, roadmap, ...
  - Space C (Team): focuses on skills, capacity, ..."
```

This **prevents duplicate analysis**. Space C doesn't re-analyze market dynamics if Space A already did.

### Why Timeout-Based Parallelism?

Instead of `Promise.all()` with no timeout:

```typescript
// ❌ Bad: Space A slow → delays everything
await Promise.all([spaceA, spaceB, spaceC]);

// ✅ Good: Space A slow → only Space A is delayed
await Promise.all([
  withTimeout(spaceA, 25s),
  withTimeout(spaceB, 25s),
  withTimeout(spaceC, 25s),
]);
```

Timeouts provide **failure isolation**.

---

## Performance Characteristics

### Best Case (Quick Tier, Small Input)
- Decompose: 5s
- Structure: 3s
- Validation: 100ms
- **Total: ~8s**

### Typical Case (Deep Tier, Medium Input, 3 Spaces)
- Per-space: 15-25s
- Parallel: 15-25s (all at once)
- Validation + DB: 2s
- **Total: ~17-27s**

### Worst Case (Deep Tier, Large Input, 3 Spaces, Timeouts)
- Space A times out at 20s
- Space B finishes at 22s
- Space C finishes at 24s
- **Total: 24s** (still < Vercel 120s limit)

---

## Summary: The Complete Picture

The DECOMPOSE mechanism is not just "2 LLM calls." It's:

1. **Cognitive Division of Labor**: Free-form reasoning + structured formatting
2. **Resilience-First Design**: 3-layer validation, auto-correction, graceful fallbacks
3. **Parallel Isolation**: Each space times out independently, doesn't block others
4. **Rich Output**: Not just edges + entities, but leverage points, risk, cycles, propositions
5. **Audit Trail**: Raw reasoning preserved for traceability
6. **Database Normalization**: Graph in tables, metadata in JSON columns

This architecture enables the system to handle ambiguous, complex user input and produce a **queryable, actionable knowledge graph** in 8-30 seconds.
