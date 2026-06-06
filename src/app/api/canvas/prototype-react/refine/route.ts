// ── POST /api/canvas/prototype-react/refine ───────────────────────
//
// T2 sibling of /api/canvas/prototype/refine. Regenerates the React-tier
// prototype with the user's feedback applied. Reuses the same multi-input
// hydration as T1 (linkedObjectIds → image_narrative / concept_slugs /
// siblings) — drag-wired context flows into Opus the same way.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { refinePrototypeReact } from "@/lib/objective-canvas/tech-spec/compose-prototype-react";
import { buildTasteDesignContext } from "@/lib/objective-canvas/tech-spec/taste-design-block";
import { hydrateRefineContext } from "@/lib/objective-canvas/tech-spec/hydrate-refine-context";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  spaceId?: string;
  /** Current files snapshot (the shape sends what Sandpack is showing). */
  currentFiles?: Record<string, string> | null;
  feedback?: string;
  spec?: TechSpec | null;
  /** Same shape as T1: library_objects ids the user drag-wired. */
  linkedObjectIds?: string[];
  /** Current artifact id, to exclude self from sibling list. */
  artifactId?: string | null;
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
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  const hasSpec = !!body.spec && typeof body.spec.title === "string";
  const currentFiles =
    body.currentFiles && typeof body.currentFiles === "object"
      ? body.currentFiles
      : {};
  if (!feedback || (!Object.keys(currentFiles).length && !hasSpec)) {
    return NextResponse.json(
      { error: "feedback and currentFiles or spec required" },
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

  const linkedObjectIds = Array.isArray(body.linkedObjectIds)
    ? body.linkedObjectIds.filter((s): s is string => typeof s === "string")
    : [];
  const artifactId = typeof body.artifactId === "string" ? body.artifactId : null;

  const [taste, linked] = await Promise.all([
    buildTasteDesignContext(auth.supabase, spaceId),
    hydrateRefineContext({
      db: auth.supabase,
      spaceId,
      linkedObjectIds,
      currentArtifactId: artifactId,
    }),
  ]);

  try {
    const result = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:prototype_react_refine",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: {
          mode: "refine_react",
          taste_applied: taste.hasContent,
          linked_objects: linked.counts.objects,
          linked_images: linked.counts.images,
          siblings: linked.counts.siblings,
        },
      },
      () =>
        refinePrototypeReact(
          currentFiles,
          feedback,
          body.spec ?? null,
          taste,
          linked.block,
        ),
    );
    return NextResponse.json({
      entry: result.prototype.entry,
      files: result.prototype.files,
      sanitizerOk: result.sanitizer.ok,
      sanitizerReason: result.sanitizer.reason,
    });
  } catch (err) {
    console.error("[prototype-react/refine] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
