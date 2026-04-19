/**
 * Format interaction metadata into a concise context block for the synthesis LLM.
 * Keeps token count manageable by only including actionable signals.
 */

import type { InteractionMetadata } from "@/types/interactions";

export function formatInteractionsForLLM(meta: InteractionMetadata): string {
  const parts: string[] = [];

  // ── Top influence drivers ──
  const topDrivers = meta.fields
    .filter((f) => f.field_strength >= 0.3)
    .slice(0, 6);

  if (topDrivers.length > 0) {
    const driverLines = topDrivers.map((f) => {
      const amp = f.amplification_factor > 1 ? ` [AMPLIFIED x${f.amplification_factor}]` : "";
      const auto = f.autonomy_ratio > 2 ? " (driver)" : f.autonomy_ratio < 0.5 ? " (driven)" : "";
      const topTargets = f.top_influences
        .slice(0, 3)
        .map((inf) => {
          const sign = inf.net_influence > 0 ? "+" : "";
          return `${inf.target_entity_id}(${sign}${inf.net_influence}, ${inf.pathway})`;
        })
        .join(", ");
      return `  ${f.entity_id}: strength=${f.field_strength}, reach=${f.field_reach}${amp}${auto} → ${topTargets}`;
    });
    parts.push(`INTERACTION FIELDS (top influence drivers):\n${driverLines.join("\n")}`);
  }

  // ── Strategic corridors ──
  const topCorridors = meta.strategic_corridors.slice(0, 5);
  if (topCorridors.length > 0) {
    const corridorLines = topCorridors.map((c) => {
      const amp = c.amplified ? " [CYCLE-AMPLIFIED]" : "";
      const bn = c.bottleneck_at ? ` (bottleneck: ${c.bottleneck_at})` : "";
      return `  ${c.path.join(" → ")} [${c.polarity}, strength=${c.total_strength}${amp}${bn}]`;
    });
    parts.push(`STRATEGIC CORRIDORS (high-influence paths):\n${corridorLines.join("\n")}`);
  }

  // ── Field intersections ──
  if (meta.intersections.length > 0) {
    const intLines = meta.intersections.slice(0, 5).map((int) => {
      return `  ${int.entity_a_id} ∩ ${int.entity_b_id} [${int.classification}]: ${int.overlap_entities.join(", ")} — ${int.insight}`;
    });
    parts.push(`FIELD INTERSECTIONS (where influence zones overlap):\n${intLines.join("\n")}`);
  }

  // ── Tension zones ──
  if (meta.tension_zones.length > 0) {
    const tzLines = meta.tension_zones.slice(0, 4).map((tz) => {
      return `  ${tz.entity_id} (${tz.entity_name}): pulled by ${tz.positive_drivers.join(",")}(+) vs ${tz.negative_drivers.join(",")}(−), tension=${tz.tension_magnitude}`;
    });
    parts.push(`TENSION ZONES (entities under opposing forces):\n${tzLines.join("\n")}`);
  }

  if (parts.length === 0) return "";
  return "\n\n" + parts.join("\n\n");
}
