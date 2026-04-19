/**
 * /api/spaces/[id]/questions
 *
 *   GET  — list entity-level questions for this space. Optional ?entityId= filter.
 *   POST — create a new entity-level question. Body: { entity_id, question_text }.
 *
 * The question is stored with status="open". Eventually an agent can pick up
 * open questions, flip to "researching", and land results as claims + answer_text
 * with status="answered". For now, this endpoint just persists the intent.
 */

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import type { EntityQuestion } from "@/types/entity-question";

export const maxDuration = 15;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let query = db
    .from("entity_questions")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });

  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ questions: (data ?? []) as EntityQuestion[] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: bodyErr } = await safeJsonParse<{
    entity_id: string;
    question_text: string;
  }>(request);
  if (bodyErr) return bodyErr;

  const entityId = body?.entity_id?.trim();
  const text = body?.question_text?.trim();

  if (!entityId) {
    return NextResponse.json(
      { error: "entity_id required" },
      { status: 400 },
    );
  }
  if (!text || text.length < 3) {
    return NextResponse.json(
      { error: "question_text must be at least 3 characters" },
      { status: 400 },
    );
  }
  if (text.length > 1000) {
    return NextResponse.json(
      { error: "question_text too long (max 1000 chars)" },
      { status: 400 },
    );
  }

  // Verify entity belongs to this space (defensive — the FK would also catch it)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: entityRow, error: entityErr } = await db
    .from("entities")
    .select("id")
    .eq("id", entityId)
    .eq("space_id", spaceId)
    .maybeSingle();

  if (entityErr || !entityRow) {
    return NextResponse.json(
      { error: "Entity not found in this space" },
      { status: 404 },
    );
  }

  const { data, error } = await db
    .from("entity_questions")
    .insert({
      space_id: spaceId,
      entity_id: entityId,
      question_text: text,
      status: "open",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ question: data as EntityQuestion });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const questionId = url.searchParams.get("questionId");
  if (!questionId) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from("entity_questions")
    .delete()
    .eq("id", questionId)
    .eq("space_id", spaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
