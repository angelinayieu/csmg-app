# Analysis Routes: Quick Reference Table

## Tiers at a Glance

```
┌─────────────┬──────────┬────────┬──────────┬──────────┬─────────────────┐
│ TIER        │ CREDITS  │ AGENTS │ TIME     │ CRITICAL │ KEY FEATURE     │
├─────────────┼──────────┼────────┼──────────┼──────────┼─────────────────┤
│ Quick       │ 1        │ 2      │ ~10s     │ Both LLM │ Fast feedback   │
│             │          │        │          │ calls    │                 │
├─────────────┼──────────┼────────┼──────────┼──────────┼─────────────────┤
│ Standard    │ 3        │ 4-5    │ ~25s     │ Decomp + │ Quality control │
│             │          │        │          │ Struct   │ via critique    │
├─────────────┼──────────┼────────┼──────────┼──────────┼─────────────────┤
│ Deep        │ 8        │ 7      │ ~45s     │ Scope +  │ Multi-space +   │
│             │          │        │          │ Decomp + │ strategic link  │
│             │          │        │          │ Struct   │ analysis        │
├─────────────┼──────────┼────────┼──────────┼──────────┼─────────────────┤
│ Compre-     │ 15       │ 8+     │ ~90s     │ Scope +  │ Complete reasoning
│ hensive     │          │        │          │ Decomp + │ on all nodes    │
│             │          │        │          │ Struct   │                 │
└─────────────┴──────────┴────────┴──────────┴──────────┴─────────────────┘
```

## Which Prompts Run?

### Quick
```
Input Text
  ↓
[1] Decomposition.ts (Claude Sonnet)
  ↓ Raw analysis
[2] Structuring.ts (Claude Sonnet)
  ↓ JSON entities, edges, cycles
✅ Return
```

### Standard
```
Input Text
  ↓
[1] Decomposition.ts
  ↓
[2] Structuring.ts
  ↓
[3] Critic.ts (GPT-4o-mini) ← Finds gaps
  ↓
[4] Augmenter.ts (GPT-4o-mini) ← Fills gaps
  ↓
[5] Domain-Expert.ts (PARALLEL, Sonnet)
  ↓ (If external entities found)
[6] Bridge-Discovery.ts
  ↓
✅ Return
```

### Deep
```
Input Text
  ↓
[1] Scope-Mapper.ts ⚠️ CRITICAL (determines everything)
  ↓ Returns 3-4 spaces (A, B, C)
┌─────────────────────────────────────┐
│ For each space (PARALLEL):          │
│ [2] Decomposition.ts (space scoped) │
│   ↓                                 │
│ [3] Structuring.ts                  │
│   ↓                                 │
│ + [5] Domain-Expert.ts (PARALLEL)   │
└─────────────────────────────────────┘
  ↓ All spaces complete
[4] Weaver.ts ← Finds bridges
  ↓
[6] Meta-Synthesizer.ts ← Strategic view
  ↓
[7] Bridge-Discovery.ts ← Internal ↔ External
  ↓
✅ Return (3-4 spaces + connections)
```

### Comprehensive
```
= All of DEEP, then:
[8] Reasoning ops (per space):
    - Centrality ranking
    - Cycle analysis
    - Cascade impact
    - Link prediction
    - Path analysis
✅ Return (with reasoning)
```

## Failure Recovery Matrix

```
┌────────────────────────────────────────────────────────┐
│ COMPONENT        │ FAILURE    │ RECOVERY               │
├────────────────────────────────────────────────────────┤
│ Scope-Mapper     │ CRITICAL   │ ❌ Stop (Deep/Comp)    │
│                  │            │ Try: Retry endpoint    │
├────────────────────────────────────────────────────────┤
│ Decomposer       │ CRITICAL   │ Quick/Std: ❌ Stop     │
│                  │            │ Deep: Drop space       │
├────────────────────────────────────────────────────────┤
│ Structurer       │ CRITICAL   │ Same as Decomposer     │
├────────────────────────────────────────────────────────┤
│ Critic           │ FALLBACK   │ ✅ Use original        │
├────────────────────────────────────────────────────────┤
│ Augmenter        │ FALLBACK   │ ✅ Use original        │
├────────────────────────────────────────────────────────┤
│ Weaver           │ FALLBACK   │ ✅ Skip bridges        │
├────────────────────────────────────────────────────────┤
│ Domain-Expert    │ FALLBACK   │ ✅ Continue no external│
├────────────────────────────────────────────────────────┤
│ Bridge-Discovery │ FALLBACK   │ ✅ Skip bridges        │
├────────────────────────────────────────────────────────┤
│ Reasoning ops    │ FALLBACK   │ ✅ Skip reasoning      │
├────────────────────────────────────────────────────────┤
│ JSON Parse       │ CRITICAL   │ Try 3 fallbacks:       │
│                  │            │ 1. Direct parse        │
│                  │            │ 2. Markdown extract    │
│                  │            │ 3. Object boundaries   │
│                  │            │ ❌ All fail: Stop      │
├────────────────────────────────────────────────────────┤
│ DB Insert        │ FALLBACK   │ ✅ Log, continue       │
│                  │            │ (already analyzed)     │
└────────────────────────────────────────────────────────┘
```

## Decision Tree: Which Tier Should User Choose?

```
Text length < 200 chars?
├─ YES → Quick (always)
└─ NO → Ask user preferences:
        
        "Is this for quick exploration?"
        ├─ YES → Quick (1 credit, 10s)
        │
        "Do you want validated results?"
        ├─ YES → Standard (3 credits, 25s)
        │        └─ Single coherent analysis
        │
        "Do you need multiple perspectives?"
        ├─ YES → Deep (8 credits, 45s)
        │        └─ 3-4 spaces, connections, synthesis
        │
        "Is this a high-stakes decision?"
        ├─ YES → Comprehensive (15 credits, 90s)
                 └─ Deep + automated reasoning
```

## LLM Models Used

```
┌──────────────────────────────────────┐
│ Claude Sonnet (Default)              │
├──────────────────────────────────────┤
│ Used for:                            │
│ • Decomposition (all tiers)          │
│ • Structuring (all tiers)            │
│ • Weaving (Deep+)                    │
│ • Meta-Synthesis (Deep+)             │
│ • Domain-Expert (Standard+)          │
│ • Reasoning ops (Comprehensive)      │
│ • Bridge-Discovery (all tiers)       │
│                                      │
│ Characteristics:                     │
│ • Higher quality                     │
│ • ~8-12s typical latency             │
│ • Best for complex reasoning         │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ GPT-4o-mini (Optimization)           │
├──────────────────────────────────────┤
│ Used for:                            │
│ • Scope-Mapper (Deep+)               │
│ • Critic (Standard+)                 │
│ • Augmenter (Standard+)              │
│                                      │
│ Characteristics:                     │
│ • Faster (3-5s)                      │
│ • Cheaper                            │
│ • Good for structural tasks          │
└──────────────────────────────────────┘
```

## Input Validation Checklist

```
✓ 20 ≤ text.length ≤ 50000
✓ User authenticated (JWT present)
✓ Tier in ["quick", "standard", "deep", "comprehensive"]
✓ User.credits ≥ tier.cost
✓ Request body has "text" field
✓ Request body has optional "tier" field
✓ Server timeout: 120s (Vercel hard limit)
✓ Client timeout: 30s (for scope mapping only)

Failures → HTTP 400 or 402 (early exit before LLM)
```

## Time Budgets (Must Stay <120s)

```
Quick:       10s  ✅ 10% of budget
Standard:    25s  ✅ 21% of budget  
Deep:        45s  ✅ 38% of budget (tight!)
Comprehensive: 90s ✅ 75% of budget (VERY tight!)
                   
If network is slow or LLMs lag, might timeout.
Monitor: Average response time per tier.
Alert: If avg > 60% of tier budget.
```

## SSE Event Types (Streaming to Client)

```
phase:          {"phase": string, "status": "running"|"done"}
scope_done:     {"spaces": [{name, prefix}, ...]}
space_progress: {"index": num, "name": str, ...entityCount, edgeCount}
weave_done:     {"bridges": num, "contradictions": num}
complete:       {"spaceIds": [...], "rootSpaceId": str, "creditsUsed": num}
error:          {"message": str}
```

## Testing Checklist

```
[ ] Input validation
    [ ] Text < 20 chars
    [ ] Text > 50000 chars
    [ ] No auth
    [ ] Insufficient credits

[ ] Quick tier
    [ ] Text 20-100 chars → Scope skipped
    [ ] Text 100+ chars → Scope skipped
    [ ] Both decomposer & structurer succeed

[ ] Standard tier
    [ ] Decomposer fails → Error
    [ ] Structurer fails → Error  
    [ ] Critic fails → Uses original (logged)
    [ ] Augmenter fails → Uses original (logged)
    [ ] Domain Expert fails → Continues
    [ ] All combinations work

[ ] Deep tier
    [ ] Scope mapper fails → Error
    [ ] All spaces fail → Error
    [ ] Some spaces fail → Reduced spaces
    [ ] Weaver fails → Skip bridges
    [ ] Synthesis fails → Continue

[ ] Comprehensive tier
    [ ] All Deep tests pass
    [ ] Reasoning operations complete
    [ ] Reasoning op fails → Continues

[ ] JSON parsing
    [ ] Direct JSON parse works
    [ ] Markdown fence extraction works
    [ ] Object boundary extraction works
    [ ] All 3 fail → Error

[ ] Database
    [ ] All entities inserted
    [ ] All edges inserted (skip on missing refs)
    [ ] All cycles inserted (skip on constraint fail)
    [ ] Credits deducted
    [ ] Parent-child relationships set (multi-space)

[ ] Timeouts
    [ ] Stays under 120s (Vercel)
    [ ] Scope maps complete < 30s
    [ ] Parallel ops actually parallel

[ ] Edge cases
    [ ] Exactly 20 chars input
    [ ] Exactly 50000 chars input
    [ ] Empty entities returned
    [ ] Circular references
    [ ] Special characters / unicode
    [ ] Very large JSON responses (>100KB)
```

---

## File Reference Guide

| File | Purpose | Tiers Used |
|------|---------|-----------|
| [src/lib/prompts/scope-mapper.ts](src/lib/prompts/scope-mapper.ts) | Multi-space decomposition | Deep, Comprehensive |
| [src/lib/prompts/decomposition.ts](src/lib/prompts/decomposition.ts) | Entity analysis | All |
| [src/lib/prompts/structuring.ts](src/lib/prompts/structuring.ts) | JSON structure | All |
| [src/lib/prompts/critic.ts](src/lib/prompts/critic.ts) | Quality control | Standard+ |
| [src/lib/prompts/augmenter.ts](src/lib/prompts/augmenter.ts) | Enhancement | Standard+ |
| [src/lib/prompts/weaving.ts](src/lib/prompts/weaving.ts) | Cross-space bridges | Deep+ |
| [src/lib/prompts/meta-synthesizer.ts](src/lib/prompts/meta-synthesizer.ts) | Strategic synthesis | Deep+ |
| [src/lib/prompts/domain-expert.ts](src/lib/prompts/domain-expert.ts) | External research | Standard+ |
| [src/lib/prompts/bridge-discovery.ts](src/lib/prompts/bridge-discovery.ts) | Internal-external links | Standard+ |
| [src/lib/prompts/reasoning.ts](src/lib/prompts/reasoning.ts) | Advanced analytics | Comprehensive |
| [src/lib/orchestration/pipeline.ts](src/lib/orchestration/pipeline.ts) | Execution orchestration | All |
| [src/lib/orchestration/agents.ts](src/lib/orchestration/agents.ts) | LLM agent wrappers | All |
| [src/app/api/orchestrate/route.ts](src/app/api/orchestrate/route.ts) | HTTP endpoint | All |
| [src/lib/llm.ts](src/lib/llm.ts) | LLM client + JSON parsing | All |
| [src/lib/tiers.ts](src/lib/tiers.ts) | Tier definitions | All |

---

**Last Updated**: April 1, 2026
**Quick Ref Version**: 1.0
**For detailed flows, see**: [ANALYSIS_ROUTES_FLOWCHART.md](ANALYSIS_ROUTES_FLOWCHART.md)
