// ── Cross-room findings prompt block ───────────────────────────────
//
// K2 Wire 4 — renders the space's cached cross-room findings (themes /
// recurring mechanisms / orphan annotations) as a compact block the
// room generation prompts read. Designed for SHORT inclusion — only
// the signal density that actually changes what the LLM should emit.
//
// Extracted to a lib (Arc 3.6) so BOTH the one-shot /room/generate and
// the second-phase /room/[subId]/mechanisms endpoint build the same
// RoomContext from one source — no drift.
//
// Skipped entirely when no analysis cache exists (first room in a
// space) or when only Tier 1 findings exist that don't matter for
// generation (e.g., low-severity orphans).

import type { CrossRoomAnalysisState } from "./analyses/types";

export function buildCrossRoomFindingsBlock(
  analysis: CrossRoomAnalysisState | null,
): string {
  if (!analysis || !Array.isArray(analysis.findings)) return "";
  const live = analysis.findings.filter((f) => f.disposition !== "dismissed");
  if (live.length === 0) return "";

  // Themes — load-bearing recurring concepts.
  const themes = live
    .filter((f) => f.analysis_key === "distill_concepts")
    .slice(0, 3);
  // Recurring mechanisms — same lever in ≥2 rooms.
  const recurring = live
    .filter((f) => f.analysis_key === "shared_mechanisms")
    .slice(0, 4);
  // Orphan annotations — high-weight lens readings NO room derived
  // from. These are gap candidates the new room could fill.
  const orphans = live
    .filter(
      (f) =>
        f.analysis_key === "orphan_annotations" &&
        (f.severity === "high" || f.severity === "critical"),
    )
    .slice(0, 3);

  if (themes.length === 0 && recurring.length === 0 && orphans.length === 0) {
    return "";
  }

  const lines: string[] = [
    "CROSS-ROOM CONTEXT (what other rooms in this space have already produced — RESPECT, don't re-propose):",
  ];
  if (themes.length > 0) {
    lines.push("  Recurring themes:");
    for (const t of themes) {
      lines.push(`    • ${t.title}${t.summary ? ` — ${t.summary}` : ""}`);
    }
  }
  if (recurring.length > 0) {
    lines.push(
      "  Mechanisms already used in sibling rooms (don't redundantly re-design):",
    );
    for (const r of recurring) {
      lines.push(`    • ${r.title}`);
    }
  }
  if (orphans.length > 0) {
    lines.push(
      "  Parent-objective readings NO sibling room covers (gap-fill candidates if relevant):",
    );
    for (const o of orphans) {
      lines.push(`    • ${o.title}`);
    }
  }
  return `\n\n${lines.join("\n")}\n`;
}
