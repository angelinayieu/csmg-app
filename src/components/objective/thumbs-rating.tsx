"use client";

// ── Thumbs rating — LLM artifact quality feedback ──────────────────
//
// Tiny inline ↑/↓ control mounted on LLM-produced artifacts
// (variations, composed designs, prototype briefs, etc.). Resolves
// to a feedback row in llm_call_log via PATCH /api/llm/feedback.
//
// Behavior:
//   • Optimistic — click flips local state immediately.
//   • Re-clicking the active state CLEARS it (toggles back to null).
//   • Failures revert + show a small inline error.
//   • No tooltip / no labels by default — keeps the chrome quiet on
//     dense surfaces. The artifact's own card label communicates
//     "this is an AI thing"; the thumbs read as obvious feedback.
//
// Caller passes:
//   • artifactKind + artifactId — must match what the llm_call_log
//     entry was tagged with at generation time (see record-llm-call.ts).
//   • size? — 'sm' (16px icons, default) or 'md' (20px).

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type ThumbsFeedback = "up" | "down" | null;

interface Props {
  artifactKind: string;
  artifactId: string;
  /** Optional initial state — when the parent has pre-loaded the
   *  feedback row, pass it here so the component renders the right
   *  active state from first paint. */
  initial?: ThumbsFeedback;
  /** Visual size. Defaults to 'sm' (16px icons). */
  size?: "sm" | "md";
  /** Optional callback after a successful flip — useful when the
   *  parent wants to track which artifacts have been rated. */
  onChange?: (next: ThumbsFeedback) => void;
}

export function ThumbsRating({
  artifactKind,
  artifactId,
  initial = null,
  size = "sm",
  onChange,
}: Props) {
  const [value, setValue] = useState<ThumbsFeedback>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(next: ThumbsFeedback) {
    const prev = value;
    setError(null);
    // Toggle off when re-clicking the active state.
    const target: ThumbsFeedback = next === prev ? null : next;
    setValue(target);
    setBusy(true);
    try {
      const res = await fetch("/api/llm/feedback", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactKind,
          artifactId,
          feedback: target,
        }),
      });
      if (!res.ok) {
        let detail: string | null = null;
        try {
          const json = await res.json();
          detail = json?.error ?? json?.detail ?? null;
        } catch {
          /* swallow — error message is best-effort */
        }
        setError(detail ?? "Could not save feedback.");
        setValue(prev);
        return;
      }
      onChange?.(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  const iconSize = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  const buttonSize = size === "md" ? "h-6 w-6" : "h-5 w-5";

  return (
    <div className="inline-flex items-center gap-0.5" title={error ?? undefined}>
      <button
        type="button"
        onClick={() => flip("up")}
        disabled={busy}
        aria-label={value === "up" ? "Remove positive rating" : "Rate as good"}
        className={`inline-flex ${buttonSize} items-center justify-center rounded-full transition-colors`}
        style={{
          background:
            value === "up"
              ? "rgba(22,163,74,0.18)"
              : "transparent",
          color:
            value === "up"
              ? "rgba(20,83,45,0.95)"
              : appleVibe.text.tertiary,
          border: `1px solid ${
            value === "up"
              ? "rgba(22,163,74,0.45)"
              : "transparent"
          }`,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <ThumbsUp className={iconSize} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => flip("down")}
        disabled={busy}
        aria-label={value === "down" ? "Remove negative rating" : "Rate as bad"}
        className={`inline-flex ${buttonSize} items-center justify-center rounded-full transition-colors`}
        style={{
          background:
            value === "down"
              ? "rgba(220,38,38,0.14)"
              : "transparent",
          color:
            value === "down"
              ? "rgba(127,29,29,0.95)"
              : appleVibe.text.tertiary,
          border: `1px solid ${
            value === "down"
              ? "rgba(220,38,38,0.42)"
              : "transparent"
          }`,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <ThumbsDown className={iconSize} strokeWidth={2} />
      </button>
    </div>
  );
}
