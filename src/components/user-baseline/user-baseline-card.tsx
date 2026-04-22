"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wave C — shared UserBaselineCard.
 *
 * Renders the current user's persona_tags + behavior_summary +
 * goal_preferences from profiles. Two use sites:
 *   - Dashboard "About you" readout (compact, read-only).
 *   - Settings "Your baseline" panel (expanded, with Regenerate button).
 *
 * Props:
 *   - baseline: the profile's current baseline fields (null if not yet
 *     digested — shown as a placeholder).
 *   - variant: "compact" (dashboard) or "expanded" (settings).
 *   - onRegenerate: called when user hits Regenerate. If omitted, button
 *     is hidden (dashboard variant).
 */

interface BaselineFields {
  persona_tags: string[];
  behavior_summary: string | null;
  goal_preferences: Record<string, unknown>;
  baseline_metrics: Record<string, unknown>;
  behavior_summary_updated_at: string | null;
}

export interface UserBaselineCardProps {
  baseline: BaselineFields;
  variant?: "compact" | "expanded";
  onRegenerate?: () => Promise<void>;
}

export function UserBaselineCard({
  baseline,
  variant = "compact",
  onRegenerate,
}: UserBaselineCardProps) {
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState(variant === "expanded");
  const [lastError, setLastError] = useState<string | null>(null);

  const hasSummary = !!baseline.behavior_summary;
  const tags = Array.isArray(baseline.persona_tags)
    ? baseline.persona_tags.filter((t) => typeof t === "string" && t.length > 0)
    : [];

  const prefs = baseline.goal_preferences ?? {};
  const prefLean = typeof (prefs as { lean?: unknown }).lean === "string"
    ? ((prefs as { lean?: string }).lean as string)
    : null;
  const prefCadence = typeof (prefs as { cadence?: unknown }).cadence === "string"
    ? ((prefs as { cadence?: string }).cadence as string)
    : null;

  async function handleRegenerate() {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    setLastError(null);
    try {
      await onRegenerate();
    } catch (err) {
      setLastError(
        err instanceof Error ? err.message : "Regeneration failed",
      );
    } finally {
      setRegenerating(false);
    }
  }

  const updatedLabel = baseline.behavior_summary_updated_at
    ? timeAgo(baseline.behavior_summary_updated_at)
    : "never";

  return (
    <section
      className={cn(
        "rounded-2xl border border-[var(--lab-border)] bg-white/60 p-4 backdrop-blur-sm",
        variant === "expanded" && "p-5",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-interaxis-600">
            <Sparkles className="h-3 w-3" />
            About you
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Auto-summarised from your recent activity · updated {updatedLabel}
          </p>
        </div>
        {onRegenerate && (
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700",
              "hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60",
            )}
            title="Re-run the behaviour digest now"
          >
            {regenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        )}
      </header>

      {/* Tags */}
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-interaxis-50 px-2 py-0.5 text-[10px] font-semibold text-interaxis-700"
            >
              {t}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-3 text-[11px] italic text-gray-400">
          No persona tags yet — they&apos;ll appear after the digest runs.
        </div>
      )}

      {/* Summary */}
      {hasSummary ? (
        <p
          className={cn(
            "mt-3 text-[12px] leading-relaxed text-gray-700",
            variant === "compact" && !expanded && "line-clamp-3",
          )}
        >
          {baseline.behavior_summary}
        </p>
      ) : (
        <p className="mt-3 text-[12px] italic text-gray-500">
          Not enough activity yet to infer a behaviour pattern. Keep using
          the product and this will fill in.
        </p>
      )}

      {/* Expand/collapse for compact mode */}
      {variant === "compact" && hasSummary && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-gray-500 hover:text-gray-900"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              More
            </>
          )}
        </button>
      )}

      {/* Preferences strip (expanded only) */}
      {variant === "expanded" && (prefLean || prefCadence) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {prefLean && (
            <div className="rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
                Lean
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-gray-900">
                {prefLean}
              </div>
            </div>
          )}
          {prefCadence && (
            <div className="rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">
                Cadence
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-gray-900">
                {prefCadence}
              </div>
            </div>
          )}
        </div>
      )}

      {lastError && (
        <div className="mt-2 text-[11px] text-red-600">{lastError}</div>
      )}
    </section>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
