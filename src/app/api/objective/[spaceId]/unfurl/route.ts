// ── GET /api/objective/[spaceId]/unfurl ───────────────────────────
//
// Data for the "Open on whiteboard" depth-unfurl. Returns:
//   • canvas: a CanvasGraph (objective → layer bands → sub-objective nodes)
//     built DIRECTLY from improvement_goals.layer_ordinals + the
//     ObjectiveStack (synthesis_data.objective_canvas.layers). No heavy
//     MainCanvasSub assembly — just the node/band shape the renderer needs.
//   • room: the anchored sub-objective's raw lanes + edges (?room=subId),
//     which the client turns into a room graph via buildRoomGraph (that's a
//     client module, so we keep it off the server).
//
// Read-only; gated by space ownership.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  safeAuth,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { loadRoomData } from "@/lib/objective-canvas/load-room-data";
import type {
  CanvasGraph,
  CausalMapNode,
  CausalMapEdge,
  LayerBandSpec,
} from "@/components/objective/causal-map/lib/types";
import type {
  ObjectiveStack,
  ObjectiveLayer,
} from "@/lib/objective-canvas/layer-model";

export const runtime = "nodejs";
export const maxDuration = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }
  const isOwner = await verifySpaceOwnership(auth.supabase, spaceId, auth.user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const db = auth.supabase as AnyDb;
  const roomId = new URL(request.url).searchParams.get("room");

  try {
    // ── space: objective title + the layer stack ──
    const { data: space } = await db
      .from("spaces")
      .select("description, input_text, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const objectiveTitle =
      (typeof space?.description === "string" && space.description.trim()) ||
      (typeof space?.input_text === "string" && space.input_text.trim()) ||
      "Objective";
    const stack =
      (space?.synthesis_data?.objective_canvas?.layers as
        | ObjectiveStack
        | null
        | undefined) ?? null;

    // ── sub-objectives under the root goal ──
    const { data: rootRows } = await db
      .from("improvement_goals")
      .select("id")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const rootId =
      Array.isArray(rootRows) && rootRows.length > 0
        ? (rootRows[0].id as string)
        : null;

    let subRows: Array<{
      id: string;
      title: string;
      layer_ordinals: number[] | null;
    }> = [];
    if (rootId) {
      const { data } = await db
        .from("improvement_goals")
        .select("id, title, layer_ordinals")
        .eq("space_id", spaceId)
        .eq("parent_goal_id", rootId)
        .order("created_at", { ascending: true });
      subRows = (data ?? []) as typeof subRows;
    }

    // ── build the canvas graph directly ──
    const nodes: CausalMapNode[] = subRows.map((s) => ({
      id: s.id,
      type: "subObjective",
      position: { x: 0, y: 0 },
      data: {
        kind: "sub_objective",
        title: s.title || "Sub-objective",
        subtitle: null,
        layerOrdinals: Array.isArray(s.layer_ordinals) ? s.layer_ordinals : [],
        layerPositionLabel: null,
        healthBand: "unknown",
        approvedCount: 0,
        methodTier: null,
        href: `/app/objective/${spaceId}/sub/${s.id}`,
      },
    }));

    const usedOrdinals = new Set<number>();
    for (const n of nodes) {
      const o = n.data.layerOrdinals;
      if (o.length) usedOrdinals.add(Math.max(...o));
    }
    const layers: ObjectiveLayer[] = Array.isArray(stack?.layers)
      ? stack.layers
      : [];
    const bands: LayerBandSpec[] = layers.map((l) => ({
      ordinal: l.ordinal,
      id: `L${l.ordinal}`,
      name: l.name || `Layer ${l.ordinal}`,
      archetype: String(l.archetype ?? "mechanism"),
      y: 0,
      height: 0,
      uncovered: !usedOrdinals.has(l.ordinal),
    }));

    // Cross-room edges from the cached analysis — each finding that
    // references ≥2 rooms links those sub-objectives.
    const subIdSet = new Set(subRows.map((s) => s.id));
    const cra = (space?.synthesis_data?.cross_room_analysis ?? null) as {
      findings?: Array<{
        title?: string;
        references?: { room_ids?: string[] };
      }>;
    } | null;
    const edges: CausalMapEdge[] = [];
    const seenPair = new Set<string>();
    for (const f of cra?.findings ?? []) {
      const rids = (f.references?.room_ids ?? []).filter((id) =>
        subIdSet.has(id),
      );
      for (let i = 0; i < rids.length; i++) {
        for (let j = i + 1; j < rids.length; j++) {
          const key = [rids[i], rids[j]].sort().join("::");
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          edges.push({
            id: `x-${key}`,
            source: rids[i],
            target: rids[j],
            data: {
              kind: "cross_room",
              polarity: "neutral",
              strength: 0.5,
              label: f.title ?? null,
              source: "local",
            },
          });
        }
      }
    }

    const canvas: CanvasGraph = {
      nodes,
      edges,
      bands,
      hasLayerStack: bands.length > 0,
    };

    // ── anchored room: return raw lanes/edges for client buildRoomGraph ──
    let room: { lanes: unknown; edges: unknown } | null = null;
    let roomTitle = "Room";
    if (roomId) {
      const rd = await loadRoomData(db, {
        spaceId,
        subId: roomId,
        userId: auth.user.id,
      });
      if (rd) {
        roomTitle = rd.title ?? "Room";
        room = { lanes: rd.lanes, edges: rd.edges };
      }
    }

    return NextResponse.json({
      objectiveTitle,
      canvas,
      room,
      roomTitle,
      roomId,
    });
  } catch (err) {
    console.error("[objective/unfurl]", err);
    return NextResponse.json(
      { error: `Unfurl failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
