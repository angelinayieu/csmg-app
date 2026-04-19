# Intelligence Radar v2 — Implementation Spec

## Objective
Upgrade Intelligence Radar from topic surfacing to decision-grade intelligence while staying backward-compatible.

## Current Constraints (from code)
- Bridge counting uses `knowledge_layer === "bridge"` semantics in radar computations.
- Discovered edges from intelligence feedback are materialized with `knowledge_layer: "internal"`.
- Decision labels are template-based and can remain abstract.
- UI label copy mixes entities/signals language in at least one header/subtitle.

## Target Outcomes
1. Correct relationship visibility (bridge-like edges included).
2. Topic → concrete decision fork conversion.
3. Provenance/confidence visible at decision and entity level.
4. Meta-intelligence surfaced (core tension, unknowns, contradictions).
5. Structural depth surfaced (triads, archetypes, temporal weighting).

---

## Architecture Changes

### A) Data model (compatible extension)
No immediate table migration required.

Add v2 fields in JSON provenance/payloads:
- Edge provenance extension:
  - `edge_role`, `discovery_source`, `evidence_level`, `phase_weight`, `confidence_explainer`, `source_refs`
- Radar payload extension:
  - `priority_decisions_v2[]`
  - `core_tension`
  - `unknowns[]`
  - `contradictions[]`
  - `triads[]`
  - `archetype_matches[]`

Reference types: [src/types/intelligence-v2.ts](src/types/intelligence-v2.ts)

### B) Bridge-like semantics
Create helper used across radar hook and UI:

`isBridgeLikeEdge(edge): boolean`
- true if `knowledge_layer === "bridge"`
- OR `provenance.edge_role in {"bridge","discovered"}`

Apply to:
- summary metrics
- ring assignment
- suggested bridge suppression

### C) Decision specificity pass
Pipeline stage after signal prioritization:
- Input: signal clusters + connection analysis + strategy links
- Output: `priority_decisions_v2`
- Enforce schema:
  - explicit question
  - 2-4 options
  - tradeoffs
  - recommended option
  - concrete next step + due window
  - confidence + evidence refs

### D) Meta-intelligence surfaces
Compute/store/display:
- `core_tension`
- `unknowns`
- `contradictions`

### E) Structural intelligence
Add detector stage:
- triad detector (mediator/moderator/common cause)
- archetype matcher (flywheel/bottleneck/cold-start/principal-agent/network effects)
- temporal weighting for now/next/later prioritization

---

## API/Hook/UI Plan

### API
- Extend intelligence feedback writes with provenance v2 edge fields.
- Add/extend compute endpoint to emit radar v2 payload sections.

### Hook
- Parse v2 payload with fallback to v1.
- Prefer `priority_decisions_v2` if available.
- Use bridge-like helper for all bridge-sensitive logic.

### UI
- Decision cards:
  - show question/options/recommendation/next action
  - show confidence + evidence chips
- Coverage panel:
  - tooltip with denominator/formula
- Header/subtitle text:
  - normalize language (`entities`, `signals`, `links`)
- Add tabs/panels:
  - core tension
  - unknowns
  - contradictions
  - triads/archetypes

---

## Rollout Strategy
Use flags and ship in four slices:
1. `intel_v2_bridge_roles`
2. `intel_v2_decision_cards`
3. `intel_v2_meta_panel`
4. `intel_v2_structural_depth`

Detailed checklist: [INTELLIGENCE_RADAR_V2_EXECUTION_CHECKLIST.md](INTELLIGENCE_RADAR_V2_EXECUTION_CHECKLIST.md)

---

## Acceptance Criteria
1. Bridge-like count reflects discovered edges.
2. >=90% rendered decisions include options + next action.
3. Every decision has confidence + evidence visible.
4. No entity/signal metric label ambiguity.
5. Non-trivial spaces surface at least one structural finding (contradiction, triad, or archetype).
