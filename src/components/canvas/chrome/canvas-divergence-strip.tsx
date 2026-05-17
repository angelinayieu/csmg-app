"use client";

// ── Canvas divergence strip ──
//
// Persistent top-center chip that surfaces when the framing panel
// recorded lens disagreement (`frame.divergences[]` with severity ≥
// surface) OR when the panel emitted multiple candidate whole framings
// (`frame.candidate_framings.length > 1`). Replaces the previous UX
// where the only signal of panel disagreement was a 200ms flash of the
// framing-proposal-gate before it auto-dismissed.
//
// What it shows:
//   - A small amber chip: "N lenses framed this differently — see N alternatives"
//   - Click → routes to /app/space/[id]/framing (the existing side-by-side
//     comparison page) which is already built but unreachable once the
//     gate dismisses.
//   - Per-space dismissal stored in localStorage so it doesn't nag on
//     every re-open, but a NEW divergence (later run, different frame
//     signature) un-dismisses by varying the storage key.
//
// Design discipline:
//   - Amber not red. Disagreement is information, not error.
//   - One row, never wraps. Compact.
//   - Does not animate on mount (would compete with the stage
//     indicator's intake animation) — fades in only when first
//     rendered, then stays put.
//   - Self-hides entirely when frame is null, no divergences exist,
//     and only one candidate framing exists. The user never sees a
//     "no divergences" empty state.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { canvasNavigate } from "@/lib/canvas/canvas-bus";
import { useSituationFrame } from "../situation-frame-context";

interface Props {
  spaceId: string;
}

// Storage-key base. We append a stable frame fingerprint so dismissing
// one framing's strip doesn't suppress a future re-framing.
const STORAGE_PREFIX = "interaxis:divergence-strip-dismissed";

export function CanvasDivergenceStrip({ spaceId }: Props) {
  const { frame, surfaceDivergences, candidateFramings } = useSituationFrame();
  const [dismissed, setDismissed] = useState(false);

  // Frame fingerprint — combines framed_at + divergence count + framing
  // count so dismissal is keyed to a specific framing decision. A later
  // re-frame (new framed_at) un-dismisses automatically.
  const fingerprint = useMemo(() => {
    if (!frame) return null;
    return [
      frame.framed_at ?? "",
      surfaceDivergences.length,
      candidateFramings.length,
    ].join("|");
  }, [frame, surfaceDivergences.length, candidateFramings.length]);

  const storageKey = useMemo(
    () => (fingerprint ? `${STORAGE_PREFIX}:${spaceId}:${fingerprint}` : null),
    [spaceId, fingerprint],
  );

  // Check dismissal flag on mount + every time fingerprint changes.
  useEffect(() => {
    if (!storageKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  const handleOpen = useCallback(() => {
    canvasNavigate(`/app/space/${spaceId}/framing`);
  }, [spaceId]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, "1");
      } catch {
        // localStorage full / private mode — strip is already hidden
        // for this session; it'll re-appear on next mount.
      }
    }
  }, [storageKey]);

  // Visibility gate. Strip renders only when:
  //   - frame loaded (we have a fingerprint),
  //   - has SOMETHING to say: either a surface-level divergence OR
  //     at least 2 candidate framings (the user has alternatives to
  //     pick from regardless of formal disagreement),
  //   - user hasn't dismissed THIS framing's strip.
  const hasSignal =
    surfaceDivergences.length > 0 || candidateFramings.length > 1;
  if (!frame || !hasSignal || dismissed) {
    return null;
  }

  // Compose message. Prioritize divergence count when present; fall back
  // to "N alternatives" framing when only candidate count > 1.
  const messageParts: string[] = [];
  if (surfaceDivergences.length > 0) {
    messageParts.push(
      `${surfaceDivergences.length} ${
        surfaceDivergences.length === 1 ? "lens disagreement" : "lens disagreements"
      }`,
    );
  }
  if (candidateFramings.length > 1) {
    messageParts.push(
      `${candidateFramings.length} candidate framings`,
    );
  }
  const message = messageParts.join(" · ");

  // CTA count — what the user will see when they open the picker page.
  // Prefer candidate framings count; the picker shows framings as cards.
  const ctaCount = Math.max(candidateFramings.length, 1);

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-14 z-[35] -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 6px 5px 10px",
          borderRadius: 999,
          background:
            "linear-gradient(180deg, rgba(254, 243, 199, 0.92) 0%, rgba(253, 230, 138, 0.92) 100%)",
          border: "1px solid rgba(217, 119, 6, 0.35)",
          boxShadow:
            "0 1px 2px rgba(146, 64, 14, 0.08), 0 8px 24px -10px rgba(146, 64, 14, 0.22)",
          backdropFilter: "blur(10px)",
          fontSize: 11,
          fontWeight: 500,
          color: "#78350f",
        }}
      >
        <AlertTriangle
          aria-hidden
          style={{ width: 12, height: 12, color: "#b45309", flexShrink: 0 }}
        />
        <span style={{ whiteSpace: "nowrap" }}>
          The panel found {message}
        </span>
        <button
          type="button"
          onClick={handleOpen}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10.5,
            fontWeight: 600,
            color: "#7c2d12",
            background: "rgba(255, 255, 255, 0.72)",
            border: "1px solid rgba(217, 119, 6, 0.28)",
            borderRadius: 999,
            padding: "2px 8px",
            cursor: "pointer",
            transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255, 255, 255, 0.95)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(255, 255, 255, 0.72)";
          }}
        >
          See {ctaCount} alternative{ctaCount === 1 ? "" : "s"}
          <ArrowRight aria-hidden style={{ width: 10, height: 10 }} />
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss divergence strip"
          title="Dismiss for this framing"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            border: "none",
            background: "transparent",
            color: "rgba(120, 53, 15, 0.6)",
            cursor: "pointer",
            padding: 0,
            borderRadius: 999,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#78350f";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "rgba(120, 53, 15, 0.6)";
          }}
        >
          <X aria-hidden style={{ width: 12, height: 12 }} />
        </button>
      </div>
    </div>
  );
}
