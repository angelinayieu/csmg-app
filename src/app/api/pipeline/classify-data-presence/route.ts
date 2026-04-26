// ── POST /api/pipeline/classify-data-presence ────────────────────────
//
// Runs the DataPresenceClassifier on a space's intake input and persists
// the result to spaces.twin_mode + spaces.data_presence (migration
// 20260425_data_presence.sql).
//
// Slotted in the intake/bootstrap handoff BEFORE frame-extractor, so
// that frame-extractor can read the persisted data_presence column and
// gate axis selection (Financial axis skipped when has_spec=false, etc).
//
// Soft-fail throughout: if classification or persistence fails, spaces.
// twin_mode stays null and frame-extractor falls back to the all-8-axis
// legacy behavior. No regression vs pre-migration.
//
// Inputs:
//   - space_id (required)
//   - input_text (required, defaults to space's stored initial_prompt)
//   - run_id (optional, for event bus correlation — no event emitted
//     today since this is a non-structural classification)
//   - dry_run (optional): return the classification without persisting
//   - model (optional): override the reasoning model

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { classifyDataPresence } from "@/lib/pipeline/data-presence-classifier";

export const maxDuration = 30;
export const runtime = "nodejs";

interface ClassifyDataPresenceRequest {
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
    await safeJsonParse<Partial<ClassifyDataPresenceRequest>>(request);
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
    // ── Resolve input_text ────────────────────────────────────────────
    //
    // Caller can pass it explicitly (for re-classification with edited
    // intake) or we derive from the space's stored state. We prefer
    // initial_prompt > synthesis_data.initial_prompt > name as the source.
    let inputText = typeof body?.input_text === "string" ? body.input_text.trim() : "";
    let rigorSummary: string | undefined;

    if (!inputText) {
      const { data: spaceRow } = await db
        .from("spaces")
        .select("name, primary_goal, synthesis_data, rigor_score")
        .eq("id", spaceId)
        .maybeSingle();
      if (!spaceRow) {
        return NextResponse.json({ error: "Space not found" }, { status: 404 });
      }
      const synth = (spaceRow as { synthesis_data?: Record<string, unknown> | null }).synthesis_data;
      if (synth && typeof synth === "object") {
        const s = synth as Record<string, unknown>;
        if (typeof s.initial_prompt === "string") inputText = s.initial_prompt;
        else if (typeof s.intake_summary === "string") inputText = s.intake_summary;
        // Rigor-intake summary is often stashed alongside — forward it so
        // the classifier's prompt can cross-check (optional).
        if (typeof s.rigor_summary === "string") rigorSummary = s.rigor_summary;
      }
      if (!inputText) {
        const name = (spaceRow as { name?: string }).name;
        const goal = (spaceRow as { primary_goal?: string }).primary_goal;
        inputText = [name, goal].filter(Boolean).join(" — ");
      }
    }

    if (!inputText || inputText.length < 6) {
      return NextResponse.json(
        { error: "Could not resolve input_text for classification" },
        { status: 400 },
      );
    }

    // ── Classify ──────────────────────────────────────────────────────
    const result = await classifyDataPresence({
      inputText,
      rigorSummary,
      model: body?.model,
    });

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        twin_mode: result.twin_mode,
        tags: result.tags,
        stats: result.stats,
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Persist to spaces ─────────────────────────────────────────────
    //
    // Soft-fail: if the UPDATE errors (e.g. constraint violation from a
    // malformed mode), we still return the classification so the caller
    // can decide whether to retry. Column default is null so a failed
    // write leaves the row in its pre-classifier state, which frame-
    // extractor handles as legacy (all-axis) behavior.
    const persistPayload = {
      twin_mode: result.twin_mode,
      data_presence: {
        ...result.tags,
        classified_at: new Date().toISOString(),
        fast_path_used: result.stats.fast_path_used,
        fallback_used: result.stats.fallback_used,
      },
    };

    const { error: updateErr } = await db
      .from("spaces")
      .update(persistPayload)
      .eq("id", spaceId);

    if (updateErr) {
      console.warn("[classify-data-presence] persist failed (non-fatal):", updateErr);
    }

    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      twin_mode: result.twin_mode,
      tags: result.tags,
      stats: result.stats,
      persisted: !updateErr,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[classify-data-presence] failed:", err);
    return NextResponse.json(
      { error: `Data-presence classification failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — read-only: fetch current classification for a space ────────

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
    .select("id, twin_mode, data_presence")
    .eq("id", spaceId)
    .maybeSingle();

  if (error) {
    console.error("[classify-data-presence GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load classification" }, { status: 500 });
  }

  return NextResponse.json({
    space_id: spaceId,
    twin_mode: (data as { twin_mode?: string } | null)?.twin_mode ?? null,
    data_presence: (data as { data_presence?: unknown } | null)?.data_presence ?? null,
  });
}
