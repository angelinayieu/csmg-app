# InterAxis: Failure Scenarios & Recovery Strategies

## Document Structure

This document is organized by **where** things can go wrong (entry point → database) and **how** the system recovers.

---

## PART 1: INPUT VALIDATION FAILURES

### Failure Point 1.1: Missing Authentication

**When**: User not logged in

**Detection**:
```typescript
const { data: { user }, } = await supabase.auth.getUser();
if (!user) {
  // Fail here
}
```

**Response**:
```json
HTTP 401
{
  "error": "Unauthorized"
}
```

**Recovery Path**: User must log in via `/auth/login`, retry

**Prevention**: None possible; architectural requirement

---

### Failure Point 1.2: Text Missing or Empty

**When**: `text` field not in request body or is empty string

**Detection**:
```typescript
if (!text || typeof text !== "string") {
  // Fail here
}
```

**Response**:
```json
HTTP 400
{
  "error": "Text is required"
}
```

**Recovery Path**: User must provide text

**Prevention**: Frontend validation before submission

---

### Failure Point 1.3: Text Too Short

**When**: `text.length < 20`

**Detection**:
```typescript
if (text.length < 20 || text.length > 50000) {
  // Fail here
}
```

**Response**:
```json
HTTP 400
{
  "error": "Text must be between 20 and 50,000 characters"
}
```

**Recovery Path**: User must add more detail

**Prevention**: Show character count in UI with minimum warning

**Context**: Quick Tier can still work with <200 chars, but server requires ≥20

---

### Failure Point 1.4: Text Too Long

**When**: `text.length > 50000`

**Detection**: Same as 1.3

**Response**: Same as 1.3 (HTTP 400)

**Recovery Path**: User must trim text or split into multiple analyses

**Prevention**: Character count + truncation warning in UI

**Optimization Note**: Scope mapper truncates to 8000 chars anyway

---

### Failure Point 1.5: Invalid or Missing Tier

**When**: `tier` not in valid set OR missing entirely

**Detection**:
```typescript
const { text, tier = "quick" } = body;
// No explicit validation; defaults to "quick"
```

**Response**:
```json
HTTP 200 (silently defaults)
```

**Recovery Path**: Automatic; tier defaults to "quick"

**Prevention**: Frontend should enforce valid tier selection

---

### Failure Point 1.6: Insufficient Credits

**When**: User balance < tier cost

**Detection**:
```typescript
const creditCheck = await checkCredits(db, user.id, tier);
if (!creditCheck.hasCredits) {
  // Fail here
}
```

**Response**:
```json
HTTP 402
{
  "error": "Insufficient credits. Need {required}, have {balance}.",
  "required": 8,
  "balance": 3
}
```

**Recovery Path**:
1. User can purchase credits
2. User can retry with lower tier
3. User can wait for daily credit refresh (if applicable)

**Prevention**: 
- Show credit cost + balance before submission
- Disable tier button if insufficient credits
- Show "Need X more credits" message

**Implementation**: [src/app/api/orchestrate/route.ts#L45-L54](src/app/api/orchestrate/route.ts#L45-L54)

---

## PART 2: SCOPE MAPPER FAILURES (Deep & Comprehensive Only)

### Failure Point 2.1: Scope Mapper LLM Timeout

**When**: GPT-4o-mini takes >30s to respond

**Applies To**: Deep, Comprehensive tiers ONLY

**Detection**:
```typescript
// Client-side (input-panel.tsx)
await Promise.race([
  pipeline.runScope(text),
  new Promise<null>((_, reject) => 
    setTimeout(() => reject(new Error("Scope mapping timeout after 30s")), 30000)
  ),
]);
```

**Root Cause**:
- OpenAI API latency spike
- Heavy load on GPT-4o-mini
- Network slowness
- Model overloaded

**Response**: Client-side error
```json
{
  "error": "Scope mapping timeout after 30s"
}
```

**Recovery Path**:
1. **Automatic retry**: Refresh button on UI
2. **Tier downgrade**: User can switch to Standard (single space)
3. **Manual scope**: User manually specifies spaces

**Prevention**: 
- Monitor GPT-4o-mini latency
- Set up alert if avg > 15s
- Consider fallback model (gpt-3.5-turbo)

**Code Location**: [src/components/analysis/input-panel.tsx#L86-L111](src/components/analysis/input-panel.tsx#L86-L111)

---

### Failure Point 2.2: Scope Mapper Returns Invalid JSON

**When**: LLM response can't be parsed as JSON

**Applies To**: Deep, Comprehensive tiers

**Detection**:
```typescript
// src/lib/llm.ts
export async function llmJSON<T = unknown>(opts: {...}): Promise<T> {
  const raw = await llmGenerate(...);
  
  // Try direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try markdown extraction
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      return JSON.parse(match[1].trim()) as T;
    }
    // Try object boundaries
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    }
    // All failed
    throw new Error(`Failed to parse LLM response as JSON...`);
  }
}
```

**Root Cause**:
- LLM returned incomplete JSON
- LLM included extra text outside JSON
- Special characters not escaped
- Unicode/emoji encoding issues
- LLM hallucinated bad structure

**Response**: SSE error event
```json
event: error
data: {"message": "Failed to parse LLM response as JSON. Raw: ..."}
```

**Recovery Path**:
1. **Log for analysis**: Error logged with first 200 chars of response
2. **Retry**: User can retry analysis
3. **Fallback**: None (this is critical path for Deep tier)

**Prevention**:
- Add JSON mode enforcement (if available)
- More explicit prompt structure requirements
- Add validation schema enforcement

**Code Location**: [src/lib/llm.ts#L70-L90](src/lib/llm.ts#L70-L90)

---

### Failure Point 2.3: Scope Mapper Returns Wrong Schema

**When**: JSON parses but doesn't match ScopeResult schema

**Applies To**: Deep, Comprehensive

**Detection**: Runtime when accessing `scope.spaces` — if it's not an array of objects with required fields

**Root Cause**:
- LLM understood instructions incorrectly
- Schema in prompt wasn't clear enough
- Hallucinated response structure

**Response**: SSE error when accessing fields
```
TypeError: Cannot read property 'spaces' of undefined
```

**Recovery Path**:
1. **Error logged with full response**
2. **User sees error**: "Scope mapping failed"
3. **Retry**: Same as 2.2

**Prevention**: 
- Validate schema explicitly after JSON parse
- Use TypeScript type guards
- More rigorous prompt examples

---

### Failure Point 2.4: Scope Mapper Returns 0 Spaces

**When**: LLM returns empty spaces array

**Applies To**: Deep, Comprehensive

**Detection**:
```typescript
const spaces = scope.spaces.slice(0, 3);
if (spaces.length === 0) {
  // No spaces defined
}
```

**Root Cause**:
- LLM failed to decompose
- LLM interpreted input as having no analyzable domains
- Edge case in input structure

**Response**: Downstream failure when trying to decompose
```
throw new Error("All space decompositions failed");
```

**Recovery Path**:
1. **User sees error**: "Could not identify analysis spaces"
2. **Suggests**: "Try providing more detailed context"
3. **Fallback**: Tier down to Standard (single space)

**Prevention**: 
- Scope mapper should always return ≥1 space
- Add fallback: `if (spaces.length === 0) spaces = [{ name: "Analysis", ... }]`

---

## PART 3: DECOMPOSER FAILURES (All Tiers)

### Failure Point 3.1: Decomposer LLM Timeout

**When**: Claude Sonnet takes >10s per space

**Applies To**: All tiers (all spaces)

**Detection**: Promise timeout (no explicit timeout, relies on Vercel 120s hard limit)

**Root Cause**:
- Claude overloaded
- Network latency
- Large input (50KB)
- Complex analysis (many entities)

**Response**: 
- **Quick/Standard**: SSE error
- **Deep**: Space drops from analysis

**Recovery Path**:
- **Quick/Standard**: Entire analysis fails → Retry
- **Deep**: Continue with other spaces

**Prevention**:
- Add per-request timeout tracking
- Monitor average decomposition time
- Split very large inputs

---

### Failure Point 3.2: Decomposer Returns Incoherent Text

**When**: LLM hallucinations or poor analysis

**Applies To**: All tiers

**Detection**: No explicit detection; stored as-is

**Root Cause**:
- LLM having a "bad day"
- Contradictory instructions
- Unusual input format

**Response**: Structurer receives bad input

**Recovery Path**:
1. **Structurer attempts JSON extraction** (may fail)
2. If Structurer fails → Analysis fails
3. User retries

**Prevention**:
- Structuring prompt includes instructions to validate
- Add sanity checks: "At least 5 entities?"
- Manual review process in UI

---

### Failure Point 3.3: Decomposer Produces Circular References

**When**: Entities reference each other in cycles

**Applies To**: All tiers (by design, cycles are expected)

**Detection**: Not a failure; cycles are analyzed in reasoning operations

**Root Cause**: None; this is intended behavior

**Response**: Cycles stored and analyzed

**Recovery Path**: N/A (feature, not bug)

---

## PART 4: STRUCTURER FAILURES (All Tiers)

### Failure Point 4.1: Structurer JSON Parse Failure

**When**: Structurer returns invalid JSON

**Applies To**: All tiers (all spaces)

**Detection**: llmJSON() fails with all 3 fallbacks

**Root Cause**:
- Same as Scope Mapper JSON failures
- Very large output (>16KB) with incomplete JSON

**Response**: SSE error
```json
event: error
data: {"message": "Failed to parse LLM response as JSON. Raw: ..."}
```

**Recovery Path**:
- **Quick/Standard**: Analysis fails → Retry
- **Deep**: Space drops

**Prevention**: Same as Scope Mapper

---

### Failure Point 4.2: Structurer Returns Invalid Schema

**When**: JSON parses but missing required fields

**Applies To**: All tiers

**Detection**: Runtime error when accessing `structured.entities`

**Root Cause**: LLM didn't follow structuring schema correctly

**Response**: Cascade failure

**Recovery Path**: Same as 4.1

---

### Failure Point 4.3: Structurer Returns 0 Entities

**When**: Analysis produces no entities

**Applies To**: All tiers

**Detection**: `structured.entities?.length === 0`

**Root Cause**:
- Input too vague
- LLM failed to extract entities
- Input is purely qualitative without concrete nouns

**Response**: Analysis continues but downstream features fail
- Critic has nothing to analyze
- Reasoning operations fail
- Weaver has no entities to weave

**Recovery Path**:
1. Space is stored with 0 entities
2. User sees warning: "No entities identified"
3. User can retry with more specific input

**Prevention**:
- Add sanity check: If 0 entities, try smaller chunk
- Prompt: "Identify at least 5 concrete elements"

---

## PART 5: CRITIC FAILURES (Standard+)

### Failure Point 5.1: Critic Fails

**When**: Critic LLM call fails or JSON parse fails

**Applies To**: Standard, Deep, Comprehensive

**Severity**: ⚠️ NON-CRITICAL (graceful degradation)

**Detection**:
```typescript
try {
  const critique = await runCritic(structured);
  // ... augmentation
} catch (err) {
  console.error("Critique/augment failed, using original:", err);
  // Use original structured data
  finalStructured = structured;
}
```

**Root Cause**: Same as other LLM failures

**Response**: 
1. **Logged**: "Critique/augment failed, using original"
2. **Analysis continues**: With un-augmented data
3. **User sees**: Nothing (failure is silent)

**Recovery Path**: Automatic; uses original data

**Prevention**: Log all critic failures; monitor rate

---

## PART 6: AUGMENTER FAILURES (Standard+)

### Failure Point 6.1: Augmenter Fails

**When**: Augmenter LLM fails or returns bad JSON

**Applies To**: Standard, Deep, Comprehensive

**Severity**: ⚠️ NON-CRITICAL

**Detection**: Same try-catch as Critic (5.1)

**Root Cause**: Same as Critic

**Response**: Use original structured data

**Recovery Path**: Automatic

**Impact**: Analysis misses:
- Added edges (predicted via critique)
- Added cycles (derived from edges)
- Corrected entity properties

---

## PART 7: WEAVER FAILURES (Deep+)

### Failure Point 7.1: Weaver Fails

**When**: Weaver LLM fails or JSON parse fails

**Applies To**: Deep, Comprehensive (only if 2+ spaces)

**Severity**: ⚠️ NON-CRITICAL

**Detection**:
```typescript
if (validResults.length > 1) {
  try {
    weaveResult = await runWeaver(entitySummaries);
  } catch (err) {
    console.error("Weaving failed:", err);
    // weaveResult undefined; continue
  }
}
```

**Root Cause**: 
- Entity summaries malformed
- LLM hallucinations
- Timeout

**Response**: 
1. **Logged**: "Weaving failed"
2. **Continue without bridges**: No cross-space connections identified
3. **Analysis continues**: Each space analyzed independently

**Recovery Path**: Automatic

**Impact**: Analysis misses:
- Shared variables
- Contradictions between spaces
- Cross-domain bridges

---

## PART 8: DOMAIN EXPERT FAILURES (Standard+)

### Failure Point 8.1: Domain Expert Fails

**When**: Domain Expert LLM fails

**Applies To**: Standard, Deep, Comprehensive

**Severity**: ⚠️ NON-CRITICAL

**Detection**:
```typescript
try {
  externalKnowledge = await runDomainExpert(...);
  emit("phase", JSON.stringify({ phase: "external_context", status: "done" }));
} catch (err) {
  console.error("Domain Expert failed (non-critical):", err);
  externalKnowledge = undefined;
}
```

**Root Cause**: Domain research LLM timeout or error

**Response**: 
1. **Continue without external knowledge**
2. Bridge discovery skipped (requires external entities)
3. No domain-based connections added

**Recovery Path**: Automatic

**Impact**: Analysis misses:
- External entities
- Domain-based insights
- Bridge discoveries

---

## PART 9: BRIDGE DISCOVERY FAILURES

### Failure Point 9.1: Bridge Discovery Fails

**When**: Bridge discovery LLM fails

**Applies To**: Standard+

**Severity**: ⚠️ NON-CRITICAL

**Detection**:
```typescript
if (externalKnowledge && ...) {
  try {
    bridgeDiscovery = await runBridgeDiscovery(...);
  } catch (err) {
    console.error("Bridge discovery failed (non-critical):", err);
    bridgeDiscovery = undefined;
  }
}
```

**Root Cause**: Same as other LLM failures

**Response**: Continue without bridges

**Recovery Path**: Automatic

**Impact**: Analysis misses external-internal connections

---

## PART 10: REASONING OPERATION FAILURES (Comprehensive)

### Failure Point 10.1: Any Reasoning Operation Fails

**When**: Centrality, Cycle, Cascade, Link Prediction, or Path analysis fails

**Applies To**: Comprehensive tier only

**Severity**: ⚠️ NON-CRITICAL

**Detection**: Each reasoning op wrapped in try-catch

**Root Cause**: Bad graph structure, timeout, JSON parse fail

**Response**: 
1. **Log failure**: "Centrality ranking failed"
2. **Skip reasoning operation**: That specific analysis not included
3. **Continue**: Analysis still complete without that reasoning

**Recovery Path**: Automatic

**Impact**: Analysis misses specific reasoning insight

**Code**: Individual try-catch blocks in reasoning operations

---

## PART 11: DATABASE FAILURES (After LLM Success)

### Failure Point 11.1: Space Record Insertion Fails

**When**: Supabase rejects space insert

**Applies To**: All tiers (after LLM processing)

**Severity**: ⚠️ NON-CRITICAL (analysis already complete)

**Detection**:
```typescript
const { data: spaceRow, error: spaceError } = await db
  .from("spaces")
  .insert({...})
  .single();

if (spaceError) {
  console.error("Space creation error:", spaceError);
  continue; // Skip this space
}
```

**Root Cause**:
- Database constraint violation
- Missing required field
- Supabase connection timeout
- Storage quota exceeded

**Response**: 
1. **Logged**: "Space creation error"
2. **Space skipped**: Not stored
3. **Analysis results lost** (already streamed to user though)

**Recovery Path**: User can't see results; must retry

**Impact**: Analysis discarded; user has data in browser only

---

### Failure Point 11.2: Entity Insertion Fails (Partial)

**When**: Some entities fail to insert

**Applies To**: All tiers

**Severity**: ⚠️ NON-CRITICAL (analysis recoverable)

**Detection**:
```typescript
const { data: insertedEntities } = await db
  .from("entities")
  .insert(entityInserts)
  .select("id, entity_id");

// If only some succeed, entityMap is incomplete
// Missing entities will cause edge insertion failures
```

**Root Cause**:
- Duplicate entity_id (shouldn't happen)
- Invalid field values
- Timeout

**Response**: 
1. **Partial entity map** built from successful inserts
2. **Edge insertion** skips references to missing entities
3. **Analysis incomplete** but partially stored

**Recovery Path**: User can retry; retry might succeed if timeout was cause

---

### Failure Point 11.3: Edge Insertion Fails (Partial)

**When**: Some edges fail to insert

**Applies To**: All tiers

**Severity**: ⚠️ NON-CRITICAL

**Detection**:
```typescript
for (const e of space.structured.edges ?? []) {
  const srcUuid = entityMap.get(srcId);
  const tgtUuid = entityMap.get(tgtId);

  if (!srcUuid || !tgtUuid) {
    edgesSkipped++; // Entity missing
    continue;
  }

  const { error: edgeErr } = await db.from("edges").insert({...});
  
  if (edgeErr) {
    console.error(`[Orchestrate] Edge failed ${srcId}→${tgtId}:`, edgeErr.message);
  } else {
    edgesInserted++;
  }
}

console.log(`[Orchestrate] Space: ${edgesInserted} edges inserted, ${edgesSkipped} skipped`);
```

**Root Cause**:
- Missing entity reference (src or target not found)
- Constraint violation
- Foreign key mismatch
- Cycle reference invalid

**Response**: 
1. **Logged**: "Space X: 42 edges inserted, 3 skipped"
2. **Partial graph stored**: Missing edges = missing connections
3. **Analysis incomplete** but functional

**Recovery Path**: Edges are edge nodes; analysis still works without them

---

### Failure Point 11.4: Cycle Insertion Fails

**When**: Cycle references invalid entity

**Applies To**: All tiers

**Severity**: ⚠️ NON-CRITICAL

**Detection**: Foreign key constraint violation

**Root Cause**: Entity in cycle wasn't inserted (rare)

**Response**: Cycle skipped, logged

**Recovery Path**: Automatic

---

### Failure Point 11.5: Credit Deduction Fails

**When**: Credits can't be deducted

**Applies To**: All tiers

**Severity**: ⚠️ NON-CRITICAL (analysis already complete)

**Detection**:
```typescript
if (spaceIds.length > 0) {
  const { newBalance } = await deductCredits(db, user.id, tier, spaceIds[0]);
  console.log(`Credits deducted: ${creditCheck.required} (${tier}). New balance: ${newBalance}.`);
  // If this fails, no explicit error handling — logged only
}
```

**Root Cause**: 
- Database error
- Race condition (user used credits elsewhere)
- Constraint violation

**Response**: 
1. **Logged**: "Credit deduction error"
2. **Analysis still stored**: User gets results
3. **User charged**: Or not (depends on error)

**Recovery Path**: Manual credit system review

---

## PART 12: TIMEOUT & RESOURCE EXHAUSTION

### Failure Point 12.1: Vercel Hard Timeout (120s)

**When**: Analysis exceeds Vercel's max function duration

**Applies To**: All tiers, especially Comprehensive

**Detection**: Vercel kills request; client gets disconnect

**Root Cause**:
- All LLM calls took longer than expected
- DB inserts took too long
- Network latency across the board

**Response**: 
1. **Stream aborted mid-flight**
2. **Client sees disconnect**: "Connection lost"
3. **Partial spaces stored** (incomplete)
4. **Partial spaces not stored** (DB wasn't reached)

**Recovery Path**: User must retry

**Prevention**:
- Monitor per-tier average duration
- Set up alerts at 90s marker
- Implement request queuing
- Use streaming to show intermediate results

**Time Budget** (must stay <120s):
- Quick: ~10s (safe margin)
- Standard: ~25s (safe margin)
- Deep: ~45s (comfortable margin)
- Comprehensive: ~90s (TIGHT!)

---

### Failure Point 12.2: Memory Exhaustion

**When**: Analysis too large for Node.js process

**Applies To**: Unlikely, but possible with very large analyses (Comprehensive + 50KB input)

**Severity**: 🔴 CRITICAL

**Detection**: Process crash; no error event sent

**Root Cause**:
- Massive graph (1000+ entities)
- Full JSON response in memory
- All tiers analyzed simultaneously

**Response**: Request dies; user sees timeout

**Recovery Path**: User must use lower tier

**Prevention**: 
- Monitor memory usage during analysis
- Implement streaming for large results
- Cap number of spaces
- Limit entity count per space

---

## PART 13: CASCADING FAILURES

### Cascade 1: Scope Mapper Fails → Entire Deep Analysis Fails

```
Scope Mapper Error
  ↓ (no fallback)
Deep/Comprehensive fails
  ↓
User must retry or use Standard
```

**Prevention**: Implement fallback scope (single space if scope mapper fails)

### Cascade 2: All Spaces Fail → Deep Fails

```
Space A decomposer fails
Space B decomposer fails
Space C decomposer fails
  ↓ (all failed)
validResults.length === 0
  ↓
throw Error("All space decompositions failed")
  ↓
Deep analysis fails
```

**Prevention**: Each individual space failure shouldn't cascade to entire tier

### Cascade 3: Entity Insertion Fails → Edge Insertion Fails → Graph is Disconnected

```
Insert entities: 50 succeed, 5 fail
  ↓
Build entityMap (only 50 entities)
  ↓
Try to insert edge A→B (B not in map)
  ↓
Skip edge
  ↓
Graph missing 20% of edges
```

**Impact**: Analysis incomplete but still functional

---

## PART 14: UNRECOVERABLE FAILURES

These require manual intervention:

```
┌──────────────────────────────────────────┐
│ UNRECOVERABLE FAILURE TYPES              │
├──────────────────────────────────────────┤
│ 1. User not authenticated                │
│    → Must log in                         │
│                                          │
│ 2. User no credits (402 error)           │
│    → Must purchase or wait               │
│                                          │
│ 3. Text too short/long (400 error)       │
│    → Must modify text                    │
│                                          │
│ 4. Decomposer LLM completely broken      │
│    → Must wait for LLM provider fix      │
│                                          │
│ 5. Database completely down              │
│    → Must wait for DB recovery           │
│                                          │
│ 6. Vercel hard timeout (120s)            │
│    → User must retry or use lower tier   │
│                                          │
│ 7. Memory exhaustion (OOM)               │
│    → Must optimize analysis or reduce   │
│       input size                         │
│                                          │
│ 8. OpenAI API outage                     │
│    → Must wait for OpenAI recovery       │
└──────────────────────────────────────────┘
```

---

## PART 15: DEBUGGING CHECKLIST

When analysis fails, check in this order:

```
[ ] Check console logs for [Orchestrate] / [Scope] prefixes
[ ] Check Vercel logs (vercel logs --function orchestrate)
[ ] Check browser DevTools Network tab → /api/orchestrate response
[ ] Check SSE events streaming to client
[ ] Check error message in SSE stream
[ ] Check database: Did any spaces insert?
[ ] Check credits: Was deduction attempted?
[ ] Check timestamps: How long did each phase take?
[ ] Check LLM response: Did JSON parse fail?
[ ] Check entity references: Are edge entities present?
[ ] Check special characters: Any encoding issues?
[ ] Check input size: Is text >8KB (scope truncation)?
[ ] Check tier: Was correct tier selected?
[ ] Check network latency: Any spikes in response times?
```

**Metrics to Monitor**:
1. Per-tier average duration (should stay 20-30% below max)
2. Error rate by phase (should be <1%)
3. JSON parse failures (should be <0.1%)
4. DB insertion skips (should be <5%)
5. Scope mapper timeout rate (should be <1%)

---

**Last Updated**: April 1, 2026
**Severity Levels**: 🔴 Critical | 🟠 High | ⚠️ Non-Critical
**Related**: [ANALYSIS_ROUTES_FLOWCHART.md](ANALYSIS_ROUTES_FLOWCHART.md)
