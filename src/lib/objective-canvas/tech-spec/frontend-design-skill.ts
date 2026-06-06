// ── frontend-design-skill loader ──────────────────────────────────
//
// Loads Anthropic's official `frontend-design` skill from `frontend-design /`
// at repo root (same `<dir> /` convention as `UI agent /`). Vendored verbatim
// from anthropics/skills@main — see frontend-design /LICENSE.txt.
//
// The skill is small (~4KB SKILL.md) and value-dense: it forces an explicit
// aesthetic commitment before coding, bans the common "AI slop" clichés
// (Inter / Roboto / purple-gradient / Space-Grotesk convergence), and pushes
// for distinctive type + motion + spatial composition.
//
// Precedence in the prototype prompt:
//   1. DESIGN.md (the space's taste contract)  — WINS when present
//   2. tailwind.config.ts (brand tokens)        — WINS when present
//   3. UI agent skill (cognitive principles)    — applies always
//   4. frontend-design skill (anti-slop floor)  — applies always
//
// When DESIGN.md exists, the project's committed taste overrides
// frontend-design's "pick something distinctive" directive — we already
// committed. When DESIGN.md is empty (thin substrate), the skill is the
// quality floor.
//
// Soft-fail: missing file → "" (the generator still runs, just without the
// floor). The skill is an enrichment, not a hard dependency.

import fs from "node:fs/promises";
import path from "node:path";

const SKILL_DIR = "frontend-design "; // trailing space — matches dir name
const SKILL_FILE = "SKILL.md";

let _cached: Promise<string> | null = null;

/** Lazy-load the frontend-design SKILL.md as a wrapped system-prompt block. */
export function loadFrontendDesignSkill(): Promise<string> {
  if (_cached) return _cached;
  _cached = (async () => {
    try {
      const filePath = path.join(process.cwd(), SKILL_DIR, SKILL_FILE);
      const raw = await fs.readFile(filePath, "utf8");
      const trimmed = raw.trim();
      if (!trimmed) return "";
      return [
        "── FRONTEND-DESIGN SKILL (Anthropic, vendored — apply, do NOT echo) ──",
        "",
        "The following is Anthropic's official `frontend-design` skill. It is",
        "an anti-cliche QUALITY FLOOR. When a DESIGN.md block is also present",
        "above, the project's committed taste OVERRIDES this skill's",
        "'pick distinctive fonts/aesthetics' directive — we have already",
        "chosen. When no DESIGN.md is present, this skill IS the design.",
        "Do NOT echo or restate the skill in your output.",
        "",
        trimmed,
        "",
        "── END FRONTEND-DESIGN SKILL ──",
        "",
      ].join("\n");
    } catch {
      return "";
    }
  })();
  return _cached;
}

/** Test-only — drop the cache so a unit test can force a re-load. */
export function __resetFrontendDesignSkillCacheForTests(): void {
  _cached = null;
}
