import { toNodeId, escapeLabel } from "./shared";

export interface PathDiagramInput {
  /** Ordered sequence of entities along the path (2+ entries). */
  path: Array<{ entity_id: string; name?: string }>;
  /**
   * Ordered edge labels between adjacent path entries.
   * edges[i] describes path[i] → path[i+1].
   * Length must be path.length - 1, but we tolerate under/over and fill/truncate.
   */
  edges: Array<{ relationship_type?: string }>;
  /** Optional 1-sentence summary shown as a caption. */
  interpretation?: string;
}

/**
 * Render a linear causal chain as Mermaid source.
 *
 * Left-to-right flow, labeled edges (using the relationship_type),
 * start node emphasized in green, end node in blue. If the chain is
 * long (>6 entities), Mermaid will still render it — we just let
 * horizontal scrolling handle overflow in the MermaidDiagram shell.
 */
export function generatePathDiagram(input: PathDiagramInput): string {
  const path = (input.path ?? []).filter((p) => p && p.entity_id);
  if (path.length < 2) {
    const single = path[0]?.entity_id ?? "path";
    return `graph LR\n  ${toNodeId(single)}["${escapeLabel(path[0]?.name ?? single)}"]\n`;
  }

  const lines: string[] = [];
  lines.push("graph LR");

  if (input.interpretation) {
    lines.push(`  title["${escapeLabel(input.interpretation)}"]`);
    lines.push("  style title fill:#ffffff,stroke:#ffffff,color:#556479,font-size:11px");
  }

  // Nodes
  const ids = path.map((p) => toNodeId(p.entity_id));
  for (let i = 0; i < path.length; i++) {
    lines.push(`  ${ids[i]}["${escapeLabel(path[i].name ?? path[i].entity_id)}"]`);
  }

  // Edges with labels
  for (let i = 0; i < path.length - 1; i++) {
    const rel = input.edges?.[i]?.relationship_type;
    const label = rel ? `|${escapeLabel(rel)}|` : "";
    lines.push(`  ${ids[i]} -->${label} ${ids[i + 1]}`);
  }

  // Emphasize endpoints
  lines.push(`  style ${ids[0]} fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#065f46`);
  lines.push(`  style ${ids[ids.length - 1]} fill:#eef4ff,stroke:#0a6aee,stroke-width:2px,color:#0a1020`);

  return lines.join("\n");
}
