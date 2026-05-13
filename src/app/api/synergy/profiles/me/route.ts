// ── /api/synergy/profiles/me ──
//
// GET → return own profile (with matching_enabled + max_pending too)
// PATCH → update display_name / bio / matching_enabled
//
// Self-only — no cross-user auth needed beyond safeAuth().

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: profile, error } = await db
    .from("synergy_profiles")
    .select(
      "user_id, display_name, bio, avatar_url, matching_enabled, max_pending_requests, email_notifications, notification_email, notify_on_match, min_match_score",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  // Auto-bootstrap profile if missing — uses email local-part as
  // default display_name (matches the bootstrap behavior in the
  // match POST endpoint).
  if (!profile) {
    const localPart = (user.email ?? "").split("@")[0] ?? "";
    const displayName =
      localPart.length >= 2 ? localPart.slice(0, 64) : "Synergy user";
    const { data: created, error: createErr } = await db
      .from("synergy_profiles")
      .insert({
        user_id: user.id,
        display_name: displayName,
        matching_enabled: true,
      })
      .select(
        "user_id, display_name, bio, avatar_url, matching_enabled, max_pending_requests, email_notifications, notification_email, notify_on_match, min_match_score",
      )
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(createErr) },
        { status: 500 },
      );
    }
    return NextResponse.json({ profile: created });
  }
  return NextResponse.json({ profile });
}

interface PatchBody {
  display_name?: unknown;
  bio?: unknown;
  matching_enabled?: unknown;
  email_notifications?: unknown;
  notification_email?: unknown;
  // Phase 4d+4 cold-start safety net
  notify_on_match?: unknown;
  min_match_score?: unknown;
}

// Whitelist of email_notifications keys the client can touch. Adding
// a new event type (e.g. weekly_digest) just appends here + extends
// the templates.
const EMAIL_NOTIF_KEYS = [
  "new_request",
  "request_accepted",
  "weekly_digest",
] as const;
type EmailNotifKey = (typeof EMAIL_NOTIF_KEYS)[number];

function isEmailNotifKey(k: string): k is EmailNotifKey {
  return (EMAIL_NOTIF_KEYS as readonly string[]).includes(k);
}

export async function PATCH(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<PatchBody>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (typeof body.display_name === "string") {
    const name = body.display_name.trim();
    if (name.length < 2 || name.length > 64) {
      return NextResponse.json(
        { error: "display_name must be 2-64 characters" },
        { status: 400 },
      );
    }
    update.display_name = name;
  }
  if (typeof body.bio === "string") {
    if (body.bio.length > 400) {
      return NextResponse.json(
        { error: "bio must be ≤ 400 characters" },
        { status: 400 },
      );
    }
    update.bio = body.bio.trim() || null;
  }
  if (typeof body.matching_enabled === "boolean") {
    update.matching_enabled = body.matching_enabled;
  }
  if (typeof body.notify_on_match === "boolean") {
    update.notify_on_match = body.notify_on_match;
  }
  if (typeof body.min_match_score === "number") {
    const v = Math.round(body.min_match_score);
    if (v < 0 || v > 100) {
      return NextResponse.json(
        { error: "min_match_score must be 0-100" },
        { status: 400 },
      );
    }
    update.min_match_score = v;
  }
  if (
    body.email_notifications &&
    typeof body.email_notifications === "object" &&
    !Array.isArray(body.email_notifications)
  ) {
    // Whitelist + boolean-coerce. We MERGE rather than replace so the
    // client can patch one key without sending the whole map.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incoming = body.email_notifications as Record<string, any>;
    const filtered: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (isEmailNotifKey(k)) filtered[k] = !!v;
    }
    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        {
          error: `email_notifications must include one of: ${EMAIL_NOTIF_KEYS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    // Read current to merge; preserves any future-key the client
    // didn't send. eslint disabled for any-from-jsonb idiom.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db2 = supabase as any;
    const { data: cur } = await db2
      .from("synergy_profiles")
      .select("email_notifications")
      .eq("user_id", user.id)
      .maybeSingle();
    update.email_notifications = {
      ...(((cur?.email_notifications as Record<string, boolean>) ?? {})),
      ...filtered,
    };
  }
  if (typeof body.notification_email === "string") {
    const v = body.notification_email.trim();
    if (v.length === 0) {
      update.notification_email = null;
    } else if (!/^.+@.+\..+/.test(v) || v.length > 320) {
      return NextResponse.json(
        { error: "notification_email must be a valid email address" },
        { status: 400 },
      );
    } else {
      update.notification_email = v;
    }
  } else if (body.notification_email === null) {
    update.notification_email = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: updated, error } = await db
    .from("synergy_profiles")
    .update(update)
    .eq("user_id", user.id)
    .select(
      "user_id, display_name, bio, avatar_url, matching_enabled, max_pending_requests, email_notifications, notification_email, notify_on_match, min_match_score",
    )
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ profile: updated });
}
