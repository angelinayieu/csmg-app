// POST /api/objective/[spaceId]/comments/[commentId]/analyze
//
// The "Analyze on board" extension. The client posts the live text of the
// comment's target shapes (the server can't read tldraw state) plus the
// comment body. We treat the body as a LENS and the targets as MATERIAL,
// and ask Claude for 3–6 concrete analysis cards that the client drops
// next to the comment as a connected cluster.
//
// We do NOT call into canvas-operations.ts directly — that's a client-side
// registry. Instead this route owns the prompt, returns structured cards,
// and the client materialises them via the existing card-deploy helpers.

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

interface AnalyzeBody {
  /** Live snapshot of each target shape (client-extracted). */
  targets?: Array<{ kind: string; title: string; body?: string }>;
}

export interface AnalysisCard {
  /** Short noun-phrase headline that fits a 240px card. */
  headline: string;
  /** 1–3 sentence body — substantive, references the targets by name. */
  body: string;
  /** Role: angle, gap, contradiction, next-step, or evidence-need. */
  role:
    | "angle"
    | "gap"
    | "contradiction"
    | "next-step"
    | "evidence-need";
}

interface AnalyzeResponse {
  cards: AnalysisCard[];
}

const SYSTEM_PROMPT = `You are a thinking partner running an AI extension on a knowledge whiteboard.

The user has left a COMMENT on one or more cards. Treat the comment as a LENS — the angle they want to look at the material through — and the targets as the MATERIAL. Produce 3 to 6 short analysis cards that, dropped onto the canvas, would push the user's thinking forward.

Each card must:
- Have a noun-phrase headline (<= 7 words) that names the specific point.
- Have a 1–3 sentence body that references the targets by their exact names/titles.
- Pick a role:
  · "angle"           — a useful re-framing
  · "gap"             — something missing the comment + targets reveal
  · "contradiction"   — two targets that disagree, or a target that conflicts with the comment
  · "next-step"       — a concrete experiment / draft / probe
  · "evidence-need"   — a piece of information needed to decide
- Be SPECIFIC. No "consider doing X". No "great question". No filler.
- Vary the roles — don't return six "next-step" cards unless the comment explicitly asks for an action list.

If the comment is empty, treat the comment as the implicit prompt "What's interesting about this group?" and return 3–4 cards.
If there are no targets, treat the comment as a standalone prompt and return 3 cards grounded in the comment alone.

Return strict JSON: { "cards": [ { "headline": "...", "body": "...", "role": "..." }, ... ] }`;

function renderTargets(
  targets: Array<{ kind: string; title: string; body?: string }>,
): string {
  if (!targets || targets.length === 0) return "(no targets — comment is floating)";
  return targets
    .map((t, i) => {
      const head = `${i + 1}. [${t.kind}] ${t.title}`;
      return t.body ? `${head}\n   ${t.body}` : head;
    })
    .join("\n");
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ spaceId: string; commentId: string }> },
) {
  const { spaceId, commentId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body } = await safeJsonParse<AnalyzeBody>(request);
  const targets = Array.isArray(body?.targets)
    ? body.targets.slice(0, 24).map((t) => ({
        kind: String(t.kind ?? "shape").slice(0, 40),
        title: String(t.title ?? "").slice(0, 160),
        body: t.body ? String(t.body).slice(0, 400) : undefined,
      }))
    : [];

  // Fetch the comment server-side — don't trust the client for the prompt
  // text (and we need to bounce the row back so the client can update its
  // optimistic state without a re-fetch).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let commentBody = "";
  try {
    const { data: row, error } = await db
      .from("comments")
      .select("body")
      .eq("id", commentId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (error) throw error;
    commentBody = String(row?.body ?? "").slice(0, 1500);
  } catch (err) {
    console.warn("[comments/analyze] read", err);
  }

  const userPrompt = `Comment (the LENS): "${commentBody || "(empty — treat as: What's interesting about this group?)"}"

Targets the comment is attached to (the MATERIAL — ${targets.length} item${targets.length === 1 ? "" : "s"}):
${renderTargets(targets)}

Produce the analysis cards now.`;

  try {
    const result = await llmJSON<AnalyzeResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 1200,
      temperature: 0.55,
      fallback: {
        cards: [
          {
            headline: "Couldn't analyze",
            body: "The analyzer didn't return a useful result. Try editing the comment with a more specific lens, or re-anchor to a tighter selection.",
            role: "next-step",
          },
        ],
      },
    });

    const cards = Array.isArray(result.cards)
      ? result.cards
          .slice(0, 6)
          .map((c) => ({
            headline: String(c?.headline ?? "").slice(0, 120),
            body: String(c?.body ?? "").slice(0, 600),
            role:
              c?.role === "angle" ||
              c?.role === "gap" ||
              c?.role === "contradiction" ||
              c?.role === "next-step" ||
              c?.role === "evidence-need"
                ? c.role
                : ("angle" as AnalysisCard["role"]),
          }))
          .filter((c) => c.headline && c.body)
      : [];

    return NextResponse.json({ cards });
  } catch (err) {
    console.warn("[comments/analyze]", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
