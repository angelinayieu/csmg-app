// ── POST /api/synergy/sessions/[id]/objective/detect ──
//
// Reads the session's board, asks the LLM to infer the user's actual
// objective (statement + constraints + success_criteria), and returns
// the inferred values WITHOUT auto-persisting. The client renders the
// result in an editable card; saving is a separate PATCH call.
//
// Why not auto-save? The user should see "AI-detected" provenance and
// have the chance to edit before committing. Mirrors the
// idea-synthesizer detectObjective pattern.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  DETECT_OBJECTIVE_SCHEMA,
  DETECT_OBJECTIVE_SYSTEM,
} from "@/lib/synergy/process-prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id, title")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: nodeRows } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  const nodes = (nodeRows ?? []) as DbNode[];

  // Empty boards yield empty objectives — return a neutral result
  // rather than spending an LLM call on whitespace.
  const visible = nodes.filter((n) => n.kind !== "user");
  if (visible.length === 0) {
    return NextResponse.json({
      objective: {
        statement: "",
        constraints: [],
        success_criteria: [],
      },
    });
  }

  const boardSummary = visible
    .map((n) => {
      const parent = nodes.find((p) => p.id === n.parent_id);
      const parentHint = parent ? ` (under: ${parent.label})` : "";
      return `[${n.kind}] ${n.label}${parentHint}`;
    })
    .join("\n");

  const userMsg = `Brainstorm title: ${session.title}\n\nBoard contents:\n${boardSummary}`;

  try {
    const parsed = await llmJSON<{
      statement: string;
      constraints: string[];
      success_criteria: string[];
    }>({
      system: DETECT_OBJECTIVE_SYSTEM,
      user: userMsg,
      maxTokens: 1024,
      temperature: 0.3,
      responseSchema: DETECT_OBJECTIVE_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });

    return NextResponse.json({
      objective: {
        statement: parsed.statement?.trim() ?? "",
        constraints: (parsed.constraints ?? [])
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 5),
        success_criteria: (parsed.success_criteria ?? [])
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 5),
      },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/.../objective/detect] error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }
}
