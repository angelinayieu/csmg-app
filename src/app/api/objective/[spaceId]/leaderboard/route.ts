// ── GET /api/objective/[spaceId]/leaderboard ──────────────────────
//
// Rolls up per-collaborator contributions to the objective board. Reads
// library_objects (the "finalized" idea layer — see [[project_converge_publish_object_layer]])
// grouped by user_id, joins each row against auth.users + the cursor
// color palette so the popover can render avatars without a second
// round-trip, and computes the four signals the leaderboard shows:
//
//   • totalIdeas      — every library_object the user wrote into this space
//   • finalized       — the survivor count (selection_status='selected'
//                       OR included_in_spec OR in_strategy_brief)
//   • onBoard         — `on_whiteboard = true` (their objects materialized
//                       as cards on the canvas, not just sitting in Library)
//   • avgQuality      — mean rank_score where present (LLM-scored signal)
//   • recent24h       — created in the last 24h, the "active right now" cue
//
// "Quality rate" = finalized / max(1, totalIdeas) — surfaced as a single
// 0..1 number so the popover can paint a row bar without further math.
//
// Access: any member of the space (owner/editor/viewer) may read. The
// route uses the service-role client AFTER an explicit verifySpaceAccess
// check so a member sees attribution for OTHER members too — RLS on
// library_objects is owner-only and would otherwise hide co-authors.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceAccess,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { colorForUser } from "@/components/objective/use-board-collaboration";

export const maxDuration = 15;

export interface LeaderboardRow {
  userId: string;
  name: string;
  color: string;
  isYou: boolean;
  isOwner: boolean;
  totalIdeas: number;
  finalized: number;
  onBoard: number;
  finalizedRate: number;
  avgQuality: number | null;
  recent24h: number;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  totals: {
    finalized: number;
    noise: number;
    onBoard: number;
    inLibrary: number;
  };
}

interface ObjectRow {
  user_id: string | null;
  selection_status: string | null;
  included_in_spec: boolean | null;
  in_strategy_brief: boolean | null;
  on_whiteboard: boolean | null;
  rank_score: number | null;
  created_at: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const role = await verifySpaceAccess(supabase, spaceId, user.id);
  if (!role)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  try {
    // ── Slim read of every library_object in this space ──
    // Only the columns the rollup needs — content_snapshot/card_face can be
    // 5-20KB per row and the leaderboard never reads them.
    const { data: objects, error: objErr } = await svc
      .from("library_objects")
      .select(
        "user_id, selection_status, included_in_spec, in_strategy_brief, on_whiteboard, rank_score, created_at",
      )
      .eq("space_id", spaceId);
    if (objErr) {
      console.error("[leaderboard/GET] library_objects", objErr);
      return NextResponse.json(
        { error: "Could not load contributions" },
        { status: 500 },
      );
    }

    const rowsByUser = new Map<
      string,
      {
        total: number;
        finalized: number;
        onBoard: number;
        recent24h: number;
        qualitySum: number;
        qualityCount: number;
      }
    >();
    let totalFinalized = 0;
    let totalOnBoard = 0;

    const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

    for (const o of (objects ?? []) as ObjectRow[]) {
      if (!o.user_id) continue; // legacy rows w/o attribution skip
      const acc = rowsByUser.get(o.user_id) ?? {
        total: 0,
        finalized: 0,
        onBoard: 0,
        recent24h: 0,
        qualitySum: 0,
        qualityCount: 0,
      };
      acc.total += 1;
      const isFinalized =
        o.selection_status === "selected" ||
        o.included_in_spec === true ||
        o.in_strategy_brief === true;
      if (isFinalized) {
        acc.finalized += 1;
        totalFinalized += 1;
      }
      if (o.on_whiteboard === true) {
        acc.onBoard += 1;
        totalOnBoard += 1;
      }
      if (typeof o.rank_score === "number") {
        acc.qualitySum += o.rank_score;
        acc.qualityCount += 1;
      }
      if (new Date(o.created_at).getTime() > dayAgoMs) {
        acc.recent24h += 1;
      }
      rowsByUser.set(o.user_id, acc);
    }

    // ── Identity resolution ──
    // Always include the owner + every shared member in the result, even
    // if they have zero contributions yet — the popover should read as a
    // roster + their contributions, not "empty until someone publishes."
    const { data: spaceRow } = await svc
      .from("spaces")
      .select("user_id")
      .eq("id", spaceId)
      .maybeSingle();
    const ownerId: string | null = spaceRow?.user_id ?? null;

    const { data: memberRows } = await svc
      .from("space_members")
      .select("user_id")
      .eq("space_id", spaceId);

    const allUserIds = new Set<string>(rowsByUser.keys());
    if (ownerId) allUserIds.add(ownerId);
    for (const m of (memberRows ?? []) as Array<{ user_id: string }>) {
      if (m.user_id) allUserIds.add(m.user_id);
    }

    // Resolve names via the admin API in one parallel batch — auth.users
    // isn't selectable from app code.
    const idList = [...allUserIds];
    const userMetaById = new Map<
      string,
      { email: string | null; name: string | null }
    >();
    await Promise.all(
      idList.map(async (uid) => {
        try {
          const { data: r } = await svc.auth.admin.getUserById(uid);
          const u = r?.user;
          const name =
            (u?.user_metadata?.display_name as string | undefined) ??
            (u?.user_metadata?.full_name as string | undefined) ??
            (u?.email ? u.email.split("@")[0] : null) ??
            null;
          userMetaById.set(uid, { email: u?.email ?? null, name });
        } catch {
          userMetaById.set(uid, { email: null, name: null });
        }
      }),
    );

    const rows: LeaderboardRow[] = idList.map((uid) => {
      const acc = rowsByUser.get(uid);
      const meta = userMetaById.get(uid);
      const total = acc?.total ?? 0;
      const finalized = acc?.finalized ?? 0;
      return {
        userId: uid,
        name: meta?.name ?? "Guest",
        color: colorForUser(uid),
        isYou: uid === user.id,
        isOwner: uid === ownerId,
        totalIdeas: total,
        finalized,
        onBoard: acc?.onBoard ?? 0,
        finalizedRate: total > 0 ? finalized / total : 0,
        avgQuality:
          acc && acc.qualityCount > 0
            ? acc.qualitySum / acc.qualityCount
            : null,
        recent24h: acc?.recent24h ?? 0,
      };
    });

    // Rank: finalized count first (signal beats activity), then total
    // ideas (volume), then 24h recency as the tiebreaker. The viewer
    // ALWAYS lands at the top when their numbers are equal so they see
    // "you" anchored at row 1 — small UX kindness.
    rows.sort((a, b) => {
      if (a.finalized !== b.finalized) return b.finalized - a.finalized;
      if (a.totalIdeas !== b.totalIdeas) return b.totalIdeas - a.totalIdeas;
      if (a.recent24h !== b.recent24h) return b.recent24h - a.recent24h;
      if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const inLibrary = rows.reduce((s, r) => s + r.totalIdeas, 0);
    return NextResponse.json({
      rows,
      totals: {
        finalized: totalFinalized,
        noise: Math.max(0, inLibrary - totalFinalized),
        onBoard: totalOnBoard,
        inLibrary,
      },
    } satisfies LeaderboardResponse);
  } catch (err) {
    return NextResponse.json(
      { error: `Leaderboard failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
