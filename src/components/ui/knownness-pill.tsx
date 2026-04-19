"use client";

/**
 * Shared "◐ N% known" pill for entity knownness surfaces.
 *
 * Reads the construct_posteriors map stored in synthesis_data and renders
 * a compact, color-graded badge when there's at least one observation.
 * Identical semantics wherever it's placed (master bottleneck, leverage,
 * risk, convergence, eventually all entity surfaces).
 *
 * Phase 4c-final-v2: this is the visible proof of the active-learning loop.
 */

import { cn } from "@/lib/utils";
import { knownness, type PosteriorMap } from "@/lib/upf/posterior";

interface KnownnessPillProps {
  entityId: string;
  posteriors: PosteriorMap | undefined;
  /** When true, use a compact (even smaller) rendering for tight row headers. */
  compact?: boolean;
}

export function KnownnessPill({ entityId, posteriors, compact }: KnownnessPillProps) {
  const posterior = posteriors?.[`entity:${entityId}`];
  const k = knownness(posterior);
  if (k <= 0) return null;

  const pct = Math.round(k * 100);
  const shade =
    pct >= 70
      ? { bg: "bg-emerald-100", fg: "text-emerald-700", border: "border-emerald-200" }
      : pct >= 40
        ? { bg: "bg-amber-100", fg: "text-amber-700", border: "border-amber-200" }
        : { bg: "bg-gray-100", fg: "text-gray-600", border: "border-gray-200" };
  const n = posterior?.observation_count ?? 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide",
        shade.bg,
        shade.fg,
        shade.border,
        compact ? "px-1.5 py-0 text-[9px]" : "px-1.5 py-0.5 text-[10px]"
      )}
      title={`Posterior knownness — ${pct}% after ${n} observation${n === 1 ? "" : "s"}. Decays over ~30 days without new data.`}
    >
      <span>◐</span>
      <span>{pct}% known</span>
    </span>
  );
}
