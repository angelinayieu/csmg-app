// ── POST /api/brainstorm/sessions/[id]/elect-candidate ──────────────
//
// One-click elect from the Brainstorm panel. Atomically:
//   1. Sets disposition=elected on the proposal in synthesis_data
//   2. Logs decision_log action="brainstorm_elected" with the panel
//      context (ribbon, composite_score, intent_of_origin) so future
//      brainstorm runs learn which intents + ribbons actually convert.
//
// Distinct from /api/brainstorm/sub-objectives/disposition because:
//   • disposition logs action="elect" with batch_intent — generic
//     elect event used by preference learning across the picker
//   • this route ALSO logs action="brainstorm_elected" with the
//     session_id + ribbon + composite_score so brainstorm-specific
//     preference learning can run later (Phase 5+)
//
// Body: { proposalId, ribbon, compositeScore, intentOfOrigin }
//
// Returns: { ok: true } on success. Soft failures (already elected,
// proposal missing) return ok=true with a note so the panel can move on.

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
  type SubObjectiveBlock,
  type SubObjectiveIntent,
  type SubObjectiveProposal,
} from "@/lib/objective-canvas/sub-objective-state";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import type {
  BrainstormElectedMetadata,
  BrainstormRibbon,
} from "@/lib/brainstorm/session-types";

export const runtime = "nodejs";

const RIBBONS: ReadonlyArray<BrainstormRibbon> = ["green", "amber", "tray"];
const INTENTS: ReadonlyArray<SubObjectiveIntent> = [
  "initial",
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

interface Body {
  proposalId?: string;
  ribbon?: BrainstormRibbon;
  compositeScore?: number;
  intentOfOrigin?: SubObjectiveIntent;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: sessionId } = await ctx.params;
  if (!sessionId) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const proposalId = typeof body?.proposalId === "string" ? body.proposalId : "";
  if (!proposalId) {
    return NextResponse.json(
      { error: "proposalId required" },
      { status: 400 },
    );
  }
  const ribbon = (body?.ribbon ?? "tray") as BrainstormRibbon;
  if (!RIBBONS.includes(ribbon)) {
    return NextResponse.json({ error: "invalid ribbon" }, { status: 400 });
  }
  const intentOfOrigin =
    body?.intentOfOrigin && INTENTS.includes(body.intentOfOrigin)
      ? body.intentOfOrigin
      : null;
  const compositeScore =
    typeof body?.compositeScore === "number" ? body.compositeScore : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const userId = auth.user.id;

  // ── Load session + parent space ────────────────────────────────
  const { data: sessionRow, error: sessionErr } = await db
    .from("brainstorm_sessions")
    .select("id, space_id, user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr || !sessionRow) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (sessionRow.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const spaceId: string = sessionRow.space_id;

  // ── Set disposition=elected on the proposal ────────────────────
  const { data: space } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "space not found" }, { status: 404 });
  }

  const oc = readObjectiveCanvasState(space.synthesis_data);
  const block: SubObjectiveBlock | null = oc.sub_objectives ?? null;
  if (!block) {
    return NextResponse.json(
      { ok: true, note: "no proposal block — nothing to elect" },
      { status: 200 },
    );
  }

  const electProposal = (p: SubObjectiveProposal): SubObjectiveProposal =>
    p.id === proposalId ? { ...p, disposition: "elected" } : p;

  const nextBlock: SubObjectiveBlock = {
    ...block,
    proposals: block.proposals.map(electProposal),
    batches: (block.batches ?? []).map((b) => ({
      ...b,
      proposals: b.proposals.map(electProposal),
    })),
  };

  // Find the proposal so we can verify it existed + read its batch_intent.
  let foundIntent: SubObjectiveIntent | null = null;
  for (const b of nextBlock.batches ?? []) {
    for (const p of b.proposals) {
      if (p.id === proposalId) {
        foundIntent = b.intent;
        break;
      }
    }
    if (foundIntent) break;
  }
  if (!foundIntent) {
    return NextResponse.json(
      { ok: true, note: "proposal not found — already removed?" },
      { status: 200 },
    );
  }

  try {
    const nextSynth = writeSubObjectiveBlock(space.synthesis_data, nextBlock);
    const { error: writeErr } = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeErr) {
      return NextResponse.json(
        { error: `disposition write failed: ${writeErr.message}` },
        { status: 500 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `elect failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }

  // ── Log decision events — both generic "elect" (preference learning)
  //    and brainstorm-specific "brainstorm_elected" (panel conversion). ──

  // Generic elect — matches what /disposition would have logged so
  // existing intent preference learning picks it up unchanged.
  void logDecision(db, {
    userId,
    spaceId,
    proposalId,
    action: "elect",
    batchIntent: foundIntent,
    metadata: { source: "brainstorm_panel", session_id: sessionId },
  });

  // Brainstorm-specific — panel conversion telemetry.
  const metadata: BrainstormElectedMetadata = {
    session_id: sessionId,
    proposal_id: proposalId,
    ribbon,
    composite_score: compositeScore,
    intent_of_origin: intentOfOrigin ?? foundIntent,
  };
  void logDecision(db, {
    userId,
    spaceId,
    proposalId,
    action: "brainstorm_elected",
    metadata: metadata as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}
