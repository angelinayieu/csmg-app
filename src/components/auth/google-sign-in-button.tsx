"use client";

// ── Google sign-in button ──────────────────────────────────────────
//
// Calls `supabase.auth.signInWithOAuth({ provider: 'google' })` which
// redirects the browser to Google's consent screen. After the user
// approves, Google redirects back to Supabase, which redirects to our
// `/auth/callback` route. The existing callback already handles the
// PKCE code exchange (see src/app/auth/callback/route.ts), so no
// server-side changes are needed beyond enabling the Google provider
// in the Supabase dashboard.
//
// Visual: matches Google's brand guidelines — white background, gray
// border, official multicolor "G" mark, "Continue with Google" label.
// (Google's identity branding requires the colored G + a specific
// font weight; this is the closest faithful reproduction without
// shipping their official SDK.)

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

interface GoogleSignInButtonProps {
  /** Path to redirect to after successful auth. Defaults to "/app". */
  next?: string;
  /** Optional disabled state — used by parent forms during their
   *  own submit so the user can't click both at once. */
  disabled?: boolean;
}

export function GoogleSignInButton({
  next = "/app",
  disabled,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    const supabase = createClient();

    // Build the redirect URL — must match what's in Supabase's
    // Auth → URL Configuration → Redirect URLs Allow List, AND what's
    // in Google's authorized redirect URIs (which should be
    // https://<supabase-project-ref>.supabase.co/auth/v1/callback,
    // NOT this app's domain — Supabase handles the OAuth handshake
    // server-side and then redirects to redirectTo below).
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
        : undefined;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // Request offline access so we get a refresh token. Without
        // this, the access token expires after an hour and the user
        // would have to re-auth — bad UX for long sessions.
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
      return;
    }
    // signInWithOAuth navigates the browser away on success, so no
    // explicit redirect needed here. Loading stays true until the
    // page unloads.
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || disabled}
        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-interaxis-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
        ) : (
          // Official Google "G" mark — pure SVG so we don't pull in
          // any external asset / Google brand SDK. Path data taken
          // from Google's identity guidelines (multicolor G).
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden
          >
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
            />
          </svg>
        )}
        <span>{loading ? "Redirecting…" : "Continue with Google"}</span>
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
