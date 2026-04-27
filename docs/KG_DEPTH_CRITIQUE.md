# Knowledge Graph — Depth, Layering & Construction Critique

**Status as of 2026-04-26 — what the KG actually achieves vs. what "Twin / strategy optimization" implies.**

This document is a hard, evidence-backed critique of how the knowledge graph is constructed, decomposed, materialized, and updated. It is the architectural counterpart to [`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`](COMPUTATIONAL_SUBSTANCE_ROADMAP.md) (which tracks Tier-1 → Tier-4 upgrades for individual numbers). This doc tracks the larger structural gaps: depth ceilings, cosmetic layering, the broken simulation→KG feedback loop, and the missing breadth-then-depth orchestration.

The verdict in one sentence: **the system is an excellent decision-support visualization tool but cannot yet optimize strategies, because (a) decomposition stops at folk-vocabulary nouns rather than mechanistic variables, and (b) simulations never write back to the graph.**

---

## 1. Verdict summary

| Dimension | Score | Status |
|---|---|---|
| Breadth orchestration (8-axis panel, parallel, adaptive) | 8 / 10 | Real and sophisticated |
| Depth orchestration (recursive drilling, layer-aware escalation) | 3 / 10 | User-driven, capped at MAX_DEPTH=2 |
| Layering (operational behavior changes by layer) | 2 / 10 | Tags exist; pipeline ignores them |
| Edge dimensionality (dynamics, conditions, polarity populated meaningfully) | 4 / 10 | ~70% of edges fall to defaults |
| Simulation→KG feedback loop (microexperiments alter KG) | 🟢 closed (D2 phase 2) — propose + approve→commit both shipped | Convergent points queue as twin_proposals; user approval routes through scenario commit and writes live KG |
| Strategy-optimization-ready properties (variables, controllability gradients, hyperedges, etc.) | 3 / 10 | Most properties absent or cosmetic |
| **Overall: decision-support tool, not optimization engine** | — | — |

---

## 2. Evidence — the depth ceiling

The pipeline cannot reach mechanistic fundamentals because **the prompts never ask for them.** Walking through each prompt:

### 2.1 Pass 1 decomposition prompt

7 tiers (surface parse → concept extraction → relationship mapping → unit breakdown → constraints → primitive propositions → axiomatic reduction). Sounds deep. In practice:

- **Tier 4** ("what is this concept made of?") — one-pass enumeration, not recursive structural reduction. A sub-component is named once and never re-decomposed.
- **Tier 6** "primitive propositions" are **logical atoms** (e.g. *"P1: prototype must exist before testing"*) — not **mechanistic atoms** (no working-memory chunks, no latency thresholds, no dose-response curves).
- **Tier 7** "load-bearing assumptions" are framing-level, not mechanism-level.

### 2.2 Pass 2 structuring prompt — [src/app/api/pipeline/decompose/route.ts](../src/app/api/pipeline/decompose/route.ts)

Literal text: *"Convert the analysis below into a JSON object matching this exact schema. Do NOT pad with low-value claims."*

This is **lossless prose→JSON serialization**, not enrichment. Pass 2 has zero capacity to add structural depth. It explicitly *discourages* adding claims.

### 2.3 Why-chain deepener — [src/lib/prompts/why-chain.ts](../src/lib/prompts/why-chain.ts)

Caps at **3 levels, ~12–18 drivers total.** Asks *"what causes this?"* — never *"what is the structure of this?"* It walks **causal ancestors** (still folk-level), not **internal mechanism** (variables, transitions, rates).

For a typical "why is engagement low?" run: Level 1 = "onboarding friction"; Level 2 = "unclear UX flow"; Level 3 = "design inexperience." Stops there. Never reaches *"working memory load > 4 chunks at step 3 → cortisol spike → measurable abandonment rate."*

### 2.4 Expansion prompt

The richest prompt — 5 levels of sub-components with `mechanism` and `dynamics` fields. But:
- `mechanism` is a **one-sentence prose description**, never a functional form
- Output: *"How does cognitive load lead to abandonment? Because it exceeds working memory capacity"*
- What's missing: *"abandonment_rate = 1 - exp(-(load - threshold)² / patience_budget)"* — i.e. a real quantitative law

### 2.5 Empirical depth ceiling

| Mechanism | Hard cap | Practical typical depth |
|---|---|---|
| UI recursive decomposition ([use-recursive-decompose.ts:23](../src/components/canvas/hooks/use-recursive-decompose.ts)) | `MAX_DEPTH = 2` | 1–2 (user-triggered) |
| Cascade detection | `MAX_DEPTH = 4` | 2–3 (graphical hops, not mechanism) |
| Reactive chains | `MAX_CHAIN_DEPTH = 3` | 2–3 |
| Why-chain levels | 3 levels by prompt | 2–3 |
| Signature rings | ~8 by validator | 1–3 seed + 1–2 deepened = ~5 |

**Maximum genuine depth in a real run = ~3–6 causal hops + 4 expansion levels in parallel (NOT recursive) + 3–5 metadata rings.** This is folk-psychology depth, not systems-dynamics depth.

---

## 3. Evidence — layering is cosmetic, not operational

The schema defines two "layering" axes:
- `knowledge_layer ∈ {internal, conceptual, external, bridge}`
- `entity_category ∈ {concrete, abstract, process, relational, epistemic}`

### 3.1 What the code actually does with layers

| Use site | What it does |
|---|---|
| Root tracer ([root-tracer.ts](../src/lib/pipeline/root-tracer.ts)) | Ignores `knowledge_layer` entirely — only walks causal edges |
| Signature materializer ([materialize-signatures.ts](../src/lib/pipeline/materialize-signatures.ts)) | Maps category→controllability mechanically (`concrete→direct, abstract→indirect`). One-line heuristic. |
| Strategizer signals | No signal varies by `knowledge_layer` |
| Coverage gate ([layer-coverage-gate.ts](../src/lib/situation-frame/layer-coverage-gate.ts)) | Checks "is each layer non-empty?" — returns 409 if not. Not a depth driver — a hard block. |
| Decomposition prompt | Does not branch on layer |
| UI rendering | Colors entities by layer ✓ |

### 3.2 What "real" layering would require

A layered decomposition pipeline would have:
1. An `decomposition_depth` integer per entity
2. Strategizer candidate kinds tagged by `kind.layer ∈ {surface, mechanism_L1, mechanism_L2, variable, measurement, intervention}`
3. Per-layer expansion budgets
4. A "breadth-saturated-at-layer-N → drill" detector
5. Different prompts per layer (surface prompts ≠ mechanism prompts ≠ variable prompts)

**None of this exists.** Layers are paint, not pipeline gates.

---

## 4. Evidence — edge dimensionality is mostly defaults

The edge schema looks rich (`polarity, strength, dynamics, conditions, dynamics_properties, temporal_validity`). In practice:

| Field | Default behavior | Typical fill rate |
|---|---|---|
| `polarity` | `neutral` | ~80% populated |
| `strength` | `0.7` if missing | Default-dominant |
| `dynamics` | `linear` (despite prompt warning) | ~25% non-default |
| `conditions` | `null` | <20% populated |
| `dynamics_properties` | `null` | <5% populated |
| `cycle_time`, `threshold_condition` | `null` | rare |

A typical Pass 2 log: *"18 edge annotations, 6 with topology, 4 with non-default dynamics"* — i.e. **>75% of edges fall to defaults**. Edges are advertised as causal-mechanism objects but they're effectively **labeled arrows with confidence scores**. The dynamics taxonomy is aspirational schema, not actual data.

---

## 5. Evidence — the simulation→KG loop is broken

This is the single biggest architectural gap.

| Mechanism | Reads KG | Writes back to entities/edges |
|---|---|---|
| What-If ([api/lab/what-if](../src/app/api/lab/what-if/route.ts)) | yes | **no** — output → `scenarios` row only |
| Combination panel ([combination.ts](../src/lib/canvas/combination.ts)) | yes | **no** — ephemeral, never persists |
| `reactions` table | n/a | **dormant** — schema exists, zero auto-population in routes |
| Convergent points ([for-node](../src/app/api/pipeline/probability-space/for-node/route.ts)) | yes | partial — writes `convergent_points` rows but **doesn't materialize discovered mediators as new entities** |
| Monte Carlo ([monte-carlo.ts](../src/lib/simulation/monte-carlo.ts)) | yes | **no** — pure function, never persists |
| Bootstrap simulation | yes | **no** |
| Edge auditor ([edge-auditor.ts](../src/lib/pipeline/edge-auditor.ts)) | yes | annotative only — `agent_feedback` JSONB, never rewrites edges |
| Variant scoring | yes | only `experiment_variant*` tables — orthogonal to KG |
| Latent variable finder ([latent-variable-finder.ts](../src/lib/agents/latent-variable-finder.ts)) | yes | **no** — latents stay in taxonomy metadata, never become entities |
| Twin diagnostics | yes | flags issues, **doesn't auto-fix** |
| Prediction ledger | n/a | write-once — predictions never recalibrate edge strengths |
| **Scenario commit** ([commit-scenario.ts](../src/lib/twin/commit-scenario.ts)) | yes | **YES — but only on user-approved action_lists** |

**Only scenario commit writes back, and only when the user clicks Apply.** Everything the system *discovers* through simulation never changes the graph. There is no online learning, no auto-promotion of high-signal discoveries, no calibration from prediction error.

A real microexperiment-driven KG would:
1. Discover (convergent points / combination / interaction probe)
2. Test (MC under combination)
3. **Materialize** the discovered mediator as a new latent entity ← *missing*
4. **Calibrate** edge strength from prediction-vs-actual ← *missing*
5. **Auto-propose scenarios** from high-signal discoveries ← *missing*
6. Loop

Steps 1, 2, 6 exist (manually). Steps 3, 4, 5 are absent.

---

## 6. Evidence — breadth machinery vs. depth machinery

The 8-axis panel system is **genuinely sophisticated** and matches the planning-doc vision:

### 6.1 What works (breadth = 8/10)

[frame-extractor/route.ts](../src/app/api/pipeline/frame-extractor/route.ts) + [axis-catalog.ts](../src/lib/probability-space/axis-catalog.ts):
- 8 canonical axes: financial, timeline, actors, causal_scenarios, evidence, assumptions, risk, cultural
- 3–7 picked per run based on question type + data presence + outcome uncertainty (>0.3 → forces causal_scenarios)
- All selected axes fire in **parallel via `Promise.allSettled`** — true parallel breadth
- Each axis has 3–4 prompt variants, distinct token budgets (financial 5500, causal_scenarios 7500), and `instrument_kind` taxonomy
- Outcome-horizon weighting modulates ranker signals

### 6.2 What's missing (depth = 3/10)

| Capability | Status |
|---|---|
| Recursive decomposition past 2 levels | ❌ `MAX_DEPTH=2` in [use-recursive-decompose.ts](../src/components/canvas/hooks/use-recursive-decompose.ts), user-triggered only |
| "Breadth covered at this layer, time to drill" signal | ❌ no layer counter exists in the strategizer |
| Mid-run re-prioritization based on what an axis discovered | ❌ strategizer plans **once**; work queue is static `priority_score DESC` |
| Dynamic depth escalation when high-value entity found | ❌ user must manually pin to trigger drilling |
| Interactor expansion (focal → discovered new entity → drilled) | ❌ convergent_points reference existing entities only |
| Rigor intake gate (declared in [`RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md`](../RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md)) | ❌ documented, not enforced |
| Per-layer expansion budgets | ❌ global token budget only |

**The vision in `R5_STRATEGIC_BRIEF.md` and `RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md` is exactly the broad-then-deep, parallel-vertical-drilling architecture. The breadth half shipped. The depth half didn't.**

---

## 7. Missing patterns

### 7.1 The "broad-in-a-deep-way" pattern

Going **broad inside a deep layer** — once drilled into mechanism layer N, expand laterally at *that* layer (more interacting micro-variables) before drilling further.

This requires:
1. The strategizer knows what layer it's currently at
2. It can decide "more breadth here vs. go deeper" based on signals
3. It can fan out lateral exploration at the deeper layer

**None of these are wired.** The strategizer enumerates all candidate kinds (`axis | edge_space | convergent_point | signature_deepen | intersection_probe | intervention_combination`) flatly. There is no `kind.layer` taxonomy, no expansion budget per layer, no "we've covered breadth at layer N" detector.

### 7.2 Interaction terms as first-class

Strategies fail at interaction boundaries. The schema has `reactions` with `entity_ids[]` (multi-entity) but **zero routes auto-populate it**. Edges remain strictly dyadic. No pipeline detects A∩B∩C effects. This is a structural blind spot.

### 7.3 Phenomenology vs. mechanism distinction

The `entity_category` enum is semantic bucketing (concrete/abstract/process/...), not stratification (phenomenology vs. mechanism vs. variable). The synthesis prompt does not require dual outputs (*what we observe* vs. *why it happens*). The system can't distinguish *"users churn at day 7"* (phenomenological) from *"per Lally 2009, habit formation requires median 66 days; users leave before neurological consolidation"* (mechanistic + grounded).

---

## 8. The 10-property scorecard for strategy optimization

A KG that genuinely supports strategy optimization (not just visualization) needs:

| # | Property | Status | Why it matters |
|---|---|---|---|
| 1 | Hyperedges for interactions | ❌ cosmetic — `reactions` exists, dormant | A∩B∩C effects invisible; strategies fail at interaction boundaries |
| 2 | Partial-controllability gradients (cost, time-to-effect, reversibility) | 🟢 D3 complete — schema + prompts + sanitizer + UI badge + cost-aware ranker + budget filter all shipped | 6-cost taxonomy (direct + opportunity + coordination + risk-adjusted + switching + hidden), recurrence + is_sunk, horizon-modulated cost_efficiency signal |
| 3 | Causal sufficiency claims (sufficient vs. contributing vs. correlate) | ❌ absent | False confidence in weak interventions |
| 4 | Mechanism-grounded entities (literature, not folk nouns) | ⚠️ partial — `provenance` exists, evidence rare | Folk-noun KG, not citation-grounded |
| 5 | Observability tags (unit, scale, measurement protocol, error) | ❌ absent | Entities aren't variables; can't optimize what you can't measure |
| 6 | Time-to-effect distributions | ❌ absent | Point estimates only; no lag quantification |
| 7 | Intervention cost modeling | ❌ absent | No cost-weighted ranking |
| 8 | Counterfactual stability | ⚠️ placebo refutation only | Robustness untested for most claims |
| 9 | Stratified effect heterogeneity (per-cohort) | ❌ absent | "Works on median, harms tail 10%" invisible |
| 10 | Variable-schema grounding (every entity → at least one variable) | 🟡 wiring + coverage gate landed (D1 in progress) — UI + backfill pending | Folk-noun KG → measurement KG transition in progress |

**~3/10. The substrate doesn't yet support what the Twin metaphor promises.**

---

## 9. Priority improvements (ranked by leverage)

These are the architectural changes (not just number-tier upgrades). For per-number Tier-N → Tier-M upgrades, see [`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`](COMPUTATIONAL_SUBSTANCE_ROADMAP.md).

### D1 — Variable-schema layer on entities (FOUNDATIONAL) — **🟡 IN PROGRESS**

**What:** Promote entities from "named noun" to "measurable variable" by attaching unit + scale + optional protocol/cost/observability metadata, gated on `importance ∈ {fundamental, critical}` AND `entity_category ∈ {concrete, abstract, process}`.

**Status (2026-04-26):** First-pass implementation shipped. Remaining work: hard coverage gate, UI badges, backfill agent for pre-D1 entities.

**Files landed:**
- [`supabase/migrations/20260609_entity_measurability.sql`](../supabase/migrations/20260609_entity_measurability.sql) — adds 5 columns + check constraints + indexes (including a `WHERE measurement_unit IS NULL AND importance IN (fundamental, critical)` partial index for cheap "missing-measurement" queries)
- [`src/types/measurement.ts`](../src/types/measurement.ts) — canonical `MeasurementSpec`, `MeasurementProtocol`, `requiresMeasurement()` gate helper, exempt-category list
- [`src/types/analysis.ts`](../src/types/analysis.ts) — `StructuredEntity.measurement?: MeasurementSpec | null`
- [`src/types/database.types.ts`](../src/types/database.types.ts) — `entities.Row/Insert/Update` extended with the 5 new columns
- [`src/types/pipeline-events.ts`](../src/types/pipeline-events.ts) — new `MeasurementCoverageGapEvent` added to the `StructuralEvent` union
- [`src/lib/prompts/decomposition.ts`](../src/lib/prompts/decomposition.ts) — Tier 2 now requires `[MEASUREMENT: ...]` for fundamental/critical quantifiable entities, with explicit honesty fallback `[MEASUREMENT: missing | reason="..."]`
- [`src/lib/prompts/structuring.ts`](../src/lib/prompts/structuring.ts) — Pass 2 schema now carries the `measurement` object + dedicated MEASUREMENT RULES block
- [`src/lib/validation/llm-validators.ts`](../src/lib/validation/llm-validators.ts) — `validateMeasurementSpec()` (soft-fail) + integration in `validateEntity` with importance/category gate that warns rather than throws (matches the existing soft-fail pattern)
- [`src/lib/sanitize.ts`](../src/lib/sanitize.ts) — `sanitizeEntity` extracts the spec into 5 flat columns matching the migration; tolerates both nested `raw.measurement.{unit,scale,...}` and flat `raw.measurement_unit` shapes; drops half-specs (unit without scale)
- **[`src/lib/validation/measurement-coverage-gate.ts`](../src/lib/validation/measurement-coverage-gate.ts) — pure-function gate mirroring [`layer-coverage-gate.ts`](../src/lib/situation-frame/layer-coverage-gate.ts). Default threshold 0.7 (≥70% of fundamental/critical quantifiable entities must carry unit + scale). Below-min-sample fallback (gated count <4) requires all-or-nothing. Includes `rollupMeasurementCoverageGates` for the multi-space synthesize fan-in.**
- **[`src/app/api/pipeline/synthesize/route.ts`](../src/app/api/pipeline/synthesize/route.ts) + [`synthesize-layered/route.ts`](../src/app/api/pipeline/synthesize-layered/route.ts) — gate wired in at the same boundary as the layer-coverage gate. 409 on fail with structured `{ gate: "measurement_coverage", report, bypass_hint }` payload. Bypass via `bypassMeasurementGate: true`. Multi-space route emits `measurement_coverage_gap` SSE events even when bypassed (canvas surfaces the warning).**
- **[`src/app/api/pipeline/research/route.ts`](../src/app/api/pipeline/research/route.ts) — auto-advance chain (research→synthesize handoff, both call sites) passes `bypassMeasurementGate: true` so the first-prompt pipeline never hard-blocks; explicit user-initiated re-runs see the 409.**
- **[`src/components/canvas/chrome/canvas-run-signals-banner.tsx`](../src/components/canvas/chrome/canvas-run-signals-banner.tsx) — listens for `measurement_coverage_gap` SSE events alongside the existing `layer_coverage_gap`. Renders an orange banner (red on hard-block, amber on bypass) showing `measured / gated · coverage% (target threshold%)` and the first 8 unmeasured entity names. Dismissible.**
- **[`src/components/canvas/shapes/kg-node-shape.tsx`](../src/components/canvas/shapes/kg-node-shape.tsx) — per-entity measurement badge in the header chip row. Three states: green pill `📏 unit · scale` (e.g. `users/wk · cont`) when measured; orange pill `📏 UNMEASURED` when fundamental/critical entity in measurable category lacks the spec; silent for important/moderate or relational/epistemic entities (no clutter on entities that don't need a unit).**

**Soft-fail philosophy:** A missing or malformed spec on a fundamental/critical quantifiable entity logs a warning and stores `null` instead of throwing — the system as a whole avoids killing a 30-entity decomposition over one missing unit. The hard gate fires at the synthesis boundary (configurable threshold) and the auto-advance chain bypasses it (visible via SSE events) so green-path pipelines still complete.

**Still to do for D1:**
1. Apply migration to live Supabase (not yet run — local-only until verified)
2. Backfill agent: for pre-D1 entities marked fundamental/critical, propose measurement specs in batch and write to a `measurement_proposals` queue for user review (same pattern as `concept_proposals`)

---

### HITL extraction checklist (input-side gap) — **🟢 LANDED**

**Status (2026-04-26):** First pass shipped. The "auto-extract 3-8 entities from every uploaded asset" path now has a HITL alternative: a review drawer showing 15-30 candidates with rich categories + evidence quotes + suggested flags, with bulk actions (select all / select none / select suggested) + focus slider before commit.

**Why this matters:** the input-side audit flagged this as the highest-leverage research-workflow fix. Researchers uploading PDFs need to control WHAT gets extracted (effect sizes vs methodology vs concepts) — not auto-extraction.

**10-category taxonomy:** `concept | effect_size | method | finding | actor | metric | mechanism | condition | outcome | tool` — richer than the entities table's coarser `entity_category` enum. The commit path collapses to entity_category via `CATEGORY_TO_ENTITY_CATEGORY`.

**Files landed:**
- [`supabase/migrations/20260612_ingested_files_extraction_preview.sql`](../supabase/migrations/20260612_ingested_files_extraction_preview.sql) — adds `extraction_status` (pending_preview | previewed | extracting | extracted | skipped | auto_extracted), `extraction_preview` jsonb, `extraction_target_count` int. Two partial indexes
- [`src/types/extraction-preview.ts`](../src/types/extraction-preview.ts) — `ExtractionCategory` (10 values), `FocusLevel` (shallow/moderate/deep/exhaustive → 5/12/25/999 targets), `ExtractionCandidate`, `ExtractionPreview`, `ExtractionCommitInput`, `ExtractionCommitResult`, `ExtractionStatus` + `CATEGORY_TO_ENTITY_CATEGORY` map
- [`src/lib/pipeline/asset-preextractor.ts`](../src/lib/pipeline/asset-preextractor.ts) — added `previewCandidatesFromAsset()` (richer prompt: 15-30 candidates with categories + evidence quotes + suggested flags) and `commitSelectedCandidates()` (filters preview → entity_category collapse → existing persistPreExtractedEntities). Original `extractEntitiesFromAsset` retained for back-compat
- [`src/app/api/ingest/[assetId]/preview/route.ts`](../src/app/api/ingest/[assetId]/preview/route.ts) — POST. Cache-aware (returns existing extraction_preview unless `force: true`)
- [`src/app/api/ingest/[assetId]/extract/route.ts`](../src/app/api/ingest/[assetId]/extract/route.ts) — POST { selected_candidate_ids, focus_level }. Status-locked against double-commit
- [`src/app/api/ingest/[assetId]/skip/route.ts`](../src/app/api/ingest/[assetId]/skip/route.ts) — POST flips status to 'skipped'. Idempotent
- [`src/components/canvas/hooks/use-ingest.ts`](../src/components/canvas/hooks/use-ingest.ts) — accepts optional `spaceId`, surfaces `ingestedFileId` + `assetClass`
- [`src/components/canvas/hooks/use-extraction-review.ts`](../src/components/canvas/hooks/use-extraction-review.ts) — drawer state machine (open/extract/skip/close, preview cache, error surface)
- [`src/components/canvas/chrome/extraction-checklist-drawer.tsx`](../src/components/canvas/chrome/extraction-checklist-drawer.tsx) — 520px right-side drawer. 10-category color palette. Focus slider. Category filter chips. **[Select all] [Select none] [Select suggested (N)]** bulk actions. Per-candidate checkbox + confidence pill + evidence quote. Footer [Skip] / [Extract N entities]
- [`src/lib/canvas/canvas-bus.ts`](../src/lib/canvas/canvas-bus.ts) — added `setCanvasExtractionReviewer` + `canvasOpenExtractionReview`
- [`src/components/canvas/interaxis-canvas.tsx`](../src/components/canvas/interaxis-canvas.tsx) — mounts `useExtractionReview`, registers reviewer with canvas-bus, renders `<ExtractionChecklistDrawer>` + a loading-placeholder while preview is in flight
- [`src/components/canvas/shapes/asset-card-shape.tsx`](../src/components/canvas/shapes/asset-card-shape.tsx) — adds "Review extract →" pill button on every asset card with a real `assetId`

**End-to-end flow:** drop PDF → asset card paints → click "Review extract →" → drawer renders 15–30 candidates → toggle / focus / select-all-or-suggested → click [Extract N entities] → entities live in KG with `source_tag='asset:<assetId>'`.

**HITL extraction phase 2 (this session):**
- **Asset-card status badge** — `AssetCardShape` extended with `extractionStatus`, `extractedEntityCount`, `previewCandidateCount` props. Card renders a colored pill below the filename:
  - amber "Awaiting review" (pending_preview)
  - blue "N candidates ready" (previewed)
  - gray "Extracting…" (extracting, with disabled pill)
  - green "✓ N entities extracted" (extracted)
  - gray "Skipped" (skipped)
  - amber "Auto-extracted · N" (legacy auto path)
- **Status-aware pill label** — "Review extract →" / "Re-review →" / "Review again →" / "Extracting…" depending on status. Re-review passes `force: true` to regenerate the preview from scratch.
- **`updateAssetCardStatus()` helper** in interaxis-canvas wraps `editor.updateShape` to flip the badge through states. Wired into the drawer's onExtract / onSkip / preview-loaded effects.
- **Auto-refresh entities** — after a successful /extract, calls `refreshSpaceEntities()` so the freshly-committed entities appear on canvas without page reload.
- **Auto-open for research-class assets** — `ingestAndMaterialize` now branches: when `assetClass ∈ {research_pdf, internal_doc}` AND ingest persisted with a real `ingested_file_id`, the drawer opens automatically and the legacy `materialize()` call is skipped (the drawer's commit produces the entities). Other classes (image, dataset, web_article, pasted_text, spec_sheet) keep the legacy auto-materialize behavior — those are usually one-shot context drops.

**Still to do for HITL extraction:**
1. Multi-asset batch review (today: one drawer per asset; for a 5-PDF dump the user clicks 5 times)
2. Drawer header re-preview button for stale-content refresh (currently only the asset-card pill triggers force=true)
3. Settings-panel UI for the focus-level default (today: hardcoded "moderate"; should be user-configurable in reasoning_settings)

**Why first:** Every property below depends on entities being **variables, not nouns**. Without this, "controllability gradient on entity X" is meaningless because X has no scale to control.

**Effort:** Originally estimated ~3 days; first-pass code shipped in one session. Remaining gate + UI + backfill = ~2 more days.

**Touches:** `supabase/migrations/`, `src/types/measurement.ts` (new), `src/types/analysis.ts`, `src/types/database.types.ts`, `src/lib/prompts/decomposition.ts`, `src/lib/prompts/structuring.ts`, `src/lib/validation/llm-validators.ts`, `src/lib/sanitize.ts`.

---

### D2 — Close the simulation→KG loop — **🟢 BOTH HALVES LANDED**

**Status (2026-04-26):** First cut + phase 2 shipped. The propose path (discovery materializer + auto-propose route + for-node wiring) lets high-confidence convergent points auto-queue into the existing `twin_proposals` table. The commit path (extension to the twin-proposal/approve route) takes that queued proposal on user approval, captures a pre-commit snapshot, inserts a scenarios row, runs `commitScenarioToLiveKG`, and writes the discovered edges to the live `entities`/`edges` tables. The simulation→KG loop is now closed end-to-end with HITL approval.

**Key design decision:** Reuse `twin_proposals` table with two added columns (`discovery_source`, `convergent_point_id`) rather than creating a parallel `kg_discovery_proposals` table. Per the user's stored preference (`feedback_check_existing_first.md`) and the audit, twin_proposals already carries the lifecycle (proposed → refined → approved → rejected), audit fields, RLS, and JSONB justification flexibility we need. A new table would be exactly the kind of parallel subsystem to avoid.

**Files landed (D2 first pass — propose path):**
- [`supabase/migrations/20260610_twin_proposals_discovery_source.sql`](../supabase/migrations/20260610_twin_proposals_discovery_source.sql) — adds `discovery_source` text + check constraint, `convergent_point_id` UUID FK (ON DELETE SET NULL), two partial indexes
- [`src/types/discovery-proposal.ts`](../src/types/discovery-proposal.ts) — canonical `DiscoverySource` enum, `DiscoveryProposalJustification` JSONB shape, `DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS`, `DISCOVERED_BY_SIM_SOURCE_TAG` constant
- [`src/lib/pipeline/discovery-materializer.ts`](../src/lib/pipeline/discovery-materializer.ts) — `proposeFromConvergentPoint()` (single-row, idempotent via `convergent_point_id` lookup) and `proposeFromConvergentPointsBatch()` (multi-row, soft-fail per row, capped at 25 proposals/run). Generates `add_edge` actions per interactor → focal-entity link, with polarity / dynamics derived from outcome shape. Uses `crypto.randomUUID()` for client-generated edgeIds (real UUIDs that survive `add_edge` insert into the `edges.id` column).
- [`src/app/api/spaces/[id]/discovery/auto-propose/route.ts`](../src/app/api/spaces/[id]/discovery/auto-propose/route.ts) — POST endpoint accepting optional `{ thresholds, maxProposals }`. Returns `ProposeBatchResult`
- [`src/app/api/pipeline/probability-space/for-node/route.ts`](../src/app/api/pipeline/probability-space/for-node/route.ts) — wired the materializer into Step 6c via Next's `after()`. Non-blocking; the for-node route returns convergent_points immediately and the proposal queue grows seconds later. Soft-fail throughout

**Files landed (D2 phase 2 — commit path):**
- [`src/app/api/spaces/[id]/twin-proposal/approve/route.ts`](../src/app/api/spaces/[id]/twin-proposal/approve/route.ts) — branches on `discovery_source`. For discovery proposals: (1) reads `justification.proposed_action_list`, (2) `captureSnapshot` with reason="pre_strategy" for the scenario's required `parent_snapshot_id`, (3) inserts a `scenarios` row in `'draft'` with the action_list, (4) runs `commitScenarioToLiveKG` which executes each `add_edge` action against the live `edges` table, flips scenario status to `'applied'`, and captures a post-intervention snapshot, (5) marks the twin_proposal `'approved'`. Strategy proposals continue through the original mechanism-flip path. Idempotent on `user_status` (already-approved returns 200; already-rejected returns 409). The reality-calibration gate continues to fire uniformly for both flows — if KG can't reproduce reality, neither writing back discovered edges nor firing mechanisms is trustworthy.

**End-to-end flow (today):**
1. User opens a focal entity's probability space → for-node route runs
2. Engine generates convergent_points with confidence + probability + objective_alignment scores
3. Route persists the convergent_points and returns the response
4. `after()` fires the materializer in the background — for each point with `confidence ≥ 0.75 AND probability ≥ 0.65 AND max(objective_alignment) ≥ 0.6`, a `twin_proposals` row is inserted with `user_status='proposed'`, `discovery_source='convergent_point'`, and an `action_list` of `add_edge` mutations
5. The existing twin proposal review UI renders the queued discovery — user can approve / refine / reject
6. **On approve**: pre-snapshot captured → scenario row inserted → `commitScenarioToLiveKG` runs → each `add_edge` action writes to live `edges` table → post-snapshot captured → twin_proposal flipped to `'approved'`. The simulation→KG loop is closed.

**Threshold rationale:** Medium-confidence (0.75 / 0.65 / 0.6) was chosen so the queue stays signal-rich without being noisy. Auto-materialize-to-live-KG (without user approval) is still deliberately NOT shipped — the commit step always requires the existing twin-proposal approve route to be hit. The HITL gate is the safety valve.

**Still to do for D2 (phase 3+):**
1. **What-If discoveries**: scan `scenarios` rows from `/api/lab/what-if` and propose edges from high-impact `affected_entities` propagation paths. Use `discovery_source='what_if'`.
2. **Combination panel discoveries**: when `novelty='emergent'`, propose either a new edge or a new latent entity. Use `discovery_source='combination'`.
3. **Mediator extraction from outcome.mechanism prose** (D2 phase 3 — bigger work): parse the LLM-generated mechanism text to extract NEW intermediate entities (the "missing mediators" gap from §10 property #4) and add them to the proposal as `add_entity` actions. Today the materializer only generates `add_edge` actions referencing existing entities.
4. **Cron sweep**: periodically re-run the materializer across all live spaces so newly-arrived convergent points (e.g. from manual user explorations) become proposals without depending on the for-node route firing.
5. **UI badge for discovery proposals**: distinguish in the twin-proposal review panel between strategy and discovery proposals so users know what they're approving (today the UI is generic; the response payload now carries `discovery_source` for the UI to read).

### D2 — Close the simulation→KG loop (original spec — see status block above)

**What:** When What-If or convergent-points engine discovers a high-probability mediator, **auto-materialize a latent entity** + edges with `provenance="discovered_by_simulation"` and `source_tag="inferred"`. Wire scenario auto-proposals from high-signal discoveries (above a confidence threshold).

**Sub-changes:**
- New module: `src/lib/pipeline/discovery-materializer.ts` — converts `convergent_points`, what-if outputs, combination novelty findings into proposed entity/edge inserts
- New table: `kg_discovery_proposals` — buffered discoveries awaiting auto-commit or user review
- Threshold gating: convergence_score > 0.7 + agent_consensus > 1 → auto-commit; below → user-review queue
- Update [commit-scenario.ts](../src/lib/twin/commit-scenario.ts) to handle `discovery` action_kind in addition to `intervention`

**Why second:** This converts the system from "static KG that displays simulations" to "KG that learns from simulations." Without it, the Twin metaphor is incoherent.

**Effort:** ~5 days. **Priority:** Highest. **Touches:** `src/lib/pipeline/`, `src/lib/twin/`, `supabase/migrations/`, `src/app/api/lab/what-if/route.ts`, `src/app/api/pipeline/probability-space/for-node/route.ts`.

---

### T1.3 — Promote "Open Lab" pill to primary affordance — **🟢 LANDED**

The audit flagged `OpenLabPill` ([`kg-node-shape.tsx`](../src/components/canvas/shapes/kg-node-shape.tsx)) as buried at 2.5mm font in the badge row, indistinguishable from secondary metadata chips (layer, category, depth, measurement, controllability). Drill-down ergonomics scored 3/10 partly because users couldn't find the entry point to the interactive lab page.

**Files modified:**
- [`src/components/canvas/shapes/kg-node-shape.tsx`](../src/components/canvas/shapes/kg-node-shape.tsx):
  - **OpenLabPill redesigned** — fontSize 8 → 9.5, padding bumped, filled background (layer-color or white-on-hero) instead of ghost outline so it reads as a button not a label, ArrowUpRight chevron added next to "Lab" text, drop shadow with layer-color tint, scale-on-hover (1.04) so the affordance physically responds to interaction
  - Title attribute upgraded from "Open in lab" to "Open in lab — sliders, what-if, convergent points" so users hovering get a description of what they'll find
  - `ArrowUpRight` added to lucide-react imports
- [`docs/KG_DEPTH_CRITIQUE.md`](KG_DEPTH_CRITIQUE.md) — T1.3 status block

**Visual hierarchy intent:** the pill is now visually distinct from secondary badges. Layer/category/depth/measurement/controllability all use ghost-outline styling (`background: transparent + 1px border`); OpenLabPill uses filled-button styling (`background: layer-color + drop shadow`). Users immediately read the contrast as "click here to explore."

**Remaining T-series leverage moves:**
- T2.2 — inline card expansion (cards expand in place instead of route-navigating; eliminates the 3-route drill-down maze; 5–7 days)

### T2.1 — Force-directed relaxation on main canvas — **🟢 LANDED**

The biggest "still photograph → living network" perception fix. The audit scored canvas physics 3/10 because [`use-sync-entities.ts`](../src/components/canvas/hooks/use-sync-entities.ts) places nodes in a deterministic 5-layer grid and never moves them — connected nodes can sit on opposite ends of the canvas, clusters never form. This adds user-triggered Eades spring relaxation that reuses the existing [`force-layout.ts`](../src/lib/graph/force-layout.ts) module (previously only used inside probability-space-shell mini-graphs).

**Files landed:**
- [`src/components/canvas/hooks/use-force-relaxation.ts`](../src/components/canvas/hooks/use-force-relaxation.ts) — `useForceRelaxation()` hook. Snapshots all kg-node-shapes + arrow-shape bindings from the editor, runs `computeForceLayout` with main-canvas-tuned params (springLength=360px to match key-tier card width, 80 iterations for 20+ node graphs, tier-aware node weights so hero/key shapes repel neighbors more strongly), animates from current → target via `requestAnimationFrame` interpolation over 700ms with `easeOutCubic`. Idempotent — calling `relax()` while an animation is in flight cancels and starts fresh
- [`src/components/canvas/chrome/relax-layout-button.tsx`](../src/components/canvas/chrome/relax-layout-button.tsx) — UI affordance with three states: `idle` (Magnet icon, hover-rotate), `relaxing` (Loader2 spin + "Settling…"), `complete` (Check + count of relaxed nodes for ~1.5s). Disabled while animating
- [`src/components/canvas/interaxis-canvas.tsx`](../src/components/canvas/interaxis-canvas.tsx) — mounted in `makeCanvasOverlays` (the `InFrontOfTheCanvas` slot, where `useEditor()` is available) at bottom-right above the bottom dock

**Design choice — user-triggered, not auto-fire:** auto-reflowing a canvas the user has been interacting with would be jarring (nodes the user moved would snap to algorithm positions). The button gives explicit control. After the user drags a node manually, clicking Relax re-converges from the new starting state — useful workflow for "I moved this one node where I want it; reflow everything else around it."

**Tuning rationale:**
- `springLength = 360px` — matches the visual gap of "key"-tier kg-node cards (260px wide + small clear gap), so connected nodes settle one card-width apart
- `iterations = 80` — bumped from the mini-graph default (30) since main canvas often has 20–50 nodes; the existing damping (0.78) + max-velocity (8) keeps convergence stable
- `padding = 80` — generous so edge nodes don't end up partially clipped
- Bounding box anchoring: simulation viewport is sized to the current node bounding box, and target positions are translated back to that origin. This keeps the relaxed graph in roughly the same on-canvas region — no global teleport on click
- Tier-derived node weights (hero=0.95, key=0.7, support=0.5, peripheral=0.3) — hubs visually larger AND mathematically repel neighbors more strongly, mirroring physical intuition

**Animation feel:** 700ms is long enough that the eye registers the motion as deliberate (not a snap) and short enough that the user doesn't lose patience. `easeOutCubic` is gentler at the end of the animation, where the human eye is most sensitive to settle.

**Future T2.1+ work:**
- Drag-with-momentum: when user drags a node, ripple force through connected neighbors so they pull toward the dragged node (live physics, not just on-button-click)
- Auto-fire on run completion (gated on "user hasn't moved any nodes yet" sentinel)
- Cluster-aware pre-pass: detect connected components and lay each out in its own region before global relaxation, reducing cross-cluster edge tangles

### T1 — Strategy hero bar + reasoning panel persistence — **🟢 LANDED**

The two highest-leverage UX fixes from the strategy-flow audit. Together they reframe the experience: instead of users scrolling past 90 seconds of KG unfurl to find a strategy hero buried at y=1080, the strategy(ies) now render as a sticky top bar from the moment the first proposal_ready event arrives. The reasoning panel no longer auto-collapses on terminal status — users can scrub between stages (intake/landscape/kg/proposal/lab) post-run via tab affordance.

**T1.1 — Strategy hero bar (`src/components/canvas/chrome/strategy-hero-bar.tsx`):**
- New chrome component pinned to `inset-x-0 top-0 z-30` — always visible above all canvas pan/zoom
- Subscribes to `useRunEventStore` for `proposal_ready` events with `kind="strategy"`. On detection, fetches full batch from `/api/spaces/[id]/twin-proposal` and renders top-N strategies SIDE-BY-SIDE as 340px-wide cards in a horizontally-scrollable row (NOT chip-swapped one-at-a-time as the in-canvas hero shape did)
- Each card: rank badge (#1 ⭐ Crown for active), 1-line title, 2-line summary clamp, posture chip (color-coded), confidence %, "Set active" button (POST `/swap-rank` with optimistic UI update + refresh), per-card "Open detail" arrow
- Active card gets thicker border + soft accent shadow matching the strategic posture color
- Collapsible — click "Strategy" brand button to fold to compact pill row showing just rank + title; expand restores full card grid
- "Strategy synthesizing…" placeholder pill shown while a run is active but no strategies have arrived yet
- Mounted in [`interaxis-canvas.tsx`](../src/components/canvas/interaxis-canvas.tsx) right after CanvasRunSignalsBanner so z-ordering puts it above coverage-gap warnings without overlapping
- The existing in-canvas `strategy-hero-card-shape` continues to paint at y=1080 as a draggable canvas anchor — this bar is the always-visible promo, the shape is the canvas tether

**T1.2 — Reasoning panel persistence + per-stage tabs (`src/components/canvas/chrome/canvas-reasoning-trace-panel.tsx`):**
- Removed the `useEffect` that auto-collapsed on `status === "completed" | "failed" | "timeout"`. The chevron remains user-controllable; the panel now stays open by default through every stage AND post-run
- Added per-stage tab row: one tab per pipeline stage that has emitted `reasoning_chunk` events, in canonical order (intake → landscape → kg → proposal → lab → results). Stages with no chunks are filtered out (no empty tabs)
- Tabs show Loader2 spinner for the stage currently emitting; Check icon for completed stages
- Default-selected tab is the most-recently-active stage (follows live reasoning); user can click another tab to scrub through stage history without losing the live tail
- Header label updated to show current stage: "AI reasoning · KG · live" / "AI reasoning · Proposal · done"
- Snapshots tracked per-stage rather than as a single `latest` — uses `s.sequence` (StreamedEvent.sequence, the structural-event SSE field) to compare freshness within and across stages
- Critical fix: this surfaces reasoning during PROPOSAL + SYNTHESIS — the stages where strategy quality is determined. Pre-T1.2 the panel auto-hid right when those stages started, hiding the most important reasoning

**Verification:**
- `tsc --noEmit -p tsconfig.json` clean: 0 errors across all touched files
- Next dev server reachable on `:3000`, home page returns HTTP 200 with full HTML render — no broken imports or runtime crashes from the new chrome components
- Full visual verification (hero bar with real strategies, panel with multi-stage tabs) requires an authenticated session + a completed pipeline run. Honest disclosure: those interaction paths cannot be verified from a fresh dev-server boot without seed data; the components type-check, mount cleanly, and gate their visibility on data conditions (`runId` + `proposal_ready` for the bar; `reasoning_chunk` events for the tabs)

**Remaining T1+ work** (separate sessions):
- T2.1 — post-run force-directed layout on main canvas (the bigger "feel alive" change)
- T2.2 — inline expansion pattern for cards instead of route navigation (eliminates the 3-route maze)
- T1.3 — promote the "Open Lab" pill on kg-node-shape to a primary card affordance (small, visible win)

### D3 — Controllability profiles — **🟢 PHASE 3 LANDED (cost-aware ranker + budget-strict filter)**

**Phase 3 (this session):** the cost data captured in phase 1+2 is now actually *consumed* by the ranker. New `cost_efficiency` signal (inverse-log normalized, budget-relative when set) added to the SignalProfile + DEFAULT_WEIGHTS at 0.03 weight. The `strategy_engine` agent profile (intervention-planner lens) bumps it to 0.04. Horizon-aware modulation: 1.5× under `immediate` outcome_horizon, 1.2× short_term, 0.7× long_term — cheap-fast wins under deadlines, expensive root-cause work tolerated when payoff window is years. Hard cost-budget filter wired pre-ranking when `reasoning_settings.costBudgetStrictness="hard"` — over-budget candidates excluded entirely; soft strictness (default) keeps them in the pool with low cost_efficiency scores.

**Files added/modified in phase 3:**
- [`src/types/space-plan.ts`](../src/types/space-plan.ts) — `SignalProfile.cost_efficiency: number | null` with full docstring covering inverse-log normalization rationale, sunk-cost short-circuit, opportunity-dominated case, horizon modulation behavior
- [`src/lib/pipeline/space-strategizer/signals.ts`](../src/lib/pipeline/space-strategizer/signals.ts) — new `costEfficiencySignal()` function. Sunk costs → 1.0 (counter to sunk-cost fallacy). Free → 1.0. Budget-relative scoring when `cost_budget` set: 1.0 at ≤10% of budget, 0 at ≥2× budget, smooth `1 - sqrt(t)` interp between. Absolute log-cost when no budget: `(6 - log10(cost)) / 4` over [$100, $1M]. Bundle gains `controllability_cost_by_entity` map + `cost_budget` + `cost_budget_strictness` fields
- [`src/lib/pipeline/space-strategizer/index.ts`](../src/lib/pipeline/space-strategizer/index.ts) — `loadSignalBundle` now derives the per-entity dominant cost figure: opportunity_cost.estimate when `cost_kind="opportunity_dominated"`, intervention_cost.estimate annualized for recurring (×12 monthly, ×1 yearly, ×24 continuous), as-is for one_time. Hard cost-budget filter applied between enumerate and rank — over-budget candidates excluded entirely
- [`src/lib/pipeline/space-strategizer/ranker.ts`](../src/lib/pipeline/space-strategizer/ranker.ts) — `cost_efficiency: 0.03` added to DEFAULT_WEIGHTS. Rebalanced by shaving 0.01 from centrality + 0.02 from axis_calibration. Sum = 1.000 ✓
- [`src/lib/pipeline/space-strategizer/horizon-weights.ts`](../src/lib/pipeline/space-strategizer/horizon-weights.ts) — `cost_efficiency` modulation: immediate 1.5×, short_term 1.2×, long_term 0.7×. Pure multiplicative, composes with user weight overrides
- [`src/lib/agents/registry.ts`](../src/lib/agents/registry.ts) — `strategy_engine` agent profile (intervention-planner lens) bumps `cost_efficiency` to 0.04 by shaving 0.02 from controllability_spread and 0.02 from centrality. Other agent profiles inherit `cost_efficiency: 0` from ZERO_WEIGHTS — conservative until field data on whether LLM cost estimates are credible

**End-to-end story (D3 complete):**
1. LLM emits `[CONTROLLABILITY: ...]` for fundamental/critical levers including direct cost, opportunity cost, recurrence, sunk flag, cost_kind classification
2. Pass 2 structurer carries it as typed `manifold.operational.controllability` field
3. Sanitizer rejects malformed (negative costs, inverted ranges); mirrors reversibility from strategic
4. Strategizer's `loadSignalBundle` derives a per-entity dominant cost figure (opportunity_cost when opportunity_dominated, otherwise annualized intervention_cost)
5. `costEfficiencySignal` returns budget-relative score (or absolute log-cost when no budget)
6. Ranker weights it at 0.03 default (0.04 in strategy_engine profile), modulated by horizon (1.5× immediate, 0.7× long_term)
7. Hard budget mode filters over-budget candidates entirely before ranking
8. Canvas badge renders the full profile inline so users see at a glance which levers are cheap-fast vs expensive-slow vs opportunity-dominated

### D3 — Controllability profiles — **🟡 PHASE 2 LANDED (richer cost types + UI badge + reasoning_settings)**

**Phase 2 (this session):** the cost model went from "single direct dollar estimate" to a real taxonomy — direct + opportunity + cost-kind classification + recurrence + sunk-marker. The decomposition prompt now explicitly cites Bastiat's "what is seen and what is not seen" framing for opportunity cost. The strategizer reads `reasoning_settings.solveBy` and overrides the LLM-inferred outcome_horizon (explicit user constraint wins). A per-entity controllability badge renders on the canvas with kind / cost / recurrence / lag / reversibility — yellow-orange tint for opportunity_dominated levers visually flags hidden-cost framings.

**Files added/modified in phase 2:**
- [`src/types/controllability.ts`](../src/types/controllability.ts) — added `OpportunityCost`, `CostRecurrence` enum, `CostKind` enum (direct | opportunity_dominated | coordination_dominated | risk_adjusted_dominated | switching_dominated | hidden_externalities), `is_sunk` flag on `InterventionCost`. Honesty-rule comments cite the strategic rationale per cost type
- [`src/lib/prompts/decomposition.ts`](../src/lib/prompts/decomposition.ts) — Tier 2 prompt now asks for the full cost taxonomy with explicit guidance: zero-sum-at-resource-layer rationale for opportunity cost, Brooks' Law for coordination_dominated, real-options framing for switching_dominated, recurrence as strategically critical
- [`src/lib/prompts/structuring.ts`](../src/lib/prompts/structuring.ts) — Pass 2 schema accepts the new fields; CONTROLLABILITY RULES block updated with cost-type guidance
- [`src/lib/sanitize.ts`](../src/lib/sanitize.ts) — extracts opportunity_cost (rejects negative estimates), cost_kind (enum check), intervention_cost.recurrence + is_sunk
- [`src/components/canvas/shapes/kg-node-shape.tsx`](../src/components/canvas/shapes/kg-node-shape.tsx) — new `ControllabilityBadge` component renders inline pill `KIND · $cost · opp $cost · lag · rev`. Yellow-orange palette for `opportunity_dominated`, orange for risk/hidden/gated, blue for partial, green for full+direct, gray for observable. Hover tooltip shows full structured profile
- [`src/types/reasoning-settings.ts`](../src/types/reasoning-settings.ts) — added optional `costBudget`, `costBudgetStrictness` ("soft" | "hard"), `solveBy` (free-form deadline). Plus `mapSolveByToHorizon()` helper that maps "this week" / "by Q3" / ISO dates to the existing 4-tier outcome_horizon enum
- [`src/lib/pipeline/space-strategizer/index.ts`](../src/lib/pipeline/space-strategizer/index.ts) — `loadSignalBundle` now reads `spaces.reasoning_settings`. User's `solveBy` overrides LLM-inferred outcome_horizon (which then drives the existing `horizon-weights.ts` modulation). `costBudget` captured for the follow-up cost-aware ranker

**Cost taxonomy (rationale):**
The system now models 6 cost types because direct dollars is the weakest signal in strategy decisions. **Opportunity cost** dominates for senior-leader-time and capital-allocation decisions in resource-constrained orgs (a $50k spend in a $500k-runway startup vs the same $50k in a $500M-cash corporation has dramatically different opportunity cost). **Coordination cost** scales superlinearly (Brooks' Law: N people → N(N-1)/2 channels). **Risk-adjusted cost** = direct + p(failure) × recovery_cost (Jensen's inequality penalizes wide-variance estimates). **Switching cost** matters when uncertainty is high (real-options theory: prefer low-switching-cost levers to preserve optionality). **Hidden externalities** flag categories prone to compounding tech debt / cultural drag. **Sunk costs** are explicitly discounted by the ranker to counter the sunk-cost fallacy.

### D3 — Controllability profiles — **🟡 FIRST PASS LANDED**

**Status (2026-04-26):** Variable-schema gradients (intervention_cost, time_to_effect, modulation_range, controllability_kind) wired through the pipeline. Strategizer signal upgraded from binary to a 4-tier gradient.

**Architectural decision (per the audit + memory rule `feedback_check_existing_first.md`):** D3 EXTENDS `manifold.operational` (existing JSONB blob already housing `resource_intensity` + `dependency_count`) rather than introducing new top-level entity columns. The audit confirmed that adding parallel surfaces would have been exactly the structure-creep the user has flagged as a recurring fear. Reversibility continues to live on `manifold.strategic.reversibility` (its existing home, 3-tier qual enum); the sanitizer mirrors it into the controllability echo for ergonomic single-branch reads.

**Key surfaces already in place (NOT replaced by D3):**
- `manifold.strategic.reversibility` — qualitative 3-tier
- `manifold.operational.resource_intensity` — qualitative 3-tier
- `edge.utility.actionability` + `edge.utility.propagation_speed` — edge-level (per-relationship cascade lag, distinct from per-lever time-to-effect)
- `entity.measurement_cost_estimate` (D1) — cost to **observe**, distinct from D3's intervention_cost (cost to **move**)
- `horizon-weights.ts` — outcome_horizon → multiplicative weight overrides on `user_controllable_lever`, `goal_proximity`, etc. (already shipped pre-D3)

**Files landed (D3 first pass):**
- [`src/types/controllability.ts`](../src/types/controllability.ts) — canonical `ControllabilityKind` enum (fully_controllable | partially_controllable | gated | observable_only), `InterventionCost`, `TimeToEffect`, `ModulationRange`, composite `ControllabilityProfile`. Plus `bucketLag()` helper for free-text lag → `LagBucket` mapping
- [`src/types/analysis.ts`](../src/types/analysis.ts) — `StructuredEntity.manifold.operational.controllability?: ControllabilityProfile`
- [`src/lib/prompts/decomposition.ts`](../src/lib/prompts/decomposition.ts) — Tier 2 now requests `[CONTROLLABILITY: kind=… intervention_cost={…} time_to_effect={…} modulation_range?={…}]` for fundamental/critical entities that are levers. Explicit honesty rule: omit fields when unknown rather than fabricating defaults
- [`src/lib/prompts/structuring.ts`](../src/lib/prompts/structuring.ts) — Pass 2 schema accepts `manifold.operational.controllability` + dedicated CONTROLLABILITY RULES block instructing the LLM not to fabricate cost / lag estimates
- [`src/lib/sanitize.ts`](../src/lib/sanitize.ts) — extracts the controllability profile during manifold packing; drops malformed leaves; rejects `min ≥ max` modulation_range; rejects negative intervention_cost; mirrors `manifold.strategic.reversibility` into the controllability echo
- [`src/lib/pipeline/space-strategizer/signals.ts`](../src/lib/pipeline/space-strategizer/signals.ts) — `userControllableLeverSignal` upgraded from binary {0, 1, null} to gradient {0, 0.4, 0.6, 1.0, null}. Legacy `driver_metadata` (why-chain stamp) still wins when present (back-compat); new `controllability_kind_by_entity` map populated from `manifold.operational.controllability.kind` for any entity (not just drivers)
- [`src/lib/pipeline/space-strategizer/index.ts`](../src/lib/pipeline/space-strategizer/index.ts) — `loadSignalBundle` populates `controllability_kind_by_entity` for every entity carrying the manifold field. Defensive JSONB walking; soft-fails per entity

**End-to-end flow (today):**
1. LLM emits `[CONTROLLABILITY: ...]` for fundamental/critical levers in Tier 2 of decomposition
2. Pass 2 structurer carries it as a typed `manifold.operational.controllability` field
3. Sanitizer drops half-specs / negative costs / inverted ranges; mirrors reversibility from strategic
4. Strategizer's `loadSignalBundle` reads it into `controllability_kind_by_entity` map
5. `userControllableLeverSignal` returns a gradient score so the ranker distinguishes a fully-controllable lever (1.0) from a partially-controllable one (0.6) from a gated toggle (0.4) from an observable-only constraint (0)
6. Existing `horizon-weights.ts` already weights this signal up to 1.5× under `immediate` outcome_horizon — D3's gradient now has more headroom to differentiate

**Still to do for D3:**
1. **Cost-aware ranker enhancement**: incorporate `intervention_cost.estimate` directly into a new signal (e.g. inverse-log-cost normalized by space's cost distribution). Today the cost is captured but not yet ranked on. Conservative until we have field data on whether LLM cost estimates are credible enough to weight.
2. **UI badge on entity cards**: render `📐 $2k · 1-2wk · easily-rev` on fundamental/critical lever entities (companion to D1's measurement badge)
3. **`reasoning_settings` cost/time budget**: optional space-level constraints (`max_cost`, `solve_by`) that the strategizer reads to filter candidates.

### D3 — Controllability profiles (original spec — see status block above)

**What:** Add to `entities` table:
- `controllability_kind` enum: `fully_controllable | partially_controllable | gated | observable_only`
- `control_cost` numeric (with `control_cost_unit` text)
- `time_to_effect_median` interval, `time_to_effect_p90` interval
- `reversibility` enum: `easily_reversible | costly_to_reverse | irreversible`
- `modulation_range` jsonb: `{min, max, unit}`

**Prompt change:** Why-chain deepener emits structured `stop_reason`:
```json
{
  "stop_reason": "user_controllable",
  "control_cost_estimate": 2000,
  "control_cost_unit": "USD",
  "time_to_effect_weeks": [2, 4],
  "reversibility": "easily_reversible",
  "modulation_range": {"min": 0, "max": 1, "unit": "fraction"}
}
```

**Strategizer change:** Add cost-weighted ranking signal. Replace the `user_controllable_lever: 0.06` scalar with a cost-aware function.

**Effort:** ~3 days. **Priority:** High. **Touches:** `supabase/migrations/`, `src/lib/prompts/why-chain.ts`, `src/lib/pipeline/space-strategizer/signals.ts`.

---

### D4 — Multi-way interaction discovery — **🟡 FIRST PASS LANDED**

**What:** Activates the dormant `reactions` table noted in §5 of this critique ("schema exists, zero auto-population in routes"). Detects 3-way emergent interactions where joint(A, B, C) ≠ linear sum of marginal effects on a downstream target — the strategically-critical class of relationships our previously-dyadic edge schema couldn't express (§7.2 of the critique).

**Method:** Standard 2³ factorial ANOVA decomposition, executed as 7 Monte Carlo runs per candidate triple sharing a fixed seed:

```
Δ_ABC = E(ABC) − E(AB) − E(AC) − E(BC) + E(A) + E(B) + E(C)
```

where `E(...)` is the target's p50 deviation under the labeled perturbation set. Same seed across all 7 cells means Gaussian draws cancel and the difference is pure interaction signal, not sampling noise. Baseline `E(∅) = 0` is implicit (priorMean=0 → no perturbation = zero deviation by construction), saving 1/8 of the MC budget per triple.

**Status (2026-04-26):** First-pass implementation shipped. Soft-fail throughout; cost-bounded (MAX_TRIPLES=12 per detection, 7 MC calls each at 300 iterations × 6 timesteps).

**Files landed:**
- [`src/lib/pipeline/interaction-discovery.ts`](../src/lib/pipeline/interaction-discovery.ts) — pure-function detector. `detectInteractions()` finds candidate triples (top-K upstream entities for top-K downstream targets, ranked by importance + leverage + centrality), runs 7-cell ANOVA per triple, scores emergence as `|Δ_ABC| / max(|abc|, ε)`, returns `InteractionEffect[]` with cells, three_way_term, polarity, probability mapping. Tunables: `MAX_TARGETS=3`, `MAX_UPSTREAM_PER_TARGET=5`, `MAX_TRIPLES=12`, `INTERACTION_EMERGENCE_THRESHOLD=0.2`, `MIN_JOINT_EFFECT_MAGNITUDE=0.05`, `DETECTION_SEED=1729`.
- [`src/lib/pipeline/interaction-discovery-tail.ts`](../src/lib/pipeline/interaction-discovery-tail.ts) — top-level orchestrator. Loads entities + edges + `improvement_goals` (preferred targets), runs detection, persists each effect as a `reactions` row with `reaction_type='emergent'` (existing enum value, no schema change). Triple participants stored in `entity_ids[]` along with the target — strategizer signal then GIN-queries on entity_ids. Mechanism + implication strings explain the synergy/antagonism for human readers; `provenance` carries the full ANOVA cells + emergence_score.
- [`src/types/space-plan.ts`](../src/types/space-plan.ts) — added `interaction_density: number | null` to `SignalProfile`.
- [`src/lib/pipeline/space-strategizer/signals.ts`](../src/lib/pipeline/space-strategizer/signals.ts) — new `interaction_density` field on `SignalInputBundle`; new `interactionDensitySignal()` extractor; wired into `computeSignalProfile`. Returns null for entities with zero interactions (matches the bundle's null-aware "no opinion" semantics).
- [`src/lib/pipeline/space-strategizer/index.ts`](../src/lib/pipeline/space-strategizer/index.ts) — `loadSignalBundle` now scans the `reactions` table once per plan cycle for `reaction_type='emergent'` rows and buckets counts by entity. Single query, GIN-indexed entity_ids[], soft-fail on query error.
- [`src/app/api/pipeline/decompose/route.ts`](../src/app/api/pipeline/decompose/route.ts) — wired in via unconditional `after()` block right after the D8 community-detection block. Runs in parallel with D8 (no dependency between them); both read from the same persisted entities/edges.

**Cost profile:** ≈ 12 triples × 7 MC calls × 300 iterations × 6 timesteps = ~150k propagation steps + ~12 edges-fetch queries. ~1.5–3s of pure compute on server hardware. Vercel-safe within `after()` budget.

**What changes for users:**
- Strategy ranking now prefers candidates whose joint-with-others impact is super-additive (the previously invisible "A+B+C together produce X but neither alone does" class)
- The dormant `reactions` table is now populated automatically — emergent interactions persist as auditable rows with full ANOVA provenance (cells, three_way_term, emergence_score, method tag)
- Strategizer plans can recommend "intervene on this triple jointly" vs "pick one"; antagonistic interactions surface as "do not co-pull these levers"
- `interaction_density` strategizer signal (initial weight ~0.05, tunable from telemetry) gives candidates a small boost when they participate in emergent effects

**Honesty contract:**
- Below `MIN_JOINT_EFFECT_MAGNITUDE`, no interaction is claimed — small absolute effects are too noisy to act on regardless of relative emergence
- Below `INTERACTION_EMERGENCE_THRESHOLD`, no interaction is claimed — detected emergence must be 20%+ of the joint magnitude
- ci_low/ci_high are conservative (probability ± 0.1–0.15) — we don't bootstrap the ANOVA cells, so the interval reflects directional confidence, not a real CI. This is documented in the persisted reactions row's mechanism string
- `provenance.method = "2x2x2_factorial_anova_via_monte_carlo"` — anyone auditing a row knows exactly how it was produced

**Effort:** Originally estimated ~5 days; first-pass code shipped in one session (~4–5 hours).

**Touches:** `src/lib/pipeline/interaction-discovery.ts` (new), `src/lib/pipeline/interaction-discovery-tail.ts` (new), `src/lib/pipeline/space-strategizer/signals.ts`, `src/lib/pipeline/space-strategizer/index.ts`, `src/types/space-plan.ts`, `src/app/api/pipeline/decompose/route.ts`.

**Still to do:**
1. UI rendering of emergent interactions on canvas (consume `reactions` rows where `reaction_type='emergent'`, render as multi-way edge / intersection card)
2. Bootstrap the ANOVA cells for real CIs (currently `ci_low/ci_high` are heuristic ± offset around `probability`)
3. Tune emergence threshold + magnitude floor from real-run telemetry
4. Extend to 4-way interactions when a 3-way detection saturates the threshold (Δ_ABCD decomposition is the natural next step)
5. Strategy planner LLM prompt update to actually USE the `interaction_density` signal in candidate ranking explanations

---

### D5 — Real layer-aware decomposition

**What:** Implement the broad/deep/broad-in-deep orchestration:

1. Add `decomposition_depth` integer column on `entities` (0 = surface, 1 = mechanism_L1, etc.)
2. Tag strategizer candidate kinds with `layer` metadata (surface candidates vs. mechanism-level vs. variable-level)
3. Add per-layer expansion budgets to `space_plans`: `breadth_budget_per_layer`, `depth_escalation_threshold`
4. Implement "breadth-saturated-at-layer-N" detector in the planner — if coverage at layer N exceeds threshold, fan out vertical drilling into top-K candidates at layer N+1
5. Add "broad-in-a-deep-way" mode: when drilled into a focal entity at layer N, run lateral expansion (find sibling micro-variables at the same depth) before going deeper

**Effort:** ~5–7 days. **Priority:** Medium-high. **Touches:** `src/lib/pipeline/space-strategizer/`, `src/lib/pipeline/space-work-queue.ts`, `supabase/migrations/`.

---

### D5b — Confidence-gated drilling (DRIFT-style) — **🟡 IN PROGRESS**

**What:** Replaces the static `MAX_DEPTH=2` cap in [`use-recursive-decompose.ts`](../src/components/canvas/hooks/use-recursive-decompose.ts) with a confidence-decay gate driven by the strategizer's existing signals (centrality, convergence_count, agent_convergence_count, causal_depth_normalized, leverage_point). Adds the **lateral-at-depth** pattern (the user's "broad-in-a-deep-way") on top — when sibling drills share convergence chains, drill them at the same depth before going deeper.

**Pattern source:** Microsoft GraphRAG DRIFT Search Figure 1 phase B — confidence glyph on each node decides whether to continue expansion. Adapted from query-time exploration to BUILD-time strategic decomposition; the lateral-at-depth piece is unique to our domain (DRIFT only does plain depth-first).

**Why it matters:** the depth ceiling we documented in §2.5 was capped client-side at 2, and we critiqued ourselves in §6.2 for "no autonomous escalation based on signals." This closes both gaps without adding a new orchestration layer — reuses existing strategizer signals, just at the drill decision point.

**Status (2026-04-26):** First-pass implementation shipped. Soft-fail throughout — API gracefully degrades when signals are missing (legacy spaces), hook gracefully degrades when API returns no `drill` payload (legacy clients).

**Files landed:**
- [`supabase/migrations/20260610_decomposition_tree.sql`](../supabase/migrations/20260610_decomposition_tree.sql) — adds `pipeline_runs.decomposition_tree jsonb` (append-only flat array of drill records) + GIN index
- [`src/lib/pipeline/drill-confidence.ts`](../src/lib/pipeline/drill-confidence.ts) — pure-function module: `extractDrillSignalsFromEntity`, `computeParentQualityScore` (weighted-avg over present signals, null-aware), `decideDrillContinuation` (depth decay + threshold gate), `findLateralSiblings` (Jaccard ≥0.34 over `converges_chains`), `DrillRecord` type. Tunables: `ABSOLUTE_MAX_DRILL_DEPTH=6`, `DRILL_CONFIDENCE_THRESHOLD=0.4`, `DRILL_CONFIDENCE_DECAY=0.78`
- [`src/app/api/canvas/recursive-decompose/route.ts`](../src/app/api/canvas/recursive-decompose/route.ts) — loads goal count + agent count + max centrality_rank in parallel, computes parent_quality_score, decides continuation, queries peer entities at same depth for lateral siblings, builds drill records, appends to `pipeline_runs.decomposition_tree`, returns enriched `drill: { confidence_to_continue, should_continue, stop_reason, lateral_sibling_ids, ... }` payload
- [`src/components/canvas/hooks/use-recursive-decompose.ts`](../src/components/canvas/hooks/use-recursive-decompose.ts) — replaces `MAX_DEPTH=2` constant with `ABSOLUTE_MAX_DRILL_DEPTH` import. Tracks `confidenceByEntity` per entity. Stop conditions: `depth >= ABSOLUTE_MAX_DRILL_DEPTH-1` (safety) OR `inheritedConfidence === 0` (API said stop). Schedules lateral siblings at the SAME depth as new children when API surfaces them.

**What changes for users:**
- No more hard 2-layer cap on auto-drill — high-signal chains (high centrality + multiple agents triangulating + on the goal's causal trace) drill up to ~3-4 layers before confidence decays below threshold
- Low-signal chains stop early (was previously always 2 layers regardless of signal strength)
- Lateral expansion at the same depth before going deeper — when convergence overlaps between sibling drills, the system surfaces them as a "depth-N cluster" before drilling any one to depth N+1

**Soft-fail philosophy:**
- API: when goal count = 0 or agent count = 0, those signals return null and the weighted-avg renormalizes over the present signals (centrality + leverage + causal_depth typically still available)
- Hook: when API doesn't return a `drill` payload (legacy or error), `inheritedConfidence` defaults to 0 — equivalent to the pre-D5b behavior (no further drilling). Existing direct-from-canvas first drills always run because depth-0 entities have no inherited confidence yet.
- Tree append: read-modify-write to `pipeline_runs.decomposition_tree` is wrapped in try/catch; failure is logged and never blocks the canvas response

**Outcome alignment intentionally omitted from this lightweight API.** Resolving `pipeline_runs.target_outcome` to a specific `entity_id` requires the strategizer's `directed_outcome_hops` BFS, which is too heavy for a per-drill call. Drill confidence falls back to 5 of 6 signals; the weighted-average renormalization handles the missing signal cleanly.

**Effort:** Originally estimated ~3 days; first-pass shipped in one session.

**Touches:** `supabase/migrations/`, `src/lib/pipeline/drill-confidence.ts` (new), `src/app/api/canvas/recursive-decompose/route.ts`, `src/components/canvas/hooks/use-recursive-decompose.ts`.

**Still to do:**
1. Apply migration to live Supabase
2. UI badge: confidence-glyph on freshly-drilled children (mirrors DRIFT Figure 1's confidence indicator)
3. Tune thresholds + decay constant from real-run telemetry once shipped
4. Eventual integration of outcome_alignment when the strategizer's `directed_outcome_hops` becomes available at this API's call site (cheap async cache?)

---

### D6 — Calibration from prediction error

**What:** When `prediction_ledger` records actuals against predictions, run a Bayesian update on the relevant edge strengths:

1. Identify edges in the causal path used by the prediction
2. Compute prediction error = (actual - predicted_p50) / predicted_stddev
3. Bayesian update on edge_strength priors based on cumulative prediction-error history
4. Tag updated edges with `score_provenance="calibrated_from_prediction_error"` and `last_calibrated_at`

**Why this matters:** Closes the online learning loop. Without it, the KG is a one-shot model that never improves from real-world feedback.

**Effort:** ~3 days. **Priority:** Medium. **Touches:** `src/lib/pipeline/`, new module `src/lib/calibration/bayesian-edge-update.ts`.

---

### D9 — Targeted self-reflection on defaulting fields — **🟡 IN PROGRESS**

**What:** Single-pass targeted gleaner that runs AFTER Pass 2 of decomposition, recovering information the Pass 2 prompt's "do not pad" rule caused the LLM to omit. Three field passes:
1. **Edge dynamics** — edges defaulted to `linear`, ask LLM to confirm or upgrade to threshold/compounding/exponential/etc.
2. **Edge conditions** — causal/enabling edges with `conditions=null`, ask for IF-clause or `is_unconditional` confirmation.
3. **Entity measurement** (D1 follow-up) — fundamental/critical entities the D1 prompt missed get a second chance, including honest "no measurement possible because…" excusal.

**Pattern source:** Microsoft GraphRAG paper §A.2 Figure 3 — self-reflection gleaning loop showing 2.3× recall improvement at 600-token chunks. Adapted to our narrower use case (specific fields, not all extractions) and our typical space size (15–50 entities, single batch fits in one call).

**Cheap preflight:** Each pass starts with a yes/no LLM call asking *"is anything in this list worth gleaning?"* — skips the expensive call when placeholder values are already correct. Mirrors GraphRAG's logit-bias yes/no trick (we use `llmJSON` with a tiny boolean schema since our wrapper doesn't expose `logit_bias`).

**Status (2026-04-26):** First-pass implementation shipped same session. Soft-fail throughout — gleaner errors leave `dedupedEntities` / `dedupedEdges` untouched.

**Files landed:**
- [`src/lib/prompts/glean-defaults.ts`](../src/lib/prompts/glean-defaults.ts) — three targeted system prompts + preflight prompt + lenient validator types
- [`src/lib/pipeline/glean-defaults.ts`](../src/lib/pipeline/glean-defaults.ts) — orchestrator running the three passes in parallel via `Promise.allSettled`; mutates arrays in place; returns counters; relationship-type filter on conditions pass to avoid wasting slots on structural/correlational edges
- [`src/app/api/pipeline/decompose/route.ts`](../src/app/api/pipeline/decompose/route.ts) — wired in after the retry-quality block (post-Pass-2, pre-persistence) with soft-fail + telemetry `stage_boundary` event

**Honesty contract:** prompts explicitly allow "no change" / `is_unconditional: true` / `missing_reason` answers. Empty `updates: []` is a valid response. We do not force the LLM to invent — only recover what it already had but omitted.

**Tunables:**
- `MAX_CANDIDATES_PER_GLEAN = 20` per pass (keeps LLM attention focused; larger lists fragment quality)
- Conditions pass filters to relationship-types where IF-clauses are plausible (causes/enables/inhibits/mediates/moderates/constrains/requires/gates/triggers/amplifies/reduces/prevents/resolves)
- Per-pass max ~6 LLM calls (3 preflights + 3 gleans); usually 3-4 in practice (preflight skips one or more)

**Expected lift** (to be measured on real runs):
- `edge.dynamics` non-default rate: ~25% → ~45-55%
- `edge.conditions` fill rate on causal edges: ~20% → ~40-55%
- D1 measurement coverage: catches entities the original D1 prompt missed (backstop for the D1 measurement-coverage gate)

**Effort:** ~1 day. Shipped.

---

### D8 — Hierarchical KG communities + bottom-up summaries — **🟡 IN PROGRESS**

**What:** Adds the operational layering substrate the system has been missing (§3 of this critique). Communities are graph-topology-derived partitions that nest hierarchically: level 0 = root partitions, level 1 = sub-communities of level 0, etc. Each community gets a bottom-up LLM-generated summary mirroring GraphRAG paper §E.2 schema (`{ title, summary, rating 0–10, rating_explanation, findings: [{summary, explanation}] }`).

**Pattern source:** Microsoft GraphRAG paper (Edge et al. 2024) §3.1.4–3.1.5. Their pipeline runs Leiden via Python `graspologic` + bottom-up community summaries. We use a self-contained TypeScript modularity-greedy clusterer (Louvain-class output for our scale, no Python dep, no npm dep), and the same §E.2 summary schema with three domain adaptations: (1) findings emphasize STRATEGIC IMPLICATIONS (leverage points, risks, tradeoffs) since we're a strategy-optimization product not a sensemaking corpus retrieval system; (2) prompts use our typed-edge semantics (polarity, dynamics, conditions); (3) ROLLUP prompt explicitly references CHILD summaries by title, implementing the recursion that gives the substrate its scale advantage (GraphRAG paper documents 9–43× token reduction at root level).

**Status (2026-04-26):** First-pass implementation shipped. Soft-fail throughout — detection failure logs but doesn't break the decompose pipeline; per-community summarize failures persist the row with `summary=null`.

**Files landed:**
- [`supabase/migrations/20260611_kg_communities.sql`](../supabase/migrations/20260611_kg_communities.sql) — new table with self-referential `parent_community_id`, level int 0–4, member `entity_ids[]` + `edge_ids[]`, `summary jsonb`, `detection_run_id`, `modularity_contribution`. GIN indexes on entity/edge id arrays + parent index. RLS policies match other tables (read own space; service-only insert).
- [`src/lib/pipeline/community-detection.ts`](../src/lib/pipeline/community-detection.ts) — pure-function modularity-greedy clusterer. Uses Newman's modularity (2004) ΔQ formula for greedy merges; recurses on each community of size ≥4 up to MAX_LEVEL=4. Returns DetectedCommunity tree. ~300 LOC; no deps beyond TS std.
- [`src/lib/prompts/community-summary.ts`](../src/lib/prompts/community-summary.ts) — two prompts: `COMMUNITY_LEAF_SUMMARY_SYSTEM` (reads entities + edges directly) and `COMMUNITY_ROLLUP_SUMMARY_SYSTEM` (reads child summaries + small grounding sample). Both produce same JSON schema. Lenient `validateCommunitySummary` validator soft-fails to empty struct on shape error.
- [`src/lib/pipeline/community-summarize.ts`](../src/lib/pipeline/community-summarize.ts) — orchestrator. Walks DetectedCommunity tree bottom-up: deepest level summarizes from raw entities/edges (LEAF prompt); higher levels compose from already-completed child summaries (ROLLUP prompt). Within a level, summaries run in parallel via `Promise.allSettled`. Token estimates per row.
- [`src/lib/pipeline/community-tail.ts`](../src/lib/pipeline/community-tail.ts) — top-level orchestrator the decompose route calls. Loads entities/edges, runs detection, runs summarize, persists kg_communities rows shallowest-first (so parent UUIDs exist before children reference them via `parent_community_id`), emits `community_detected` SSE event. Tunables: `MIN_ENTITIES_FOR_DETECTION=8` (skip on tiny graphs), `MAX_SUMMARY_CALLS=30` (cost cap).
- [`src/types/pipeline-events.ts`](../src/types/pipeline-events.ts) — new `CommunityDetectedEvent` in the `StructuralEvent` union: `{ type, spaceId, detection_run_id, total_communities, max_level, level_0_modularity, level_breakdown }`.
- [`src/app/api/pipeline/decompose/route.ts`](../src/app/api/pipeline/decompose/route.ts) — wired in via unconditional `after()` block right before the response return. Runs for both auto-advance chain AND direct user-triggered decomposes. Soft-fail wrapped — any error logs and doesn't break the response.

**Why self-contained clustering vs npm dep:**
- Avoids `graphology-communities-louvain` install + lockfile churn for a one-time pipeline addition
- For our typical scale (15–50 entities), Newman's modularity-greedy yields equivalent partitions at O(n²) — Leiden's marginal advantages don't change the LLM rollup output materially
- Source-level reviewability matters: the algorithm is ~300 LOC of explicit modularity math vs an opaque dep that would need its own `graphology` peer dep
- The summary substrate (§E.2 LLM prompt) is where the value lives; clustering is just partitioning

**What changes for users:**
- Every space with ≥8 entities now produces a hierarchical community partition tree at decompose time
- Each community has an LLM-generated rollup with title + strategic-implications findings + 0-10 rating
- Future synthesize-layered work can read communities as a queryable substrate; today they exist but aren't yet consumed by downstream stages
- SSE event surfaces detection completion to the canvas (UI rendering of community boundaries is D8 follow-up work)

**Cost profile:** detection is synchronous + cheap (no LLM, pure graph algorithm). Summary pass is N LLM calls where N = total communities (typically 5–15 for our scale; capped at 30). Runs entirely in `after()` — never blocks the decompose response.

**Effort:** Originally estimated ~5 days; first-pass code shipped in one session.

**Touches:** `supabase/migrations/`, `src/lib/pipeline/community-detection.ts` (new), `src/lib/pipeline/community-summarize.ts` (new), `src/lib/pipeline/community-tail.ts` (new), `src/lib/prompts/community-summary.ts` (new), `src/types/pipeline-events.ts`, `src/app/api/pipeline/decompose/route.ts`.

**Still to do:**
1. Apply migration to live Supabase
2. UI rendering of community boundaries on the canvas (consume `community_detected` SSE event)
3. Wire `reasoning_settings.depth` to community-level used in synthesize-layered (the cost-tier benefit — quick=root, deep=leaf)
4. `/api/canvas/redetect-communities` manual re-run route for users who want to refresh after KG mutations
5. Tune `MIN_COMMUNITY_SIZE_FOR_SUBSPLIT` + summary cost cap from real-run telemetry once shipped

---

### D7 — Mechanism-grounded synthesis

**What:** Update synthesis prompt to require dual output per leverage point:
```json
{
  "phenomenology": "users drop off after day 7",
  "mechanism": {
    "explanation": "Habit formation incomplete before week-2",
    "literature_grounding": [
      {"author": "Lally", "year": 2009, "claim": "median time-to-habit = 66 days"}
    ],
    "evidence_strength": "medium",
    "falsifiable_prediction": "extending free trial to 14 days reduces day-7 dropoff by 20-30%"
  }
}
```

UI badges: `🔬 Mechanism grounded` vs. `📊 Phenomenological observation`.

**Effort:** ~2 days. **Priority:** Medium. **Touches:** `src/lib/prompts/`, synthesis renderers in `src/components/strategy/`.

---

### Summary table

| ID | Change | Effort | Priority | Touches |
|---|---|---|---|---|
| D1 | Variable-schema layer | 3d | **Highest** | schema, prompts, validators |
| D2 | Close simulation→KG loop | 5d | **Highest** | pipeline, twin, lab routes |
| D3 | Controllability profiles | 3d | High | schema, why-chain, strategizer |
| D4 | Multi-way interaction discovery | 5d | High | pipeline, simulation |
| D5 | Layer-aware decomposition | 5–7d | Medium-high | strategizer, work queue |
| D6 | Calibration from prediction error | 3d | Medium | new calibration module |
| D7 | Mechanism-grounded synthesis | 2d | Medium | prompts, UI |

**D1 + D2 together change what the system fundamentally is.** Everything else is enrichment on top.

---

## 10. Cross-references

- **Per-number tier upgrades** (R1–R6, e.g. variant lift Tier-2→Tier-4, reality calibration Tier-1→Tier-4): see [`COMPUTATIONAL_SUBSTANCE_ROADMAP.md`](COMPUTATIONAL_SUBSTANCE_ROADMAP.md). That doc and this one are complementary — R-series ships honest provenance for individual numbers; D-series ships the structural changes the substrate needs to support optimization.
- **R5 architectural roadmap** (scenarios, snapshot-paired MC, agent-authored tools): see [`R5_STRATEGIC_BRIEF.md`](R5_STRATEGIC_BRIEF.md). D2 (close the loop) shares scope with R5's scenario engine.
- **Rigor intake gate** (declared, not yet enforced): see [`../RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md`](../RIGOR_FIRST_PIPELINE_IMPLEMENTATION_PLAN.md). Connects to D5 layering work.
- **Situational analysis layered architecture**: see [`../SITUATIONAL_ANALYSIS_DEEP_DIVE.md`](../SITUATIONAL_ANALYSIS_DEEP_DIVE.md).

---

## 11. What "good" looks like

When this plan is executed, the system should be able to honestly answer:

1. **For every entity:** "What variable does this represent? In what unit? At what cost to measure?"
2. **For every edge:** "What is the functional form of this relationship? Linear? Threshold? What's the time-to-effect distribution?"
3. **For every claim:** "Is this sufficient cause, contributing cause, or correlate? What test would falsify it?"
4. **For every recommended intervention:** "What does it cost, how long until it matters, how reversible is it, and which user cohorts does it work for?"
5. **For every simulation:** "Did running this discover anything new about the graph? Did the graph update?"

Today, the system can answer none of these honestly. After D1+D2, it can answer #1, #2, and #5. After D3+D4+D7, it can answer #3 and #4. After D5+D6, it can do all of the above *adaptively, per layer, with online learning*.

**At that point — and only at that point — the word "Twin" stops being metaphor and becomes substrate.**
