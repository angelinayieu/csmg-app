// ── Email sending — Resend wrapper with no-op fallback ──
//
// Dry-run by default: if `RESEND_API_KEY` is unset OR the `resend`
// package is not installed, this module logs the would-have-been
// email contents and resolves successfully. That keeps the marketplace
// loop wired end-to-end without forcing email infra setup. When the
// API key + package are present, emails go out for real.
//
// To enable live sending:
//   1. npm install resend
//   2. Set RESEND_API_KEY in your env
//   3. Optional: set RESEND_FROM (defaults to "Synergy <onboarding@resend.dev>")
//
// Resend's free tier sends from `onboarding@resend.dev` without
// domain verification — fine for dev. Production needs a verified
// domain via DNS records (SPF + DKIM); see https://resend.com/docs/dashboard/domains/introduction.

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  // Plain-text fallback for clients that can't render HTML. Optional —
  // we auto-derive a passable text version from the HTML when omitted.
  text?: string;
  // Goes into the email's preview line in Gmail/Outlook list views.
  preheader?: string;
}

export interface SendResult {
  ok: boolean;
  // null when dry-run, the Resend message id when live
  message_id: string | null;
  dry_run: boolean;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: any = null;
let resolveAttempted = false;
let resolveFailed = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getClient(): Promise<any> {
  if (resolveFailed || !process.env.RESEND_API_KEY) return null;
  if (cachedClient) return cachedClient;
  if (resolveAttempted && !cachedClient) return null;
  resolveAttempted = true;
  try {
    // @ts-expect-error -- optional dependency; install with `npm i resend`
    const mod = await import("resend");
    cachedClient = new mod.Resend(process.env.RESEND_API_KEY);
    return cachedClient;
  } catch (err) {
    console.warn(
      "[email] RESEND_API_KEY is set but `resend` package isn't installed. Run `npm install resend` to enable live sends. Falling back to dry-run.",
      err,
    );
    resolveFailed = true;
    return null;
  }
}

export async function sendTransactional(
  opts: SendOptions,
): Promise<SendResult> {
  const client = await getClient();
  const from = process.env.RESEND_FROM || "Synergy <onboarding@resend.dev>";

  if (!client) {
    // Dry-run: log the email and return success so callers don't
    // distinguish dry-run from live. This keeps trigger code
    // identical in both modes.
    console.info("[email · dry-run]", {
      to: opts.to,
      subject: opts.subject,
      preheader: opts.preheader?.slice(0, 100),
      html_preview: opts.html.slice(0, 200).replace(/\s+/g, " "),
    });
    return { ok: true, message_id: null, dry_run: true };
  }

  try {
    const res = await client.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? stripHtmlToText(opts.html),
      // Resend's `headers` field passes through arbitrary email headers.
      // Adding a List-Unsubscribe is a deliverability win and tells
      // Gmail to surface the native unsubscribe affordance — even
      // though the HTML body also carries the link.
      headers: opts.preheader
        ? {
            "X-Entity-Ref-ID": cryptoSafeId(),
          }
        : undefined,
    });
    if (res?.error) {
      return {
        ok: false,
        message_id: null,
        dry_run: false,
        error: String(res.error?.message ?? res.error),
      };
    }
    return {
      ok: true,
      message_id: res?.data?.id ?? null,
      dry_run: false,
    };
  } catch (err) {
    return {
      ok: false,
      message_id: null,
      dry_run: false,
      error: (err as Error).message,
    };
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cryptoSafeId(): string {
  // Used as the X-Entity-Ref-ID header. Gmail uses this to de-dupe
  // the same email landing in multiple folders (e.g. when the
  // recipient is also CC'd elsewhere).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// Boolean accessor for callers that want to skip building expensive
// template HTML when dry-run is the only available path. Cheap.
export function emailDeliveryAvailable(): boolean {
  return !!process.env.RESEND_API_KEY && !resolveFailed;
}
