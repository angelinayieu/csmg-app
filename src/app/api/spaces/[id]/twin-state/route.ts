// GET /api/spaces/[id]/twin-state
//
// Phase A1.4c — returns the CURRENT twin state for a space so the
// universal asset catalog can surface it as a draggable "snapshot"
// asset. Unlike /api/twin/preview (which computes a twin under a
// proposed strategy), this endpoint computes the unperturbed current
// state — what the twin looks like right now.
//
// Heavy compute (reads entities + edges + cycles + synthesis + active
// goal), so the catalog caches by spaceId. Subsequent library opens
// are instant; the catalog's refresh API re-computes when the user
// invalidates.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { TwinMacroState } from "@/types/twin";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface TwinStateResponse {
  twin: TwinMacroState;
  /** ISO timestamp when this state was computed — snapshots use it. */
  computed_at: string;
  /** Space name at compute time so the snapshot card can label itself. */
  space_name: string;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, entRes, edgeRes, cycleRes, goalRes] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;

  // synthesis_data may be a JSON string or already an object depending
  // on the driver; handle both.
  let synthesisData: SynthesisData | null = null;
  const raw = (space as unknown as { synthesis_data?: unknown }).synthesis_data ?? null;
  if (raw && typeof raw === "object") {
    synthesisData = raw as SynthesisData;
  } else if (typeof raw === "string") {
    try {
      synthesisData = JSON.parse(raw) as SynthesisData;
    } catch {
      synthesisData = null;
    }
  }

  const state = computeTwinState(
    space,
    entities,
    edges,
    cycles,
    synthesisData,
    activeGoal,
  );

  const payload: TwinStateResponse = {
    twin: state.macro,
    computed_at: new Date().toISOString(),
    space_name: space.name,
  };
  return NextResponse.json(payload);
}
