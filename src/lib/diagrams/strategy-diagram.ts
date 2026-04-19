import { toNodeId, escapeLabel } from "./shared";

export interface StrategyDiagramInput {
  /** L4 atomic insights — foundational observations. */
  l4: Array<{ id: string; insight: string }>;
  /** L3 reasoning units — logical connectives built on L4. */
  l3: Array<{ id: string; logic_statement: string; enhanced_by_l4?: string[] }>;
  /** L2 method chains — approaches justified by L3. */
  l2: Array<{ id: string; title: string; justified_by_l3?: string[] }>;
  /** L1 outcomes — end targets served by L2. */
  l1: Array<{ id: string; outcome: string; served_by_l2?: string[] }>;
}

const LAYER_STYLES = {
  L4: { fill: "#f0f9ff", stroke: "#0ea5e9", label: "L4 · Insights" },
  L3: { fill: "#eef4ff", stroke: "#6366f1", label: "L3 · Reasoning" },
  L2: { fill: "#faf5ff", stroke: "#8b5cf6", label: "L2 · Methods" },
  L1: { fill: "#fdf4ff", stroke: "#d946ef", label: "L1 · Outcomes" },
} as const;

/**
 * Render the L4→L1 strategy reasoning stack as Mermaid source.
 *
 * Bottom-to-top flow (L4 foundations → L1 outcomes) using subgraphs
 * for each layer. Cross-layer edges follow the data's explicit links
 * (enhanced_by_l4 / justified_by_l3 / served_by_l2) when present,
 * falling back to a simple "each → all" fan if the links are missing.
 */
export function generateStrategyDiagram(input: StrategyDiagramInput): string {
  const lines: string[] = [];
  lines.push("graph BT");

  // Empty-state safety
  const totalNodes =
    (input.l1?.length ?? 0) +
    (input.l2?.length ?? 0) +
    (input.l3?.length ?? 0) +
    (input.l4?.length ?? 0);
  if (totalNodes === 0) {
    lines.push('  empty["No strategy layers yet"]');
    return lines.join("\n");
  }

  // Declare nodes inside subgraph shells, one per layer
  const declareLayer = (
    layerKey: keyof typeof LAYER_STYLES,
    items: Array<{ id: string; label: string }>,
  ) => {
    if (items.length === 0) return;
    const style = LAYER_STYLES[layerKey];
    lines.push(`  subgraph ${layerKey}["${style.label}"]`);
    for (const item of items) {
      lines.push(`    ${toNodeId(item.id)}["${escapeLabel(item.label)}"]`);
    }
    lines.push("  end");
    lines.push(`  style ${layerKey} fill:${style.fill},stroke:${style.stroke},color:#1a2740`);
  };

  declareLayer(
    "L4",
    (input.l4 ?? []).map((x) => ({ id: x.id, label: x.insight })),
  );
  declareLayer(
    "L3",
    (input.l3 ?? []).map((x) => ({ id: x.id, label: x.logic_statement })),
  );
  declareLayer(
    "L2",
    (input.l2 ?? []).map((x) => ({ id: x.id, label: x.title })),
  );
  declareLayer(
    "L1",
    (input.l1 ?? []).map((x) => ({ id: x.id, label: x.outcome })),
  );

  // Cross-layer links (use explicit references where given)
  const ids = {
    l4: new Set((input.l4 ?? []).map((x) => x.id)),
    l3: new Set((input.l3 ?? []).map((x) => x.id)),
    l2: new Set((input.l2 ?? []).map((x) => x.id)),
    l1: new Set((input.l1 ?? []).map((x) => x.id)),
  };

  // L4 → L3 (L3.enhanced_by_l4)
  for (const l3 of input.l3 ?? []) {
    const supports = l3.enhanced_by_l4 ?? [];
    if (supports.length > 0) {
      for (const l4id of supports) {
        if (ids.l4.has(l4id)) {
          lines.push(`  ${toNodeId(l4id)} --> ${toNodeId(l3.id)}`);
        }
      }
    }
  }
  // L3 → L2 (L2.justified_by_l3)
  for (const l2 of input.l2 ?? []) {
    const supports = l2.justified_by_l3 ?? [];
    if (supports.length > 0) {
      for (const l3id of supports) {
        if (ids.l3.has(l3id)) {
          lines.push(`  ${toNodeId(l3id)} --> ${toNodeId(l2.id)}`);
        }
      }
    }
  }
  // L2 → L1 (L1.served_by_l2)
  for (const l1 of input.l1 ?? []) {
    const supports = l1.served_by_l2 ?? [];
    if (supports.length > 0) {
      for (const l2id of supports) {
        if (ids.l2.has(l2id)) {
          lines.push(`  ${toNodeId(l2id)} --> ${toNodeId(l1.id)}`);
        }
      }
    }
  }

  return lines.join("\n");
}
