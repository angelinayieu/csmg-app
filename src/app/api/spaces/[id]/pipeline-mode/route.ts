// ── /api/spaces/[id]/pipeline-mode ──────────────────────────────────
//
// Phase 7a — controls how aggressively the chain pipelines
// (decompose / synthesize / critique / expand) commit AI-generated
// outputs to the knowledge graph.
//
// GET    → returns the current pipeline_mode for the space.
// PATCH  → sets pipeline_mode to one of:
//            - "autopilot"   (default; auto-commit every stage)
//            - "review_each" (each stage opens a candidate drawer)
//            - "manual"      (no chain pipelines fire at all)
//
// Switching the mode does NOT cancel in-flight runs — they finish
// under their original mode. The new mode applies to the next chain
// stage that fires. This is intentional: yanking a running pipeline
// mid-execution would leave the KG in a half-written state. Better
// to let it finish, then apply the new rules going forward.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export type PipelineMode = "autopilot" | "review_each" | "manual";

const VALID_MODES: readonly PipelineMode[] = [
  "autopilot",
  "review_each",
  "manual",
] as const;

function isPipelineMode(v: unknown): v is PipelineMode {
  return typeof v === "string" && (VALID_MODES as readonly string[]).includes(v);
}

interface Ctx {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  pipeline_mode?: unknown;
}

// ── GET ────────────────────────────────────────────────────────────
// Cheap read so the client can hydrate without owning localStorage as
// the source of truth. The client uses localStorage as a fast-path
// mirror for first paint, then reconciles against this endpoint.
export async function GET(_request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("spaces")
    .select("pipeline_mode")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // If the row exists but the column isn't set (shouldn't happen post-
  // migration — default is "autopilot" — but defensive against rows
  // mutated by raw SQL), fall back to the same default the column has.
  const mode: PipelineMode =
    (data?.pipeline_mode as PipelineMode | undefined) ?? "autopilot";

  return NextResponse.json({ pipeline_mode: mode });
}

// ── PATCH ──────────────────────────────────────────────────────────
// Sets the mode. Body shape:
//   { "pipeline_mode": "autopilot" | "review_each" | "manual" }
//
// We could've accepted a simpler bare-string body but matching the
// JSONB style of other space-settings endpoints keeps the client
// helper layer uniform.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<PatchBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (!isPipelineMode(body.pipeline_mode)) {
    return NextResponse.json(
      {
        error: `Invalid pipeline_mode. Expected one of: ${VALID_MODES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: writeErr } = await db
    .from("spaces")
    .update({ pipeline_mode: body.pipeline_mode })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({ pipeline_mode: body.pipeline_mode });
}
