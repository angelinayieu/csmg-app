import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// ── Route compaction + Supabase session refresh ───────────────────
//
// This is the SINGLE request-interceptor Next runs (this version renamed
// `middleware` → `proxy`). It does two jobs:
//
//   1. Route compaction. Per the "retire the old build" direction (see
//      project_old_build_deprecation), legacy /app/* surfaces — synergy,
//      lab, whiteboard, strategy, crci, distill, explore, patterns,
//      intake-proposal, use-cases, space, analytics, objectives, the OLD
//      /app/library + /app/settings, … — are redirected to the home so
//      nothing routes back into them. Real new-build surfaces are
//      explicitly allowlisted (bouncing them would visibly break the UI —
//      the profile dropdown's Profile/Credits links and the onboarding
//      gate are the recurring footguns).
//
//      Allowlist (kept live):
//        • /app                       → home
//        • /app/objective[/<id>]      → the objective canvas (the product)
//        • /app/profile               → the new minimal profile page
//        • /app/credits[/...]         → credits dashboard + Stripe success/cancel
//        • /app/welcome               → first-sign-in onboarding gate
//        • /app/connect[/...]         → integration setup (tab-sync, Drive)
//
//      Special case: /app/objective/<id>/sub/* are retired room views;
//      bounce them back to the board itself.
//
//      Everything else /app/* → /app.
//
//   2. Supabase auth-cookie refresh (updateSession) for every other request —
//      the original behaviour, preserved unchanged.

const NEW_BUILD_PREFIXES = [
  "/app/objective",
  "/app/profile",
  "/app/credits",
  "/app/welcome",
  "/app/connect",
];

function isNewBuildRoute(pathname: string): boolean {
  return NEW_BUILD_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/app/")) {
    if (isNewBuildRoute(pathname)) {
      // The objective canvas's OLD downstream room views (/sub/...) are
      // retired — bounce them back to the board itself.
      const subIdx = pathname.indexOf("/sub/");
      if (
        subIdx !== -1 &&
        (pathname === "/app/objective" || pathname.startsWith("/app/objective/"))
      ) {
        const url = request.nextUrl.clone();
        url.pathname = pathname.slice(0, subIdx); // → /app/objective/<id>
        url.search = "";
        return NextResponse.redirect(url);
      }
      // else: fall through to the normal session refresh + render.
    } else {
      // Any other /app/* (the old build) → home.
      const url = request.nextUrl.clone();
      url.pathname = "/app";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Everything else (/, /auth, /api, /app, allowlisted /app/*, …) → session refresh.
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
