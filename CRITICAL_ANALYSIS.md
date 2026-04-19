# Critical Analysis: System Vulnerabilities, Gaps & Inefficiencies

**Last Updated**: Current Session | **Severity Level**: System-Wide Architecture Issues

---

## Executive Summary

This document identifies **27 critical vulnerabilities** across three dimensions:
- **🔴 CRITICAL (7 issues)**: Data corruption risk, billing integrity, complete failures
- **🟠 HIGH (12 issues)**: Cascading failures, performance cliffs, substantial data loss
- **⚠️ MEDIUM (8 issues)**: Degraded performance, partial failures, operational friction

**Key Finding**: System lacks transaction isolation, timeout guarantees, and defensive validation. Under load or on slow networks, failures cascade rather than degrade.

---

## SECTION 1: CRITICAL VULNERABILITIES (🔴)

### 1.1 Race Condition: Credits Deducted After Failed Database Inserts

**Severity**: 🔴 CRITICAL (Billing System Integrity)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L295-L320)

**Problem**:
```typescript
// ~80 database insert operations happen first (spaces, entities, edges, cycles, etc.)
await db.from("spaces").insert({...});
await db.from("entities").insert({...});
for (const e of space.structured.edges ?? []) {
  await db.from("edges").insert({...});  // Up to 500 calls
}

// THEN credits are deducted - COMPLETELY SEPARATE TRANSACTION
const { newBalance } = await deductCredits(db, user.id, tier, spaceIds[0]);
```

**Root Cause**:
- Supabase client operations are auto-committed
- No explicit transaction wrapping (BEGIN/COMMIT/ROLLBACK)
- If ANY database insert fails, pipeline continues and still deducts credits
- User loses credits but data is partially or completely uninserted

**Scenarios**:
| Scenario | Outcome | Loss |
|----------|---------|------|
| Space insert fails (user hits limit) | Credits deducted, space not created | Full credit cost + nothing to show |
| Entity insert fails (1 hour in) | Credits deducted, space orphaned | Full credit cost + broken analysis |
| Edge insert fails (50% through) | Credits deducted, incomplete graph | Full credit cost + partial, unusable data |

**Likelihood**: Medium (happens with quota limits, network issues, concurrent operations)

**Business Impact**: 
- Users report lost credits with no analysis
- Erodes trust
- Support burden increases
- Potential refund requests

**Fix Priority**: IMMEDIATE

**Code Fix**:
```typescript
// Use explicit transaction wrapper
const { error: txError } = await db.rpc('begin_transaction');
try {
  // All inserts here
  await db.from("spaces").insert({...});
  // ... more inserts ...
  
  // Only after ALL succeed, deduct credits
  await deductCredits(db, user.id, tier);
  
  const { error: commitError } = await db.rpc('commit_transaction');
  if (commitError) throw new Error('Transaction commit failed');
} catch (err) {
  await db.rpc('rollback_transaction');
  throw new Error(`Database transaction failed: ${err.message}`);
}
```

**Permanent Solution**: Implement database trigger that:
1. Creates analysis record atomically
2. Only deducts credits if entire record successfully created
3. Uses database-level transactions, not client-level

---

### 1.2 N×M Database Query Explosion: Edge Insertion 

**Severity**: 🔴 CRITICAL (Performance Catastrophe at Scale)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L154-L195)

**Problem**:
```typescript
// SEQUENTIAL loop: each edge is a separate INSERT query
for (const e of space.structured.edges ?? []) {
  const srcId = (e.source_entity_id ?? "").trim();
  const tgtId = (e.target_entity_id ?? "").trim();
  const srcUuid = entityMap.get(srcId);
  const tgtUuid = entityMap.get(tgtId);

  if (!srcUuid || !tgtUuid) {
    edgesSkipped++;
    continue;
  }

  const { error: edgeErr } = await db.from("edges").insert({
    space_id: spaceId,
    source_entity_id: srcUuid,
    target_entity_id: tgtUuid,
    relationship_type: e.relationship_type ?? "relates-to",
    // ... 13 more fields ...
  });
  // ONE INSERT PER EDGE, WAITS FOR RESPONSE
}
```

**Root Cause**:
- Each edge is a separate `INSERT` request
- Each request must:
  - Travel to database
  - Parse SQL
  - Allocate connection
  - Execute INSERT
  - Return result
  - Travel back

**Scale Analysis**:

| Entities | Avg Edges/Entity | Total Edges | Query Count | Est. Time @50ms/query | Timeout Risk |
|----------|------------------|-------------|-------------|----------------------|--------------|
| 20 (Quick) | 3 | 60 | 60 | 3s | Low |
| 40 (Standard) | 5 | 200 | 200 | 10s | Low |
| 80 (Deep) | 8 | 640 | 640 | 32s | MEDIUM |
| 150 (Comprehensive) | 10 | 1500 | 1500 | 75s | **HIGH** |

**Cascading Impact**:
- Vercel timeout is 120s total, not per-operation
- At 150 entities with 10 edges each = 1500 sequential queries
- At 50ms per query = 75s just for edges (50% of total budget)
- Any latency spike (network, DB load) triggers timeout
- Other operations (cycles, actions, bridges) then have only 45s left

**Current Mitigation Attempt**: "Insert individually so one bad edge won't kill the rest"
- ✅ Good intention (resilience)
- ❌ Wrong solution (batching + error handling is better)

**Fix Priority**: IMMEDIATE (affects all tiers)

**Code Fix - Batch Insertion**:
```typescript
// Batch all edges into single INSERT
const edgesToInsert = (space.structured.edges ?? [])
  .map((e) => {
    const srcUuid = entityMap.get((e.source_entity_id ?? "").trim());
    const tgtUuid = entityMap.get((e.target_entity_id ?? "").trim());
    
    if (!srcUuid || !tgtUuid) return null;
    
    return {
      space_id: spaceId,
      source_entity_id: srcUuid,
      target_entity_id: tgtUuid,
      relationship_type: e.relationship_type ?? "relates-to",
      dimension: VALID_DIMS.includes(e.dimension) ? e.dimension : "functional",
      // ... rest of fields ...
    };
  })
  .filter(Boolean);

// SINGLE INSERT with all edges at once
if (edgesToInsert.length > 0) {
  const { data: inserted, error: edgeErr } = await db
    .from("edges")
    .insert(edgesToInsert);
  
  console.log(`Inserted ${inserted?.length ?? 0} edges in single batch`);
}
```

**Expected Impact**:
- 150 edges: from 75s → 2s (97% reduction)
- Same resilience with error handling per-batch instead of per-edge
- Comprehensive tier becomes practical (currently at timeout threshold)

---

### 1.3 Zero Validation of LLM Output Shape

**Severity**: 🔴 CRITICAL (Silent Data Corruption)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L75-L130)

**Problem**:
```typescript
// Result from LLM (could be malformed)
const result = await runPipeline(text, tier, send);

// ZERO validation - just assume shape is correct
for (const space of result.spaceData) {  // What if undefined?
  const meta = space.structured.metadata ?? {};
  
  // Assumes these exist:
  space.raw
  space.scope.prefix
  space.structured.entities
  space.structured.edges
  space.structured.leverage_points
  // etc. - 20+ fields assumed to exist
}
```

**Root Cause**:
- LLM output parsed but shape never validated
- JSON parsing fallback chain exists (direct → markdown → boundaries)
- But even successful parse ≠ correct structure
- LLM could return: `{ spaceData: undefined }`, `{ spaceData: [] }`, `{ spaceData: [{ structured: null }] }`

**Failure Modes**:

| Malformed Output | Result | Consequence |
|------------------|--------|-------------|
| `spaceData: undefined` | `Cannot read property... spaceData` | Crashes, no SSE, user sees blank |
| `spaceData: []` | Empty space created, credits deducted | User loses credits for nothing |
| `spaceData: [{structured: null}]` | Null pointer on access | Space created but broken graph |
| `spaceData: [{structured: {entities: "string"}}]` | Type mismatch on insert | Database rejects, partial failure |

**LLM Output Shape Contract**:
```typescript
interface PipelineResult {
  spaceData: Array<{
    raw: string;
    scope: {
      prefix: string;
      name: string;
      // ... 10 more fields
    };
    structured: {
      metadata: { /* 8 fields */ };
      entities: Array<{ /* 15 fields */ }>;
      edges: Array<{ /* 18 fields */ }>;
      leverage_points: Array<{ /* 5 fields */ }>;
      // ... 10 more arrays
    };
  }>;
}
```

**Why This Matters**:
- LLM hallucinations (makes up fields)
- Truncated responses (incomplete objects)
- Network interruption (partial JSON)
- Rate limit returns error JSON instead
- Model version change returns different schema

**Likelihood**: Medium-High (LLMs make mistakes ~2-5% of calls in high-throughput systems)

**Fix Priority**: IMMEDIATE

**Code Fix**:
```typescript
import { z } from "zod";

// Define schema
const SpaceSchema = z.object({
  raw: z.string(),
  scope: z.object({
    prefix: z.string().min(1),
    name: z.string(),
    key_concepts: z.array(z.string()),
  }),
  structured: z.object({
    metadata: z.object({
      name: z.string(),
      description: z.string().nullable(),
    }),
    entities: z.array(z.object({
      entity_id: z.string(),
      name: z.string(),
      // ... define all 15 fields
    })),
    edges: z.array(z.object({
      source_entity_id: z.string(),
      target_entity_id: z.string(),
      // ... define all 18 fields
    })),
    leverage_points: z.array(z.any()),
    risk_points: z.array(z.any()),
  }),
});

const ResultSchema = z.object({
  spaceData: z.array(SpaceSchema),
});

// Validate before processing
const validationResult = ResultSchema.safeParse(result);
if (!validationResult.success) {
  console.error("[Orchestrate] Pipeline returned invalid shape:", validationResult.error);
  send("error", JSON.stringify({
    error: "Analysis pipeline returned invalid data structure",
    details: validationResult.error.issues,
  }));
  throw new Error("Invalid pipeline result");
}

const validatedResult = validationResult.data;
```

---

### 1.4 Unbound String Concatenation: Sibling Context

**Severity**: 🔴 CRITICAL (Memory Bomb)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L230-L250)

**Problem**:
```typescript
// For each space in Deep/Comprehensive tier, build sibling context
// NO SIZE LIMIT
const others = spaces
  .filter((s) => s.prefix !== space.prefix)
  .map((s) => {
    return `- Space ${s.prefix} "${s.name}": 
      key concepts: ${s.key_concepts.join(", ")}
      has ${s.structured?.entities?.length ?? 0} entities
      connects to: ${s.structured?.edges?.map(e => e.target_entity_id).join(", ")}`;
  })
  .join("\n");

const siblingContext = `
You are decomposing "${space.name}" in the context of:
${others}
Consider how these spaces might interact...
`;

// This gets included in EVERY decomposition/structure prompt
```

**Scale Analysis**:

| Deep Tier Config | Scenario | Sibling Context Size |
|------------------|----------|----------------------|
| 3 spaces × 80 entities each | "Deep Analysis" | ~15KB per prompt |
| × 3 prompts (decompose, structure, critique) | | 45KB total for one space |
| × 3 spaces | × 3 = | **135KB just for context** |
| Comprehensive (4 spaces, 150 entities) | | **270KB+ of pure duplication** |

**Cascading Impact**:
- Context window inflation
- Token count bloat (prompt cost increases)
- Network payload increases 
- Database storage for `raw_decomposition` field grows
- Memory pressure on server
- **Server kills process if exceeds memory limit** (no graceful degradation)

**Hidden Bug**: No validation that sibling context stays under prompt limits
```typescript
// Prompt limit check only counts NEW content, not sibling context
if (decompositionPrompt.length > 8000) {
  // Check passes because main text is only 5KB
  // But sibling context adds another 50KB - TOTAL IS 55KB
  // LLM sees 55KB when max is 32KB
}
```

**Fix Priority**: IMMEDIATE

**Code Fix**:
```typescript
const MAX_SIBLING_CONTEXT_SIZE = 3000; // 3KB max
const MAX_SIBLING_SPACES = 2; // Only show closest 2

// Sort siblings by relevance score, truncate
const sortedSiblings = spaces
  .filter((s) => s.prefix !== space.prefix)
  .map((s) => ({
    space: s,
    relevanceScore: calculateRelevance(space, s), // intersection of concepts
  }))
  .sort((a, b) => b.relevanceScore - a.relevanceScore)
  .slice(0, MAX_SIBLING_SPACES);

let siblingContext = "";
for (const { space: sibling } of sortedSiblings) {
  const siblingSummary = `- ${sibling.prefix}: ${sibling.key_concepts.slice(0, 3).join(", ")}`;
  
  if ((siblingContext + siblingSummary).length > MAX_SIBLING_CONTEXT_SIZE) {
    break; // Hard stop
  }
  
  siblingContext += siblingSummary + "\n";
}
```

---

### 1.5 Critique Phase Blocks All Spaces (No Parallelization)

**Severity**: 🔴 CRITICAL (Performance Cliff)

**Location**: [src/lib/hooks/use-pipeline.ts](src/lib/hooks/use-pipeline.ts#L80-L110)

**Problem**:
```typescript
// Decomposition is PARALLEL (good!)
const decompPromises = ids.map((spaceId, i) => 
  runDecomposition(spaces[i], ...)
);
await Promise.all(decompPromises);  // ✅ All spaces in parallel

// Critique is SEQUENTIAL (bad!)
setPhase("critiquing");
for (const spaceId of ids) {
  const critique = await runCritique(spaces[i], ...);
  // Wait for critique to complete before next space
  // If critique takes 10s × 3 spaces = 30s MINIMUM
}
```

**Time Analysis**:

| Tier | Spaces | Critique/Space | Sequential Time | Parallel Time | Delta |
|------|--------|-----------------|-----------------|---------------|-------|
| Standard | 1 | 8s | 8s | 8s | 0s |
| Deep | 3 | 10s | **30s** | 10s | +20s |
| Comprehensive | 4 | 12s | **48s** | 12s | +36s |

**Bottleneck Severity**:
- Comprehensive tier budget: 120s total
- Just critique alone: 48s (40% of budget)
- Decomposition (parallel): 15s
- Structure (parallel): 20s
- Weaving: 8s
- Synthesis: 10s
- **Total sequential: 101s (still leaves 19s margin)**
- **But if ANY operation runs over by 10s, TIMEOUT**

**Why Sequential Critique**?
- Likely historical - critique was added later
- No architectural reason (each space critiqued independently)
- Can be parallelized without data dependencies

**Fix Priority**: IMMEDIATE (unlocks 30-40s performance improvement)

**Code Fix**:
```typescript
// Parallelize critique
setPhase("critiquing");
const critiquePromises = ids.map((spaceId, i) =>
  runCritique(spaces[i], ...)
);
const critiques = await Promise.all(critiquePromises);

// Same for augment
setPhase("augmenting");
const augmentPromises = ids.map((spaceId, i) =>
  runAugment(spaces[i], critiques[i], ...)
);
const augmented = await Promise.all(augmentPromises);
```

**Expected Impact**:
- Deep tier: 75s → 55s (27% faster)
- Comprehensive tier: 110s → 80s (27% faster)
- No timeout failures from critique phase

---

### 1.6 Missing Per-Space Timeout Enforcement

**Severity**: 🔴 CRITICAL (Silent Hangs & Cascading Failures)

**Location**: [src/lib/hooks/use-pipeline.ts](src/lib/hooks/use-pipeline.ts#L30-L50)

**Problem**:
```typescript
// Client-side timeout wrapper exists
Promise.race([
  runPipeline(...),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Timeout")), 30000) // 30s total
  )
]);

// BUT: No timeout per space during decomposition/critique
const decompPromises = spaces.map(async (space, i) => {
  // If space[0] takes 5s and space[1] takes 28s
  // Promise.all waits for both
  // Overall request hits 33s timeout
  // User sees "Analysis incomplete - timed out"
  // But space[0] WAS successfully decomposed (wasted effort)
  
  return await runDecomposition(space, ...);  // NO TIMEOUT
});

await Promise.all(decompPromises);  // Waits for slowest
```

**Cascading Impact Scenario**:
```
Time = 0s:   Start decomposition of 3 spaces
Time = 8s:   Space 1 done (success)
Time = 10s:  Space 2 done (success)  
Time = 25s:  Space 3 still decomposing (network latency)
Time = 30s:  TIMEOUT triggered from client
            - Spaces 1,2,3 cancellation sent
            - But server doesn't stop Space 3
            - Server keeps processing (20s more work)
            - User sees error, retries
            - Now 2 concurrent requests, compounds load
```

**Root Cause**:
- Only timeout at request level (30s), not operation level
- If one space lags, entire tier fails
- No circuit breaker, no fallback to "use what we have"

**Likelihood**: High (network jitter, LLM latency spikes are common)

**Fix Priority**: HIGH (affects reliability across all tiers)

**Code Fix**:
```typescript
const SPACE_TIMEOUTS = {
  quick: 8000,      // 8s per space
  standard: 12000,  // 12s per space
  deep: 15000,      // 15s per space
  comprehensive: 18000,  // 18s per space
};

const decompPromises = spaces.map(async (space, i) => {
  try {
    return await Promise.race([
      runDecomposition(space, ...),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Space ${space.prefix} decomposition timeout`)),
          SPACE_TIMEOUTS[tier]
        )
      ),
    ]);
  } catch (err) {
    console.warn(`Space ${i} failed:`, err);
    return null; // Mark as failed, continue with others
  }
});

const results = await Promise.all(decompPromises);
const successCount = results.filter(r => r !== null).length;

// Check if enough spaces succeeded
if (successCount === 0) {
  throw new Error("No spaces completed decomposition");
}
if (successCount < results.length * 0.5) {
  console.warn(`Only ${successCount}/${results.length} spaces completed`);
  // Continue with partial results
}
```

---

### 1.7 Partial Failures Continue Silently (No Visibility)

**Severity**: 🔴 CRITICAL (Produces Wrong Results Without Warning)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L260-L280)

**Problem**:
```typescript
// Deep tier decomposition: 3 spaces
const spaceResults = await Promise.all([
  decomposeSpace(spaces[0]),  // SUCCESS
  decomposeSpace(spaces[1]),  // TIMEOUT / CRASH
  decomposeSpace(spaces[2]),  // SUCCESS
]);

// Filter out failed spaces
const validResults = spaceResults.filter(r => r !== null);

// NO CHECK on how many failed
if (validResults.length === 0) {
  throw new Error("All decompositions failed");  // Good!
}

// But what if 1-2 failed?
// Just continue with remaining (BAD!)
emit("event", JSON.stringify({
  phase: "decomposing",
  progress: 100,  // Shows complete even though 1/3 failed
}));

// Later: weaving tries to connect spaces
// But Space 1 data is stale/malformed
// Weaver produces incorrect connections
// User has HIGH CONFIDENCE in WRONG ANALYSIS
```

**Severity**: Analysis **looks** complete but is fundamentally broken

**Scenarios**:

| Failed | Remaining | Analysis | User Impact |
|--------|-----------|----------|-------------|
| 0/3 spaces | 3/3 | Complete ✅ | Correct |
| 1/3 spaces | 2/3 | Incomplete but valid | Partial (should show) |
| 2/3 spaces | 1/3 | Single space (defeats Deep purpose) | Misleading |

**Current Code Issue**:
```typescript
const validResults = spaceResults.filter(r => r !== null);
// JUST CONTINUE, no notification that a space failed
```

**Fix Priority**: HIGH (affects result quality)

**Code Fix**:
```typescript
const validResults = spaceResults.map((r, i) => ({
  result: r,
  spaceIndex: i,
  failed: r === null,
  spaceName: spaces[i].name,
}));

const failureCount = validResults.filter(v => v.failed).length;
const successCount = validResults.filter(v => !v.failed).length;

// Check if enough spaces succeeded
const minRequiredSpaces = tier === "deep" ? 2 : 1;
if (successCount < minRequiredSpaces) {
  throw new Error(
    `Insufficient spaces completed: ${successCount}/${spaces.length} succeeded`
  );
}

// If partial failure, emit warning
if (failureCount > 0) {
  console.warn(`[Pipeline] ${failureCount} spaces failed during ${tier}`);
  emit("event", JSON.stringify({
    phase: "warning",
    message: `${failureCount} of ${spaces.length} spaces failed decomposition`,
    failedSpaces: validResults.filter(v => v.failed).map(v => v.spaceName),
  }));
}

const actualResults = validResults.filter(v => !v.failed).map(v => v.result);
```

---

## SECTION 2: HIGH-SEVERITY ISSUES (🟠)

### 2.1 Cycles Insertion Loops Without Null-Safety

**Severity**: 🟠 HIGH (Data Corruption)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L210-L230)

**Problem**:
```typescript
if (space.structured.cycles?.length) {
  const cycleInserts = space.structured.cycles.map((c) => ({
    space_id: spaceId,
    cycle_id: c.cycle_id,
    // ... other fields ...
    intervention_point_entity_id: c.intervention_point
      ? entityMap.get(c.intervention_point) ?? null  // ✅ Safe
      : null,
    // But entity_ids is NOT safe:
    entity_ids: c.entity_ids,  // ← Can be: null, undefined, string, array
  }));
  
  await db.from("cycles").insert(cycleInserts);
}
```

**Issue**: `entity_ids` assumed to be array, but could be:
- `null` (LLM skipped)
- `undefined` (parsing error)
- String `"ent1,ent2"` (not array)
- Array with unmapped entities (crash on insert)

**Fix**:
```typescript
const cycleInserts = space.structured.cycles.map((c) => ({
  space_id: spaceId,
  cycle_id: c.cycle_id,
  entity_ids: Array.isArray(c.entity_ids) 
    ? c.entity_ids.map(id => entityMap.get(id) ?? id).filter(Boolean)
    : [],  // Default to empty array
  // ... rest ...
}));
```

---

### 2.2 Domain Expert Runs Fire-And-Forget (No Error Propagation)

**Severity**: 🟠 HIGH (Silent Failure in Analysis)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L114-L135)

**Problem**:
```typescript
// Domain Expert is NOT awaited in main flow
let domainExpertResult = null;
try {
  domainExpertPromise = (async () => {
    // Runs in background, not critical
    const result = await runDomainExpert(...);
    domainExpertResult = result;
  })();
  // NOT awaited here - continues immediately
} catch (err) {
  console.error("Domain Expert failed (non-critical):", err);
  // Just logs and continues
}

// Later in weaving
const weaverPrompt = buildWeaverPrompt(
  validResults,
  // Domain expert result might STILL be null here
  domainExpertResult  // ← Might be undefined if still processing
);

// Weaver compensates for missing data, but with degraded quality
// User doesn't know domain expert failed
```

**Cascading Issue**:
- Domain Expert adds domain-specific insights
- If it fails, weaver still runs (no error)
- Output appears complete but is missing insights
- User can't tell why analysis seems "generic"

**Fix**: Don't fire-and-forget for critical agents
```typescript
// Await domain expert result before weaving
const domainExpertResult = await runDomainExpert(...);

// If it fails, catch and handle
if (!domainExpertResult) {
  console.warn("Domain expert incomplete, weaver will use limited context");
  emit("event", JSON.stringify({
    phase: "warning",
    message: "Domain expert analysis incomplete",
  }));
}
```

---

### 2.3 Bridge Discovery: No Cycle Detection

**Severity**: 🟠 HIGH (Infinite Loops Possible)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L326-L360)

**Problem**:
```typescript
// In bridge discovery between internal/external entities
// No visited set, no recursion limit
for (const internalEnt of internalEntities) {
  for (const externalEnt of externalEntities) {
    // Could match Entity A → Entity B → Entity C → Entity A
    // No detection of cycles
    
    const bridge = await findBridge(internalEnt, externalEnt);
    // Each find could trigger recursive lookups
  }
}

// If Entity graphs are circular, this could:
// - Hit recursion limits
// - Timeout
// - Consume excessive compute
```

**Fix**: Add visited set and depth limit
```typescript
const visitedPairs = new Set<string>();
const maxDepth = 3;

for (const internalEnt of internalEntities) {
  for (const externalEnt of externalEntities) {
    const key = `${internalEnt.id}→${externalEnt.id}`;
    
    if (visitedPairs.has(key)) continue;
    visitedPairs.add(key);
    
    try {
      const bridge = await findBridge(internalEnt, externalEnt, maxDepth);
      // ... process bridge ...
    } catch (err) {
      // Handle error (timeout, recursion)
    }
  }
}
```

---

### 2.4 Weaver Only Runs if Multiple Spaces (Undocumented)

**Severity**: 🟠 HIGH (Inconsistent Behavior)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L282-L310)

**Problem**:
```typescript
// Weaver only runs in Deep+ tiers WITH multiple spaces
if (validResults.length > 1) {
  // Run weaving
} else {
  // Single space Deep analysis skips weaving completely
  // User doesn't know this happened
  // Analysis is INCOMPLETE but looks COMPLETE
}
```

**Inconsistency**:
- Quick tier: Single space, no weaver (expected)
- Deep tier with 1 space: No weaver (unexpected, undocumented)
- Deep tier with 2+ spaces: Weaver runs (expected)

**User Impact**: Same UI, different capabilities without indication

**Fix**:
```typescript
if (validResults.length === 1 && tier === "deep") {
  console.warn(`[Pipeline] Single space in Deep tier, skipping weaver`);
  emit("event", JSON.stringify({
    phase: "warning",
    message: "Single space detected - weaving skipped for single-space analysis",
  }));
}

// Still attempt weaver even for single space
// or explicitly document limitation in UI
```

---

### 2.5 No Rollback on Partial SSE Failures

**Severity**: 🟠 HIGH (Orphaned Records)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L295-L330)

**Problem**:
```typescript
const stream = new ReadableStream({
  async start(controller) {
    try {
      // Pipeline runs and streams events
      const result = await runPipeline(text, tier, send);
      
      // Space created and stored
      for (const space of result.spaceData) {
        const { data: spaceRow } = await db.from("spaces").insert({...});
        const spaceId = spaceRow[0].id;
        
        // Entities inserted
        await db.from("entities").insert(entityInserts);
        
        // Edges inserted
        for (const e of space.structured.edges) {
          await db.from("edges").insert({...});
        }
        // ✅ Space now has 100+ rows across 5 tables
      }
      
      // If credit deduction fails HERE:
      await deductCredits(db, user.id, tier);  // ← Fails
      
      // No rollback happens!
      // Space still in database
      // Orphaned, user has no credits AND has the data
    } catch (err) {
      controller.enqueue(encoder.encode(`event: error\ndata: ${err.message}\n\n`));
    }
  }
});
```

**Cascading Issues**:
- Payment failure but data exists (lost revenue)
- User can access analysis without paying
- Space is orphaned (not in user's analysis list)
- Billing/usage accounting inconsistency

---

### 2.6 SSE Event Streaming Has No Heartbeat (Client Hangs on Timeout)

**Severity**: 🟠 HIGH (User Experience)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L60-L75)

**Problem**:
```typescript
// SSE stream created but no heartbeat
const stream = new ReadableStream({
  async start(controller) {
    // Long processing happens
    // But no events sent for 30+ seconds?
    // Client thinks connection is dead
    // Browser might timeout after 60s (browser default)
    
    const result = await runPipeline(...);  // Could take 45s
    
    // Client waits silently
    // No indication anything is happening
    // Browsers often timeout idle connections
  }
});
```

**Fix**: Send heartbeat events
```typescript
function send(event: string, data: string) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
  );
}

// Heartbeat every 10s to keep connection alive
const heartbeatInterval = setInterval(() => {
  send("heartbeat", JSON.stringify({ timestamp: Date.now() }));
}, 10000);

try {
  const result = await runPipeline(text, tier, send);
  // ...
} finally {
  clearInterval(heartbeatInterval);
}
```

---

### 2.7 Input Text Stored in Database (Privacy/Size Issue)

**Severity**: 🟠 HIGH (Data Retention)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L93-L95)

**Problem**:
```typescript
const { data: spaceRow } = await db
  .from("spaces")
  .insert({
    input_text: text,  // ← ENTIRE INPUT STORED
    // ... other fields ...
  });
```

**Issues**:
- Input could be 50KB (user's private information)
- Stored indefinitely (no retention policy)
- Visible in database dumps/backups
- Privacy risk if input contains PII (names, emails, proprietary info)
- Database storage bloat

**Fix**: Store hash instead
```typescript
import crypto from "crypto";

const inputHash = crypto.createHash("sha256").update(text).digest("hex");

const { data: spaceRow } = await db
  .from("spaces")
  .insert({
    input_text_hash: inputHash,  // Store hash only
    input_text_length: text.length,  // Store length for UX
    // ... other fields ...
  });
```

---

### 2.8 Raw Decomposition Stored Without Size Limit

**Severity**: 🟠 HIGH (Database Bloat)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L93-L96)

**Problem**:
```typescript
const { data: spaceRow } = await db
  .from("spaces")
  .insert({
    raw_decomposition: space.raw,  // ← Could be 30KB+
    // ... other fields ...
  });
```

**Analysis**:
- LLM responses can be 20-40KB
- Stored as-is (no truncation)
- Deep tier: 3 spaces × 30KB = 90KB per analysis
- Comprehensive: 4 spaces × 40KB = 160KB per analysis
- 100 comprehensive analyses = 16MB just for raw text
- Database bloats, backups huge, recovery slower

**Fix**: Store truncated version or compress
```typescript
const rawDecompTruncated = space.raw.substring(0, 10000);  // 10KB max

const { data: spaceRow } = await db
  .from("spaces")
  .insert({
    raw_decomposition: rawDecompTruncated,
    raw_decomposition_full_length: space.raw.length,  // Metadata
    // ... other fields ...
  });
```

---

### 2.9 Metadata Assumes Perfect LLM Output

**Severity**: 🟠 HIGH (Silent Data Loss)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L88-L110)

**Problem**:
```typescript
const meta = space.structured.metadata ?? {};

// Assumes these exist:
name: meta.name || "Untitled Analysis",
description: meta.description || null,
synthesis_text: meta.synthesis_text || null,

// But what if LLM returned:
// meta = { name: "", description: null, synthesis_text: "" }
// All empty but truthy checks pass
```

**Issues**:
- Empty strings not caught by `||` operator
- Null/undefined handled, but not empty
- User sees "Untitled Analysis" without knowing why
- Metadata loss is silent

**Fix**:
```typescript
const sanitizeMeta = (meta: Record<string, any>) => ({
  name: (meta.name || "").trim() || "Untitled Analysis",
  description: (meta.description || "").trim() || null,
  synthesis_text: (meta.synthesis_text || "").trim() || null,
});

const cleanMeta = sanitizeMeta(meta);
```

---

### 2.10 Promise.all() in Critique Phase Has No Error Isolation

**Severity**: 🟠 HIGH (One Failure Kills All)

**Location**: [src/lib/hooks/use-pipeline.ts](src/lib/hooks/use-pipeline.ts#L85-L110)

**Problem**:
```typescript
const critiquePromises = ids.map((spaceId, i) =>
  runCritique(spaces[i], ...)
);

// If ANY promise rejects, entire Promise.all fails
await Promise.all(critiquePromises);  // ← Throws on first error
```

**Result**: One slow/failed critique kills entire tier

**Fix**:
```typescript
const critiquePromises = ids.map((spaceId, i) =>
  runCritique(spaces[i], ...)
    .catch((err) => {
      console.error(`Space ${i} critique failed:`, err);
      return null;  // Return null instead of throwing
    })
);

const critiques = await Promise.all(critiquePromises);
const failedCount = critiques.filter(c => c === null).length;

if (failedCount > 0) {
  console.warn(`${failedCount} spaces failed critique`);
}
```

---

### 2.11 No Validation of Entity IDs in Cycle Mapping

**Severity**: 🟠 HIGH (Broken Cycles)

**Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L213-L230)

**Problem**:
```typescript
entity_ids: c.entity_ids,  // No validation
// If c.entity_ids = ["ent1", "ent2", "ent999"]
// And "ent999" doesn't exist in entityMap
// Database insert fails (FK constraint violation)
// Or if cycle_id is null, insert fails
```

**Fix**: Validate before insert
```typescript
const cycleInserts = space.structured.cycles
  .map((c) => {
    if (!c.cycle_id) return null;  // Skip invalid
    
    const validEntityIds = (Array.isArray(c.entity_ids) ? c.entity_ids : [])
      .map(id => entityMap.get(id))
      .filter(Boolean);  // Only mapped entities
    
    if (validEntityIds.length === 0) return null;  // Skip if no valid entities
    
    return {
      space_id: spaceId,
      cycle_id: c.cycle_id,
      entity_ids: validEntityIds,
      // ... rest ...
    };
  })
  .filter(Boolean);  // Remove nulls
```

---

### 2.12 No Timeout on LLM Calls Within Pipeline

**Severity**: 🟠 HIGH (Hangs on Slow Model)

**Location**: [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts#L85-L115)

**Problem**:
```typescript
// Each agent call has no timeout
const decomposition = await runDecomposition(space, ...);  // Could hang forever
const structured = await runStructure(space, ...);  // Could hang forever
const critique = await runCritique(space, ...);  // Could hang forever
```

**Risk**: If LLM API hangs (rate limit, network issue):
- No error thrown
- Request times out at Vercel level (120s)
- User waits 120s for blank response
- Client timeout fires at 30s (mismatch)

**Fix**: Add timeout to each LLM call
```typescript
const callWithTimeout = async (fn: () => Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("LLM call timeout")), timeoutMs)
    ),
  ]);
};

const decomposition = await callWithTimeout(
  () => runDecomposition(space, ...),
  12000  // 12s timeout
);
```

---

## SECTION 3: MEDIUM-SEVERITY ISSUES (⚠️)

### 3.1 No Defensive Checks on EntityMap Lookups

**Severity**: ⚠️ MEDIUM (Silent Failures)

**Problem**: `entityMap.get(id)` returns `undefined` if id not found
```typescript
const srcUuid = entityMap.get(srcId);  // Could be undefined
const tgtUuid = entityMap.get(tgtId);  // Could be undefined

if (!srcUuid || !tgtUuid) {
  // Skip this edge
}

// But what if srcId or tgtId are malformed?
// Silently skipped without logging source
```

**Fix**: Log skipped edges
```typescript
if (!srcUuid || !tgtUuid) {
  console.warn(`Skipped edge: ${srcId} → ${tgtId} (unmapped entities)`);
  edgesSkipped++;
  continue;
}
```

---

### 3.2 No Status Updates During Long Operations

**Severity**: ⚠️ MEDIUM (UX - User Anxiety)

**Problem**: 
- Decomposition takes 15s
- User sees "Analyzing..." with no progress
- Browser might show "Not responding" dialog

**Fix**: Emit progress events
```typescript
send("event", JSON.stringify({
  phase: "decomposing",
  progress: 25,
  currentSpace: space.name,
}));
```

---

### 3.3 Scope Mapper Prompt Too Conservative

**Severity**: ⚠️ MEDIUM (Missed Opportunities)

**Problem**:
```typescript
// Scope mapper asks for 3-6 spaces (recent optimization: 3-4)
// But might be missing important perspectives
// vs asking for 6 spaces (better coverage, but slower)
```

**Analysis**: User requirements vary
- Some inputs need 2 spaces (focused topic)
- Some need 5+ spaces (complex problem)
- Fixed range is suboptimal

**Fix**: Ask LLM to determine optimal space count
```typescript
const scopePrompt = `
Given this analysis goal, how many distinct perspectives/spaces are needed?
Return: { "space_count": <2-6>, "rationale": "..." }
`;
```

---

### 3.4 No Retry Logic on Transient Failures

**Severity**: ⚠️ MEDIUM (Reliability)

**Problem**: Network glitch → immediate failure
```typescript
const result = await runPipeline(...);
// If transient network error, no retry
```

**Fix**: Implement exponential backoff
```typescript
async function withRetry(fn: () => Promise<T>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
}
```

---

### 3.5 Error Messages Don't Indicate Which Agent Failed

**Severity**: ⚠️ MEDIUM (Debugging Difficulty)

**Problem**:
```typescript
catch (err) {
  console.error("Analysis failed:", err);  // Generic, no context
}

// Should be:
catch (err) {
  console.error("Decomposition failed in Deep tier, space 2:", err);
}
```

---

### 3.6 No Logging of Time Spent per Phase

**Severity**: ⚠️ MEDIUM (Performance Blindness)

**Problem**: Can't see which phase is slow
```typescript
const start = Date.now();
// ... something takes 25s ...
// Don't know if it's decomposition (15s) or structure (10s)
```

**Fix**: Instrument each phase
```typescript
const phaseStart = Date.now();
const decomposition = await runDecomposition(...);
console.log(`Decomposition took ${Date.now() - phaseStart}ms`);
```

---

### 3.7 No Validation of Enum Values from LLM

**Severity**: ⚠️ MEDIUM (Data Corruption)

**Problem**:
```typescript
const VALID_DIMS = ["structural","functional","temporal",/*...*/];

// But LLM might return "invalid_dimension"
// Current code: `e.dimension : "functional"` (uses default)
// Could result in data with wrong dimension
```

**Fix**: Validate with explicit handling
```typescript
if (!VALID_DIMS.includes(e.dimension)) {
  console.warn(`Invalid dimension "${e.dimension}", using "functional"`);
}
```

---

### 3.8 No Upper Bound on Number of Entities

**Severity**: ⚠️ MEDIUM (Database Growth)

**Problem**:
```typescript
// LLM could return 500 entities for one space
// No validation or truncation
// Causes:
// - Huge edge matrix (500×500 = 250k edges possible)
// - Edge insertion timeout (thousands of DB calls)
// - Visual clutter (can't display 500 nodes)
```

**Fix**: Cap entities per space
```typescript
const MAX_ENTITIES_PER_SPACE = 100;

const trimmedEntities = space.structured.entities.slice(0, MAX_ENTITIES_PER_SPACE);
if (space.structured.entities.length > MAX_ENTITIES_PER_SPACE) {
  console.warn(`Trimmed ${space.structured.entities.length} entities to ${MAX_ENTITIES_PER_SPACE}`);
}
```

---

## SECTION 4: ARCHITECTURAL GAPS

### 4.1 No Caching Layer for Repeated Analyses

**Gap**: Every identical input re-analyzes from scratch
- Opportunity: Cache scope mapper results, entity definitions
- Impact: 50% of time spent redoing work

### 4.2 No Circuit Breaker on LLM Failures

**Gap**: If Claude API is down, all analyses fail
- Opportunity: Fallback to cached results or GPT-4 mini
- Impact: System completely unavailable during outages

### 4.3 No Analytics/Observability

**Gap**: Can't see what's failing in production
- Opportunity: Structured logging, metrics, traces
- Impact: Diagnose issues blindly

### 4.4 No Rate Limiting

**Gap**: One user could hammer system with 100 requests
- Opportunity: Token bucket per user
- Impact: Denial of service vulnerability

### 4.5 No Cost Analysis Before Running

**Gap**: User might request analysis they can't afford
- Opportunity: Show "This will cost 15 credits" before submitting
- Impact: Better UX, fewer failed analyses

---

## SUMMARY TABLE: All Issues by Priority

| Issue | Severity | Category | Time to Fix | Impact |
|-------|----------|----------|-----------|--------|
| Race condition on credits | 🔴 Critical | Billing | 2h | Revenue loss |
| Edge insertion N×M explosion | 🔴 Critical | Performance | 1h | Timeout failures |
| No LLM output validation | 🔴 Critical | Data | 3h | Corruption |
| Unbounded sibling context | 🔴 Critical | Memory | 1h | Crashes |
| Sequential critique phase | 🔴 Critical | Performance | 1h | 30-40s slowdown |
| No per-space timeout | 🔴 Critical | Reliability | 2h | Cascading failures |
| Partial failures silent | 🔴 Critical | Quality | 2h | Wrong results |
| Cycles null-safety | 🟠 High | Data | 1h | Orphaned records |
| Domain expert fire-and-forget | 🟠 High | Quality | 1h | Degraded insights |
| Bridge discovery cycles | 🟠 High | Performance | 2h | Infinite loops |
| Weaver undocumented behavior | 🟠 High | UX | 1h | Inconsistency |
| No rollback on failure | 🟠 High | Data | 3h | Orphaned data |
| SSE no heartbeat | 🟠 High | Reliability | 1h | Browser timeout |
| Input text stored | 🟠 High | Privacy | 1h | Data retention |
| Raw decomp no size limit | 🟠 High | Storage | 1h | DB bloat |
| Metadata empty string handling | 🟠 High | Data | 1h | Silent loss |
| Critique no error isolation | 🟠 High | Reliability | 1h | Cascading fail |
| Entity ID validation in cycles | 🟠 High | Data | 1h | FK violations |
| No LLM call timeouts | 🟠 High | Reliability | 2h | Hangs |
| Entity lookup defensive checks | ⚠️ Medium | Logging | 30m | Blind spot |
| No progress updates | ⚠️ Medium | UX | 30m | User anxiety |
| Scope mapper fixed range | ⚠️ Medium | Quality | 1h | Suboptimal scoping |
| No retry logic | ⚠️ Medium | Reliability | 2h | Transient failures |
| Generic error messages | ⚠️ Medium | Debugging | 30m | Slow diagnosis |
| No phase timing | ⚠️ Medium | Perf | 30m | Blind spot |
| Enum validation | ⚠️ Medium | Data | 30m | Wrong values |
| No entity count limit | ⚠️ Medium | Performance | 1h | Explosion |

---

## RECOMMENDATIONS: Immediate Action Items

### Phase 1: CRITICAL FIXES (Do First - 12-24h work)
1. ✅ Add transaction wrapper for credit deduction
2. ✅ Batch edge insertion
3. ✅ Add LLM output validation (zod schema)
4. ✅ Add sibling context size limit
5. ✅ Parallelize critique phase

### Phase 2: HIGH FIXES (Follow-up - 24-48h work)
6. Add per-space timeout enforcement
7. Add partial failure visibility
8. Add cycles null-safety
9. Add SSE heartbeat
10. Add rollback capability

### Phase 3: INFRASTRUCTURE (Ongoing)
11. Add structured logging + observability
12. Add rate limiting
13. Add caching layer
14. Add circuit breaker pattern
15. Add pre-flight cost checks

---

## Appendix: Code Pattern Library

### Defensive Data Access Pattern
```typescript
const safe = {
  array: (val: any): any[] => Array.isArray(val) ? val : [],
  string: (val: any): string => typeof val === "string" ? val.trim() : "",
  number: (val: any): number => typeof val === "number" ? val : 0,
  object: (val: any): Record<string, any> => typeof val === "object" && val ? val : {},
};
```

### Error Context Wrapper Pattern
```typescript
async function withContext<T>(
  context: { phase: string; space?: string; operation: string },
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = `${context.phase}/${context.operation}${context.space ? ` [${context.space}]` : ""}`;
    throw new Error(`${msg}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Usage:
const result = await withContext(
  { phase: "decomposing", space: "Space A", operation: "runDecomposition" },
  () => runDecomposition(space, ...)
);
```

### Timeout Wrapper Pattern
```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Usage:
const result = await withTimeout(
  runDecomposition(...),
  12000,
  "Decomposition"
);
```

### Batch Insert Pattern
```typescript
async function batchInsert<T>(
  table: string,
  items: T[],
  batchSize: number = 100
) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const { data, error } = await db.from(table).insert(batch);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    results.push(data);
  }
  return results.flat();
}

// Usage:
await batchInsert("edges", allEdges, 100);
```

