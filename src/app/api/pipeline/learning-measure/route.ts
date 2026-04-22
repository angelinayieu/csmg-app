// ── POST /api/pipeline/learning-measure ──
//
// HTTP wrapper around runLearningMeasure (src/lib/learning/run-measure.ts).
// Snapshots a user's proficiency in a domain using the current state
// of one of their spaces. The shared core is also called inline at
// pipeline completion in strategy-refresh.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { runLearningMeasure } from "@/lib/learning/run-measure";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const { spaceId, domain } = (body ?? {}) as {
      spaceId?: string;
      domain?: string;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const result = await runLearningMeasure(db, {
      spaceId,
      userId: user.id,
      domain,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "learning-measure failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      measurementId: result.measurementId,
      measuredAt: result.measuredAt,
      domain: result.domain,
      metrics: result.metrics,
      counts: result.counts,
    });
  } catch (outerErr) {
    console.error("[learning-measure] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Learning measurement failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
