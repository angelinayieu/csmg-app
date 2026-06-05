// ── compose-section-ops — inline ops on a TechSpec section ───────────
//
// Server-only. Backs three inline ops the user can fire on a selected piece
// of text inside a section of the expanded tech-spec card:
//
//   • ask         — answer a question about the selection / section
//   • variations  — propose 2–3 alternative formulations of the selection
//   • improve     — a concrete edit proposal (kept terse, ready to apply)
//
// Plus one feedback-loop op:
//
//   • refine      — rewrite the section, consuming its pending improvements
//                   and its prior versions. Returns the NEW value typed for
//                   that section (string / string[] / structured object).
//
// All four use Opus via getAnthropicClient + the UI agent skill. The route
// wraps these in instrumentedLLMCall.

import { getAnthropicClient } from "@/lib/anthropic";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { loadUiSkillSystem } from "@/lib/objective-canvas/ui-skill-system";
import { extractJSON, repairAndExtractJSON } from "@/lib/web-search";
import type { TechSpec } from "./types";
import {
  SECTION_LABEL,
  getSectionValue,
  sectionToText,
  type TechSpecSectionId,
} from "./sections";

const OPUS_MODEL = BEST_CLAUDE_MODEL;

export type SectionOpKind = "ask" | "variations" | "improve";

const OP_SYSTEM: Record<SectionOpKind, string> = {
  ask:
    "You are a senior product/eng reviewer answering a SPECIFIC question " +
    "the user asked about a section of a technical spec. Be direct. Cite " +
    "the spec — don't invent. If the section doesn't answer it, say so and " +
    "name what's missing. Plain prose, 2–4 short paragraphs max. No headings.",
  variations:
    "You are a senior product/eng reviewer proposing 2–3 ALTERNATIVE " +
    "formulations of the selected text within the spec's section. Each " +
    "variation must be a real change in approach / tone / scope — not a " +
    "synonym swap. Number them 1., 2., 3. For each: one short sentence of " +
    "the tradeoff in parentheses after the variation. No preamble.",
  improve:
    "You are a senior product/eng reviewer proposing ONE concrete " +
    "improvement to the selected text within its section. Be a precise edit " +
    "proposal: state the new wording (or new bullets / new schema), then " +
    "one line WHY (\"because …\"). Lead with the edit; keep total length under " +
    "120 words. Do NOT propose multiple options — one decisive improvement.",
};

interface SectionOpArgs {
  spec: TechSpec;
  sectionId: TechSpecSectionId;
  /** The text the user selected inside the section. May be empty if they
   *  fired the op without selecting (treat as whole-section). */
  selection: string;
  /** For ask: the user's question. For variations/improve: any free-text
   *  intent the user typed (often empty — the selection IS the intent). */
  prompt: string;
}

async function opusText(system: string, user: string, max = 1500): Promise<string> {
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: max,
      system: uiSkillPrefix + "\n\n" + system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 3 * 60 * 1000 },
  );
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();
}

/** Single user-message builder shared by ask / variations / improve. */
function buildSectionUserMessage(args: SectionOpArgs): string {
  const sectionText = sectionToText(args.spec, args.sectionId);
  const selection = args.selection.trim();
  const promptLine = args.prompt.trim();
  const lines: string[] = [];
  lines.push(`SPEC TITLE: ${args.spec.title}`);
  lines.push(`OVERVIEW: ${args.spec.overview || "(none)"}`);
  lines.push("");
  lines.push(`SECTION: ${SECTION_LABEL[args.sectionId]}`);
  lines.push(sectionText || "(empty section)");
  lines.push("");
  if (selection) {
    lines.push("SELECTED TEXT (inside the section):");
    lines.push(selection);
    lines.push("");
  }
  if (promptLine) {
    lines.push("USER MESSAGE:");
    lines.push(promptLine);
  }
  return lines.join("\n");
}

export async function composeSectionOp(
  kind: SectionOpKind,
  args: SectionOpArgs,
): Promise<string> {
  const max = kind === "ask" ? 1200 : 900;
  return opusText(OP_SYSTEM[kind], buildSectionUserMessage(args), max);
}

// ── Refine ────────────────────────────────────────────────────────────

interface RefineSectionArgs {
  spec: TechSpec;
  sectionId: TechSpecSectionId;
  /** Pending improvements collected from inline-Improve outputs +
   *  attached feedback cards. Drained on refine. */
  pendingImprovements: Array<{ source: string; content: string }>;
  /** Past values of this section, oldest → newest. Helps the model avoid
   *  oscillating between revisions. */
  versionHistory: unknown[];
}

const REFINE_SYSTEM_BASE =
  "You are rewriting ONE section of a technical spec, applying a queue of " +
  "user-attached improvements. RULES: " +
  "1. Apply every pending improvement (or explicitly subsume it into a " +
  "stronger replacement — never silently drop one). " +
  "2. Preserve everything that was already correct unless an improvement " +
  "supersedes it. " +
  "3. Match the existing voice/density of the spec. No marketing fluff. " +
  "4. Do NOT change other sections — your output is JUST this section's " +
  "new value. " +
  "5. Return STRICT JSON matching the schema described below. No prose " +
  "outside the JSON.";

function refineSchemaHint(sectionId: TechSpecSectionId): string {
  switch (sectionId) {
    case "overview":
    case "problem":
      return '{ "value": "<one or two short paragraphs of plain text>" }';
    case "target_users":
    case "goals":
    case "success_metrics":
    case "non_goals":
    case "integrations":
    case "risks":
    case "open_questions":
      return '{ "value": ["<bullet>", "<bullet>", ...] }';
    case "architecture":
      return (
        '{ "value": { "summary": "...", "components": [{"name":"...","responsibility":"...","tech":"..."}], "layers": ["..."] } }'
      );
    case "data_model":
      return '{ "value": [{ "entity": "...", "fields": ["..."], "notes": "..." }] }';
    case "features":
      return '{ "value": [{ "name": "...", "description": "...", "components": ["..."], "acceptance_criteria": ["..."] }] }';
    case "build_phases":
      return '{ "value": [{ "phase": "...", "goal": "...", "deliverables": ["..."], "depends_on": ["..."], "acceptance_criteria": ["..."] }] }';
    case "ui_plan":
      return (
        '{ "value": { "design_language": {"glass_tier":"plate|card|float|hero","accent_intent":"signal|warning|growth|insight|neutral","density":"airy|comfortable|dense","motion_intent":"still|breathing|reveal|responsive","hero_pattern":"metric|flow|cycle|before_after|evidence|decision"}, "screens":[{"name":"...","purpose":"...","key_components":["..."],"states":["..."]}], "component_inventory":["..."], "interaction_notes":["..."], "reduction_log":["..."], "inspiration_cues":["..."] } }'
      );
  }
}

function buildRefineUserMessage(args: RefineSectionArgs): string {
  const lines: string[] = [];
  lines.push(`SPEC TITLE: ${args.spec.title}`);
  lines.push(`SECTION TO REFINE: ${SECTION_LABEL[args.sectionId]}`);
  lines.push("");
  lines.push("CURRENT SECTION VALUE (JSON):");
  lines.push(JSON.stringify(getSectionValue(args.spec, args.sectionId), null, 2));
  lines.push("");
  if (args.pendingImprovements.length) {
    lines.push("PENDING IMPROVEMENTS (apply ALL — never silently drop one):");
    args.pendingImprovements.forEach((imp, i) => {
      lines.push(`${i + 1}. [${imp.source}] ${imp.content}`);
    });
    lines.push("");
  }
  if (args.versionHistory.length) {
    lines.push(
      "PRIOR VERSIONS (oldest → newest, for context; do NOT oscillate back):",
    );
    args.versionHistory.slice(-3).forEach((v, i) => {
      lines.push(`v${i + 1}: ${JSON.stringify(v).slice(0, 800)}`);
    });
    lines.push("");
  }
  lines.push(`RETURN JSON shape: ${refineSchemaHint(args.sectionId)}`);
  return lines.join("\n");
}

export async function composeRefineSection(
  args: RefineSectionArgs,
): Promise<unknown> {
  const uiSkillPrefix = await loadUiSkillSystem();
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create(
    {
      model: OPUS_MODEL,
      max_tokens: 4000,
      system: uiSkillPrefix + "\n\n" + REFINE_SYSTEM_BASE,
      messages: [{ role: "user", content: buildRefineUserMessage(args) }],
    },
    { timeout: 4 * 60 * 1000 },
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
  if (!parsed || typeof parsed !== "object" || !("value" in parsed)) {
    throw new Error("refine returned no `value` field");
  }
  return (parsed as { value: unknown }).value;
}
