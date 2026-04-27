// ── Layered synthesis route ──
// Sibling to /api/pipeline/synthesize, specialized for hierarchical graphs
// (produced by /api/pipeline/decompose-hierarchical). Runs a 4-stage
// synthesis that mirrors how humans reason about complex strategy:
// fulcrum system → critical domain → load-bearing thread → narrative.
//
// For flat graphs, callers should continue to use /synthesize. This route
// rejects requests against graphs without system-layer entities.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { runLayeredSynthesis } from "@/lib/pipeline/layered-synthesis";
import type { Entity, Edge } from "@/types";
import { checkLayerCoverageGate } from "@/lib/situation-frame/layer-coverage-gate";
import { checkMeasurementCoverageGate } from "@/lib/validation/measurement-coverage-gate";
import { validateFrame as validateSituationFrame } from "@/lib/situation-frame/frame-helpers";

export const maxDuration = 180; // 4 sequential LLM calls, bounded context each

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let bypassLayerGate = false;
  let bypassMeasurementGate = false;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
    // Piece 4 — allow the client to proceed past a failed layer-
    // coverage gate after the user has seen the gap report and
    // confirmed. No-op when the gate passes.
    bypassLayerGate = body.bypassLayerGate === true;
    // D1 — same pattern for the measurement-coverage gate. Client
    // surfaces the gap report to the user, then re-POSTs with
    // bypassMeasurementGate: true to proceed past unmeasured entities.
    bypassMeasurementGate = body.bypassMeasurementGate === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const [spaceRes, entitiesRes, edgesRes] = await Promise.all([
      db
        .from("spaces")
        .select("name, input_text, synthesis_data, situation_frame")
        .eq("id", spaceId)
        .single(),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
    ]);

    const space = spaceRes.data;
    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const entities = (entitiesRes.data ?? []) as Entity[];
    const edges = (edgesRes.data ?? []) as Edge[];

    if (entities.length === 0) {
      return NextResponse.json({ error: "No entities to synthesize" }, { status: 400 });
    }

    // ── Piece 4 · Layer coverage gate ─────────────────────────────────
    //
    // Short-circuit synthesis if the framing panel's `situation_frame`
    // declared layers required that the KG never populated, or if the
    // panel itself surfaced unresolved block-severity divergences.
    //
    // No situation_frame (legacy row, panel soft-failed) → gate passes
    // silently — exact pre-Piece-4 behavior.
    //
    // Bypass: clients surface the gap to the user and re-POST with
    // `bypassLayerGate: true` to proceed anyway. The bypass is recorded
    // in the response for audit.
    const situationFrame = space.situation_frame
      ? validateSituationFrame(space.situation_frame)
      : null;
    const gateReport = checkLayerCoverageGate({
      frame: situationFrame,
      entities,
      spaceId,
    });
    if (!gateReport.pass && !bypassLayerGate) {
      return NextResponse.json(
        {
          error: gateReport.message,
          gate: "layer_coverage",
          report: gateReport,
          bypass_hint:
            "Re-POST with { bypassLayerGate: true } after acknowledging the gap report.",
        },
        { status: 409 },
      );
    }

    // ── D1 · Measurement coverage gate ────────────────────────────────
    //
    // Companion to the layer-coverage gate above. Where layer-coverage
    // ensures the right *kinds* of entities are present, measurement-
    // coverage ensures the high-importance ones are *measurable* —
    // i.e. carry a unit + scale so downstream simulation /
    // calibration / controllability ranking has something concrete to
    // operate on. See docs/KG_DEPTH_CRITIQUE.md §9 D1.
    //
    // Same pass/fail/bypass conventions: 409 with structured report,
    // re-POST with { bypassMeasurementGate: true } to proceed.
    const measurementGateReport = checkMeasurementCoverageGate({
      entities,
      spaceId,
    });
    if (!measurementGateReport.pass && !bypassMeasurementGate) {
      return NextResponse.json(
        {
          error: measurementGateReport.message,
          gate: "measurement_coverage",
          report: measurementGateReport,
          bypass_hint:
            "Re-POST with { bypassMeasurementGate: true } after acknowledging the gap report, or run the measurement backfill agent to fill missing specs.",
        },
        { status: 409 },
      );
    }

    // Validate hierarchical structure. Layered synthesis requires layer info.
    const hasSystems = entities.some((e) => e.layer === "system");
    const hasDomains = entities.some((e) => e.layer === "domain");
    if (!hasSystems || !hasDomains) {
      return NextResponse.json(
        {
          error:
            "Layered synthesis requires a hierarchical graph. This space has no system/domain layers. Use /api/pipeline/synthesize for flat graphs.",
          has_systems: hasSystems,
          has_domains: hasDomains,
        },
        { status: 400 },
      );
    }

    const result = await runLayeredSynthesis({
      userInput: space.input_text ?? "",
      spaceName: space.name ?? "Analysis",
      entities,
      edges,
    });

    // Persist to synthesis_data alongside any existing hierarchical metadata.
    const existingSynth = (space.synthesis_data ?? {}) as Record<string, unknown>;
    await db
      .from("spaces")
      .update({
        synthesis_text: result.stages.final.narrative,
        synthesis_data: {
          ...existingSynth,
          layered_synthesis: {
            ...result.stages,
            stats: result.stats,
            generated_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", spaceId);

    // Changelog (non-critical)
    await db
      .from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "synthesis",
        summary: `Layered synthesis: fulcrum=${result.stages.fulcrum.fulcrum_system_name}, domain=${result.stages.domain.critical_domain_name}, thread=${result.stages.thread.load_bearing_thread_name} (${result.stats.llm_calls} calls, ${result.stats.duration_ms}ms)`,
        details: {
          fulcrum_system_id: result.stages.fulcrum.fulcrum_system_id,
          critical_domain_id: result.stages.domain.critical_domain_id,
          load_bearing_thread_id: result.stages.thread.load_bearing_thread_id,
          llm_calls: result.stats.llm_calls,
          duration_ms: result.stats.duration_ms,
        },
      })
      .then(
        () => {},
        () => {},
      );

    return NextResponse.json({
      spaceId,
      fulcrum: {
        system_id: result.stages.fulcrum.fulcrum_system_id,
        system_name: result.stages.fulcrum.fulcrum_system_name,
        case_for: result.stages.fulcrum.case_for_fulcrum,
        confidence: result.stages.fulcrum.confidence,
      },
      domain: {
        domain_id: result.stages.domain.critical_domain_id,
        domain_name: result.stages.domain.critical_domain_name,
        why: result.stages.domain.why_this_domain,
        tension: result.stages.domain.tension_description,
        confidence: result.stages.domain.confidence,
      },
      thread: {
        thread_id: result.stages.thread.load_bearing_thread_id,
        thread_name: result.stages.thread.load_bearing_thread_name,
        intervention_point: result.stages.thread.intervention_point,
        testable_assumptions: result.stages.thread.testable_assumptions,
        failure_mode: result.stages.thread.failure_mode,
        first_move: result.stages.thread.first_move,
        confidence: result.stages.thread.confidence,
      },
      narrative: result.stages.final,
      stats: result.stats,
      layer_coverage_gate: {
        ...gateReport,
        bypassed: bypassLayerGate && !gateReport.pass,
      },
      measurement_coverage_gate: {
        ...measurementGateReport,
        bypassed: bypassMeasurementGate && !measurementGateReport.pass,
      },
    });
  } catch (err) {
    console.error("[synthesize-layered] Error:", err);
    return NextResponse.json(
      { error: `Layered synthesis failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
