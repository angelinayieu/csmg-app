// POST /api/objective/[spaceId]/board-chat
//
// AI chat scoped to ONE whiteboard, with an opt-in cross-whiteboard mode that
// adds the user's library_objects from every OTHER space as ambient context.
// The client extracts a tight snapshot of the live board (titles + one-liner
// bodies of every shape it understands) and posts it alongside the question;
// the server stitches in space metadata + the chosen scope and asks Claude
// for a focused, substantive answer.
//
// Mirrors lasso-chat's contract (priorTurns + response string), so the panel
// can swap between them later without API surgery.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

interface BoardShape {
  /** Short label (e.g. "Objective", "Sticky note", "Card · Pain"). */
  kind: string;
  /** Plain-text one-liner the user would recognise. */
  title: string;
  /** Optional body / extracted content. Trimmed server-side. */
  body?: string;
}

interface BoardChatRequest {
  message: string;
  scope?: "board" | "cross";
  shapes?: BoardShape[];
  priorTurns?: Array<{ role: "user" | "assistant"; text: string }>;
}

interface BoardChatResponse {
  response: string;
}

const SYSTEM_PROMPT = `You are an AI thinking partner embedded in a Miro-style knowledge whiteboard. The user is sitting on a board they've been building and is asking you about it.

Reply in the user's own vocabulary — re-use the exact card titles, objective phrasing and concepts they've put on the board rather than translating into generic strategy-speak.

Rules:
- Substantive content that the user can copy back onto the board. No filler ("great question", "certainly").
- Default to 3-6 sentences. Use a short bulleted list ONLY when the user explicitly asks for options, steps, or a comparison.
- When the user asks you to "generate" / "draft" / "write" something, produce the full thing inline, not a meta-description of what you'd produce.
- If cross-board context is provided, you may reference patterns from the other boards by their title, but stay grounded in THIS board's question.
- If the board snapshot is empty or thin, say so plainly in one sentence and ask for the missing piece.

Return strict JSON: { "response": "..." } — markdown inside the string is fine.`;

function trimShape(s: BoardShape): BoardShape {
  return {
    kind: String(s.kind ?? "shape").slice(0, 40),
    title: String(s.title ?? "").slice(0, 160),
    body: s.body ? String(s.body).slice(0, 400) : undefined,
  };
}

function renderShapes(shapes: BoardShape[]): string {
  if (shapes.length === 0) return "(empty board)";
  return shapes
    .map((s, i) => {
      const head = `${i + 1}. [${s.kind}] ${s.title}`;
      return s.body ? `${head}\n   ${s.body}` : head;
    })
    .join("\n");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body, error: parseError } =
    await safeJsonParse<BoardChatRequest>(request);
  if (parseError) return parseError;

  const message = (body.message ?? "").trim();
  if (!message)
    return NextResponse.json({ error: "message required" }, { status: 400 });

  const scope = body.scope === "cross" ? "cross" : "board";
  const shapes = Array.isArray(body.shapes)
    ? body.shapes.slice(0, 50).map(trimShape)
    : [];
  const priorTurns = Array.isArray(body.priorTurns)
    ? body.priorTurns.slice(-8)
    : [];

  // ── Space metadata: the objective title is the single most useful framing
  // hint the model gets. Soft-fail on missing rows. ────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let objectiveTitle = "";
  try {
    const { data } = await db
      .from("spaces")
      .select("name, title")
      .eq("id", spaceId)
      .maybeSingle();
    if (data) objectiveTitle = String(data.title ?? data.name ?? "").slice(0, 200);
  } catch {
    /* soft-fail */
  }

  // ── Cross-board context: every OTHER space the user owns, condensed to
  // {space title} → [recent library objects]. Capped so the prompt stays
  // small (the model decides what's relevant). ─────────────────────────────
  let crossBlock = "";
  if (scope === "cross") {
    try {
      const { data: otherSpaces } = await db
        .from("spaces")
        .select("id, name, title")
        .eq("user_id", user.id)
        .eq("archived", false)
        .neq("id", spaceId)
        .order("updated_at", { ascending: false })
        .limit(8);
      const ids = (otherSpaces ?? []).map((s: { id: string }) => s.id);
      if (ids.length > 0) {
        const { data: objs } = await db
          .from("library_objects")
          .select("space_id, name, kind, body")
          .in("space_id", ids)
          .order("updated_at", { ascending: false })
          .limit(36);
        const byBoard = new Map<string, { title: string; rows: string[] }>();
        for (const s of otherSpaces ?? []) {
          byBoard.set(s.id, {
            title: String(s.title ?? s.name ?? "(untitled)").slice(0, 80),
            rows: [],
          });
        }
        for (const o of (objs ?? []) as Array<{
          space_id: string;
          name: string;
          kind: string;
          body: string | null;
        }>) {
          const entry = byBoard.get(o.space_id);
          if (!entry || entry.rows.length >= 6) continue;
          const tail = o.body ? ` — ${String(o.body).slice(0, 120)}` : "";
          entry.rows.push(`  · [${o.kind}] ${String(o.name).slice(0, 80)}${tail}`);
        }
        const blocks: string[] = [];
        for (const v of byBoard.values()) {
          if (v.rows.length === 0) continue;
          blocks.push(`Board: ${v.title}\n${v.rows.join("\n")}`);
        }
        if (blocks.length > 0) {
          crossBlock = `\n\nOther boards the user has built (ambient context — reference by title if relevant):\n${blocks.join("\n\n")}`;
        }
      }
    } catch {
      /* cross-board is best-effort */
    }
  }

  const historyBlock =
    priorTurns.length > 0
      ? `\n\nConversation so far:\n${priorTurns
          .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.text}`)
          .join("\n")}`
      : "";

  const userPrompt = `Objective for THIS board: ${objectiveTitle || "(untitled)"}

On the board right now (${shapes.length} shape${shapes.length === 1 ? "" : "s"}):
${renderShapes(shapes)}${crossBlock}${historyBlock}

User: "${message.slice(0, 1200)}"

Respond.`;

  try {
    const result = await llmJSON<BoardChatResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 900,
      temperature: 0.55,
      fallback: {
        response:
          "I'm here — could you say more about what you'd like to dig into? I can see your board's shapes and (if cross-board is on) your other work.",
      },
    });

    return NextResponse.json({
      response: String(result.response ?? ""),
    });
  } catch (err) {
    console.warn("[objective/board-chat]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
