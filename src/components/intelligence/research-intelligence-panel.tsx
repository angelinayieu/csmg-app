"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { HiddenSignalData, ContinuationSignalData, CrossContextInsight } from "@/types/synthesis";

// ── Props ──

interface ResearchIntelligencePanelProps {
  hiddenSignals: HiddenSignalData[];
  crossContextInsights: CrossContextInsight[];
  continuationSignals: ContinuationSignalData[];
  onEntityClick?: (entityId: string) => void;
}

// ── Signal type config ──

const SIGNAL_TYPE_CONFIG: Record<string, { label: string; color: string; border: string; bg: string }> = {
  mediating_variable: { label: "Mediating Variable", color: "text-purple-700", border: "border-purple-400", bg: "bg-purple-50" },
  structural_risk:    { label: "Structural Risk",    color: "text-red-700",    border: "border-red-400",    bg: "bg-red-50" },
  missing_metric:     { label: "Missing Metric",     color: "text-amber-700",  border: "border-amber-400",  bg: "bg-amber-50" },
  analogous_dynamic:  { label: "Analogous Dynamic",  color: "text-blue-700",   border: "border-blue-400",   bg: "bg-blue-50" },
};

// ── Insight type config ──

const INSIGHT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  validation:  { label: "Validation",  color: "text-emerald-700", bg: "bg-emerald-50" },
  challenge:   { label: "Challenge",   color: "text-red-700",     bg: "bg-red-50" },
  opportunity: { label: "Opportunity", color: "text-blue-700",    bg: "bg-blue-50" },
  risk:        { label: "Risk",        color: "text-orange-700",  bg: "bg-orange-50" },
};

const CONFIDENCE_CONFIG: Record<string, { color: string; bg: string }> = {
  high:     { color: "text-emerald-700", bg: "bg-emerald-50" },
  moderate: { color: "text-blue-700",    bg: "bg-blue-50" },
  low:      { color: "text-gray-600",    bg: "bg-gray-100" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: "Critical", color: "text-red-700",    bg: "bg-red-50" },
  high:     { label: "High",     color: "text-orange-700", bg: "bg-orange-50" },
  medium:   { label: "Medium",   color: "text-gray-600",   bg: "bg-gray-100" },
};

const CONTINUATION_TYPE_LABELS: Record<string, string> = {
  critical_bridge_found: "Critical Bridge Found",
  contradiction_detected: "Contradiction Detected",
  high_impact_gap: "High-Impact Gap",
  validation_needed: "Validation Needed",
};

// ── Collapsible Section ──

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 py-1"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </span>
        {count > 0 && (
          <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
            {count}
          </span>
        )}
      </button>
      {open && <div className="space-y-1.5 pt-1">{children}</div>}
    </div>
  );
}

// ── Entity Chip ──

function EntityChip({
  name,
  onClick,
}: {
  name: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        "border border-gray-200 bg-white text-gray-700",
        onClick && "hover:bg-gray-50 hover:border-gray-300 cursor-pointer",
        !onClick && "cursor-default",
      )}
    >
      {name}
    </button>
  );
}

// ── Impact Bar ──

function ImpactBar({ value }: { value: number }) {
  const clamped = Math.max(1, Math.min(10, value));
  const pct = (clamped / 10) * 100;
  const color =
    clamped >= 8 ? "bg-red-500" : clamped >= 5 ? "bg-amber-500" : "bg-blue-400";

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-gray-400 w-10 shrink-0">Impact</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-gray-600 w-4 text-right">{clamped}</span>
    </div>
  );
}

// ── Main Component ──

export function ResearchIntelligencePanel({
  hiddenSignals,
  crossContextInsights,
  continuationSignals,
  onEntityClick,
}: ResearchIntelligencePanelProps) {
  const totalCount = hiddenSignals.length + crossContextInsights.length + continuationSignals.length;

  if (totalCount === 0) return null;

  const sortedSignals = [...hiddenSignals].sort(
    (a, b) => (b.trajectory_impact ?? 0) - (a.trajectory_impact ?? 0),
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
      {/* ── Hidden Signals ── */}
      {hiddenSignals.length > 0 && (
        <Section
          title="Hidden Signals"
          count={hiddenSignals.length}
          defaultOpen={hiddenSignals.length > 0}
        >
          <div className="space-y-1.5">
            {sortedSignals.map((sig, i) => {
              const cfg = SIGNAL_TYPE_CONFIG[sig.signal_type] ?? SIGNAL_TYPE_CONFIG.analogous_dynamic;
              return (
                <div
                  key={`hs-${i}`}
                  className={cn("rounded-lg border-l-2 p-3 bg-gray-50/50", cfg.border)}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-semibold text-gray-900 leading-tight">
                      {sig.signal_name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium",
                        cfg.bg,
                        cfg.color,
                      )}
                    >
                      {cfg.label}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    {sig.description}
                  </p>

                  {/* Impact bar */}
                  <div className="mt-2">
                    <ImpactBar value={sig.trajectory_impact} />
                  </div>

                  {/* Detection method */}
                  <p className="mt-1.5 text-[10px] italic text-gray-400">
                    How to discover: {sig.detection_method}
                  </p>

                  {/* Analogous precedent */}
                  {sig.analogous_precedent && (
                    <div className="mt-1.5 rounded-md border border-blue-100 bg-blue-50/50 px-2 py-1.5">
                      <span className="text-[10px] font-medium text-blue-700">
                        Historical precedent:
                      </span>{" "}
                      <span className="text-[10px] text-blue-600">
                        {sig.analogous_precedent}
                      </span>
                    </div>
                  )}

                  {/* Related entities */}
                  {sig.related_internal_entities && sig.related_internal_entities.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {sig.related_internal_entities.map((eid) => (
                        <EntityChip
                          key={eid}
                          name={eid}
                          onClick={onEntityClick ? () => onEntityClick(eid) : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Cross-Context Insights ── */}
      {crossContextInsights.length > 0 && (
        <Section
          title="Cross-Context Insights"
          count={crossContextInsights.length}
          defaultOpen={crossContextInsights.length > 0}
        >
          <div className="space-y-1.5">
            {crossContextInsights.map((ins, i) => {
              const insAny = ins as unknown as Record<string, unknown>;
              const typeCfg = INSIGHT_TYPE_CONFIG[insAny.type as string] ?? null;
              const confCfg = CONFIDENCE_CONFIG[ins.confidence ?? "moderate"] ?? CONFIDENCE_CONFIG.moderate;

              return (
                <div key={`cci-${i}`} className="rounded-lg border border-gray-200 p-3">
                  {/* Main text */}
                  <p className="text-[12px] leading-relaxed text-gray-800">
                    {ins.insight}
                  </p>

                  {/* Badges row */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {typeCfg && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[9px] font-medium",
                          typeCfg.bg,
                          typeCfg.color,
                        )}
                      >
                        {typeCfg.label}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-medium capitalize",
                        confCfg.bg,
                        confCfg.color,
                      )}
                    >
                      {ins.confidence ?? "moderate"}
                    </span>
                  </div>

                  {/* Entity involvement */}
                  {ins.external_entities && ins.external_entities.length > 0 && (
                    <div className="mt-1.5 flex items-start gap-1">
                      <span className="text-[9px] text-gray-400 pt-0.5 shrink-0">External:</span>
                      <div className="flex flex-wrap gap-1">
                        {ins.external_entities.map((eid) => (
                          <EntityChip
                            key={eid}
                            name={eid}
                            onClick={onEntityClick ? () => onEntityClick(eid) : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {ins.internal_entities && ins.internal_entities.length > 0 && (
                    <div className="mt-1 flex items-start gap-1">
                      <span className="text-[9px] text-gray-400 pt-0.5 shrink-0">Internal:</span>
                      <div className="flex flex-wrap gap-1">
                        {ins.internal_entities.map((eid) => (
                          <EntityChip
                            key={eid}
                            name={eid}
                            onClick={onEntityClick ? () => onEntityClick(eid) : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Research Gaps (Continuation Signals) ── */}
      {continuationSignals.length > 0 && (
        <Section
          title="Research Gaps"
          count={continuationSignals.length}
          defaultOpen={false}
        >
          <div className="space-y-1.5">
            {continuationSignals.map((sig, i) => {
              const priCfg = PRIORITY_CONFIG[sig.priority] ?? PRIORITY_CONFIG.medium;
              const typeLabel = CONTINUATION_TYPE_LABELS[sig.type] ?? sig.type;

              return (
                <div key={`cs-${i}`} className="rounded-lg border border-gray-200 p-3">
                  {/* Header */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-medium",
                        priCfg.bg,
                        priCfg.color,
                      )}
                    >
                      {priCfg.label}
                    </span>
                    <span className="text-[10px] font-medium text-gray-600">
                      {typeLabel}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    {sig.description}
                  </p>

                  {/* Follow-up queries */}
                  {sig.follow_up_queries && sig.follow_up_queries.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {sig.follow_up_queries.map((q, qi) => (
                        <span
                          key={qi}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[10px] text-gray-600"
                        >
                          <Search className="h-2.5 w-2.5 text-gray-400" />
                          {q}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
