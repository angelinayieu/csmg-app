// Structured cross-space context builder — Gap 10
// Replaces flat concatenation with per-space attribution and bridge sections

import type { Entity, Edge, Cycle } from "@/types";

export interface SpaceContext {
  spaceId: string;
  name: string;
  description: string;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  entityLines: string[];
  edgeLines: string[];
  cycleLines: string[];
  metaSection: string;
}

interface Bridge {
  sourceSpaceId: string;
  targetSpaceId: string;
  sourceEntityId: string;
  targetEntityId: string;
  reasoning?: string;
}

/**
 * Build structured cross-space context with per-space attribution.
 * When multiple spaces are analyzed, the LLM needs to know which space
 * each finding comes from so it can cite sources in its synthesis.
 */
export function buildCrossSpaceContext(
  spaceContexts: SpaceContext[],
  bridges: Bridge[] = [],
): string {
  if (spaceContexts.length <= 1) {
    // Single space — use existing flat format
    const ctx = spaceContexts[0];
    if (!ctx) return "";
    return (
      `=== SPACE: ${ctx.name} ===\n` +
      `${ctx.description}\n` +
      `Stats: ${ctx.entities.length} entities, ${ctx.edges.length} edges, ${ctx.cycles.length} cycles\n\n` +
      `ENTITIES (${ctx.entities.length}):\n${ctx.entityLines.join("\n")}\n\n` +
      `RELATIONSHIPS (${ctx.edges.length}):\n${ctx.edgeLines.join("\n")}\n\n` +
      `FEEDBACK CYCLES (${ctx.cycles.length}):\n${ctx.cycleLines.join("\n")}` +
      ctx.metaSection
    );
  }

  // ── Multi-space: structured per-space sections ──
  const sections: string[] = [];

  // Build name map for bridge resolution
  const spaceNames = new Map<string, string>();
  for (const ctx of spaceContexts) {
    spaceNames.set(ctx.spaceId, ctx.name);
  }

  for (const ctx of spaceContexts) {
    const section =
      `=== SPACE: "${ctx.name}" (${ctx.entities.length} entities, ${ctx.edges.length} edges, ${ctx.cycles.length} cycles) ===\n` +
      `${ctx.description}\n\n` +
      `ENTITIES:\n${ctx.entityLines.join("\n")}\n\n` +
      `RELATIONSHIPS:\n${ctx.edgeLines.join("\n")}\n\n` +
      `FEEDBACK CYCLES:\n${ctx.cycleLines.join("\n")}` +
      ctx.metaSection;

    sections.push(section);
  }

  // ── Cross-space bridges section ──
  if (bridges.length > 0) {
    const bridgeLines = bridges.map((b) => {
      const srcSpace = spaceNames.get(b.sourceSpaceId) ?? "?";
      const tgtSpace = spaceNames.get(b.targetSpaceId) ?? "?";
      const reason = b.reasoning ? `: ${b.reasoning}` : "";
      return `  [${srcSpace}] ${b.sourceEntityId} ↔ [${tgtSpace}] ${b.targetEntityId}${reason}`;
    });

    sections.push(
      `=== CROSS-SPACE BRIDGES (${bridges.length}) ===\n` +
      `These connections link entities across different analytical spaces:\n` +
      bridgeLines.join("\n")
    );
  }

  // ── Attribution instruction ──
  sections.push(
    `--- CROSS-SPACE ANALYSIS INSTRUCTION ---\n` +
    `When a finding draws from multiple spaces, cite which space(s) informed it.\n` +
    `When leverage/risk in one space affects another space, explicitly note the cross-space impact.\n` +
    `Look for emergent properties that only appear when viewing multiple spaces together.`
  );

  return sections.join("\n\n" + "─".repeat(60) + "\n\n");
}
