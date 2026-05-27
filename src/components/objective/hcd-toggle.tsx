"use client";

// ── HCD Toggle ────────────────────────────────────────────────────
//
// Phase 11 — floating toggle on the main canvas that flips
// spaces.synthesis_data.objective_canvas.hcd_mode. When on, the next
// sub-objective propose run gets an HCD bias mixin (user-role-
// grounded, prototypable framings — see decompose-prompt.ts HCD_MIXIN).
//
// Self-contained: fetches current state on mount, no prop plumbing
// required from the parent. Optimistic update on click; reverts on
// server error. Renders as a pill matching the Notebook button so
// the canvas chrome reads as one toolbar.

import { useCallback, useEffect, useState } from "react";
import { Loader2, User } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  spaceId: string;
}

export function HCDToggle({ spaceId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/brainstorm/space/hcd-mode?spaceId=${spaceId}`,
        );
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { hcd_mode?: boolean };
        if (!cancelled) setEnabled(!!j.hcd_mode);
      } catch {
        // Soft-fail — toggle stays at default false.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  const flip = useCallback(async () => {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/brainstorm/space/hcd-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, enabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next); // revert
      }
    } catch {
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, spaceId]);

  return (
    <button
      type="button"
      onClick={flip}
      disabled={busy || loading}
      className="inline-flex items-center gap-1.5 transition-[background,color] duration-150 ease-out hover:bg-[rgba(15,23,42,0.04)] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: enabled
          ? `${appleVibe.stage.outcomes}14`
          : appleVibe.surface.card,
        color: enabled ? appleVibe.stage.outcomes : appleVibe.text.secondary,
        border: `1px solid ${enabled ? appleVibe.stage.outcomes : appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.pill,
        padding: "5px 11px",
        fontSize: "10.5px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
      }}
      title={
        enabled
          ? "Human-Centered Design bias is ON — proposals will be anchored on user roles + prototypable framings"
          : "Human-Centered Design bias is OFF — click to bias future generations toward user-grounded framings"
      }
    >
      {loading || busy ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <User className="h-3 w-3" strokeWidth={2} />
      )}
      HCD {enabled ? "on" : "off"}
    </button>
  );
}
