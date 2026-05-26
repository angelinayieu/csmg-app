// ── POST /api/brainstorm/item/highlights ─────────────────────
//
// Returns 3-5 verbatim phrase offsets in the supplied text for
// fast-reading emphasis (Item Detail Drawer's Definition section
// toggle). Stateless — no persistence, no entity lookup. The
// frontend caches the result client-side.
//
// Body: { text: string, topic?: string }

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { generateTextHighlights } from "@/lib/objective-canvas/generate-text-highlights";

export const runtime = "nodejs";
export const maxDuration = 20;

interface Body {
  text?: string;
  topic?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (text.length < 40) {
    return NextResponse.json(
      { error: "text required (min 40 chars)" },
      { status: 400 },
    );
  }
  const topic =
    typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : "";

  try {
    const highlights = await generateTextHighlights({ text, topic });
    return NextResponse.json({ highlights });
  } catch (err) {
    return NextResponse.json(
      { error: `highlights failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
