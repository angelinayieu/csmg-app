// ── useConvergeResult ──────────────────────────────────────────────
//
// Detects the brainstorm-speedrun convergence summary on a synergy
// whiteboard and parses its cluster payload into a typed shape that
// downstream surfaces (cluster overlay, dimming, CTA, camera fit)
// can read without re-implementing the meta-parsing dance.
//
// Trigger condition:
//   A `kind: "ranking"` node whose `meta` JSON has `kind: "converge"`.
//   This is what /api/synergy/sessions/[id]/autopilot/round writes
//   when the converge round runs (Wave 2 — commit 73ed469). Each
//   cluster carries name + pitch + member_node_ids + effort + impact
//   + novelty + scope_cut + recommended.
//
// The hook scans `nodes` on every change and memoizes the result.
// When no converge summary exists, returns null (visual layer treats
// null as "nothing to render"). When multiple summaries exist (e.g.,
// the user re-ran converge), the MOST RECENT one wins — same
// behavior as the rest of the speedrun (latest takes over).
//
// Wave 3 (cinematic close):
//   3.2 SynergyClusterOverlay reads `result.clusters` to draw bbox
//   3.3 SynergyNode dimming reads `result.deferredMemberIds`
//   3.4 "Build prototype →" CTA anchors to `result.recommendedCentroid`
//   3.5 Camera fit-to-recommended uses `result.recommendedBbox`

import { useMemo } from "react";
import type { ClientNode } from "@/lib/synergy/types";

export type ClusterEffort = "light" | "medium" | "heavy";

export interface ConvergeCluster {
  name: string;
  pitch: string;
  member_node_ids: string[];
  effort: ClusterEffort;
  impact: number; // 1-10
  novelty: number; // 1-10
  scope_cut: string;
  recommended: boolean;
}

export interface ConvergeMetaPayload {
  kind: "converge";
  clusters: ConvergeCluster[];
  recommendation_rationale: string;
  generatedAt: string;
}

/** Bbox in canvas (world) coordinates. matches the layout-helpers
 *  Bbox type but inlined here so consumers don't have to import. */
export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ConvergeResult {
  /** The summary node itself — kind="ranking", meta JSON parsed. */
  summaryNodeId: string;
  /** Raw parsed payload. */
  payload: ConvergeMetaPayload;
  /** Convenience views computed once for downstream consumers. */
  recommended: ConvergeCluster | null;
  /** Member IDs of the recommended cluster, as a Set for O(1) lookup. */
  recommendedMemberIds: Set<string>;
  /** Member IDs of ALL non-recommended clusters merged. */
  deferredMemberIds: Set<string>;
  /** Bbox of the recommended cluster's member nodes (canvas coords). */
  recommendedBbox: Bbox | null;
  /** Centroid (canvas coords) of the recommended cluster — used to
   *  anchor the "Build prototype →" CTA. */
  recommendedCentroid: { x: number; y: number } | null;
  /** Per-cluster bbox in canvas coords, in payload order. Used by
   *  the cluster overlay to draw boundaries. */
  clusterBboxes: Array<{ cluster: ConvergeCluster; bbox: Bbox | null }>;
}

function tryParseConvergePayload(
  metaJson: string | undefined,
): ConvergeMetaPayload | null {
  if (!metaJson) return null;
  try {
    const obj = JSON.parse(metaJson);
    if (obj && obj.kind === "converge" && Array.isArray(obj.clusters)) {
      return obj as ConvergeMetaPayload;
    }
  } catch {
    // Malformed meta — treat as no converge result. Fail-safe so a
    // bad row doesn't crash the canvas.
  }
  return null;
}

function bboxOf(nodes: ClientNode[]): Bbox | null {
  if (nodes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, minY, maxX, maxY };
}

export function useConvergeResult(
  nodes: ClientNode[],
): ConvergeResult | null {
  return useMemo(() => {
    // Find the most-recent ranking-kind node whose meta parses as a
    // converge payload. "Most recent" = whatever appears latest in
    // the nodes array (server already orders by created_at ascending,
    // so the last match is newest).
    let summaryNodeId: string | null = null;
    let payload: ConvergeMetaPayload | null = null;
    for (const n of nodes) {
      if (n.kind !== "ranking") continue;
      const parsed = tryParseConvergePayload(n.meta);
      if (parsed) {
        summaryNodeId = n.id;
        payload = parsed;
      }
    }
    if (!summaryNodeId || !payload) return null;

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const recommended =
      payload.clusters.find((c) => c.recommended) ?? null;

    const recommendedMemberIds = new Set<string>(
      recommended ? recommended.member_node_ids : [],
    );
    const deferredMemberIds = new Set<string>();
    for (const c of payload.clusters) {
      if (c === recommended) continue;
      for (const id of c.member_node_ids) deferredMemberIds.add(id);
    }

    const recommendedMembers = recommended
      ? recommended.member_node_ids
          .map((id) => nodeById.get(id))
          .filter((n): n is ClientNode => n !== undefined)
      : [];
    const recommendedBbox = bboxOf(recommendedMembers);
    const recommendedCentroid = recommendedBbox
      ? {
          x: (recommendedBbox.minX + recommendedBbox.maxX) / 2,
          y: (recommendedBbox.minY + recommendedBbox.maxY) / 2,
        }
      : null;

    const clusterBboxes = payload.clusters.map((cluster) => {
      const members = cluster.member_node_ids
        .map((id) => nodeById.get(id))
        .filter((n): n is ClientNode => n !== undefined);
      return { cluster, bbox: bboxOf(members) };
    });

    return {
      summaryNodeId,
      payload,
      recommended,
      recommendedMemberIds,
      deferredMemberIds,
      recommendedBbox,
      recommendedCentroid,
      clusterBboxes,
    };
  }, [nodes]);
}
