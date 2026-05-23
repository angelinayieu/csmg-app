"use client";

// Solve modal — opened from the card hover-action "Solve". Takes a
// problem statement anchored on one entity and POSTs to the standard
// /api/pipeline/decompose endpoint with the solve_query intent — same
// path the main canvas dock uses. The chain runs in the background;
// the modal closes on submit and the KG fills in via SSE.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Entity } from "@/types";
import { colors, tracking } from "./tokens";

interface SolveModalProps {
  anchor: Entity;
  spaceId: string;
  onClose: () => void;
}

export function SolveModal({ anchor, spaceId, onClose }: SolveModalProps) {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Esc to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = !submitting && query.trim().length >= 8;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/decompose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: query.trim(),
          existingSpaceId: spaceId,
          reasoningDepth: "deep",
          intent: {
            solve_query: query.trim(),
            anchor_entity_id: anchor.id,
            anchor_entity_name: anchor.name,
            chained_from: "triple_lab_solve",
          },
        }),
      });
      if (!res.ok) {
        setError(`Solve failed (HTTP ${res.status})`);
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Solve request threw");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      style={{ background: colors.neutral.scrim, backdropFilter: "blur(4px)" }}
    >
      <div
        className="rounded-2xl border bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: "calc(100vw - 32px)",
          borderColor: colors.neutral.borderFaint,
          boxShadow: colors.neutral.cardShadowFloating,
        }}
      >
        {/* Eyebrow */}
        <div
          className="mb-1 text-[9.5px] font-bold uppercase"
          style={{
            color: colors.state.leverageFg,
            letterSpacing: tracking.eyebrow,
          }}
        >
          ✦ Solve
        </div>
        {/* Headline */}
        <div className="mb-1 text-[18px] font-bold leading-tight text-slate-900">
          What problem should we explore?
        </div>
        {/* Anchor sub-copy */}
        <div className="mb-4 text-[11.5px] leading-relaxed text-slate-600">
          Anchored on{" "}
          <span className="font-semibold text-slate-900">{anchor.name}</span>.
          The pipeline will decompose your question and propose solution
          paths — typically 30-90s before insights surface.
        </div>

        {/* Textarea */}
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          rows={4}
          placeholder={`e.g. How can I improve ${anchor.name.toLowerCase()} given my current constraints?`}
          className="w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
          style={{
            background: "white",
            borderColor: colors.neutral.borderInput,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onSubmit();
            }
          }}
        />

        {error && (
          <div
            className="mt-2 rounded-md px-2 py-1.5 text-[11px]"
            style={{
              background: colors.state.bottleneckSoft,
              color: colors.state.bottleneckFg,
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center gap-2">
          <div className="text-[10px] text-slate-400">
            ⌘⏎ to submit · Esc to cancel
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ml-auto rounded-md px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="rounded-md px-3.5 py-1.5 text-[11px] font-bold text-white transition-all disabled:opacity-50"
            style={{
              background: canSubmit
                ? colors.brand.gradient
                : "rgba(15, 23, 42, 0.3)",
              boxShadow: canSubmit ? `0 4px 12px ${colors.brand.shadow}` : "none",
            }}
          >
            {submitting ? "Running solve…" : "Run solve →"}
          </button>
        </div>
      </div>
    </div>
  );
}
