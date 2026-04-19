// ── Next.js middleware ────────────────────────────────────────────────
//
// Wires up Supabase auth session refresh on every (non-static) request.
// Without this, server-side `auth.getUser()` calls in layouts/pages can
// hang for seconds while they re-validate stale JWT tokens with Supabase
// — which is exactly the "login takes forever" symptom users see when
// the middleware is missing.
//
// The actual logic lives in `lib/supabase/middleware.updateSession` so
// it stays testable in isolation.

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// Skip the middleware for static assets — running auth refresh on every
// `/_next/image` request would be wasteful and slow first paint. Anything
// not matched here still works; it just doesn't get the cookie refresh.
export const config = {
  matcher: [
    // Match everything EXCEPT:
    //   - _next/static (chunks/CSS)
    //   - _next/image (image optimization)
    //   - favicon.ico
    //   - common image file extensions
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
