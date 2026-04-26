// ── POST /api/pipeline/frame-panel ───────────────────────────────────
//
// Runs the 3-lens framing panel (piece 2 of the 2026-04-23 review)
// against a space's intake input and persists the merged SituationFrame
// to spaces.situation_frame (migration 20260528_situation_frame.sql).
//
// Slot in intake/bootstrap:
//   rigor-intake → classify-data-presence → [THIS] frame-panel
//     → frame-extractor (consumes situation_frame) → decompose, ...
//
// Soft-fail throughout: if the panel errors or all lenses degrade to
// empty, spaces.situation_frame stays null and frame-extractor falls
// back to the legacy (type, domain, data_presence) axis selection. No
// regression vs pre-migration.
//
// Inputs:
//   - space_id (required)
//   - input_text (optional, defaults to space's initial_prompt)
//   - run_id (optional, for event bus correlation — panel is non-
//     structural today so no event is emitted)
//   - dry_run (optional): classify without persisting
//   - model (optional): override reasoning model

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { runFramingPanel } from "@/lib/pipeline/framing-panel";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";

export const maxDuration = 60;
export const runtime = "nodejs";

interface FramePanelRequest {
  space_id: string;
  input_text?: string;
  run_id?: string | null;
  dry_run?: boolean;
  model?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<FramePanelRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const dryRun = body?.dry_run === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const startedAt = Date.now();

  try {
    // ── Resolve input_text and auxiliary signals ──────────────────────
    //
    // Caller may pass input_text for re-framing with edited intake.
    // Otherwise derive from stored space state, preferring
    // synthesis_data.initial_prompt > intake_summary > name+goal. Also
    // read data_presence + rigor_summary if present so the lenses can
    // calibrate (e.g. the operator lens honors has_telemetry).
    let inputText =
      typeof body?.input_text === "string" ? body.input_text.trim() : "";
    let rigorSummary: string | undefined;
    let dataPresence: DataPresenceTags | null = null;

    const { data: spaceRow } = await db
      .from("spaces")
      .select(
        "name, primary_goal, synthesis_data, data_presence, reasoning_settings",
      )
      .eq("id", spaceId)
      .maybeSingle();

    if (!spaceRow) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const synth = (spaceRow as { synthesis_data?: Record<string, unknown> | null })
      .synthesis_data;
    if (synth && typeof synth === "object") {
      const s = synth as Record<string, unknown>;
      if (!inputText) {
        if (typeof s.initial_prompt === "string") inputText = s.initial_prompt;
        else if (typeof s.intake_summary === "string") inputText = s.intake_summary;
      }
      if (typeof s.rigor_summary === "string") rigorSummary = s.rigor_summary;
    }
    if (!inputText) {
      const name = (spaceRow as { name?: string }).name;
      const goal = (spaceRow as { primary_goal?: string }).primary_goal;
      inputText = [name, goal].filter(Boolean).join(" — ");
    }

    // data_presence column is a JSONB { ...DataPresenceTags, classified_at, ... }
    const dpRaw = (spaceRow as { data_presence?: unknown }).data_presence;
    if (dpRaw && typeof dpRaw === "object") {
      const dp = dpRaw as Record<string, unknown>;
      dataPresence = {
        has_telemetry: Boolean(dp.has_telemetry),
        has_historical_output: Boolean(dp.has_historical_output),
        has_baseline: Boolean(dp.has_baseline),
        has_spec: Boolean(dp.has_spec),
        has_just_idea: Boolean(dp.has_just_idea),
        data_presence_score:
          typeof dp.data_presence_score === "number" ? dp.data_presence_score : 0,
        evidence_excerpts: Array.isArray(dp.evidence_excerpts)
          ? (dp.evidence_excerpts as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : [],
      };
    }

    if (!inputText || inputText.length < 6) {
      return NextResponse.json(
        { error: "Could not resolve input_text for framing panel" },
        { status: 400 },
      );
    }

    // ── User-selected lenses (migration 20260606) ─────────────────────
    //
    // When the user customized lenses in the intake settings panel,
    // honor that selection — skip the lenses they didn't pick. This
    // saves ~500 tokens per skipped lens AND respects the user's
    // explicit "I don't want the historian lens for this prompt"
    // preference. Falls back to all 5 canonical lenses when the
    // column is null (legacy rows or default).
    let userSelectedLenses:
      | readonly (
          | "systems_analyst"
          | "skeptic"
          | "operator"
          | "engineer"
          | "historian"
        )[]
      | undefined = undefined;
    const rsRaw = (spaceRow as { reasoning_settings?: unknown })
      .reasoning_settings;
    if (rsRaw && typeof rsRaw === "object") {
      const rs = rsRaw as { lenses?: unknown };
      if (Array.isArray(rs.lenses) && rs.lenses.length > 0) {
        const valid = (rs.lenses as unknown[]).filter(
          (
            l,
          ): l is
            | "systems_analyst"
            | "skeptic"
            | "operator"
            | "engineer"
            | "historian" =>
            typeof l === "string" &&
            [
              "systems_analyst",
              "skeptic",
              "operator",
              "engineer",
              "historian",
            ].includes(l),
        );
        if (valid.length > 0) userSelectedLenses = valid;
      }
    }

    // ── Run the panel ─────────────────────────────────────────────────
    const result = await runFramingPanel({
      inputText,
      dataPresence,
      rigorSummary,
      model: body?.model,
      // When user selection narrowed the lens set, only call those
      // LLM endpoints. Saves cost AND honors user customization.
      ...(userSelectedLenses ? { lenses: userSelectedLenses } : {}),
    });

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        frame: result.frame,
        stats: result.stats,
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Persist to spaces.situation_frame ─────────────────────────────
    //
    // Soft-fail: a failed UPDATE leaves the column null and frame-
    // extractor treats null as legacy behavior. We still return the
    // frame so the caller can surface it / retry if desired.
    const { error: updateErr } = await db
      .from("spaces")
      .update({ situation_frame: result.frame })
      .eq("id", spaceId);

    if (updateErr) {
      console.warn("[frame-panel] persist failed (non-fatal):", updateErr);
    }

    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      frame: result.frame,
      stats: result.stats,
      persisted: !updateErr,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[frame-panel] failed:", err);
    return NextResponse.json(
      { error: `Framing panel failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — read-only: fetch current frame for a space ─────────────────

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("spaces")
    .select("id, situation_frame")
    .eq("id", spaceId)
    .maybeSingle();

  if (error) {
    console.error("[frame-panel GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load frame" }, { status: 500 });
  }

  return NextResponse.json({
    space_id: spaceId,
    situation_frame:
      (data as { situation_frame?: unknown } | null)?.situation_frame ?? null,
  });
}
