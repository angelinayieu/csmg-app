import { toNodeId, escapeLabel } from "./shared";
import type { SubComponent, InternalPathway, InternalDynamic } from "@/types/expansion";

export interface ExpansionDiagramInput {
  /** Parent entity being decomposed (renders as a title caption). */
  parent_name: string;
  sub_components: SubComponent[];
  internal_pathways: InternalPathway[];
  internal_dynamics?: InternalDynamic[];
}

/**
 * Render an entity's internal structure (sub-components + internal pathways)
 * as a Mermaid flowchart.
 *
 * This is the "inside a node" view — the Tier-3 decomposition from the
 * expansion engine. Nodes are sub-components; edges are the pathways
 * between them with mechanism labels.
 *
 * Styling:
 *   - Importance drives border weight: critical=3px, important=2px, moderate=1.2px, minor=0.8px
 *   - component_type drives color: gate (purple), metric (teal), milestone (blue),
 *     condition (amber), process (green), variable (gray), capability (indigo)
 *   - Pathway edges carry the mechanism as label
 *   - dynamics=conditional → dotted edge
 *   - dynamics=probabilistic → dashed edge
 *   - Sub-components involved in a bottleneck get a red stroke; feedback_loop gets
 *     a blue stroke; gate gets a purple stroke (on top of component_type fill)
 */
export function generateExpansionDiagram(input: ExpansionDiagramInput): string {
  const lines: string[] = [];
  lines.push("graph LR");

  // Title / caption
  if (input.parent_name) {
    lines.push(`  title["Inside: ${escapeLabel(input.parent_name)}"]`);
    lines.push("  style title fill:#ffffff,stroke:#ffffff,color:#556479,font-size:11px");
  }

  if (!input.sub_components || input.sub_components.length === 0) {
    lines.push("  empty[\"No sub-components yet\"]");
    return lines.join("\n");
  }

  // Nodes
  for (const sc of input.sub_components) {
    const nid = toNodeId(sc.id);
    const label = sc.name + (sc.probability != null ? ` (${Math.round(sc.probability * 100)}%)` : "");
    lines.push(`  ${nid}["${escapeLabel(label)}"]`);
  }

  // Type-driven colors (ring / fill)
  const typeColors: Record<string, { fill: string; stroke: string; color: string }> = {
    milestone: { fill: "#eef4ff", stroke: "#0a6aee", color: "#0a1020" },
    capability: { fill: "#eef2ff", stroke: "#6366f1", color: "#312e81" },
    condition: { fill: "#fffbeb", stroke: "#f59e0b", color: "#92400e" },
    metric: { fill: "#ecfeff", stroke: "#06b6d4", color: "#155e75" },
    process: { fill: "#ecfdf5", stroke: "#10b981", color: "#065f46" },
    variable: { fill: "#f9fafb", stroke: "#9ca3af", color: "#374151" },
    gate: { fill: "#faf5ff", stroke: "#8b5cf6", color: "#5b21b6" },
  };

  // Importance → stroke width modifier
  const importanceWidth: Record<string, string> = {
    critical: "3px",
    important: "2px",
    moderate: "1.2px",
    minor: "0.8px",
  };

  for (const sc of input.sub_components) {
    const nid = toNodeId(sc.id);
    const type = (sc.component_type || "").toLowerCase();
    const colors = typeColors[type] ?? typeColors.variable;
    const strokeWidth = importanceWidth[sc.importance] ?? "1.2px";
    lines.push(
      `  style ${nid} fill:${colors.fill},stroke:${colors.stroke},stroke-width:${strokeWidth},color:${colors.color}`,
    );
  }

  // Edges — pathways carry mechanism as label
  for (const pw of input.internal_pathways ?? []) {
    const from = toNodeId(pw.source_id);
    const to = toNodeId(pw.target_id);
    const edgeLabel = pw.mechanism
      ? `|${escapeLabel(pw.mechanism.slice(0, 40))}|`
      : "";

    // Dynamics drives edge style
    let edgeOp = "-->";
    if (pw.dynamics === "conditional") edgeOp = "-.->";
    else if (pw.dynamics === "probabilistic") edgeOp = "==>";

    lines.push(`  ${from} ${edgeOp}${edgeLabel} ${to}`);
  }

  // Internal-dynamics emphasis — overlays stroke color on involved components.
  // Bottleneck = red, feedback_loop = blue, gate = purple, amplifier = amber, decay = slate.
  const dynamicStroke: Record<string, string> = {
    bottleneck: "#ef4444",
    feedback_loop: "#0a6aee",
    gate: "#8b5cf6",
    amplifier: "#f59e0b",
    decay: "#64748b",
  };
  for (const dyn of input.internal_dynamics ?? []) {
    const stroke = dynamicStroke[dyn.type];
    if (!stroke) continue;
    for (const cid of dyn.component_ids ?? []) {
      const nid = toNodeId(cid);
      // Use a class-style dupe — mermaid 11 accepts repeat `style` statements,
      // the last one wins for conflicting props. This preserves the fill from
      // the component_type styling and only overrides stroke + width.
      lines.push(`  style ${nid} stroke:${stroke},stroke-width:2.5px,stroke-dasharray:4 2`);
    }
  }

  return lines.join("\n");
}
