// ── POST/GET /api/brainstorm/space/[spaceId]/structure-snapshot ───────
//
// The deepen-iteration ledger for the Objective Canvas. Each "Deepen → v2"
// run captures a denormalized snapshot of the whole structure
// (improvement_goals + entities + edges + bands + positions) via the
// existing serializer (lib/objective-canvas/structure-snapshot.ts). The
// situation-model timeline (View 1 / View 2) reads these back to show how
// the model GREW per iteration — counts give KG growth, created_at gives
// the sequence.
//
// Reuses the existing structure_snapshots table (migration 20260912) — no
// new table, no new write model. Idempotent by content_hash: a deepen that
// changed nothing dedupes against the unique index (so the timeline only
// gains a point when the structure actually grew).
//
// SOFT-FAIL by construction: if the table isn't migrated yet, capture
// returns { ok: false } and list returns []. The deepen flow must never
// break because the ledger is unavailable.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  serializeStructureSnapshot,
  toSnapshotRow,
  type SnapshotReason,
} from "@/lib/objective-canvas/structure-snapshot";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ spaceId: string }>;
}

const ALLOWED_REASONS: SnapshotReason[] = [
  "manual",
  "pre_delete",
  "pre_respawn",
  "auto",
  "library_save",
  "deepen",
];

export async function POST(req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason: SnapshotReason = ALLOWED_REASONS.includes(
    body.reason as SnapshotReason,
  )
    ? (body.reason as SnapshotReason)
    : "deepen";

  try {
    // Fetch the whole live structure for a "space"-scope capture. The
    // serializer keeps everything as-is for scope "space".
    const [spaceRes, goalsRes, entitiesRes, edgesRes, bandsRes, posRes] =
      await Promise.all([
        db.from("spaces").select("id, title, synthesis_data").eq("id", spaceId).maybeSingle(),
        db.from("improvement_goals").select("*").eq("space_id", spaceId),
        db.from("entities").select("*").eq("space_id", spaceId),
        db.from("edges").select("*").eq("space_id", spaceId),
        db.from("layer_ontology").select("*").eq("space_id", spaceId),
        db.from("whiteboard_positions").select("*").eq("space_id", spaceId),
      ]);

    const payload = serializeStructureSnapshot({
      scope: "space",
      space: spaceRes.data ?? null,
      improvementGoals: goalsRes.data ?? [],
      entities: entitiesRes.data ?? [],
      edges: edgesRes.data ?? [],
      layerOntology: bandsRes.data ?? [],
      whiteboardPositions: posRes.data ?? [],
    });
    const row = toSnapshotRow(payload, { spaceId, userId: user.id, reason });

    const { data: inserted, error: insErr } = await db
      .from("structure_snapshots")
      .insert(row)
      .select("id")
      .single();

    if (insErr) {
      // 23505 = unique violation on the dedupe index → identical structure
      // was already captured. That's expected, not an error (no growth since
      // the last snapshot), so report it as a benign dedupe.
      if (insErr.code === "23505") {
        return NextResponse.json({ ok: true, deduped: true, counts: payload.counts });
      }
      console.warn("[structure-snapshot] insert failed (soft):", insErr);
      return NextResponse.json({ ok: false, counts: payload.counts });
    }

    return NextResponse.json({
      ok: true,
      id: (inserted as { id: string } | null)?.id ?? null,
      counts: payload.counts,
    });
  } catch (err) {
    // e.g. table not migrated yet — never break the deepen flow.
    console.warn("[structure-snapshot] capture failed (soft):", err);
    return NextResponse.json({ ok: false, error: "capture failed (soft)" });
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Detail mode (?id=) — return the snapshot's node ids so the time-scrub
  // can filter the radial to what existed at that iteration. Light: ids
  // only, derived from the stored payload.
  const detailId = req.nextUrl.searchParams.get("id");
  if (detailId) {
    try {
      const { data } = await db
        .from("structure_snapshots")
        .select("id, created_at, entity_count, edge_count, room_count, payload")
        .eq("space_id", spaceId)
        .eq("id", detailId)
        .maybeSingle();
      if (!data) return NextResponse.json({ snapshot: null });
      const payload = (data.payload ?? {}) as {
        entities?: Array<{ id?: string }>;
        improvementGoals?: Array<{ id?: string; parent_goal_id?: string | null }>;
      };
      const entityIds = (payload.entities ?? [])
        .map((e) => e?.id)
        .filter((x): x is string => typeof x === "string");
      // Rooms (sub-objectives) carry a parent_goal_id; the root objective
      // doesn't — exclude it so goalIds maps to the radial's sub nodes.
      const goalIds = (payload.improvementGoals ?? [])
        .filter((g) => g?.parent_goal_id)
        .map((g) => g?.id)
        .filter((x): x is string => typeof x === "string");
      return NextResponse.json({
        snapshot: {
          id: data.id,
          created_at: data.created_at,
          entity_count: data.entity_count,
          edge_count: data.edge_count,
          room_count: data.room_count,
          entityIds,
          goalIds,
        },
      });
    } catch (err) {
      console.warn("[structure-snapshot] detail failed (soft):", err);
      return NextResponse.json({ snapshot: null });
    }
  }

  // ?activities=1 — read payloads + diff consecutive snapshots to name the
  // entities ADDED each iteration (the timeline's "top activities"). Heavier
  // (reads payloads), so it's opt-in; the default list stays light.
  const withActivities = req.nextUrl.searchParams.get("activities") === "1";

  try {
    if (withActivities) {
      const { data } = await db
        .from("structure_snapshots")
        .select(
          "id, created_at, reason, entity_count, edge_count, room_count, content_hash, payload",
        )
        .eq("space_id", spaceId)
        .eq("scope", "space")
        .order("created_at", { ascending: true });
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      let prevIds = new Set<string>();
      const snapshots = rows.map((r, i) => {
        const payload = (r.payload ?? {}) as {
          entities?: Array<{ id?: string; name?: string }>;
        };
        const ents = payload.entities ?? [];
        const ids = new Set(
          ents.map((e) => e.id).filter((x): x is string => typeof x === "string"),
        );
        const added =
          i === 0
            ? []
            : ents
                .filter((e) => e.id && !prevIds.has(e.id))
                .map((e) => e.name)
                .filter((x): x is string => typeof x === "string")
                .slice(0, 3);
        prevIds = ids;
        return {
          id: r.id,
          created_at: r.created_at,
          reason: r.reason,
          entity_count: r.entity_count,
          edge_count: r.edge_count,
          room_count: r.room_count,
          content_hash: r.content_hash,
          added,
        };
      });
      return NextResponse.json({ snapshots });
    }

    // Lightweight listing — counts + dates, NOT the heavy payload. The
    // timeline plots growth (counts) over the iteration sequence (created_at).
    const { data } = await db
      .from("structure_snapshots")
      .select(
        "id, scope, scope_ref, scope_label, reason, entity_count, edge_count, room_count, content_hash, created_at",
      )
      .eq("space_id", spaceId)
      .eq("scope", "space")
      .order("created_at", { ascending: true });
    return NextResponse.json({ snapshots: data ?? [] });
  } catch (err) {
    console.warn("[structure-snapshot] list failed (soft):", err);
    return NextResponse.json({ snapshots: [] });
  }
}
