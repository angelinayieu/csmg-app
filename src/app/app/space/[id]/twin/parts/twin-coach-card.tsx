"use client";

// ── Coach card ──────────────────────────────────────────────────────
//
// Renders the Coach agent's single next-action recommendation. The
// action_type drives the button label; clicking dispatches a window
// event (Phase 1 wiring — the actual actions land in Phase 2).
//
// "Show different suggestion" re-runs the agent with a hint to
// generate something else (Phase 2 — for now just disabled).

import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { CoachActionType } from "@/lib/twin/agents/coach-agent";

interface Props {
  recommendation: {
    text: string;
    action_type: string;
    target_id: string | null;
  } | null;
}

const ACTION_LABELS: Record<CoachActionType, string> = {
  log_observation: "Log observation",
  run_prediction: "Run prediction",
  take_snapshot: "Capture snapshot",
  build_app: "Build app",
  review_proposal: "Review proposal",
  regenerate_strategy: "Regenerate strategy",
  do_nothing: "Got it",
};

export function TwinCoachCard({ recommendation }: Props) {
  if (!recommendation) {
    // Hide the card entirely if the coach didn't return anything.
    return null;
  }

  const actionLabel =
    ACTION_LABELS[recommendation.action_type as CoachActionType] ?? "Continue";
  const isNoop = recommendation.action_type === "do_nothing";

  const handlePrimary = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("twin:coach-action", {
        detail: {
          action_type: recommendation.action_type,
          target_id: recommendation.target_id,
        },
      }),
    );
  };

  return (
    <section
      className="relative overflow-hidden rounded-2xl px-7 py-6"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      {/* Left-edge accent rail — uses Apple system blue from the
          design tokens. Marks this card as the "primary attention
          point" in the Overview composition. */}
      <span
        aria-hidden
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full"
        style={{ background: "var(--accent-500)" }}
      />

      <div className="pl-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          What's next
        </div>
        <p className="mt-3 text-[15px] leading-[1.55] text-gray-800">
          {recommendation.text}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!isNoop && (
            <button
              onClick={handlePrimary}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
            >
              {actionLabel}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
          <button
            disabled
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-gray-400 transition disabled:cursor-not-allowed"
            title="Coming in Phase 2"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            Show different suggestion
          </button>
        </div>
      </div>
    </section>
  );
}
