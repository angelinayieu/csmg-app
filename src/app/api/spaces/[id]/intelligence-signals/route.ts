// GET /api/spaces/[id]/intelligence-signals
//
// Phase A1.4b — surfaces the external-world signals embedded in a
// space's `synthesis_data.intelligence_radar.signals` so the universal
// asset catalog can expose them as draggable flags. Signals are what
// the radar / weave layer picked up from outside the space (new
// external entities, authority changes, new bridges, etc.).
//
// Like axioms, signals live inside synthesis_data — they're ephemeral
// records keyed by signal id. The library captures a frozen copy on
// drop so the whiteboard reading survives later synthesis passes.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { IntelligenceSignal } from "@/types/intelligence";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface IntelligenceSignalsResponse {
  signals: IntelligenceSignal[];
  /** True when synthesis_data.intelligence_radar was present + parseable. */
  radar_present: boolean;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = (await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: { synthesis_data: unknown } | null;
    error: unknown;
  };

  if (error) {
    console.error("[space intelligence-signals] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch synthesis_data" },
      { status: 500 },
    );
  }

  let synthesis: Record<string, unknown> | null = null;
  const raw = data?.synthesis_data ?? null;
  if (raw && typeof raw === "object") {
    synthesis = raw as Record<string, unknown>;
  } else if (typeof raw === "string") {
    try {
      synthesis = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      synthesis = null;
    }
  }

  const radar = synthesis?.intelligence_radar as
    | { signals?: unknown[] }
    | undefined;
  const rawSignals = radar?.signals;
  const signals: IntelligenceSignal[] = Array.isArray(rawSignals)
    ? (rawSignals as IntelligenceSignal[]).filter(
        (s): s is IntelligenceSignal =>
          !!s &&
          typeof s === "object" &&
          typeof (s as IntelligenceSignal).id === "string" &&
          typeof (s as IntelligenceSignal).description === "string",
      )
    : [];

  const payload: IntelligenceSignalsResponse = {
    signals,
    radar_present: !!radar,
  };
  return NextResponse.json(payload);
}
