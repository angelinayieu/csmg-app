// ── POST /api/canvas/prototype-react ─────────────────────────────
//
// T2 sibling of /api/canvas/prototype: returns multi-file React (for
// Sandpack) instead of a single HTML doc. Shares the taste-fetch + skill
// stack with the T1 route. Sanitizer runs server-side; rejected output
// degrades to a friendly error component, not a 500.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { composePrototypeReact } from "@/lib/objective-canvas/tech-spec/compose-prototype-react";
import { buildTasteDesignContext } from "@/lib/objective-canvas/tech-spec/taste-design-block";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  spaceId?: string;
  spec?: TechSpec;
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
  if (!spaceId || !body.spec || typeof body.spec.title !== "string") {
    return NextResponse.json(
      { error: "spaceId and spec required" },
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

  const spec = body.spec;
  const taste = await buildTasteDesignContext(auth.supabase, spaceId);

  try {
    const result = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:prototype_react",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: {
          mode: "generate_react",
          taste_applied: taste.hasContent,
        },
      },
      () => composePrototypeReact(spec, taste),
    );
    return NextResponse.json({
      entry: result.prototype.entry,
      files: result.prototype.files,
      sanitizerOk: result.sanitizer.ok,
      sanitizerReason: result.sanitizer.reason,
    });
  } catch (err) {
    console.error("[prototype-react] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
