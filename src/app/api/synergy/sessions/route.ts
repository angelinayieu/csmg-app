// ── /api/synergy/sessions ──
//
// GET  → list the authenticated user's brainstorm sessions, newest first.
// POST → create a new session. Optionally accepts { title, seedText }.
//        When seedText is provided, also creates a single "core" node
//        at the canvas origin so the user lands on a non-empty board.
//
// Ownership: enforced via RLS on brainstorm_sessions (owner_id = auth.uid()).
// We additionally set owner_id on insert so the SDK has it locally
// without a round-trip.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull sessions + a lightweight node count using a separate aggregate
  // query (Supabase doesn't support count subqueries inline).
  const { data: sessions, error } = await db
    .from("brainstorm_sessions")
    .select("id, title, state, objective_statement, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("[/api/synergy/sessions GET] error:", error);
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }

  const ids = (sessions ?? []).map((s: { id: string }) => s.id);
  let counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: nodes } = await db
      .from("brainstorm_nodes")
      .select("session_id")
      .in("session_id", ids);
    counts = new Map();
    for (const row of nodes ?? []) {
      counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    sessions: (sessions ?? []).map((s: { id: string }) => ({
      ...s,
      node_count: counts.get(s.id) ?? 0,
    })),
  });
}

interface CreateBody {
  title?: unknown;
  seedText?: unknown;
  /** Wave: MCQ-to-autopilot wiring. Homepage clarifier emits typed
   *  Q&A pairs (one per slot — variation_axis / target_metric /
   *  timeframe / etc). Persisted to brainstorm_sessions.clarifier_qa
   *  JSONB so the autopilot round handler can inject them as soft
   *  constraints into each round's LLM context. Shape matches
   *  TypedClarifierAnswer[] from src/types/clarifier-answer.ts. */
  clarifying_qa_pairs?: unknown;
  /** Optional source mode tag so downstream consumers can tell
   *  brainstorm_speed sessions apart from manually-created ones.
   *  Stored alongside the pairs in clarifier_qa.mode. */
  source_mode?: unknown;
}

/** Defensive shape-check for the clarifier pairs we'll persist. Trusts
 *  the structure but rejects obviously-malformed entries so a bad
 *  payload doesn't poison the row. */
function sanitizeClarifierPairs(raw: unknown): Array<{
  question: string;
  answer: string;
  slot?: string;
}> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ question: string; answer: string; slot?: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const question = typeof e.question === "string" ? e.question.trim().slice(0, 400) : "";
    const answer = typeof e.answer === "string" ? e.answer.trim().slice(0, 800) : "";
    if (!question || !answer) continue;
    const slot = typeof e.slot === "string" ? e.slot.slice(0, 40) : undefined;
    out.push(slot ? { question, answer, slot } : { question, answer });
  }
  // Cap at 8 so a bug-spamming client can't write unbounded JSON.
  return out.slice(0, 8);
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<CreateBody>(request);
  if (parseError) return parseError;

  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 200)
      : "Untitled brainstorm";
  const seedText =
    typeof body.seedText === "string" && body.seedText.trim().length > 0
      ? body.seedText.trim().slice(0, 400)
      : null;

  // Build the clarifier_qa JSONB only when the caller passed
  // non-empty MCQ pairs. Keeping the column null for empty input
  // means the autopilot route can skip injection cleanly with a
  // single null-check instead of an empty-array handler.
  const pairs = sanitizeClarifierPairs(body.clarifying_qa_pairs);
  const sourceMode =
    typeof body.source_mode === "string" ? body.source_mode.slice(0, 40) : undefined;
  const clarifier_qa =
    pairs.length > 0
      ? {
          pairs,
          captured_at: new Date().toISOString(),
          ...(sourceMode ? { mode: sourceMode } : {}),
        }
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertRow: Record<string, any> = { owner_id: user.id, title };
  if (clarifier_qa) insertRow.clarifier_qa = clarifier_qa;

  const { data: session, error } = await db
    .from("brainstorm_sessions")
    .insert(insertRow)
    .select("*")
    .single();

  if (error || !session) {
    console.error("[/api/synergy/sessions POST] error:", error);
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  let seedNode = null;
  if (seedText) {
    const { data: node, error: nodeError } = await db
      .from("brainstorm_nodes")
      .insert({
        session_id: session.id,
        kind: "core",
        label: seedText,
        x: 600,
        y: 360,
      })
      .select("*")
      .single();
    if (nodeError) {
      console.warn("[/api/synergy/sessions POST] seed insert failed:", nodeError);
    } else {
      seedNode = node;
    }
  }

  return NextResponse.json({ session, seedNode }, { status: 201 });
}
