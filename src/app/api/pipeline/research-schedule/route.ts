import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { ResearchSchedule, IntelligenceRadarData, IntelligenceSignal } from "@/types/intelligence";
import { DEFAULT_RESEARCH_SCHEDULE } from "@/types/intelligence";

export const maxDuration = 10;

/**
 * GET /api/pipeline/research-schedule?spaceId=...
 *
 * Returns the current research schedule from synthesis_data.intelligence_radar
 *
 * POST /api/pipeline/research-schedule
 *
 * Updates the research schedule. Accepts partial schedule updates.
 * Computes next_run_at based on cadence.
 */

function computeNextRunAt(cadence: string, fromDate?: Date): string | null {
  const from = fromDate ?? new Date();
  switch (cadence) {
    case "daily":
      return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case "weekly":
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "biweekly":
      return new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    case "monthly":
      return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "manual":
    default:
      return null;
  }
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const { data: row } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const synthData = (row.synthesis_data ?? {}) as Record<string, unknown>;
  const radarData = synthData.intelligence_radar as IntelligenceRadarData | undefined;

  return NextResponse.json({
    schedule: radarData?.schedule ?? DEFAULT_RESEARCH_SCHEDULE,
    signals: radarData?.signals ?? [],
    last_snapshot: radarData?.last_snapshot ?? null,
    updated_at: radarData?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let scheduleUpdates: Partial<ResearchSchedule>;
  let signalUpdate: { signalId: string; status: string; note?: string } | null = null;
  let verdictUpdate: { signal_verdicts: unknown[]; entity_verdict_weights: unknown[] } | null = null;

  try {
    const body = await request.json();
    spaceId = body.spaceId;
    scheduleUpdates = body.schedule ?? {};
    signalUpdate = body.signalUpdate ?? null;
    verdictUpdate = body.verdictUpdate ?? null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Verify ownership
  const { data: row } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const synthData = (row.synthesis_data ?? {}) as Record<string, unknown>;
  const existingRadar = (synthData.intelligence_radar ?? {}) as Partial<IntelligenceRadarData>;
  const existingSchedule = existingRadar.schedule ?? DEFAULT_RESEARCH_SCHEDULE;
  let existingSignals = existingRadar.signals ?? [];

  // ── Handle signal status update ──
  if (signalUpdate) {
    const now = new Date().toISOString();
    existingSignals = existingSignals.map((sig) => {
      if (sig.id !== signalUpdate!.signalId) return sig;
      const updated = { ...sig, status: signalUpdate!.status as IntelligenceSignal["status"] };
      if (signalUpdate!.note) updated.user_note = signalUpdate!.note;
      if (signalUpdate!.status === "dismissed") updated.dismissed_at = now;
      if (signalUpdate!.status === "escalated") updated.escalated_at = now;
      if (signalUpdate!.status === "resolved") updated.resolved_at = now;
      return updated;
    });

    // If signal update with no schedule changes, write atomically (may include verdict)
    if (Object.keys(scheduleUpdates).length === 0) {
      const updatedRadar: IntelligenceRadarData = {
        schedule: existingSchedule,
        last_snapshot: existingRadar.last_snapshot ?? null,
        signals: existingSignals,
        updated_at: existingRadar.updated_at ?? new Date().toISOString(),
      };

      // Atomically write both radar + v2 verdicts if present
      const writePayload: Record<string, unknown> = {
        ...synthData,
        intelligence_radar: updatedRadar,
      };

      if (verdictUpdate) {
        const existingV2 = (synthData.intelligence_radar_v2 ?? {}) as Record<string, unknown>;
        writePayload.intelligence_radar_v2 = {
          ...existingV2,
          signal_verdicts: verdictUpdate.signal_verdicts,
          entity_verdict_weights: verdictUpdate.entity_verdict_weights,
        };
      }

      await db.from("spaces").update({
        synthesis_data: writePayload,
      }).eq("id", spaceId);

      return NextResponse.json({
        success: true,
        signalUpdated: signalUpdate.signalId,
        verdictUpdated: !!verdictUpdate,
      });
    }
  }

  // ── Handle verdict-only update (user feedback learning, no signal change) ──
  if (verdictUpdate && !signalUpdate && Object.keys(scheduleUpdates).length === 0) {
    const existingV2 = (synthData.intelligence_radar_v2 ?? {}) as Record<string, unknown>;
    const updatedV2 = {
      ...existingV2,
      signal_verdicts: verdictUpdate.signal_verdicts,
      entity_verdict_weights: verdictUpdate.entity_verdict_weights,
    };

    await db.from("spaces").update({
      synthesis_data: {
        ...synthData,
        intelligence_radar_v2: updatedV2,
      },
    }).eq("id", spaceId);

    return NextResponse.json({ success: true, verdictUpdated: true });
  }

  // Merge schedule updates
  const newSchedule: ResearchSchedule = {
    ...existingSchedule,
    ...scheduleUpdates,
  };

  // Compute next_run_at if cadence changed or schedule enabled
  if (newSchedule.enabled && newSchedule.cadence !== "manual") {
    newSchedule.next_run_at = computeNextRunAt(newSchedule.cadence);
  } else {
    newSchedule.next_run_at = null;
  }

  // Update synthesis_data with new radar data
  const updatedRadar: IntelligenceRadarData = {
    schedule: newSchedule,
    last_snapshot: existingRadar.last_snapshot ?? null,
    signals: existingSignals,
    updated_at: new Date().toISOString(),
  };

  await db.from("spaces").update({
    synthesis_data: {
      ...synthData,
      intelligence_radar: updatedRadar,
    },
  }).eq("id", spaceId);

  return NextResponse.json({
    schedule: newSchedule,
    success: true,
  });
}
