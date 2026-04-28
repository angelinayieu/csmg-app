// POST /api/spaces/[id]/subjects/from-lasso
//
// Atomic gesture: turn a canvas selection into a saved System +
// a Subject scoped to that System. Mirrors the user mental model
// of "I lassoed these entities; treat this region as the subject of
// my next experiment."
//
// Body:
//   {
//     name: string,                    // subject + system name
//     focus_kind?: SubjectFocusKind,   // default "topic"
//     focus_label?: string,            // default = name
//     entity_ids: string[],            // from the lasso extractor
//     description?: string,
//   }
//
// Two-step persistence (intentionally NOT a DB transaction since
// systems + subjects sit in different domains; we follow the
// same belt-and-suspenders pattern the rest of the codebase uses
// for cross-table writes — log + soft-fail per step).
//
// On failure of the System insert: returns 500 with no rows touched.
// On failure of the Subject insert AFTER System landed: returns 200
// with system_id populated + subject=null + warning. Caller can
// retry the subject creation against the persisted system.
//
// Response: { system: SystemRow, subject: Subject | null,
//             warning?: string }

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";
import type { Subject, SubjectFocusKind } from "@/types/subject";

export const runtime = "nodejs";

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

interface RequestBody {
  name?: string;
  focus_kind?: SubjectFocusKind;
  focus_label?: string;
  entity_ids?: string[];
  description?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<RequestBody>(request);
  if (bodyErr) return bodyErr;
  if (!body?.name || typeof body.name !== "string" || body.name.trim().length < 1) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body.entity_ids) ||
    body.entity_ids.length === 0 ||
    body.entity_ids.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json(
      { error: "entity_ids must be a non-empty string array" },
      { status: 400 },
    );
  }
  const focusKind: SubjectFocusKind = VALID_FOCUS_KINDS.includes(
    body.focus_kind as SubjectFocusKind,
  )
    ? (body.focus_kind as SubjectFocusKind)
    : "topic";

  const trimmedName = body.name.trim().slice(0, 200);
  const focusLabel = (body.focus_label ?? trimmedName).trim().slice(0, 200);
  const description =
    body.description && typeof body.description === "string"
      ? body.description.trim().slice(0, 1000)
      : null;

  // Step 1 — auto-resolve edges among the selected entities, then
  // create the System row.
  const { data: relevantEdges } = await db
    .from("edges")
    .select("id")
    .eq("space_id", spaceId)
    .in("source_entity_id", body.entity_ids)
    .in("target_entity_id", body.entity_ids);
  const edgeIds = (relevantEdges ?? []).map(
    (r: { id: string }) => r.id,
  );

  const { data: systemRow, error: sysErr } = await db
    .from("systems")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      name: `${trimmedName} (lasso scope)`,
      description:
        description ??
        `Saved from canvas lasso for the "${trimmedName}" subject. ${body.entity_ids.length} entities; ${edgeIds.length} edges auto-resolved.`,
      entity_ids: body.entity_ids,
      edge_ids: edgeIds,
      source_kind: "user_lasso",
    })
    .select("*")
    .single();

  if (sysErr || !systemRow) {
    console.error("[subjects/from-lasso] system insert failed:", sysErr);
    return NextResponse.json(
      {
        error: `System creation failed: ${sysErr?.message ?? "unknown"}`,
      },
      { status: 500 },
    );
  }

  // Step 2 — create the Subject scoped to the new System.
  const { data: subjectRow, error: subjErr } = await db
    .from("subjects")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      name: trimmedName,
      description,
      focus_kind: focusKind,
      focus_label: focusLabel,
      scope_system_id: systemRow.id,
      artifact_state: "bare_topic",
      conditions: {},
      entity_param_overrides: {},
      source_kind: "lasso_selection",
      status: "active",
    })
    .select("*")
    .single();

  if (subjErr || !subjectRow) {
    console.warn(
      "[subjects/from-lasso] subject insert failed; system row already saved:",
      subjErr,
    );
    return NextResponse.json({
      system: systemRow,
      subject: null,
      warning: `System saved but subject creation failed: ${subjErr?.message ?? "unknown"}. Retry with system_id=${systemRow.id}.`,
    });
  }

  return NextResponse.json({
    system: systemRow,
    subject: subjectRow as Subject,
  });
}
