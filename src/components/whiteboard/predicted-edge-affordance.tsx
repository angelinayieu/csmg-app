"use client";

// ── PredictedEdgeAffordance ──
//
// Small floating pill at the midpoint of a predicted edge with accept (✓)
// and reject (✗) actions. Only rendered for edges where source_tag="predicted"
// and requires_user_approval=true. Appears on hover of the edge's bounding
// area or is always-visible when there are pending predictions.

import React, { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Canvas-space midpoint of the edge */
  x: number;
  y: number;
  edgeId: string;
  reasoning?: string | null;
  confidence?: number;
  /** Always visible on spawn; auto-fades if the user doesn't interact. */
  alwaysVisible?: boolean;
  onAccept: (edgeId: string) => Promise<void>;
  onReject: (edgeId: string) => Promise<void>;
}

export function PredictedEdgeAffordance({
  x,
  y,
  edgeId,
  reasoning,
  confidence,
  alwaysVisible,
  onAccept,
  onReject,
}: Props) {
  const [busy, setBusy] = useState<"accepting" | "rejecting" | null>(null);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const handleAccept = async () => {
    if (busy) return;
    setBusy("accepting");
    try {
      await onAccept(edgeId);
      setHidden(true); // edge will re-render as non-predicted; hide overlay
    } catch (err) {
      console.warn("[PredictedEdgeAffordance] Accept failed:", err);
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (busy) return;
    setBusy("rejecting");
    try {
      await onReject(edgeId);
      setHidden(true);
    } catch (err) {
      console.warn("[PredictedEdgeAffordance] Reject failed:", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={cn(
        "absolute z-20 wb-predicted-affordance",
        (alwaysVisible || true) && "wb-visible",
      )}
      style={{
        left: x - 40,
        top: y - 14,
      }}
      data-no-pan
    >
      <div
        className="flex items-center gap-0.5 rounded-full bg-white/95 backdrop-blur border border-indigo-200 shadow-md px-1 py-0.5"
        title={reasoning ?? "Predicted connection — accept or reject"}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAccept();
          }}
          disabled={busy !== null}
          className={cn(
            "w-6 h-6 grid place-items-center rounded-full transition-colors",
            busy === "accepting" ? "bg-emerald-100" : "hover:bg-emerald-100 text-emerald-600",
            busy === "rejecting" && "opacity-50 cursor-not-allowed",
          )}
          title="Accept connection"
        >
          {busy === "accepting" ? (
            <Loader2 className="h-3 w-3 animate-spin text-emerald-600" />
          ) : (
            <Check className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleReject();
          }}
          disabled={busy !== null}
          className={cn(
            "w-6 h-6 grid place-items-center rounded-full transition-colors",
            busy === "rejecting" ? "bg-rose-100" : "hover:bg-rose-100 text-rose-500",
            busy === "accepting" && "opacity-50 cursor-not-allowed",
          )}
          title="Reject connection"
        >
          {busy === "rejecting" ? (
            <Loader2 className="h-3 w-3 animate-spin text-rose-600" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </button>
        {typeof confidence === "number" && (
          <span
            className="px-1 text-[9px] font-mono font-semibold text-indigo-500 border-l border-gray-200"
            style={{ marginLeft: 2, paddingLeft: 5 }}
          >
            {Math.round(confidence * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
