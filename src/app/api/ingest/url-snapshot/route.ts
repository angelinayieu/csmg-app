// ── POST /api/ingest/url-snapshot ──────────────────────────────────
//
// Take a URL → server-side screenshot → land it in the same image
// pipeline as a pasted/dropped image. After this returns, the row
// behaves identically to a clipboard-pasted screenshot: it has a
// public storage URL, an ingested_files row, and gets vision-extract
// + materialize-image-context + taste qualities + image_source
// promotion for free.
//
// Why this exists: the "Paste a URL like apple.com" flow for the
// moodboard gallery (+Add reference → URL tab). Honest framing — we
// are NOT cloning the target site (legally fraught, technically
// imperfect — see https://research.aimultiple.com/screenshot-to-code/).
// We capture the site's VISUAL VOCABULARY (palette, density, type
// scale, pattern) so the user's prototype build can imitate that
// taste, not the content.
//
// Vendor: ScreenshotOne. Env var SCREENSHOTONE_ACCESS_KEY required.
// Falls back to a clear 503 if not set — the rest of the app still
// works; only the URL tab degrades. Swap the vendor by replacing
// `fetchScreenshotPng` — the rest of the route is vendor-agnostic.

import { NextResponse, after } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  url?: string;
  /** Optional viewport. Defaults to a desktop-typical 1440x900. */
  viewportWidth?: number;
  viewportHeight?: number;
  /** When true (default), the screenshot scrolls to capture the whole
   *  page. When false, only the above-the-fold viewport is captured —
   *  good for "hero only" references. */
  fullPage?: boolean;
}

const VENDOR = "ScreenshotOne";
const VENDOR_ENV = "SCREENSHOTONE_ACCESS_KEY";

export async function POST(req: Request) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const spaceId =
    typeof body.spaceId === "string" && body.spaceId ? body.spaceId : null;
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Defensive URL validation — only http(s), no IPs / localhost / .local
  // / private ranges to avoid SSRF and don't burn budget on garbage.
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return NextResponse.json(
      { error: "URL must be http(s) and resolve to a public host" },
      { status: 400 },
    );
  }

  if (spaceId) {
    const { data: space } = await supabase
      .from("spaces")
      .select("user_id")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    if ((space as { user_id: string }).user_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  const accessKey = process.env[VENDOR_ENV];
  if (!accessKey) {
    return NextResponse.json(
      {
        error: `${VENDOR} not configured`,
        detail: `Set ${VENDOR_ENV} in the server env to enable URL → screenshot. The rest of the moodboard works without it; only the "Paste URL" tab is affected.`,
      },
      { status: 503 },
    );
  }

  let png: Buffer;
  try {
    png = await fetchScreenshotPng({
      accessKey,
      targetUrl: parsed.toString(),
      viewportWidth: clampInt(body.viewportWidth, 800, 1920, 1440),
      viewportHeight: clampInt(body.viewportHeight, 600, 1200, 900),
      fullPage: body.fullPage !== false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "screenshot failed";
    console.warn("[url-snapshot] vendor fetch failed:", message);
    return NextResponse.json(
      { error: "Could not capture screenshot", detail: message },
      { status: 502 },
    );
  }

  // Upload to the same bucket pasted-image binaries land in. RLS is
  // owner-by-path-prefix; we use a fresh UUID so multiple snapshots of
  // the same URL don't collide.
  const path = `${user.id}/${crypto.randomUUID()}.png`;
  let publicUrl: string | null = null;
  try {
    const { error: upErr } = await supabase.storage
      .from("ingested-images")
      .upload(path, png, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.warn("[url-snapshot] upload failed:", upErr.message);
      return NextResponse.json(
        { error: "Could not store screenshot", detail: upErr.message },
        { status: 500 },
      );
    }
    const { data } = supabase.storage.from("ingested-images").getPublicUrl(path);
    publicUrl = (data?.publicUrl as string | undefined) ?? null;
  } catch (err) {
    console.warn("[url-snapshot] upload threw:", err);
    return NextResponse.json(
      { error: "Could not store screenshot" },
      { status: 500 },
    );
  }

  // Insert the ingested_files row. We mark vision as PENDING (the
  // existing two-phase pattern); the vision-extract POST below picks
  // it up + runs materializeImageContext for us.
  const sourceName = parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
  let ingestedFileId: string | null = null;
  try {
    const { data: inserted, error: insertErr } = await supabase
      .from("ingested_files")
      .insert({
        user_id: user.id,
        space_id: spaceId,
        source_type: "url",
        source_name: sourceName.slice(0, 200) || "URL screenshot",
        mime_type: "image/png",
        source_url: parsed.toString(),
        normalized_text: "",
        raw_chars: 0,
        normalized_chars: 0,
        extraction_method: "url-snapshot",
        asset_class: "image",
        image_url: publicUrl,
        metadata: {
          source_type: "url-snapshot",
          original_url: parsed.toString(),
          screenshot_vendor: VENDOR,
          vendor_options: {
            full_page: body.fullPage !== false,
            viewport: {
              width: clampInt(body.viewportWidth, 800, 1920, 1440),
              height: clampInt(body.viewportHeight, 600, 1200, 900),
            },
          },
        },
        parse_status: "ready",
        parse_completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertErr) {
      console.warn("[url-snapshot] insert failed:", insertErr);
      return NextResponse.json(
        { error: "Could not persist row", detail: insertErr.message },
        { status: 500 },
      );
    }
    ingestedFileId = (inserted as { id: string } | null)?.id ?? null;
  } catch (err) {
    console.warn("[url-snapshot] insert threw:", err);
    return NextResponse.json({ error: "Could not persist row" }, { status: 500 });
  }

  if (!ingestedFileId) {
    return NextResponse.json({ error: "Persist returned no id" }, { status: 500 });
  }

  // Trigger vision-extract in the background, mirroring the existing
  // two-phase image pattern (paste → /api/ingest → /api/ingest/vision-
  // extract). We don't await it; the client polls /api/objective/[id]/
  // images and picks the row up once analyzed (same path image cards
  // and the moodboard read).
  after(async () => {
    try {
      await fireVisionExtract(req, png, ingestedFileId);
    } catch (err) {
      console.warn("[url-snapshot] vision dispatch failed (soft):", err);
    }
  });

  return NextResponse.json({
    ingested_file_id: ingestedFileId,
    image_url: publicUrl,
    source_url: parsed.toString(),
    awaiting_vision: true,
    notice:
      "Screenshot captured. Style extraction starts in the background; the image lands in your moodboard once it's analyzed.",
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function safeParseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    // Block obvious SSRF / private-network targets. Not exhaustive (a
    // resolved IP could still be private) — pair with vendor-side
    // egress controls for defense in depth.
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^127\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

function clampInt(
  v: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Vendor call. Replace this fn (only) to swap providers — the rest of
 *  the route is provider-agnostic. ScreenshotOne returns the raw PNG
 *  binary on success and JSON on error; we surface the vendor's error
 *  message verbatim so misconfigurations are debuggable. */
async function fetchScreenshotPng(opts: {
  accessKey: string;
  targetUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  fullPage: boolean;
}): Promise<Buffer> {
  const params = new URLSearchParams({
    access_key: opts.accessKey,
    url: opts.targetUrl,
    format: "png",
    viewport_width: String(opts.viewportWidth),
    viewport_height: String(opts.viewportHeight),
    full_page: String(opts.fullPage),
    // Quality-of-life: don't capture intrusive overlays.
    block_cookie_banners: "true",
    block_chats: "true",
    block_ads: "true",
    // Wait a beat for hero animations / fonts to settle before
    // capturing.
    delay: "1",
  });
  const endpoint = `https://api.screenshotone.com/take?${params.toString()}`;
  const res = await fetch(endpoint, { method: "GET" });
  if (!res.ok) {
    let detail = `vendor ${res.status}`;
    try {
      const j = (await res.json()) as { error_message?: string };
      if (j?.error_message) detail = String(j.error_message);
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("vendor returned empty body");
  return buf;
}

/** Fire vision-extract for this row in the background. We re-POST the
 *  binary into the existing vision-extract route so we stay aligned
 *  with the pasted-image flow (one code path runs vision + materialize-
 *  image-context, no fork). Forwards the auth cookies from the
 *  incoming request so the inner route sees the same user.
 *
 *  Soft-fail: a vision-extract failure leaves the row with
 *  vision_completed_at=null; the client poll will keep waiting and the
 *  user sees an "analyzing…" state, which is the same UX as a paste
 *  whose vision pass stalls. */
async function fireVisionExtract(
  req: Request,
  png: Buffer,
  ingestedFileId: string,
): Promise<void> {
  const form = new FormData();
  form.append("ingested_file_id", ingestedFileId);
  form.append(
    "file",
    new Blob([new Uint8Array(png)], { type: "image/png" }),
    "screenshot.png",
  );
  const cookie = req.headers.get("cookie") ?? "";
  // Build the absolute URL from the incoming request so this works on
  // every deployment env (vercel preview / prod / localhost).
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/ingest/vision-extract`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  if (!res.ok) {
    let detail = `vision-extract ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      detail = j.detail || j.error || detail;
    } catch {
      /* non-JSON */
    }
    throw new Error(detail);
  }
}
