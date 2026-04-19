// ── Convergent point feedback endpoint ──
//
// POST body:
//   { convergent_point_id, feedback: "useful" | "noise" | "inaccurate" | null, note?: string }
//
// Records the user's verdict on a convergent point. Null clears feedback.
// The pattern-aggregator rolls these votes up to their pattern_library entry
// via structural_signature, which is how the library learns what's useful
// vs noisy.
//
// Authorization: user must own the space the convergent_point belongs to.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { signatureToString } from "@/types/convergent-point";
import type { StructuralSignature } from "@/types/convergent-point";

export const maxDuration = 20;

// Helper: normalize a stored signature_detail (which may be any-shape JSONB)
// back into the canonical signature string. Returns null if the shape is
// unusable.
function signatureFromDetail(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Partial<StructuralSignature>;
  if (!d.focal_role || !Array.isArray(d.interactor_roles) || !d.outcome_polarity || !d.outcome_reversibility || !d.outcome_time_horizon) return null;
  return signatureToString(d as StructuralSignature);
}

const ALLOWED_FEEDBACK = ["useful", "noise", "inaccurate"] as const;
type FeedbackValue = (typeof ALLOWED_FEEDBACK)[number] | null;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let convergentPointId: string;
  let feedback: FeedbackValue;
  let note: string | undefined;

  try {
    const body = await request.json();
    convergentPointId = body.convergent_point_id;
    const rawFb = body.feedback;
    if (rawFb === null || rawFb === undefined || rawFb === "") {
      feedback = null;
    } else if (typeof rawFb === "string" && (ALLOWED_FEEDBACK as readonly string[]).includes(rawFb)) {
      feedback = rawFb as FeedbackValue;
    } else {
      return NextResponse.json(
        { error: `feedback must be one of ${ALLOWED_FEEDBACK.join(", ")} or null` },
        { status: 400 },
      );
    }
    if (typeof body.note === "string" && body.note.trim().length > 0) {
      note = body.note.trim().slice(0, 500);
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!convergentPointId || typeof convergentPointId !== "string") {
    return NextResponse.json({ error: "convergent_point_id required" }, { status: 400 });
  }

  try {
    // Fetch the convergent point to check ownership + get its signature for
    // pattern vote propagation.
    const { data: point } = await db
      .from("convergent_points")
      .select("id, space_id, structural_signature")
      .eq("id", convergentPointId)
      .maybeSingle();

    if (!point) {
      return NextResponse.json({ error: "Convergent point not found" }, { status: 404 });
    }

    const isOwner = await verifySpaceOwnership(supabase, point.space_id, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { error: updateError } = await db
      .from("convergent_points")
      .update({
        user_feedback: feedback,
        feedback_note: feedback === null ? null : note ?? null,
        feedback_at: feedback === null ? null : new Date().toISOString(),
      })
      .eq("id", convergentPointId);

    if (updateError) {
      console.error("[feedback] Update failed:", updateError);
      return NextResponse.json(
        { error: `Feedback update failed: ${updateError.message}` },
        { status: 500 },
      );
    }

    // ── Propagate vote change to pattern_library (non-critical) ──
    // The aggregator only processes unaggregated points for efficiency; feedback
    // changes on already-aggregated points would otherwise never reach the
    // library. We fix this by re-tallying votes for just this one signature
    // inline.
    let patternVoteUpdate: {
      signature: string;
      useful_votes: number;
      noise_votes: number;
      inaccurate_votes: number;
      feedback_quality_score: number | null;
    } | null = null;
    try {
      if (point.structural_signature) {
        const signature = signatureFromDetail(point.structural_signature);
        if (signature) {
          // Fetch all points matching this signature (not just aggregated ones —
          // votes should reflect the full evidence picture).
          const { data: siblings } = await db
            .from("convergent_points")
            .select("user_feedback, structural_signature")
            .not("structural_signature", "is", null);

          const matching = (siblings ?? []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (s: any) => {
              const sig = s.structural_signature ? signatureFromDetail(s.structural_signature) : null;
              return sig === signature;
            },
          );

          let useful_votes = 0;
          let noise_votes = 0;
          let inaccurate_votes = 0;
          for (const m of matching) {
            if (m.user_feedback === "useful") useful_votes++;
            else if (m.user_feedback === "noise") noise_votes++;
            else if (m.user_feedback === "inaccurate") inaccurate_votes++;
          }
          const total = useful_votes + noise_votes + inaccurate_votes;
          const quality = total === 0 ? null : (useful_votes + 1) / (total + 3);

          await db
            .from("pattern_library")
            .update({
              useful_votes,
              noise_votes,
              inaccurate_votes,
              feedback_quality_score: quality,
              updated_at: new Date().toISOString(),
            })
            .eq("signature", signature);

          patternVoteUpdate = {
            signature,
            useful_votes,
            noise_votes,
            inaccurate_votes,
            feedback_quality_score: quality,
          };
        }
      }
    } catch (propagationErr) {
      console.warn("[feedback] Pattern vote propagation failed (non-critical):", propagationErr);
    }

    return NextResponse.json({
      convergent_point_id: convergentPointId,
      user_feedback: feedback,
      feedback_note: feedback === null ? null : note ?? null,
      recorded_at: feedback === null ? null : new Date().toISOString(),
      pattern_vote_update: patternVoteUpdate,
    });
  } catch (err) {
    console.error("[feedback] Error:", err);
    return NextResponse.json(
      { error: `Feedback failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
