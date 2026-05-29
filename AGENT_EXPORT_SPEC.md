# P1.2-B — Agent-Ready Build-Spec Export (grounded build spec)

> CROSS_AUDIT P1.2, Option B: compile the canvas into ONE coherent "build this
> app" spec a coding agent can scaffold from, surfaced on the Strategy Brief.
> Every path below was read on 2026-05-29. Companion to `CROSS_AUDIT_AND_BUILD_SEQUENCE.md`.

## Grounded reality (what exists — don't rebuild)

- **Per-variation export** `generate-export-prompt.ts` — structured md, MechanismSpec-grounded,
  with a round-trip optimizer (generate→test→judge→revise). Sophisticated; keep.
- **Space aggregate bundle** `GET …/space/[spaceId]/deliverables/export/route.ts` —
  concatenates every elected-ready variation's doc+mockup+prompt into one `.md` download,
  grouped by room. A *pile of per-variation artifacts*, not a unified spec.
- **Brief aggregation** `brief/page.tsx` → `loadCrossRoomState` → `buildStrategyBrief`
  (pure, no-LLM) → `StrategyBrief` (rooms, elected_variations w/ full payload, composed_designs,
  experiments, themes). Rendered by `strategy-brief-view.tsx` (copy/print) + a cached AI
  **polish** (`/api/brainstorm/space/brief/polish`, cached on `synthesis_data.strategy_brief_polish`
  with `state_hash` invalidation).
- **MechanismSpec** `enrich-mechanism-spec.ts` — rich (mechanism_of_action, runtime_flow,
  system_components, decision_record, kill_criteria…) but **no `acceptance_criteria` / `scope_boundaries`** (confirmed absent).

**The real gap** = there is no single coherent product spec (one feature set + shared data model
+ acceptance criteria + scope boundaries + build sequence). The Brief is a *memo*; the bundle is
a *pile*. B turns them into a *build spec*. All target files are **clean / not hot**.

## Architecture (reuse-first)

```
brief/page.tsx  ──loadCrossRoomState──►  StrategyBrief  (exists)
                                              │
   + synthesis_data.define (P1.1)            │  + elected features' MechanismSpec
   + operational_constraints                 ▼    (entities.expanded_detail.mechanism_spec)
                                   [NEW] compileAgentBuildSpec()  ── one LLM synth call
                                              │
                                              ▼
                                       AgentBuildSpec  (new schema, cached)
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                    ▼                    ▼
               Brief panel (view)      copy md         GET …/agent-spec (download .md)
```
Mirror the **polish** pattern exactly: POST compiles + caches on `synthesis_data.agent_build_spec`
keyed by `state_hash` (from `loadCrossRoomState`); stale when the hash drifts.

## Structure — grounded in how real specs are built (research, 2026-05-29)

The schema follows the consolidated outline real teams converge on, so an agent reads
macro→flow→micro→design and builds without drift:

- **What/why before how** — problem · goals · success-metrics · **Non-Goals** *before* any
  architecture (Amazon PR-FAQ, Lenny PRD, Shape Up appetite/no-gos; GitHub **Spec Kit**
  spec↔plan split so the architecture half regenerates when the stack changes).
- **Macro + micro at multiple zoom levels** — **C4** (Context→Container→Component) so ONE
  artifact serves macro architecture AND per-component detail. This is the direct answer to
  "macro and micro systems."
- **Data flow as ordered, labeled arrows** — **DFD / C4-Dynamic** (`from → to {data}`), the layer
  most specs skip. We hold it as edges already.
- **Conceptual Model layer** — objects/relationships/terminology/IA sitting *between* data model
  and UI (Seven Layers' most-skipped layer; doubles as the agent's shared vocabulary).
- **Three anti-drift controls** — Non-Goals, `[NEEDS CLARIFICATION]` markers, and an
  **ADR-style Decision Log** (context + consequences + alternatives) — we already hold these in
  `MechanismSpec.decision_record` + `kill_criteria`.
- **Design is first-class** — component inventory + user flows + design tokens + Seven-Layers
  surface/interaction (the user's product-design image).

Sources: PR-FAQ / Lenny PRD / Shape Up · Google design doc · C4 model + DFD · GitHub Spec Kit ·
ADR (Nygard) · Seven Layers of Product Design (Jamie Mill) · W3C design tokens.

## The schema — `AgentBuildSpec` (multi-zoom: macro → flow → micro → design)

```ts
interface AgentBuildSpec {
  // ── WHAT/WHY (regenerates independent of the stack) ──
  product_summary: string;            // PR-FAQ-style: what we're building + for whom
  problem: string;                    // ← define block (P1.1)
  target_users: string;
  goals: string[];
  success_metrics: string[];          // ← define (outcome/target/horizon) + room outcomes
  non_goals: string[];                // anti-drift ← define constraints + aggregated feature scope
  tech_constraints: string[];         // ← operational_constraints

  // ── MACRO SYSTEM (zoom L1 — the layered architecture; CONSUMES the macro-rollup) ──
  macro_architecture: {
    distilled_objective: string;      // ← macro-rollup distilled sentence
    layers: Array<{                   // ← macro-rollup MacroSummaryLayer (L1..Ln)
      id: string; name: string; archetype: string; role: string;
      subsystems: string[];           // sub-objectives/features at this layer
      macro_problems: string[];       // ← `macro_problems` rollup analysis
    }>;
  };

  // ── CONCEPTUAL MODEL (the bridge — Seven Layers' most-skipped layer) ──
  conceptual_model: {
    objects: Array<{ name: string; description: string }>;        // ← KG entities + glossary
    relationships: string[];          // ← edges
    terminology: Array<{ term: string; definition: string }>;     // ← glossary (concept_slug)
  };

  // ── DATA MODEL (concrete) ──
  data_model: Array<{ entity: string; fields: string[]; used_by: string[] }>;

  // ── DATA FLOW (ordered labeled arrows — DFD / C4-Dynamic; MACRO + MICRO) ──
  data_flow: {
    cross_feature: Array<{ from: string; to: string; data: string;
      direction: "upstream" | "downstream" }>;   // ← edges + macro-rollup cross-level chain
    per_feature: Array<{ feature: string;
      steps: Array<{ step: string; component: string; data: string }> }>; // ← MechanismSpec.runtime_flow
  };

  // ── MICRO (per-feature/component detail; from MechanismSpec) ──
  features: Array<{
    name: string; layer: string; purpose: string;
    mechanism: string;                // ← mechanism_of_action / how_it_works
    components: string[];             // ← system_components
    inputs: string[];                 // ← input_data
    acceptance_criteria: string[];    // NEW MechanismSpec field
    scope_boundaries: string[];       // NEW MechanismSpec field
    depends_on: string[];             // ← layer ordinals / composes_with
  }>;

  // ── DESIGN (UI/UX — Seven Layers surface/interaction) ──
  design: {
    user_flows: string[];             // interaction structure
    component_inventory: string[];    // UI elements ← mockup_html + features
    design_notes: string;             // surface/visual intent (tokens = v2)
  };

  // ── DECISION LOG (ADR — context + consequences + alternatives) ──
  decisions: Array<{ choice: string; context: string; alternatives_rejected: string[] }>; // ← decision_record

  // ── BUILD SEQUENCE (dependency-ordered: data → services → endpoints → UI) ──
  build_sequence: Array<{ phase: string; builds: string[]; rationale: string }>;

  open_questions: string[];           // [NEEDS CLARIFICATION] — incl. features missing a MechanismSpec
  generated_at: string;
  state_hash: string;
}
```

## Macro ↔ micro + data flow — answering the gap

- **Micro data flow already lives in mechanisms** — `MechanismSpec.runtime_flow` is
  `step → component → {data}`, plus `input_data` + `system_components`. So per-feature flow is
  real today → feeds `data_flow.per_feature` directly.
- **Macro / cross-feature data flow does NOT exist yet** — it's the macro-rollup's **Step 6**
  cross-level chain (macro-problem → micro-mechanism → macro-outcome) and depends on **Step 5
  concept identity** (`concept_slug`) to be reliable (else fragile string-match). So
  `data_flow.cross_feature` is **thin in v1** (derived from existing edges) and **auto-enriches**
  as the rollup + identity land. This is the same data seam the cross-audit flags.
- **This export CONSUMES the macro-rollup, doesn't duplicate it.** `macro_architecture` =
  the rollup's distilled objective + layered macro sub-objectives + `macro_problems`. They're
  complementary: the rollup makes the macro model *visible on the board*; this compiles it (+ micro
  + flow + design) into the *build spec*. Shared deps: rollup Steps 2/5/6.

**v1 vs full:** v1 ships every section using what exists (define, MechanismSpec incl.
`decision_record`, edges, mockups, the layer stack); the `macro_architecture.macro_problems` +
`data_flow.cross_feature` sections sharpen automatically as rollup Steps 2/5/6 land — no rework.

## Work items (sequenced)

1. **MechanismSpec: add `acceptance_criteria` + `scope_boundaries`** — mirror `kill_criteria`
   in `enrich-mechanism-spec.ts`: interface (~L228), `SPEC_SCHEMA` properties (~L684) + `required`
   (~L735), prompt instruction (~L378), assembly (`strArr`, ~L866/903). *Type + generation only; back-compat (older specs lack them → compiler treats as empty).* No migration (lives in `expanded_detail` JSONB).
2. **`compile-agent-build-spec.ts` (new lib)** — gathers, per the schema's "← from" tags:
   `StrategyBrief` + per-feature `MechanismSpec` (incl. `runtime_flow`, `decision_record`,
   `system_components`) + `synthesis_data.define` (P1.1) + `operational_constraints` +
   **the macro-rollup outputs** (`objective_canvas.layers` + `macro_problems` findings) + glossary +
   per-variation `mockup_html`. Then one `llmJSON` synth call fills the connective tissue
   (conceptual_model bridge, data_model, build_sequence). Reuse `llm.ts`. **Degrades gracefully**:
   sections whose source data is absent (no MechanismSpec, rollup not yet run) emit
   `[NEEDS CLARIFICATION]` rather than blocking.
3. **Route `POST/GET /api/brainstorm/space/[spaceId]/agent-spec`** — POST compiles + caches on
   `synthesis_data.agent_build_spec` (state_hash); GET returns cached or 404. A second GET variant
   (or `?format=md`) returns a downloadable `.md` (mirror `deliverables/export` headers + a new
   `renderAgentBuildSpecMarkdown`).
4. **UI on `strategy-brief-view.tsx`** — an "Agent build spec" action beside Copy/Print/Polish:
   button → compile (spinner) → render the spec inline (or a panel) with **Copy** + **Download .md**
   + a stale hint (reuse the `polishStale` pattern). Print-friendly.
5. **`renderAgentBuildSpecMarkdown(spec)`** — deterministic md (mirror `renderStrategyBriefMarkdown`).

## Operations

- **One LLM synth call** per compile (gpt-4o or claude per `llm.ts`); cached by `state_hash` so
  re-opens are free until the canvas changes. Optional v2: reuse the per-variation round-trip
  optimizer to QA the spec (adds ~3 calls) — **defer** to keep v1 cheap.
- **Soft-fail**: compile failure returns a clear error; the Brief still renders.
- **Event bus / notebook**: logging the export would need a new `sub_objective_decisions` action
  (= a full-superset CHECK migration, the clobber-trap) — **decision below**; default v1 = no
  notebook row (it's a read-out, not a generative artifact).
- **Inputs degrade gracefully**: features with no MechanismSpec yet → compiler uses the variation
  description + flags "spec not generated" in open_questions (doesn't block).

## Open decisions (yours)

1. **Notebook logging?** Skip for v1 (no migration) vs add `agent_spec_generated` action (migration).
   *Reco: skip v1.*
2. **Round-trip QA on the spec?** v1 single-shot vs reuse the optimizer. *Reco: single-shot v1.*
3. **data_model / build_sequence: LLM-synthesized** (only option today) — fine, but it's the seam
   the rollup agent + the rigor data-seam will later make structured. *Reco: LLM v1, revisit post-rollup.*

## Collision-safety

Targets — `enrich-mechanism-spec.ts`, `strategy-brief-view.tsx`, `build-strategy-brief.ts`,
`brief/page.tsx`, + new files — all verified **not hot**. No notebook / main-canvas / analyses /
decision-log / sweep-runner edits. No migration (v1). Re-grep before editing (tree is live).
