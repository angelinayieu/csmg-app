// ── POST /api/pipeline/compute-analogs ──
//
// End-to-end cross-domain analogy pipeline for a space:
//
//   1. Resolve space + verify ownership.
//   2. Load entities, edges, cycles.
//   3. Extract the KG signature (pure function + one embedTexts call).
//   4. Upsert into kg_signatures (dedup by (space_id, cluster_id=null)).
//   5. Run retrieveAnalogsBothModes to find structural + blended matches
//      in OTHER spaces (own + anonymized cross-user, enforced by RLS).
//   6. For each match above a similarity floor, hydrate its entities/
//      cycles (limited to summary fields) and ask the explainer to
//      produce the entity pairings + insight.
//   7. Emit structural_analog_found events for the run (if runId passed)
//      and return the list to the caller.
//
// Separate from strategy-refresh/intake on purpose — analog discovery
// is its own expensive step (1 embedTexts call + N explainer LLM
// calls), should be opt-in, and can be re-run any time the user wants
// fresh matches without touching the underlying KG.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { runComputeAnalogs } from "@/lib/analogy/run-compute-analogs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const {
      spaceId,
      runId,
      minSimilarity: rawMinSim,
      anonymizeForCrossUser,
    } = (body ?? {}) as {
      spaceId?: string;
      runId?: string;
      minSimilarity?: number;
      anonymizeForCrossUser?: boolean;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const result = await runComputeAnalogs(db, {
      spaceId,
      userId: user.id,
      runId: runId ?? null,
      minSimilarity: rawMinSim,
      anonymizeForCrossUser,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "compute-analogs failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      signatureUpserted: result.signatureUpserted,
      analogsFound: result.analogsFound,
      results: result.results.map((r) => ({
        signatureId: r.match.signature_id,
        analogSpaceId: r.match.space_id,
        isCrossUser: r.match.is_cross_user,
        mode: r.match.mode,
        similarity: r.match.similarity,
        analogSummary: r.match.summary_text,
        explanation: r.explanation,
      })),
    });
  } catch (outerErr) {
    console.error("[compute-analogs] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Analog computation failed unexpectedly",
      },
      { status: 500 },
    );
  }
}
