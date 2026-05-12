// ── Synergy radial-tree layout ──
//
// Used by the "Tidy up" toolbar action to reflow a tangled board into
// a clean radial tree. Each node's parent angular slice is divided
// evenly among its children. Returns a Map keyed by node id.
//
// Ported from idea-synthesizer's Whiteboard.tsx:radialTreeLayout.
// Pure function — operates on the node list, doesn't touch state.

import type { ClientNode } from "./types";

export function radialTreeLayout(
  nodes: ClientNode[],
  centerX = 600,
  centerY = 360,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  // Legacy "user"-kind nodes (spoken transcripts) aren't visible; skip
  // them so they don't distort the layout. New sessions never produce
  // them, but old sessions might still have them on disk.
  const visible = nodes.filter((n) => n.kind !== "user");
  if (visible.length === 0) return positions;

  const root = visible.find((n) => n.kind === "core") ?? visible[0];
  positions.set(root.id, { x: centerX, y: centerY });

  const byParent = new Map<string, ClientNode[]>();
  for (const n of visible) {
    if (n.parent && n.parent !== n.id) {
      const list = byParent.get(n.parent) ?? [];
      list.push(n);
      byParent.set(n.parent, list);
    }
  }

  // Ring radii expand more aggressively for higher depths so labels fit.
  const depthRadius = (depth: number) => 220 + (depth - 1) * 200;

  const place = (
    parentId: string,
    parentX: number,
    parentY: number,
    minAngle: number,
    maxAngle: number,
    depth: number,
  ): void => {
    const children = byParent.get(parentId) ?? [];
    if (children.length === 0) return;
    const slice = (maxAngle - minAngle) / children.length;
    children.forEach((child, i) => {
      const a = minAngle + slice * (i + 0.5);
      const r = depthRadius(depth);
      const x = parentX + Math.cos(a) * r;
      const y = parentY + Math.sin(a) * r;
      positions.set(child.id, { x, y });
      const margin = Math.min(slice * 0.05, 0.05);
      place(child.id, x, y, a - slice / 2 + margin, a + slice / 2 - margin, depth + 1);
    });
  };

  place(root.id, centerX, centerY, -Math.PI, Math.PI, 1);

  // Orphans (no parent, not the root): drop them in a tidy column on
  // the right edge so they're not lost but don't crowd the tree.
  let orphanRow = 0;
  for (const n of visible) {
    if (positions.has(n.id)) continue;
    positions.set(n.id, { x: centerX + 900, y: 200 + orphanRow * 90 });
    orphanRow++;
  }
  return positions;
}

// ── Spiral-out placement for new children ──
//
// Packs siblings into rings of 6 around a parent, with each subsequent
// ring pushed further out. Used when the AI emits new nodes or when
// the user adds a node from the right-rail panel.
export function placeNear(
  parent: ClientNode | undefined,
  index: number,
  total: number,
  baseRadius = 200,
): { x: number; y: number } {
  const cx = parent?.x ?? 600;
  const cy = parent?.y ?? 360;
  const slotsPerRing = 6;
  const ring = Math.floor(index / slotsPerRing);
  const slotInRing = index % slotsPerRing;
  const slotsThisRing = ring === 0 ? Math.min(total, slotsPerRing) : slotsPerRing;
  // Rotate each ring slightly so slots don't stack radially with the prior ring.
  const angle =
    (slotInRing / Math.max(slotsThisRing, 1)) * Math.PI * 2 - Math.PI / 2 + ring * 0.35;
  const radius = baseRadius + ring * 130;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
