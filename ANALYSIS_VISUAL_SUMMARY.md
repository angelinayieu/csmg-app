# Analysis Routes: Visual Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER SUBMISSION                        │
│                                                             │
│  Text (20-50K chars) + Tier (Quick/Standard/Deep/Comp)    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │   INPUT VALIDATION LAYER       │
        │                                │
        │  ✓ Auth check                  │
        │  ✓ Text length                 │
        │  ✓ Tier validity               │
        │  ✓ Credit check                │
        └────────────┬───────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
       ✅ PASS              ❌ FAIL
          │                     │
          │                HTTP 400/401/402
          │
          ▼
    ┌──────────────────────┐
    │  TIER SELECTION      │
    └──┬────┬──────┬───────┘
       │    │      │
       ▼    ▼      ▼      ▼
    Quick Standard Deep Comprehensive
    (2)  (4-5)   (7)   (8+)
     │     │     │     │
     └─────┴─────┴─────┴─────→ /api/orchestrate
                               [POST SSE stream]
```

---

## Tier Execution Tree

```
QUICK TIER (1 credit, ~10s)
├─ [1] Decomposer
│      ├─ Success → [2] Structurer
│      │                ├─ Success → ✅ Return (1 space)
│      │                └─ Fail → ❌ Error
│      └─ Fail → ❌ Error
│
STANDARD TIER (3 credits, ~25s)
├─ [1] Decomposer
├─ [2] Structurer
├─ [3] Critic (non-critical)
├─ [4] Augmenter (non-critical)
├─ [5] Domain Expert (PARALLEL, non-critical)
├─ [6] Bridge Discovery (if #5 succeeded)
└─ ✅ Return (1 space + external context)
│
DEEP TIER (8 credits, ~45s)
├─ [1] Scope Mapper ⚠️ CRITICAL
│      └─ Returns 3-4 spaces
├─ For each space (PARALLEL):
│   ├─ [2] Decomposer
│   ├─ [3] Structurer
├─ [5] Domain Expert (PARALLEL with decomposition)
├─ [4] Weaver (if 2+ spaces, non-critical)
├─ [6] Meta-Synthesizer (non-critical)
├─ [7] Bridge Discovery (non-critical)
└─ ✅ Return (3-4 spaces + cross-domain analysis)
│
COMPREHENSIVE TIER (15 credits, ~90s)
├─ All of DEEP TIER
├─ For each space (REASONING OPERATIONS):
│   ├─ Centrality Ranking
│   ├─ Cycle Analysis
│   ├─ Cascade Analysis
│   ├─ Link Prediction
│   └─ Path Analysis
└─ ✅ Return (DEEP + reasoning insights)
```

---

## Failure Paths by Component

```
┌─────────────────────────────────────────────────────────┐
│                   FAILURE SEVERITY                      │
└─────────────────────────────────────────────────────────┘

🔴 CRITICAL (Analysis stops immediately)
  ├─ Scope Mapper fails (Deep/Comp only)
  ├─ Decomposer fails in Quick/Standard
  ├─ Decomposer all fail in Deep (all spaces)
  ├─ Structurer fails
  └─ JSON parsing fails (all 3 fallbacks)

🟠 HIGH (Analysis continues with degradation)
  ├─ One space fails in Deep (drops that space)
  ├─ Any space structurer fails (that space drops)
  └─ Database insertion fails (data lost)

⚠️  NON-CRITICAL (Automatic recovery)
  ├─ Critic fails → Use original data
  ├─ Augmenter fails → Use original data
  ├─ Weaver fails → Skip bridges
  ├─ Domain Expert fails → Skip external context
  ├─ Synthesis fails → Skip meta-insight
  ├─ Bridge Discovery fails → Skip bridges
  ├─ Reasoning op fails → Skip that operation
  └─ Edge insertion fails → Skip bad edges (logged)
```

---

## LLM Models & Costs

```
┌──────────────────────────────────────────────────────────┐
│          MODEL SELECTION & USAGE                        │
└──────────────────────────────────────────────────────────┘

CLAUDE SONNET (Higher quality, ~8-12s per call)
├─ Decomposition (all tiers)
├─ Structuring (all tiers)
├─ Weaving (Deep+)
├─ Meta-Synthesis (Deep+)
├─ Domain Expert (Standard+)
└─ Reasoning ops (Comprehensive)
   └─ 5 operations × N spaces = 5N calls

GPT-4O-MINI (Faster, ~3-5s per call)
├─ Scope Mapper (Deep+)
├─ Critic (Standard+)
└─ Augmenter (Standard+)


TOTAL LLM CALLS PER TIER:

Quick:           2 calls
                 (Decomposer, Structurer)
                 Time: Sonnet + Sonnet = ~16-24s (avg 10s)

Standard:        5+ calls
                 (Decomposer, Structurer, Critic, Augmenter, Domain Expert)
                 Time: ~30-40s (avg 25s)

Deep:            7+ calls (N=3-4 spaces)
                 (Scope + N×Decomposer + N×Structurer + Domain Expert + 
                  Weaver + Synthesis + Bridge Discovery)
                 Time: ~50-60s (avg 45s)

Comprehensive:   8+ + 5N calls
                 (All of Deep + 5 reasoning ops per space)
                 Time: ~90-120s (avg 90s)
```

---

## Timeline: From User Input to Result

```
0s    ├─ User submits text + tier choice
      │
1-3s  ├─ Validation (auth, credits, text length)
      ├─ Tier loaded
      │
      ├─ If DEEP/COMP: Scope Mapper runs (2-5s)
      │
3-15s ├─ Decomposer(s) run (can be parallel)
      │
15-30s├─ Structurer(s) run (per space)
      │
30-35s├─ Domain Expert runs (parallel with decomp/struct)
      │ 
35-40s├─ Critic + Augmenter run (Standard+ only)
      │
40-45s├─ Weaver runs (Deep+, if 2+ spaces)
      │
45-50s├─ Meta-Synthesis runs (Deep+)
      │
50-90s├─ Reasoning ops (Comprehensive only)
      │
90-120s├─ Database insertion
      │ ├─ Entities: 2-5s
      │ ├─ Edges: 5-10s (sequential insertions)
      │ ├─ Cycles: 1s
      │ ├─ Other metadata: 2s
      │
      └─ ✅ Complete SSE event sent, analysis stored
```

---

## Decision Flow: Which Tier?

```
START: User has text
  │
  ├─ "What's the text about?"
  │
  ├─ Exploratory / Quick feedback?
  │  └─→ QUICK (1 credit, 10s) ← "Just get the structure"
  │
  ├─ Professional / Reviewed results?
  │  └─→ STANDARD (3 credits, 25s) ← "Critique & validate"
  │
  ├─ Complex situation with multiple angles?
  │  └─→ DEEP (8 credits, 45s) ← "Multi-perspective analysis"
  │
  └─ High-stakes decision / Full insight?
     └─→ COMPREHENSIVE (15 credits, 90s) ← "Everything analyzed"
```

---

## Error Recovery Flowchart

```
Analysis Starts
  │
  ├─ Input Validation Fails?
  │  └─→ HTTP 400/401/402 (User must fix)
  │
  ├─ Scope Mapper Fails? (Deep/Comp only)
  │  └─→ SSE error event (User retries or tiers down)
  │
  ├─ Decomposer Fails?
  │  ├─ Quick/Standard? → SSE error (User retries)
  │  └─ Deep? → Drop that space, continue with others
  │
  ├─ Structurer Fails?
  │  └─→ Same as Decomposer
  │
  ├─ JSON Parsing Fails?
  │  ├─ Try 3 fallbacks (direct, markdown, boundaries)
  │  └─ All fail? → SSE error (User retries)
  │
  ├─ Critic/Augmenter Fail? (Standard+)
  │  └─→ Log & continue with original data (silent recovery)
  │
  ├─ Weaver Fails? (Deep+)
  │  └─→ Log & continue without bridges (silent recovery)
  │
  ├─ Domain Expert Fails? (Standard+)
  │  └─→ Log & continue without external context (silent recovery)
  │
  ├─ Reasoning Op Fails? (Comprehensive)
  │  └─→ Log & skip that operation (silent recovery)
  │
  ├─ DB Insertion Fails?
  │  └─→ Log & continue (data in memory, SSE sent, partial store)
  │
  └─ Timeout (>120s)?
     └─→ Vercel kills request, client sees disconnect
        (User sees partial results if any DB stores completed)
```

---

## Database Schema Touch Points

```
When each table is populated:

spaces              ← After Pipeline completes (1 row per space)
  │
  ├─→ entities     ← After Structurer completes (N entities per space)
  │
  ├─→ edges        ← After Structurer (M edges per space)
  │
  ├─→ cycles       ← After Structurer (K cycles per space)
  │
  ├─→ action_items ← After Structurer (actions extracted)
  │
  ├─→ propositions ← After Structurer (derived facts)
  │
  ├─→ contradictions ← After Weaver (if Deep+) or Augmenter (if Std)
  │
  ├─→ novel_connections ← After Augmenter (if Standard+)
  │
  ├─→ scenarios    ← After Augmenter (if Standard+)
  │
  ├─→ external_entities ← After Domain Expert (if Standard+)
  │
  └─→ synthesis_data ← Updated with reasoning results (if Comprehensive)
     └─→ meta_graph_data ← Meta-synthesis result
        └─→ reasoning_results ← All 5 reasoning operations
```

---

## Performance Budget (Must Stay <120s)

```
┌────────────────────────────────────────────────┐
│              TIME ALLOCATION                   │
└────────────────────────────────────────────────┘

QUICK: 10s / 120s = 8% ✅ Very safe
├─ Decomposer: 5-8s
├─ Structurer: 2-4s
└─ DB Storage: 1-2s

STANDARD: 25s / 120s = 21% ✅ Safe
├─ Decomposer: 5-8s
├─ Structurer: 2-4s
├─ Critic: 3-5s
├─ Augmenter: 3-5s
├─ Domain Expert: 2-4s (parallel)
└─ DB Storage: 1-2s

DEEP: 45s / 120s = 38% ✅ Comfortable
├─ Scope Mapper: 2-5s
├─ Parallel (3 spaces): 15-20s
├─ Domain Expert: 2-4s (parallel)
├─ Weaver: 3-5s
├─ Synthesis: 3-5s
├─ Bridge Discovery: 2-4s
└─ DB Storage: 5-10s

COMPREHENSIVE: 90s / 120s = 75% ⚠️ TIGHT!
├─ All of DEEP: 45s
├─ Reasoning Ops (5 per space, 3 spaces): 30-40s
│  (Can be sequential, each takes 2-3s)
└─ DB Storage: 5-10s
   TOTAL: Could reach 100-110s (risky)
```

---

## Testing Matrix

```
┌──────────────┬─────────┬────────┬────────────┐
│ TEST         │ Input   │ Tier   │ Expected   │
├──────────────┼─────────┼────────┼────────────┤
│ Min length   │ 20 chr  │ Any    │ Accept     │
│ Max length   │ 50K chr │ Any    │ Accept     │
│ Under min    │ 19 chr  │ Any    │ 400 Error  │
│ Over max     │ 50K+1   │ Any    │ 400 Error  │
│ No credits   │ Any     │ Deep   │ 402 Error  │
│ Quick only   │ 1KB     │ Quick  │ Success 1s │
│ Std full     │ 5KB     │ Std    │ Success    │
│ Deep 3sp     │ 10KB    │ Deep   │ Success    │
│ Comp full    │ 30KB    │ Comp   │ Success    │
│ Decomp fail  │ Any     │ Quick  │ Error      │
│ Struct fail  │ Any     │ Any    │ Error      │
│ Critic fail  │ 2KB     │ Std    │ Success    │
│             │        │       │ (degrade)  │
│ Weaver fail  │ 5KB     │ Deep   │ Success    │
│             │        │       │ (degrade)  │
└──────────────┴─────────┴────────┴────────────┘
```

---

## Key Metrics Dashboard

```
┌────────────────────────────────────────┐
│     MONITORING DASHBOARD               │
│                                        │
│ QUICK TIER                             │
│ ├─ Avg Duration: 10s ✅               │
│ ├─ Error Rate: 0.1% ✅                │
│ ├─ JSON Failures: 0.01% ✅            │
│ └─ Timeout Rate: 0% ✅                │
│                                        │
│ STANDARD TIER                          │
│ ├─ Avg Duration: 25s ✅               │
│ ├─ Error Rate: 0.5% ✅                │
│ ├─ JSON Failures: 0.05% ✅            │
│ └─ Timeout Rate: 0% ✅                │
│                                        │
│ DEEP TIER                              │
│ ├─ Avg Duration: 45s ✅               │
│ ├─ Error Rate: 1% ⚠️                  │
│ ├─ JSON Failures: 0.1% ⚠️             │
│ └─ Timeout Rate: 0.5% ⚠️              │
│                                        │
│ COMPREHENSIVE TIER                     │
│ ├─ Avg Duration: 90s ⚠️ (tight!)     │
│ ├─ Error Rate: 2% 🔴                  │
│ ├─ JSON Failures: 0.5% ⚠️             │
│ └─ Timeout Rate: 2% 🔴                │
│                                        │
│ GLOBAL METRICS                         │
│ ├─ Avg Credit Cost: 6.8 per analysis  │
│ ├─ Daily Analyses: 847                │
│ ├─ Success Rate: 98.7%                │
│ └─ Avg Duration: 42s                  │
└────────────────────────────────────────┘
```

---

## Quick Troubleshooting Guide

```
Problem: "Mapping scope..." takes >10s
└─→ Check OpenAI API latency
    └─→ Consider fallback to gpt-3.5-turbo

Problem: "JSON Parse Error"
└─→ Check LLM response format
    └─→ Verify prompt includes schema

Problem: "All space decompositions failed"
└─→ Check input text validity
    └─→ Try with shorter input
    └─→ Try Standard tier (single space)

Problem: Analysis completes but no database results
└─→ Check Supabase connection
    └─→ Check entity/edge insertion logs
    └─→ Results should be in browser memory (SSE stream)

Problem: "Timeout after 120s"
└─→ Lower tier (Comprehensive → Deep)
    └─→ Split analysis into multiple requests
    └─→ Reduce input size

Problem: "User out of credits"
└─→ User must purchase credits
    └─→ Or use lower tier
```

---

**Visual Summary Created**: April 1, 2026
**Purpose**: Quick visual reference for entire analysis system
**Companion**: See [README_ANALYSIS_ASSESSMENT.md](README_ANALYSIS_ASSESSMENT.md) for full documentation index
