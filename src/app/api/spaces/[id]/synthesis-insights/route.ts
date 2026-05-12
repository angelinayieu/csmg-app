// GET /api/spaces/[id]/synthesis-insights
//
// Returns the bottleneck/leverage/risk insights from synthesis_data in a
// shape ready to spawn as synthesis-card tldraw shapes. Used by the
// canvas operational seed-spawner so users opening a space see the
// AMBIENT side-panel content as canvas cards (drag, connect, annotate)
// instead of just a sidebar list.
//
// Why a focused endpoint instead of extending /twin-state: keeps the
// response small (the full synthesis_data blob is multi-kb) and keeps
// the canvas-seeding contract narrow — change to seed shape props won't
// ripple through other twin-state consumers.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";

export const dynamic = "force-dynamic";

interface InsightEntry {
  entity_id: string;
  name: string;
  /** Short body for the card (1-2 sentences). Truncated server-side so
   *  the canvas rendering layer doesn't have to guess length. */
  body: string;
}

interface SynthesisInsightsResponse {
  bottleneck: InsightEntry | null;
  leverage_points: InsightEntry[];
  risk_points: InsightEntry[];
}

/** Card body cap. Synthesis cards have 3-line clamp; ~280 chars fits comfortably. */
const BODY_CAP = 280;

function clip(s: string | null | undefined): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.length <= BODY_CAP) return trimmed;
  return trimmed.slice(0, BODY_CAP - 1).trimEnd() + "…";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow } = (await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle()) as { data: { synthesis_data: unknown } | null };

  // Synthesis_data may be a JSON string or already an object depending on
  // the driver / write path. Handle both.
  let synth: SynthesisData | null = null;
  const raw = (spaceRow as { synthesis_data?: unknown } | null)?.synthesis_data ?? null;
  if (raw && typeof raw === "object") {
    synth = raw as SynthesisData;
  } else if (typeof raw === "string") {
    try {
      synth = JSON.parse(raw) as SynthesisData;
    } catch {
      synth = null;
    }
  }

  // Normalize each section. Each insight type carries different shapes
  // in synthesis_data; we collapse them to the common InsightEntry. Both
  // arrays are capped client-side (top-N by importance) but we send the
  // full set so the canvas can use whichever count the layout wants.
  const bottleneck: InsightEntry | null = synth?.master_bottleneck
    ? {
        entity_id: synth.master_bottleneck.entity_id ?? "",
        name:
          ((synth as unknown) as { master_bottleneck?: { entity_name?: string } })
            ?.master_bottleneck?.entity_name ??
          synth.master_bottleneck.entity_id ??
          "Master bottleneck",
        body: clip(synth.master_bottleneck.summary),
      }
    : null;

  const leverage_points: InsightEntry[] = (synth?.leverage_points ?? []).map(
    (lp) => ({
      entity_id: lp.entity_id ?? "",
      name: lp.entity_name ?? lp.entity_id ?? "Leverage point",
      body: clip(lp.summary),
    }),
  );

  const risk_points: InsightEntry[] = (synth?.risk_points ?? []).map((rp) => ({
    entity_id: rp.entity_id ?? "",
    name: rp.entity_name ?? rp.entity_id ?? "Risk point",
    body: clip(rp.summary),
  }));

  const payload: SynthesisInsightsResponse = {
    bottleneck,
    leverage_points,
    risk_points,
  };
  return NextResponse.json(payload);
}
