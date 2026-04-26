# Rigor-First Intake Pipeline — Implementation Plan

## 0) Current State (validated in codebase)

You already have substantial complexity in place:

- Multi-stage orchestration (`scope -> decompose -> research -> synthesize -> strategy`) in `src/lib/orchestration/pipeline.ts`.
- Deep external research with background runs (`/api/pipeline/research-deep`) and structured parsing in `src/lib/pipeline/deep-research-engine.ts`.
- Claim/evidence schema already present (`claims`, `evidence_items`, `claim_evidence_links`) and used by deep research persistence.
- Prediction infrastructure already present (`prediction_ledger`, resolver cron `/api/cron/predictions-resolve`, baseline capture in `src/lib/twin/capture-baseline.ts`).
- Strategy/test-lab infrastructure present, but primarily LLM simulation-oriented (`/api/pipeline/test-lab`).

## 1) True Gaps vs Your Proposed Flow

### Gap A — No dedicated pre-synthesis rigor gate
The system has research + claims + predictions, but no single mandatory **rigor-first intake stage** that produces:
- normalized claim set,
- evidence requirements per claim,
- confidence calibration,
- competing hypotheses,
- ranked experiments.

### Gap B — Tool orchestration is not yet deterministic-first
Search/research is strong, but there is no explicit policy to:
1. try curated deterministic tools first,
2. then agentic search fallback for niche cases.

### Gap C — Experiment execution is weakly materialized
`test-lab` is mostly variant generation/simulation. Missing full execution model:
- explicit experiment specs,
- run lifecycle,
- measured outputs,
- prediction-vs-result scoring loop.

### Gap D — Calibration is dispersed
Prediction resolution exists, but claim-level and experiment-level calibration is not unified into one intake quality signal.

## 2) Target Architecture (maps to your 1..6 flow)

### New Stage: `rigor_intake`
Run before normal synthesis/strategy for high-depth tiers.

Inputs:
- intake text
- scope result
- initial entities/edges (if available)
- objective(s)

Outputs:
- claim graph (`claim_id`, `claim_text`, `claim_type`, `confidence`)
- evidence requirements (`must_have_evidence`, `source_class`, `freshness`)
- landscape matrix (`digital`, `logic`, `situational`, `baseline` coverage)
- competing predictions
- ranked experiment proposals

### Lifecycle
1. Situational setup + baseline extraction
2. Data scouting plan
3. Landscape-to-KG grounding
4. Objective-conditioned prediction/ranking
5. Approved proposals -> experiment setup/run
6. Result analysis -> final products + variants -> whiteboard feedback

## 3) Minimal Schema Additions (only what is missing)

Use existing `claims`, `evidence_items`, `prediction_ledger`.
Add only these tables:

1. `rigor_runs`
- `id`, `space_id`, `user_id`, `status`, `tier`, `started_at`, `completed_at`
- `landscape_coverage` (jsonb)
- `rigor_score` (numeric)
- `notes` (text)

2. `experiment_specs`
- `id`, `space_id`, `rigor_run_id`, `title`, `hypothesis_claim_id`
- `method`, `required_tools` (jsonb), `predicted_effect` (jsonb)
- `rank_score`, `approval_status`

3. `experiment_runs`
- `id`, `experiment_spec_id`, `status`, `started_at`, `completed_at`
- `observed_result` (jsonb), `deviation` (jsonb), `quality_score`

4. `claim_calibration`
- `claim_id`, `last_calibrated_at`, `calibration_error`, `calibration_band`

## 4) API + Service Additions

### A. New route: `POST /api/pipeline/rigor-intake`
File: `src/app/api/pipeline/rigor-intake/route.ts`

Responsibilities:
- auth/ownership checks
- create/update `rigor_runs`
- call engine
- persist outputs to tables + `spaces.synthesis_data.rigor_intake`

### B. New engine: `src/lib/pipeline/rigor-intake-engine.ts`
Responsibilities:
- extract claims/hypotheses/objectives
- compute evidence requirements
- build landscape coverage matrix
- generate prediction candidates + experiment candidates
- compute initial rigor score

### C. New tool router policy: `src/lib/pipeline/rigor-tool-router.ts`
Responsibilities:
- deterministic tool registry first
- fallback to deep search when confidence/coverage threshold unmet

### D. Optional async: `POST /api/pipeline/experiment/run`
File: `src/app/api/pipeline/experiment/run/route.ts`

Responsibilities:
- execute approved experiment spec
- persist run outputs
- write prediction resolution hooks

## 5) Existing Files to Integrate

1. `src/lib/hooks/use-pipeline.ts`
- Add optional pre-step for tiers `deep|comprehensive`: invoke `/api/pipeline/rigor-intake`.
- Gate continuation when rigor score below threshold (configurable).

2. `src/app/api/pipeline/synthesize/route.ts`
- Read `synthesis_data.rigor_intake` + experiment outcomes.
- Include rigor signals in final ranking + recommendations.

3. `src/app/api/pipeline/strategy-refresh/route.ts`
- Prefer recommendations backed by high-rigor claims/experiments.

4. `src/app/api/pipeline/test-lab/route.ts`
- Extend from variant simulation to experiment-spec generation compatibility.

5. `src/lib/twin/capture-baseline.ts` and `src/lib/twin/resolve-predictions.ts`
- Add cross-links to experiment runs for calibration rollup.

## 6) Scoring Model (initial)

`rigor_score` in $[0,1]$:

$$
R = 0.25C_{evidence} + 0.20C_{coverage} + 0.20C_{prediction} + 0.20C_{experimentability} + 0.15C_{calibration}
$$

- `C_evidence`: claims with high-quality linked evidence.
- `C_coverage`: digital/logic/situational/baseline matrix completeness.
- `C_prediction`: competing predictions with explicit assumptions.
- `C_experimentability`: proportion of predictions tied to executable experiment specs.
- `C_calibration`: historical prediction error bands.

## 7) Rollout Plan

### Phase 1 (2–4 days): Rigor intake core
- Implement `rigor-intake` route + engine.
- Persist to `synthesis_data.rigor_intake` + `rigor_runs`.
- No UI changes required initially.

### Phase 2 (3–5 days): Experiment specs + approvals
- Add `experiment_specs` table and API endpoints.
- Wire approvals into existing strategy UI flow.

### Phase 3 (4–7 days): Experiment runs + calibration
- Add `experiment_runs`, result ingestion, deviation scoring.
- Feed calibration back into strategy ranking.

### Phase 4 (2–4 days): Dashboard + whiteboard feedback loop
- Surface rigor score, unresolved evidence gaps, experiment outcomes.
- One-click push into whiteboard templates.

## 8) Immediate Next Implementation (recommended)

Start with this concrete slice:
1. Add migration for `rigor_runs` + `experiment_specs`.
2. Add `src/lib/pipeline/rigor-intake-engine.ts`.
3. Add `src/app/api/pipeline/rigor-intake/route.ts`.
4. Call it in `use-pipeline` before synthesis for comprehensive mode.
5. Store summary under `spaces.synthesis_data.rigor_intake`.

This gives you the focused pipeline first, without blocking the rest of the system.
