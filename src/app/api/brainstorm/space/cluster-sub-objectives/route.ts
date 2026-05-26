// ── POST /api/brainstorm/space/cluster-sub-objectives ──────────────
//
// Post-confirm version of the picker clustering. The user has already
// forked N sub-objectives onto the main canvas; this groups them into
// themed clusters so the MainCanvasView can render row-per-theme
// galleries instead of a flat 3-col grid.
//
// Reuses the same generic `clusterItems` primitive the picker uses
// (cluster-proposals.ts). Difference is the data source:
//   • picker          → synthesis_data.objective_canvas.sub_objectives.batches[]
//   • this endpoint   → improvement_goals rows (parent_goal_id != null)
//
// Persisted at `synthesis_data.sub_objective_themes` — a sibling key
// to `cross_room_analysis` (which holds findings from the analysis
// workbench). Cache invalidates when the goal set changes (different
// id set → different itemsHash).
//
// Body: { spaceId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  clusterItems,
  itemsHash,
  type ClusterAnalysis,
} from "@/lib/objective-canvas/cluster-proposals";

export const runtime = "nodejs";
// Bumped from 45 → 60 so the LLM clustering call has more headroom
// when the user has many sub-objectives. Long-running LLM calls were
// one suspected cause of the "Unexpected token 'A', 'An error o'…"
// JSON-parse error on the client — Next.js default error pages are
// HTML, so any unhandled exception OR runtime timeout in this route
// surfaces as garbled JSON downstream.
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  // Defensive outer try/catch — ANY uncaught throw between here and
  // the success return would otherwise propagate to Next.js's default
  // HTML error page, which the client tries to JSON-parse and chokes
  // on. Wrapping the entire handler guarantees the client always
  // receives valid JSON, even for DB connection drops, auth library
  // exceptions, or anything else we didn't anticipate.
  try {
    return await handlePost(req);
  } catch (err) {
    console.error(
      "[cluster-sub-objectives] unhandled error:",
      err instanceof Error ? `${err.message}\n${err.stack}` : err,
    );
    return NextResponse.json(
      {
        error: "unhandled server error",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Ownership check + space load ──
  const { data: space, error: spaceErr } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (spaceErr) {
    return NextResponse.json(
      { error: "DB error loading space", detail: spaceErr.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Load child improvement_goals (the sub-objectives) ──
  // We look up the root goal first, then its children — same pattern
  // as MainCanvasView's loader. We need title + description for the
  // generic clusterer (description maps to summary).
  const { data: rootRows, error: rootErr } = await db
    .from("improvement_goals")
    .select("id, title, description")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (rootErr) {
    return NextResponse.json(
      { error: "DB error loading root goal", detail: rootErr.message },
      { status: 500 },
    );
  }
  const root =
    Array.isArray(rootRows) && rootRows.length > 0 ? rootRows[0] : null;
  if (!root) {
    return NextResponse.json(
      { error: "no root goal — clarify intake first" },
      { status: 409 },
    );
  }

  const { data: childRows, error: childErr } = await db
    .from("improvement_goals")
    .select("id, title, description")
    .eq("space_id", spaceId)
    .eq("parent_goal_id", root.id)
    .order("created_at", { ascending: true });
  if (childErr) {
    return NextResponse.json(
      { error: "DB error loading sub-objectives", detail: childErr.message },
      { status: 500 },
    );
  }
  const subs = ((childRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
  }>) ?? [];

  if (subs.length < 4) {
    // Below 4 there's nothing meaningful to theme — return a trivial
    // shape so the UI can degrade gracefully (and so the same key
    // remains present at sufficient density later).
    return NextResponse.json({
      sub_objective_themes: {
        proposals_hash: itemsHash(subs.map((s) => ({ id: s.id }))),
        clusters: [],
        redundancy: {
          duplicate_pair_count: 0,
          soft_overlap_pair_count: 0,
        },
        generated_at: new Date().toISOString(),
      } satisfies ClusterAnalysis,
      cached: false,
      reason: "below_threshold",
    });
  }

  // ── Cache short-circuit ──
  // `sub_objective_themes` lives at the top of synthesis_data (not
  // under .objective_canvas) so it's a sibling of cross_room_analysis
  // and the picker's cluster_analysis. Different scope = different
  // key, no collision.
  const synth =
    space.synthesis_data && typeof space.synthesis_data === "object"
      ? (space.synthesis_data as Record<string, unknown>)
      : {};
  const cached = synth.sub_objective_themes as ClusterAnalysis | undefined;
  const currentHash = itemsHash(subs.map((s) => ({ id: s.id })));
  if (
    !force &&
    cached &&
    cached.proposals_hash === currentHash &&
    Array.isArray(cached.clusters) &&
    cached.clusters.length > 0
  ) {
    return NextResponse.json({
      sub_objective_themes: cached,
      cached: true,
    });
  }

  // ── Umbrella context for the LLM ──
  // Same precedence the picker uses — root goal description wins,
  // fall back to space text. Anchors cluster labels in the domain.
  let coreObjectiveText: string =
    (typeof root.description === "string" && root.description.trim()) ||
    (typeof root.title === "string" && root.title.trim()) ||
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // ── Run the generic clusterer ──
  let analysis: ClusterAnalysis;
  try {
    analysis = await clusterItems({
      items: subs.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.description ?? "",
      })),
      coreObjectiveText,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "theme generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist ──
  const nextSynth = { ...synth, sub_objective_themes: analysis };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[space/cluster-sub-objectives] persist failed (non-fatal):",
      writeRes.error.message,
    );
    // Soft-fail — return analysis anyway so the UI can render the
    // result of this LLM call even if persistence had a hiccup.
  }

  return NextResponse.json({
    sub_objective_themes: analysis,
    cached: false,
  });
}
