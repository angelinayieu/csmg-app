// ── POST /api/canvas/prototype ────────────────────────────────────
//
// Build an interactive HTML prototype from a TechSpec (Opus + the UI agent
// skill). Output is sanitized server-side and rendered client-side in a
// sandboxed iframe. Telemetry via instrumentedLLMCall.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { composePrototypeHtml } from "@/lib/objective-canvas/tech-spec/compose-prototype";
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
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }
  const spec = body.spec;
  if (!spec || typeof spec.title !== "string") {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const taste = await buildTasteDesignContext(auth.supabase, spaceId);

  try {
    const html = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:prototype",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: { mode: "generate", taste_applied: taste.hasContent },
      },
      () => composePrototypeHtml(spec, taste),
    );
    return NextResponse.json({ html });
  } catch (err) {
    // Same structured-error shape as /canvas/specforge/tech-spec so the
    // client can surface "credit exhausted" / "model 404'd" / "timeout"
    // with actionable text instead of "Generation failed" (which read as
    // a black-screen empty card on the board).
    const e = err as { status?: number; message?: string; name?: string } | null;
    const message = (e?.message ?? "").trim() || "prototype generation failed";
    console.error("[prototype] generation failed:", err);
    const lower = message.toLowerCase();
    const isCredit =
      lower.includes("credit balance is too low") ||
      lower.includes("insufficient_quota");
    const isTimeout =
      e?.name === "AbortError" ||
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      e?.status === 408 ||
      e?.status === 524;
    const isModel404 =
      e?.status === 404 ||
      lower.includes("not_found_error") ||
      lower.includes("model_not_found");
    const status = isCredit ? 402 : isTimeout ? 504 : 502;
    return NextResponse.json(
      {
        error: message,
        code: isCredit
          ? "credit_exhausted"
          : isTimeout
            ? "timeout"
            : isModel404
              ? "model_not_found"
              : "generation_failed",
        model: BEST_CLAUDE_MODEL,
      },
      { status },
    );
  }
}
