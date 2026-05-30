// ── UI skill system loader ────────────────────────────────────────
//
// Loads the 6-file `UI agent /` skill pack at the repo root and
// concatenates it into ONE system-prompt prefix that gets prepended
// to the mechanism-spec generator's system message.
//
// Why a prefix (not a sibling block):
//   • OpenAI's strict-mode `json_schema` path uses automatic prompt
//     caching that keys off the message PREFIX. Putting the heavy,
//     stable skill text FIRST in `system` lets the second + later
//     generations in the same session pay the cache-hit rate.
//   • The cost matters: the pack is ~19K input tokens. First call
//     pays full price; subsequent calls within the cache window are
//     ~90% cheaper.
//
// Why lazy + cached:
//   • Reading 6 files synchronously every generation would waste IO
//     on each call.
//   • Async at module scope is awkward — Promise-cache pattern is
//     the standard fix (mirrors `intersection-insights.ts` style).
//
// Why soft-fail per file:
//   • If a file is missing in production (e.g. not bundled into the
//     serverless function), we still want the generator to run —
//     just without the UI design rigor. The skill pack is an
//     enrichment, not a hard dependency.
//
// Production note: `process.cwd()` is the deployment root in
// Next.js. On Vercel the `UI agent /` dir must be in
// `outputFileTracingIncludes` (next.config) OR bundled adjacent to
// this file. If both fail, this loader returns "" and the generator
// runs with only the in-line SYSTEM_PROMPT — degraded but functional.
//
// Reference: MECHANISM_EXPERIENCE_SPEC.md §2c (UI agent as system prompt).

import fs from "node:fs/promises";
import path from "node:path";

// Order matters — SKILL.md introduces the framework, the rest
// elaborate. Concatenated in this order so the LLM reads the
// scaffold before the details.
const SKILL_FILES = [
  "SKILL.md",
  "human-centered-ui.skill",
  "cognitive-principles.md",
  "reduction-operator.md",
  "app-type-playbooks.md",
  "accessibility-and-states.md",
] as const;

const SKILL_DIR = "UI agent "; // trailing space is intentional — matches repo dir name

let _cached: Promise<string> | null = null;

/**
 * Lazy-load the UI skill pack as a single concatenated string.
 *
 * Returns "" when no files could be read (missing dir, missing files,
 * permission errors). Callers should fall back to skill-less generation
 * — never throw.
 */
export function loadUiSkillSystem(): Promise<string> {
  if (_cached) return _cached;

  _cached = (async () => {
    const root = process.cwd();
    const dir = path.join(root, SKILL_DIR);

    const blocks: string[] = [];
    for (const name of SKILL_FILES) {
      try {
        const filePath = path.join(dir, name);
        const content = await fs.readFile(filePath, "utf8");
        const trimmed = content.trim();
        if (trimmed.length === 0) continue;
        blocks.push(`<<< ${name} >>>\n${trimmed}`);
      } catch {
        // Soft-fail per file. One missing file should not kill the
        // whole pack — and the whole pack missing should not kill
        // mechanism-spec generation.
      }
    }

    if (blocks.length === 0) return "";

    // Wrap the whole thing in a clear demarcation so the model
    // treats it as guidance, not as an instruction to obey
    // verbatim (e.g. it should NOT think a `## Steps` heading in
    // SKILL.md is a step it must take RIGHT NOW).
    return [
      "── UI DESIGN SKILL PACK (REFERENCE — apply the principles, do NOT echo) ──",
      "",
      "The following pages describe a human-centered UI design framework",
      "(cognitive-load theory, MoSCoW reduction, app-type playbooks,",
      "accessibility, and reduction operator). Use them as background",
      "thinking when you fill the `runtime_flow[].visual_intent`,",
      "`runtime_flow[].interaction_sketch`, and `design_intent` fields.",
      "DO NOT echo or restate the pack in your output.",
      "",
      blocks.join("\n\n"),
      "",
      "── END UI DESIGN SKILL PACK ──",
      "",
    ].join("\n");
  })();

  return _cached;
}

/**
 * Test-only — drop the cache so a unit test can force a re-load.
 * Never call from production code.
 */
export function __resetUiSkillCacheForTests(): void {
  _cached = null;
}
