// ── Email triggers ──
//
// Per-event high-level helpers. Each trigger:
//   1. Looks up the recipient's notification preferences + delivery email
//   2. Mints a one-time unsubscribe token for the relevant key
//   3. Renders the template
//   4. Calls sendTransactional (which is dry-run-safe)
//   5. Returns the result for logging
//
// All triggers are "fire-and-forget" from the caller's perspective —
// the request endpoint awaits the DB write, then schedules the email
// without blocking the user's response. Failures are logged but
// don't crash the parent request.

import { createServiceClient } from "@/lib/supabase/service";
import {
  matchSurfacedEmail,
  newRequestEmail,
  requestAcceptedEmail,
  testEmail,
} from "./templates";
import { sendTransactional } from "./send";
import { mintUnsubscribeToken, type NotificationKey } from "./tokens";

// Resolve the destination email for a user — notification_email
// override first, fall back to auth.users.email. Returns null if
// neither is set OR notifications for this key are disabled.
async function resolveDelivery(
  userId: string,
  key: NotificationKey,
): Promise<{
  email: string;
  prefs: Record<string, boolean>;
} | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    db
      .from("synergy_profiles")
      .select("notification_email, email_notifications, display_name")
      .eq("user_id", userId)
      .maybeSingle(),
    db.auth.admin.getUserById(userId),
  ]);

  const fallbackEmail = (authUser?.user?.email ?? "") as string;
  const email = (profile?.notification_email as string | null) || fallbackEmail;
  if (!email) return null;

  const prefs = (profile?.email_notifications ?? {}) as Record<string, boolean>;
  if (prefs[key] === false) return null;
  return { email, prefs };
}

function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://localhost:3000";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

// ── new_request ──
//
// Fires after a successful POST /api/synergy/requests insert. Sender
// stays anonymous in the email per the privacy contract — only the
// receiver's matching component label + sender's objective + rationale
// are surfaced.

export async function sendNewRequestEmail(args: {
  to_user_id: string;
  to_component_id: string;
  match_rationale: string | null;
  sender_session_id?: string | null;
}): Promise<void> {
  try {
    const delivery = await resolveDelivery(args.to_user_id, "new_request");
    if (!delivery) return; // opt-out OR no email; silent no-op

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const [{ data: toComp }, { data: senderSession }] = await Promise.all([
      db
        .from("brainstorm_components")
        .select("label_public")
        .eq("id", args.to_component_id)
        .maybeSingle(),
      args.sender_session_id
        ? db
            .from("brainstorm_sessions")
            .select("objective_statement")
            .eq("id", args.sender_session_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!toComp?.label_public) {
      console.warn(
        "[email · new_request] target component not found, skipping email",
      );
      return;
    }

    const token = await mintUnsubscribeToken(args.to_user_id, "new_request");
    const tpl = newRequestEmail({
      receiver_component_label: toComp.label_public,
      sender_objective:
        (senderSession?.objective_statement as string | null) ?? null,
      match_rationale: args.match_rationale,
      inbox_url: appUrl("/app/synergy/requests"),
      preferences_url: appUrl("/app/synergy/profile#email"),
      unsubscribe_url: appUrl(`/email/unsubscribe?token=${encodeURIComponent(token)}`),
    });

    const result = await sendTransactional({
      to: delivery.email,
      subject: tpl.subject,
      preheader: tpl.preheader,
      html: tpl.html,
    });
    if (!result.ok) {
      console.warn("[email · new_request] send failed:", result.error);
    }
  } catch (err) {
    console.warn("[email · new_request] trigger errored:", err);
  }
}

// ── request_accepted ──
//
// Fires after a successful PATCH /api/synergy/requests/[id] with
// action=accept. At this point both sides see each other's profile,
// so we DO include the accepter's display_name + bio (sender already
// knows them — the inbox revealed them once the receiver opened it).

export async function sendRequestAcceptedEmail(args: {
  from_user_id: string;
  from_component_id: string;
  to_user_id: string;
  room_id: string | null;
}): Promise<void> {
  try {
    const delivery = await resolveDelivery(args.from_user_id, "request_accepted");
    if (!delivery) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const [{ data: profile }, { data: fromComp }] = await Promise.all([
      db
        .from("synergy_profiles")
        .select("display_name, bio")
        .eq("user_id", args.to_user_id)
        .maybeSingle(),
      db
        .from("brainstorm_components")
        .select("label_public")
        .eq("id", args.from_component_id)
        .maybeSingle(),
    ]);

    if (!profile?.display_name || !fromComp?.label_public) {
      console.warn(
        "[email · request_accepted] missing profile/component, skipping",
      );
      return;
    }

    const token = await mintUnsubscribeToken(
      args.from_user_id,
      "request_accepted",
    );
    const roomPath = args.room_id ? `/app/synergy/room/${args.room_id}` : "/app/synergy/requests";

    const tpl = requestAcceptedEmail({
      display_name: profile.display_name,
      bio: (profile.bio as string | null) ?? null,
      your_component_label: fromComp.label_public,
      room_url: appUrl(roomPath),
      preferences_url: appUrl("/app/synergy/profile#email"),
      unsubscribe_url: appUrl(`/email/unsubscribe?token=${encodeURIComponent(token)}`),
    });

    const result = await sendTransactional({
      to: delivery.email,
      subject: tpl.subject,
      preheader: tpl.preheader,
      html: tpl.html,
    });
    if (!result.ok) {
      console.warn("[email · request_accepted] send failed:", result.error);
    }
  } catch (err) {
    console.warn("[email · request_accepted] trigger errored:", err);
  }
}

// ── match_surfaced ──
//
// Fires from the matcher (on-demand AND cron paths) when a user's
// component gets a meaningful new match. "Meaningful" = at least one
// row with final_score >= 70 in this matcher batch for an owner
// whose `notify_on_match = true`.
//
// Throttled to one email per 24h per user via
// `synergy_profiles.last_match_notified_at` — so the cron running
// every 6 hours never produces a daily spam pile.
//
// Privacy: the email surfaces only YOUR component label (the side
// the matcher ran for) + a fit score. Never the other user's name,
// component, or session. The user clicks through to /discover to see
// the actual match cards (which are already privacy-redacted).

interface MatchSurfaceInput {
  owner_user_id: string;
  // Best new match for this owner in the current batch
  highlight_component_label: string | null;
  highlight_score: number | null;
  new_match_count: number;
}

export async function sendMatchSurfacedEmail(
  args: MatchSurfaceInput,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;

    // Load the profile + auth user in one go. We need:
    //   - notify_on_match flag (the dedicated toggle)
    //   - email_notifications.new_request as a fallback channel-key
    //     for the unsubscribe link (we re-use that key since
    //     notify_on_match doesn't have its own unsubscribe entry yet)
    //   - last_match_notified_at for throttling
    const { data: profile } = await db
      .from("synergy_profiles")
      .select(
        "notification_email, display_name, email_notifications, notify_on_match, last_match_notified_at",
      )
      .eq("user_id", args.owner_user_id)
      .maybeSingle();
    if (!profile) return;
    if (profile.notify_on_match !== true) return;

    // 24h throttle
    if (
      profile.last_match_notified_at &&
      Date.now() - new Date(profile.last_match_notified_at).getTime() <
        24 * 60 * 60 * 1000
    ) {
      return;
    }

    // Resolve delivery email (override → auth.users.email fallback)
    const { data: authUser } = await db.auth.admin.getUserById(
      args.owner_user_id,
    );
    const fallback = (authUser?.user?.email ?? "") as string;
    const email = (profile.notification_email as string | null) || fallback;
    if (!email) return;

    // Mint a token; we use a new dedicated 'new_request' key for
    // unsubscribe since notify-on-match is a "marketing-ish" surface
    // and users may want a clean way to turn it off independently.
    // The unsubscribe page handles the key generically.
    const token = await mintUnsubscribeToken(args.owner_user_id, "new_request");

    const tpl = matchSurfacedEmail({
      display_name: (profile.display_name as string | null) ?? "there",
      new_match_count: args.new_match_count,
      highlight_component_label: args.highlight_component_label,
      highlight_score: args.highlight_score,
      discover_url: appUrl("/app/synergy/discover"),
      preferences_url: appUrl("/app/synergy/profile#email"),
      unsubscribe_url: appUrl(`/email/unsubscribe?token=${encodeURIComponent(token)}`),
    });

    const result = await sendTransactional({
      to: email,
      subject: tpl.subject,
      preheader: tpl.preheader,
      html: tpl.html,
    });

    if (result.ok) {
      // Stamp the throttle on success (dry-run also stamps so dev
      // testing doesn't re-fire on every cron tick).
      await db
        .from("synergy_profiles")
        .update({ last_match_notified_at: new Date().toISOString() })
        .eq("user_id", args.owner_user_id);
    } else {
      console.warn("[email · match_surfaced] send failed:", result.error);
    }
  } catch (err) {
    console.warn("[email · match_surfaced] trigger errored:", err);
  }
}

// ── Test email ──
//
// Called by the "Send test email" button in the profile UI. Bypasses
// the per-key opt-in check (user explicitly asked for this) but still
// honors notification_email override + signs the unsubscribe link
// against the 'all' key.

export async function sendTestEmail(args: {
  user_id: string;
}): Promise<{ ok: boolean; dry_run: boolean; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const [{ data: profile }, { data: authUser }] = await Promise.all([
      db
        .from("synergy_profiles")
        .select("notification_email, display_name")
        .eq("user_id", args.user_id)
        .maybeSingle(),
      db.auth.admin.getUserById(args.user_id),
    ]);
    const fallbackEmail = (authUser?.user?.email ?? "") as string;
    const email = (profile?.notification_email as string | null) || fallbackEmail;
    if (!email) {
      return { ok: false, dry_run: false, error: "No delivery email set." };
    }
    const displayName = (profile?.display_name as string | null) ?? "there";

    const token = await mintUnsubscribeToken(args.user_id, "all");
    const tpl = testEmail({
      display_name: displayName,
      preferences_url: appUrl("/app/synergy/profile#email"),
      unsubscribe_url: appUrl(`/email/unsubscribe?token=${encodeURIComponent(token)}`),
    });

    const result = await sendTransactional({
      to: email,
      subject: tpl.subject,
      preheader: tpl.preheader,
      html: tpl.html,
    });
    return { ok: result.ok, dry_run: result.dry_run, error: result.error };
  } catch (err) {
    return { ok: false, dry_run: false, error: (err as Error).message };
  }
}
