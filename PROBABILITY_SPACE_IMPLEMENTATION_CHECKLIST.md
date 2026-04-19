# Probability Space Upgrade — Implementation Checklist

## How to use this checklist
- Complete items in order.
- Do not start a later phase until the current phase exit criteria are met.
- Keep changes behind feature flags where noted.

---

## Phase 0 — Baseline + Safety (Blockers First)

### 0.1 Baseline instrumentation
- [x] Add baseline counters/logs for:
  - [x] % spaces generated via synthetic fallback
  - [x] % edges using default probabilities
  - [x] intersections detected vs intersections surfaced
  - [x] discovered edges materialized per run
- [x] Add structured log event for probability pipeline completion.
- [ ] Verify metrics appear in local logs and production telemetry.

### 0.2 Changelog schema mismatch
- [x] Resolve `space_changelog.change_type` mismatch:
  - [ ] Either add `intelligence_feedback` to DB check constraint
  - [x] Or update route to use an allowed value
- [x] Make changelog write non-blocking in intelligence feedback route (prevent full pipeline failure on insert error).
- [ ] Validate insert path in intelligence feedback route succeeds.

### Phase 0 exit criteria
- [ ] No changelog insertion failures in intelligence feedback pipeline.
- [ ] Baseline metrics visible and stable for at least 3 test runs.

---

## Phase 1 — Uncertainty Labeling (Highest ROI)

### 1.1 Type/system contracts
- [x] Update probability types:
  - [x] Add `probability_source` to `ProbabilityEdge` (`measured | estimated | default`)
  - [x] Add `quality_tier` to `ProbabilitySpace` (`verified | estimated | speculative`)
- [x] Ensure all constructors/serializers compile after type change.

### 1.2 Engine propagation rules
- [x] In synthetic builder, mark all edge probabilities as `default`.
- [x] In expansion-based builders:
  - [x] Explicit provided values -> `estimated` (or `measured` when truly validated)
  - [x] Fallback `??` values -> `default`
- [x] Add `classifySpaceQuality()` helper and set `quality_tier` for each space.

### 1.3 UI labels
- [x] Add badges for edge probability source in probability panels/cards.
- [x] Add space-level `quality_tier` badges.
- [x] Add tooltip copy clarifying default/unverified probabilities.

### 1.4 API payload continuity
- [x] Ensure API responses include/forward new fields where relevant.
- [x] Keep backward compatibility for existing consumers.

### Phase 1 exit criteria
- [x] Every rendered probability has source labeling.
- [x] No unlabeled default probabilities in UI.
- [ ] Typecheck/lint/tests pass.

---

## Phase 2 — Validation Gates + Speculative Filtering

### 2.1 Gate policy implementation
- [x] Define and codify gate rules:
  - [x] Hide trivial synthetic spaces by default
  - [x] Mark low-grounding spaces as `speculative`
  - [x] Mark low-similarity intersections as weak or hide by default
  - [x] Label low-grounding critical paths as “insufficient data”
- [x] Implement deterministic gating helper functions.

### 2.2 UI controls
- [x] Add toggle: `Show speculative`.
- [x] Default dashboard view = verified + estimated only.
- [x] Add empty-state guidance when filters hide all results.

### 2.3 Consistency across modules
- [x] Apply the same gate behavior in:
  - [x] Probability Space module
  - [x] Intelligence Radar module
  - [x] Intelligence feedback API shaping (if surfaced)

### Phase 2 exit criteria
- [x] Speculative outputs hidden by default.
- [x] User can opt-in to view full speculative output.
- [ ] No regressions in existing strategy summary displays.

---

## Phase 3 — Specific Insight Generation (Top-N, Cached)

### 3.1 Insight generation service
- [x] Add service to generate intersection insight text from rich intersection context.
- [x] Trigger generation only for top-N high-value intersections.
- [x] Add deterministic cache key and storage for generated insights.

### 3.2 Prompt quality controls
- [x] Enforce prompt requirements:
  - [x] Explain why shared variable matters in both spaces
  - [x] Give concrete actionable implication
  - [x] State non-obvious consequence
  - [x] Avoid generic template language
- [x] Add output validation/length constraints.

### 3.3 Fallback path
- [x] Keep current deterministic template as fallback on LLM failure/timeout.

### Phase 3 exit criteria
- [ ] Top intersections display specific, non-generic insights.
- [ ] Re-open of same intersection uses cache.
- [ ] Bounded cost and latency under configured limits.

---

## Phase 4 — Goal-aware Blast Radius

### 4.1 Model updates
- [x] Extend failure analysis input to accept `goalEntityIds` (optional).
- [x] Replace pure downstream-count blast radius with goal-aware criteria:
  - [x] Reaches/blocks goal path -> systemic
  - [x] Invalidates multiple critical paths -> cascading
  - [x] Otherwise local

### 4.2 Pipeline integration
- [x] Thread active goal/objective entity IDs into probability/failure analysis calls.
- [x] Keep safe fallback behavior when no active goal exists.

### 4.3 UI updates
- [x] Add clear marker when blast radius is goal-aware.
- [x] Provide short rationale text for classification.

### Phase 4 exit criteria
- [x] Blast radius changes appropriately when active goal changes.
- [x] No runtime errors when no goal is active.

---

## Phase 5 — Embedding-based Semantic Matching

### 5.1 Data layer
- [x] Add embedding storage for expansion sub-components.
- [x] Create migration and backfill plan for existing expansion rows.
- [x] Add versioning so embeddings can be recomputed safely.

### 5.2 Embedding compute pipeline
- [x] Compute embeddings on expansion create/update.
- [x] Cache and avoid duplicate computation.

### 5.3 Detector upgrade
- [x] Update intersection matching to use cosine similarity over embeddings.
- [x] Keep lexical path as fallback when embeddings unavailable.
- [ ] Tune thresholds with sampled validation set.
  - [x] Thresholds externalized via env vars (`PS_EMBEDDING_SIM_THRESHOLD`, `PS_NAME_SIM_THRESHOLD`, `PS_ROLE_SIM_THRESHOLD`)
  - [x] Evaluation helper + tuning guide added
  - [x] Labeled sample template added
  - [x] Threshold sweep + recommendation helpers added

### Phase 5 exit criteria
- [ ] Reduced lexical false positives.
- [ ] Improved semantic matches in manual review set.

---

## PR Breakdown (Recommended)

### PR-1: Phase 0
- [ ] Baseline instrumentation
- [ ] Changelog mismatch fix

### PR-2: Phase 1
- [ ] Type updates
- [ ] Engine labeling
- [ ] UI source/tier badges

### PR-3: Phase 2
- [ ] Validation gates
- [ ] Speculative filter toggle

### PR-4: Phase 3
- [ ] LLM insight generation + cache + fallback

### PR-5: Phase 4
- [ ] Goal-aware blast radius + UI rationale

### PR-6: Phase 5
- [x] Embeddings storage + compute + detector integration

---

## Test Checklist (Run per PR)

### Unit tests
- [ ] Probability source assignment correctness
- [ ] Space quality tier classification
- [ ] Intersection gate behavior
- [ ] Blast radius classification logic

### Integration tests
- [ ] Compute spaces -> detect intersections -> materialize feedback
- [ ] Strategy routes still produce probability summary

### UI tests
- [ ] Badge rendering and tooltip text
- [ ] Speculative toggle behavior
- [ ] Empty states and fallback states

### Regression checks
- [ ] No breakage in strategy reasoning trace panel
- [ ] No breakage in radar probability section
- [ ] No failing DB writes in intelligence-feedback flow

---

## Rollout Checklist

### Feature flags
- [ ] `probability_uncertainty_labels`
- [ ] `probability_validation_gates`
- [ ] `intersection_llm_insights`
- [ ] `goal_aware_blast_radius`
- [ ] `semantic_intersection_matching`

### Deployment stages
- [ ] Internal/staging only
- [ ] Validate telemetry and error rates
- [ ] Partial production rollout
- [ ] Full rollout after acceptance metrics hit

---

## Success Metrics (Post-rollout)
- [ ] Increased user trust signals (fewer “why is this %?” questions)
- [ ] Lower speculative results shown by default
- [ ] Higher acceptance/use of surfaced intersections
- [ ] Lower false-positive intersection materialization rate
- [ ] Stable latency/cost within budget
