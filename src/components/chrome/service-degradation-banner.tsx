"use client";

// ── Service-degradation banner ───────────────────────────────────────
//
// Top-of-app yellow banner that surfaces when the Supabase circuit
// breaker (src/lib/supabase-retry.ts) is open. Without this, a
// degraded Supabase manifests as scattered "Service temporarily
// unavailable" toasts on individual actions — the user has no
// global view that "the whole service is having an episode, my
// requests aren't going to work for the next ~30s."
//
// Polls /api/health/supabase. Polling cadence:
//   - 60s on the green path (cheap; doesn't hit Supabase)
//   - 10s when degraded=true OR a 5xx response was just seen
//
// Renders a sticky 32px-tall yellow strip at the top of the viewport
// with:
//   - Status icon (yellow alert when degraded; spinner during transition)
//   - Plain-language copy ("Service degraded — auto-recovering in 23s")
//   - Live countdown
//
// Auto-fades when degraded=false and stays hidden until the next
// failure. Mounted at the app shell (layout.tsx) so it covers every
// authenticated page.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface HealthResponse {
  degraded: boolean;
  recentFailureCount: number;
  cooldownRemainingMs: number | null;
}

const POLL_GREEN_MS = 60_000;
const POLL_DEGRADED_MS = 10_000;
const FADE_OUT_MS = 4_000; // briefly show "✓ recovered" before hiding

type BannerState =
  /** Healthy — banner hidden. */
  | { kind: "hidden" }
  /** Currently degraded — show yellow banner with countdown. */
  | { kind: "degraded"; cooldownEndMs: number }
  /** Just recovered — show green ✓ for a few seconds before hiding. */
  | { kind: "recovering"; until: number };

export function ServiceDegradationBanner() {
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const [tick, setTick] = useState(0);

  // ── Polling ──
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/health/supabase", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as HealthResponse;
        if (cancelled) return;

        if (j.degraded) {
          const cooldownEndMs =
            Date.now() + (j.cooldownRemainingMs ?? 30_000);
          setState({ kind: "degraded", cooldownEndMs });
        } else {
          setState((prev) => {
            // Just transitioned from degraded → healthy: show
            // "recovered" briefly so the user sees confirmation
            // rather than a silent unhide.
            if (prev.kind === "degraded") {
              return { kind: "recovering", until: Date.now() + FADE_OUT_MS };
            }
            return prev;
          });
        }
      } catch {
        // Health endpoint unreachable — likely a network blip on
        // the client side. Don't change state.
      }
    };

    void check();
    const isDegraded = state.kind === "degraded";
    const intervalMs = isDegraded ? POLL_DEGRADED_MS : POLL_GREEN_MS;
    const interval = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state.kind]);

  // ── Live countdown tick (only when banner is visible) ──
  useEffect(() => {
    if (state.kind === "hidden") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [state.kind]);

  // ── State transitions on tick ──
  useEffect(() => {
    if (state.kind === "recovering" && Date.now() >= state.until) {
      setState({ kind: "hidden" });
    }
    if (state.kind === "degraded" && Date.now() >= state.cooldownEndMs) {
      // Cooldown expired client-side. Don't auto-hide — wait for the
      // next health poll to confirm recovery (could still be down).
      // Re-render with 0s remaining so the user sees "Auto-recovering
      // any moment now…" instead of a stuck countdown.
    }
  }, [tick, state]);

  if (state.kind === "hidden") return null;

  if (state.kind === "recovering") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto fixed left-0 right-0 top-0 z-[80] flex items-center justify-center gap-2 bg-emerald-50 px-4 py-2 text-[12px] font-medium text-emerald-800 shadow-sm"
        style={{
          borderBottom: "1px solid rgba(16,185,129,0.3)",
          transition: "opacity 600ms ease",
        }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Service recovered. You can retry any failed actions.
      </div>
    );
  }

  // degraded
  const remainingMs = Math.max(0, state.cooldownEndMs - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1000);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed left-0 right-0 top-0 z-[80] flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-[12px] font-medium text-amber-900 shadow-sm"
      style={{ borderBottom: "1px solid rgba(245,158,11,0.35)" }}
    >
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
      <span>
        Service degraded — Supabase connectivity is intermittent. Some
        actions may fail.{" "}
        {remainingSec > 0 ? (
          <>
            Auto-recovering in <strong className="tabular-nums">{remainingSec}s</strong>.
          </>
        ) : (
          <>Auto-recovering any moment now…</>
        )}
      </span>
    </div>
  );
}
