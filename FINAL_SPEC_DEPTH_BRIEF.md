# Chat D — Final Spec + Mechanism Depth (implementation brief)

> Hand this to a dedicated chat. Verified by code trace 2026-05-29 — the framing in the
> partition was slightly stale; the agents found 1 & 2's helpers already built. Real work =
> hardening + the join + generation depth.

## Coordination (read first)
`compile-agent-build-spec.ts` + `enrich-mechanism-spec.ts` are **parallel-HOT** (flagged do-not-touch in `SYSTEMS_WIRING_MASTER_PLAN.md`; both dirty). Land changes via the **route layer** (`agent-spec/route.ts`, `mechanism-spec/route.ts`) + the **already-created helpers** (`derive-depends-on.ts`, `spec-objects-from-library.ts`) which are NOT parallel-owned. Re-grep mtime+diff before touching the two hot libs.

## Goal 1 — `depends_on` (ALREADY WIRED; verify + harden)
`applyDependsOn(features, cross_feature_edges)` is already called at `compile-agent-build-spec.ts:580-595`; `derive-depends-on.ts:57-107` walks from→to ("to depends on from"). The `depends_on: []` at `:210/:248` are placeholders populated at emission.
- **Harden:** `deriveDependsOn` matches edges by **exact `feature.name` string** (`:72`) — the LLM's `cross_feature.from/to` are free-text and may not match byte-for-byte. Add trim/case-insensitive normalization, OR feed the exact feature-name list into the synthesis prompt (`:420-425`) with "use these verbatim."
- **Backfill:** call `topologicalBuildOrder` (`:117`) to fill `build_sequence` when the LLM's is empty (`:602-611`). Add a cycle-case unit test.

## Goal 2 — Read the Library selection (`included_in_spec`)
The read helper EXISTS: `spec-objects-from-library.ts` → `getSpecObjects(db, spaceId)` returns `library_objects WHERE included_in_spec` (stable id, sourceEntityId, sourceRef=variation id, blueprintLayerOrdinal); soft-fails to `[]` pre-migration.
- **The real work is the JOIN, in `agent-spec/route.ts gatherAndCompile` (:48-144) — NOT the compiler internals.** Today's selection source is `brief.rooms[].elected_variations` (`build-strategy-brief.ts:245-263`), consumed at `compile-agent-build-spec.ts:191`.
- **Plan:** after building `brief`, call `getSpecObjects`. If rows exist (migration applied + curated), build the selection from `library_objects` (map sourceEntityId→entity, sourceRef→variation), reconcile against `brief` to keep `tradeoff`/`variation` payloads, and carry `blueprintLayerOrdinal` → finally fills the empty `layer` field (`:189-190`). **If empty, fall back to today's path** (the fallback is load-bearing — most spaces have 0 rows). Minimal-touch: add optional `specObjects?` to `CompileAgentBuildSpecInput` (`:131`) and intersect in `assembleFeatures` (`:191`).
- **Risks:** lazy population → fallback essential; null source_ref vs variation-id mismatch silently drops features (log a reconciliation count); filter `object_type` to what the compiler expects.

## Goal 3 — Deepen mechanism nodes (two independent sub-parts)
**3a — Design the algorithm, not just name it** (spec already written: `MECHANISM_ALGORITHM_DEPTH_SPEC.md`). Add an `AlgorithmDesign` field (inputs · computation[] · core_function · parameters · thresholds · data_structures · complexity · failure_modes) to the CHOSEN method. Wire through: TS `MechanismSpec`, `SPEC_SCHEMA` (strict — add to properties + required → forces spec regeneration), `parseSpec`, the `SYSTEM_PROMPT` (ground every input in `runtime_flow.produces[]`), then surface in `compile-agent-build-spec.ts` `AgentBuildFeature` + markdown. **Biggest hot-lib surface — coordinate as a hand-off; do last.**

**3b — Ground `research_basis` in real evidence** (route-level — `enrichMechanismSpec` is a pure no-DB lib). In `mechanism-spec/route.ts` (~after :297) read `evidence_registries` for the feature's outcome entities (evidence attaches to OUTCOME entities via `auto-attach.ts` — use the `evidence-bundles.ts:67-72` read pattern, filter status in `extracted|reviewed`). Map → `{basis, effect_size, ci, study_design, quote}[]`, add `evidence?` to `EnrichMechanismSpecInput`, inject as a grounding block, instruct: "set evidence_strength/basis FROM these rows; mark speculative + say so when none." Degrades to today's honest self-assessment when no evidence. (NOTE: `bridge-to-evidence-registries.ts` is a WRITE path — not this.)

## Order
1. Goal 1 verify/harden (lowest risk). → 2. Goal 3b (route-only). → 3. Goal 2 (route join + fallback, gate on migration). → 4. Goal 3a (`AlgorithmDesign`, coordinated hot-lib hand-off).

Key files: `agent-spec/route.ts:48-144` · `compile-agent-build-spec.ts:131,167,191,201-212,580-595` · `derive-depends-on.ts:57-107` · `spec-objects-from-library.ts` · `mechanism-spec/route.ts:297-334` · `enrich-mechanism-spec.ts:218-230,332-403` · `evidence-bundles.ts:67-72` · `MECHANISM_ALGORITHM_DEPTH_SPEC.md`.
