# Objective Canvas — Systematization, Layers & Evaluation Assessment

> Consolidated critical assessment (2026-05-29). Honest POV first; evidence below.

## TL;DR — the three things that actually matter

1. **The gap is coherence + vocabulary, not sophistication and not more agents.**
   You've already built most of the architecture the "problem-to-spec compiler"
   thesis recommends; the pieces just aren't consistently wired.
2. **"Layer" is overloaded across 4 distinct structural axes** (one DB table even
   double-duties). Adding "an agent per layer" or "a room per layer" on top of an
   undefined word will multiply the confusion. **Disambiguate first.**
3. **You already have rich role-specialized evaluation** — a 17-agent registry +
   three independent 5-lens ensembles + tiered quality gates. The instinct
   ("agents with clear optimization domains") is right and *already exists*. Don't
   clone it per layer; make the existing roles **layer-aware**.

---

## 1. The central tension (from the prior analysis)

A pasted paper argued for *define-before-generate / ontology-first / build the
smallest useful problem-to-spec compiler*. The twist: the room
(Problem→Mechanism→Result→Objective) **is** that problem model; `MechanismSpec`
**is** the compiler output (PRD + design + ADR + validation); `layer_ontology`
**is** an ontology. So the risk is over-extension, not under-building. Chasing
"technical systematization across all scales + cross-feature data-flow
optimization" right now is the exact trap the paper warns against. Lever =
coherence + the define-before-generate gate.

(Multi-scale standard = **C4 model**: Context → Container → Component → Code, the
same system at 4 zoom levels. Maps onto our Altitude axis below.)

---

## 2. The FOUR structural axes (stop overloading "layer")

| # | Axis | What it is | Canonical owner |
|---|------|-----------|-----------------|
| 1 | **Altitude / scale** | which zoom view (whiteboard → room → mechanism → internals) | `Altitude` type, `causal-map/lib/types.ts:27` |
| 2 | **Abstraction stack** | substrate → … → outcome, with `archetype` + ordinals | `lib/objective-canvas/layer-model.ts` |
| 3 | **Causal stage / lane** | Problem → Mechanism → Result → Objective | `RoomLane` (`sub-objective-room-view.tsx:123`); seeded into `layer_ontology` for objective spaces |
| 4 | **Coupling / subsystem** | mechanism↔mechanism `composes_with` clusters | `edges` (+ `build-mechanism-subsystems.ts`) |

**The mess (verified):**
- The word **"layer"** means at least three different things: the vertical
  ObjectiveStack (Axis 2), the per-space `layer_ontology` table, and a legacy
  `knowledge_layer` enum (`internal/conceptual/external/bridge`).
- **`layer_ontology` double-duties**: for *objective* spaces it's seeded with the
  pain/features/outcomes/objective **stages** (the room reads it — `sub/[subId]/page.tsx`);
  the same table elsewhere holds **domain KG layers** (e.g. molecular→circuit→cognitive).
- **"Stage"** is also overloaded (room lanes AND `layered-synthesis` Stage 1/2/3).
- Only **"lane," "altitude," "archetype"** are unambiguous.

**Recommendation:** one name + one source of truth per axis. Anchor Axis 2 on an
established model — the **Seven Layers of Product Design** (your image): PROBLEM
SPACE (reality → observed behaviour → domain/user-needs) vs SOLUTION SPACE
(strategy → conceptual model → interaction → surface). That cleanly separates
"problem" from "solution," which is exactly the room's Problem→Mechanism split.

---

## 3. Existing evaluation architecture — you already have "agents with roles"

| System | File | Optimizes for |
|--------|------|---------------|
| Framing lenses (5) | `prompts/framing-lenses.ts` | blind-spot coverage at intake (systems_analyst·skeptic·operator·engineer·historian) |
| Indicator ensemble (5 lenses) | `objective-canvas/score-indicator-ensemble.ts` | proxy-metric validity; lens variance = Goodhart signal |
| Lab-design stances (5) | `prompts/lab-stances.ts` | experiment-design tradeoffs (internal/external validity, efficiency, feasibility) |
| Agent registry (17) | `lib/agents/registry.ts` | convergence-of-opinion; weighted personas (critic, causal_auditor, strategy_engine…) |
| Mechanism quality gate (6-axis) | `objective-canvas/enrich-mechanism-spec.ts` | mechanism-spec rigor; low axis ⇒ 1 regen |
| Rubric scorer (5-criteria) | `objective-canvas/score-rubric.ts` | "plausibly good?" (default tier) |
| HCD persona scorer | `objective-canvas/score-indicator-personas.ts` | do different user personas experience it differently |
| Reality/numerical calibration | `pipeline/reality-calibration.ts` | can the KG reproduce declared baselines |
| REML τ² pooling | `objective-canvas/pool-indicator-confidence.ts` | heterogeneity across variations |
| Signal-based strategy | `pipeline/space-strategizer/*` | deterministic structural signals → ranker |

**Critical finding:** evaluation is specialized along **two axes** — *per-artifact*
(mechanism/feature/indicator) and *per-epistemic-role* (the lenses/agents). There
is **NO** evaluator specialized *per causal stage or per layer*. Stage/layer is
only ever passed as *context* (signals like `layer_crossing`, the
cross-layer-cascade predictor).

---

## 4. "Agent per layer + room per layer" — critical verdict

**Don't.** Reasons:
- **Cloning agents per layer = duplication.** The same concerns (is it rigorous?
  measurable? conflicting?) recur at every layer. A "Mechanism-layer critic" and a
  "Result-layer critic" would mostly re-implement the same lenses with different
  context. You'd fork your 17 agents × N layers.
- **A room per layer fragments the causal flow.** The room is already the unit of
  work; the whole value is seeing Problem→Mechanism→Result *together*. Splitting it
  per layer breaks the one thing that makes it coherent.
- **Specialize by ROLE, not by LAYER** (you already do — keep it). The 2026
  multi-agent consensus: hyper-specialize agents by *function/domain*, hub-and-spoke
  orchestration, avoid monolithic — but that's about *function*, not mechanically
  one-per-structural-slot.

**The version of your instinct that works:** make the existing role-agents
**layer-aware** — pass the axis-2 archetype / axis-3 stage as structured context
and add a few layer-specific signals — rather than spawning an agent per layer.
This is already half-done (`layer_crossing`, `outcome_alignment`,
`cross-layer-cascade-prediction.ts`).

---

## 5. Your reference images → where each fits

- **Seven Layers of Product Design** → the canonical model to anchor Axis 2;
  separates Problem vs Solution space.
- **Product-design mind map (Understand methods)** → the intake / define-before-
  generate phase (what research feeds the problem model).
- **Case Study Cheatsheet** (Summary→Problem→Approach→Solution→Results→Next) →
  the *output/deliverable* format for a finished mechanism. Note its caution:
  "avoid design-thinking diagrams / many wireframes" — a useful counterweight to
  diagram-everything.
- **Affinity map + Empathy map** → problem-space clustering; we already approximate
  these (shared-cause pill strip, annotation lens, pain cards).
- **Software Tech Documentation Types taxonomy** → measured against it,
  `MechanismSpec` already produces PRD + technical-design + ADR + QA/validation.
  Gaps: UX-design doc, API doc, source-code doc, user/end-user docs.
- **Requirements doc + "Not Doing" section** → the scope-boundary + open-questions
  pattern; agent specs need it (constraints have *disproportionate* impact). Maps to
  the missing `scope_boundaries` field (§6) — `MechanismSpec` has `kill_criteria`
  but no explicit "not doing."
- **User Story Map** (activity → task → feature × release) → the *macro*
  feature-collaboration / roadmap view — the closest thing to "how all features
  collaborate at the product level." NOT built today; the candidate for a true
  product-scale view if/when cross-feature coherence is tackled.
- **Project Documentation lifecycle** (planning → testing → end-user → handover) →
  the SDLC doc stages; least actionable for the current focus.

---

## 6. More to evaluate (honest open questions — NOT yet verified)

- **Cross-feature data flow** ("one subsystem's data feeds every mechanism that
  benefits") — a blackboard/shared-KG pattern; the KG is *designed* for it but
  consumption is unverified. Needs a dedicated audit.
- Is the **define-before-generate** gate actually enforced at intake (desired
  result + blocking problem + constraints + success metric + term definitions)?
- The `layer_ontology` **double-duty** cleanup (Axis 2 vs Axis 3 vs domain KG).
- **Agent-readiness gaps** in `MechanismSpec`: explicit `acceptance_criteria`,
  `scope_boundaries` ("not doing"), and an agent-prompt export.

---

## 7. Recommended sequence (small, ordered — coherence before scope)

1. **Vocabulary pass** — name the 4 axes distinctly; pick one source of truth each;
   resolve the `layer_ontology` double-duty.
2. **Make evaluation layer-aware** — feed axis-2/axis-3 context to the *existing*
   role-agents; add layer-specific signals. (NOT agent-per-layer.)
3. **Agent-readiness** — add `acceptance_criteria` + `scope_boundaries` to
   `MechanismSpec`; ship an agent-prompt export.
4. **Then** (separately) audit + design cross-feature data flow.
