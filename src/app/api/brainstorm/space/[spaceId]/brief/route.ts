// ── /api/brainstorm/space/[spaceId]/brief ────────────────────────
//
// GET — return the synthesized Strategy Brief as JSON so the side-panel
// view can lazy-load it. Mirrors what the /brief page does server-side:
// ownership check, loadCrossRoomState, buildStrategyBrief with the
// cached cross-room analysis + cached polish tldr when its state_hash
// still matches.
//
// Empty state (zero rooms) returns 200 with the brief shell so the
// panel can render the "nothing to summarize yet" placeholder inline
// instead of treating it as an error.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import {
  buildStrategyBrief,
  type StrategyBrief,
} from "@/lib/objective-canvas/build-strategy-brief";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface CachedPolish {
  state_hash: string;
  tldr: string;
  generated_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function GET(_req: Request, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const db = auth.supabase as AnyDb;

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const loaded = await loadCrossRoomState({
      db,
      spaceId,
      userId: auth.user.id,
    });
    const synthesisData =
      (loaded.synthesisData as Record<string, unknown> | null) ?? {};

    const cachedAnalysis: CrossRoomAnalysisState | null =
      (synthesisData.cross_room_analysis as
        | CrossRoomAnalysisState
        | null
        | undefined) ?? null;
    const cachedPolish: CachedPolish | null =
      (synthesisData.strategy_brief_polish as
        | CachedPolish
        | null
        | undefined) ?? null;
    const polishStillValid =
      !!cachedPolish && cachedPolish.state_hash === loaded.state_hash;

    const brief: StrategyBrief = buildStrategyBrief({
      state: loaded.state,
      analysis: cachedAnalysis,
      cachedTldr: polishStillValid ? cachedPolish!.tldr : null,
    });

    return NextResponse.json({
      brief,
      polishStale: !!cachedPolish && !polishStillValid,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "brief load failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
