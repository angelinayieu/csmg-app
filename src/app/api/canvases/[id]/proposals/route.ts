// GET /api/canvases/[id]/proposals
//
// Sprint 3 — list every pending proposal on a canvas, grouped by note →
// span. Hydrates entity name + space name + target-canvas title so the
// ProposalRail can render a self-contained card without extra lookups.
//
// Accepts `?include=superseded,rejected` to see audit history. Default
// returns only pending proposals.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { ConceptProposal, ProposalGroup } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

type HydratedProposal = ConceptProposal & {
  entity_name: string | null;
  entity_space_name: string | null;
  target_canvas_title: string | null;
};

const ALLOWED_STATUSES = new Set([
  "pending",
  "accepted",
  "rejected",
  "dismissed",
  "superseded",
  "expired",
]);

export async function GET(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: canvasId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership gate
  const { data: canvas } = await db
    .from("canvases")
    .select("id")
    .eq("id", canvasId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const includeRaw = searchParams.get("include") ?? "";
  const statuses = new Set(
    ["pending", ...includeRaw.split(",")].filter(
      (s) => s.length > 0 && ALLOWED_STATUSES.has(s),
    ),
  );

  const { data: proposals, error } = (await db
    .from("concept_proposals")
    .select("*")
    .eq("owner_id", user.id)
    .eq("canvas_id", canvasId)
    .in("status", Array.from(statuses))
    .order("note_id", { ascending: true })
    .order("start_offset", { ascending: true, nullsFirst: false })
    .order("confidence", { ascending: false })) as {
    data: ConceptProposal[] | null;
    error: unknown;
  };

  if (error) {
    console.error("[canvas proposals list] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch proposals" },
      { status: 500 },
    );
  }

  const rows = proposals ?? [];

  // Hydrate entity + target canvas info
  const entityIds = Array.from(
    new Set(rows.map((p) => p.entity_id).filter((id): id is string => !!id)),
  );
  const targetCanvasIds = Array.from(
    new Set(
      rows
        .map((p) => p.target_canvas_id)
        .filter((id): id is string => !!id),
    ),
  );

  const entityById = new Map<
    string,
    { name: string; space_id: string; space_name: string | null }
  >();
  if (entityIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("id, name, space_id")
      .in("id", entityIds)) as {
      data: Array<{ id: string; name: string; space_id: string }> | null;
    };
    const spaceIds = Array.from(
      new Set((ents ?? []).map((e) => e.space_id)),
    );
    const spaceNameById = new Map<string, string>();
    if (spaceIds.length > 0) {
      const { data: spaces } = (await db
        .from("spaces")
        .select("id, name")
        .in("id", spaceIds)) as {
        data: Array<{ id: string; name: string }> | null;
      };
      for (const s of spaces ?? []) spaceNameById.set(s.id, s.name);
    }
    for (const e of ents ?? []) {
      entityById.set(e.id, {
        name: e.name,
        space_id: e.space_id,
        space_name: spaceNameById.get(e.space_id) ?? null,
      });
    }
  }

  const canvasTitleById = new Map<string, string>();
  if (targetCanvasIds.length > 0) {
    const { data: tc } = (await db
      .from("canvases")
      .select("id, title")
      .in("id", targetCanvasIds)) as {
      data: Array<{ id: string; title: string }> | null;
    };
    for (const c of tc ?? []) canvasTitleById.set(c.id, c.title);
  }

  const hydrated: HydratedProposal[] = rows.map((p) => {
    const e = p.entity_id ? entityById.get(p.entity_id) ?? null : null;
    return {
      ...p,
      entity_name: e?.name ?? p.proposed_entity_name ?? null,
      entity_space_name: e?.space_name ?? null,
      target_canvas_title: p.target_canvas_id
        ? canvasTitleById.get(p.target_canvas_id) ?? null
        : null,
    };
  });

  // Group by note → span
  const byNote = new Map<string, ProposalGroup>();
  for (const p of hydrated) {
    const noteId = p.note_id;
    let group = byNote.get(noteId);
    if (!group) {
      group = {
        note_id: noteId,
        note_text: "",
        spans: [],
      };
      byNote.set(noteId, group);
    }

    // Reuse the first proposal's anchored_text as the note preview — the
    // full note text would require re-opening the tldraw snapshot and
    // extracting, which is expensive here. The ProposalRail will display
    // per-span anchored_text directly, so the note-level text is optional.
    if (!group.note_text && p.anchored_text) {
      group.note_text = p.anchored_text;
    }

    const spanKey = `${p.start_offset ?? "null"}:${p.end_offset ?? "null"}`;
    let span = group.spans.find(
      (s) =>
        `${s.start_offset ?? "null"}:${s.end_offset ?? "null"}` === spanKey,
    );
    if (!span) {
      span = {
        start_offset: p.start_offset,
        end_offset: p.end_offset,
        anchored_text: p.anchored_text,
        proposals: [],
      };
      group.spans.push(span);
    }
    span.proposals.push(p);
  }

  return NextResponse.json({ groups: Array.from(byNote.values()) });
}
