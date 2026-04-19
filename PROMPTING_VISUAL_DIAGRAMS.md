# Prompting System Visual Diagrams

## 1. Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT REQUEST                                       │
│                  POST /api/orchestrate                                       │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                  src/app/api/orchestrate/route.ts                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Authenticate user (Supabase)                                     │  │
│  │ 2. Validate input (text length, tier)                               │  │
│  │ 3. Check & reserve credits (ATOMIC - PHASE 2.1)                    │  │
│  │ 4. Set up SSE stream                                                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│            src/lib/orchestration/pipeline.ts                                 │
│                      runPipeline(text, tier)                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  TIER DISPATCH:                                                      │  │
│  │  ├─ "quick"         → runQuick()                                     │  │
│  │  ├─ "standard"      → runStandard()                                  │  │
│  │  ├─ "deep"          → runDeep()                                      │  │
│  │  └─ "comprehensive" → runDeep() [+ reasoning suite at API level]    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│            src/lib/orchestration/agents.ts                                   │
│                    Agent Execution Layer                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Wrappers for each agent that call LLM functions                    │  │
│  │ Each with built-in validation & error handling                      │  │
│  │  1. runScopeMapper()        → gpt-4o-mini                          │  │
│  │  2. runDecomposer()         → gpt-4o                               │  │
│  │  3. runStructurer()         → gpt-4o                               │  │
│  │  4. runCritic()             → gpt-4o-mini                          │  │
│  │  5. runAugmenter()          → gpt-4o-mini                          │  │
│  │  6. runWeaver()             → gpt-4o                               │  │
│  │  7. runMetaSynthesizer()    → gpt-4o                               │  │
│  │  8. runDomainExpert()       → gpt-4o-mini                          │  │
│  │  9. runBridgeDiscovery()    → gpt-4o-mini                          │  │
│  │ 10. runReasoningOperation() → gpt-4o                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                src/lib/llm.ts (LLM Client)                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • llmGenerate()   → Anthropic API, raw text output                   │  │
│  │ • llmJSON()       → Anthropic API, parsed JSON output                │  │
│  │ • Retry logic     → 3 retries on failure                             │  │
│  │ • Timeout guard   → Via withTimeout()                                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│         src/lib/orchestration/timeouts.ts (PHASE 2.3)                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ withTimeout() wrapper protects every LLM call                       │  │
│  │ Per-space and per-phase timeouts prevent cascading failure           │  │
│  │ Returns: { success: bool, data/error }                              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│         src/lib/validation.ts (PHASE 2.2)                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • Zod schemas for all output types (12 schemas)                      │  │
│  │ • Validate before database storage                                   │  │
│  │ • Return: { valid: bool, errors: [], data }                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Database Storage Layer                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ • batchInsert() → Store all spaces, entities, edges, cycles         │  │
│  │ • commitReservation() → Mark credits as consumed (PHASE 2.1)        │  │
│  │ • Return: spaceIds for client                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLIENT RESPONSE                                        │
│              SSE Stream + spaceIds + metadata                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Quick Tier Execution Flow

```
┌─────────────────┐
│ Input: "text"   │
└────────┬────────┘
         ↓
┌──────────────────────────────────────┐
│ Agent 1: Decomposition (quick)        │
│  • Model: gpt-4o                      │
│  • Tokens: 8K max                     │
│  • Output: Raw text                   │
│  • Time: 5-6s                         │
└────────┬────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ Agent 2: Structuring (quick)          │
│  • Model: gpt-4o                      │
│  • Tokens: 16K max                    │
│  • Validator: validateStructured      │
│  • Fallback: createFallback           │
│  • Output: JSON structure             │
│  • Time: 3-4s                         │
└────────┬────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ Validation Layer (PHASE 2.2)          │
│  • validateStructuralIntegrity()      │
│  • autoCorrectStructuralIssues()      │
│  • validateConsistency()              │
└────────┬────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ Output: PipelineResult                │
│  • spaceData[0]: single space         │
│  • No enrichment                      │
│  • Total time: ~10s                   │
└──────────────────────────────────────┘
```

---

## 3. Standard Tier Execution Flow

```
                                   ┌─────────────────────┐
                                   │ Domain Expert (bg)  │
                                   │ • Starts async      │
                                   │ • Non-blocking      │
                                   │ • gpt-4o-mini       │
                                   │ • Time: 3-5s        │
                                   │ • Returns when done │
                                   └────────┬────────────┘
                                            │
                                            ↓ (continues in background)
                                   ┌─────────────────────┐
                                   │ Bridge Discovery    │
                                   │ • If Domain Expert  │
                                   │ • Connects internal ↔ external
                                   │ • Time: 2-3s        │
                                   └─────────────────────┘
                                   
┌─────────────────┐
│ Input: "text"   │
└────────┬────────┘
         ↓
┌──────────────────────────────────────┐
│ Phase 1a: Decomposition (standard)    │
│  • Model: gpt-4o                      │
│  • Tokens: 8K max                     │
│  • Time: 5-6s                         │
└────────┬────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ Phase 1b: Structuring (standard)      │
│  • Model: gpt-4o                      │
│  • Tokens: 16K max                    │
│  • Output: StructuredDecomposition v1 │
│  • Time: 3-4s                         │
└────────┬────────────────────────────┘
         ↓
┌──────────────────────────────────────┐
│ Phase 2a: Critique ⏱️ 20s timeout     │
│  • Model: gpt-4o-mini                 │
│  • Input: Entity/edge/cycle summaries │
│  • Output: CritiqueResult              │
│  • Time: 8-10s (or timeout)           │
└────────┬────────────────────────────┘
         ↓
    ┌────┴─────────┐
    │              │
Critique OK?    Critique Failed?
    │              │
    ↓              ↓
  YES            SKIP AUGMENT
    │              │
    ↓              └────┐
┌──────────────────────────────────────┐ │
│ Phase 2b: Augment ⏱️ 15s timeout      │ │
│  • Model: gpt-4o-mini                 │ │
│  • Input: v1 + CritiqueResult         │ │
│  • Output: StructuredDecomposition v2 │ │
│  • Time: 5s (or timeout)              │ │
└────────┬────────────────────────────┘ │
         └────┬─────────────────────────┘
              ↓
┌──────────────────────────────────────┐
│ Output: PipelineResult                │
│  • spaceData[0]: single space         │
│  • structured: v2 (augmented)         │
│  • externalKnowledge: domain expert   │
│  • bridgeDiscovery: internal ↔ ext   │
│  • Total time: ~25s                   │
└──────────────────────────────────────┘
```

---

## 4. Deep Tier Execution Flow (Parallel)

```
TIMELINE (seconds):

0s      ┌────────────────────────────────────────────────────────────┐
        │ Phase 0: Scope Mapping (single LLM call)                  │
        │  • gpt-4o-mini                                            │
        │  • Identify 3-4 analytical spaces                         │
        │  • Time: 3s                                               │
        └────────┬───────────────────────────────────────────────────┘
                 │
3s      ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 1: Sibling Context Capping (PHASE 2.5)             │
        │  • Local algorithm, no LLM                               │
        │  • Size cap: 50KB per space                              │
        │  • Time: <1s                                             │
        └────────┬──────────────────────────────────────────────────┘
                 │
~3s     ┌────────┴──────────────────────────────────────────────────┐
        │                                                           │
        │  ┌─────────────────────────┐  ┌──────────────────────┐  │
        │  │ Domain Expert (ASYNC)   │  │ Phase 2: Parallel    │  │
        │  │ fires here, continues   │  │ Decompose+Structure  │  │
        │  │ in background           │  │ (per space)          │  │
        │  │ • gpt-4o-mini           │  │                      │  │
        │  │ • 3-5s                  │  │ Space 0:             │  │
        │  └─────────────────────────┘  │  decompose: 0-20s    │  │
        │                                │  structure: 20-25s   │  │
        │                                │                      │  │
        │                                │ Space 1: (parallel)  │  │
        │                                │  decompose: 0-20s    │  │
        │                                │  structure: 20-25s   │  │
        │                                │                      │  │
        │                                │ Space 2: (parallel)  │  │
        │                                │  decompose: 0-20s    │  │
        │                                │  structure: 20-25s   │  │
        │                                │                      │  │
33s     │                                │ All done: max 30s    │  │
        │  ← (awaits if needed)          └──────────────────────┘  │
        └─────────────────────────────────────────────────────────┘
                 │
33s     ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 3: Parallel Critique+Augment (per space) 🚀        │
        │                                                           │
        │  Space 0:                                                │
        │   Critique: 33-53s                                       │
        │   Augment: 53-63s                                        │
        │                                                           │
        │  Space 1: (parallel)                                     │
        │   Critique: 33-53s                                       │
        │   Augment: 53-63s                                        │
        │                                                           │
        │  Space 2: (parallel)                                     │
        │   Critique: 33-53s                                       │
        │   Augment: 53-63s                                        │
        │                                                           │
63s     │ All done: max 30s                                        │
        └────────┬──────────────────────────────────────────────────┘
                 │
63s     ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 4: Weave (sequential, 2+ spaces)                   │
        │  • gpt-4o                                                │
        │  • Connects spaces via shared variables                  │
        │  • Time: 5-7s                                            │
        └────────┬──────────────────────────────────────────────────┘
                 │
70s     ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 5: Meta-Synthesis (sequential)                     │
        │  • gpt-4o                                                │
        │  • Strategic cross-space analysis                        │
        │  • Time: 8-10s                                           │
        └────────┬──────────────────────────────────────────────────┘
                 │
80s     ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 6: Wait for Domain Expert (if not done)            │
        │  • Should be done by now (started at 3s)                │
        │  • If not, waits here                                    │
        │  • Result: DomainExpertResult | undefined               │
        └────────┬──────────────────────────────────────────────────┘
                 │
80s     ┌────────▼──────────────────────────────────────────────────┐
        │ Phase 7: Bridge Discovery (if Domain Expert done)        │
        │  • gpt-4o-mini                                           │
        │  • Connects internal entities ↔ external knowledge       │
        │  • Time: 2-3s                                            │
        └────────┬──────────────────────────────────────────────────┘
                 │
82s     └────────▼──────────────────────────────────────────────────┐
                 │ COMPLETE ✓
                 │ ~58s actual (with parallelization)
                 │ vs 88s sequential
                 │ = 33% speedup

Output: {
    spaceData: [space0, space1, space2],  // Multiple spaces
    weaveResult: { bridges, contradictions },
    synthesisResult: strategic findings,
    externalKnowledge: domain expert subgraph,
    bridgeDiscovery: internal ↔ external connections
}
```

---

## 5. Parallelization Comparison

```
QUICK TIER (No Parallelization):
Time ──────────────────────────────────────→
│
├─ Decompose [═══════]
│                     └─ Structure [═══════]
│
└─ Total: ~10s


STANDARD TIER (1 Async Operation):
Time ──────────────────────────────────────→
│
├─ Decompose [═══════]
│                     └─ Structure [═══════]
│                                          ├─ Critique [═════════════]
│                                          │                         └─ Augment [═════════]
│                                          │
│         ┌─────────────────────────────────┘
│         │ Domain Expert [═════] (runs async, overlaps)
│         │
└─────────┴──────────────────────────────────→
Total: ~25s


DEEP TIER (Full Parallelization):
Time ──────────────────────────────────────────────────→
│
├─ Scope [═══]
│            ├─ Capping [─]
│            │
│            │ ┌─ Domain Expert [════════] (ASYNC)
│            │ │
│            │ ├─ Space 0: Decompose [═════════════] Structure [═════]
│            │ ├─ Space 1: Decompose [═════════════] Structure [═════]
│            │ ├─ Space 2: Decompose [═════════════] Structure [═════]
│            │
│            ├─ Space 0: Critique [═════════════] Augment [════]
│            ├─ Space 1: Critique [═════════════] Augment [════]
│            ├─ Space 2: Critique [═════════════] Augment [════]
│            │
│            ├─ Weave [═════════]
│            │
│            ├─ Meta-synthesis [════════════]
│            │
│            ├─ Wait Domain Expert [if needed]
│            │
│            └─ Bridge Discovery [════]
│
└────────────────────────────────────────────────────→
Total: ~58s (vs 88s sequential = 33% speedup)
```

---

## 6. Fault Tolerance & Degradation Paths

```
Standard Tier Error Handling:

Input → Decompose
         ├─ Fails → Return 500 error + cancel credits ❌
         └─ OK → Structure
                  ├─ Fails → Return 500 error + cancel credits ❌
                  └─ OK → Critique (with 20s timeout)
                           ├─ Timeout/Fails → SKIP AUGMENT ⚠️
                           │              ├─ Skip augment
                           │              ├─ Use original structure
                           │              └─ Continue
                           └─ OK → Augment (with 15s timeout)
                                   ├─ Timeout/Fails → Use original ⚠️
                                   │              ├─ Use original structure
                                   │              └─ Continue
                                   └─ OK → Return result ✓

                        Domain Expert (non-blocking)
                        ├─ Fails/Times out → Ignore ⚠️
                        │                └─ Continue without enrichment
                        └─ OK → Bridge Discovery
                                ├─ Fails → Ignore ⚠️
                                │      └─ Continue without bridges
                                └─ OK → Add to result ✓


Deep Tier Error Handling:

Input → Scope
         ├─ Fails → Return 500 error + cancel credits ❌
         └─ OK → Sibling Context Capping
                  └─ OK → Domain Expert (ASYNC, non-blocking)
                          │ (continues in background)
                          │
                          ├─ Space 0: Decompose (20s timeout)
                          │   ├─ Timeout/Fails → Mark space as failed ⚠️
                          │   │            └─ Remove from results
                          │   └─ OK → Structure (10s timeout)
                          │       ├─ Timeout/Fails → Mark space as failed ⚠️
                          │       │            └─ Remove from results
                          │       └─ OK → continue
                          │
                          ├─ Space 1: Same as Space 0 (parallel)
                          ├─ Space 2: Same as Space 0 (parallel)
                          │
                          ├─ All spaces failed → Return 500 error ❌
                          ├─ Some spaces failed → Continue with successful ones ⚠️
                          │
                          ├─ Parallel Critique+Augment (per space)
                          │   ├─ Space N Critique timeout → Use original structure ⚠️
                          │   ├─ Space N Augment timeout → Use original structure ⚠️
                          │   └─ Space N succeeds → Use augmented structure ✓
                          │
                          ├─ Weave
                          │   ├─ Only 1 space → Skip weave (N/A)
                          │   ├─ Fails → Continue without bridges ⚠️
                          │   └─ OK → Use weave result ✓
                          │
                          ├─ Meta-Synthesis
                          │   ├─ Fails → Continue without synthesis ⚠️
                          │   └─ OK → Use synthesis result ✓
                          │
                          ├─ Wait for Domain Expert
                          │   └─ (by now should be done)
                          │
                          ├─ Bridge Discovery (if domain expert done)
                          │   ├─ Fails → Ignore ⚠️
                          │   └─ OK → Add to result ✓
                          │
                          └─ Return best-effort result ✓
                                (some spaces, minimal enrichment)
```

---

## 7. Credit System Flow (Atomic - PHASE 2.1)

```
Request arrives
     ↓
checkCredits(userId, tier)
├─ Query user_credits
├─ Return { hasCredits: bool, required, balance }
└─ IF insufficient → Return 402 (Payment Required)
     ↓
reserveCredits(userId, tier)
├─ INSERT credit_reservations { status: 'reserved', userId, tier, amount }
├─ Return reservationId
└─ STATUS: RESERVED ← Can still cancel here, credits not yet consumed
     ↓
runPipeline(...)
├─ Execute analysis
└─ Emit SSE events
     ↓
validatePipelineResult(result)
├─ Zod validation
├─ IF invalid → Return validation errors
└─ IF invalid → Cancel Reservation ← Credits returned to user
     ↓
IF validation failed:
     └─ cancelReservation(reservationId)
        ├─ DELETE / UPDATE credit_reservations { status: 'cancelled' }
        └─ STATUS: CANCELLED ← Credits returned
           (Never transitioned from RESERVED)
     ↓
IF validation passed:
     ├─ batchInsert(spaceData)
     ├─ Store to Supabase (spaces, entities, edges, cycles)
     └─ Continue
     ↓
commitReservation(reservationId)
├─ UPDATE credit_reservations { status: 'committed' }
├─ UPDATE user_credits { balance -= amount }
└─ STATUS: COMMITTED ← Credits permanently consumed
     ↓
Return 200 with spaceIds


GUARANTEES:
┌─────────────────────────────────────────────────────────────┐
│ Atomicity: Reservation never partially applied             │
│ Idempotency: Same reservation ID always produces same state│
│ Rollback: If any step fails, credits automatically returned│
│ No Lost Credits: Even on cascade failure, credits reserved │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Timeout Protection Mechanism (PHASE 2.3)

```
withTimeout(promise, timeoutMs, description)
     ↓
┌─────────────────────────────────────────┐
│ Start timer: setTimeout(reject, timeoutMs)
│ Race two promises:
│   1. promise (LLM call)
│   2. timeout rejection
│
│ Returns:
│   { success: true, data: result }       ← Completed in time
│   { success: false, error: "Timeout" }  ← Exceeded timeout
│   { success: false, error: "Error msg"} ← Promise rejected
└─────────────────────────────────────────┘
     ↓
Per-space timeouts (Deep tier):
     ├─ Each space gets 20s for decompose + 10s for structure
     ├─ If Space A times out at 20s → doesn't block Space B
     ├─ Space A marked as failed, removed from results
     └─ Spaces B & C continue normally
     ↓
Per-phase timeouts (Standard tier):
     ├─ Critique: max 20s
     ├─ Augment: max 15s
     ├─ If Critique times out → skip augment, use original
     └─ Continue with result
     ↓
Global Vercel timeout:
     └─ 120s hard limit (maxDuration)
        ├─ Deep tier uses ~58s (comfortable margin)
        ├─ If we exceed 120s, Vercel terminates request
        └─ Per-space timeouts prevent this


BENEFIT:
┌──────────────────────────────────────┐
│ Prevents cascading failures          │
│ Graceful degradation on slow LLM     │
│ Predictable response times           │
│ No hung requests                     │
└──────────────────────────────────────┘
```

---

## 9. LLM Model Selection Decision Tree

```
Task Type?
    │
    ├─→ Structural Analysis
    │    (finding gaps, missing edges, inconsistencies)
    │    └─→ gpt-4o-mini (cheap, specialized)
    │        ├─ Critic
    │        ├─ Augmenter
    │        └─ Scope Mapper
    │
    ├─→ Creative Synthesis
    │    (generating new insights, complex reasoning)
    │    └─→ gpt-4o (full model)
    │        ├─ Decomposition
    │        ├─ Structuring
    │        ├─ Weaving
    │        ├─ Meta-synthesis
    │        └─ Reasoning suite
    │
    ├─→ Knowledge Retrieval
    │    (domain expertise, external research)
    │    └─→ gpt-4o-mini (good for bounded tasks)
    │        ├─ Domain Expert
    │        └─ Bridge Discovery
    │
    └─→ Complex Multi-step
         (chaining multiple prompts)
         └─→ gpt-4o (needed for context)
             └─ Reasoning operations


Cost vs Quality Trade-off:
    
    gpt-4o       : $1.50/M in, $6/M out   ← Expensive but best quality
                   Use for: Reasoning, synthesis, creative work
    
    gpt-4o-mini  : $0.15/M in, $0.60/M out ← Cheap, good for analysis
                   Use for: Structural analysis, recommendations
    
    Example Deep tier cost (220K tokens total):
    ├─ Decompose×3: 42K on gpt-4o = ~$0.09
    ├─ Structure×3: 42K on gpt-4o = ~$0.09
    ├─ Critique×3: 18K on gpt-4o-mini = ~$0.003
    ├─ Augment×3: 78K on gpt-4o-mini = ~$0.008
    ├─ Weave: 14K on gpt-4o = ~$0.03
    ├─ Meta-synth: 27K on gpt-4o = ~$0.05
    ├─ Domain Expert: 6K on gpt-4o-mini = ~$0.001
    └─ Bridge Discovery: 14K on gpt-4o-mini = ~$0.002
    
    TOTAL: ~$0.16 (vs 8 credits = $0.16) ✓ Matches credit cost
```

---

## 10. Context Window Usage Visualization

```
Standard Context Window: 128K tokens

Decomposition Phase:
    ├─ System prompt: 2.5K
    ├─ User text: 2K
    ├─ Sibling context: 5K (Deep tier, capped at 50KB = ~12.5K)
    ├─ Total input: 9.5K
    └─ Remaining: 118.5K ✓ (plenty of room)

Augmentation Phase (largest):
    ├─ System prompt: 3K
    ├─ Original structure (JSON): 10K
    ├─ Critique result: 2K
    ├─ Total input: 15K
    └─ Remaining: 113K ✓ (room for full output)

Weaving Phase:
    ├─ System prompt: 2K
    ├─ Space entity summaries (3×): 5K
    ├─ Total input: 7K
    └─ Remaining: 121K ✓ (very comfortable)

Meta-Synthesis Phase:
    ├─ System prompt: 2K
    ├─ Spaces summary: 3K
    ├─ Bridges summary: 1K
    ├─ Contradictions: 1K
    ├─ Total input: 7K
    └─ Remaining: 121K ✓ (very comfortable)


PHASE 2.5 IMPACT (Context Capping):
    
    BEFORE (unbounded):
    ├─ Sibling context per space: 50KB-270KB+
    ├─ Decomposition input: 60-275K tokens
    ├─ Weaving input: 200K+ tokens
    └─ Risk: Exceeds 128K context window → errors/truncation
    
    AFTER (capped):
    ├─ Sibling context per space: 50KB max
    ├─ Decomposition input: 12-15K tokens
    ├─ Weaving input: 7-10K tokens
    └─ Result: Always within context window ✓
               75% reduction in tokens used
               67% reduction in memory
```

---

## Summary Diagram: All Tiers in One View

```
QUICK                STANDARD               DEEP                  COMPREHENSIVE
───────────────────────────────────────────────────────────────────────────
~10s                 ~25s                   ~45s                  ~50s+
1 credit             3 credits              8 credits             8+ credits
───────────────────────────────────────────────────────────────────────────

Decompose (5s) ←─────→ Decompose (5s) ←────→ Scope (3s) ────────→ Scope (3s)
    ↓                      ↓                     ↓                   ↓
Structure (3s) ←─────→ Structure (3s) ←────→ Sibling Cap (1s) ←──→ Sibling Cap (1s)
                           ↓                     ↓↓↓                 ↓↓↓
                        Critique (10s)      [Parallel]         [Parallel]
                           ↓                Decompose×3        Decompose×3
                        Augment (5s)        Structure×3        Structure×3
                           ↓                   ↓                   ↓
                    Domain Expert           Critique×3         Critique×3
                        (bg, 3s)            Augment×3          Augment×3
                           ↓                   ↓                   ↓
                   Bridge Discovery         Weave             + Weave
                                               ↓                   ↓
                                         Meta-Synthesis     Meta-Synthesis
                                               ↓                   ↓
                                         Domain Expert      + Domain Expert
                                               ↓                   ↓
                                        Bridge Discovery    Bridge Discovery
                                               ↓                   ↓
                                            DONE                 Reasoning
                                                                Suite +15s
───────────────────────────────────────────────────────────────────────────
1 space              1 space                Multi-space        Multi-space
Basic analysis       Dense analysis         Cross-space        + Advanced
                     + enrichment           synthesis          reasoning
───────────────────────────────────────────────────────────────────────────
```

