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
  BrainstormTargetKind,
} from "@/lib/brainstorm/session-types";
import type {
  ExpandedItemDetail,
  ItemVariation,
} from "@/lib/objective-canvas/expand-item-detail";
import type { ObjectiveAnnotation } from "@/lib/objective-canvas/generate-annotations";

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
  // Phase 6/6b: also pull target_kind + entity_id + sub_objective_id so
  // we can dispatch electing to the right write path:
  //   - sub_objective_picker → spaces.synthesis_data
  //   - room_feature         → entities.expanded_detail.variations
  //   - annotation           → improvement_goals[core].annotations
  const { data: sessionRow, error: sessionErr } = await db
    .from("objective_brainstorm_sessions")
    .select("id, space_id, user_id, target_kind, entity_id, sub_objective_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr || !sessionRow) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (sessionRow.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const spaceId: string = sessionRow.space_id;
  const targetKind: BrainstormTargetKind = sessionRow.target_kind;
  const entityId: string | null = sessionRow.entity_id;

  let foundIntent: SubObjectiveIntent | null = intentOfOrigin;

  if (targetKind === "annotation") {
    // ── Phase 6b path: append a deepened annotation to the core goal ─
    // sub_objective_id on the session is set to the CORE improvement_goal.
    const goalId: string | null = sessionRow.sub_objective_id;
    if (!goalId) {
      return NextResponse.json(
        { error: "annotation session has no sub_objective_id (core goal ref)" },
        { status: 400 },
      );
    }
    // Find the candidate in the session to retrieve its source_payload
    // (the full ObjectiveAnnotation with offsets + dimensions).
    const { data: fullSession } = await db
      .from("objective_brainstorm_sessions")
      .select("generations")
      .eq("id", sessionId)
      .maybeSingle();
    type GenLite = {
      candidates: Array<{
        proposal_id: string;
        title: string;
        summary: string;
        source_payload?: unknown;
      }>;
    };
    const sourceCand = ((fullSession?.generations as GenLite[] | null) ?? [])
      .flatMap((g) => g.candidates)
      .find((c) => c.proposal_id === proposalId);
    if (!sourceCand) {
      return NextResponse.json(
        { ok: true, note: "candidate not found in session" },
        { status: 200 },
      );
    }
    // Validate source_payload as ObjectiveAnnotation (loose check).
    const ann = sourceCand.source_payload as Partial<ObjectiveAnnotation> | undefined;
    if (
      !ann ||
      typeof ann !== "object" ||
      typeof ann.phrase !== "string" ||
      ann.phrase.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "candidate source_payload missing or malformed" },
        { status: 400 },
      );
    }
    // Load core goal + merge.
    const { data: goal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("id", goalId)
      .maybeSingle();
    if (!goal) {
      return NextResponse.json({ error: "core goal not found" }, { status: 404 });
    }
    const current: ObjectiveAnnotation[] = Array.isArray(goal.annotations)
      ? goal.annotations
      : [];
    // Dedup by phrase (case-insensitive trim). If an existing annotation
    // matches, replace it with the deepened version (preserves the slot
    // + offsets if they happen to match; otherwise the new one's
    // offsets win). If new, append.
    const phraseKey = ann.phrase.trim().toLowerCase();
    const existingIdx = current.findIndex(
      (a) => a.phrase.trim().toLowerCase() === phraseKey,
    );
    const next = [...current];
    if (existingIdx >= 0) {
      next[existingIdx] = ann as ObjectiveAnnotation;
    } else {
      next.push(ann as ObjectiveAnnotation);
    }
    const { error: writeErr } = await db
      .from("improvement_goals")
      .update({ annotations: next })
      .eq("id", goalId);
    if (writeErr) {
      return NextResponse.json(
        { error: `annotation elect failed: ${writeErr.message}` },
        { status: 500 },
      );
    }
  } else if (targetKind === "room_feature") {
    // ── Phase 6 path: elect a variation on an entity ─────────────
    if (!entityId) {
      return NextResponse.json(
        { error: "room_feature session has no entity_id" },
        { status: 400 },
      );
    }
    const { data: entity } = await db
      .from("entities")
      .select("expanded_detail")
      .eq("id", entityId)
      .maybeSingle();
    if (!entity) {
      return NextResponse.json(
        { ok: true, note: "entity gone — nothing to elect" },
        { status: 200 },
      );
    }
    const detail = (entity.expanded_detail ?? {}) as ExpandedItemDetail;
    // The brainstorm candidate's proposal_id is the synthetic
    // "feat-<sess>-<idx>-<hash>" used in the runner; it doesn't exist
    // in entity.variations[] yet. We append it as a new variation
    // sourced from the brainstorm session.
    const variations: ItemVariation[] = Array.isArray(detail.variations)
      ? [...detail.variations]
      : [];
    const already = variations.find((v) => v.id === proposalId);
    if (already) {
      if (already.disposition !== "elected") {
        already.disposition = "elected";
      }
    } else {
      // Find candidate text from the session row.
      const { data: full } = await db
        .from("objective_brainstorm_sessions")
        .select("generations")
        .eq("id", sessionId)
        .maybeSingle();
      type GenLite = {
        candidates: Array<{
          proposal_id: string;
          title: string;
          summary: string;
          rationale?: string;
        }>;
      };
      const sourceCand = ((full?.generations as GenLite[] | null) ?? [])
        .flatMap((g) => g.candidates)
        .find((c) => c.proposal_id === proposalId);
      if (!sourceCand) {
        return NextResponse.json(
          { ok: true, note: "candidate not found in session" },
          { status: 200 },
        );
      }
      variations.push({
        id: proposalId,
        name: sourceCand.title,
        description: sourceCand.summary,
        tradeoff: sourceCand.rationale ?? "",
        kind: "alternative",
        provenance: "rd_iteration",
        disposition: "elected",
      } as ItemVariation);
    }
    const { error: writeErr } = await db
      .from("entities")
      .update({
        expanded_detail: { ...detail, variations },
      })
      .eq("id", entityId);
    if (writeErr) {
      return NextResponse.json(
        { error: `variation elect failed: ${writeErr.message}` },
        { status: 500 },
      );
    }
  } else {
    // ── Existing sub_objective_picker path ───────────────────────
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
    let pickerIntent: SubObjectiveIntent | null = null;
    for (const b of nextBlock.batches ?? []) {
      for (const p of b.proposals) {
        if (p.id === proposalId) {
          pickerIntent = b.intent;
          break;
        }
      }
      if (pickerIntent) break;
    }
    if (!pickerIntent) {
      return NextResponse.json(
        { ok: true, note: "proposal not found — already removed?" },
        { status: 200 },
      );
    }
    foundIntent = pickerIntent;

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
  }

  // ── Log decision events — both generic "elect" (preference learning)
  //    and brainstorm-specific "brainstorm_elected" (panel conversion). ──

  // Generic elect — matches what /disposition would have logged so
  // existing intent preference learning picks it up unchanged.
  void logDecision(db, {
    userId,
    spaceId,
    subObjectiveId: targetKind === "room_feature" ? sessionRow.entity_id : undefined,
    proposalId,
    action: "elect",
    batchIntent: foundIntent,
    metadata: {
      source: "brainstorm_panel",
      session_id: sessionId,
      target_kind: targetKind,
    },
  });

  // Brainstorm-specific — panel conversion telemetry.
  const metadata: BrainstormElectedMetadata = {
    session_id: sessionId,
    proposal_id: proposalId,
    ribbon,
    composite_score: compositeScore,
    // Defensive fallback: picker flow always resolves foundIntent;
    // feature flow always sends intentOfOrigin from the panel. The
    // "creative" default covers a misbehaving client without breaking
    // telemetry shape.
    intent_of_origin:
      intentOfOrigin ?? foundIntent ?? ("creative" as SubObjectiveIntent),
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
