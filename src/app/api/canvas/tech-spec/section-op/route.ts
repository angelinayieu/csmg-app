// ── POST /api/canvas/tech-spec/section-op ─────────────────────────
//
// Inline ops the user fires on a selected text range inside a section of
// the expanded tech-spec card: ask | variations | improve. Result is plain
// text — the whiteboard renders it as a spec-feedback-card linked back to
// the source section.
//
// Body:    { spaceId, spec, sectionId, selection, kind, prompt? }
// Returns: { content }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import {
  composeSectionOp,
  type SectionOpKind,
} from "@/lib/objective-canvas/tech-spec/compose-section-ops";
import { asSectionId } from "@/lib/objective-canvas/tech-spec/sections";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const VALID_KINDS: SectionOpKind[] = ["ask", "variations", "improve"];

interface Body {
  spaceId?: string;
  spec?: TechSpec | null;
  sectionId?: string;
  selection?: string;
  kind?: SectionOpKind;
  prompt?: string;
}

export async function POST(req: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
  const sectionId = asSectionId(body.sectionId);
  const kind = VALID_KINDS.includes(body.kind as SectionOpKind)
    ? (body.kind as SectionOpKind)
    : null;
  const selection = typeof body.selection === "string" ? body.selection : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";

  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }
  if (!sectionId) {
    return NextResponse.json({ error: "Missing or unknown sectionId" }, { status: 400 });
  }
  if (!kind) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body.spec || typeof body.spec.title !== "string") {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }
  // Ask requires either a selection or a prompt (something to answer about).
  if (kind === "ask" && !selection.trim() && !prompt.trim()) {
    return NextResponse.json(
      { error: "ask: provide selection and/or prompt" },
      { status: 400 },
    );
  }

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const content = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: `objective:tech_spec_section_${kind}`,
        modelHint: BEST_CLAUDE_MODEL,
        metadata: { sectionId, kind },
      },
      () =>
        composeSectionOp(kind, {
          spec: body.spec as TechSpec,
          sectionId,
          selection,
          prompt,
        }),
    );
    return NextResponse.json({ content });
  } catch (err) {
    console.error("[tech-spec/section-op] failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
