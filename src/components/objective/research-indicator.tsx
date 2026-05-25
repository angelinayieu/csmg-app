"use client";

// ── Research indicator ────────────────────────────────────────────
//
// Small status chip mounted near the top of the clarifying /
// picking surfaces. Polls /api/brainstorm/research/status every
// few seconds so the user can SEE the background research happen.
//
// Three rendered states:
//   pending     → spinning sparkle + "Researching your domain…"
//   complete    → checkmark + "N sources" (clickable → opens
//                 the sources sheet via onOpenSources callback)
//   skipped/idle → nothing (silent — matches the "skip silently
//                  on weak results" policy)
//
// The polling stops automatically once status === "complete" or
// "skipped" so we don't burn API calls forever.

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface StatusPayload {
  surface: {
    status: "idle" | "pending" | "complete" | "skipped" | "error";
    source_count: number;
    skip_reason: string | null;
  };
  deep: {
    status: "idle" | "pending" | "complete" | "skipped" | "error";
    source_count: number;
  };
}

interface Props {
  spaceId: string;
  /** When true, the indicator shows both passes (used on the picker
   *  surface where deep research is in flight too). Otherwise just
   *  surface (clarifying card). */
  showDeep?: boolean;
  /** Click handler when the indicator shows complete sources.
   *  Opens a sheet listing them. */
  onOpenSources?: () => void;
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 60; // Cap at ~2.5 minutes to avoid infinite polling.

export function ResearchIndicator({
  spaceId,
  showDeep = false,
  onOpenSources,
}: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const pollsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(
          `/api/brainstorm/research/status?spaceId=${encodeURIComponent(spaceId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setStatus(json);
      } catch {
        // Silent — polling is best-effort.
      }
    }

    // Initial fetch + interval.
    void poll();
    const interval = window.setInterval(() => {
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) {
        window.clearInterval(interval);
        return;
      }
      // Stop polling once both passes have settled.
      const s = statusRef.current;
      const surfaceSettled =
        s &&
        (s.surface.status === "complete" ||
          s.surface.status === "skipped" ||
          s.surface.status === "error");
      const deepSettled =
        s &&
        (s.deep.status === "complete" ||
          s.deep.status === "skipped" ||
          s.deep.status === "error" ||
          s.deep.status === "idle");
      const wantDeep = showDeep;
      if (surfaceSettled && (!wantDeep || deepSettled)) {
        window.clearInterval(interval);
        return;
      }
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, showDeep]);

  // Keep a ref of status so the interval body can check the latest
  // value without re-creating the interval.
  const statusRef = useRef<StatusPayload | null>(null);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  if (!status) return null;

  // Decide what to render.
  const surface = status.surface;
  const deep = status.deep;

  // Silent skip cases — surface skipped on insufficient specificity
  // or missing API key. We honestly say nothing rather than fake
  // a research event.
  if (
    surface.status === "skipped" ||
    surface.status === "idle" ||
    surface.status === "error"
  ) {
    return null;
  }

  const surfacePending = surface.status === "pending";
  const surfaceComplete = surface.status === "complete";
  const deepPending = showDeep && deep.status === "pending";
  const deepComplete = showDeep && deep.status === "complete";

  const anyPending = surfacePending || deepPending;
  const totalSources = surface.source_count + (showDeep ? deep.source_count : 0);

  return (
    <button
      type="button"
      onClick={onOpenSources}
      disabled={!onOpenSources || !surfaceComplete}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-all"
      style={{
        background: anyPending
          ? "rgba(124,58,237,0.06)"
          : surfaceComplete
            ? "rgba(22,163,74,0.06)"
            : "rgba(15,23,42,0.04)",
        color: anyPending
          ? "rgba(91,33,182,0.95)"
          : surfaceComplete
            ? "rgba(20,83,45,0.95)"
            : appleVibe.text.tertiary,
        border: `1px solid ${
          anyPending
            ? "rgba(124,58,237,0.18)"
            : surfaceComplete
              ? "rgba(22,163,74,0.22)"
              : appleVibe.stroke.hairline
        }`,
        cursor: onOpenSources && surfaceComplete ? "pointer" : "default",
      }}
      title={
        anyPending
          ? "Researching your domain in the background"
          : surfaceComplete
            ? `Found ${totalSources} source${totalSources === 1 ? "" : "s"}${
                deepComplete ? " (deep pass complete)" : ""
              }`
            : "Research idle"
      }
      aria-live="polite"
    >
      {anyPending ? (
        <Loader2
          className="h-3 w-3 animate-spin"
          strokeWidth={2.5}
        />
      ) : surfaceComplete ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : (
        <Sparkle className="h-3 w-3" />
      )}
      <span>
        {anyPending
          ? deepPending
            ? "Going deeper…"
            : "Researching domain…"
          : `${totalSources} source${totalSources === 1 ? "" : "s"} found`}
      </span>
    </button>
  );
}
