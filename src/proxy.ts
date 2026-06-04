import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// ── Route compaction + Supabase session refresh ───────────────────
//
// This is the SINGLE request-interceptor Next runs (this version renamed
// `middleware` → `proxy`). It does two jobs:
//
//   1. Route compaction. The new build is ONLY the home + the objective
//      canvas. Per the "retire the old build" direction (see
//      project_old_build_deprecation), every other /app/* surface — synergy,
//      lab, whiteboard, strategy, crci, distill, explore, patterns,
//      intake-proposal, use-cases, workspace, connect, space, analytics,
//      objectives, the OLD settings + library pages, … — is legacy (stale
//      design + wrong routing). Rather than delete them (this is reversible),
//      we redirect them all to the home so nothing routes into the old build.
//      Library + settings now live ON the objective board (the rail + the
//      minimalist BoardSettingsLauncher), not as separate pages.
//
//        • /app                       → home (untouched, falls through)
//        • /app/objective[/<id>]      → the objective canvas (the product)
//        • /app/objective/<id>/sub/*  → OLD room views → back to the board
//        • everything else /app/*     → home
//
//   2. Supabase auth-cookie refresh (updateSession) for every other request —
//      the original behaviour, preserved unchanged.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/app/")) {
    // Match the exact segment so the OLD plural /app/objectives route is NOT
    // mistaken for the (singular) objective canvas.
    const isObjective =
      pathname === "/app/objective" || pathname.startsWith("/app/objective/");

    if (isObjective) {
      // The objective canvas is the new build. Its OLD downstream room views
      // (/sub/...) are retired — bounce them back to the board itself.
      const subIdx = pathname.indexOf("/sub/");
      if (subIdx !== -1) {
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

  // Everything else (/, /auth, /api, /app, /app/objective, …) → session refresh.
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
