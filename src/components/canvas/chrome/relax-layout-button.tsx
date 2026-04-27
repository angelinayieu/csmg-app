"use client";

// ── Relax Layout button (T2.1, docs/KG_DEPTH_CRITIQUE.md) ──
//
// Per the canvas-physics audit (score 3/10): the main whiteboard
// places kg-node-shapes in a deterministic 5-layer grid and never
// moves them. This button gives the user explicit control to run
// the existing force-layout module (Eades spring relaxation) over
// the entire KG — connected nodes settle near each other, hubs get
// breathing room, and the canvas reflows from "frozen constellation"
// to "settled network."
//
// User-triggered, NOT auto-fired. Auto-reflowing a canvas the user
// has been interacting with would be jarring (shapes the user moved
// would snap to algorithm positions). The button:
//
//   - Sits in the bottom-right above the bottom dock so it's
//     discoverable without dominating the canvas
//   - Disables itself while a relaxation animation is in flight
//   - Reverses to a "settling…" state with a Loader2 icon during
//     the rAF interpolation (~700ms)
//   - On completion, briefly shows a "✓ Relaxed" pill before
//     restoring to the default state (~1.5s)
//
// The relaxation itself lives in `useForceRelaxation()` — this
// component is purely the trigger UI.

import { useCallback, useState } from "react";
import { Loader2, Magnet, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useForceRelaxation } from "../hooks/use-force-relaxation";

type ButtonState = "idle" | "relaxing" | "complete";

export interface RelaxLayoutButtonProps {
  /** Optional className override for positioning. Default places the
   *  button bottom-right above the bottom dock. */
  className?: string;
}

export function RelaxLayoutButton({ className }: RelaxLayoutButtonProps) {
  const { relax } = useForceRelaxation();
  const [state, setState] = useState<ButtonState>("idle");
  const [stats, setStats] = useState<{
    nodesMoved: number;
    edgesConsidered: number;
  } | null>(null);

  const handleClick = useCallback(async () => {
    if (state === "relaxing") return;
    setState("relaxing");
    setStats(null);
    const result = await relax();
    if (result) {
      setStats({
        nodesMoved: result.nodesMoved,
        edgesConsidered: result.edgesConsidered,
      });
      setState("complete");
      // After a brief celebration, restore the default state so the
      // user can re-relax (e.g. after dragging a node, click again to
      // re-converge).
      setTimeout(() => setState("idle"), 1500);
    } else {
      // No-op — graph too small or editor missing. Just snap back.
      setState("idle");
    }
  }, [relax, state]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "relaxing"}
      title={
        state === "complete" && stats
          ? `Relaxed ${stats.nodesMoved} nodes via ${stats.edgesConsidered} edges`
          : "Relax layout — let connected nodes settle near each other"
      }
      className={cn(
        "pointer-events-auto group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm backdrop-blur-md transition-all",
        state === "idle" &&
          "border-gray-200/80 bg-white/85 text-gray-600 hover:border-indigo-300 hover:bg-white hover:text-indigo-700",
        state === "relaxing" &&
          "border-indigo-300/70 bg-indigo-50/95 text-indigo-700 cursor-wait",
        state === "complete" &&
          "border-emerald-300/70 bg-emerald-50/95 text-emerald-700",
        className,
      )}
      aria-label="Relax layout"
    >
      {state === "idle" && (
        <>
          <Magnet className="h-3 w-3 transition-transform group-hover:rotate-12" />
          <span>Relax layout</span>
        </>
      )}
      {state === "relaxing" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Settling…</span>
        </>
      )}
      {state === "complete" && (
        <>
          <Check className="h-3 w-3" />
          <span>
            Relaxed{" "}
            {stats ? (
              <span className="font-mono tabular-nums opacity-80">
                {stats.nodesMoved}
              </span>
            ) : null}
          </span>
        </>
      )}
    </button>
  );
}
