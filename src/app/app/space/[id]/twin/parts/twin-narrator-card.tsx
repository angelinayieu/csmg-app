"use client";

// ── Narrator card ───────────────────────────────────────────────────
//
// Renders the LLM-generated 3-paragraph "what this twin is" summary
// at the top of the Overview tab. Refresh button forces a re-run
// (cache invalidation + new agent call).
//
// Apple-minimalist: thin caps label, generous line-height on body,
// muted refresh timestamp + button.

import { useState } from "react";
import { RefreshCw } from "lucide-react";

interface Props {
  summary: string | null;
  onRefresh?: () => Promise<void>;
}

export function TwinNarratorCard({ summary, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const hasSummary = !!summary && summary.trim().length > 0;

  return (
    <section
      className="relative rounded-2xl px-7 py-6"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
          What this twin is
        </div>
        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 transition hover:text-gray-900 disabled:opacity-40"
            title="Re-run the Narrator agent"
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        )}
      </div>

      {hasSummary ? (
        <div className="mt-3 space-y-3 text-[14px] leading-[1.65] text-gray-700">
          {summary!.split(/\n\n+/).map((para, i) => (
            <p key={i}>{para.trim()}</p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[14px] leading-relaxed text-gray-500">
          Your twin is still gathering signal. Add more entities or click
          Refresh to ask the narrator to summarize what's there.
        </p>
      )}
    </section>
  );
}
