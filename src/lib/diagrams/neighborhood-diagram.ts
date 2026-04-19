import { toNodeId, escapeLabel } from "./shared";

export interface NeighborhoodDiagramInput {
  /** Focal entity — rendered center, emphasized. */
  focal: { entity_id: string; name: string };
  /** Entities that have edges pointing INTO focal (with relationship label). */
  upstream: Array<{ entity_id: string; name: string; relationship: string }>;
  /** Entities that have edges pointing OUT from focal (with relationship label). */
  downstream: Array<{ entity_id: string; name: string; relationship: string }>;
  /** Cap per direction (default 6) — prevents unreadable diagrams for hubs. */
  perDirectionLimit?: number;
}

/**
 * Render an entity's immediate neighborhood as a Mermaid flowchart:
 *
 *     upstream-a ─relationship─▶ FOCAL ─relationship─▶ downstream-a
 *     upstream-b ─relationship─▶        ─relationship─▶ downstream-b
 *
 * Focal node is emphasized (blue fill, thick border). Upstream and downstream
 * nodes are grouped visually via subgraphs so the flow reads cleanly even when
 * the neighborhood is dense.
 */
export function generateNeighborhoodDiagram(input: NeighborhoodDiagramInput): string {
  const limit = input.perDirectionLimit ?? 6;
  const upstream = (input.upstream ?? []).slice(0, limit);
  const downstream = (input.downstream ?? []).slice(0, limit);

  const lines: string[] = [];
  lines.push("graph LR");

  // Caption
  lines.push(`  title["Neighborhood of ${escapeLabel(input.focal.name)}"]`);
  lines.push("  style title fill:#ffffff,stroke:#ffffff,color:#556479,font-size:11px");

  // Focal node
  const focalId = toNodeId(input.focal.entity_id);
  lines.push(`  ${focalId}[("${escapeLabel(input.focal.name)}")]`);
  lines.push(`  style ${focalId} fill:#eef4ff,stroke:#0a6aee,stroke-width:3px,color:#0a1020`);

  // Upstream subgraph
  if (upstream.length > 0) {
    lines.push(`  subgraph up["Upstream"]`);
    for (const u of upstream) {
      const nid = toNodeId(u.entity_id);
      lines.push(`    ${nid}["${escapeLabel(u.name)}"]`);
    }
    lines.push("  end");
    lines.push(`  style up fill:#f9fafb,stroke:#e5e7eb,stroke-dasharray:3 3,color:#6b7280`);
  }

  // Downstream subgraph
  if (downstream.length > 0) {
    lines.push(`  subgraph down["Downstream"]`);
    for (const d of downstream) {
      const nid = toNodeId(d.entity_id);
      lines.push(`    ${nid}["${escapeLabel(d.name)}"]`);
    }
    lines.push("  end");
    lines.push(`  style down fill:#f9fafb,stroke:#e5e7eb,stroke-dasharray:3 3,color:#6b7280`);
  }

  // Edges — upstream → focal
  for (const u of upstream) {
    const nid = toNodeId(u.entity_id);
    const label = u.relationship ? `|${escapeLabel(u.relationship)}|` : "";
    lines.push(`  ${nid} -->${label} ${focalId}`);
  }

  // Edges — focal → downstream
  for (const d of downstream) {
    const nid = toNodeId(d.entity_id);
    const label = d.relationship ? `|${escapeLabel(d.relationship)}|` : "";
    lines.push(`  ${focalId} -->${label} ${nid}`);
  }

  // Neighbor tints — subtle gray so focal pops
  for (const u of upstream) {
    lines.push(`  style ${toNodeId(u.entity_id)} fill:#ffffff,stroke:#9ca3af,color:#374151`);
  }
  for (const d of downstream) {
    lines.push(`  style ${toNodeId(d.entity_id)} fill:#ffffff,stroke:#9ca3af,color:#374151`);
  }

  return lines.join("\n");
}
