// ── /api/spaces/[id]/subjects ────────────────────────────────────
//
// GET  → list subjects in a space (active by default; `?status=archived`).
// POST → create one. Body: CreateSubjectInput. Server fills defaults
//        for any missing modulator values + validates source pointers
//        (baseline_snapshot_id, scope_system_id) belong to this space.
//
// Subjects are owned per (space, user) — RLS enforces but we
// double-check via verifySpaceOwnership for an explicit 403 error.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  defaultConditions,
  STARTER_MODULATORS,
} from "@/lib/subjects/modulators";
import type {
  CreateSubjectInput,
  ListSubjectsResponse,
  Subject,
  SubjectFocusKind,
} from "@/types/subject";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const VALID_FOCUS_KINDS: SubjectFocusKind[] = [
  "person",
  "document",
  "product",
  "topic",
  "environment",
  "system",
  "data",
  "reaction",
  "other",
];

// ── GET ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") ?? "active";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let query = db
    .from("subjects")
    .select("*")
    .eq("space_id", spaceId)
    .order("updated_at", { ascending: false });
  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[subjects list] fetch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payload: ListSubjectsResponse = {
    subjects: (data ?? []) as Subject[],
    computed_at: new Date().toISOString(),
  };
  return NextResponse.json(payload);
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<CreateSubjectInput>>(request);
  if (parseError) return parseError;

  // ── Validate identity ────────────────────────────────────────
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  const focus_label =
    typeof body?.focus_label === "string" ? body.focus_label.trim() : "";
  if (!focus_label) {
    return NextResponse.json(
      { error: "focus_label is required" },
      { status: 400 },
    );
  }
  const focus_kind = body?.focus_kind as SubjectFocusKind | undefined;
  if (!focus_kind || !VALID_FOCUS_KINDS.includes(focus_kind)) {
    return NextResponse.json(
      {
        error: `focus_kind must be one of: ${VALID_FOCUS_KINDS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Validate optional pointers ───────────────────────────────
  if (body.baseline_snapshot_id) {
    const { data: snap } = await db
      .from("twin_snapshots")
      .select("id, space_id")
      .eq("id", body.baseline_snapshot_id)
      .maybeSingle();
    if (!snap || snap.space_id !== spaceId) {
      return NextResponse.json(
        { error: "baseline_snapshot_id not found in this space" },
        { status: 400 },
      );
    }
  }
  if (body.scope_system_id) {
    const { data: sys } = await db
      .from("systems")
      .select("id, space_id")
      .eq("id", body.scope_system_id)
      .maybeSingle();
    if (!sys || sys.space_id !== spaceId) {
      return NextResponse.json(
        { error: "scope_system_id not found in this space" },
        { status: 400 },
      );
    }
  }

  // ── Conditions: merge with defaults so the subject always has
  //    every modulator key set (avoids "undefined slider" UX). ──
  const conditions: Record<string, number> = {
    ...defaultConditions(STARTER_MODULATORS),
    ...(body.conditions ?? {}),
  };

  // ── Insert ───────────────────────────────────────────────────
  const insertRow = {
    space_id: spaceId,
    user_id: user.id,
    name,
    description: body.description ?? null,
    focus_kind,
    focus_label,
    artifact_state: body.artifact_state ?? "bare_topic",
    baseline_snapshot_id: body.baseline_snapshot_id ?? null,
    scope_system_id: body.scope_system_id ?? null,
    conditions,
    entity_param_overrides: body.entity_param_overrides ?? {},
    source_kind: body.source_kind ?? "manual",
    source_ref: body.source_ref ?? null,
    status: "active" as const,
  };

  const { data: inserted, error: insertErr } = await db
    .from("subjects")
    .insert(insertRow)
    .select("*")
    .single();
  if (insertErr) {
    console.warn("[subjects create] insert failed:", insertErr);
    return NextResponse.json(
      { error: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { subject: inserted as Subject },
    { status: 201 },
  );
}
