// ── POST /api/canvas/tech-spec/refine-section ─────────────────────
//
// The per-section feedback loop: regenerate ONE section of the tech spec
// by applying its pending improvements (Improve-op outputs + attached
// feedback cards) against its prior versions. The whiteboard updates the
// section in place and flashes a diff highlight.
//
// Body:    { spaceId, spec, sectionId, pendingImprovements[], versionHistory[] }
// Returns: { value }   // the NEW value for spec[sectionId]

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { composeRefineSection } from "@/lib/objective-canvas/tech-spec/compose-section-ops";
import { asSectionId } from "@/lib/objective-canvas/tech-spec/sections";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  spaceId?: string;
  spec?: TechSpec | null;
  sectionId?: string;
  pendingImprovements?: Array<{ source?: string; content?: string }>;
  versionHistory?: unknown[];
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

  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }
  if (!sectionId) {
    return NextResponse.json({ error: "Missing or unknown sectionId" }, { status: 400 });
  }
  if (!body.spec || typeof body.spec.title !== "string") {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }

  const pending = Array.isArray(body.pendingImprovements)
    ? body.pendingImprovements
        .map((p) => ({
          source: typeof p?.source === "string" ? p.source : "card",
          content: typeof p?.content === "string" ? p.content.trim() : "",
        }))
        .filter((p) => p.content)
    : [];
  if (!pending.length) {
    return NextResponse.json(
      { error: "no pending improvements to apply" },
      { status: 400 },
    );
  }

  const history = Array.isArray(body.versionHistory)
    ? body.versionHistory.slice(-5)
    : [];

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const value = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:tech_spec_refine_section",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: { sectionId, pendingCount: pending.length },
      },
      () =>
        composeRefineSection({
          spec: body.spec as TechSpec,
          sectionId,
          pendingImprovements: pending,
          versionHistory: history,
        }),
    );
    return NextResponse.json({ value });
  } catch (err) {
    console.error("[tech-spec/refine-section] failed:", err);
    return NextResponse.json({ error: "Refine failed" }, { status: 502 });
  }
}
