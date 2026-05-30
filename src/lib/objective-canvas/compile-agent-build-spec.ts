// ── Compile Agent Build Spec (P1.2-B) ─────────────────────────────
//
// Turns everything the canvas produced into ONE coherent "build this app"
// spec a coding agent (Cursor / Claude Code / v0 / Replit) can scaffold
// from. Multi-zoom (macro → flow → micro → design), structured on the
// pattern real teams converge on (PR-FAQ + Google design doc + C4/DFD +
// GitHub Spec Kit + ADR + Seven Layers). See AGENT_EXPORT_SPEC.md.
//
// DESIGN: hybrid. Sections that come straight from structured state are
// ASSEMBLED deterministically (no LLM, no hallucination, exact); only the
// connective tissue that needs cross-input reasoning is LLM-synthesized
// (one llmJSON call). This mirrors build-strategy-brief.ts ("derivation
// over structured state") and keeps the LLM schema small + robust.
//
// Degrades gracefully: features with no MechanismSpec, or a space whose
// macro roll-up hasn't run, don't block — their sections emit
// [NEEDS CLARIFICATION] markers instead (Spec Kit's anti-drift control).

import { llmJSON } from "@/lib/llm";
import type { StrategyBrief } from "./build-strategy-brief";
import type { MechanismSpec } from "./enrich-mechanism-spec";
import { applyDependsOn } from "./derive-depends-on";
import {
  composeExperienceBriefSection,
  type ExperienceBriefSection,
} from "./compose-experience-brief-section";

const CLARIFY = "[NEEDS CLARIFICATION]";

// ── Output schema ─────────────────────────────────────────────────

export interface AgentBuildFeature {
  name: string;
  layer: string;
  purpose: string;
  mechanism: string;
  components: string[];
  inputs: string[];
  acceptance_criteria: string[];
  scope_boundaries: string[];
  depends_on: string[];
  /** v3 — the end-user-facing experience layer of this feature, when
   *  the underlying MechanismSpec carries a v3 `design_intent` block.
   *  Surfaces hero pattern, touchpoints, interaction beats, the
   *  data-token spine, and the MoSCoW reduction log so the brief
   *  delivers BOTH engineering depth (existing) AND designed
   *  experience (new). Null for pre-v3 specs — brief renderer can
   *  branch on null. See `compose-experience-brief-section.ts`. */
  experience: ExperienceBriefSection | null;
}

export interface AgentBuildSpec {
  // WHAT/WHY
  product_summary: string;
  problem: string;
  target_users: string;
  goals: string[];
  success_metrics: string[];
  non_goals: string[];
  tech_constraints: string[];
  // MACRO
  macro_architecture: {
    distilled_objective: string;
    layers: Array<{
      id: string;
      name: string;
      archetype: string;
      role: string;
      subsystems: string[];
      macro_problems: string[];
    }>;
  };
  // CONCEPTUAL MODEL (the bridge)
  conceptual_model: {
    objects: Array<{ name: string; description: string }>;
    relationships: string[];
    terminology: Array<{ term: string; definition: string }>;
  };
  // DATA
  data_model: Array<{ entity: string; fields: string[]; used_by: string[] }>;
  data_flow: {
    cross_feature: Array<{
      from: string;
      to: string;
      data: string;
      direction: "upstream" | "downstream";
    }>;
    per_feature: Array<{
      feature: string;
      steps: Array<{ step: string; component: string; data: string }>;
    }>;
  };
  // MICRO
  features: AgentBuildFeature[];
  // DESIGN
  design: {
    user_flows: string[];
    component_inventory: string[];
    design_notes: string;
  };
  // DECISIONS (ADR)
  decisions: Array<{
    choice: string;
    context: string;
    alternatives_rejected: string[];
  }>;
  // SEQUENCE
  build_sequence: Array<{
    phase: string;
    builds: string[];
    rationale: string;
  }>;
  open_questions: string[];
  generated_at: string;
  state_hash: string;
}

// ── Input contract (the route assembles this) ─────────────────────

export interface MacroLayerInput {
  ordinal: number;
  id: string;
  name: string;
  archetype: string;
  /** Sub-objective (room) titles tagged to this layer. */
  subObjectives: string[];
  /** Rolled-up macro sub-problems (from the `macro_problems` analysis). */
  macroProblems: Array<{ name: string; description: string }>;
}

export interface CompileAgentBuildSpecInput {
  brief: StrategyBrief;
  /** synthesis_data.define (P1.1) — { outcome, target_delta, horizon, subject, constraints }. */
  defineBlock: Record<string, unknown> | null;
  /** entityId → MechanismSpec, for elected features that have one generated. */
  mechanismSpecs: Record<string, MechanismSpec>;
  /** Macro-rollup layers. Null when the roll-up hasn't run for this space. */
  macroLayers: MacroLayerInput[] | null;
  /** Space glossary terms (synthesis_data.glossary). */
  glossary: Array<{ term: string; definition: string }>;
  /** loadCrossRoomState().state_hash — caches the compiled spec. */
  stateHash: string;
}

// ── Small guards (mirror enrich-mechanism-spec's str/strArr) ──────

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strArr(v: unknown, maxItems = 8, maxLen = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

// ── Deterministic assembly — the sections that come straight from state ──

function defineStr(define: Record<string, unknown> | null, key: string): string {
  return define ? str(define[key], 400) : "";
}

/** Build the per-feature micro detail + per-feature data flow + decisions
 *  + design component inventory from the brief's elected variations joined
 *  with their MechanismSpecs. The single source of cross-feature truth. */
function assembleFeatures(input: CompileAgentBuildSpecInput): {
  features: AgentBuildFeature[];
  perFeatureFlow: AgentBuildSpec["data_flow"]["per_feature"];
  decisions: AgentBuildSpec["decisions"];
  componentInventory: string[];
  missingSpecCount: number;
} {
  const features: AgentBuildFeature[] = [];
  const perFeatureFlow: AgentBuildSpec["data_flow"]["per_feature"] = [];
  const decisions: AgentBuildSpec["decisions"] = [];
  const componentSet = new Set<string>();
  let missingSpecCount = 0;

  // Map each room to its layer name (best-effort, via the macro roll-up).
  const layerByRoomTitle = new Map<string, string>();
  for (const ml of input.macroLayers ?? []) {
    for (const so of ml.subObjectives) {
      layerByRoomTitle.set(so.trim().toLowerCase(), `${ml.id} · ${ml.name}`);
    }
  }

  for (const room of input.brief.rooms) {
    const layer =
      layerByRoomTitle.get((room.title ?? "").trim().toLowerCase()) ?? "";
    for (const ev of room.elected_variations) {
      const spec = input.mechanismSpecs[ev.item_id];
      const name = ev.variation_name || ev.item_name;
      if (spec) {
        const components = strArr(
          spec.system_components?.map((c) => c.name),
          12,
          120,
        );
        components.forEach((c) => componentSet.add(c));
        features.push({
          name,
          layer,
          purpose: str(ev.tradeoff, 300) || str(ev.variation?.description, 300),
          mechanism: str(spec.mechanism_of_action, 600),
          components,
          inputs: strArr(spec.input_data, 10, 160),
          acceptance_criteria: strArr(spec.acceptance_criteria, 6, 240),
          scope_boundaries: strArr(spec.scope_boundaries, 6, 240),
          depends_on: [], // populated below via applyDependsOn after cross_feature lands
          experience: composeExperienceBriefSection(spec),
        });
        // v3 — extend per-feature flow with the wiring (produces/consumes)
        // + experience layer (visual_intent / interaction_sketch) per
        // step. Brief render branches on presence: legacy specs lacking
        // these fields render as before.
        const steps = (spec.runtime_flow ?? [])
          .slice(0, 10)
          .map((r) => ({
            step: str(r.step, 200),
            component: str(r.component, 120),
            data: str(r.data, 160),
          }));
        if (steps.length > 0) perFeatureFlow.push({ feature: name, steps });
        const dr = spec.decision_record;
        if (dr && (dr.chosen || dr.rationale)) {
          decisions.push({
            choice: str(dr.chosen, 200),
            context: str(dr.rationale, 400),
            alternatives_rejected: strArr(
              dr.alternatives_rejected?.map((a) => a.name),
              6,
              160,
            ),
          });
        }
      } else {
        missingSpecCount += 1;
        features.push({
          name,
          layer,
          purpose: str(ev.tradeoff, 300) || str(ev.variation?.description, 300),
          mechanism: `${CLARIFY} — no technical mechanism-spec generated for this feature yet (run the mechanism spec to enrich).`,
          components: [],
          inputs: [],
          acceptance_criteria: [],
          scope_boundaries: [],
          depends_on: [],
          experience: null,
        });
      }
    }
  }

  return {
    features,
    perFeatureFlow,
    decisions,
    componentInventory: [...componentSet],
    missingSpecCount,
  };
}

function assembleMacro(
  input: CompileAgentBuildSpecInput,
): AgentBuildSpec["macro_architecture"] {
  const layers = (input.macroLayers ?? [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((ml) => ({
      id: ml.id,
      name: ml.name,
      archetype: ml.archetype,
      role: "",
      subsystems: ml.subObjectives.slice(0, 12),
      macro_problems: ml.macroProblems
        .map((p) => str(p.name, 160))
        .filter(Boolean)
        .slice(0, 8),
    }));
  return { distilled_objective: "", layers };
}

// ── LLM synthesis — only the connective tissue ───────────────────

interface SynthesisShape {
  product_summary?: unknown;
  distilled_objective?: unknown;
  conceptual_model?: {
    objects?: unknown;
    relationships?: unknown;
    terminology?: unknown;
  };
  data_model?: unknown;
  data_flow_cross_feature?: unknown;
  build_sequence?: unknown;
  user_flows?: unknown;
  design_notes?: unknown;
  layer_roles?: unknown;
  open_questions?: unknown;
}

const SYNTHESIS_SCHEMA = {
  name: "AgentBuildSpecSynthesis",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      product_summary: { type: "string" },
      distilled_objective: { type: "string" },
      conceptual_model: {
        type: "object",
        additionalProperties: false,
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["name", "description"],
            },
          },
          relationships: { type: "array", items: { type: "string" } },
          terminology: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                term: { type: "string" },
                definition: { type: "string" },
              },
              required: ["term", "definition"],
            },
          },
        },
        required: ["objects", "relationships", "terminology"],
      },
      data_model: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            entity: { type: "string" },
            fields: { type: "array", items: { type: "string" } },
            used_by: { type: "array", items: { type: "string" } },
          },
          required: ["entity", "fields", "used_by"],
        },
      },
      data_flow_cross_feature: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            data: { type: "string" },
            direction: { type: "string", enum: ["upstream", "downstream"] },
          },
          required: ["from", "to", "data", "direction"],
        },
      },
      build_sequence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            phase: { type: "string" },
            builds: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: ["phase", "builds", "rationale"],
        },
      },
      user_flows: { type: "array", items: { type: "string" } },
      design_notes: { type: "string" },
      open_questions: { type: "array", items: { type: "string" } },
    },
    required: [
      "product_summary",
      "distilled_objective",
      "conceptual_model",
      "data_model",
      "data_flow_cross_feature",
      "build_sequence",
      "user_flows",
      "design_notes",
      "open_questions",
    ],
  },
} as const;

function buildSynthesisPrompt(
  input: CompileAgentBuildSpecInput,
  features: AgentBuildFeature[],
  macro: AgentBuildSpec["macro_architecture"],
): { system: string; user: string } {
  const system = `You compile a strategy canvas into ONE coherent, agent-buildable software build spec. You are given the structured pieces (objective, layered architecture, the elected features + their mechanisms). Your job is the CONNECTIVE TISSUE a coding agent needs but that isn't already structured:

- product_summary: 2-3 sentences — what we're building + for whom (press-release clarity, no hype).
- distilled_objective: ONE dense plain sentence naming the whole product.
- conceptual_model: the domain objects, how they relate, and key terminology — the bridge between the data model and the UI (this is the most-skipped, highest-value layer). Derive objects/terms from the features + glossary; don't invent unrelated ones.
- data_model: the concrete shared entities + fields the features need, and which features use each. Synthesize across features — find the SHARED entities, don't just restate per-feature data.
- data_flow_cross_feature: ordered, labeled data flows BETWEEN features (from → to {data}, upstream/downstream). This is how the system's parts feed each other across layers. Use the layered architecture to infer direction (substrate → outcome = downstream).
- build_sequence: dependency-ordered phases (data models → services → endpoints → UI). Foundational features first.
- user_flows: the primary user journeys through the product (3-6).
- design_notes: surface/interaction intent — how it should feel + key UI patterns. Concise.
- open_questions: anything genuinely unresolved an agent must clarify before building. Prefix each with ${CLARIFY}. Include gaps you notice (missing data, ambiguous scope).

RULES: ground every claim in the provided pieces — no invented features or tech the input doesn't imply. Be concrete + buildable. Return JSON matching the schema; no prose outside it.`;

  const featureLines = features
    .map(
      (f, i) =>
        `${i + 1}. ${f.name}${f.layer ? ` [${f.layer}]` : ""} — ${f.purpose || "—"}\n   mechanism: ${f.mechanism.slice(0, 240)}\n   components: ${f.components.join(", ") || "—"}\n   inputs: ${f.inputs.join(", ") || "—"}`,
    )
    .join("\n");
  const macroLines =
    macro.layers.length > 0
      ? macro.layers
          .map(
            (l) =>
              `- ${l.id} ${l.name} (${l.archetype}): subsystems = ${l.subsystems.join(", ") || "—"}; problems = ${l.macro_problems.join("; ") || "—"}`,
          )
          .join("\n")
      : "(macro roll-up not yet run — infer a minimal layering from the features)";
  const glossaryLines =
    input.glossary.length > 0
      ? input.glossary
          .slice(0, 30)
          .map((g) => `- ${g.term}: ${g.definition}`)
          .join("\n")
      : "(no glossary)";

  const user = `OBJECTIVE:
${input.brief.objective_text}

DEFINE (user's framing):
- Desired outcome: ${defineStr(input.defineBlock, "outcome") || "—"}
- Target delta: ${defineStr(input.defineBlock, "target_delta") || "—"}
- Horizon: ${defineStr(input.defineBlock, "horizon") || "—"}
- Subject: ${defineStr(input.defineBlock, "subject") || "—"}
- Constraints: ${defineStr(input.defineBlock, "constraints") || "—"}

LAYERED ARCHITECTURE (macro):
${macroLines}

FEATURES (the elected mechanisms):
${featureLines || "(none elected yet)"}

GLOSSARY:
${glossaryLines}

Compile the connective tissue per the schema.`;

  return { system, user };
}

// ── The compile entrypoint ────────────────────────────────────────

export async function compileAgentBuildSpec(
  input: CompileAgentBuildSpecInput,
): Promise<AgentBuildSpec> {
  const { features, perFeatureFlow, decisions, componentInventory, missingSpecCount } =
    assembleFeatures(input);
  const macro = assembleMacro(input);

  // WHAT/WHY — from the define block + constraints (deterministic).
  const c = input.brief.constraints;
  const tech_constraints = c
    ? [
        `Time horizon: ${c.time_horizon}`,
        `Budget tier: ${c.budget_tier}`,
        `Team size: ${c.team_size}`,
        `Risk tolerance: ${c.risk_tolerance}`,
        ...(c.compliance_requirements ?? []).map((x) => `Compliance: ${x}`),
      ]
    : [];
  const defineConstraints = defineStr(input.defineBlock, "constraints");
  const non_goals = defineConstraints
    ? [defineConstraints]
    : [`${CLARIFY} — no explicit non-goals captured; define what is OUT of scope.`];
  const success_metrics = [
    defineStr(input.defineBlock, "outcome"),
    defineStr(input.defineBlock, "target_delta"),
    defineStr(input.defineBlock, "horizon"),
  ].filter(Boolean);

  // Connective tissue — one LLM call.
  let synth: SynthesisShape = {};
  try {
    const { system, user } = buildSynthesisPrompt(input, features, macro);
    synth = await llmJSON<SynthesisShape>({
      system,
      user,
      responseSchema: SYNTHESIS_SCHEMA,
      temperature: 0.4,
      maxTokens: 3200,
    });
  } catch (err) {
    console.warn("[compile-agent-build-spec] synthesis failed (soft):", err);
  }

  const cm = synth.conceptual_model ?? {};
  const openQuestions = strArr(synth.open_questions, 12, 300);
  if (missingSpecCount > 0) {
    openQuestions.unshift(
      `${CLARIFY} — ${missingSpecCount} feature(s) have no technical mechanism-spec yet; their mechanism/components/acceptance criteria are unspecified.`,
    );
  }

  return {
    product_summary: str(synth.product_summary, 800),
    problem:
      defineStr(input.defineBlock, "outcome") ||
      str(input.brief.objective_text, 600),
    target_users: defineStr(input.defineBlock, "subject") || `${CLARIFY} — target users not specified.`,
    goals: [str(input.brief.objective_text, 300)].filter(Boolean),
    success_metrics:
      success_metrics.length > 0
        ? success_metrics
        : [`${CLARIFY} — no success metric captured in the define gate.`],
    non_goals,
    tech_constraints,
    macro_architecture: {
      distilled_objective: str(synth.distilled_objective, 400),
      layers: macro.layers,
    },
    conceptual_model: {
      objects: Array.isArray(cm.objects)
        ? (cm.objects as Array<{ name?: unknown; description?: unknown }>)
            .map((o) => ({ name: str(o.name, 120), description: str(o.description, 300) }))
            .filter((o) => o.name)
            .slice(0, 20)
        : [],
      relationships: strArr(cm.relationships, 16, 240),
      terminology: Array.isArray(cm.terminology)
        ? (cm.terminology as Array<{ term?: unknown; definition?: unknown }>)
            .map((t) => ({ term: str(t.term, 120), definition: str(t.definition, 300) }))
            .filter((t) => t.term)
            .slice(0, 24)
        : input.glossary.slice(0, 24),
    },
    data_model: Array.isArray(synth.data_model)
      ? (synth.data_model as Array<{ entity?: unknown; fields?: unknown; used_by?: unknown }>)
          .map((d) => ({
            entity: str(d.entity, 120),
            fields: strArr(d.fields, 24, 120),
            used_by: strArr(d.used_by, 16, 120),
          }))
          .filter((d) => d.entity)
          .slice(0, 24)
      : [],
    data_flow: {
      cross_feature: Array.isArray(synth.data_flow_cross_feature)
        ? (synth.data_flow_cross_feature as Array<Record<string, unknown>>)
            .map((f) => ({
              from: str(f.from, 120),
              to: str(f.to, 120),
              data: str(f.data, 200),
              direction: f.direction === "upstream" ? ("upstream" as const) : ("downstream" as const),
            }))
            .filter((f) => f.from && f.to)
            .slice(0, 40)
        : [],
      per_feature: perFeatureFlow,
    },
    // v3 — derive each feature's depends_on from the cross-feature
    // edges (closes SYSTEMS_WIRING_MASTER_PLAN.md Gap #1). The stub
    // `[]` initializers above are intentionally placeholders; this
    // line populates them from real data right before emission.
    features: applyDependsOn(
      features,
      Array.isArray(synth.data_flow_cross_feature)
        ? (synth.data_flow_cross_feature as Array<Record<string, unknown>>)
            .map((f) => ({
              from: str(f.from, 120),
              to: str(f.to, 120),
              data: str(f.data, 200),
              direction:
                f.direction === "upstream"
                  ? ("upstream" as const)
                  : ("downstream" as const),
            }))
            .filter((f) => f.from && f.to)
        : [],
    ),
    design: {
      user_flows: strArr(synth.user_flows, 10, 300),
      component_inventory: componentInventory.slice(0, 40),
      design_notes: str(synth.design_notes, 800),
    },
    decisions,
    build_sequence: Array.isArray(synth.build_sequence)
      ? (synth.build_sequence as Array<Record<string, unknown>>)
          .map((b) => ({
            phase: str(b.phase, 160),
            builds: strArr(b.builds, 16, 160),
            rationale: str(b.rationale, 400),
          }))
          .filter((b) => b.phase)
          .slice(0, 12)
      : [],
    open_questions: openQuestions,
    generated_at: new Date().toISOString(),
    state_hash: input.stateHash,
  };
}

// ── Deterministic markdown renderer (mirror renderStrategyBriefMarkdown) ──
// The agent-facing artifact: ordered macro → conceptual → data → flow →
// micro → design → decisions → sequence so a coding agent reads it top to
// bottom and builds without drift. Skips empty sections.

export function renderAgentBuildSpecMarkdown(spec: AgentBuildSpec): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const h2 = (title: string) => push("", `## ${title}`, "");
  const bullets = (items: string[]) => {
    for (const i of items) if (i.trim()) push(`- ${i}`);
  };

  push("# Agent Build Spec");
  push("");
  push(`> ${spec.macro_architecture.distilled_objective || spec.problem || "(objective)"}`);
  push("");
  push(
    `_Compiled ${spec.generated_at.slice(0, 10)} from the Objective Canvas — hand this to a coding agent (Cursor / Claude Code / v0 / Replit)._`,
  );

  if (spec.product_summary) {
    h2("Product summary");
    push(spec.product_summary);
  }

  h2("Problem & users");
  push(`- **Problem:** ${spec.problem || "—"}`);
  push(`- **Target users:** ${spec.target_users || "—"}`);

  if (spec.goals.length > 0 || spec.success_metrics.length > 0) {
    h2("Goals & success metrics");
    if (spec.goals.length > 0) {
      push("**Goals**", "");
      bullets(spec.goals);
      push("");
    }
    if (spec.success_metrics.length > 0) {
      push("**Success metrics**", "");
      bullets(spec.success_metrics);
    }
  }

  if (spec.non_goals.length > 0) {
    h2("Non-goals — explicitly NOT building");
    bullets(spec.non_goals);
  }
  if (spec.tech_constraints.length > 0) {
    h2("Tech constraints");
    bullets(spec.tech_constraints);
  }

  if (spec.macro_architecture.layers.length > 0) {
    h2("Macro architecture (the layered system)");
    for (const l of spec.macro_architecture.layers) {
      push(`### ${l.id} · ${l.name}${l.archetype ? ` (${l.archetype})` : ""}`);
      if (l.role) push("", l.role);
      if (l.subsystems.length > 0) push(`- **Subsystems:** ${l.subsystems.join(", ")}`);
      if (l.macro_problems.length > 0) push(`- **Problems:** ${l.macro_problems.join("; ")}`);
      push("");
    }
  }

  const cm = spec.conceptual_model;
  if (cm.objects.length > 0 || cm.relationships.length > 0 || cm.terminology.length > 0) {
    h2("Conceptual model");
    if (cm.objects.length > 0) {
      push("**Objects**", "");
      for (const o of cm.objects) push(`- **${o.name}** — ${o.description}`);
      push("");
    }
    if (cm.relationships.length > 0) {
      push("**Relationships**", "");
      bullets(cm.relationships);
      push("");
    }
    if (cm.terminology.length > 0) {
      push("**Terminology**", "");
      for (const t of cm.terminology) push(`- **${t.term}** — ${t.definition}`);
    }
  }

  if (spec.data_model.length > 0) {
    h2("Data model");
    for (const d of spec.data_model) {
      push(`### ${d.entity}`);
      if (d.fields.length > 0) push(`- **Fields:** ${d.fields.join(", ")}`);
      if (d.used_by.length > 0) push(`- **Used by:** ${d.used_by.join(", ")}`);
      push("");
    }
  }

  const flow = spec.data_flow;
  if (flow.cross_feature.length > 0 || flow.per_feature.length > 0) {
    h2("Data flow");
    if (flow.cross_feature.length > 0) {
      push("**Cross-feature**", "");
      for (const f of flow.cross_feature) {
        push(
          `- ${f.from} → ${f.to}${f.data ? ` {${f.data}}` : ""} _(${f.direction})_`,
        );
      }
      push("");
    }
    if (flow.per_feature.length > 0) {
      push("**Per-feature (runtime)**", "");
      for (const pf of flow.per_feature) {
        const chain = pf.steps
          .map(
            (s) =>
              `${s.step}${s.component && s.component !== "—" ? ` [${s.component}]` : ""}${s.data && s.data !== "—" ? ` {${s.data}}` : ""}`,
          )
          .join("  →  ");
        push(`- **${pf.feature}:** ${chain}`);
      }
    }
  }

  if (spec.features.length > 0) {
    h2("Features");
    spec.features.forEach((f, i) => {
      push(`### ${i + 1}. ${f.name}${f.layer ? ` — ${f.layer}` : ""}`);
      if (f.purpose) push("", f.purpose);
      if (f.mechanism) push(`- **Mechanism:** ${f.mechanism}`);
      if (f.components.length > 0) push(`- **Components:** ${f.components.join(", ")}`);
      if (f.inputs.length > 0) push(`- **Inputs:** ${f.inputs.join(", ")}`);
      if (f.acceptance_criteria.length > 0) {
        push("- **Acceptance criteria:**");
        for (const a of f.acceptance_criteria) push(`  - ${a}`);
      }
      if (f.scope_boundaries.length > 0) {
        push("- **Scope (not doing):**");
        for (const s of f.scope_boundaries) push(`  - ${s}`);
      }
      if (f.depends_on.length > 0) push(`- **Depends on:** ${f.depends_on.join(", ")}`);
      push("");
    });
  }

  const dz = spec.design;
  if (dz.user_flows.length > 0 || dz.component_inventory.length > 0 || dz.design_notes) {
    h2("Design (UI/UX)");
    if (dz.user_flows.length > 0) {
      push("**User flows**", "");
      bullets(dz.user_flows);
      push("");
    }
    if (dz.component_inventory.length > 0) {
      push(`- **Components:** ${dz.component_inventory.join(", ")}`);
    }
    if (dz.design_notes) push("", dz.design_notes);
  }

  if (spec.decisions.length > 0) {
    h2("Decisions (ADR)");
    for (const dec of spec.decisions) {
      push(`### ${dec.choice}`);
      if (dec.context) push(`- **Context:** ${dec.context}`);
      if (dec.alternatives_rejected.length > 0) {
        push(`- **Rejected:** ${dec.alternatives_rejected.join(", ")}`);
      }
      push("");
    }
  }

  if (spec.build_sequence.length > 0) {
    h2("Build sequence");
    spec.build_sequence.forEach((b, i) => {
      push(`${i + 1}. **${b.phase}** — ${b.rationale}`);
      for (const x of b.builds) push(`   - ${x}`);
    });
  }

  if (spec.open_questions.length > 0) {
    h2("Open questions");
    bullets(spec.open_questions);
  }

  return out.join("\n");
}
