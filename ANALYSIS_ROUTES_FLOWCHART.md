# InterAxis Analysis: Complete Prompting Routes & Failure Scenarios

## Executive Summary

This document maps **every possible execution path** through the analysis system, including:
- 4 analysis tiers (Quick, Standard, Deep, Comprehensive)
- 10+ LLM prompts per analysis
- 50+ potential failure points
- Graceful degradation paths

**Total possible routes**: ~2,000+ unique combinations (depending on failures, parallelization, fallbacks)

---

## 1. ANALYSIS TIERS & HIGH-LEVEL FLOW

### 1.1 Tier Comparison

| Tier | Credits | Agents | Duration | Multi-Space | Key Difference |
|------|---------|--------|----------|-------------|-----------------|
| **Quick** | 1 | 2 | ~10s | ❌ No | Decompose + Structure only |
| **Standard** | 3 | 4 | ~25s | ❌ No | + Critique + Augment |
| **Deep** | 8 | 7 | ~45s | ✅ Yes | + Scope + Weave + Synthesis |
| **Comprehensive** | 15 | 8 | ~90s | ✅ Yes | + Auto-Reasoning on all spaces |

---

## 2. ENTRY POINT: `/api/orchestrate` (POST)

### 2.1 Input Validation Layer

```
┌─────────────────────────────────┐
│ User submits text + tier choice │
└──────────────┬──────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   ✅ PASS       ❌ FAIL
        │             │
        │      (See Section 2.2)
        ▼
  Tier Config
  Loads
```

### 2.2 Validation Failures (Early Exit)

| Failure Point | Condition | Response | HTTP Status |
|---------------|-----------|----------|-------------|
| **No Auth** | Missing user token | `{ error: "Unauthorized" }` | 401 |
| **No Text** | Text missing or empty | `{ error: "Text is required" }` | 400 |
| **Text Too Short** | `text.length < 20` | `{ error: "Text too short" }` | 400 |
| **Text Too Long** | `text.length > 50000` | `{ error: "Text must be... 20-50k chars" }` | 400 |
| **Invalid Tier** | Tier not in `["quick","standard","deep","comprehensive"]` | Defaults to "quick" | 200 |
| **Insufficient Credits** | User balance < tier cost | `{ error: "Insufficient credits...", required: X, balance: Y }` | 402 |

**Code Location**: [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts#L7-L50)

---

## 3. TIER-SPECIFIC EXECUTION PATHS

### 3.1 QUICK TIER ROUTE

```
┌──────────────────────────────────────┐
│ QUICK TIER (Credits: 1, Time: ~10s)  │
└──────────────────────────────────────┘
                  │
                  ▼
        ┌─────────────────┐
        │ Agent 1: Scope  │ ❌ SKIPPED
        │ (runScopeMapper)│    (Single space assumed)
        └─────────────────┘
                  │
                  ▼
     ┌────────────────────────┐
     │ Agent 2: Decomposer    │
     │ (runDecomposer)        │
     │ ◆ System Prompt        │
     │   "Analyze for 15-25   │
     │    entities, 30-50     │
     │    edges, 3+ loops"    │
     │ ◆ Model: Claude Sonnet │
     │ ◆ MaxTokens: 8192      │
     │ ◆ Temp: 0.5            │
     │ ◆ Output: Text         │
     └────────────────────────┘
             ▲        │
        ┌────┴────────┴──────┐
        │                    │
     SUCCESS              FAILURE
        │                    │
        ▼                    ▼
  Parse raw            Log error +
  decomposition        Return: Error
        │              with exception
        ▼              message
  ┌────────────────────────┐
  │ Agent 2b: Structurer   │
  │ (runStructurer)        │
  │ ◆ System Prompt        │
  │   "Convert text to     │
  │    structured JSON"    │
  │ ◆ Model: Claude Sonnet │
  │ ◆ MaxTokens: 16000     │
  │ ◆ Temp: 0.3            │
  │ ◆ Output: JSON         │
  └────────────────────────┘
          ▲        │
     ┌────┴────────┴──────┐
     │                    │
  SUCCESS              FAILURE
     │                    │
     ▼                    ▼
  Return:          JSON Parse Error
  PipelineResult   (See Section 4)
   + entities
   + edges
   + cycles
     │
     ▼
  Store in DB
  (Section 5)
```

**Prompts Used**:
- [Decomposition Prompt](src/lib/prompts/decomposition.ts)
- [Structuring Prompt](src/lib/prompts/structuring.ts)

**Failure Scenarios**:
1. **Decomposer LLM fails** → Error propagates, analysis stops
2. **Structurer LLM fails** → Raw text is partially saved, but no structured data
3. **JSON parsing fails** → Fallback to extract JSON from markdown fences
4. **Both fail** → Exception logged, SSE error event sent

---

### 3.2 STANDARD TIER ROUTE

```
┌──────────────────────────────────────────┐
│ STANDARD TIER (Credits: 3, Time: ~25s)   │
└──────────────────────────────────────────┘
                  │
                  ▼
        ┌─────────────────┐
        │ Agent 1: Scope  │ ❌ SKIPPED
        │ (runScopeMapper)│    (Single space)
        └─────────────────┘
                  │
                  ▼
     ┌────────────────────────┐
     │ Agent 2: Decomposer    │
     │ (runDecomposer)        │
     │ ◆ Model: Claude Sonnet │
     └────────────────────────┘
               │
            ┌──┴───┐
         SUC │      │ FAIL
            ▼      ▼
           Parse  → ERROR
        decomp
               │
               ▼
     ┌────────────────────────┐
     │ Agent 2b: Structurer   │
     │ (runStructurer)        │
     │ ◆ Model: Claude Sonnet │
     └────────────────────────┘
               │
            ┌──┴──────┐
         SUC │         │ FAIL
            ▼         ▼
         JSON        ERROR
           │
           ▼
     ┌────────────────────────┐
     │ Agent 3: Critic        │
     │ (runCritic)            │
     │ ◆ Analyzes:            │
     │   - Orphan entities    │
     │   - Centrality ranking │
     │   - Missing cycles     │
     │   - Predicted edges    │
     │   - Density gaps       │
     │ ◆ Model: GPT-4o-mini   │
     │ ◆ MaxTokens: 4000      │
     │ ◆ Temp: 0.3            │
     │ ◆ Output: JSON         │
     └────────────────────────┘
            ▲        │
        ┌───┴────────┴──────┐
        │                   │
     SUCCESS           FAILURE
        │                   │
        │              ❌ Non-Critical
        │              (Log, continue
        │               with original)
        ▼
     ┌────────────────────────┐
     │ Agent 4: Augmenter     │
     │ (runAugmenter)         │
     │ ◆ Takes:               │
     │   - Original struct    │
     │   - Critique           │
     │ ◆ Adds:                │
     │   - New edges          │
     │   - New cycles         │
     │   - Corrected entities │
     │ ◆ Model: GPT-4o-mini   │
     │ ◆ MaxTokens: 16000     │
     │ ◆ Temp: 0.4            │
     └────────────────────────┘
              │
           ┌──┴──────┐
        SUC │         │ FAIL
           ▼         ▼
        Use      Use Original
     Augmented   + Continue
           │
           ▼
     ┌─────────────────────────────┐
     │ Agent 7: Domain Expert      │
     │ (runDomainExpert)           │
     │ ◆ Runs in parallel (!)      │
     │ ◆ System Prompt             │
     │   "External research on     │
     │    identified domains"      │
     │ ◆ Model: Claude Sonnet      │
     │ ◆ MaxTokens: 4000           │
     │ Output: External entities   │
     │           + context         │
     │ ◆ Non-blocking failure      │
     └─────────────────────────────┘
              │
           ┌──┴──────────┐
        SUC │             │ FAIL
           ▼             ▼
        External     Continue
        Entities     (No external
           │         knowledge)
           ▼
     ┌──────────────────────┐
     │ Agent 8: Bridge      │
     │ Discovery            │
     │ (runBridgeDiscovery) │
     │ ◆ Condition: only if │
     │   external entities  │
     │   exist              │
     │ ◆ Model: Claude      │
     │ Output: Connections  │
     │ between internal ↔   │
     │ external             │
     └──────────────────────┘
             │
          ┌──┴────┐
       SUC │       │ FAIL
          ▼       ▼
       Store    Skip
       Bridges  (Non-critical)
           │
           ▼
        Store All in DB
        + Return Result
```

**Prompts Used**:
- [Decomposition](src/lib/prompts/decomposition.ts)
- [Structuring](src/lib/prompts/structuring.ts)
- [Critic](src/lib/prompts/critic.ts)
- [Augmenter](src/lib/prompts/augmenter.ts)
- [Domain Expert](src/lib/prompts/domain-expert.ts)
- [Bridge Discovery](src/lib/prompts/bridge-discovery.ts)

**Failure Handling**:
- ✅ Critic fails → Use original structured data (graceful degradation)
- ✅ Domain Expert fails → Continue without external knowledge (non-blocking)
- ✅ Bridge Discovery fails → Skip bridges (non-critical)

---

### 3.3 DEEP TIER ROUTE

```
┌──────────────────────────────────────┐
│ DEEP TIER (Credits: 8, Time: ~45s)   │
└──────────────────────────────────────┘
                  │
                  ▼
     ┌────────────────────────┐
     │ PHASE 0: Agent 1       │
     │ Scope Mapper           │
     │ (runScopeMapper)       │
     │ ◆ Analyzes text for    │
     │   multi-space decomp   │
     │ ◆ Returns 3-4 spaces   │
     │   (capped for time)    │
     │ ◆ Model: GPT-4o-mini   │
     │ ◆ MaxTokens: 1500      │
     │ ◆ Temp: 0.2            │
     │ ◆ Output:              │
     │   - space names        │
     │   - prefixes (A,B,C)   │
     │   - descriptions       │
     │   - key concepts       │
     │   - priority ranking   │
     └────────────────────────┘
              ▲        │
          ┌───┴────────┴──────┐
          │                   │
       SUCCESS           FAILURE
          │                   │
          │              ❌ CRITICAL
          │              (Stops analysis)
          │
          ▼
     Build Sibling Context
     (For boundary awareness)
          │
          ▼
     ┌──────────────────────────────┐
     │ PHASE 1 (PARALLEL):          │
     │ For each of N spaces:        │
     │                              │
     │ ┌─────────────────────┐      │
     │ │ Agent 2: Decomposer │      │
     │ │ (per space)         │      │
     │ │ ◆ Takes:            │      │
     │ │   - Full input text │      │
     │ │   - Space scope     │      │
     │ │   - Sibling context │      │
     │ │ ◆ Model: Sonnet     │      │
     │ │ ◆ MaxTokens: 8192   │      │
     │ │ ◆ Temp: 0.5         │      │
     │ │ ◆ Output: Raw       │      │
     │ │   decomposition     │      │
     │ └─────────────────────┘      │
     │          ▲        │          │
     │      ┌───┴────────┴──────┐   │
     │      │                   │   │
     │   SUCCESS           FAILURE  │
     │      │                   │   │
     │      │              ❌ Partial
     │      │              (Space
     │      │               dropped)
     │      ▼
     │ ┌─────────────────────┐      │
     │ │ Agent 2b: Structurer│      │
     │ │ (per space)         │      │
     │ │ ◆ Model: Sonnet     │      │
     │ │ ◆ MaxTokens: 16000  │      │
     │ │ ◆ Temp: 0.3         │      │
     │ │ ◆ Output: JSON      │      │
     │ │   structured        │      │
     │ │   decomposition     │      │
     │ └─────────────────────┘      │
     │          ▲        │          │
     │      ┌───┴────────┴──────┐   │
     │      │                   │   │
     │   SUCCESS           FAILURE  │
     │      │                   │   │
     │      │              ❌ Partial
     │      │              (Space
     │      │               dropped)
     │      ▼
     │   Per-space complete
     │   (store in results)
     │
     │ ALSO PARALLEL:
     │ ┌──────────────────────────┐
     │ │ Agent 7: Domain Expert   │
     │ │ (runDomainExpert)        │
     │ │ ◆ Analyzes all domains  │
     │ │   across scope           │
     │ │ ◆ Model: Sonnet         │
     │ │ ◆ Output: External       │
     │ │   knowledge + entities   │
     │ │ ◆ Non-blocking fail      │
     │ └──────────────────────────┘
     │
     └──────────────────────────────┘
              │
        ┌─────┴──────┐
     ALL OK      Some/None
        │         Succeeded
        ▼         │
        │    ┌────┴─────┐
        │    │           │
        │    │    ❌ All Failed
        │    │       STOP
        │    ▼
        │    Filter valid
        │    spaces
        │
        ▼
     ┌──────────────────────┐
     │ PHASE 2: Agent 5     │
     │ Weaver (if 2+ spaces)│
     │ (runWeaver)          │
     │ ◆ Takes entity       │
     │   summaries from all │
     │   spaces             │
     │ ◆ Finds:             │
     │   - Shared vars      │
     │   - Bridges          │
     │   - Contradictions   │
     │ ◆ Model: Sonnet      │
     │ ◆ MaxTokens: 4000    │
     │ ◆ Temp: 0.3          │
     │ ◆ Output: JSON       │
     │   bridges, contrad.  │
     └──────────────────────┘
             ▲        │
         ┌───┴────────┴──────┐
         │                   │
      SUCCESS           FAILURE
         │                   │
         │              ❌ Non-Critical
         │              (Continue without)
         │
         ▼
     ┌──────────────────────────┐
     │ PHASE 3: Agent 6         │
     │ Meta-Synthesizer         │
     │ (runMetaSynthesizer)     │
     │ ◆ Takes meta-graph       │
     │   summary:               │
     │   - All spaces           │
     │   - All bridges          │
     │   - Contradictions       │
     │ ◆ Generates:             │
     │   - Strategic insights   │
     │   - Master bottleneck    │
     │   - Cross-space leverage │
     │ ◆ Model: Sonnet          │
     │ ◆ MaxTokens: 6000        │
     │ ◆ Temp: 0.4              │
     │ ◆ Output: JSON synthesis │
     └──────────────────────────┘
              │
           ┌──┴────┐
        SUC │       │ FAIL
           ▼       ▼
        Store    Skip
           │
           ▼
     ┌──────────────────────┐
     │ Agent 8: Bridge      │
     │ Discovery            │
     │ (internal ↔ external)│
     │ ◆ Same as Standard   │
     └──────────────────────┘
             │
          ┌──┴────┐
       SUC │       │ FAIL
          ▼       ▼
       Store    Skip
           │
           ▼
        Store All in DB
        + Return Result
```

**Prompts Used**:
- [Scope Mapper](src/lib/prompts/scope-mapper.ts) ⚠️ **CRITICAL**
- [Decomposition](src/lib/prompts/decomposition.ts) (per space, with sibling context)
- [Structuring](src/lib/prompts/structuring.ts) (per space)
- [Domain Expert](src/lib/prompts/domain-expert.ts) (parallel)
- [Weaver](src/lib/prompts/weaving.ts)
- [Meta-Synthesizer](src/lib/prompts/meta-synthesizer.ts)
- [Bridge Discovery](src/lib/prompts/bridge-discovery.ts)

**Critical Differences from Standard**:
- ⚠️ Scope Mapper is CRITICAL (failure stops analysis)
- ✅ Scope determines # of LLM calls (3-4 spaces × 2 agents = 6-8 calls)
- ✅ Critique/Augment are **SKIPPED** (saved for Comprehensive)
- ✅ Parallel decomposition (faster for multi-space)

---

### 3.4 COMPREHENSIVE TIER ROUTE

```
┌─────────────────────────────────────┐
│ COMPREHENSIVE TIER                  │
│ (Credits: 15, Time: ~90s)           │
└─────────────────────────────────────┘
                  │
                  ▼
        All of DEEP TIER
          (Phases 0-3)
                  │
                  ▼
     ┌────────────────────────┐
     │ ADDITIONAL PHASE 4:    │
     │ Auto-Reasoning         │
     │ (runReasoning)         │
     │ ◆ For EACH space:      │
     │                        │
     │ For each entity pair:  │
     │ ┌──────────────────┐   │
     │ │ Reasoning Op 1:  │   │
     │ │ Centrality       │   │
     │ │ Ranking          │   │
     │ │                  │   │
     │ │ Which entities   │   │
     │ │ are most central?│   │
     │ │ Impact if        │   │
     │ │ removed?         │   │
     │ │                  │   │
     │ │ Prompt:          │   │
     │ │ REASONING_PROMPTS│   │
     │ │ .centrality      │   │
     │ │                  │   │
     │ │ Model: Sonnet    │   │
     │ │ Output: Rankings │   │
     │ └──────────────────┘   │
     │                        │
     │ ┌──────────────────┐   │
     │ │ Reasoning Op 2:  │   │
     │ │ Cycle Analysis   │   │
     │ │                  │   │
     │ │ Trace ALL        │   │
     │ │ feedback loops   │   │
     │                  │   │
     │ │ Prompt:          │   │
     │ │ REASONING_PROMPTS│   │
     │ │ .cycles          │   │
     │ │                  │   │
     │ │ Model: Sonnet    │   │
     │ │ Output: Cycles   │   │
     │ └──────────────────┘   │
     │                        │
     │ ┌──────────────────┐   │
     │ │ Reasoning Op 3:  │   │
     │ │ Cascade Analysis │   │
     │ │                  │   │
     │ │ For each entity: │   │
     │ │ - Simulate fail  │   │
     │ │ - Trace cascade  │   │
     │ │ - Measure impact │   │
     │ │                  │   │
     │ │ Prompt:          │   │
     │ │ REASONING_PROMPTS│   │
     │ │ .cascade(entity) │   │
     │ │                  │   │
     │ │ Model: Sonnet    │   │
     │ │ Output: Blast    │   │
     │ │ radius, effects  │   │
     │ └──────────────────┘   │
     │                        │
     │ ┌──────────────────┐   │
     │ │ Reasoning Op 4:  │   │
     │ │ Link Prediction  │   │
     │ │                  │   │
     │ │ Find missing     │   │
     │ │ connections not  │   │
     │ │ explicitly       │   │
     │ │ stated but       │   │
     │ │ likely exist     │   │
     │ │                  │   │
     │ │ Prompt:          │   │
     │ │ REASONING_PROMPTS│   │
     │ │ .link_prediction │   │
     │ │                  │   │
     │ │ Model: Sonnet    │   │
     │ │ Output: Predicted│   │
     │ │ edges, confidence│   │
     │ └──────────────────┘   │
     │                        │
     │ ┌──────────────────┐   │
     │ │ Reasoning Op 5:  │   │
     │ │ Path Analysis    │   │
     │ │ (on key pairs)   │   │
     │ │                  │   │
     │ │ For critical     │   │
     │ │ source-target    │   │
     │ │ pairs:           │   │
     │ │ - Find path      │   │
     │ │ - Explain flow   │   │
     │ │ - Identify       │   │
     │ │   weak links     │   │
     │ │                  │   │
     │ │ Prompt:          │   │
     │ │ REASONING_PROMPTS│   │
     │ │ .path(from, to)  │   │
     │ │                  │   │
     │ │ Model: Sonnet    │   │
     │ │ Output: Path +   │   │
     │ │ interpretation   │   │
     │ └──────────────────┘   │
     │                        │
     └────────────────────────┘
              │
           ┌──┴──────┐
        SUC │         │ FAIL
           ▼         ▼
        Store    Skip Reasoning
        Results   (Non-critical)
           │
           ▼
        Store All in DB
        (including reasoning
         results)
        + Return Result
```

**Additional Prompts Used**:
- [Centrality Reasoning](src/lib/prompts/reasoning.ts#centrality)
- [Cycle Tracing](src/lib/prompts/reasoning.ts#cycles)
- [Cascade Analysis](src/lib/prompts/reasoning.ts#cascade)
- [Link Prediction](src/lib/prompts/reasoning.ts#link_prediction)
- [Path Analysis](src/lib/prompts/reasoning.ts#path)

**Difference from Deep**:
- ✅ Includes automatic reasoning on all spaces
- ✅ Each space gets 5 reasoning operations
- ✅ Failures are non-blocking (skip reasoning, keep everything else)

---

## 4. JSON PARSING FAILURES (ALL TIERS)

Every LLM call that expects JSON output can fail. Here's the fallback chain:

```
LLM Response: "```json\n{valid JSON}\n```"
         │
         ▼
    ┌──────────────┐
    │ Attempt 1:   │
    │ JSON.parse() │ ← Direct parse
    └──────────────┘
         │
    ┌────┴────┐
 PASS │         │ FAIL
     │         ▼
     │      Try 2: Markdown
     │      Fence extraction
     │      Regex: /```...```/
     │      Extract & parse
     │
     │    ┌─────┐
    ✅    │     │ ❌
         ▼     ▼
       Parse  Try 3:
       JSON   Object boundary
              Find first {
              Find last }
              Extract & parse
              
              ┌─────┐
              │     │
            ✅     ❌
                  │
                  ▼
              ❌ FATAL:
              "Failed to parse
               LLM response
               as JSON"
              
              → Logged
              → SSE error
                event
              → Cascade
                failure
```

**Code**: [src/lib/llm.ts#llmJSON](src/lib/llm.ts#L70-L90)

**Root Causes of JSON Failures**:
1. LLM returned incomplete JSON
2. LLM included extra text outside JSON
3. LLM failed to follow schema
4. LLM produced nested JSON mismatch
5. Special characters not escaped
6. Unicode/emoji encoding issues

---

## 5. DATABASE STORAGE FAILURES

After successful analysis, results are stored in Supabase. Failures here are **non-fatal** (already analyzed):

```
Try to Store Analysis Results
         │
    ┌────┴──────────────────────┐
    │                           │
    ▼                           ▼
 ✅ Insert              ❌ Insert Failed
 Space Record          (Space creation
    │                   failed)
    ▼                   │
 Get Space ID      ❌ Continue without
    │             storing (rare)
    ▼             Results exist in
 Insert Entities   memory, send to
    │             frontend via SSE
    ▼
 Build entityMap
    │
    ▼
 Insert Edges
 (INDIVIDUALLY)
    │
    ├─→ Edge 1: ✅
    ├─→ Edge 2: ❌ (skipped)
    ├─→ Edge 3: ✅
    ├─→ Edge 4: ✅
    │
    └─→ Log: "3 edges stored,
            1 skipped"
    │
    ▼
 Insert Cycles
 ┌────────────────┐
 │ IMPORTANT:     │
 │ If edge refs   │
 │ invalid cycle, │
 │ Supabase       │
 │ foreign key    │
 │ constraint     │
 │ fails, cycle   │
 │ insertion      │
 │ skipped        │
 │ (logged)       │
 └────────────────┘
    │
    ▼
 Insert:
 - Action Items
 - Propositions
 - Novel Connections
 - Contradictions
 - Scenarios
    │
    ▼
 Set parent-child
 relationships
 (multi-space only)
    │
    ▼
 Deduct Credits
    │
    ├─ ✅ Success: New balance logged
    └─ ❌ Fail: Still send complete,
          log error
    │
    ▼
 Store synthesis
 data (metadata)
    │
    ▼
 Store external
 knowledge (if
 Domain Expert ran)
    │
    ▼
 Store bridge
 discoveries
    │
    ▼
 ✅ COMPLETE!
 Send SSE event
 with space IDs
```

**Non-Fatal Edge Cases**:
- Missing entity references (edge skipped)
- Invalid cycle IDs (cycle skipped)
- Constraint violations (item skipped, logged)
- Credit deduction fails (analysis still complete)

**Code**: [src/app/api/orchestrate/route.ts#Storage](src/app/api/orchestrate/route.ts#L100-L400)

---

## 6. TIMEOUT SCENARIOS

### 6.1 Vercel Hard Timeout

```
Endpoint: /api/orchestrate
Max Duration: 120s (2 minutes)

Analysis Phases:
├─ Quick:           ~10s    ✅ Safe
├─ Standard:        ~25s    ✅ Safe
├─ Deep:            ~45s    ✅ Safe
└─ Comprehensive:   ~90s    ✅ Safe (tight!)
                             
If any phase exceeds 120s:
   ↓
Vercel kills request
   ↓
Response aborted (partial SSE stream)
   ↓
Frontend receives disconnect
   ↓
User sees "Connection lost"
   ↓
Spaces may be partially stored
```

**Time Budget Breakdown for Deep/Comprehensive**:
- Scope Mapper: 3-5s
- Parallel Decompose+Structure: 20-30s
- Weave: 5-10s
- Meta-Synthesizer: 5-10s
- Reasoning (Comprehensive only): 30-40s
- DB Storage: 5-10s
- **Total: ~90-110s** (comfortable margin)

### 6.2 Client-Side Timeout

```
Hook: use-pipeline.ts
Timeout: 30s (hardcoded Promise.race)

When runScope() takes >30s:
   ↓
Promise.race() resolves to timeout error
   ↓
Scope mapping fails
   ↓
User must retry or choose manual spaces
```

---

## 7. COMPLETE FAILURE MATRIX

### By Tier

| Tier | Critical Failures | Non-Critical Failures | Graceful Degradation |
|------|-------------------|----------------------|----------------------|
| **Quick** | Decomposer, Structurer | None | None (fail hard) |
| **Standard** | Decomposer, Structurer | Critic, Augmenter, Domain Expert | Use original data if Critic fails |
| **Deep** | Scope Mapper, any space Decomposer/Structurer (all fail) | Weave, Synthesis, Domain Expert | Skip multi-space features |
| **Comprehensive** | Same as Deep | Reasoning operations | Skip reasoning, keep analysis |

### By Component

| Component | Failure Mode | Impact | Recovery |
|-----------|--------------|--------|----------|
| **Scope Mapper** | LLM timeout, JSON parse fail | ❌ CRITICAL (Deep/Comp stops) | Must retry with full endpoint or manual scope |
| **Decomposer** | LLM timeout, hallucination | ❌ CRITICAL (Quick/Standard stops), ⚠️ PARTIAL (Deep: space drops) | Retry space or tier down |
| **Structurer** | JSON parse fail | ❌ CRITICAL (same as Decomposer) | Retry or manual review |
| **Critic** | LLM fail | ✅ NON-CRITICAL (use original) | Use un-augmented analysis |
| **Augmenter** | LLM fail | ✅ NON-CRITICAL (use original) | Use un-augmented analysis |
| **Weaver** | LLM fail, invalid refs | ✅ NON-CRITICAL (proceed single-space) | Continue without bridges |
| **Meta-Synthesizer** | LLM fail | ✅ NON-CRITICAL (no synthesis) | Continue without meta-insight |
| **Domain Expert** | LLM timeout, API fail | ✅ NON-CRITICAL (parallel task) | Continue without external context |
| **Bridge Discovery** | LLM fail, JSON parse | ✅ NON-CRITICAL (skip bridges) | Continue with internal only |
| **Reasoning Ops** | LLM fail, bad entity refs | ✅ NON-CRITICAL (Comp tier) | Skip reasoning, keep base analysis |
| **DB Storage** | Constraint violation, timeout | ✅ NON-CRITICAL (in memory) | Results available via SSE, retry insert |

---

## 8. ERROR RESPONSE EXAMPLES

### 8.1 Early Validation Error

```json
{
  "error": "Insufficient credits. Need 8, have 3.",
  "required": 8,
  "balance": 3
}
HTTP: 402
```

### 8.2 During Analysis (SSE Error Event)

```
event: error
data: {"message": "All space decompositions failed"}

event: error
data: {"message": "Failed to parse LLM response as JSON"}

event: error  
data: {"message": "Scope mapper timed out after 30s"}
```

### 8.3 After Partial Completion (Mixed Result)

```json
{
  "spaceIds": ["space-1", "space-2"],
  "rootSpaceId": "space-1",
  "tier": "deep",
  "creditsUsed": 8,
  "warnings": [
    "Scope mapper took 12s (near timeout)",
    "Space 3 decomposition failed, dropped",
    "Weaver failed, no cross-space bridges",
    "2 edges skipped due to missing entity refs"
  ]
}
```

---

## 9. INPUT-TO-OUTPUT DECISION TREE

```
START: User submits text
         │
         ├─ Length < 20?
         │  └─→ 400 Error: Too short
         │
         ├─ Length > 50000?
         │  └─→ 400 Error: Too long
         │
         ├─ No tier specified?
         │  └─→ Default to "quick"
         │
         ├─ Tier not valid?
         │  └─→ Default to "quick"
         │
         ├─ User balance insufficient?
         │  └─→ 402 Error: Insufficient credits
         │
         └─→ ✅ PROCEED
         
            Tier selection:
            
            ├─ QUICK?
            │  └─→ Decompose + Structure (2 agents, ~10s)
            │
            ├─ STANDARD?
            │  └─→ Decompose + Structure + Critique + Augment + Domain Expert (4-5 agents, ~25s)
            │     └─ Single space assumed
            │
            ├─ DEEP?
            │  └─→ Scope + 3x (Decompose + Structure) + Domain Expert (parallel) + Weave + Synthesis (7 agents, ~45s)
            │     └─ Multi-space with cross-domain analysis
            │
            └─ COMPREHENSIVE?
               └─→ DEEP + Reasoning on all spaces (8+ agents, ~90s)
                  └─ Reasoning includes: centrality, cycles, cascades, link prediction, paths
                  
            Each tier for each space:
            ├─ Run LLM prompts
            ├─ Parse JSON (with fallbacks)
            ├─ Perform graceful degradation on failures
            ├─ Store in DB
            └─ Stream progress via SSE
            
            Final output:
            ├─ If all success: Complete space(s) with all analysis
            ├─ If partial failure: Reduced space(s) with degraded features
            └─ If total failure: Error event + user messaging
```

---

## 10. PROMPT ORCHESTRATION MAP

```
PROMPT HIERARCHY:
(What runs when, under what conditions)

┌──────────────────────────────────────────────┐
│ TIER: QUICK                                  │
├──────────────────────────────────────────────┤
│ 1. decomposition.ts                          │
│    • Expects: Full input text                │
│    • Returns: Raw text analysis              │
│ 2. structuring.ts                            │
│    • Expects: Raw text from decomposer       │
│    • Returns: JSON with entities, edges      │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ TIER: STANDARD                               │
├──────────────────────────────────────────────┤
│ 1. decomposition.ts (same as Quick)          │
│ 2. structuring.ts (same as Quick)            │
│ 3. critic.ts                                 │
│    • Expects: Structured data from #2       │
│    • Analyzes: Orphans, centrality, cycles  │
│    • Returns: Critique JSON                  │
│ 4. augmenter.ts                              │
│    • Expects: Original structured (#2) +    │
│             Critique (#3)                    │
│    • Returns: Enhanced structured JSON       │
│ 5. domain-expert.ts (parallel)               │
│    • Expects: Domain list from #2            │
│    • Returns: External entities + context    │
│ 6. bridge-discovery.ts (if #5 succeeds)     │
│    • Expects: Internal entities (#2,#4) +   │
│             External entities (#5)           │
│    • Returns: Connection bridges             │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ TIER: DEEP                                   │
├──────────────────────────────────────────────┤
│ PHASE 0:                                     │
│ 1. scope-mapper.ts ⚠️ CRITICAL               │
│    • Expects: Full input text                │
│    • Returns: 3-4 space definitions          │
│                                              │
│ PHASE 1 (PARALLEL, per space):               │
│ 2. decomposition.ts (per space, +scope)      │
│    • Expects: Full text + space scope +      │
│             sibling context                  │
│    • Returns: Raw analysis for space         │
│ 3. structuring.ts (per space)                │
│    • Expects: Raw from #2                    │
│    • Returns: Space-specific JSON            │
│ 4. domain-expert.ts (ALL spaces, parallel)   │
│    • Expects: All domains from #1            │
│    • Returns: External entities              │
│                                              │
│ PHASE 2:                                     │
│ 5. weaving.ts (if 2+ spaces)                 │
│    • Expects: Entity summaries from all #3   │
│    • Returns: Bridges, contradictions        │
│                                              │
│ PHASE 3:                                     │
│ 6. meta-synthesizer.ts                       │
│    • Expects: All space data + weave         │
│    • Returns: Strategic synthesis            │
│                                              │
│ PHASE 4:                                     │
│ 7. bridge-discovery.ts                       │
│    • Expects: Internal (#3) + External (#4)  │
│    • Returns: Cross-domain bridges           │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ TIER: COMPREHENSIVE                          │
├──────────────────────────────────────────────┤
│ ALL of DEEP, then:                           │
│                                              │
│ PHASE 5 (REASONING, per space):              │
│ 8. reasoning.ts operations:                  │
│    a) centrality - Top entities by degree    │
│    b) cycles - All feedback loops            │
│    c) cascade - Failure impact analysis      │
│    d) link_prediction - Missing edges        │
│    e) path - Influence flow analysis         │
│                                              │
│ Each runs on structured graph                │
│ Returns: Reasoning results (stored)          │
└──────────────────────────────────────────────┘
```

---

## 11. SSE EVENT SEQUENCE

Example stream for successful Deep analysis:

```
// User submits, credits checked
event: phase
data: {"phase": "scope", "status": "running"}

// Scope mapping completes
event: phase
data: {"phase": "scope", "status": "done"}

event: scope_done
data: {"spaces": [{"name": "Product Strategy", "prefix": "A"}, {"name": "Market Dynamics", "prefix": "B"}, {"name": "Competitive Landscape", "prefix": "C"}]}

// Parallel decomposition starts
event: phase
data: {"phase": "decomposing", "status": "running"}

event: space_progress
data: {"index": 0, "name": "Product Strategy", "prefix": "A", "phase": "decomposing", "status": "running"}

// Space A decomposition completes, structuring starts
event: space_progress
data: {"index": 0, "name": "Product Strategy", "prefix": "A", "phase": "structuring", "status": "running"}

// Space A structuring completes
event: space_progress
data: {"index": 0, "name": "Product Strategy", "prefix": "A", "phase": "done", "status": "done", "entityCount": 18, "edgeCount": 42}

// Similar for Space B and C...
event: space_progress
data: {"index": 1, "name": "Market Dynamics", "prefix": "B", "phase": "done", "status": "done", "entityCount": 15, "edgeCount": 35}

event: space_progress
data: {"index": 2, "name": "Competitive Landscape", "prefix": "C", "phase": "done", "status": "done", "entityCount": 22, "edgeCount": 51}

// External knowledge runs in parallel
event: phase
data: {"phase": "external_context", "status": "done"}

// Weaving starts
event: phase
data: {"phase": "weaving", "status": "running"}

// Weaving completes
event: weave_done
data: {"bridges": 8, "contradictions": 2}

// Meta-synthesis
event: phase
data: {"phase": "synthesizing", "status": "running"}

event: phase
data: {"phase": "synthesizing", "status": "done"}

// Bridge discovery between internal and external
event: phase
data: {"phase": "bridge_discovery", "status": "done", "bridges": 5}

// Final completion
event: complete
data: {"spaceIds": ["space-uuid-1", "space-uuid-2", "space-uuid-3"], "rootSpaceId": "space-uuid-1", "tier": "deep", "creditsUsed": 8}
```

---

## 12. EDGE CASES & SPECIAL HANDLING

### 12.1 Text Exactly 20 Characters

```
✅ Passes validation (>= 20)
→ Classified as "small"
→ Uses "quick" tier (if not specified)
→ Scope mapper skips (text.length < 400)
→ Single space analysis
```

### 12.2 Empty Entities in Analysis

```
Decomposer returns: {"entities": []}

Consequences:
- Critic fails (no entities to analyze)
- Augmenter gets empty data
- Weaver gets empty summaries
- All Reasoning ops fail (no graph)
- Analysis completes with warnings:
  "No entities identified in analysis"
```

### 12.3 Circular Entity References

```
Edge: Entity A → Entity B
Edge: Entity B → Entity C
Edge: Entity C → Entity A  ← Creates cycle

Detection:
- Cycles detection in Structuring
- Marked as: classification: "reinforcing_positive/negative"
- Stored in cycles table
- Analyzed in Reasoning (cycle operation)
```

### 12.4 Massive Text (50000 characters)

```
✅ Passes validation (<= 50000)
→ Scope mapper truncates to 8000 chars
→ Decomposer gets full 50000
→ Structurer processes full decomposition
→ Possible warnings:
  "Text truncated for scope mapping"
  "Large input may timeout"
```

### 12.5 User Runs Out of Credits Mid-Analysis

```
Before /api/orchestrate:
- Check: user credits >= tier cost
- If insufficient: Return 402 error
- User charged ONLY if checks pass

During /api/orchestrate:
- Analysis runs
- At end: Credit deduction attempted
- If fails: Log error, but don't cancel analysis
  (User already spent the compute)
```

---

## 13. MONITORING & OBSERVABILITY

### Logging Points

```
[Scope] Starting scope mapping for XXXX chars
[Scope] Completed in XXXms
[Orchestrate] Starting TIER tier analysis...
[Orchestrate] Pipeline completed in XXXms
[Orchestrate] Space A: XX edges inserted, X skipped
[Orchestrate] Edge failed A→B: (reason)
[Orchestrate] Critic/augment failed, using original
[Orchestrate] Domain Expert failed (non-critical)
[Orchestrate] Bridge discovery failed (non-critical)
```

### Metrics to Track

- Per-tier average duration
- Per-tier failure rate
- JSON parse failures (%)
- Scope mapper timeout rate
- DB insertion skips (% of edges)
- Credit system accuracy

---

## 14. RECOMMENDATIONS FOR PRODUCTION

### Immediate

1. **Add explicit retries** for critical components (Scope Mapper, Decomposer, Structurer)
2. **Implement request queuing** to handle Vercel timeout pressure
3. **Add comprehensive logging** for all LLM calls (request tokens, response time, model used)
4. **Set up monitoring alerts** for timeout rates > 5%

### Short-term

1. **Implement caching** for identical inputs (same text → same scope/decomposition)
2. **Add fallback models** (e.g., gpt-3.5-turbo for faster/cheaper fallback)
3. **Implement space-level parallelization** (start visualization before all spaces complete)
4. **Add user abort mechanism** (cancel ongoing analysis)

### Medium-term

1. **Implement streaming responses** for large analyses (start showing results as they complete)
2. **Add reasoning operation selection** (let users pick specific analyses instead of all 5)
3. **Implement multi-request batching** (split large analyses across multiple 120s requests)
4. **Add analysis versioning** (save intermediate states for retry)

---

**Generated**: April 1, 2026
**Assessment Level**: Complete system trace with all failure paths
**Scope**: 4 tiers × 10 prompts × 50+ failure points
