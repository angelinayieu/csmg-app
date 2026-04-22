// ── Cross-domain analog card (Phase 2H) ──
//
// Renders when the analog-retrieval pipeline emits a
// structural_analog_found event. Shows the LLM's headline + entity
// pairings + insight as an expandable canvas card.
//
// Two rendering modes:
//   • Anchored (screenX/screenY provided) — absolute-positioned
//     centered on a canvas coordinate. Use when the card is
//     spatially tied to an entity or region.
//   • Inline (no screen coords) — renders as a normal flow child.
//     Used by the analog rail overlay to stack multiple cards.
//
// Privacy contract (cross-user variant):
//   • No link back to the analog space — clicking the card only
//     expands the pairings panel.
//   • No owner/user name shown.
//   • Summary text comes from the kg_signature row, which was
//     generated from labels only (no prompts, no descriptions).

"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, ChevronDown, ChevronUp, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasAnalogCardProps {
  /** Optional canvas-space anchor. When omitted, the card renders inline
   *  (used by the rail overlay); when provided, it absolute-positions
   *  centered on that screen coordinate. */
  screenX?: number;
  screenY?: number;
  headline: string;
  insight: string;
  confidence: number;
  similarity: number;
  isCrossUser: boolean;
  mode: "structural" | "blended";
  analogSummary: string | null;
  entityPairings: Array<{
    sourceEntityName: string;
    analogEntityName: string;
    reason: string;
  }>;
  onDismiss?: () => void;
}

export function CanvasAnalogCard({
  screenX,
  screenY,
  headline,
  insight,
  confidence,
  similarity,
  isCrossUser,
  mode,
  analogSummary,
  entityPairings,
  onDismiss,
}: CanvasAnalogCardProps) {
  const [expanded, setExpanded] = useState(false);

  const confidencePct = Math.round(confidence * 100);
  const similarityPct = Math.round(similarity * 100);
  const anchored = typeof screenX === "number" && typeof screenY === "number";

  const card = (
    <div
      className={cn(
        "pointer-events-auto w-[320px] rounded-xl border bg-white/95 shadow-lg backdrop-blur-md",
        "border-violet-200",
      )}
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-violet-600">
            <span>Structural analog</span>
            <span className="text-gray-300">·</span>
            <span>{mode}</span>
            {isCrossUser ? (
              <span className="inline-flex items-center gap-0.5 text-gray-500">
                <Users className="h-3 w-3" />
                cross-user
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-gray-500">
                <User className="h-3 w-3" />
                your space
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[13.5px] font-semibold leading-snug text-gray-900">
            {headline}
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[10px] font-semibold text-gray-400 hover:text-gray-600"
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>

      <div className="px-3 py-2 text-[12px] leading-snug text-gray-700">
        {insight}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between border-t border-violet-100 px-3 py-1.5 text-[10.5px] font-medium text-violet-600 hover:bg-violet-50"
      >
        <span>
          {entityPairings.length} pairing{entityPairings.length === 1 ? "" : "s"}
          {analogSummary ? ` · ${analogSummary.slice(0, 40)}` : ""}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-violet-100 px-3 py-2">
          {entityPairings.map((p, i) => (
            <div
              key={i}
              className="rounded-md border border-violet-100 bg-violet-50/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-1 text-[11px] font-medium text-gray-900">
                <span className="truncate">{p.sourceEntityName}</span>
                <ArrowRight className="h-2.5 w-2.5 shrink-0 text-violet-500" />
                <span className="truncate">{p.analogEntityName}</span>
              </div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-gray-600">
                {p.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-violet-100 px-3 py-1.5 text-[9.5px] text-gray-500">
        <span>confidence {confidencePct}%</span>
        <span>similarity {similarityPct}%</span>
      </div>
    </div>
  );

  if (!anchored) return card;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: screenX, top: screenY, transform: "translate(-50%, -50%)" }}
    >
      {card}
    </div>
  );
}
