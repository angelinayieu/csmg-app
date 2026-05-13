// ── POST /api/synergy/email/unsubscribe ──
//
// One-click unsubscribe via a signed token from the email footer.
// Public endpoint — no auth header required, since the user clicks
// from an email client where they're not logged in. The token is
// the only proof of identity.
//
// Body: { token: string }
// Response: { ok: true, notification_key } | { ok: false, reason }

import { NextResponse } from "next/server";
import { redeemUnsubscribeToken } from "@/lib/email/tokens";

interface Body {
  token?: unknown;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body" },
      { status: 400 },
    );
  }
  if (typeof body.token !== "string" || body.token.length < 10) {
    return NextResponse.json(
      { ok: false, reason: "invalid_token" },
      { status: 400 },
    );
  }

  const result = await redeemUnsubscribeToken(body.token);
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "expired"
          ? 410
          : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({
    ok: true,
    notification_key: result.notification_key,
  });
}
