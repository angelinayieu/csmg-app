# Theory Expansion Superstructure Blueprint ("Coolest Form")

## 0) Target state
Build a system that can:
- run **objective-agnostic exploration** for long horizons,
- discover and validate deep mechanisms behind outcomes,
- continuously expand a multi-domain theory graph,
- then convert validated theory into objective-specific strategy.

This is a **two-engine architecture**:
1. **Exploration Engine** (unrestricted, theory-first)
2. **Optimization Engine** (objective-aware, execution-first)

---

## 1) Core design principle
**Never optimize objectives before validating mechanism reality.**

Flow:
1. Expand theory lattice.
2. Stress-test assumptions.
3. Validate with evidence.
4. Only then optimize objective policy.

Mathematically: maximize expected objective utility under epistemic uncertainty
$$
\max_{\pi} \; \mathbb{E}[U\mid \mathcal{M}] \quad \text{after improving model } \mathcal{M} \text{ via exploration}
$$

---

## 2) System architecture (optimal v1 -> v3)

## Layer A — Exploration Orchestrator (new)
A persistent orchestrator that creates, runs, and revises exploration agendas.

### New capabilities
- `exploration_mode`: `open_world | theory_expansion | contradiction_hunt | frontier_scan`
- dynamic budget scheduler (tokens/search/time)
- novelty-aware agenda queue
- auto-spawn specialist agents by domain coverage gaps

## Layer B — Specialist Agent Mesh (new)
A coordinated multi-agent mesh:
- `planner_agent` — decomposes frontier into hypotheses
- `domain_specialist_agent[*]` — micro-domain deep dives
- `contrarian_agent` — adversarial challenge + falsification
- `mechanism_agent` — causal chain extraction
- `evidence_agent` — source retrieval, quote grounding, timestamping
- `synthesis_agent` — merges into theory graph + confidence updates

## Layer C — Evidence Retrieval Stack (upgrade)
Search is not enough; use full retrieval:
1. query planner
2. multi-source search
3. deterministic fetch/extract
4. chunking + rerank
5. claim-level grounding
6. contradiction graph updates

## Layer D — Theory Lattice Store (new persistence)
Persistent graph of:
- theories,
- mechanisms,
- assumptions,
- mediators,
- constraints,
- observable tests,
- counterexamples.

---

## 3) Data model (new tables)

## `exploration_runs`
- `id`, `space_id`, `mode`, `status`, `budget`, `started_at`, `ended_at`
- `frontier_score_before`, `frontier_score_after`

## `theory_nodes`
- `id`, `space_id`, `label`, `node_type`
- `domain`, `abstraction_level`, `confidence`, `novelty_score`
- `falsifiability_score`, `evidence_strength`

## `theory_edges`
- `id`, `space_id`, `source_id`, `target_id`, `relation_type`
- `weight`, `confidence`, `conditions`, `validity_window`

## `claims`
- `id`, `space_id`, `claim_text`, `claim_type`
- `status` (`proposed|supported|contested|refuted`)
- `owner_agent`, `last_reviewed_at`

## `evidence_items`
- `id`, `claim_id`, `url`, `source_type`, `published_at`
- `quote`, `span_start`, `span_end`, `extraction_hash`
- `reliability_prior`, `recency_score`

## `hypothesis_queue`
- `id`, `space_id`, `hypothesis`, `priority`
- `expected_value_of_information`, `assigned_agent`, `status`

## `contradictions`
- `id`, `space_id`, `claim_a_id`, `claim_b_id`, `severity`
- `resolution_status`, `required_tests`

---

## 4) Agent protocol (strict contracts)
Each agent response must include:
- `hypotheses[]`
- `mechanisms[]`
- `claims[]`
- `evidence_links[]`
- `falsification_tests[]`
- `next_queries[]`

No free-form-only outputs. Every assertion should map to at least one claim object.

---

## 5) New pipeline stages

## Stage E1: Frontier Mapping
- Detect weakly explained regions in current graph.
- Score by expected value of information (EVI).

## Stage E2: Theory Expansion
- Spawn specialist agents on highest-EVI hypotheses.
- Generate mechanisms, mediators, and edge conditions.

## Stage E3: Evidence Grounding
- Attach quote-level evidence and timestamps.
- Compute source reliability and recency decay.

## Stage E4: Contradiction Tournament
- Pair claims for adversarial challenge.
- Promote/demote confidence via resolution outcomes.

## Stage E5: Policy Translation
- Convert high-confidence mechanism clusters into objective strategies.
- Keep uncertain clusters as monitoring probes, not hard recommendations.

---

## 6) Scoring system (must-have)

## Knowledge Penetration Score (KPS)
$$
\mathrm{KPS} = 0.25N + 0.25M + 0.20E + 0.15C + 0.15F
$$
Where:
- $N$ = novelty depth
- $M$ = mechanistic completeness
- $E$ = evidence quality
- $C$ = contradiction resolution quality
- $F$ = falsifiability/testability quality

## Objective Readiness Score (ORS)
Only allow optimization when ORS above threshold.

$$
\mathrm{ORS} = \alpha \cdot \text{KPS} + \beta \cdot \text{Stability} + \gamma \cdot \text{Evidence Freshness}
$$

---

## 7) Execution infrastructure (production-grade)

## Required
- background workflow engine (Temporal or Trigger.dev)
- queue partition by space/domain
- idempotent run checkpoints
- resumable agent state
- distributed trace for each claim lifecycle

## Why
Client-side scheduling is not enough for persistent exploration loops.

---

## 8) Integration with current codebase

Current strong anchors:
- multi-pass research route in [src/app/api/pipeline/research/route.ts](src/app/api/pipeline/research/route.ts)
- depth engine in [src/lib/pipeline/research-depth-engine.ts](src/lib/pipeline/research-depth-engine.ts)
- trigger generation in [src/lib/intelligence/research-triggers.ts](src/lib/intelligence/research-triggers.ts)
- synthesis integration in [src/app/api/pipeline/synthesize/route.ts](src/app/api/pipeline/synthesize/route.ts)
- strategy refresh integration in [src/app/api/pipeline/strategy-refresh/route.ts](src/app/api/pipeline/strategy-refresh/route.ts)

## Additions
1. New route: `/api/pipeline/explore` (long-horizon runs)
2. New worker: `exploration-worker` for async loops
3. New store + migrations for theory/evidence/claims
4. New UI module: "Theory Frontier" with contradiction board

---

## 9) Minimal implementation roadmap

## Phase 1 (2 weeks): Enable theory-first mode
- Add `exploration_mode` and `theory_expansion` config.
- Add `claims` + `evidence_items` schema.
- Add explicit fallback flags (`web_verified` vs `training_only`).

## Phase 2 (3 weeks): Agent mesh + retrieval hardening
- Implement planner/contrarian/evidence agents.
- Add deterministic extraction + reranker.
- Ground every high-impact hidden signal in claim-evidence pairs.

## Phase 3 (3 weeks): Contradiction tournament + readiness gates
- Build contradiction resolution loop.
- Introduce KPS + ORS gates before strategy generation.

## Phase 4 (ongoing): Frontier autonomy
- Continuous background exploration jobs.
- Dynamic budget allocation by EVI.
- Domain specialization growth over time.

---

## 10) “Coolest form” operating model

The system becomes a **self-improving epistemic engine**:
- It explores without waiting for user prompts.
- It maps hidden mechanisms before recommending action.
- It treats contradiction as fuel, not failure.
- It continuously upgrades strategy quality as theory quality improves.

In short: **from assistant -> to autonomous theory laboratory -> to strategy OS.**

---

## 11) Non-negotiable guardrails
- Evidence-grounding required for high-impact claims.
- Explicit uncertainty labels for all strategy outputs.
- Human override on major objective pivots.
- Cost and search budgets per exploration run.
- Provenance and reproducibility for each recommendation.

---

## 12) Success criteria
You will know this worked when:
1. Strategy changes are driven by contradiction resolution, not random prompt variance.
2. Each recommendation has traceable claim->evidence chains.
3. Cross-domain transfer insights increase while hallucination rate decreases.
4. Objective outcomes improve with fewer brittle pivots.
5. The theory graph grows in depth, not just node count.