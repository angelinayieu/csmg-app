// /api/spaces/[id]/evidence
//
// GET — list evidence_registries rows for a space, with optional
//       filters (status, attached_entity_id, ingested_file_id, free-
//       text q, limit). Default ordering: created_at desc.
//
// PATCH — update one row's review status (approve / reject) or
//        attach to an entity. Body: { id, action, ... }
//
// Both require the user owns the space (RLS also enforces, but
// belt-and-suspenders).

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import {
  isEvidenceStatus,
  type EvidenceRegistryRow,
  type EvidenceStatus,
} from "@/types/evidence-registry";

export const runtime = "nodejs";

// ── GET: list ────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const attachedEntityId = url.searchParams.get("attached_entity_id");
  const ingestedFileId = url.searchParams.get("ingested_file_id");
  const q = url.searchParams.get("q");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500) : 100;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("evidence_registries")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Status filter — comma-separated. Default excludes 'superseded'
  // (it's an audit-only state; reviewers don't want to see it by default).
  if (statusParam) {
    const wanted = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter(isEvidenceStatus);
    if (wanted.length > 0) {
      query = query.in("status", wanted);
    }
  } else {
    query = query.neq("status", "superseded");
  }

  if (attachedEntityId) {
    query = query.eq("attached_entity_id", attachedEntityId);
  }
  if (ingestedFileId) {
    query = query.eq("ingested_file_id", ingestedFileId);
  }
  if (q && q.trim().length > 0) {
    const pattern = `%${q.trim().replace(/[%_]/g, "\\$&")}%`;
    // PostgREST OR across the three label columns.
    query = query.or(
      `outcome_label.ilike.${pattern},instrument_label.ilike.${pattern},intervention_label.ilike.${pattern}`,
    );
  }

  const { data, error } = (await query) as {
    data: EvidenceRegistryRow[] | null;
    error: { message?: string } | null;
  };
  if (error) {
    console.error("[evidence GET] query failed:", error);
    return NextResponse.json(
      { error: error.message ?? "list failed" },
      { status: 500 },
    );
  }

  // Status counts for the drawer's filter chips. Cheap aggregate
  // via parallel HEAD-counts; saves a client-side reduce.
  const counts: Partial<Record<EvidenceStatus, number>> = {};
  const STATUSES: EvidenceStatus[] = [
    "pending",
    "extracted",
    "reviewed",
    "rejected",
  ];
  await Promise.all(
    STATUSES.map(async (s) => {
      const { count } = await db
        .from("evidence_registries")
        .select("id", { count: "exact", head: true })
        .eq("space_id", spaceId)
        .eq("status", s);
      counts[s] = count ?? 0;
    }),
  );

  return NextResponse.json({
    space_id: spaceId,
    rows: data ?? [],
    counts,
    total_returned: data?.length ?? 0,
  });
}

// ── PATCH: review action ────────────────────────────────────────

interface PatchBody {
  id: string;
  action:
    | "approve"
    | "reject"
    | "attach_entity"
    | "detach_entity"
    | "edit_numerics";
  attached_entity_id?: string | null;
  reviewer_notes?: string | null;
  // edit_numerics payload: any subset of these fields override the
  // parser's output. The parser_provenance is preserved (so we can
  // see what the parser ORIGINALLY said) but the row's numeric
  // fields move to the human-edited values.
  effect_size?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  ci_level?: number | null;
  effect_metric?: string | null;
  n_treatment?: number | null;
  n_control?: number | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<PatchBody>(request);
  if (bodyErr) return bodyErr;
  if (!body || !body.id || !body.action) {
    return NextResponse.json(
      { error: "Missing id or action" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify the row belongs to this space (RLS guards, but we want
  // a clean error message if the caller passed a foreign id).
  const { data: existing, error: existErr } = await db
    .from("evidence_registries")
    .select("id, space_id, status")
    .eq("id", body.id)
    .maybeSingle();
  if (existErr || !existing) {
    return NextResponse.json(
      { error: "Evidence row not found" },
      { status: 404 },
    );
  }
  if (existing.space_id !== spaceId) {
    return NextResponse.json(
      { error: "Evidence row not in this space" },
      { status: 403 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  const nowIso = new Date().toISOString();

  switch (body.action) {
    case "approve":
      update.status = "reviewed";
      update.reviewed_by = user.id;
      update.reviewed_at = nowIso;
      if (body.reviewer_notes !== undefined) update.reviewer_notes = body.reviewer_notes;
      break;

    case "reject":
      update.status = "rejected";
      update.reviewed_by = user.id;
      update.reviewed_at = nowIso;
      if (body.reviewer_notes !== undefined) update.reviewer_notes = body.reviewer_notes;
      break;

    case "attach_entity":
      if (!body.attached_entity_id) {
        return NextResponse.json(
          { error: "attached_entity_id required for attach_entity" },
          { status: 400 },
        );
      }
      update.attached_entity_id = body.attached_entity_id;
      break;

    case "detach_entity":
      update.attached_entity_id = null;
      break;

    case "edit_numerics":
      // Allow partial updates — only set fields the body explicitly
      // includes. Parser provenance preserved.
      for (const k of [
        "effect_size",
        "ci_lower",
        "ci_upper",
        "ci_level",
        "effect_metric",
        "n_treatment",
        "n_control",
      ] as const) {
        if (k in body) update[k] = body[k];
      }
      // A human edit auto-marks the row as reviewed.
      update.status = "reviewed";
      update.reviewed_by = user.id;
      update.reviewed_at = nowIso;
      break;

    default:
      return NextResponse.json(
        { error: `Unknown action: ${body.action}` },
        { status: 400 },
      );
  }

  const { data: updated, error: updErr } = await db
    .from("evidence_registries")
    .update(update)
    .eq("id", body.id)
    .select("*")
    .single();
  if (updErr || !updated) {
    console.error("[evidence PATCH] update failed:", updErr);
    return NextResponse.json(
      { error: updErr?.message ?? "update failed" },
      { status: 500 },
    );
  }

  // Phase 3 — temporal pool freshness. When the action changes pool
  // composition (reject removes a row; attach/detach changes which
  // edge sees it; edit_numerics may change the values being pooled),
  // repool the space's edges so onset/peak/persistence on edges
  // reflect the new evidence state. Soft-fail discipline: pool errors
  // never propagate (caller got the updated row).
  //
  // We don't repool on `approve` because the existing temporal pooler
  // (like the effect-size pooler) accepts both 'extracted' and
  // 'reviewed' rows — the pool composition is unchanged. If we ever
  // run strict-mode pooling that requires status='reviewed', flip
  // shouldRepool below.
  //
  // NOTE: this PATCH path does NOT also re-trigger the effect-size
  // pool today. That asymmetry is intentional within the scope of
  // Phase 3; effect-size pool freshness on PATCH is a pre-existing
  // gap that should be fixed in a follow-up so the two halves stay
  // in lockstep.
  const shouldRepoolTemporal =
    body.action === "reject" ||
    body.action === "attach_entity" ||
    body.action === "detach_entity" ||
    body.action === "edit_numerics";
  if (shouldRepoolTemporal) {
    try {
      const { recomputeEdgeTemporalsForSpace } = await import(
        "@/lib/evidence/recompute-edge-temporals"
      );
      await recomputeEdgeTemporalsForSpace(db, spaceId);
    } catch (err) {
      console.warn(
        "[evidence PATCH] temporal repool soft-failed:",
        err,
      );
    }
  }

  return NextResponse.json({ row: updated as EvidenceRegistryRow });
}
