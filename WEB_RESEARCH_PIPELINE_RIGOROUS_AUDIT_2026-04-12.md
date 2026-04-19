# Web Research Pipeline Rigorous Audit (April 12, 2026)

## Scope
Audit of all execution paths that claim to perform web-connected research, extract useful information, and feed strategy/user outputs.

---

## 1) Pipeline inventory: where web research actually runs

### A. Main analysis pipeline (UI orchestrated)
- Trigger: `use-pipeline` runs research as Phase 1.5, then synthesis, then optional auto-research rerun from triggers.
- Endpoints used:
  - `/api/pipeline/research`
  - `/api/pipeline/synthesize`
  - `/api/pipeline/strategy-refresh`
- Evidence:
  - Research phase + endpoint call: `src/lib/hooks/use-pipeline.ts` lines 354, 362
  - Auto-research pass: lines 575, 585

### B. Intelligence Radar manual/scheduled trigger path
- Trigger: `use-intelligence-radar` calls `/api/orchestrate` with `researchOnly: true`.
- Endpoint chain:
  - `/api/orchestrate` (research-only mode) -> internal fetch to `/api/pipeline/research`
- Evidence:
  - Trigger body includes `researchOnly`: `src/lib/hooks/use-intelligence-radar.ts` line 747
  - Research-only forwarding support (including optional `focus_areas`): `src/app/api/orchestrate/route.ts` lines 65-66

### C. Deep Refresh iterative path
- Trigger: `useDeepRefresh` runs repeated critique->research passes, then synthesize.
- Endpoint chain:
  - `/api/pipeline/critique`
  - `/api/pipeline/research`
  - `/api/pipeline/synthesize`
- Evidence:
  - Re-research stage: `src/lib/hooks/use-deep-refresh.ts` lines 145, 162-163

### D. Scheduled research metadata path (not a server scheduler)
- `/api/pipeline/research-schedule` stores cadence and computes `next_run_at`.
- Actual execution is client-side check in `use-intelligence-radar` (`Date.now() > nextRun`).
- Evidence:
  - Schedule compute: `src/app/api/pipeline/research-schedule/route.ts` lines 19, 152-153
  - Client-side run condition: `src/lib/hooks/use-intelligence-radar.ts` lines 798, 800

---

## 2) What “deep research” currently does well

1. **Real web tool support exists** (Anthropic native tool):
   - `web_search_20250305` with depth-based `max_uses`.
   - Evidence: `src/lib/web-search.ts` lines 37, 39.

2. **Multi-pass budget logic exists**:
   - Per-depth pass caps and search budgets; continuation signals across passes.
   - Evidence: `src/lib/pipeline/research-depth-engine.ts` lines 67-74, 149.

3. **Findings propagate into synthesis + strategy context**:
   - Research provenance, hidden signals, edge-conditions, continuation signals injected downstream.
   - Evidence: `src/app/api/pipeline/synthesize/route.ts` lines 754-759, 1011; `src/app/api/pipeline/strategy-refresh/route.ts` lines 238, 290+.

4. **Some user-visible source surfacing exists**:
   - External context shows domain links from `source_url` and `citation_urls`.
   - Evidence: `src/components/synthesis/external-context-section.tsx` lines 38, 47, 139.

---

## 3) Critical weaknesses limiting true deep research value

## 3.1 Reliability + provenance weaknesses

### W1) Silent fallback removes web-search capability
If Anthropic call fails, research falls back to OpenAI JSON generation with no web tool access, while still returning “research” outputs.
- Evidence: `src/app/api/pipeline/research/route.ts` lines 572, 574, 582.
- Impact: “Deep research” may degrade into parametric memory without strong user-visible warning.

### W2) Citation-to-entity linking is weak heuristic
Entity provenance links are inferred by keyword overlap between entity name words and citation text/title.
- Evidence: `src/app/api/pipeline/research/route.ts` lines 818-821, 826.
- Impact: false matches, weak attribution, and confidence inflation risk.

### W3) No claim-level evidence graph
Current system stores entity-level source URLs/citation URLs, but not structured claim->evidence mappings with quote/span/date.
- Evidence: provenance storage centers on `source_url`, `citation_urls`: `src/app/api/pipeline/research/route.ts` line 863; UI aggregates top domains only in synthesis provenance.
- Impact: hard to verify strategy claims and hard to debug hallucinated reasoning.

## 3.2 Graph consistency weaknesses

### W4) Mixed ID schemas for bridge edges (UUID vs display IDs)
Bridge edges are stored with `source_entity_id` as external display IDs (`X1`, etc.) and internal display IDs in some paths, while other logic expects UUID references.
- Evidence:
  - External entity map stores display->UUID: `src/app/api/pipeline/research/route.ts` line 882.
  - Bridge inserts use display IDs: lines 996 and 1051.
  - Multiple consumers include compatibility hacks for both formats:
    - `src/lib/intelligence/compute-signals.ts` line 81, line 97.
    - `src/lib/hooks/use-intelligence-radar.ts` lines 312, 926.
- Impact: brittle joins, trigger inaccuracies, analytics drift, hard-to-maintain logic.

### W5) Trigger logic likely under/over-fires due to ID mismatch assumptions
`research-triggers` checks bridges via UUID-linked internal nodes, but bridge rows may include mixed formats from upstream inserts.
- Evidence: UUID-centric matching logic in `src/lib/intelligence/research-triggers.ts` lines 89, 93, 178-181.
- Impact: false “no external validation” gaps and noisy auto-research loops.

## 3.3 Retrieval depth weaknesses (core “deep research” gap)

### W6) Search coverage without deep document extraction
Pipeline uses web search results and citations but does not run dedicated page fetching + chunk extraction + ranking + synthesis over primary documents.
- Evidence: parser captures URLs/citations (`src/lib/web-search.ts` line 76 onward), but no crawler/extractor/retrieval index stage exists in research route.
- Impact: shallow result usage, low signal extraction from long-form documents, weak “true useful information” density.

### W7) No source quality model (trust weighting)
No first-class scoring by source type (peer-reviewed, gov, earnings call, vendor blog), recency half-life, or contradiction confidence.
- Evidence: authority is mostly model-assigned + basic provenance fields.
- Impact: strategy can over-weight weak sources.

## 3.4 Orchestration/scheduling weaknesses

### W8) “Scheduled research” is client-driven, not backend guaranteed
Runs only when UI is loaded and effect executes.
- Evidence: `src/lib/hooks/use-intelligence-radar.ts` lines 798, 800.
- Impact: missed runs, inconsistent cadence, weak operational reliability.

### W9) Schedule focus areas are not consistently passed in trigger path
`orchestrate` can forward `focus_areas`, but radar trigger body currently sends only `researchOnly` and depth.
- Evidence:
  - Radar request body: `src/lib/hooks/use-intelligence-radar.ts` line 747.
  - Orchestrate supports `focus_areas`: `src/app/api/orchestrate/route.ts` lines 65-66.
- Impact: lower relevance and less targeted research quality.

## 3.5 User-facing explainability weaknesses

### W10) Research summary is aggregate-level, not decision-level
UI shows counts, authority mix, and top domains; strategy outputs do not provide tightly scoped citations per recommendation block.
- Evidence:
  - Summary UI: `src/components/synthesis/research-provenance-section.tsx` lines 32, 41, 110.
  - Strategy prompt primarily receives aggregate context counts.
- Impact: users cannot quickly validate “why this strategy is true now.”

---

## 4) Root-cause diagnosis

1. **Strong prompt engineering, weaker retrieval engineering.**
2. **Evidence model is entity-centric, not claim-centric.**
3. **ID schema drift created distributed complexity tax.**
4. **Client-side scheduling reduced infrastructure reliability.**
5. **Fallback behavior prioritizes completion over truth guarantees.**

---

## 5) High-impact tool integrations to close the gap

Recommended stack (priority order):

## Tier A (Immediate value)
1. **Tavily or Exa (research-focused search API)**
   - Better query decomposition, result metadata, and extraction endpoints.
2. **Firecrawl or Jina Reader API**
   - Deterministic page fetch + clean markdown extraction for long docs.
3. **Reranker (Cohere Rerank or Voyage reranker)**
   - Rank extracted chunks by claim relevance before synthesis.

## Tier B (Evidence-grade grounding)
4. **Hybrid retrieval index (pgvector/Weaviate/Pinecone)**
   - Store chunks with metadata: URL, publish date, source type, quote spans.
5. **Crossref/Semantic Scholar + GDELT/NewsAPI connectors**
   - Structured scholarly + macro/news inputs for non-marketing signals.

## Tier C (Operational reliability)
6. **Temporal/Trigger.dev/Cloud Tasks**
   - Server-side scheduled runs and retries independent of browser sessions.
7. **OpenTelemetry + Langfuse/Helicone**
   - End-to-end traces for query, source, extraction quality, and strategy impact.

---

## 6) Infrastructure redesign blueprint

## Phase 1 (1-2 weeks): Trust-preserving hardening
- Add explicit `research_mode` in response: `web_verified`, `fallback_training_only`.
- Block authority inflation in fallback mode.
- Standardize bridge edge ID schema (UUID-only in DB references).
- Pass schedule `focus_areas` from radar trigger to orchestrate/research.

## Phase 2 (2-4 weeks): Deep retrieval layer
- Add retrieval micro-pipeline:
  1) query planner -> 2) multi-source search -> 3) fetch/extract -> 4) chunk/rerank -> 5) claim synthesis.
- Persist `evidence_items` with quote span, date, source type, confidence.
- Generate claim->evidence links for each hidden signal and strategy claim.

## Phase 3 (3-6 weeks): Decision-grade strategy grounding
- Require each strategic recommendation to cite supporting evidence IDs.
- Add contradiction checker (source-to-source and source-to-internal-graph).
- Add recency decay scoring and source reliability prior.

## Phase 4 (parallel): Reliability + observability
- Move scheduled execution to backend jobs.
- Add run-level SLOs: success rate, median extraction quality, contradiction rate, citation coverage.

---

## 7) Concrete KPIs for “true deep research value”

1. **Citation Coverage Ratio**
   - % of strategy claims with at least 1 direct evidence item.
2. **Evidence Freshness Score**
   - Weighted by publish date + source credibility.
3. **Bridge Utility Score**
   - % of external entities that produce accepted strategy changes.
4. **Contradiction Detection Yield**
   - # of meaningful model-vs-web or source-vs-source contradictions found/run.
5. **Execution Reliability**
   - Scheduled run completion rate and p95 runtime.

---

## 8) Prioritized implementation backlog (first 10 tasks)

1. Normalize bridge edge references to UUID everywhere.
2. Add fallback mode flag and UI warning.
3. Introduce `evidence_items` table + claim links.
4. Integrate page extraction tool (Firecrawl/Jina).
5. Integrate reranker for chunk selection.
6. Forward `focus_areas` in radar trigger payload.
7. Move schedule execution to backend worker.
8. Add source quality scoring model.
9. Add strategy citation rendering per recommendation.
10. Add observability dashboard for research quality KPIs.

---

## 9) Bottom line

The current system is **not empty**; it has a meaningful multi-pass web-search foundation. But it is still **retrieval-light and evidence-weak** for “true deep research.”

To reach Claude/Perplexity-style deep research quality, the highest-leverage move is:
- **add deterministic document extraction + claim-level evidence graph + backend scheduling + ID normalization.**

That combination will materially improve extracted usefulness, strategy grounding, user trust, and execution reliability.