"use client";

import { Loader2, Sparkles, X, TrendingUp, AlertTriangle, CircleDot, BookmarkPlus, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CombinationResult, CombinationNovelty } from "../hooks/use-canvas-combination";

const NOVELTY_STYLE: Record<CombinationNovelty, { label: string; accent: string; icon: typeof Sparkles }> = {
  emergent: { label: "Emergent", accent: "#10B981", icon: Sparkles },
  reinforcing: { label: "Reinforcing", accent: "#3B82F6", icon: TrendingUp },
  tension: { label: "Tension", accent: "#EF4444", icon: AlertTriangle },
  trivial: { label: "Trivial", accent: "#8592a8", icon: CircleDot },
};

export interface CanvasCombinationCardProps {
  midScreenX: number;
  midScreenY: number;
  loading: boolean;
  error: string | null;
  result: CombinationResult | null;
  sourceCount: number;
  /** Whether the current slot's combination is already saved as a Reaction. */
  saved: boolean;
  /** True while a save is inflight. */
  saving: boolean;
  onClose: () => void;
  onAppendProbe?: (q: string) => void;
  onSaveReaction?: () => void;
}

export function CanvasCombinationCard({
  midScreenX,
  midScreenY,
  loading,
  error,
  result,
  sourceCount,
  saved,
  saving,
  onClose,
  onAppendProbe,
  onSaveReaction,
}: CanvasCombinationCardProps) {
  const style = result ? NOVELTY_STYLE[result.novelty] : NOVELTY_STYLE.trivial;
  const Icon = style.icon;

  return (
    <div
      className="pointer-events-none absolute z-40"
      style={{
        left: midScreenX,
        top: midScreenY,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="pointer-events-auto w-[340px] overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 shadow-[0_20px_60px_-12px_rgba(0,0,40,0.28)] backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent stripe */}
        <div className="h-0.5 w-full" style={{ background: style.accent }} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-1.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={{ background: `${style.accent}18`, color: style.accent }}
            >
              <Icon className="h-2.5 w-2.5" />
            </div>
            <div
              className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
              style={{ color: style.accent }}
            >
              {style.label} intersection
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pb-3">
          {loading && !result && (
            <div className="flex items-center gap-2 py-2 text-[11.5px] text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Interpreting combination of {sourceCount} entities…
            </div>
          )}
          {error && !loading && (
            <div className="py-2 text-[11.5px] text-red-500">{error}</div>
          )}
          {result && (
            <>
              <div className="mt-1 text-[14px] font-bold leading-tight tracking-tight text-gray-900">
                {result.title}
              </div>
              <div className="mt-2 text-[11.5px] leading-relaxed text-gray-700">
                {result.implication}
              </div>
              {result.mechanism && (
                <div
                  className="mt-2 rounded-lg px-2.5 py-1.5 text-[10.5px] italic text-gray-600"
                  style={{
                    background: `${style.accent}0c`,
                    borderLeft: `2px solid ${style.accent}55`,
                  }}
                >
                  {result.mechanism}
                </div>
              )}

              {result.source_entities.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {result.source_entities.map((e) => (
                    <span
                      key={e.id}
                      className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-gray-700"
                      title={e.name}
                    >
                      {e.name.length > 22 ? e.name.slice(0, 22) + "…" : e.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Save-as-Reaction — Phase 11 */}
              {onSaveReaction && (
                <button
                  onClick={onSaveReaction}
                  disabled={saving || saved}
                  className={cn(
                    "mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-colors",
                    saved
                      ? "bg-green-50 text-green-700"
                      : saving
                        ? "bg-gray-100 text-gray-500"
                        : "bg-gray-900 text-white hover:bg-black",
                  )}
                  title={
                    saved
                      ? "This reaction is saved — downstream agents can consume it"
                      : "Persist this interpretation as a named Reaction"
                  }
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : saved ? (
                    <BookmarkCheck className="h-3 w-3" />
                  ) : (
                    <BookmarkPlus className="h-3 w-3" />
                  )}
                  {saved ? "Saved as Reaction" : saving ? "Saving…" : "Save as Reaction"}
                </button>
              )}

              {result.probes.length > 0 && (
                <div className="mt-2.5">
                  <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-400">
                    Probe further
                  </div>
                  <ul className="flex flex-col gap-1">
                    {result.probes.map((q, i) => (
                      <li key={i}>
                        <button
                          onClick={() => onAppendProbe?.(q)}
                          disabled={!onAppendProbe}
                          className={cn(
                            "block w-full rounded-md border border-gray-100 bg-white px-2 py-1.5 text-left text-[11px] text-gray-700 transition-shadow",
                            onAppendProbe ? "hover:shadow" : "cursor-default opacity-80",
                          )}
                        >
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
