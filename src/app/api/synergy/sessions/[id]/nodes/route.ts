// ── PUT /api/synergy/sessions/[id]/nodes ──
//
// Replace-all-nodes save. The client sends the full node list every
// time; we delete + insert under the same session. Simpler than diffing
// for Phase 1 (the idea-synthesizer takes the same approach) and the
// debounced 750ms client-side throttle keeps this cheap.
//
// Two FK considerations:
//   1. parent_id references the same table — must insert parents before
//      children. The client preserves this order (parent always created
//      before children in handleAIAugment / addNodeFromPanel), so we can
//      insert in the order the client sends.
//   2. brainstorm_strokes has no FK to nodes, so node deletion is safe
//      even when strokes exist.
//
// Ownership: RLS gates the delete + insert (session_id must belong to
// the calling user). No explicit owner check needed.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { NodeKind } from "@/lib/synergy/types";

interface IncomingNode {
  id?: string;
  parent_id?: string | null;
  kind?: NodeKind;
  label?: string;
  meta?: string | null;
  x?: number;
  y?: number;
}

interface Body {
  nodes?: unknown;
}

const VALID_KINDS: NodeKind[] = [
  "core",
  "branch",
  "insight",
  "question",
  "action",
  "user",
  "variation",
  "ranking",
];

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  if (!Array.isArray(body.nodes)) {
    return NextResponse.json({ error: "nodes must be an array" }, { status: 400 });
  }
  if (body.nodes.length > 2000) {
    return NextResponse.json({ error: "too many nodes (max 2000)" }, { status: 400 });
  }

  // Validate + coerce each row. Reject the whole batch on any invalid row
  // so the database never lands in a partial state.
  const rows: Array<{
    id: string;
    session_id: string;
    parent_id: string | null;
    kind: NodeKind;
    label: string;
    meta: string | null;
    x: number;
    y: number;
  }> = [];
  for (const raw of body.nodes as IncomingNode[]) {
    if (
      typeof raw.id !== "string" ||
      typeof raw.label !== "string" ||
      typeof raw.kind !== "string" ||
      !VALID_KINDS.includes(raw.kind as NodeKind) ||
      typeof raw.x !== "number" ||
      typeof raw.y !== "number"
    ) {
      return NextResponse.json({ error: "invalid node row" }, { status: 400 });
    }
    rows.push({
      id: raw.id,
      session_id: sessionId,
      parent_id: typeof raw.parent_id === "string" ? raw.parent_id : null,
      kind: raw.kind as NodeKind,
      label: raw.label.slice(0, 1000),
      meta: typeof raw.meta === "string" ? raw.meta.slice(0, 4000) : null,
      x: raw.x,
      y: raw.y,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // First verify session ownership via a select — RLS would also block
  // the delete, but checking first lets us return 404 vs an opaque 500.
  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Delete-then-insert is the simplest approach. For Phase 1 boards
  // (<200 nodes typical) this is well under 100ms. Wrap in a single
  // RPC call later if we ever see saves > ~1s on real boards.
  const { error: deleteError } = await db
    .from("brainstorm_nodes")
    .delete()
    .eq("session_id", sessionId);
  if (deleteError) {
    console.error("[/api/synergy/sessions/[id]/nodes PUT] delete error:", deleteError);
    return NextResponse.json(
      { error: sanitizeErrorMessage(deleteError) },
      { status: 500 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: insertError } = await db.from("brainstorm_nodes").insert(rows);
  if (insertError) {
    console.error("[/api/synergy/sessions/[id]/nodes PUT] insert error:", insertError);
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertError) },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
