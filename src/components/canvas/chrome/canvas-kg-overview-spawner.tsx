"use client";

// ── Canvas KG-overview spawner ──────────────────────────────────
//
// For research-template-seeded spaces (manual_authoring_enabled),
// spawns ONE compact KGFormationShape on the whiteboard summarizing
// the seeded knowledge graph. Replaces the previous approach of
// painting every entity as a kg-node card — which produced a 76-card
// flat row that crashed tldraw on pan/zoom and hid the actual graph
// structure.
//
// The KGFormationShape renders:
//   • Header: "Knowledge Graph formation" + count chip
//   • Mini SVG graph: top 6 hub circles connected by REAL edges
//   • Footer: "N entities · M edges"
//
// One shape, one connected mini-graph, no overflow. Users browse the
// full entity list via /app/space/[id]/entities; they explore
// connected structure inside a subject's lab chamber. The whiteboard
// surfaces a single visual summary, not the entire KG.
//
// Idempotent: shape id is deterministic per space; existing-shape
// check skips re-spawning if user already has one. Wrapped in a
// try/catch so a failure here can't crash the canvas.

import { useEffect } from "react";
import { createShapeId, useEditor } from "tldraw";
import {
  computeHubsFromGraph,
  HUB_TOP_N,
  type Hub,
} from "@/lib/graph/hub-discovery";
import type { Entity, Edge } from "@/types";

const POLL_DELAY_MS = 600;
const SHAPE_W = 380;
const SHAPE_H = 300;

// Position: top-center of the workspace at y=0 so the default
// tldraw camera (centered on origin) lands the user directly on
// this card. Subject cards sit below at y=350. Two-rail layout:
// "this is your KG" up top, "click a subject to enter the lab"
// underneath. Both fit in a single viewport on a typical desktop.
const KG_OVERVIEW_Y = 0;

interface KgOverviewSpawnerProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
}

export function CanvasKgOverviewSpawner({
  spaceId,
  entities,
  edges,
}: KgOverviewSpawnerProps) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    if (entities.length === 0) return;

    let cancelled = false;

    const t = setTimeout(() => {
      if (cancelled) return;
      try {
        // Skip if a kg-formation shape already exists on this canvas
        // (from a previous mount or tldraw persistence restoration).
        const existing = editor
          .getCurrentPageShapes()
          .filter((s) => s.type === "kg-formation");
        if (existing.length > 0) return;

        // Compute hubs deterministically from the seed entities/edges.
        // computeHubsFromGraph is the same helper the live event
        // painter uses incrementally — keeps "what's a hub" consistent
        // across pipeline-driven and template-seeded surfaces.
        const result = computeHubsFromGraph(
          entities.map((e) => ({ id: e.id, name: e.name })),
          edges.map((e) => ({
            source_entity_id: e.source_entity_id,
            target_entity_id: e.target_entity_id,
          })),
          HUB_TOP_N,
        );

        // Real edges between visible hubs only — drives the connector
        // lines in the mini-graph. Skipping orientation: we treat
        // the graph as undirected for hub-pair existence.
        const hubNames = new Set(result.hubs.map((h) => h.name));
        const hubByEntityId = new Map<string, string>();
        for (const h of result.hubs) {
          hubByEntityId.set(h.entityId, h.name);
        }
        const hubEdges = new Set<string>();
        for (const e of edges) {
          const aName = hubByEntityId.get(e.source_entity_id);
          const bName = hubByEntityId.get(e.target_entity_id);
          if (!aName || !bName || aName === bName) continue;
          if (!hubNames.has(aName) || !hubNames.has(bName)) continue;
          // Canonical key: alphabetical so undirected dedupes.
          const key = aName < bName ? `${aName}|${bName}` : `${bName}|${aName}`;
          hubEdges.add(key);
        }
        const hubEdgePairs = Array.from(hubEdges).map((k) => {
          const [a, b] = k.split("|");
          return { a, b };
        });

        const shapeId = createShapeId(`kg-overview-${spaceId}`);
        editor.createShapes([
          {
            id: shapeId,
            type: "kg-formation",
            x: -SHAPE_W / 2, // center horizontally on origin
            y: KG_OVERVIEW_Y,
            props: {
              w: SHAPE_W,
              h: SHAPE_H,
              entityCount: result.entityCount,
              edgeCount: result.edgeCount,
              hubCount: result.hubCount,
              hubsJson: JSON.stringify(
                result.hubs.map((h: Hub) => ({
                  name: h.name,
                  degree: h.degree,
                })),
              ),
              hubEdgesJson: JSON.stringify(hubEdgePairs),
              pulse: 0,
              accent: "#7C3AED", // purple, matches cognition template
            },
          },
        ]);
      } catch (err) {
        console.warn(
          "[kg-overview-spawner] createShapes failed:",
          err,
        );
      }
    }, POLL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // entities/edges are large arrays; using length as a stable
    // dependency proxy avoids re-spawning on every reference change.
  }, [editor, spaceId, entities.length, edges.length]);

  return null;
}
