"use client";

// ── WhiteboardClusterZone ──
//
// Soft-blurred colored backgrounds behind each layer group. Gives the
// canvas visual rhythm without forcing hard boundaries. Each zone is
// computed from the bounding box of the nodes in that layer.

import React from "react";
import type { LayerConfig } from "@/lib/whiteboard/layer-config";

export interface ClusterZoneData {
  layerId: string;
  layer: LayerConfig;
  // Bounding box (min corner + size)
  x: number;
  y: number;
  width: number;
  height: number;
  // How many entities are in this zone (for optional label)
  entityCount: number;
}

interface Props {
  zone: ClusterZoneData;
  showLabel?: boolean;
}

export function WhiteboardClusterZone({ zone, showLabel = true }: Props) {
  const padding = 60; // soft halo extends beyond bounding box

  return (
    <>
      {/* Blurred colored blob */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: zone.x - padding,
          top: zone.y - padding,
          width: zone.width + padding * 2,
          height: zone.height + padding * 2,
          background: zone.layer.zone,
          borderRadius: 40,
          filter: "blur(50px)",
          opacity: 0.55,
          zIndex: 0,
        }}
      />
      {/* Optional layer label — faint text at top-left */}
      {showLabel && (
        <div
          className="absolute pointer-events-none font-bold tracking-widest uppercase select-none"
          style={{
            left: zone.x - 50,
            top: zone.y + 12,
            fontSize: 8,
            color: "rgba(10,30,80,0.22)",
            letterSpacing: "0.16em",
            zIndex: 1,
          }}
        >
          {zone.layer.shortLabel} · {zone.layer.label}
          <span
            className="ml-2 font-mono"
            style={{ color: "rgba(10,30,80,0.13)" }}
          >
            ({zone.entityCount})
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Compute cluster zones from node positions grouped by layer.
 * Returns one ClusterZoneData per layer that has any nodes.
 */
export function computeClusterZones(
  nodesByLayer: Map<string, Array<{ x: number; y: number; width: number; height: number }>>,
  layerConfigs: Record<string, LayerConfig>,
): ClusterZoneData[] {
  const zones: ClusterZoneData[] = [];
  for (const [layerId, nodes] of nodesByLayer.entries()) {
    if (nodes.length === 0) continue;
    const layer = layerConfigs[layerId];
    if (!layer) continue;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    zones.push({
      layerId,
      layer,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      entityCount: nodes.length,
    });
  }
  return zones;
}
