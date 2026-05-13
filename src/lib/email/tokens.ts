// ── Unsubscribe tokens ──
//
// One-time tokens minted alongside every outbound email. The user
// can hit the unsubscribe URL without being logged in; the token
// validates them as the recipient and flips the matching
// notification preference. 90-day TTL (enforced at the DB column).
//
// Notification keys:
//   new_request       — incoming connection requests
//   request_accepted  — your sent request was accepted
//   weekly_digest     — Monday-morning summary (not yet shipped)
//   all               — turns every email off in one click

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export type NotificationKey =
  | "new_request"
  | "request_accepted"
  | "weekly_digest"
  | "all";

const TOKEN_BYTES = 24; // 192 bits — well above brute-force range

export function mintTokenBytes(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

// Insert a fresh token row for (user, key). Returns the token string.
// Called from the email-send path; we don't reuse tokens across
// emails so users can revoke a single email's link without affecting
// the rest of their inbox.
export async function mintUnsubscribeToken(
  userId: string,
  key: NotificationKey,
): Promise<string> {
  const token = mintTokenBytes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("email_unsubscribe_tokens").insert({
    token,
    user_id: userId,
    notification_key: key,
  });
  if (error) {
    // Soft-fail: log + return the token anyway. The token won't be
    // redeemable, but the email still ships with a working
    // preferences link. Better than blocking the send on a token DB
    // hiccup.
    console.warn("[email · token mint failed]", error);
  }
  return token;
}

// Redeem a token: validates, flips the matching pref, marks used.
// Idempotent — calling twice with the same token returns "already_used"
// the second time, rather than re-flipping (which would no-op anyway).
export async function redeemUnsubscribeToken(
  token: string,
): Promise<
  | { ok: true; user_id: string; notification_key: NotificationKey }
  | { ok: false; reason: "not_found" | "expired" | "already_used" }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: row } = await db
    .from("email_unsubscribe_tokens")
    .select("token, user_id, notification_key, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  if (row.used_at) return { ok: false, reason: "already_used" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const key = row.notification_key as NotificationKey;

  // Flip the preference. For 'all' we turn EVERY key off; for a
  // specific key we just flip that one. We use a JSONB merge so we
  // don't clobber any keys the column didn't know about.
  const { data: profile } = await db
    .from("synergy_profiles")
    .select("email_notifications")
    .eq("user_id", row.user_id)
    .maybeSingle();

  const current = (profile?.email_notifications ?? {}) as Record<string, boolean>;
  let next: Record<string, boolean>;
  if (key === "all") {
    next = { ...current };
    for (const k of Object.keys(next)) {
      next[k] = false;
    }
    // Ensure the canonical keys exist as `false` even if the column
    // was sparse.
    for (const k of ["new_request", "request_accepted", "weekly_digest"]) {
      next[k] = false;
    }
  } else {
    next = { ...current, [key]: false };
  }

  await db
    .from("synergy_profiles")
    .update({ email_notifications: next })
    .eq("user_id", row.user_id);

  // Mark token used. Concurrent races would be benign — the pref is
  // already false, second redemption returns 'already_used'.
  await db
    .from("email_unsubscribe_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token", token);

  return { ok: true, user_id: row.user_id, notification_key: key };
}
