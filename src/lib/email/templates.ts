// ── Email HTML templates ──
//
// Plain template-literal HTML — no @react-email dep needed for v1.
// All emails share a wrapper layout (centered card, brand mark,
// footer with unsubscribe + preferences). Per-template content is
// passed in. Inline styles only — HTML email clients ignore most
// external CSS.

export interface ButtonAttrs {
  label: string;
  href: string;
}

export interface EmailLayoutAttrs {
  subject: string;
  preheader: string;
  body_html: string;
  cta?: ButtonAttrs;
  // The full unsubscribe URL for THIS notification key. Footer renders
  // both "manage preferences" + "unsubscribe from this email" links.
  unsubscribe_url: string;
  preferences_url: string;
}

export function wrapEmail(attrs: EmailLayoutAttrs): string {
  // Inline-style block. Email-safe colors mirror the app's gradient
  // (blue 600 → cyan 500). Outer table layout because Outlook still
  // doesn't fully support modern CSS.
  const cta = attrs.cta
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px auto 0;">
      <tr>
        <td style="border-radius: 12px; background-image: linear-gradient(135deg, #2563eb 0%, #06b6d4 100%); padding: 0;">
          <a href="${escapeAttr(attrs.cta.href)}" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; letter-spacing: 0.01em; border-radius: 12px;">
            ${escapeHtml(attrs.cta.label)} →
          </a>
        </td>
      </tr>
    </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(attrs.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5;">
  <!-- Preheader: hidden text Gmail/Outlook shows in the list preview -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">
    ${escapeHtml(attrs.preheader)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f3f4f6; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden;">
          <!-- Brand mark -->
          <tr>
            <td style="padding: 24px 32px 0;">
              <div style="display: inline-block; vertical-align: middle;">
                <span style="display: inline-block; width: 28px; height: 28px; border-radius: 8px; background-image: linear-gradient(135deg, #2563eb 0%, #06b6d4 100%); vertical-align: middle;"></span>
                <span style="margin-left: 8px; font-size: 14px; font-weight: 600; color: #111827; vertical-align: middle;">Synergy</span>
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 16px 32px 8px;">
              ${attrs.body_html}
              ${cta}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 32px; border-top: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; line-height: 1.6;">
              <p style="margin: 0 0 8px;">
                You're getting this email because notifications are on in your <a href="${escapeAttr(attrs.preferences_url)}" style="color: #2563eb; text-decoration: none;">Synergy email preferences</a>.
              </p>
              <p style="margin: 0;">
                <a href="${escapeAttr(attrs.unsubscribe_url)}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from this type of email</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Specific email templates ──

export function newRequestEmail(args: {
  receiver_component_label: string;
  sender_objective: string | null;
  match_rationale: string | null;
  inbox_url: string;
  preferences_url: string;
  unsubscribe_url: string;
}): { subject: string; preheader: string; html: string } {
  // Privacy: sender is anonymous at this stage. We describe the
  // PROJECT side of things (their objective + the match rationale)
  // not the person.
  const subject = `Someone wants to collaborate on your "${args.receiver_component_label.slice(0, 60)}"`;
  const preheader =
    args.match_rationale?.slice(0, 140) ??
    "Open Synergy to review the request. Identity reveals when you accept.";
  const objectiveLine = args.sender_objective
    ? `<p style="margin: 16px 0 8px; padding: 12px 14px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; font-size: 13px; color: #0c4a6e; line-height: 1.55;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #075985;">their objective</span><br/>
        ${escapeHtml(args.sender_objective.slice(0, 280))}
      </p>`
    : "";
  const rationaleLine = args.match_rationale
    ? `<p style="margin: 16px 0 0; font-size: 13px; color: #374151; line-height: 1.6;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280;">why this match →</span>
        ${escapeHtml(args.match_rationale)}
      </p>`
    : "";

  const body_html = `
    <h1 style="margin: 8px 0 12px; font-size: 22px; font-weight: 600; color: #111827; line-height: 1.3;">
      You have a new connection request
    </h1>
    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6;">
      Someone has a component that complements your <strong>${escapeHtml(args.receiver_component_label)}</strong>.
    </p>
    ${objectiveLine}
    ${rationaleLine}
    <p style="margin: 20px 0 0; font-size: 12px; color: #6b7280;">
      Identity stays anonymous until you accept.
    </p>
  `;

  return {
    subject,
    preheader,
    html: wrapEmail({
      subject,
      preheader,
      body_html,
      cta: { label: "Review request", href: args.inbox_url },
      unsubscribe_url: args.unsubscribe_url,
      preferences_url: args.preferences_url,
    }),
  };
}

export function requestAcceptedEmail(args: {
  display_name: string;
  bio: string | null;
  your_component_label: string;
  room_url: string;
  preferences_url: string;
  unsubscribe_url: string;
}): { subject: string; preheader: string; html: string } {
  const subject = `${args.display_name} accepted your request`;
  const preheader = `Open the shared room to start co-creating on "${args.your_component_label.slice(0, 60)}".`;
  const bioBlock = args.bio
    ? `<p style="margin: 12px 0 0; font-size: 13px; color: #374151; line-height: 1.55; padding: 12px 14px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;">
        ${escapeHtml(args.bio.slice(0, 400))}
      </p>`
    : "";

  const body_html = `
    <h1 style="margin: 8px 0 12px; font-size: 22px; font-weight: 600; color: #111827; line-height: 1.3;">
      ${escapeHtml(args.display_name)} accepted your request
    </h1>
    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6;">
      You can now co-create on <strong>${escapeHtml(args.your_component_label)}</strong> in a shared room — real-time canvas, both authors visible, AI augmentation on demand.
    </p>
    ${bioBlock}
  `;

  return {
    subject,
    preheader,
    html: wrapEmail({
      subject,
      preheader,
      body_html,
      cta: { label: "Open shared room", href: args.room_url },
      unsubscribe_url: args.unsubscribe_url,
      preferences_url: args.preferences_url,
    }),
  };
}

export function matchSurfacedEmail(args: {
  display_name: string;
  new_match_count: number;
  highlight_component_label: string | null;
  highlight_score: number | null;
  discover_url: string;
  preferences_url: string;
  unsubscribe_url: string;
}): { subject: string; preheader: string; html: string } {
  const subject =
    args.new_match_count === 1
      ? `A new high-fit collaborator surfaced on Synergy`
      : `${args.new_match_count} new high-fit collaborators surfaced on Synergy`;
  const preheader =
    args.highlight_component_label && args.highlight_score
      ? `Top match for "${args.highlight_component_label.slice(0, 70)}" scored ${Math.round(args.highlight_score)}/100.`
      : "Open Synergy to review — they stay anonymous until you connect.";
  const highlight = args.highlight_component_label
    ? `<p style="margin: 16px 0 0; padding: 12px 14px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; font-size: 13px; color: #0c4a6e; line-height: 1.55;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #075985;">top match</span><br/>
        Component: <strong>${escapeHtml(args.highlight_component_label)}</strong>${
          args.highlight_score
            ? ` &middot; fit ${Math.round(args.highlight_score)}/100`
            : ""
        }
      </p>`
    : "";

  const body_html = `
    <h1 style="margin: 8px 0 12px; font-size: 22px; font-weight: 600; color: #111827; line-height: 1.3;">
      ${args.new_match_count === 1 ? "A new match for your project" : `${args.new_match_count} new matches`}
    </h1>
    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6;">
      Synergy's matcher surfaced ${args.new_match_count === 1 ? "a candidate" : args.new_match_count + " candidates"} whose components complement yours.
      Identity stays anonymous until you send (or accept) a connection request.
    </p>
    ${highlight}
    <p style="margin: 20px 0 0; font-size: 12px; color: #6b7280;">
      You'll get this email at most once every 24 hours.
    </p>
  `;
  return {
    subject,
    preheader,
    html: wrapEmail({
      subject,
      preheader,
      body_html,
      cta: { label: "Browse matches", href: args.discover_url },
      unsubscribe_url: args.unsubscribe_url,
      preferences_url: args.preferences_url,
    }),
  };
}

export function testEmail(args: {
  display_name: string;
  preferences_url: string;
  unsubscribe_url: string;
}): { subject: string; preheader: string; html: string } {
  const subject = "Synergy email test — you're all set";
  const preheader =
    "If you're reading this, delivery works. Your notification preferences are live.";
  const body_html = `
    <h1 style="margin: 8px 0 12px; font-size: 22px; font-weight: 600; color: #111827; line-height: 1.3;">
      Hi ${escapeHtml(args.display_name)} — delivery works ✓
    </h1>
    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6;">
      This is a test email from your Synergy notification settings. You'll get real ones when a collaborator reaches out about a matchable component, or when someone accepts a request you sent.
    </p>
    <p style="margin: 16px 0 0; font-size: 12px; color: #6b7280;">
      Don't want these? Use the unsubscribe link below — one click, no account login required.
    </p>
  `;
  return {
    subject,
    preheader,
    html: wrapEmail({
      subject,
      preheader,
      body_html,
      unsubscribe_url: args.unsubscribe_url,
      preferences_url: args.preferences_url,
    }),
  };
}

// ── Small HTML escape helpers ──
// Email HTML is user-data-sensitive; we escape everything that
// comes from the DB so display names with `<` don't break the email.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
