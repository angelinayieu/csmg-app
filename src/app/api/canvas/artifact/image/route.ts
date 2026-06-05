// ── POST /api/canvas/artifact/image ───────────────────────────────────
//
// The Image artifact engine (ARTIFACTS_DOCK_PLAN.md §3). Generates an image
// with OpenAI gpt-image-1 from the user's prompt (+ the selected cards as
// context), uploads the binary to the public `ingested-images` bucket, and
// persists an `image` artifact row (+ version). Returns the public URL so the
// dock can drop it on the board. Soft-fails with a 400 on any provider error.

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  upsertArtifact,
  appendArtifactVersion,
} from "@/lib/objective-canvas/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  spaceId?: unknown;
  prompt?: unknown;
  context?: unknown;
}

/** Upload a generated PNG to the public bucket; returns the public URL or null. */
async function uploadImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  buf: Buffer,
): Promise<string | null> {
  try {
    const path = `${userId}/${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("ingested-images")
      .upload(path, buf, { contentType: "image/png", upsert: false });
    if (error) {
      console.warn("[artifact/image] upload failed:", error.message);
      return null;
    }
    const { data } = supabase.storage.from("ingested-images").getPublicUrl(path);
    return (data?.publicUrl as string | undefined) ?? null;
  } catch (err) {
    console.warn("[artifact/image] upload threw:", err);
    return null;
  }
}

export async function POST(req: Request) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;

  const { data: body } = await safeJsonParse<Body>(req);
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const userPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const context = typeof body?.context === "string" ? body.context.trim() : "";
  if (!spaceId || !userPrompt) {
    return NextResponse.json({ error: "spaceId + prompt required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Image generation isn't configured (no OPENAI_API_KEY)." },
      { status: 503 },
    );
  }

  // Compose the final image prompt — the user's ask, grounded in the selection.
  const fullPrompt = context
    ? `${userPrompt}\n\nGround the image in this context:\n${context.slice(0, 1200)}`
    : userPrompt;

  let b64: string | undefined;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt: fullPrompt,
      size: "1024x1024",
      n: 1,
    });
    b64 = result.data?.[0]?.b64_json;
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) || "Image generation failed." },
      { status: 400 },
    );
  }
  if (!b64) {
    return NextResponse.json({ error: "No image returned." }, { status: 400 });
  }

  const imageUrl = await uploadImage(db, user.id, Buffer.from(b64, "base64"));
  if (!imageUrl) {
    return NextResponse.json({ error: "Could not store the image." }, { status: 400 });
  }

  const title =
    userPrompt.length > 60 ? `${userPrompt.slice(0, 59)}…` : userPrompt;
  const content = { imageUrl, prompt: userPrompt, context: context || null };
  const id = await upsertArtifact(db, {
    spaceId,
    userId: user.id,
    artifactType: "image",
    engineKey: `image:${crypto.randomUUID()}`, // each image is its own artifact
    title,
    status: "ready",
    content,
    lastUpdatedBy: "agent:image",
  });
  if (id)
    await appendArtifactVersion(db, id, {
      content,
      changeType: "generated",
      changedBy: user.id,
    });

  return NextResponse.json({ id, imageUrl, title, prompt: userPrompt });
}
