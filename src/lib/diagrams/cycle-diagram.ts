import { toNodeId, escapeLabel } from "./shared";

export interface CycleDiagramInput {
  name: string;
  /** "reinforcing_positive" | "reinforcing_negative" | "balancing" | other strings */
  classification?: string | null;
  /** Ordered entity sequence forming the loop — closing arc is drawn back to entity_ids[0]. */
  entity_ids: string[];
  /** Optional display names per entity_id — falls back to the id. */
  entity_names?: Record<string, string>;
  /** Optional intervention point — the entity_id where leverage sits. */
  intervention_entity_id?: string | null;
}

/**
 * Render a causal loop diagram (CLD) as Mermaid source.
 *
 * Classification drives arrow shape + node color:
 *   - reinforcing_positive  → solid arrows, green tint
 *   - reinforcing_negative  → solid arrows, red tint
 *   - balancing             → dashed last edge, amber tint
 *
 * The intervention point gets a thick stroke so users can see where
 * to act on the loop.
 */
export function generateCycleDiagram(input: CycleDiagramInput): string {
  const ids = (input.entity_ids ?? []).filter(Boolean);
  if (ids.length < 2) {
    // Degenerate input — emit a tiny placeholder so the diagram surface
    // doesn't show a generic "parse error". One node, no edges.
    const single = ids[0] ?? "cycle";
    return `graph LR\n  ${toNodeId(single)}["${escapeLabel(single)}"]\n`;
  }

  const classification = (input.classification ?? "").toLowerCase();
  const isBalancing = classification.includes("balancing");
  const isNegative = classification.includes("negative");

  const edgeOp = "-->";
  const closingEdgeOp = isBalancing ? "-.->|balancing|" : edgeOp;

  const lines: string[] = [];
  lines.push("graph LR");

  // Title node (small caption above the cycle)
  lines.push(
    `  title["${escapeLabel(input.name || "Feedback loop")}${
      classification ? ` · ${classification.replace(/_/g, " ")}` : ""
    }"]`,
  );
  lines.push("  style title fill:#ffffff,stroke:#ffffff,color:#556479,font-size:11px");

  // Nodes
  const nodeIds: string[] = [];
  for (const rawId of ids) {
    const nid = toNodeId(rawId);
    nodeIds.push(nid);
    const label = input.entity_names?.[rawId] ?? rawId;
    lines.push(`  ${nid}["${escapeLabel(label)}"]`);
  }

  // Forward edges
  for (let i = 0; i < nodeIds.length - 1; i++) {
    lines.push(`  ${nodeIds[i]} ${edgeOp} ${nodeIds[i + 1]}`);
  }

  // Closing arc (last → first) — the edge that makes it a cycle
  lines.push(`  ${nodeIds[nodeIds.length - 1]} ${closingEdgeOp} ${nodeIds[0]}`);

  // Styling
  const tint = isBalancing ? "#fff7ed" : isNegative ? "#fef2f2" : "#ecfdf5";
  const stroke = isBalancing ? "#f59e0b" : isNegative ? "#ef4444" : "#10b981";
  for (const nid of nodeIds) {
    lines.push(`  style ${nid} fill:${tint},stroke:${stroke},stroke-width:1.2px`);
  }

  // Intervention point emphasis
  if (input.intervention_entity_id) {
    const iid = toNodeId(input.intervention_entity_id);
    if (nodeIds.includes(iid)) {
      lines.push(`  style ${iid} stroke-width:3px,stroke:#0a6aee,fill:#eef4ff`);
    }
  }

  return lines.join("\n");
}
