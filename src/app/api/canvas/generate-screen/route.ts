// POST /api/canvas/generate-screen
//
// Generates a prototype mockup image for a pipeline artifact (app,
// variation, strategy, twin, intervention) using OpenAI gpt-image-1,
// uploads to the Supabase Storage "screens" bucket, and persists a
// generated_screens row.
//
// Request body:
//   {
//     target_kind: "app" | "variation" | "strategy" | "twin" | "intervention" | "generic",
//     target_id: string (uuid, optional for 'generic'),
//     target_label: string,
//     space_id: string,
//     artifact_type: "mobile" | "web" | "twin" | "custom",
//     prompt_brief?: string,        // optional user-provided constraints
//     // Optional context the client already has — saves a DB roundtrip
//     hints?: {
//       target_summary?: string,
//       app_type?: string,
//       intervention_titles?: string[],
//       metric_names?: string[],
//       goal_summary?: string,
//       posture?: string,
//       top_entity_names?: string[],
//     }
//   }
//
// Response: the generated_screens row with image_url populated.
//
// Rate limit: 3 generations per user per minute (cost + queue
// protection). Returns 429 over the limit.

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  ARTIFACT_TYPE_SPEC,
  buildScreenGenerationPrompt,
  type ArtifactType,
  type ScreenGenerationContext,
} from "@/lib/prompts/screen-generation";

export const runtime = "nodejs";
// gpt-image-1 takes 10-30s; bump the lambda timeout accordingly.
export const maxDuration = 60;

const RATE_LIMIT_MAX_PER_MINUTE = 3;

interface RequestBody {
  target_kind?: string;
  target_id?: string | null;
  target_label?: string;
  space_id?: string;
  artifact_type?: string;
  prompt_brief?: string | null;
  hints?: {
    target_summary?: string;
    app_type?: string;
    intervention_titles?: string[];
    metric_names?: string[];
    goal_summary?: string;
    posture?: string;
    top_entity_names?: string[];
  } | null;
}

const VALID_KINDS = new Set([
  "app",
  "variation",
  "strategy",
  "twin",
  "intervention",
  "generic",
]);
const VALID_ARTIFACT_TYPES = new Set<ArtifactType>([
  "mobile",
  "web",
  "twin",
  "custom",
]);

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseErr } = await safeJsonParse<RequestBody>(
    request,
  );
  if (parseErr) return parseErr;

  // ── Validate ────────────────────────────────────────────────────────
  const targetKind = typeof body?.target_kind === "string" ? body.target_kind : "";
  const targetLabel =
    typeof body?.target_label === "string" ? body.target_label.trim() : "";
  const spaceId = typeof body?.space_id === "string" ? body.space_id : "";
  const artifactType =
    typeof body?.artifact_type === "string" ? body.artifact_type : "";

  if (!VALID_KINDS.has(targetKind)) {
    return NextResponse.json(
      { error: "Invalid target_kind. Must be one of: " + Array.from(VALID_KINDS).join(", ") },
      { status: 400 },
    );
  }
  if (targetLabel.length === 0 || targetLabel.length > 200) {
    return NextResponse.json(
      { error: "target_label must be 1-200 chars" },
      { status: 400 },
    );
  }
  if (!spaceId) {
    return NextResponse.json({ error: "space_id required" }, { status: 400 });
  }
  if (!VALID_ARTIFACT_TYPES.has(artifactType as ArtifactType)) {
    return NextResponse.json(
      { error: "Invalid artifact_type" },
      { status: 400 },
    );
  }

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Rate limit ──────────────────────────────────────────────────────
  // Count this user's screens generated in the last 60s. Cheap query
  // (indexed on created_at via the space_idx).
  const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = (await db
    .from("generated_screens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", sixtySecondsAgo)) as { count: number | null };
  if ((recentCount ?? 0) >= RATE_LIMIT_MAX_PER_MINUTE) {
    return NextResponse.json(
      {
        error: `Rate limit: max ${RATE_LIMIT_MAX_PER_MINUTE} screens per minute. Try again in a moment.`,
      },
      { status: 429 },
    );
  }

  // ── Build context for the prompt ───────────────────────────────────
  const ctx: ScreenGenerationContext = {
    target_label: targetLabel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target_kind: targetKind as any,
    target_summary: body?.hints?.target_summary ?? null,
    app_type: body?.hints?.app_type ?? null,
    intervention_titles: body?.hints?.intervention_titles ?? undefined,
    metric_names: body?.hints?.metric_names ?? undefined,
    goal_summary: body?.hints?.goal_summary ?? null,
    posture: body?.hints?.posture ?? null,
    top_entity_names: body?.hints?.top_entity_names ?? undefined,
    custom_brief: body?.prompt_brief ?? null,
    artifact_type: artifactType as ArtifactType,
    aspect_ratio: ARTIFACT_TYPE_SPEC[artifactType as ArtifactType].aspect,
  };
  const fullPrompt = buildScreenGenerationPrompt(ctx);
  const sizeSpec = ARTIFACT_TYPE_SPEC[artifactType as ArtifactType].size;

  // ── Insert a 'generating' row up front ─────────────────────────────
  // Lets the client subscribe to status changes. If the gen succeeds
  // we PATCH it to 'ready'; on failure we mark 'error' so the row is
  // a permanent audit trail.
  const targetId =
    typeof body?.target_id === "string" && body.target_id.length > 0
      ? body.target_id
      : null;
  const { data: inserted, error: insertErr } = (await db
    .from("generated_screens")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      target_kind: targetKind,
      target_id: targetId,
      target_label: targetLabel,
      artifact_type: artifactType,
      aspect_ratio: ctx.aspect_ratio,
      prompt_brief: body?.prompt_brief ?? null,
      full_prompt: fullPrompt,
      status: "generating",
      model: "gpt-image-1",
    })
    .select()
    .single()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create screen row" },
      { status: 500 },
    );
  }
  const screenId = inserted.id;

  // ── Call gpt-image-1 ────────────────────────────────────────────────
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  let b64: string;
  try {
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt: fullPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size: sizeSpec as any,
      n: 1,
      // gpt-image-1 returns base64 by default (no `response_format`).
    });
    const firstImage = result.data?.[0];
    const candidate = firstImage?.b64_json;
    if (!candidate) {
      throw new Error("gpt-image-1 returned no image data");
    }
    b64 = candidate;
  } catch (err) {
    const msg = sanitizeErrorMessage(err);
    await db
      .from("generated_screens")
      .update({ status: "error", error_message: msg })
      .eq("id", screenId);
    return NextResponse.json(
      { error: `Image generation failed: ${msg}` },
      { status: 502 },
    );
  }

  // ── Upload to Supabase Storage ──────────────────────────────────────
  // Path: screens/<user_id>/<screen_id>.png — RLS-checked by the
  // bucket policy we created in the migration.
  const objectPath = `${user.id}/${screenId}.png`;
  const buffer = Buffer.from(b64, "base64");
  const { error: uploadErr } = await db.storage
    .from("screens")
    .upload(objectPath, buffer, {
      contentType: "image/png",
      cacheControl: "31536000", // 1-year cache; URLs include the screen id so cache busting on regen is automatic
      upsert: false,
    });
  if (uploadErr) {
    await db
      .from("generated_screens")
      .update({ status: "error", error_message: uploadErr.message })
      .eq("id", screenId);
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }
  // Public URL (the bucket is public).
  const { data: urlData } = db.storage.from("screens").getPublicUrl(objectPath);
  const imageUrl = urlData?.publicUrl as string | undefined;
  if (!imageUrl) {
    await db
      .from("generated_screens")
      .update({ status: "error", error_message: "Failed to resolve public URL" })
      .eq("id", screenId);
    return NextResponse.json(
      { error: "Failed to resolve public URL" },
      { status: 500 },
    );
  }

  // ── Mark ready + return the row ────────────────────────────────────
  const { data: updated } = (await db
    .from("generated_screens")
    .update({
      image_url: imageUrl,
      thumbnail_url: imageUrl, // same URL today; downscale later
      status: "ready",
      generated_at: new Date().toISOString(),
    })
    .eq("id", screenId)
    .select()
    .single()) as { data: Record<string, unknown> | null };

  return NextResponse.json(updated ?? { id: screenId, image_url: imageUrl });
}
