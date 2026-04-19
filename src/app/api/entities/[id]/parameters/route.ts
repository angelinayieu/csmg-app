// ── Entity parameters (Phase 18) ──
//
// GET  /api/entities/[id]/parameters
//   → { parameters: InstrumentParameters }   // resolved with category default fallback
//
// PUT  /api/entities/[id]/parameters
//   body: { parameters: Partial<InstrumentParameters> }
//   → { parameters: InstrumentParameters }   // clamped + persisted
//
// User-edited values persist on `entities.parameters` JSONB. Reads always
// resolve via `getEntityParameters()` so consumers get a complete object
// even when nothing has been saved.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  clampParameters,
  getEntityParameters,
  type InstrumentParameters,
} from "@/lib/lab-formulas";

export const maxDuration = 10;

async function ownsEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  entityId: string,
  userId: string,
): Promise<{ entity: { id: string; entity_category: string | null; parameters: Record<string, unknown> | null } | null; error?: string }> {
  const { data, error } = await db
    .from("entities")
    .select("id, space_id, entity_category, parameters, spaces!inner(user_id)")
    .eq("id", entityId)
    .single();
  if (error || !data) return { entity: null, error: "Entity not found" };
  const ownerId = (data as { spaces: { user_id: string } }).spaces.user_id;
  if (ownerId !== userId) return { entity: null, error: "Not authorized" };
  return {
    entity: {
      id: data.id,
      entity_category: data.entity_category,
      parameters: data.parameters,
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { entity, error } = await ownsEntity(db, id, user.id);
  if (error || !entity) {
    return NextResponse.json({ error: error ?? "Entity not found" }, { status: 404 });
  }

  const resolved = getEntityParameters({
    parameters: entity.parameters,
    entity_category: entity.entity_category,
  });
  return NextResponse.json({ parameters: resolved });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    parameters: Partial<InstrumentParameters>;
  }>(request);
  if (parseError) return parseError;
  if (!body.parameters || typeof body.parameters !== "object") {
    return NextResponse.json({ error: "parameters required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { entity, error: ownErr } = await ownsEntity(db, id, user.id);
  if (ownErr || !entity) {
    return NextResponse.json({ error: ownErr ?? "Entity not found" }, { status: 404 });
  }

  // Resolve current effective parameters, then overlay user's partial,
  // then clamp. This way clients can PUT just the parameter that changed.
  const current = getEntityParameters({
    parameters: entity.parameters,
    entity_category: entity.entity_category,
  });
  const next = clampParameters({
    K: typeof body.parameters.K === "number" ? body.parameters.K : current.K,
    tau: typeof body.parameters.tau === "number" ? body.parameters.tau : current.tau,
    rho: typeof body.parameters.rho === "number" ? body.parameters.rho : current.rho,
    alpha: typeof body.parameters.alpha === "number" ? body.parameters.alpha : current.alpha,
  });

  try {
    const { error: updErr } = await db
      .from("entities")
      .update({ parameters: next })
      .eq("id", id);
    if (updErr) {
      console.warn("[entities/parameters PUT]", updErr);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
    return NextResponse.json({ parameters: next });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
