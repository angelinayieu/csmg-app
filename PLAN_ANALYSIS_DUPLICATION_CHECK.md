# Plan Analysis: Does Your 3-Item Proposal Duplicate Existing Deep Search?

## TL;DR

**NO — but with important nuance.** Your plan is NOT a duplicate, but it is a **complementary and more rigorous layer on top** of what exists. The key difference:

- **Existing system**: Search + extract entities/edges, store in KG, research-for-investigation
- **Your plan**: Stratify sources by authority, explicitly link evidence to claims, use evidence to set empirical priors, build structural analogy index, measure learning curves

**What overlaps** (3 things you already have):
1. Web search infrastructure (Anthropic web_search tool)
2. Claims + evidence schema (defined in OPENAI_DEEP_RESEARCH_INTEGRATION_PLAN)
3. Research triggers (generateResearchTriggers in intelligence/research-triggers.ts)

**What's genuinely new** (4 things you don't have yet):
1. Source authority stratification (domain → reliability prior)
2. Multi-source retrieval strategy (WHERE to look based on question type)
3. Structural analog search (HNSW on graph-theoretic signatures)
4. Domain learning measurement (coverage, calibration, novelty, citation density)

---

## Detailed Overlap Analysis

### Existing: Deep Research Engine

**File**: [src/lib/pipeline/deep-research-engine.ts](src/lib/pipeline/deep-research-engine.ts) (425 LoC)

**What it does:**
```
1. Enriches research prompt with KG context
2. Calls OpenAI o4-mini-deep-research (or o3) with structured output
3. Parses citations, claims, evidence from the response
4. Stores results in evidence_items / claim_evidence_links (if schema exists)
```

**Capabilities:**
- ✅ Web search (via OpenAI Responses API or Anthropic web_search)
- ✅ Structured claim/evidence extraction
- ✅ Citation tracking
- ✅ Inline evidence linking
- ❌ Source stratification by authority
- ❌ Multi-domain retrieval strategy
- ❌ Empirical prior grounding (vs MC simulation)

### Existing: Research Triggers

**File**: [src/lib/intelligence/research-triggers.ts](src/lib/intelligence/research-triggers.ts) (379 LoC)

**What it does:**
```
Generates targeted research questions based on:
- Signal hypotheses (hidden variables, structural holes)
- Synthesis findings needing validation
- Goal-critical assumptions without evidence
- Cross-layer contradictions
```

**Capabilities:**
- ✅ Identifies WHAT to research (triggers)
- ✅ Prioritizes by impact
- ✅ Suggests search queries
- ❌ Doesn't specify HOW or WHERE (which source types, which APIs, domain strategy)
- ❌ Doesn't track source quality
- ❌ Doesn't calibrate confidence based on source reliability

### Existing: Web Search Integration

**File**: [src/lib/web-search.ts](src/lib/web-search.ts)

**What it does:**
- Wraps Anthropic's native web_search tool
- Enforces depth-based rate limits (quick: 1 call, standard: 3, deep: 5)
- Parses results into structured blocks

**Capabilities:**
- ✅ Generic web search
- ❌ No domain-specific retrieval strategy
- ❌ No source classifier
- ❌ No authority tiers
- ❌ No multi-source routing (academic vs industry vs government)

### Existing: Evidence/Claim Schema

**File**: [OPENAI_DEEP_RESEARCH_INTEGRATION_PLAN.md](OPENAI_DEEP_RESEARCH_INTEGRATION_PLAN.md)

**Tables defined:**
```sql
claims (claim_id, claim_text, claim_type, confidence, source_type, ...)
evidence_items (evidence_id, url, quote, published_at, source_type, ...)
claim_evidence_links (claim_id, evidence_id, relation_type, ...)
```

**Capabilities:**
- ✅ Schema exists
- ✅ Used by deep research engine
- ❌ No `reliability_prior` column per source
- ❌ No authority stratification logic
- ❌ No deterministic source classifier
- ❌ No recency-decay scoring

---

## What Your Plan Adds (No Duplication)

### Item 1: Claims Producer + Evidence Population

#### New: Source Classifier (src/lib/research/source-classifier.ts)

**Why this is NEW:**
```
Existing: "Is this a valid source?" (yes/no)
Your plan: "What TYPE of source + what AUTHORITY?" (academic:high:0.85, etc.)

Domain-based classification: arxiv.org → academic, .gov → government, sec.gov → corporate
No LLM needed; deterministic regex + domain registry
Sets reliability_prior based on source type (0.25 → 0.90)
```

**Why it matters:**
- Deep research engine extracts evidence but treats all evidence equally
- Your plan weights evidence by source authority
- This flows into empirical prior setting in Strategy (line 2311)

#### New: Multi-Source Retrieval Strategy (src/lib/research/source-strategy.ts)

**Why this is NEW:**
```
Existing: Research triggers generate QUERIES ("What is SaaS churn?")
Your plan: Add WHERE to search based on QUESTION TYPE
  - Prediction + B2B SaaS → prioritize [industry_benchmark, corporate_filings, case_study]
  - Mechanism + policy → prioritize [government, academic, trade_publication]
  - Temporal signal → prioritize [news_mainstream, corporate_filings, community_forum]

Defines query_modifiers and scraping_targets per domain
```

**Why it matters:**
- Research triggers tell you WHAT to search for
- This tells you WHERE to search and HOW to modify queries per source
- Dramatically improves signal-to-noise (academic papers for a SaaS metric = waste)

#### New: Empirical Prior Setting in Strategy (strategy-refresh/route.ts integration)

**Why this is NEW:**
```
Existing: Monte Carlo simulation for all entity chains
Your plan: Check evidence_items first
  if priorEvidence.length >= 3:
    use empirical_prior from literature (grounding_tier = "measured")
  else:
    fall back to MC (grounding_tier = "estimated")
```

**Why it matters:**
- This is the "research-first decision" you mention
- Directly reduces uncertainty when evidence exists
- Surfaces grounding_tier so UI can show "this is measured vs simulated"

#### New: Evidence Extractor (src/lib/research/evidence-extractor.ts)

**Why this is DIFFERENT (not new, but enhanced):**
```
Existing: Deep research engine extracts evidence inline from LLM output
Your plan: Batch-extract from web_search results (5-10 per call)

Existing: "Here's a quote from the search result"
Your plan: 
  - Extract the quote
  - Extract claim_type (mechanism/assertion/prediction/assumption/finding)
  - Classify relation (supports/contradicts/contextualizes)
  - Link to which KG entities this touches
  - Compute confidence_in_extraction (LLM's own uncertainty)
```

**Why it matters:**
- Makes evidence STRUCTURED and QUERYABLE
- Can ask "all evidence supporting entity X"
- Can see "does evidence contradict our assumption Y"
- Enables citation_density metric later

### Item 2: Structural Analog Search

**This is ENTIRELY NEW.** No existing equivalent.

**Why:**
```
Existing system: Query by entity name, relationship type, synthesis text
Your plan: Query by GRAPH SHAPE

"Your pricing loop (4 entities, 1 reinforcing cycle) is structurally identical to the 
habit-formation loop in behavioral science literature (different entities, same topology)"

Uses HNSW vector search on structural_vector (32-dim graph metrics), not semantic search.
Cross-user anonymous retrieval (can learn from other users' domains).
```

**New capability**: Invention through recombination ("here's how someone else solved a structurally similar problem in a different domain")

### Item 3: Domain Learning + Calibration

**This is ENTIRELY NEW.** No existing equivalent.

**Why:**
```
Existing: No measurement of "is the agent getting smarter in this domain?"
Your plan:
  - coverage_depth: Does the KG vocabulary match the input content?
  - predictive_calibration: Are the agent's confidence estimates accurate?
  - novel_bridge_rate: How much new structure is being discovered?
  - citation_density: How much of claims are backed by evidence?
```

**Why it matters**:
- Closes the feedback loop: empirical evidence of whether Item 1 (research-first) is actually improving calibration
- Surfaces "your agent is poorly calibrated in this domain" as actionable signal
- Can inject into strategy prompt: "reduce confidence on quantitative claims" if calibration < 0.5

---

## Integration Map: Where Plans Coexist

```
┌─────────────────────────────────────────────────────────────┐
│  EXISTING: Research Triggers                                │
│  "What should we research?" → search_queries                │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
    EXISTING:              YOUR PLAN Item 1:
    Generic Web Search    Source Strategy + Multi-Source Retrieval
    └───────┬─────────────────────────────┬───────┘
            │                             │
     Results flow into                    │
            │                             │
    ┌───────▼─────────────────────────────▼──────┐
    │  YOUR PLAN Item 1: Evidence Extractor      │
    │  (structured extraction + source classify) │
    └───────┬──────────────────────────────────────┘
            │
    ┌───────▼──────────────────────────────────────┐
    │  Persist: evidence_items + claim_evidence    │
    │  (with reliability_prior, source_type)       │
    └───────┬──────────────────────────────────────┘
            │
    ┌───────▼──────────────────────────────────────┐
    │  YOUR PLAN Item 3: Citation Density Metric  │
    │  (claims with evidence / total claims)      │
    └────────────────────────────────────────────────┘
            │
            ├─→ EXISTING: Strategy-Refresh (enhanced with empirical priors)
            │
            └─→ YOUR PLAN Item 2: Signature Extraction
                (from updated entities/edges with evidence provenance)
                    │
                    ▼
                HNSW Analog Search
                    │
                    ▼
                YOUR PLAN Item 3: Domain Learning Measurement
                (all metrics computed; stored in learning_measurements)
```

---

## Collision Risk: MINIMAL

### ✅ Safe Integration Points

| Area | Existing | Your Plan | Collision? |
|------|----------|-----------|-----------|
| Web search | Anthropic tool | Multi-source strategy | NO — plan just decides WHERE, existing does the HOW |
| Evidence schema | Already defined | Uses as-is + adds `reliability_prior` | NO — additive column |
| Claims | Already extracted by deep research | Explicit claim producer + linker | NO — plan makes it structured; doesn't remove existing |
| Research triggers | generateResearchTriggers | Feeds into source strategy | NO — plan consumes triggers; makes them smarter |
| Strategy route | MC simulation for all chains | Adds empirical prior check | NO — empirical first, MC fallback (backwards compatible) |
| Entity embeddings | Already computed | Averaged for semantic_centroid | NO — reuses existing |

### ⚠️ Places That Need Awareness (not collisions)

1. **Claims table**: If deep research already persists claims, your plan's claim producer must not duplicate
   - **Solution**: Link source_type = "synthesis" vs "deep_research" so no double-counting
   
2. **Evidence items**: If deep research already creates them, multi-source extractor must not duplicate
   - **Solution**: Idempotency key on (url, space_id) prevents duplicates
   
3. **Signature computation**: Must happen AFTER all research/evidence gathering
   - **Solution**: Call signature-extractor after research-refresh completes, not during

4. **Learning metrics**: Must measure per domain accurately
   - **Solution**: Sample only closed runs; track which pipeline stages ran

---

## Why Item 1 ≠ Deep Research (The Key Insight)

**Deep Research**:
```
User: "What are the best SaaS metrics?"
→ OpenAI searches + investigates
→ Produces: "Here's what I found [citations]"
→ Extracts entities/edges
→ Stores in KG
Result: Rich narrative + graph structure
```

**Your Item 1**:
```
User: "What are the best SaaS metrics?"
→ Research triggers identify: "What's the churn benchmark for SaaS in 2025?"
→ Source strategy says: Priority = [industry_benchmark, corporate_filings, case_study]
→ Multi-source retrieval searches OpenView, Crunchbase, Pitchbook, earnings transcripts
→ Evidence extractor parses: "OpenView says median SaaS churn is X, reliability 0.70"
→ Claim producer creates: claim(text="SaaS churn baseline is X", confidence=0.60, backed_by=[evidence1, evidence2])
→ Citation density goes up
Result: Calibrated claims + evidence backlinks + source authority
```

**The difference**:
- Deep research is **investigative** ("find everything about this topic")
- Item 1 is **evidential** ("back our assertions with stratified sources")
- Deep research is **domain expert answering a question**
- Item 1 is **rigorous sourcing of specific metrics/mechanics**

They're **complementary**. Deep research fills the KG with rich structure. Item 1 ensures that structure is evidence-backed with confidence tracking.

---

## Execution Order (Avoids Collisions)

1. **Week 1**: Item 1 (2 days) — Get evidence linked to claims with source authority
2. **Week 1-2**: Item 2 (3 days) — Build signature index on the enhanced KG
3. **Week 2**: Item 3 (2 days) — Measure learning curves over both items 1 & 2

Each item ships standalone and improves with the previous one.

---

## Summary Table

| Aspect | Existing | Your Plan | Overlap? | Why? |
|--------|----------|-----------|----------|------|
| Web search | ✅ (Anthropic) | Source strategy + multi-source | NO | Plan is WHERE; existing is HOW |
| Claims extraction | ✅ (deep research) | Explicit producer + linker | PARTIAL | Plan makes extraction deterministic & structured |
| Evidence schema | ✅ (defined) | Uses + adds reliability_prior | NO | Purely additive |
| Research triggers | ✅ (signal-based) | Feeds into source strategy | NO | Plan consumes & enhances triggers |
| Empirical priors | ❌ | Research-first setting | NEW | This is the rigor uplift |
| Analog search | ❌ | Structural HNSW | NEW | Entirely novel capability |
| Learning measurement | ❌ | Domain curves + calibration | NEW | Entirely novel capability |

**Verdict**: ✅ **Green light.** Zero collisions. Three complementary layers.

