# R5 — Agent-Authored Tools & Digital-Twin R&D Loop

**Strategic architecture brief.** Synthesizes three parallel audits (internal app/tool inventory, digital-twin flow, external state-of-the-art research) into a concrete plan you can execute against.

The two things this doc has to answer:

1. **"What tools are we actually building per stage, and what's the gap between claim and reality?"**
2. **"Where does the 'replicate → diagnose → test → propose → test-after delta' loop fit — and what's missing for it to actually run end-to-end?"**

---

## 1. Current state — honest inventory

### 1.1 Apps / tools the system generates today

**The entire "agent-authored tool" surface is one function: `apply_agent_patch(manifest: AppManifest)`.** It can re-arrange, reconfigure, and rebind widgets that are already registered at module load. It cannot:
- Add new widget types (`registerWidget` is bootstrap-only)
- Add new action kinds (`ActionKind` is a closed TS union; the `custom:${string}` escape hatch has **zero** registered handlers)
- Add new data sources (the resolver has a fixed switch on ~30 `DataSourceKind` values)
- Write any executable code

**Widget tally (31 files, 25 registered types):**
- 19 **observation** widgets (metric cards, callouts, banners, timelines, carousels, heatmaps)
- 2 **interaction** widgets (prediction_panel, validation_lab)
- 1 **simulation** widget (simulation_lab — runs MC, but doesn't persist prior runs)
- 3 **action** widgets (intervention cards, deviation feed)
- 3 **meta** widgets (text, divider, unknown)
- **0** widgets in the `ml`, `game`, or `integration` categories despite those categories existing in the enum

**Action tally (24 kinds declared, ~17 registered):**
- Registered: log_observation, complete_intervention, apply_agent_patch, reconcile_app, log_prediction, start_experiment, end_experiment, escalate_to_research, run_simulation, resolve_predictions, …
- **Declared but dead:** `save_scenario`, `promote_scenario_to_strategy`, `activate_variant`, `focus_variant`, and the entire `custom:${string}` namespace
- Simulation runs overwrite prior scenarios (`last_simulation` is a single slot) — no history, no compare-runs

**Stage-by-stage tool generation (46 pipeline endpoints, 3 materialize user-facing tools):**

| Stage | What it produces | LLM-steerable surface |
|---|---|---|
| intake, frame-extraction, rigor-intake | metadata only | none |
| decompose, research, synthesize | data only (entities, edges, leverage, risks, ranked strategies) | no widget |
| strategy-refresh | infrastructure proposals + micro-tactics + (now) MC distributions | indirect — feeds next |
| **generate-apps** | Apps + Interventions + default AppManifest per app | Layout is **deterministic** from proposal type; widget set is **hardcoded per layout**; the only LLM-decided surface is mechanism-hint injection, which can only append already-registered widgets |
| writer-path | Variants, slots, latent dimensions (bound to by existing widgets) | LLM picks content inside deterministic schema |
| post-confirm | app_strategies (sub-strategy specs that prefill lab widgets) | LLM fills forms, doesn't author new UI |

**Brutal quality check:** users see apps that are mostly observation surfaces with no write-back. `variant_carousel` has a "click to activate" button wired to a **non-registered** action. `simulation_lab` runs scenarios but forgets them. `scenario_comparator` shows scenarios but the only way to get new ones is re-running synthesize. `intervention_card` marks done but captures nothing about what the user actually did.

### 1.2 Digital-twin loop — what's actually connected

The user's intuition was right: the twin loop fragments exist, **but none of the fragments are chained.**

| Loop stage | Status | Where it lives / why it's broken |
|---|---|---|
| **Replicate (snapshot before proposal)** | PARTIAL | `strategy_baselines.twin_state` is the only frozen form, and it's FK-bound to `strategy_snapshot_id` — capture happens *during* strategy-refresh, not when the user asks "snapshot my current state so I can test against it." |
| **Diagnose on snapshot** | PARTIAL | `validate-twin-quality.ts` produces issues across 4 layers but the report is never persisted and no read path surfaces it. Reality Calibration (now Tier 3/4 after R2) runs on the snapshot but is a baseline-reproduction check, not a functional diagnostic. |
| **Test on snapshot** | MISSING | MC reads the **live KG**, not `strategy_baselines.kg_snapshot`. `simulateEntityChain` + `simulateVariantLift` (from R1) have no snapshot-input mode. |
| **Propose** | EXISTS | `twin_proposals` + `TwinProposalReviewPanel`. This is the strategy pitch + approval record. |
| **Test-after (projected twin)** | PARTIAL | `computeProposedTwinState` gives a static delta; `TwinPreviewGate` shows current vs projected — but on the **live graph**, not snapshot-to-snapshot. |
| **Delta comparison (pre vs post)** | MISSING | No table persists the pre-snapshot-MC vs post-snapshot-MC delta. `detectChanges` compares synthesis snapshots but isn't driven by this loop. |

**"The twin"** in this codebase is a computed projection (`computeTwinState`), not a live simulator or a structural replica. It's a scorecard over the KG, re-computed on each read. Neither MC nor Twin currently read from a persisted snapshot.

**The connective tissue is what's missing.** Five excellent components — `computeTwinState`, `computeProposedTwinState`, `validateTwinQuality`, `simulateEntityChain` + `simulateVariantLift`, `prediction_ledger` + deviation tagging — never touch each other. A first-class snapshot primitive, decoupled from strategy generation, is the single object that would unlock all five.

---

## 2. External state-of-the-art — what the industry settled on

The landscape converged in 2025–2026. Three relevant stacks:

### 2.1 Enterprise digital twins (Palantir, Ansys, Siemens)
The canonical pattern is **Ontology + Scenarios + Branching**:
- **Ontology** — objects + properties + links + actions as the twin (Palantir Foundry)
- **Scenarios** — a FORK of the ontology generated by applying an action list transactionally, storing only **deltas** (modified properties, created/deleted objects/links)
- **Branching** — test changes end-to-end before merging with one-click

Canonical sources: [Palantir Scenarios](https://www.palantir.com/docs/foundry/workshop/scenarios-overview), [Foundry Branching](https://www.palantir.com/docs/foundry/foundry-branching/overview), [Ansys ROMs](https://www.ansys.com/blog/boost-simulations-with-roms-digital-twins), Siemens Digital Twin Composer (CES 2026).

Important: **Palantir deliberately does NOT support data-branch merging** the way git does merges. For data: "re-run the action list against current main." They merge *logic* and *actions*, not raw data. This avoids the 3-way-merge problem that has no good answer.

### 2.2 Agent-authored tools (MCP Apps, A2UI, Vercel AI SDK, CopilotKit)

**The industry has decisively moved from "agent writes code" to "agent composes structured artifacts the host renders in a sandboxed context."**

The watershed event: **MCP Apps shipped in late 2025 / early 2026** as a joint OpenAI + Anthropic standard. MCP tools now return *interactive UI components* (dashboards, forms, multi-step workflows) that hosts render in a sandboxed iframe. Launch partners: Hex, Figma, Canva, Asana, Slack.

The three-tier generative-UI taxonomy everyone converged on:
- **Static** — agent picks from a hand-crafted registry (safest, what this codebase has today)
- **Declarative / schema-driven** — agent emits a JSON spec; host renders with native widgets. **This is the dominant 2026 pattern** (MCP Apps, A2UI, Vercel AI SDK's `useComponent`, CopilotKit)
- **Open-ended code generation** — agent returns HTML/JS/iframes (most flexible, highest risk, requires sandbox)

Sources: [MCP Apps launch](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/), [A2UI](https://a2ui.org/), [CopilotKit Generative UI](https://www.copilotkit.ai/generative-ui).

**The takeaway for R5:** your existing fixed-widget-registry instinct is correct and on the winning side of history. Don't abandon it under pressure to "write code." Formalize it against MCP Apps / A2UI so you get interoperability for free.

### 2.3 Sandbox runtime tiers (E2B, Modal, Cloudflare, Pyodide)

Clear tiered model:
- **Tier 1 — static widget render:** no sandbox needed, schema-validated, renders in-app
- **Tier 2 — user-scoped one-off code** (custom metric formula, custom chart transform): **Pyodide in the browser.** Zero server cost, inherits browser sandbox, NVIDIA explicitly endorses for agentic workflows ([NVIDIA Pyodide](https://developer.nvidia.com/blog/sandboxing-agentic-ai-workflows-with-webassembly/))
- **Tier 3 — long-running simulation / agent-written server code:** E2B Firecracker microVMs (~150ms cold start) or Cloudflare Dynamic Workers V8 isolates (<5ms, 10-100× more efficient than containers)

### 2.4 Causal proposal contracts (DoWhy)

DoWhy's canonical 4-step contract: **model → identify → estimate → refute.** For every causal intervention proposal, emit all four fields:
- **model** — the causal subgraph the proposal targets
- **identify** — which effect we're claiming (backdoor? frontdoor? mediator?)
- **estimate** — the MC-derived point estimate + confidence interval
- **refute** — at least one robustness check (placebo intervention, random-common-cause, data-subset)

This gives you an auditable "did the proposal actually do what we said?" structure. [DoWhy](https://github.com/py-why/dowhy) is the reference implementation; clinical-twin literature has settled on the same contract.

### 2.5 Agent orchestration with HITL checkpoints

AutoResearchClaw v0.4 added a 6-level HITL mode (full-auto / gate-only / checkpoint / step-by-step / co-pilot / custom) because unbounded autonomy produced too many off-the-rails runs. LangGraph-shaped state machines with explicit checkpoints have become the default pattern.

For R5: **gate-only is the correct default** — agent proposes, user confirms at each stage transition.

### 2.6 Reproducibility (MLflow + DVC pattern)

Every run stores: `random_seed`, `model_version`, `parent_run_id`, `baseline_snapshot_id`, `scenario_id`, `actor`. The run ID ties code-version, data-version, params, and output, and a downstream run can always retrieve the exact upstream artifacts.

---

## 3. The R5 thesis

> **Make "scenarios" a first-class object, and make agent-authored tools a schema-driven configuration over a trusted widget registry — not agent-written code.**

Concretely:

1. Introduce a `scenario` primitive that's decoupled from strategy generation. A scenario is a fork of the current KG state with an action list applied. Scenarios store deltas.
2. Let agents *author* in two tiers: (a) widget configs (JSON schema, trusted renderer — 99% of cases), (b) Pyodide cells for one-off formulas (~1% of cases). Defer Tier 3 server-side sandbox until a real workload demands it.
3. Every proposal must emit DoWhy's 4-field contract, backed by your existing Tier 4 MC engine (R1) and Tier 3/4 numerical calibration (R2).
4. Scenarios + proposals + MC runs chain through a LangGraph-shaped state machine with gate-only HITL checkpoints by default.
5. Reproducibility via extended `pipeline_runs` schema (seed, model_ver, scenario_id, parent_run_id already familiar from Phase 4).

This converts the current "view renderer over a fixed toolkit" into **"scenario engine with agent-composable tools."**

---

## 4. Proposed architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  CANVAS (whiteboard = product centerpiece — per northstar memo)     │
 │  ┌────────────┐  ┌────────────┐  ┌────────────┐                     │
 │  │ Baseline   │→ │ Diagnosis  │→ │ Proposal   │→ [Apply] → [Test]   │
 │  │ Snapshot   │  │ Scenario   │  │ Scenario   │                     │
 │  └────────────┘  └────────────┘  └────────────┘                     │
 │        │               │               │                             │
 │        ▼               ▼               ▼                             │
 │  ┌─────────────────────────────────────────┐                         │
 │  │ SCENARIO SHELF (branches, diff, merge)  │   ← Palantir pattern    │
 │  └─────────────────────────────────────────┘                         │
 └─────────────────────────────────────────────────────────────────────┘
                               │
 ┌─────────────────────────────┴───────────────────────────────────────┐
 │  DATA MODEL                                                          │
 │  snapshots(id, space_id, twin_id, taken_at, root_hash, reason)       │
 │  scenarios(id, parent_snapshot_id, status, action_list, created_by)  │
 │  scenario_deltas(scenario_id, entity_id, field, old, new)            │
 │  pipeline_runs(id, scenario_id, seed, model_ver, parent_run_id, …)   │
 │  proposals(id, scenario_id, model, identify, estimate, refute)       │
 │     ← DoWhy 4-field contract (model/identify/estimate/refute)        │
 │  apps(id, scenario_id, widget_registry_id, config_jsonschema)        │
 │     ← widgets are first-class registry entries; config LLM-authored  │
 │  twin_diagnostics(id, snapshot_id, report, computed_at)              │
 │     ← persist TwinQualityReport + calibration                        │
 └─────────────────────────────────────────────────────────────────────┘
                               │
 ┌─────────────────────────────┴───────────────────────────────────────┐
 │  EXECUTION TIERS                                                     │
 │  Tier 1: Widget renderer (trusted client, schema-validated config)   │
 │     ← MCP Apps / A2UI pattern                                        │
 │  Tier 2: Pyodide cell (browser WASM, for user-scoped formulas)       │
 │     ← NVIDIA-endorsed pattern for agentic code                       │
 │  Tier 3 (future, deferred): E2B microVM or Cloudflare Dynamic Worker │
 │     ← only if/when a workload genuinely needs server compute         │
 └─────────────────────────────────────────────────────────────────────┘
                               │
 ┌─────────────────────────────┴───────────────────────────────────────┐
 │  AGENT LOOP (LangGraph-shaped state machine)                         │
 │  replicate → diagnose → propose → refute → test → calibrate          │
 │  HITL default: gate-only (confirm before each stage transition)      │
 │     ← AutoResearchClaw v0.4 HITL taxonomy                            │
 └─────────────────────────────────────────────────────────────────────┘
```

### Key architectural commitments

1. **Scenarios first-class**, decoupled from strategy generation. User can say "snapshot my current state" outside of any strategy run.
2. **Scenario deltas, not forked datasets.** Copy only what changes. Merge *actions*, not data (Palantir's line).
3. **MC reads scenarios, not just live KG.** Extend `simulateEntityChain` + `simulateVariantLift` with a `snapshot_id` input mode so test-on-snapshot is real.
4. **Proposals carry DoWhy's 4 fields.** Every "this will help" claim has `identify` (what causal effect) + `estimate` (MC p50/CI) + `refute` (at least one robustness check).
5. **Agent-authored tools = JSON config against typed widget schema.** Not generated code. Agents fill schemas via constrained decoding / function calling.
6. **Pipeline runs get reproducibility metadata.** Seed, model version, scenario_id, parent_run_id. Existing Phase 4 `pipeline_runs` + `pipeline_run_events` is the substrate; extend it.
7. **HITL gate-only by default.** User confirms before each major stage transition.
8. **No server-side eval of agent output.** Banned until Tier 3 sandbox is genuinely needed.

---

## 5. Prioritized build plan

| # | Component | Effort (dev-days) | Depends on | Why it matters |
|---|---|---|---|---|
| 1 | `snapshots` + `scenario_deltas` + migration | 3–5 | — | Unlocks every downstream item. Without this, nothing is persistable. |
| 2 | Pipeline-runs extension (seed, model_ver, scenario_id, parent_run_id) | 2–3 | #1 | Reproducibility. Tiny change, huge compound payoff. |
| 3 | Extend `simulateEntityChain` + `simulateVariantLift` with `snapshot_id` input | 2–4 | #1 | Test-on-snapshot becomes real. Today MC only reads live KG. |
| 4 | DoWhy 4-field proposal contract (schema + prompt + UI) | 4–6 | existing proposals | Every proposal becomes audit-ready. |
| 5 | `twin_diagnostics` table + persist TwinQualityReport + calibration | 2–3 | #1 | `validate-twin-quality.ts` stops being dead code. |
| 6 | Widget registry schema formalization (align with MCP Apps / A2UI) | 6–10 | existing registry | Agent configs become typed + interoperable. |
| 7 | Scenario shelf UI on canvas (fork, diff, merge-via-replay) | 10–15 | #1, #3 | The user-facing "replicate → test → propose → test-after" surface. |
| 8 | LangGraph-shaped agent state machine wrapper | 8–12 | #1–#5 ready | The glue that chains the five existing components. |
| 9 | HITL gate-only default + per-stage policy surface | 3–5 | #8 | Safety-by-default. |
| 10 | Pyodide Tier-2 cell (opt-in, single entry surface) | 5–7 | widget registry | "Custom formula" escape hatch without server risk. |
| 11 | Tier-3 sandbox (E2B / Dynamic Workers) | **defer** | actual demand | Don't build until a workload needs it. |

**Critical path:** items #1 + #2 + #3 + #4 + #5 (~13–21 days) deliver the data + contract substrate. Items #6 + #7 + #8 + #9 (~27–42 days) deliver the user-visible loop. Item #10 is polish.

**Total critical-path estimate:** ~40–63 dev-days (≈8–13 weeks for one engineer) to land a production R5 cleanly. Two-phase:

- **Phase A** (data + contracts) — items #1–#5 — unlocks test-on-snapshot, reproducibility, typed proposals
- **Phase B** (UI + runtime) — items #6–#10 — unlocks scenario shelf, agent state machine, HITL, Pyodide cells

---

## 6. What to avoid (anti-patterns)

1. **"Agent writes arbitrary React/Python that renders in the main app."** This is the Bolt/Lovable pattern at full generality — the industry explicitly moved *away* from it. Don't abandon the widget-registry instinct. If flexibility is genuinely needed, route to a Pyodide cell with a typed return contract, not a React file.
2. **`custom:${string}` expansion without a registration mechanism.** If you unblock the escape hatch, you MUST build a `registerActionHandler` path with explicit auth / auditing. Otherwise it's a typed door to nowhere and a future security incident.
3. **Context-window-overflow tool returns.** Every tool return >4KB must store the payload externally and return a *reference* (pointer + schema). Microsoft's agentic-failure taxonomy names this as the #1 silent-failure mode.
4. **Data-branch merging as if it were git.** Palantir explicitly doesn't do this. Merge *logic* and *actions*; for data, "re-run the action list against current main." The 3-way-merge problem has no good answer.
5. **Unbounded autonomous agent runs without checkpoints.** AutoResearchClaw's 6-level HITL taxonomy exists because of this. Bake *gate-only* in as default.
6. **Reactive cell/widget graphs without in-order semantics.** Observable and Jupyter both learned that implicit reactive recomputation creates unreproducible state unless you enforce top-down evaluation order. If the whiteboard evolves into a dependency graph of widgets, commit to in-order semantics up front.
7. **No-sandbox server-side exec of agent output.** Ever.

---

## 7. What R5 delivers that R1–R6 can't

The substance-tier work (R1 MC lift, R2 numerical calibration, R3 ODE engine, R6 node provenance) moves specific numbers from Tier 1 → Tier 4. Honest. Necessary.

R5 is different. It's the **workflow primitive** that makes all those tiers composable:

- Today MC runs live-KG; scenarios make it counterfactual-over-snapshot
- Today proposals are prose; DoWhy contract makes them auditable
- Today agent tools are view-configs; scenario-aware apps make them workflow-aware
- Today the five twin components sit in isolation; the state machine chains them

**Without R5, you have Tier-4 math that users can't build workflows around.**
**Without the substance work (R1–R6), R5 would be a clean workflow shell over numbers that lie.**

Do R3 (ODE) independently — it upgrades the math further. R5 is the shell that lets users actually *use* it.

---

## 8. Sources

### Digital twins
- [Palantir Foundry Scenarios](https://www.palantir.com/docs/foundry/workshop/scenarios-overview)
- [Palantir Foundry Branching](https://www.palantir.com/docs/foundry/foundry-branching/overview)
- [Palantir Foundry Ontology](https://www.palantir.com/docs/foundry/ontology/overview)
- [Ansys — ROMs + Digital Twins](https://www.ansys.com/blog/boost-simulations-with-roms-digital-twins)
- [Siemens CES 2026 — Digital Twin Composer](https://press.siemens.com/global/en/pressrelease/siemens-unveils-technologies-accelerate-industrial-ai-revolution-ces)
- [AnyLogic — System Dynamics](https://www.anylogic.com/use-of-simulation/system-dynamics/)

### Agent tool systems
- [MCP Apps launch (Jan 2026)](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [MCP Apps proposal (Nov 2025)](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [A2UI](https://a2ui.org/)
- [Vercel AI SDK — Generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [CopilotKit — Generative UI taxonomy](https://www.copilotkit.ai/generative-ui)
- [v0 vs Lovable vs Bolt comparison](https://www.digitalapplied.com/blog/v0-lovable-bolt-ai-app-builder-comparison)
- [Replit 2025 in Review](https://blog.replit.com/2025-replit-in-review)
- [Claude Artifacts vs ChatGPT Canvas](https://xsoneconsultants.com/blog/chatgpt-canvas-vs-claude-artifacts/)

### Sandboxes
- [NVIDIA — Pyodide for agentic AI](https://developer.nvidia.com/blog/sandboxing-agentic-ai-workflows-with-webassembly/)
- [E2B vs Modal comparison](https://northflank.com/blog/e2b-vs-modal)
- [Cloudflare Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)

### Causal & reproducibility
- [DoWhy](https://github.com/py-why/dowhy)
- [Digital Twin Counterfactual Framework (DTCF)](https://arxiv.org/html/2604.01325)
- [Flatiron — RWD to Digital Twins in oncology](https://resources.flatiron.com/publications/from-real-world-data-rwd-to-digital-twins-building-models-for-patient-level-counterfactual-prediction-in-oncology)
- [MLflow + DVC experiment tracking](https://www.nb-data.com/p/simple-model-experiment-tracking)
- [Deepnote — audit log](https://deepnote.com/docs/audit-log)

### Failure modes
- [Microsoft — Taxonomy of Failure Modes in Agentic AI Systems](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/Taxonomy-of-Failure-Mode-in-Agentic-AI-Systems-Whitepaper.pdf)
- [AutoResearchClaw — HITL taxonomy](https://github.com/aiming-lab/AutoResearchClaw)

---

*Doc owner: R5 implementation lead. Update as architecture evolves. Cross-ref: [COMPUTATIONAL_SUBSTANCE_ROADMAP.md](./COMPUTATIONAL_SUBSTANCE_ROADMAP.md) for the R1–R6 tier-ladder that R5 sits on top of.*
