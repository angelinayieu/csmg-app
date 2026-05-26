// ── POST /api/brainstorm/sub-objectives/cluster ────────────────────
//
// Tier-2 LLM clustering pass over the picker's current proposals.
// Reads block.batches[] (flattening if needed), fires one LLM call
// via clusterProposalsLLM, persists the result on
// synthesis_data.objective_canvas.sub_objectives.cluster_analysis.
//
// Body: { spaceId, mode?: "default" | "force" }
//
//   default — return cached analysis when proposals_hash still
//             matches the current proposal set
//   force   — always re-fire the LLM call (user explicitly asked
//             for a fresh clustering)

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
  allBlockProposals,
  type SubObjectiveBlock,
} from "@/lib/objective-canvas/sub-objective-state";
import {
  clusterProposalsLLM,
  proposalsHash,
  type ClusterAnalysis,
} from "@/lib/objective-canvas/cluster-proposals";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
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

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const block = state.sub_objectives;
  if (!block) {
    return NextResponse.json(
      { error: "no sub-objective block to cluster" },
      { status: 409 },
    );
  }

  const proposals = allBlockProposals(block);
  if (proposals.length < 4) {
    // Below 4 proposals there's nothing meaningful to cluster — return
    // a trivial analysis so the UI can degrade gracefully.
    return NextResponse.json({
      cluster_analysis: {
        proposals_hash: proposalsHash(proposals),
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
  // The proposals_hash is deterministic over the proposal ids — when
  // the set is unchanged, the cached analysis is still valid.
  const currentHash = proposalsHash(proposals);
  const cached = block.cluster_analysis as ClusterAnalysis | undefined;
  if (
    !force &&
    cached &&
    cached.proposals_hash === currentHash &&
    Array.isArray(cached.clusters) &&
    cached.clusters.length > 0
  ) {
    return NextResponse.json({
      cluster_analysis: cached,
      cached: true,
    });
  }

  // ── Resolve parent objective text for prompt grounding ──
  let coreObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  // The block lives on the space, but the actual objective text often
  // lives on the root improvement_goal. Prefer that when present.
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("description, title")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rootGoal) {
    if (typeof rootGoal.description === "string" && rootGoal.description.trim()) {
      coreObjectiveText = rootGoal.description;
    } else if (typeof rootGoal.title === "string" && rootGoal.title.trim()) {
      coreObjectiveText = rootGoal.title;
    }
  }

  // ── Fire the LLM clustering pass ──
  let analysis: ClusterAnalysis;
  try {
    analysis = await clusterProposalsLLM({ proposals, coreObjectiveText });
  } catch (err) {
    return NextResponse.json(
      {
        error: "cluster generation failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist ──
  const nextBlock: SubObjectiveBlock = {
    ...block,
    cluster_analysis: analysis,
  };
  const nextSynth = writeSubObjectiveBlock(space.synthesis_data, nextBlock);
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[sub-objectives/cluster] persist failed (non-fatal):",
      writeRes.error.message,
    );
    // Soft-fail — return the analysis anyway so the UI can render.
  }

  return NextResponse.json({
    cluster_analysis: analysis,
    cached: false,
  });
}
