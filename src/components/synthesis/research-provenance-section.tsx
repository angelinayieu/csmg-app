"use client";

import { Search, AlertTriangle } from "lucide-react";
import type { ResearchProvenance } from "@/types/synthesis";

const authorityColors: Record<string, string> = {
  high: "bg-green-400",
  moderate: "bg-blue-400",
  low: "bg-gray-400",
  unverified: "bg-amber-400",
};

export function ResearchProvenanceSection({
  provenance,
}: {
  provenance: ResearchProvenance;
}) {
  const totalEntities = provenance.entities_from_search + provenance.entities_from_training;
  if (totalEntities === 0) return null;

  const authTotal =
    provenance.authority_distribution.high +
    provenance.authority_distribution.moderate +
    provenance.authority_distribution.low +
    provenance.authority_distribution.unverified;

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Search className="h-3 w-3 text-purple-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-600">
          Research Summary
        </span>
      </div>

      {/* Fallback warning — appears when web search was unavailable */}
      {provenance.research_mode === "training_only" && provenance.searches_performed === 0 && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-semibold text-amber-700">Training knowledge only</p>
            <p className="text-[9px] text-amber-600 leading-relaxed">
              Web search was unavailable for this research run. Findings are based on model training data,
              not live sources. Re-run with web search enabled for verified insights.
            </p>
          </div>
        </div>
      )}
      {provenance.research_mode === "mixed" && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[9px] text-amber-600 leading-relaxed">
            Some research passes fell back to training knowledge due to web search errors.
            Authority scores for training-only entities may be inflated.
          </p>
        </div>
      )}

      {/* Stats row */}
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-600">
        {provenance.searches_performed > 0 && (
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-800">{provenance.searches_performed}</span>
            <span>web searches</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-800">{totalEntities}</span>
          <span>external entities</span>
        </div>
        {provenance.entities_from_search > 0 && (
          <div className="flex items-center gap-1">
            <span className="font-medium text-green-700">{provenance.entities_from_search}</span>
            <span>web-verified</span>
          </div>
        )}
        {provenance.entities_from_training > 0 && (
          <div className="flex items-center gap-1">
            <span className="font-medium text-gray-600">{provenance.entities_from_training}</span>
            <span>from training</span>
          </div>
        )}
      </div>

      {/* Authority distribution bar */}
      {authTotal > 0 && (
        <div className="mt-2">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            {(["high", "moderate", "low", "unverified"] as const).map((level) => {
              const count = provenance.authority_distribution[level];
              if (count === 0) return null;
              const pct = (count / authTotal) * 100;
              return (
                <div
                  key={level}
                  className={`${authorityColors[level]} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${level}: ${count} entities`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[9px] text-gray-400">
            {provenance.authority_distribution.high > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                Verified ({provenance.authority_distribution.high})
              </span>
            )}
            {provenance.authority_distribution.moderate > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
                Likely ({provenance.authority_distribution.moderate})
              </span>
            )}
            {provenance.authority_distribution.low > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-400" />
                Training ({provenance.authority_distribution.low})
              </span>
            )}
            {provenance.authority_distribution.unverified > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                Unverified ({provenance.authority_distribution.unverified})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Top sources */}
      {provenance.top_sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {provenance.top_sources.map((src, i) => (
            <span
              key={i}
              className="rounded bg-white/80 border border-purple-100 px-1.5 py-0.5 text-[10px] text-purple-600"
            >
              {src.domain} ({src.count})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
