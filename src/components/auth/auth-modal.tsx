"use client";

// ── AuthModal ──
//
// Hash-driven, in-place sign-in / sign-up popover that lives on top of
// the landing page so visitors never lose the whiteboard underneath.
// Mount once at the root of any page that should be able to summon it
// (e.g. landing page) — buttons elsewhere just navigate to `#signin` or
// `#signup` and the modal handles the rest.
//
// Design intent:
//   • Backdrop is a frosted white blur so the floating-cards stay
//     legible but obviously out-of-focus → the modal is *the* surface.
//   • Modal itself is a GlassPanel tier="modal" with the akiboe teal
//     accent rim — same vocabulary as the rest of the whiteboard UI.
//   • A segmented pill swaps between sign in and sign up without ever
//     unmounting the modal — feels continuous, not page-y.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InterAxisLogo } from "@/components/brand/interaxis-logo";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const ACCENT = "#00BCD4";

function readHashMode(): Mode | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#/, "").toLowerCase();
  if (h === "signin" || h === "login") return "signin";
  if (h === "signup" || h === "register") return "signup";
  return null;
}

function clearHash() {
  if (typeof window === "undefined") return;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", url);
}

export function AuthModal() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [next, setNext] = useState<string>("/app");
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => {
    const sync = () => {
      setMode(readHashMode());
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("next");
      setNext(raw && raw.startsWith("/") ? raw : "/app");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const close = useCallback(() => {
    clearHash();
    setMode(null);
  }, []);
  closeRef.current = close;

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mode]);

  if (!mode) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "signin" ? "Log in" : "Create account"}
    >
      {/* Translucent backdrop — soft blur so the page underneath stays
          visible (only slightly de-emphasized), modal becomes the focal
          surface without hiding what the user was on. */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 cursor-default animate-[fadeIn_220ms_ease-out]"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 40%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.30) 60%, rgba(244,250,252,0.38) 100%)",
          backdropFilter: "blur(8px) saturate(1.15)",
          WebkitBackdropFilter: "blur(8px) saturate(1.15)",
        }}
      />

      <div className="relative w-full max-w-md animate-[modalIn_320ms_var(--ease-spring-tight,cubic-bezier(0.22,1,0.36,1))]">
        <GlassPanel
          tier="modal"
          accent={ACCENT}
          radius={24}
          className="px-7 pb-7 pt-6"
        >
          {/* Close */}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Brand */}
          <div className="flex flex-col items-center pt-2">
            <InterAxisLogo className="h-8 w-8" size={64} />
            <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-slate-900">
              {mode === "signin"
                ? "Welcome back"
                : "Build your intelligence system"}
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {mode === "signin"
                ? "Pick up where your whiteboard left off."
                : "Free to start. Your prompt comes with you."}
            </p>
          </div>

          {/* Mode toggle */}
          <div
            className="mx-auto mt-5 grid w-full max-w-[260px] grid-cols-2 rounded-full border border-slate-200/70 bg-white/60 p-1 text-[13px] font-medium"
            role="tablist"
          >
            {(["signin", "signup"] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (m === mode) return;
                    window.history.replaceState(null, "", `#${m}`);
                    setMode(m);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 transition-all duration-200",
                    active
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {m === "signin" ? "Log in" : "Sign up"}
                </button>
              );
            })}
          </div>

          <div className="mt-6">
            {mode === "signin" ? (
              <SignInBody next={next} onSwitch={() => switchTo("signup", setMode)} />
            ) : (
              <SignUpBody next={next} onSwitch={() => switchTo("signin", setMode)} />
            )}
          </div>
        </GlassPanel>

        {/* Soft glow under the modal — extra depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-6 -bottom-8 h-24 rounded-full opacity-60 blur-2xl"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, rgba(0,188,212,0.22), rgba(0,188,212,0) 70%)",
          }}
        />
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function switchTo(next: Mode, setMode: (m: Mode) => void) {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", `#${next}`);
  }
  setMode(next);
}

// ── Google button ──────────────────────────────────────────────────
function GoogleButton({
  label,
  next = "/app",
}: {
  label: string;
  next?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-[14px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        <GoogleGlyph />
        {loading ? "Redirecting…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.614z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wider text-slate-400">
      <div className="h-px flex-1 bg-slate-200" />
      or
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

// ── Sign in ────────────────────────────────────────────────────────
function SignInBody({ next, onSwitch }: { next: string; onSwitch: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <GoogleButton label="Continue with Google" next={next} />
      <OrDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="modal-email"
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
      />
      <Input
        id="modal-password"
        label="Password"
        type="password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" loading={loading} className="w-full">
        Log in
      </Button>
      <p className="text-center text-[13px] text-slate-500">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onSwitch}
          className="font-medium text-interaxis-600 hover:text-interaxis-500"
        >
          Sign up
        </button>
      </p>
      </form>
    </div>
  );
}

// ── Sign up ────────────────────────────────────────────────────────
function SignUpBody({ next, onSwitch }: { next: string; onSwitch: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <div className="py-2 text-center">
        <h3 className="text-base font-semibold text-slate-900">
          Check your email
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          activate your account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GoogleButton label="Sign up with Google" next={next} />
      <OrDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="modal-name"
        label="Display name"
        type="text"
        placeholder="Your name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
        autoFocus
      />
      <Input
        id="modal-email-su"
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        id="modal-password-su"
        label="Password"
        type="password"
        placeholder="At least 6 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" loading={loading} className="w-full">
        Create account
      </Button>
      <p className="text-center text-[13px] text-slate-500">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitch}
          className="font-medium text-interaxis-600 hover:text-interaxis-500"
        >
          Log in
        </button>
      </p>
      </form>
    </div>
  );
}
