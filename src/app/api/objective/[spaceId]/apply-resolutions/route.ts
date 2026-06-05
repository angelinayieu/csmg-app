// POST /api/objective/[spaceId]/apply-resolutions → { status, sharpenedPrompt?, glossaryCount? }
//
// Phase 3 write-back. After the Resolution Studio saves the user's answers,
// this turns them into durable metadata: authoritative pinned glossary terms +
// a re-framed sharpened prompt. The board separately decomposes the re-framed
// objective into Variable/Feature cards. Soft-fail; never blocks the studio.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { applyResolutionsForSpace } from "@/lib/objective-canvas/apply-resolutions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ spaceId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;
  const { spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const result = await applyResolutionsForSpace(db, spaceId, user.id);
  return NextResponse.json(
    result ? { status: "ok", ...result } : { status: "error" },
  );
}
