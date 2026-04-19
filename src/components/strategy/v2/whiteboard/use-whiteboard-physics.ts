"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type {
  WhiteboardNode,
  WhiteboardEdge,
  WhiteboardLayer,
  PinnedPosition,
} from "@/types/whiteboard";
import { LAYER_Y, LAYER_ORDER } from "./layers";

export { LAYER_Y, LAYER_ORDER };

interface UsePhysicsArgs {
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
  width: number;
  pins: Record<string, PinnedPosition>;
  hiddenLayers: Set<WhiteboardLayer>;
}

/**
 * d3-force simulation — each node snaps to its layer's Y line,
 * spreads horizontally, and collides with neighbors on a rectangular-aware radius.
 *
 * Tuning (revised):
 *   - forceY strength 0.95 → nearly rigid layer-snap (was 0.7, which let links fight it)
 *   - forceCollide radius 115 → accounts for node width (180px) so adjacent nodes don't overlap
 *   - forceLink strength 0.03 → edges are visual hints only, they don't pull layers apart
 */
export function useWhiteboardPhysics({
  nodes,
  edges,
  width,
  pins,
  hiddenLayers,
}: UsePhysicsArgs) {
  const simNodesRef = useRef<WhiteboardNode[]>([]);
  const simulationRef = useRef<d3.Simulation<WhiteboardNode, undefined> | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    // Seed each node's initial position from its pin (if any) or spread near its layer's Y
    const sim: WhiteboardNode[] = nodes.map((n, i) => {
      const pin = pins[n.id];
      // Spread initial X based on index within the layer for a less clumpy first frame
      const sameLayer = nodes.filter((x) => x.layer === n.layer);
      const idxInLayer = sameLayer.findIndex((x) => x.id === n.id);
      const count = Math.max(sameLayer.length, 1);
      const initialX = width / 2 + ((idxInLayer - (count - 1) / 2) * 210);
      return {
        ...n,
        x: pin?.x ?? initialX + (Math.random() - 0.5) * 20,
        y: pin?.y ?? LAYER_Y[n.layer] + (Math.random() - 0.5) * 16,
        fx: pin?.x ?? null,
        fy: pin?.y ?? null,
      };
    });
    simNodesRef.current = sim;

    // Only edges between visible nodes
    const visibleNodeIds = new Set(
      sim.filter((n) => !hiddenLayers.has(n.layer)).map((n) => n.id)
    );
    const simEdges = edges
      .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));

    const simulation = d3
      .forceSimulation<WhiteboardNode>(sim)
      // Strong layer-snap — each node anchored to its layer's center line
      .force(
        "y",
        d3.forceY<WhiteboardNode>((d) => LAYER_Y[d.layer]).strength(0.95)
      )
      // Weak horizontal centering — keeps nodes from drifting off-canvas
      .force("x", d3.forceX<WhiteboardNode>(width / 2).strength(0.08))
      // Collision — 115px radius covers node half-widths (90px pill) + margin
      .force(
        "collide",
        d3.forceCollide<WhiteboardNode>(115).strength(1).iterations(3)
      )
      // Very weak link force — links are a visual hint, not a constraint
      .force(
        "link",
        d3
          .forceLink(simEdges)
          .id((d) => (d as WhiteboardNode).id)
          .distance(180)
          .strength(0.03)
      )
      .alpha(0.9)
      .alphaDecay(0.03)
      .velocityDecay(0.4)
      .on("tick", () => forceRender((t) => t + 1));

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, hiddenLayers]);

  // React to pin changes without full re-init
  useEffect(() => {
    const sim = simNodesRef.current;
    let changed = false;
    for (const n of sim) {
      const pin = pins[n.id];
      if (pin) {
        if (n.fx !== pin.x || n.fy !== pin.y) {
          n.fx = pin.x;
          n.fy = pin.y;
          changed = true;
        }
      } else if (n.fx != null || n.fy != null) {
        n.fx = null;
        n.fy = null;
        changed = true;
      }
    }
    if (changed && simulationRef.current) {
      simulationRef.current.alpha(0.35).restart();
    }
  }, [pins]);

  const pinDuringDrag = (id: string, x: number, y: number) => {
    const n = simNodesRef.current.find((s) => s.id === id);
    if (!n) return;
    n.fx = x;
    n.fy = y;
    if (simulationRef.current) simulationRef.current.alphaTarget(0.3).restart();
  };

  const endDrag = () => {
    if (simulationRef.current) simulationRef.current.alphaTarget(0);
  };

  return {
    nodes: simNodesRef.current,
    pinDuringDrag,
    endDrag,
    restart: () => {
      if (simulationRef.current) simulationRef.current.alpha(0.6).restart();
    },
  };
}
