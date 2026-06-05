// ── compose-tech-spec — Opus + UI agent skill → TechSpec ─────────────
//
// Server-only. Turns a SpecForge run's accumulated synthesis into an
// engineering-grade TechSpec (architecture + data model + build phases +
// a first-class ui_plan). Reuses the canonical pieces: getAnthropicClient
// (Opus), loadUiSkillSystem() prefix (the "UI agent /" skill — applies
// cognitive-load + MoSCoW + a11y + app-type reasoning), and the research
// route's robust JSON extractors. The route wraps this in instrumentedLLMCall.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import { extractJSON, repairAndExtractJSON } from "@/lib/web-search";
import type {
  TechSpec,
  TechSpecDesignLanguage,
  TechSpecUiPlan,
} from "./types";

// Frontier Opus. Single source of truth in llm.ts so a model bump there
// fixes every Opus call site at once (legacy ids 404 silently).
const OPUS_MODEL = BEST_CLAUDE_MODEL;

export interface ComposeTechSpecInput {
  idea: string;
  /** The SpecForge chain's accumulated synthesis (returned by runSpecForge). */
  forgeContext: string;
  /** Design cues from vision-analyzed inspiration images (Phase 2). */
  inspirationCues?: string[];
}

const SYSTEM = `You are a principal software engineer + product manager writing the build-ready technical specification for a product idea that has just been through a structured discovery chain (problem tree, target user, thesis, differentiation, solution families, MVP, recommended first build).

Think with three lenses and make the spec genuinely COMPLEX and complete enough to hand to an engineering team:
1. SOFTWARE ENGINEERING — a concrete architecture (named components + responsibilities + plausible tech), a real data model (entities + fields), and external integrations. No hand-waving; make defensible technical choices.
2. PROJECT MANAGEMENT (human-centered) — goals, success metrics, non-goals, and a dependency-ordered build sequence where each phase has deliverables, what it depends_on, and acceptance criteria. Sequence so the riskiest/most-foundational work lands first.
3. UI / EXPERIENCE — apply the UI design skill above (cognitive load, the Reduction Operator / MoSCoW, app-type density, accessibility + all interface states). Produce a ui_plan that a designer could build screens from.

Be specific to THIS idea — never generic boilerplate. Prefer concrete nouns over abstractions.

Return ONLY a JSON object (no prose, no markdown fence) of exactly this shape:
{
  "title": string,
  "overview": string,                // 2-3 sentence product summary
  "problem": string,
  "target_users": string[],
  "goals": string[],
  "success_metrics": string[],
  "non_goals": string[],
  "architecture": { "summary": string, "components": [{"name":string,"responsibility":string,"tech":string}], "layers": string[] },
  "data_model": [{"entity":string,"fields":string[],"notes":string}],
  "integrations": string[],
  "features": [{"name":string,"description":string,"components":string[],"acceptance_criteria":string[]}],
  "build_phases": [{"phase":string,"goal":string,"deliverables":string[],"depends_on":string[],"acceptance_criteria":string[]}],
  "risks": string[],
  "open_questions": string[],
  "ui_plan": {
    "design_language": {"glass_tier":"plate|card|float|hero","accent_intent":"signal|warning|growth|insight|neutral","density":"airy|comfortable|dense","motion_intent":"still|breathing|reveal|responsive","hero_pattern":"metric|flow|cycle|before_after|evidence|decision"},
    "screens": [{"name":string,"purpose":string,"key_components":string[],"states":string[]}],
    "component_inventory": string[],
    "interaction_notes": string[],
    "reduction_log": string[],       // MoSCoW: "Kept X — because Y" / "Cut Z — because W"
    "inspiration_cues": string[]     // echo/refine the provided inspiration cues; [] if none
  }
}
Aim for 4-8 components, 3-6 data entities, 4-8 features, 3-5 build phases, 3-6 screens. Every screen lists its non-happy-path states (empty/loading/error/success).`;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}
function arr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
    : [];
}
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function normalizeDesignLanguage(raw: unknown): TechSpecDesignLanguage {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    glass_tier: pick(d.glass_tier, ["plate", "card", "float", "hero"], "card"),
    accent_intent: pick(
      d.accent_intent,
      ["signal", "warning", "growth", "insight", "neutral"],
      "neutral",
    ),
    density: pick(d.density, ["airy", "comfortable", "dense"], "comfortable"),
    motion_intent: pick(
      d.motion_intent,
      ["still", "breathing", "reveal", "responsive"],
      "responsive",
    ),
    hero_pattern: pick(
      d.hero_pattern,
      ["metric", "flow", "cycle", "before_after", "evidence", "decision"],
      "flow",
    ),
  };
}

function normalizeUiPlan(raw: unknown): TechSpecUiPlan {
  const u = (raw ?? {}) as Record<string, unknown>;
  const screens = Array.isArray(u.screens) ? u.screens : [];
  return {
    design_language: normalizeDesignLanguage(u.design_language),
    screens: screens
      .map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return {
          name: str(o.name),
          purpose: str(o.purpose),
          key_components: arr(o.key_components),
          states: arr(o.states),
        };
      })
      .filter((s) => s.name || s.purpose)
      .slice(0, 8),
    component_inventory: arr(u.component_inventory),
    interaction_notes: arr(u.interaction_notes),
    reduction_log: arr(u.reduction_log),
    inspiration_cues: arr(u.inspiration_cues),
  };
}

/** Coerce the model's JSON into a complete, render-safe TechSpec. */
export function normalizeTechSpec(raw: unknown): TechSpec {
  const r = (raw ?? {}) as Record<string, unknown>;
  const arch = (r.architecture ?? {}) as Record<string, unknown>;
  return {
    title: str(r.title) || "Technical Specification",
    overview: str(r.overview),
    problem: str(r.problem),
    target_users: arr(r.target_users),
    goals: arr(r.goals),
    success_metrics: arr(r.success_metrics),
    non_goals: arr(r.non_goals),
    architecture: {
      summary: str(arch.summary),
      components: (Array.isArray(arch.components) ? arch.components : [])
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            name: str(o.name),
            responsibility: str(o.responsibility),
            tech: str(o.tech),
          };
        })
        .filter((c) => c.name),
      layers: arr(arch.layers),
    },
    data_model: (Array.isArray(r.data_model) ? r.data_model : [])
      .map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return { entity: str(o.entity), fields: arr(o.fields), notes: str(o.notes) };
      })
      .filter((e) => e.entity),
    integrations: arr(r.integrations),
    features: (Array.isArray(r.features) ? r.features : [])
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return {
          name: str(o.name),
          description: str(o.description),
          components: arr(o.components),
          acceptance_criteria: arr(o.acceptance_criteria),
        };
      })
      .filter((f) => f.name),
    build_phases: (Array.isArray(r.build_phases) ? r.build_phases : [])
      .map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        return {
          phase: str(o.phase),
          goal: str(o.goal),
          deliverables: arr(o.deliverables),
          depends_on: arr(o.depends_on),
          acceptance_criteria: arr(o.acceptance_criteria),
        };
      })
      .filter((p) => p.phase),
    risks: arr(r.risks),
    open_questions: arr(r.open_questions),
    ui_plan: normalizeUiPlan(r.ui_plan),
  };
}

/** Generate a TechSpec from a SpecForge run via Opus + the UI agent skill. */
export async function composeTechSpec(
  input: ComposeTechSpecInput,
): Promise<TechSpec> {
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();

  const cues = (input.inspirationCues ?? []).filter(Boolean);
  const user =
    `IDEA:\n${input.idea}\n\n` +
    `DISCOVERY SYNTHESIS (from the SpecForge chain — use as the substance):\n${input.forgeContext}\n\n` +
    (cues.length
      ? `UI INSPIRATION CUES (from images the user pasted on the board — honor these in ui_plan):\n${cues
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}\n\n`
      : "") +
    `Write the full technical specification as the JSON object specified.`;

  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: 8000,
      system: uiSkillPrefix + "\n\n" + SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 5 * 60 * 1000 },
  );

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

  let parsed: unknown;
  try {
    parsed = extractJSON(text);
  } catch {
    parsed = repairAndExtractJSON(text);
  }
  return normalizeTechSpec(parsed);
}

// ── Markdown render (mirrors renderAgentBuildSpecMarkdown) ────────────

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}\n` : "";
}
function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

export function renderTechSpecMarkdown(spec: TechSpec): string {
  const parts: string[] = [`# ${spec.title}\n`];
  if (spec.overview) parts.push(`${spec.overview}\n`);
  parts.push(section("Problem", spec.problem));
  if (spec.target_users.length)
    parts.push(section("Target users", bullets(spec.target_users)));
  if (spec.goals.length) parts.push(section("Goals", bullets(spec.goals)));
  if (spec.success_metrics.length)
    parts.push(section("Success metrics", bullets(spec.success_metrics)));
  if (spec.non_goals.length)
    parts.push(section("Non-goals", bullets(spec.non_goals)));

  if (spec.architecture.summary || spec.architecture.components.length) {
    const comps = spec.architecture.components
      .map(
        (c) =>
          `- **${c.name}** — ${c.responsibility}${c.tech ? ` _(${c.tech})_` : ""}`,
      )
      .join("\n");
    parts.push(
      section(
        "Architecture",
        [
          spec.architecture.summary,
          spec.architecture.layers.length
            ? `\n_Layers:_ ${spec.architecture.layers.join(" → ")}`
            : "",
          comps ? `\n${comps}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    );
  }

  if (spec.data_model.length) {
    const rows = spec.data_model
      .map(
        (e) =>
          `- **${e.entity}**: ${e.fields.join(", ")}${e.notes ? ` — ${e.notes}` : ""}`,
      )
      .join("\n");
    parts.push(section("Data model", rows));
  }
  if (spec.integrations.length)
    parts.push(section("Integrations", bullets(spec.integrations)));

  if (spec.features.length) {
    const f = spec.features
      .map(
        (x) =>
          `### ${x.name}\n${x.description}\n${
            x.components.length ? `\n_Components:_ ${x.components.join(", ")}` : ""
          }${
            x.acceptance_criteria.length
              ? `\n\n_Acceptance:_\n${bullets(x.acceptance_criteria)}`
              : ""
          }`,
      )
      .join("\n\n");
    parts.push(section("Features", f));
  }

  if (spec.build_phases.length) {
    const p = spec.build_phases
      .map(
        (x) =>
          `### ${x.phase}\n${x.goal}${
            x.depends_on.length ? `\n_Depends on:_ ${x.depends_on.join(", ")}` : ""
          }${x.deliverables.length ? `\n\n_Deliverables:_\n${bullets(x.deliverables)}` : ""}${
            x.acceptance_criteria.length
              ? `\n\n_Acceptance:_\n${bullets(x.acceptance_criteria)}`
              : ""
          }`,
      )
      .join("\n\n");
    parts.push(section("Build sequence", p));
  }

  const ui = spec.ui_plan;
  const dl = ui.design_language;
  const uiParts = [
    `_Design language:_ ${dl.hero_pattern} · ${dl.glass_tier} · ${dl.density} · ${dl.motion_intent} · ${dl.accent_intent}`,
    ui.screens.length
      ? `\n_Screens:_\n${ui.screens
          .map(
            (s) =>
              `- **${s.name}** — ${s.purpose}${
                s.states.length ? ` _(states: ${s.states.join(", ")})_` : ""
              }`,
          )
          .join("\n")}`
      : "",
    ui.component_inventory.length
      ? `\n_Components:_ ${ui.component_inventory.join(", ")}`
      : "",
    ui.reduction_log.length ? `\n_Reduction:_\n${bullets(ui.reduction_log)}` : "",
    ui.inspiration_cues.length
      ? `\n_From inspiration:_\n${bullets(ui.inspiration_cues)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  parts.push(section("UI plan", uiParts));

  if (spec.risks.length) parts.push(section("Risks", bullets(spec.risks)));
  if (spec.open_questions.length)
    parts.push(section("Open questions", bullets(spec.open_questions)));

  return parts.filter(Boolean).join("\n");
}
