import { toNodeId, escapeLabel } from "./shared";

export interface CascadeDiagramInput {
  /** The entity whose failure is being simulated. */
  source_entity_id: string;
  source_entity_name?: string;
  /** Overall blast radius (0–1) — displayed as a caption. */
  blast_radius?: number;
  /** Entities impacted by the failure, with hops from source + impact severity. */
  affected: Array<{
    entity_id: string;
    name?: string;
    /** 1, 2, 3, … — number of hops from the source. */
    distance: number;
    /** "high" | "medium" | "low" | string — drives color. */
    impact?: string;
  }>;
}

/**
 * Render a cascade failure diagram as Mermaid source.
 *
 * Layout: source at the left, entities grouped into ranks by distance,
 * color-coded by impact severity (red → amber → gray as severity drops).
 *
 * Uses subgraphs as visual "rings" of distance. Edges go from source
 * to distance-1 directly; distance-N entities connect to the nearest
 * lower rank so the flow stays legible for larger cascades.
 */
export function generateCascadeDiagram(input: CascadeDiagramInput): string {
  const sourceId = toNodeId(input.source_entity_id);
  const sourceName = input.source_entity_name || input.source_entity_id;

  const lines: string[] = [];
  lines.push("graph LR");

  // Title / blast radius caption
  const radius =
    typeof input.blast_radius === "number"
      ? ` · blast radius ${(input.blast_radius * 100).toFixed(0)}%`
      : "";
  lines.push(`  title["Cascade failure${radius}"]`);
  lines.push("  style title fill:#ffffff,stroke:#ffffff,color:#556479,font-size:11px");

  // Source node
  lines.push(`  ${sourceId}["${escapeLabel(sourceName)}"]`);
  lines.push(`  style ${sourceId} fill:#fef2f2,stroke:#ef4444,stroke-width:3px,color:#991b1b`);

  // Group affected entities by distance
  const byDistance = new Map<number, CascadeDiagramInput["affected"]>();
  for (const a of input.affected) {
    const d = Math.max(1, a.distance | 0);
    if (!byDistance.has(d)) byDistance.set(d, []);
    byDistance.get(d)!.push(a);
  }
  const distances = [...byDistance.keys()].sort((a, b) => a - b);

  // Track node ids at each distance so we can chain from one rank to the next
  const idsByDistance = new Map<number, string[]>();

  for (const d of distances) {
    const group = byDistance.get(d)!;
    const groupIds: string[] = [];

    lines.push(`  subgraph hop_${d}["hop ${d}"]`);
    for (const a of group) {
      const nid = toNodeId(a.entity_id);
      groupIds.push(nid);
      lines.push(`    ${nid}["${escapeLabel(a.name ?? a.entity_id)}"]`);

      // Impact-driven color
      const impact = (a.impact ?? "").toLowerCase();
      if (impact === "high" || impact === "critical") {
        lines.push(`    style ${nid} fill:#fff1f2,stroke:#e11d48,color:#9f1239`);
      } else if (impact === "medium" || impact === "moderate") {
        lines.push(`    style ${nid} fill:#fffbeb,stroke:#f59e0b,color:#92400e`);
      } else {
        lines.push(`    style ${nid} fill:#f9fafb,stroke:#9ca3af,color:#374151`);
      }
    }
    lines.push("  end");
    lines.push(`  style hop_${d} fill:#f9fafb,stroke:#e5e7eb,stroke-dasharray:3 3,color:#6b7280`);

    idsByDistance.set(d, groupIds);
  }

  // Edges: source → distance-1 entities
  const firstHop = idsByDistance.get(distances[0]) ?? [];
  for (const nid of firstHop) {
    lines.push(`  ${sourceId} --> ${nid}`);
  }

  // Edges between ranks: round-robin pair distance-(k-1) → distance-k so
  // higher distances don't all dangle off one upstream node. Good enough
  // for small/medium cascades — more accurate wiring would require the
  // caller to pass explicit parent links.
  for (let i = 1; i < distances.length; i++) {
    const prev = idsByDistance.get(distances[i - 1]) ?? [];
    const curr = idsByDistance.get(distances[i]) ?? [];
    if (prev.length === 0 || curr.length === 0) continue;
    for (let j = 0; j < curr.length; j++) {
      const upstream = prev[j % prev.length];
      lines.push(`  ${upstream} --> ${curr[j]}`);
    }
  }

  return lines.join("\n");
}
