"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Zap,
  HelpCircle,
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  GitBranch,
  Hexagon,
  ArrowRight,
} from "lucide-react";
import type {
  CoreTension,
  UnknownItem,
  ContradictionItem,
  TriadFinding,
  ArchetypeMatch,
  IntelligenceRadarDataV2,
} from "@/types/intelligence-v2";

// ── Props ──

export interface MetaIntelligencePanelProps {
  /** Full or partial v2 data — pass a subset to render only specific sections */
  v2Data: Partial<IntelligenceRadarDataV2> | null;
  className?: string;
}

// ── Core Tension Banner ──

function CoreTensionBanner({ tension }: { tension: CoreTension }) {
  return (
    <div className="rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50/50 to-blue-50/30 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Zap className="h-3.5 w-3.5 text-purple-500" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-purple-600">
          Core Tension
        </span>
      </div>
      <h3 className="text-[13px] font-bold text-gray-900 leading-snug">
        {tension.title}
      </h3>
      <p className="mt-1.5 text-[11px] leading-[1.6] text-gray-600">
        {tension.description}
      </p>
      {tension.entity_ids.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tension.entity_ids.map((id) => (
            <span key={id} className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-medium text-purple-700">
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Unknowns Section ──

function UnknownsSection({ unknowns }: { unknowns: UnknownItem[] }) {
  const [expanded, setExpanded] = useState(true);
  if (unknowns.length === 0) return null;

  const impactColors: Record<string, string> = {
    high: "bg-red-50 text-red-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-gray-100 text-gray-500",
  };

  const statusColors: Record<string, string> = {
    open: "bg-red-50 text-red-600",
    investigating: "bg-amber-50 text-amber-600",
    resolved: "bg-green-50 text-green-600",
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            Unknowns
          </span>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">
            {unknowns.length}
          </span>
        </div>
        <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {unknowns.map((unk) => (
            <div key={unk.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium text-gray-800 leading-snug">
                  {unk.question}
                </p>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-medium uppercase", impactColors[unk.impact])}>
                    {unk.impact}
                  </span>
                  {unk.status && (
                    <span className={cn("rounded px-1.5 py-0.5 text-[8px] font-medium uppercase", statusColors[unk.status])}>
                      {unk.status}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex items-start gap-1.5">
                <ArrowRight className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                <span className="text-[10px] text-amber-700 leading-snug">
                  {unk.next_probe}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Contradictions Section ──

function ContradictionsSection({ contradictions }: { contradictions: ContradictionItem[] }) {
  const [expanded, setExpanded] = useState(true);
  if (contradictions.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            Contradictions
          </span>
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-600">
            {contradictions.length}
          </span>
        </div>
        <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {contradictions.map((c) => (
            <div key={c.id} className="rounded-lg border border-red-100 bg-red-50/20 px-3 py-2.5">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="rounded-md bg-blue-50 px-2.5 py-1.5">
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-blue-500">Claim A</span>
                  <p className="text-[10px] text-blue-800 mt-0.5 leading-snug">{c.a}</p>
                </div>
                <div className="rounded-md bg-orange-50 px-2.5 py-1.5">
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-orange-500">Claim B</span>
                  <p className="text-[10px] text-orange-800 mt-0.5 leading-snug">{c.b}</p>
                </div>
              </div>
              <p className="text-[10px] text-gray-600 leading-snug">
                <span className="font-semibold text-red-600">Why it matters: </span>
                {c.why_it_matters}
              </p>
              {c.resolution_paths.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="text-[8px] text-gray-400">Resolve via:</span>
                  {c.resolution_paths.map((path, i) => (
                    <span key={i} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] text-gray-600">
                      {path}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Triads Section ──

function TriadsSection({ triads }: { triads: TriadFinding[] }) {
  const [expanded, setExpanded] = useState(false);
  if (triads.length === 0) return null;

  const patternLabels: Record<string, { label: string; color: string }> = {
    mediator: { label: "Mediator", color: "text-blue-600" },
    moderator: { label: "Moderator", color: "text-purple-600" },
    common_cause: { label: "Common Cause", color: "text-amber-600" },
    feedback_triad: { label: "Feedback", color: "text-green-600" },
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            Triadic Patterns
          </span>
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
            {triads.length}
          </span>
        </div>
        <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {triads.map((t) => {
            const pattern = patternLabels[t.pattern_type] ?? patternLabels.mediator;
            return (
              <div key={t.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] font-semibold", pattern.color)}>
                    {pattern.label}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    conf: {Math.round(t.confidence * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-700">
                  <span className="font-medium">{t.a}</span>
                  <ArrowRight className="h-2.5 w-2.5 text-gray-400" />
                  <span className="font-bold text-blue-600">{t.b}</span>
                  <ArrowRight className="h-2.5 w-2.5 text-gray-400" />
                  <span className="font-medium">{t.c}</span>
                </div>
                {t.rationale && (
                  <p className="mt-1 text-[9px] text-gray-500 leading-snug">{t.rationale}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Archetypes Section ──

function ArchetypesSection({ archetypes }: { archetypes: ArchetypeMatch[] }) {
  const [expanded, setExpanded] = useState(false);
  if (archetypes.length === 0) return null;

  const archetypeIcons: Record<string, { emoji: string; label: string; color: string }> = {
    flywheel: { emoji: "🔄", label: "Flywheel", color: "text-green-600" },
    bottleneck: { emoji: "⏳", label: "Bottleneck", color: "text-red-600" },
    cold_start: { emoji: "🧊", label: "Cold Start", color: "text-blue-600" },
    principal_agent: { emoji: "🤝", label: "Principal-Agent", color: "text-amber-600" },
    network_effects: { emoji: "🕸️", label: "Network Effects", color: "text-purple-600" },
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <Hexagon className="h-3.5 w-3.5 text-teal-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            System Archetypes
          </span>
          <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] font-medium text-teal-600">
            {archetypes.length}
          </span>
        </div>
        <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {archetypes.map((a) => {
            const config = archetypeIcons[a.name] ?? archetypeIcons.bottleneck;
            return (
              <div key={a.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{config.emoji}</span>
                  <span className={cn("text-[11px] font-semibold", config.color)}>
                    {config.label}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    fit: {Math.round(a.fit_score * 100)}%
                  </span>
                </div>
                {a.evidence.length > 0 && (
                  <div className="mb-1">
                    <span className="text-[8px] font-semibold uppercase text-green-500">Evidence:</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {a.evidence.map((e, i) => (
                        <span key={i} className="rounded bg-green-50 px-1.5 py-0.5 text-[8px] text-green-700">{e}</span>
                      ))}
                    </div>
                  </div>
                )}
                {a.counterevidence.length > 0 && (
                  <div>
                    <span className="text-[8px] font-semibold uppercase text-red-400">Counter:</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {a.counterevidence.map((c, i) => (
                        <span key={i} className="rounded bg-red-50 px-1.5 py-0.5 text-[8px] text-red-600">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──

export function MetaIntelligencePanel({ v2Data, className }: MetaIntelligencePanelProps) {
  if (!v2Data) return null;

  const hasContent =
    v2Data.core_tension ||
    (v2Data.unknowns?.length ?? 0) > 0 ||
    (v2Data.contradictions?.length ?? 0) > 0 ||
    (v2Data.triads?.length ?? 0) > 0 ||
    (v2Data.archetype_matches?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Core Tension (always visible when present) */}
      {v2Data.core_tension && (
        <CoreTensionBanner tension={v2Data.core_tension} />
      )}

      {/* Unknowns */}
      {v2Data.unknowns && v2Data.unknowns.length > 0 && (
        <UnknownsSection unknowns={v2Data.unknowns} />
      )}

      {/* Contradictions */}
      {v2Data.contradictions && v2Data.contradictions.length > 0 && (
        <ContradictionsSection contradictions={v2Data.contradictions} />
      )}

      {/* Structural patterns (collapsed by default) */}
      {v2Data.triads && v2Data.triads.length > 0 && (
        <TriadsSection triads={v2Data.triads} />
      )}

      {v2Data.archetype_matches && v2Data.archetype_matches.length > 0 && (
        <ArchetypesSection archetypes={v2Data.archetype_matches} />
      )}
    </div>
  );
}
