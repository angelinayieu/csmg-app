# System Data-Flow Map — spec

**Status:** DRAFT (spec-first, pre-code) · **Date:** 2026-05-30 · **Lane:** objective-canvas / systems-map
**Goal:** replace the crowded, *fuzzy* "Map" with ONE precise cross-feature data-flow diagram — and, underneath it, **strengthen the cross-card connection infrastructure so the links are real (derived from data tokens), not heuristic string-matches.**

> The visual is downstream. The point of this spec is the **base infra**: turn the rooms' GUARANTEED declared causal bindings into the *canonical* cross-feature connection layer, persist it, **enrich** it with mechanism data-tokens when present, and make every surface (Map, depends-on, agent spec) read from it.

---

## 0. Revisions — post-audit corrections (READ FIRST)

Two corrections from a follow-up **autopilot-provenance audit** + a **viz-stack research pass**. They supersede the relevant lines in §1–§3.

**(A) Data source — derive from GUARANTEED autopilot output, not the conditional tokens.**
Audit finding: the `produces/consumes` mechanism tokens are written **only** when the canvas-autopilot "technical specs" toggle is on (canvas-autopilot-runner.tsx:515 `if (withSpecs)`, defaults true) — the **per-room** AutopilotRunner (score→refine only) and `room/generate` never write them, and `data_unit_registry` is populated *only* as a side-effect of spec generation. So after many real runs the token graph is **empty/sparse**, and even present, tokens are LLM free-text reconciled by a *fuzzy* registry → matches are probabilistic.
**What every feature reliably has after ANY run** (`room/generate`): `causal_chain.addresses[]` (`{pain, root_cause}`) + `causal_chain.moves[]` (`{outcome, indicator}`), mirrored into `edges` as `addressed_by`/`produces`, plus scored `variations[]` (`effectiveness_score`, `addresses_pain`). Election to the "final structure" is a **manual** step (autopilot proposes + ranks, never auto-elects).
→ **The connection graph's REQUIRED substrate is these declared bindings** (features linked by shared `root_cause`, and by `outcome → pain` matches); mechanism tokens + registry are an **OPTIONAL enrichment** that deepens an edge with a precise data-unit label + operators *when a spec exists*. **Canonicalize** `root_cause`/`indicator`/unit via `concept_slug` (the glossary identity already in the codebase) so matches are precise, not string-fuzzy. §2 is revised accordingly.

**(B) Viz stack — React Flow + ELK (elkjs), not dagre.**
Research verdict: keep `@xyflow/react` (right renderer — custom operator/data-unit nodes, the complexity dial, and hover-trace are all pure React state), but adopt **ELK (`elkjs`) `layered`** for layout: orthogonal/Manhattan edge routing, barycenter crossing-minimization (LAYER_SWEEP), Brandes-Köpf node placement, and **reserved edge-label space** — none of which dagre does (that's the Lucidchart/swimlane look the reference images have). L1→L4 = ELK layers; render lanes as non-interactive **background bands**. Hold `d3-sankey` in reserve for a separate data-**VOLUME** sub-mode only. It's an **additive `elkjs` install**, no rewrite. (React Flow ships an official ELK example.) §3 is revised accordingly.

---

## 1. Why (grounded in the codebase review)

Three findings from a 3-front audit:

1. **The "systems map" wiring is not real edges.** The only persisted relationships are **intra-room** (pain↔feature↔outcome, every `edges` row hard-scoped to one `parent_sub_objective_id`). The cross-feature/cross-layer connections are all **computed at render**:
   - L1→L4 ENABLES/PRODUCES = `ObjectiveStack.influences` (visual JSONB).
   - "BRIDGES L3" = a text label (`improvement_goals.layer_position_label`).
   - Cross-room links = `cross-room-signals.ts` doing **verbatim string-matches** of shared mechanism names / root-causes / annotation phrases.
   → You can't make string-match associations "10,000× clearer" by restyling. **The imprecision is in the connection model, not the pixels.**

2. **A precise substrate already exists and is unused.** Every feature's `MechanismSpec.runtime_flow[]` (in `entities.expanded_detail.mechanism_spec`) carries `produces[]` / `consumes[]` **data tokens** (snake_case slugs), drawn from a **space-wide registry** (`synthesis_data.data_unit_registry`, `data-unit-registry.ts`) that the generator actively converges (feeds known slugs to the LLM + auto-registers new ones). So the *same* slug (`attention_score`) appears across many features' specs. **"feature A emits `attention_score` → feature B consumes `attention_score`" is a real, precise, cross-feature dependency already in stored data — never joined into a graph.**

3. **The existing "depends_on" is fuzzier than the tokens.** `derive-depends-on.ts` reads the LLM-asserted `AgentBuildSpec.data_flow.cross_feature` — a separate, softer LLM list — NOT the tokens. So even our one cross-feature artifact ignores the precise source.

**The Map tab today:** `CausalMap → CanvasAltitudeMap` (React Flow), nodes = *sub-objectives* (whole rooms), edges = cross-room associations capped at 14, hand-banded by layer ordinal; `MapInsightsPanel` overlays it. Crowded because room→room association edges trend bipartite-complete between bands.

---

## 2. The base-infra change (the real work)

Make the **data-token graph the single canonical cross-feature connection layer.**

### 2a. Canonical connection model
For every feature entity that has a `mechanism_spec`:
- collect `runtime_flow[].produces[]` (slugs it emits) and `consumes[]` (slugs it needs),
- resolve each through the registry (`validateTokens` / `fuzzyMatchUnit`) to a canonical slug.

Then join across features on shared slugs:
- **producer(slug) → consumer(slug)** ⇒ a real edge `featureA --slug--> featureB`.

This is precise (exact slug join), cross-feature, and needs **no new LLM call**.

### 2b. The builder — `src/lib/objective-canvas/build-system-dataflow.ts` (pure, tldraw-free)
```ts
export interface DataUnitRef { slug: string; name: string; kind: DataUnitKind; layerOrdinal: number | null; }
export interface SystemFeatureNode { entityId: string; label: string; roomId: string | null; layerOrdinal: number | null;
  produces: string[]; consumes: string[];
  /** runtime step components = the processing operators (L3 detail). */
  operators: { step: string; component: string; consumes: string[]; produces: string[] }[]; }
export interface SystemDataflowEdge { fromEntityId: string; toEntityId: string; dataUnitSlug: string; }
export interface SystemDataflow {
  built_at: string;
  features: SystemFeatureNode[];
  dataUnits: DataUnitRef[];
  edges: SystemDataflowEdge[];        // feature → feature, carrying the data unit
  unmatched: string[];                // tokens with no registry entry (surface for cleanup)
}
export function buildSystemDataflow(
  entities: Array<{ id: string; name: string; layer_ontology_id: string|null; parent_sub_objective_id: string|null; expanded_detail: unknown }>,
  registry: SpaceDataUnitRegistry,
  layerBySlugOrOntologyId: ...,        // map entity → layer ordinal
): SystemDataflow
```
- Mirrors `build-data-lineage-props.ts` (pure, server-callable from the page or a route).
- Reads ONLY persisted data: `entities.expanded_detail.mechanism_spec` + `synthesis_data.data_unit_registry`. No migration, no LLM.

### 2c. Persistence — make the connections first-class
1. **Canonical rollup (primary, no migration):** cache the built graph at `synthesis_data.system_dataflow` (rebuilt when any `mechanism_spec` is (re)generated — hook into `item/[entityId]/mechanism-spec/route.ts` after it saves a spec + auto-registers tokens). Fast read; one source of truth.
2. **Typed links for elected features (ties into object-flow):** for features that are `library_objects`, write each `featureA --slug--> featureB` as an **`object_links`** row with `relation: "feeds"` (and the inverse `depends_on`). `object_links` already exists (object-flow Phase 0) and already supports `feeds`/`depends_on` — so cross-feature data dependencies become **real, typed, queryable links between addressable objects** that flow into the final spec. This is the literal "strengthen the connections across cards base infra."

### 2d. Unify the consumers (kill the fuzzy paths)
- `derive-depends-on.ts` → source `depends_on` from the token graph (precise) instead of the LLM `cross_feature` list. (Keep the LLM list only as a fallback when a feature has no spec yet.)
- `compile-agent-build-spec.ts` `data_flow.cross_feature` → emit from the token graph (precise) rather than a separate LLM pass.
- The Map view → render the token graph (below). `cross-room-signals.ts` string-match stays only for *thematic* overlap, no longer for data dependencies.

### 2e. Honest dependency / bootstrap
The graph is only as complete as mechanism-spec coverage (tokens exist only after a feature is "made technical" via `enrichMechanismSpec`). Mitigation:
- features without a spec render as **dim, unconnected nodes** with a one-click "Generate to connect" (runs `make_technical`/mechanism-spec for that feature),
- a board-level **"Compute system map"** action batch-generates specs for all elected features, then builds the graph.
This is also the home for the earlier **"Auto-assemble + extend across depths"** idea: classify bullets → features → generate specs → the data-flow graph emerges.

---

## 3. The visualization — `SystemDataflowView` (replaces Map; folds in Data-flow)

React Flow (already a dep) + the existing layered-band layout, restyled to the swimlane reference.

- **Swimlanes = the 4 layers (L1→L4)** — the structure you already have (ordinal banding).
- **Nodes = features** — minimal: name + a tiny data-kind glyph. **No descriptions** (the layer header carries context).
- **Edges = real data dependencies**, each labeled with its data unit (`attention_score`), directional, orthogonal-routed, crossing-minimized, parallel edges bundled.
- **Complexity dial** (realizes the "simple → complex" sidebar idea):
  - **L1 Simple:** features + arrows (who feeds whom).
  - **L2:** arrows labeled with the data unit; optional data-unit chips.
  - **L3 Complex:** **processing operators** as nodes (promote `runtime_flow[].component`) between consume→produce — your "one level more complex for the operators."
- **Layout principles** (data-flow viz practice): rank by layer (Sugiyama), minimize crossings, orthogonal routing + edge bundling, minimal node text, progressive disclosure. Sankey variant when showing data *volume*.
- Mount in `main-canvas-view.tsx` as the **Map** tab; retire the separate hand-built `DataLineageView` (its layer-lineage becomes the L1 view of this).

---

## 4. Phases

- **P0 — Builder + canonical rollup (base infra).** `build-system-dataflow.ts` + persist `synthesis_data.system_dataflow` + rebuild hook in the mechanism-spec route. No UI. *This is the connection-strengthening core.*
- **P1 — Unify consumers.** Point `derive-depends-on` + the agent-spec `cross_feature` at the token graph; write `object_links` (`feeds`) for elected features.
- **P2 — `SystemDataflowView`** (L1+L2): swimlane feature graph with data-unit edges; replace the Map tab.
- **P3 — Operators (L3) + complexity dial + "Generate to connect" / "Compute system map".**

---

## 5. Coordination + open decisions
- **Shared/hot files:** `main-canvas-view.tsx` (tab wiring), `item/[entityId]/mechanism-spec/route.ts` (rebuild hook), `compile-agent-build-spec.ts` (parallel-owned — coordinate the `cross_feature` source swap). Partial-stage discipline.
- **object_links scope:** only elected/library features get links (others live in the rollup only). Decide if non-elected features should be auto-promoted to `library_objects` when they gain a spec.
- **Registry quality gate:** `unmatched` tokens (no registry entry) surface a cleanup list so the slug vocabulary stays tight (precise joins depend on it).
- **Rebuild trigger:** on-spec-gen (incremental) vs on-canvas-load (lazy). Lean: incremental write + lazy rebuild if `built_at` is stale.

## 6. Acceptance ("are the connections real?")
- Every Map edge traces to a concrete `(producer feature, data-unit slug, consumer feature)` triple — clickable to the slug + the two specs. **No string-match edges.**
- `depends_on` (drawer, agent spec) and the Map render the **same** graph (one source).
- A feature with no spec is visibly unconnected with a "Generate to connect" affordance (honest about coverage).
- Removing/zooming the complexity dial never changes the underlying edges — only how much is shown.
