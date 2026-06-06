// ── shadcn-skill loader ───────────────────────────────────────────
//
// Loads our distilled shadcn vocabulary primer from `shadcn /SKILL.md`.
// This is NOT the official shadcn MCP server — that runs as a subprocess
// (`npx shadcn@latest mcp`) and requires a tool-use loop in the Anthropic
// API call, which our prototype generator doesn't have. Deferred to T2
// when prototypes start emitting real React.
//
// What this DOES give us, today, at zero per-call cost beyond input tokens:
//   - The canonical 56 primitive names (so Opus doesn't invent components)
//   - Variant + size enums per component (so Opus doesn't hallucinate props)
//   - Composition patterns (Dialog / Card / Form / etc.)
//   - The CSS-variable + cn() + cva() DNA
//   - HTML/CSS-side patterns (radii, borders, focus rings) — so even our
//     T0/T1 HTML output reads as "shadcn idiom" without needing React
//
// Precedence in the prototype prompt (lowest → highest):
//   1. UI agent skill         (cognitive principles)
//   2. frontend-design skill  (anti-slop floor)
//   3. shadcn primer          (component vocabulary)
//   4. project SYSTEM         (TASTE_RULE + BASE_RULES)
//   5. tailwind.config.ts     (brand tokens, in user message)
//   6. DESIGN.md              (space's taste contract, in user message)
//
// Soft-fail: missing file → "" (the generator still runs).

import fs from "node:fs/promises";
import path from "node:path";

const SKILL_DIR = "shadcn "; // trailing space — matches dir name
const SKILL_FILE = "SKILL.md";

let _cached: Promise<string> | null = null;

/** Lazy-load the shadcn primer as a wrapped system-prompt block. */
export function loadShadcnSkill(): Promise<string> {
  if (_cached) return _cached;
  _cached = (async () => {
    try {
      const filePath = path.join(process.cwd(), SKILL_DIR, SKILL_FILE);
      const raw = await fs.readFile(filePath, "utf8");
      const trimmed = raw.trim();
      if (!trimmed) return "";
      return [
        "── SHADCN VOCABULARY PRIMER (component names + composition DNA) ──",
        "",
        "The following is a primer of the canonical 56 shadcn/ui primitives",
        "and their composition patterns. Use it as your VOCABULARY when you",
        "need a component name, variant, or compound API — never invent.",
        "When emitting HTML/CSS (not React), mirror the visual DNA: rounded-md",
        "corners, hairline borders, ghost variants, focus rings.",
        "Do NOT echo or restate the primer in your output.",
        "",
        trimmed,
        "",
        "── END SHADCN VOCABULARY PRIMER ──",
        "",
      ].join("\n");
    } catch {
      return "";
    }
  })();
  return _cached;
}

/** Test-only — drop the cache so a unit test can force a re-load. */
export function __resetShadcnSkillCacheForTests(): void {
  _cached = null;
}
