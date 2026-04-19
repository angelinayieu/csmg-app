# Intelligence Radar v2 — Execution Checklist

Status legend: `[ ]` not started, `[-]` in progress, `[x]` complete

## Phase 0 — Instrumentation + Backward-Compatible Data Contract

### 0.1 Edge provenance normalization (no behavior change)
- [ ] Add `edge_role`, `discovery_source`, `evidence_level`, `phase_weight`, `confidence_explainer`, `source_refs` into edge provenance writes.
- [ ] Update intelligence feedback edge materialization to include `provenance.edge_role = "discovered"`.
- [ ] Keep existing `knowledge_layer` values untouched for compatibility.

### 0.2 Telemetry baselines
- [ ] Log `bridge_like_count` (bridge + discovered) and `bridge_count` side-by-side.
- [ ] Log `% decisions with fallback rationale`.
- [ ] Log `% decisions with evidence refs`.

### Exit criteria
- [ ] No API contract break.
- [ ] Existing radar renders unchanged.

---

## Phase 1 — Reliability + Metric Semantics

### 1.1 Bridge-like edge interpretation
- [ ] Introduce helper `isBridgeLikeEdge(edge)` in radar hook.
- [ ] Use helper in:
  - ring assignment
  - bridge metrics
  - suggested bridge suppression logic

### 1.2 Metric/copy consistency
- [ ] Rename title/subtitle wording so `entities` and `signals` are never conflated.
- [ ] Add tooltip: coverage denominator and weighted formula.

### Exit criteria
- [ ] When discovered edges exist, bridge-like metric is non-zero.
- [ ] No visible metric mismatch in compact/fullscreen headers.

---

## Phase 2 — Decision Specificity Pass (Topic → Fork)

### 2.1 Decision schema adoption
- [ ] Add `priority_decisions_v2` payload in synthesis/radar data.
- [ ] Keep old `priorityDecisions` as fallback.

### 2.2 Decision generation pass
- [ ] Convert each candidate into:
  - decision question
  - 2-4 options
  - explicit tradeoff
  - recommended option
  - concrete next step
  - due window
- [ ] Reject abstract topic outputs that fail minimum schema.

### 2.3 UI card migration
- [ ] Render v2 cards first, fallback to v1 cards if absent.
- [ ] Add evidence and confidence chips on each decision card.

### Exit criteria
- [ ] >= 90% displayed decisions include options + next step.
- [ ] Fallback text incidence < 10%.

---

## Phase 3 — Meta-Intelligence Surfaces

### 3.1 Core tension + unknowns + contradictions
- [ ] Add top-level panel/tabs for:
  - Core Tension
  - Unknowns
  - Contradictions
- [ ] Add user actions: mark resolved / escalate / convert to investigation.

### 3.2 Provenance visibility
- [ ] Show evidence source refs and evidence level on details view.
- [ ] Add confidence explainer tooltip.

### Exit criteria
- [ ] Every surfaced decision has provenance metadata visible in <= 2 interactions.

---

## Phase 4 — Structural Depth (Triads + Archetypes + Time)

### 4.1 Triad detector
- [ ] Add triad extraction pass (mediator/moderator/common-cause pattern labels).
- [ ] Persist triads under `intelligence_radar.triads`.

### 4.2 Archetype matcher
- [ ] Add canonical archetypes: flywheel, bottleneck, cold-start, principal-agent, network effects.
- [ ] Store fit score, evidence, counter-evidence.

### 4.3 Temporal weighting
- [ ] Add `phase_weight`-aware ranking for now/next/later.
- [ ] Add phase filter in radar view.

### Exit criteria
- [ ] At least one structural finding (triad/archetype/contradiction) appears for non-trivial spaces.

---

## Cross-Cutting QA

### Type safety
- [ ] Add TypeScript interfaces for v2 schema.
- [ ] Add strict parsing guards for unknown provenance payloads.

### Functional tests
- [ ] Unit: `isBridgeLikeEdge` and decision specificity validator.
- [ ] Unit: triad/archetype detector sanity fixtures.
- [ ] Integration: full pipeline run produces v2 payload and renders cards.

### Regression checks
- [ ] Compact module renders with empty data.
- [ ] Fullscreen module renders with old/v1-only payload.
- [ ] Existing action flows (Investigate/Escalate/Create Goal) still work.

---

## Suggested Rollout Flags
- [ ] `intel_v2_bridge_roles`
- [ ] `intel_v2_decision_cards`
- [ ] `intel_v2_meta_panel`
- [ ] `intel_v2_structural_depth`

---

## KPI Targets (post-launch)
- [ ] Decision-to-action conversion up vs baseline.
- [ ] Time-to-first-actionable-decision down vs baseline.
- [ ] Bridge-like edge utilization up vs baseline.
- [ ] Fallback rationale rate < 10%.
