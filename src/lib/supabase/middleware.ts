import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  try {
    let supabaseResponse = NextResponse.next({
      request,
    });

    // ── RSC prefetch fast-path ──────────────────────────────────────
    //
    // Next.js sends `?_rsc=<hash>` GETs whenever a Link prefetches a
    // route. Under certain conditions (re-mounting Links, prefetch
    // loops on the public landing) we'd see *thousands* of these in
    // seconds — each one used to call `supabase.auth.getSession()`,
    // which burns through the project's auth rate limit. Once the
    // rate limit trips, every legitimate auth call (including the
    // browser's silent token refresh) starts failing with
    // "TypeError: Failed to fetch", which then logs the user out and
    // makes the whiteboard look empty (RLS denies their own data).
    //
    // RSC prefetches don't need their session refreshed — they're
    // background prefetches; the user-visible navigation that follows
    // will hit the middleware again and refresh then. Pass through.
    const isRscPrefetch =
      request.nextUrl.searchParams.has("_rsc") ||
      request.headers.get("rsc") === "1" ||
      request.headers.get("next-router-prefetch") === "1";
    if (isRscPrefetch) {
      return supabaseResponse;
    }

    const pathname = request.nextUrl.pathname;
    const needsAuthCheck =
      pathname.startsWith("/app") || pathname.startsWith("/auth");

    // ── Public-route fast-path ──────────────────────────────────────
    //
    // Public pages (marketing landing, pricing, etc.) don't gate on
    // auth and don't need a fresh session cookie on every render —
    // skip Supabase entirely so a flood of public-page requests can't
    // exhaust the auth rate limit. The user's existing session cookie
    // stays valid; it'll be refreshed the next time they hit a
    // protected route.
    if (!needsAuthCheck) {
      return supabaseResponse;
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Redirect unauthenticated users away from protected routes
    if (!user && pathname.startsWith("/app")) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      return NextResponse.redirect(url);
    }

    // Redirect authenticated users away from auth pages
    if (user && pathname.startsWith("/auth")) {
      const url = request.nextUrl.clone();
      url.pathname = "/app";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch (err) {
    // If Supabase is down, let the request through rather than crashing
    // Individual API routes will handle auth failures with proper JSON errors
    console.error("[Middleware] Session update failed:", err);
    return NextResponse.next({ request });
  }
}
