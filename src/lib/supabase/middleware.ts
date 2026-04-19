import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  try {
    let supabaseResponse = NextResponse.next({
      request,
    });

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

    // ── Rate-limit protection ──
    // Only call getUser() for protected routes (/app/*) and auth routes.
    // Skip for API routes (they handle auth themselves via safeAuth),
    // public pages, and other non-critical paths.
    const pathname = request.nextUrl.pathname;
    const needsAuthCheck =
      pathname.startsWith("/app") || pathname.startsWith("/auth");

    if (!needsAuthCheck) {
      // For non-protected routes, just refresh the session cookie
      // without making a full getUser() API call
      await supabase.auth.getSession();
      return supabaseResponse;
    }

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
