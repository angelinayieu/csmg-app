// ── POST /api/canvas/specforge/tech-spec ──────────────────────────
//
// The culmination of a SpecForge run: turn the chain's accumulated
// synthesis into an engineering-grade TechSpec (architecture + data model
// + build phases + a first-class ui_plan) via Opus + the UI agent skill.
//
// Optionally vision-analyzes UI-inspiration images the user pasted on the
// board (Claude vision, reusing llmGenerate's multimodal path) and folds
// the extracted design cues into the ui_plan. Telemetry via
// instrumentedLLMCall. Result lives on the board (tech-spec card).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmGenerate, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { extractJSON } from "@/lib/web-search";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import {
  composeTechSpec,
  renderTechSpecMarkdown,
} from "@/lib/objective-canvas/tech-spec/compose-tech-spec";

export const runtime = "nodejs";
export const maxDuration = 300;

const VISION_MODEL = BEST_FAST_CLAUDE_MODEL;
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type AllowedMime = (typeof ALLOWED_MIME)[number];

interface InspirationImage {
  base64?: string;
  mediaType?: string;
}

interface Body {
  spaceId?: string;
  idea?: string;
  forgeContext?: string;
  inspirationImages?: InspirationImage[];
}

/** Vision pre-pass: extract concrete UI design cues from pasted inspiration
 *  images. Soft-fails to [] — inspiration is an enrichment, never a blocker. */
async function analyzeInspiration(
  images: { base64: string; mediaType: AllowedMime }[],
): Promise<string[]> {
  if (!images.length) return [];
  try {
    const text = await llmGenerate({
      provider: "anthropic",
      model: VISION_MODEL,
      maxTokens: 1200,
      temperature: 0.2,
      system:
        "You are a UI design analyst. The user pasted these images as visual inspiration for a product they are building. Extract CONCRETE, reusable design cues — layout structure, color palette, density, typography feel, component patterns, motion/vibe. Return ONLY a JSON array of short strings (8-14 cues total across all images). No prose.",
      user: "Extract the design cues from these inspiration images.",
      images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })),
    });
    try {
      const parsed = extractJSON<unknown>(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean)
          .slice(0, 16);
      }
    } catch {
      /* fall through to line-splitting */
    }
    return text
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter((l) => l.length > 2)
      .slice(0, 16);
  } catch (err) {
    console.warn("[tech-spec] inspiration vision failed (soft):", err);
    return [];
  }
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

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const forgeContext =
    typeof body.forgeContext === "string" ? body.forgeContext.trim() : "";
  if (!idea && !forgeContext) {
    return NextResponse.json(
      { error: "idea or forgeContext required" },
      { status: 400 },
    );
  }

  // Normalize inspiration images (base64 + an allowed MIME type), cap to 4.
  const images = (Array.isArray(body.inspirationImages) ? body.inspirationImages : [])
    .map((im) => ({
      base64: typeof im?.base64 === "string" ? im.base64 : "",
      mediaType: (ALLOWED_MIME as readonly string[]).includes(
        im?.mediaType ?? "",
      )
        ? (im!.mediaType as AllowedMime)
        : null,
    }))
    .filter((im): im is { base64: string; mediaType: AllowedMime } =>
      Boolean(im.base64 && im.mediaType),
    )
    .slice(0, 4);

  try {
    const inspirationCues = await analyzeInspiration(images);

    const spec = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:tech_spec",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: {
          hasInspiration: images.length > 0,
          inspirationCues: inspirationCues.length,
        },
      },
      () =>
        composeTechSpec({
          idea: idea || forgeContext.slice(0, 400),
          forgeContext,
          inspirationCues,
        }),
    );

    return NextResponse.json({
      spec,
      markdown: renderTechSpecMarkdown(spec),
      inspirationCues,
    });
  } catch (err) {
    console.error("[tech-spec] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
