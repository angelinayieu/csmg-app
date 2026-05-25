# V2 Research Rigor Plan — Foundation Fix for Effect-Size Sourcing

**Status**: deferred from MVP. Phase 0 (honesty fix) ships as MVP; Phases 1-4 wait for trigger conditions documented below.

**Last updated**: 2026-05-15

**Context**: An audit of the research/extraction pipeline revealed that effect sizes in this codebase have inconsistent rigor. Some come from a deterministic regex parser on user-uploaded PDFs (high rigor). Some come from LLM web-search synthesis with no parser verification (low rigor). The UI does not distinguish them. This plan addresses the gap, but only the MVP-critical pieces ship now — the rest waits for real user signal.

---

## Why this is deferred (the MVP cut)

The single MVP-critical issue is **honesty**: the forest plot today ranks LLM-hallucinated effect sizes equal to reviewed ones, by magnitude. A hallucinated `d=1.5` outranks a reviewed `d=0.3`. This breaks user trust regardless of audience (personal, professional, or academic).

**Phase 0** alone fixes this:
- Tag every `evidence_registries` row with a `rigor_tier` enum
- Forest plot filters to high-rigor tiers by default; "show all" with visual differentiation
- Cascade-objective + cycle-loop multipliers carry rigor-tier badges (paper-sourced 📎, LLM-estimated ⚠)

That's the only piece needed for general-use MVP. Everything else in this document is **conditional on user feedback** — see "Trigger conditions" section below.

---

## Audit findings (what we discovered)

### A. The system is a hybrid of two pipelines

**Pipeline 1 — Web research (LOW rigor):**
- File: [/api/pipeline/research/route.ts](../src/app/api/pipeline/research/route.ts) and siblings (adversarial, boundary, triangulate, cycle-close, round)
- Uses Anthropic's native `web_search` tool — returns URLs + snippets
- LLM synthesizes "empirical data" (effect sizes, Cohen's d, percentage changes) from snippets in [src/lib/prompts/domain-expert.ts](../src/lib/prompts/domain-expert.ts)
- Effect sizes here are LLM guesses; they stay in `synthesis_data.external_entities` as free text
- NO source URL on the edge row; NO parser verification

**Pipeline 2 — Artifact extraction (MEDIUM-HIGH rigor):**
- File: [src/lib/extraction/extract-effect-sizes.ts](../src/lib/extraction/extract-effect-sizes.ts) (~500 LOC)
- Two-stage: LLM marks spans in uploaded PDF text → deterministic regex parser extracts numbers
- Single parser today: `cohens_d_with_ci_v1` covers Cohen's d / Hedges' g / SMD only
- Dual provenance: `llm_label_provenance` + `parser_provenance` stamped
- Writes to `evidence_registries` table

**Pipeline 3 — Deep-research bridge (MEDIUM rigor):**
- File: [src/lib/research/bridge-to-evidence-registries.ts](../src/lib/research/bridge-to-evidence-registries.ts)
- Uses OpenAI `o4-mini-deep-research` (Responses API) for background research
- Routes the report text through the same parser as Pipeline 2
- Tags rows with `flags @> 'from_deep_research'` and derives `source_url` via citation overlap matching (heuristic; can fail)

### B. The forest plot rigor bug

[/api/spaces/[id]/forest-plot](../src/app/api/spaces/[id]/forest-plot/route.ts) currently:

```sql
SELECT effect_size, ci_lower, ci_upper, ...
FROM evidence_registries
WHERE space_id = ?
  AND effect_size IS NOT NULL
  AND ci_lower IS NOT NULL
  AND ci_upper IS NOT NULL
ORDER BY |effect_size| DESC
LIMIT 8
```

**No filter on extraction_confidence, status, or rigor signal.** Unreviewed rows with LLM-hallucinated values sit next to validated rows. Ranking by `|effect_size|` means hallucinations with large guessed effects rank above reviewed papers with small effects.

### C. Parser coverage gap

| Metric | Parser support |
|---|---|
| Cohen's d / Hedges' g / SMD | ✓ Full (regex extracts point + CI + SE + n) |
| OR / RR / HR | ⚠️ Metric detected by name, no point-estimate parser |
| Correlation (r, Pearson, Spearman) | ❌ No parser |
| Beta / regression coefficient | ❌ No parser |
| Percent change | ❌ No parser |
| AUC / d-prime / probability scores | ❌ No parser |

Estimated success rate today: ~30% across uploaded PDFs (Cohen's d-only).

### D. What's NOT in the pipeline

- ❌ Semantic Scholar API
- ❌ OpenAlex API
- ❌ PubMed E-utilities
- ❌ arXiv API
- ❌ Crossref DOI validation
- ❌ Unpaywall (open-access PDF discovery)
- ❌ URL liveness check
- ❌ Citation graph traversal
- ❌ Heterogeneity (I²) computation in pooling

The system **never fetches actual paper content from the web** — even URLs the LLM cites are just snippet-derived strings, not fetched documents.

### E. Existing infrastructure that DOES exist

- `pdf-parse` v2.4.5 — installed, used for uploaded PDFs (could be reused for fetched online papers)
- `evidence_registries` schema has provenance columns ready for source URL (currently nullable)
- `edge-strength-pooler.ts` does REML random-effects meta-analysis (sound math; depends on input rigor)
- `impact-weighted-metric.ts` performs fixed/random effects pooling for cascade impact %
- Anthropic SDK v0.81.0 with `web_search` tool
- OpenAI SDK v6.33.0 with Responses API + structured output

---

## Phase 0 — MVP honesty fix (SHIPS NOW)

**Effort**: 0.5 day
**Status**: Pending implementation
**Why ship now**: regardless of user audience, the system should not implicitly rank hallucinations equal to reviewed evidence

### What ships

1. **Add `rigor_tier` computed view or generated column on `evidence_registries`**:
   - `paper_reviewed` — `status='reviewed'` AND `source_url IS NOT NULL` AND parser non-failed
   - `paper_extracted` — `status='extracted'` AND `ingested_file_id IS NOT NULL` (uploaded PDF, parser fired)
   - `web_deep_research` — `flags @> 'from_deep_research'` AND `source_url IS NOT NULL`
   - `web_heuristic` — `from_deep_research` but `source_url IS NULL` (citation overlap failed)
   - `legacy_unsourced` — pre-foundation rows, no source_url

2. **Forest plot route changes**:
   - Default query filters to `rigor_tier IN ('paper_reviewed', 'paper_extracted')`
   - "Show all" toggle reveals lower-rigor rows with explicit warning
   - Sort within tier by `|effect_size|`; do not sort across tiers

3. **Per-row rigor badge in UI**:
   - 📎 for paper-sourced (reviewed or extracted)
   - ⚠ for web-heuristic / legacy_unsourced
   - Tooltip explains the tier

4. **Pooling metadata refactor**:
   - `edge.dynamics_properties.pooling_metadata` already has `n_studies`; add `n_per_tier: { paper_reviewed: 3, paper_extracted: 1, ... }`
   - When `n_per_tier.paper_*` summed is zero but `n_per_tier.web_*` > 0, the pooled estimate gets a `low_rigor_warning: true` flag

5. **Cascade-objective + cycle-loop multiplier tier badges**:
   - The EST badge work already shipped on cycle-loop is the template
   - Cascade-objective impact % gets a small tier indicator alongside the %

### Files to touch

- New migration: `supabase/migrations/YYYYMMDD_evidence_rigor_tier.sql` (compute the view or generated column)
- [src/app/api/spaces/[id]/forest-plot/route.ts](../src/app/api/spaces/[id]/forest-plot/route.ts) — add rigor filter + sort
- New component: `src/components/canvas/shapes/rigor-badge.tsx` (reusable across cards)
- [src/lib/twin/impact-weighted-metric.ts](../src/lib/twin/impact-weighted-metric.ts) — compute n_per_tier in pooling output
- [src/components/strategy/v2/cascade/cascade-objective.tsx](../src/components/strategy/v2/cascade/cascade-objective.tsx) — surface tier badge

### Acceptance criteria

- A user uploads a PDF with a real effect size, alongside a fresh prompt that generates LLM-only effect sizes. Open the forest plot. The uploaded one shows above; the LLM-only ones are filtered out by default with a clear "Show all tiers" affordance.
- The pooled `n_studies` on an edge is replaced by an honest per-tier breakdown.
- No row implies sourcing it doesn't have.

---

## Phase 1 — Parser expansion (DEFERRED)

**Effort**: 1.5 days
**Trigger to invoke**: A user uploads a PDF with non-Cohen's-d effect sizes (OR, RR, HR, beta, correlation, etc.) and explicitly complains those effect sizes are "not extracted" or "not in the forest plot."

### What ships

New parsers in `src/lib/extraction/extract-effect-sizes.ts`:

| Parser | Patterns | Output |
|---|---|---|
| `odds_ratio_v1` | `OR 1.8 (95% CI 1.2-2.7)`, `aOR = 2.3 [1.5, 3.5]`, `odds ratio: 1.8` | metric="or", point + CI |
| `risk_ratio_v1` | `RR`, `relative risk`, `prevalence ratio`, `risk ratio = X` | metric="rr", point + CI |
| `hazard_ratio_v1` | `HR`, `hazard ratio = 2.5 (95% CI 1.5-4.1)` | metric="hr", point + CI |
| `correlation_v1` | `r = 0.42`, `Pearson r`, `Spearman r`, with CI when stated | metric="r", point + CI |
| `beta_v1` | `β = 0.23`, `b = 0.15 (SE 0.04)`, `regression coefficient` | metric="beta", point + SE |
| `pct_change_v1` | `15% reduction`, `30% increase`, with CI | metric="pct_change", point + CI |

Metric-aware reference line in forest plot (1.0 for OR/RR/HR, 0 for d/g/SMD/r/beta).

Per-parser version tags (`odds_ratio_v1`, etc.) so future tuning is traceable in `parser_provenance.rule_fired`.

### Files to touch

- [src/lib/extraction/extract-effect-sizes.ts](../src/lib/extraction/extract-effect-sizes.ts) — add new parser functions + dispatch logic
- [src/app/api/spaces/[id]/forest-plot/route.ts](../src/app/api/spaces/[id]/forest-plot/route.ts) — metric-aware reference line
- Test fixtures for each metric type in `__tests__/extract-effect-sizes/`

### Acceptance criteria

- Parser success rate climbs from ~30% (Cohen's d only) to ~70% (covering most common medical / behavioral effect sizes).
- Each new parser has at least 3 test cases including edge cases (open intervals, unicode dashes, scientific notation).

---

## Phase 2 — Academic API integration (DEFERRED)

**Effort**: 3 days
**Trigger to invoke**: Users specifically ask "where did this claim come from? Can I see the paper?" — meaning the absence of citations is bottlenecking their trust. Most likely from research-template users.

### What ships

New module `src/lib/research/academic-apis.ts`:

```typescript
interface SourcedPaper {
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  pdf_url: string | null; // from Unpaywall
  citation_count: number | null;
  open_access: boolean;
  source_api: "semantic_scholar" | "openalex" | "pubmed" | "arxiv";
}

async function semanticScholarLookup(query: string, limit: number): Promise<SourcedPaper[]>
async function openAlexLookup(query: string, limit: number): Promise<SourcedPaper[]>
async function pubmedSearch(query: string, limit: number): Promise<SourcedPaper[]>
async function arxivSearch(query: string, limit: number): Promise<SourcedPaper[]>
async function crossrefValidate(doi: string): Promise<{ valid: boolean; metadata: SourcedPaper | null }>
async function unpaywallLookup(doi: string, email: string): Promise<{ pdf_url: string | null }>
```

### API endpoints (all free, no key required for the listed tiers)

| API | Endpoint | Auth | Rate limit |
|---|---|---|---|
| **Semantic Scholar** | `api.semanticscholar.org/graph/v1/paper/...` | None | ~100 req/s per IP |
| **OpenAlex** | `api.openalex.org/works?...` | Email in User-Agent | Generous; abide by ~10 req/s |
| **PubMed E-utilities** | `eutils.ncbi.nlm.nih.gov/entrez/eutils/...` | None for <10k/day | Use NCBI API key for higher volumes |
| **arXiv** | `export.arxiv.org/api/query?...` | None | ~1 req/3s recommended |
| **Crossref** | `api.crossref.org/works/<doi>` | Polite User-Agent | Generous |
| **Unpaywall** | `api.unpaywall.org/v2/<doi>?email=...` | Email in URL | 100k/day |

### New pipeline behavior

When web-research surfaces a claim like "studies show X causes Y":
1. Extract the topic phrase
2. Query Semantic Scholar (primary) + OpenAlex (fallback) for top 3-5 papers
3. Persist each as a `sourced_papers` row (new table) with full metadata
4. Link the claim to the papers via a junction table
5. The original web-research LLM output is now ANNOTATED with real paper references, not standing alone

### New schema

```sql
-- 20260XXX_sourced_papers.sql

CREATE TABLE sourced_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid REFERENCES spaces(id),
  doi text,
  title text NOT NULL,
  authors text[] NOT NULL DEFAULT '{}',
  year int,
  abstract text,
  pdf_url text,
  citation_count int,
  open_access boolean NOT NULL DEFAULT false,
  source_api text NOT NULL CHECK (source_api IN ('semantic_scholar', 'openalex', 'pubmed', 'arxiv')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  doi_validated boolean NOT NULL DEFAULT false,
  -- Unique on DOI+space prevents duplicates from cross-API lookups
  UNIQUE (space_id, doi)
);

CREATE TABLE entity_paper_links (
  entity_id uuid REFERENCES entities(id),
  paper_id uuid REFERENCES sourced_papers(id),
  relevance text CHECK (relevance IN ('strong', 'moderate', 'tangential')),
  PRIMARY KEY (entity_id, paper_id)
);
```

### DOI validation flow

Any URL that LOOKS like a paper (matches `doi.org/`, `arxiv.org/abs/`, `pubmed.ncbi.nlm.nih.gov/`) goes through `crossrefValidate()` before insertion into `evidence_registries.source_url`. Failures get tagged.

### Files to touch

- New module: `src/lib/research/academic-apis.ts`
- New migration: `supabase/migrations/YYYYMMDD_sourced_papers.sql`
- [src/lib/research/bridge-to-evidence-registries.ts](../src/lib/research/bridge-to-evidence-registries.ts) — call APIs before claim insertion
- New helper: `src/lib/research/validate-source-url.ts`
- Polite User-Agent constant: `src/lib/research/user-agent.ts` (mailto + identifier)

### Acceptance criteria

- A web-research pass for "exercise and depression" returns at least 5 papers with valid DOIs, real abstracts, citation counts, open-access flags.
- Each paper's DOI resolves via Crossref (validated_at timestamp set).
- The UI surfaces these as clickable citations alongside the LLM-synthesized claims.

---

## Phase 3 — PDF fetch + parse (DEFERRED)

**Effort**: 2 days
**Trigger to invoke**: Users need publication-grade evidence depth — typically when the strategy informs a regulated decision (medical, legal, financial) or when an academic user expects effect sizes derived from the actual Methods/Results section, not the abstract.

### What ships

New module `src/lib/research/paper-fetcher.ts`:

```typescript
interface FetchedPaper {
  doi: string;
  full_text: string;
  pdf_byte_size: number;
  sections: { methods: string | null; results: string | null; discussion: string | null };
  fetched_at: string;
  fetch_source: "unpaywall" | "arxiv" | "doi_direct";
}

async function fetchPaperPdf(doi: string): Promise<FetchedPaper | null>
```

Logic:
1. Try `unpaywall(doi)` for open-access PDF URL → fetch + parse via existing `pdf-parse`
2. Fall back to `arxiv(doi)` if the paper is on arXiv
3. Fall back to direct DOI URL → fetch if HTTP 200 + content-type PDF
4. Return null if no path resolves
5. Cache results in `paper_contents` table keyed by DOI

### Section parsing

Use simple heuristic patterns (`^Methods`, `^Results`, `^Discussion`) to split the full text. Even imperfect section detection improves parser yield because effect sizes typically appear in Results.

### New schema

```sql
-- 20260XXX_paper_contents.sql

CREATE TABLE paper_contents (
  paper_id uuid PRIMARY KEY REFERENCES sourced_papers(id) ON DELETE CASCADE,
  full_text text NOT NULL,
  methods_section text,
  results_section text,
  discussion_section text,
  pdf_byte_size int NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  fetch_source text NOT NULL,
  fetch_failed boolean NOT NULL DEFAULT false,
  fetch_error text
);

CREATE INDEX paper_contents_methods_gin ON paper_contents USING gin (to_tsvector('english', methods_section));
CREATE INDEX paper_contents_results_gin ON paper_contents USING gin (to_tsvector('english', results_section));
```

### Integration with extract-effect-sizes

For papers with successful fetch, run the existing extract-effect-sizes pipeline on `results_section` text. Resulting `evidence_registries` rows get:
- `rigor_tier = 'paper_extracted'` (the highest tier)
- `source_url = sourced_papers.doi_url`
- `parser_provenance.fetch_source = "unpaywall" | "arxiv" | "doi_direct"`
- `parser_provenance.paper_fetched_at` timestamp

### Files to touch

- New module: `src/lib/research/paper-fetcher.ts`
- New migration: `supabase/migrations/YYYYMMDD_paper_contents.sql`
- [src/lib/extraction/extract-effect-sizes.ts](../src/lib/extraction/extract-effect-sizes.ts) — accept fetched-paper text as input alongside uploaded-file text
- New job/queue: paper-fetcher should run async since some PDFs are slow; consider Inngest task

### Acceptance criteria

- For a paper with a known open-access PDF, fetching + parsing produces an `evidence_registries` row with extracted effect size, full source URL, validated DOI.
- Closed-access papers get tagged "closed_access" and skip fetch (no failed downloads).
- Fetch success rate: aim for >60% of papers with valid DOIs.

---

## Phase 4 — Pooling rigor + UI honesty (DEFERRED)

**Effort**: 1.5 days
**Trigger to invoke**: Multiple users start citing the impact-% chips or pooled-effect numbers in actual decisions / presentations. Once the numbers are being acted on, pooling rigor matters.

### What ships

**Heterogeneity computation in `edge-strength-pooler.ts`**:
- Compute I² (Higgins' inconsistency statistic) across pooled rows
- Flag pooled estimates with `heterogeneity_warning: true` when I² > 50% (Cochrane standard)
- Per-tier `n_studies` so `pooling_metadata` shows `{ paper_reviewed: 3, paper_extracted: 1, web_deep_research: 1 }` instead of `n_studies: 5`

**Forest plot UI**:
- Confidence quantile bars per row (using existing `extraction_confidence` field)
- Rigor tier badge per row (extends Phase 0)
- Footer changes from `"X findings"` to `"3 reviewed · 1 extracted · 1 web — I² 42%"`

**impact-weighted-metric.ts cascade-objective impact %**:
- Add `rigorMode: 'strict' | 'inclusive'` parameter
  - `strict`: only `paper_reviewed` + `paper_extracted` rows pool; web-research excluded
  - `inclusive`: all rows pool, with explicit rigor disclosure
- Cascade objective card shows a rigor indicator alongside the % chip

### Files to touch

- [src/lib/evidence/edge-strength-pooler.ts](../src/lib/evidence/edge-strength-pooler.ts) — add I² + per-tier n_studies
- [src/lib/twin/impact-weighted-metric.ts](../src/lib/twin/impact-weighted-metric.ts) — add rigorMode parameter
- [src/components/strategy/v2/cascade/cascade-objective.tsx](../src/components/strategy/v2/cascade/cascade-objective.tsx) — rigor indicator in impact chip
- [src/components/canvas/shapes/forest-plot-shape.tsx](../src/components/canvas/shapes/forest-plot-shape.tsx) — confidence bars + per-tier footer

### Acceptance criteria

- A pooled estimate with I² > 50% renders with a "high heterogeneity" warning chip.
- Forest plot footer accurately reports per-tier study counts.
- Cascade-objective impact % displays as `45% (strict) · 52% (inclusive)` when the two modes diverge.

---

## Architectural decisions to make BEFORE invoking Phases 1-4

These are open decisions that affect downstream phases. Decide before starting any of them.

### Decision 1: Strict vs inclusive default for cascade-objective impact %

- **Strict** (Cochrane/PRISMA standard): only `paper_reviewed` + `paper_extracted` rows pool. Web-research excluded from pooling but can show as "narrative support" elsewhere.
- **Inclusive** (user-friendly): everything pools, with explicit rigor-tier disclosure on the result.

**Recommendation**: strict default, inclusive toggle, with clear UI signaling. Don't default to averaging hallucinations even with a warning.

### Decision 2: Backfill or forward-only for source URLs

Existing `evidence_registries` rows have `source_url IS NULL` for ~90% of entries (mostly PDF uploads where the URL field was never required).

- **Backfill**: script that walks old rows, attaches `ingested_files.source_url` when available. ~1 day of script work, risk of mislabeling.
- **Forward-only**: old rows tagged `legacy_unsourced` and excluded from rigorous pooling by default. New rows must have source_url.

**Recommendation**: forward-only. Backfill is risky and most legacy rows are from now-unavailable PDF uploads. The `legacy_unsourced` tier handles them honestly.

### Decision 3: Semantic Scholar OR OpenAlex (or both)

Both free, both cover similar territory (~250M papers indexed each).

- Semantic Scholar: faster API, has paper embeddings (good for similarity)
- OpenAlex: better metadata, more permissive licensing, requires email in User-Agent

**Recommendation**: integrate both. Use OpenAlex as primary (better metadata) and Semantic Scholar as fallback (when OpenAlex 404s on very new papers). Costs nothing to wire both.

---

## Trigger conditions — when to escalate from Phase 0 to later phases

Do NOT invoke Phases 1-4 on schedule. Invoke on signal:

| Trigger | Phase to invoke |
|---|---|
| User uploads PDF with non-Cohen's-d effect sizes and complains they're "not detected" | Phase 1 |
| User asks "where did this claim come from? Can I see the paper?" and the answer is too often "no source available" | Phase 2 |
| User wants to use the strategy for a regulated/audited decision (medical, financial, legal) | Phase 3 |
| Multiple users start citing the impact-% chips or pooled-effect numbers in actual presentations or decisions | Phase 4 |

If none of these happen, **none of the phases are needed.** Phase 0 alone is sufficient for general-use MVP indefinitely.

---

## Honest assessment after this plan ships

Before Phase 0: **Level 1.5 hybrid claiming Level 2-3 rigor (theater)**

After Phase 0 only: **Level 1.5 honest about being Level 1.5**

After Phases 1-2: **Level 2.5 (real paper-API sourcing for new claims)**

After Phase 3: **Level 3 (full-text RAG for fetched papers)**

After Phase 4: **Level 3 with proper pooling discipline (I², per-tier disclosure)**

The MVP target is "honest at whatever level we are" — not "Level 3 across the board." Phase 0 hits that target.

---

## Related docs

- [CORE_CONCEPTS.md](./CORE_CONCEPTS.md) — defines feedback loops, causal chains, effect sizes, twin, mechanisms. Read this first if you're unfamiliar with the codebase's domain vocabulary.
- [KG_DEPTH_CRITIQUE.md](./KG_DEPTH_CRITIQUE.md) — earlier audit of KG depth + signal materialization.
- [STRATEGY_CONFIDENCE_RIGOR.md](./STRATEGY_CONFIDENCE_RIGOR.md) — adjacent work on strategy-level confidence calibration.

---

## Open questions / things to verify before Phase 1+

1. Are there any `evidence_registries` rows in production today with effect sizes from a metric the parser doesn't recognize? Run a one-off query to check. If yes, those rows currently sit with `parser_provenance.flags @> 'parser_failed_no_rule_matched'` — they ARE in the table but with null `effect_size`.

2. What's the realistic latency budget for academic API calls? If Phase 2 adds a 3-5s latency to web research, is that acceptable? Probably yes given current research stages already take ~30s.

3. Does the existing `bridge-to-evidence-registries.ts` deduplicate effect sizes that the deep-research report and the PDF parser both surface? Currently uncertain — needs verification before Phase 2 to prevent double-counting.

4. PDF fetch failure rate — what % of papers are open-access? Unpaywall reports ~30-40% are open across all disciplines, higher in CS/STEM. Set expectations.

5. Are there compliance / TOS considerations for the academic APIs? OpenAlex requires User-Agent with email. Semantic Scholar TOS is permissive. PubMed has fair-use limits. Document the polite-user-agent string before going live.

---

## Implementation order recommendation when invoked

1. Phase 0 (now, MVP)
2. Phase 1 (when triggered) — independent, low-risk, immediate parser yield improvement
3. Phase 2 (when triggered) — biggest rigor jump; depends on Phase 0 tagging
4. Phase 4 (when triggered) — can come before or after Phase 3 depending on user need
5. Phase 3 (when triggered) — highest effort, narrowest audience (research-grade users only)

Phase 1 and Phase 4 can ship without Phase 2/3. Phase 2 and 3 are paired; Phase 3 doesn't make sense without Phase 2's DOI/metadata foundation.
