"use client";

// ── BrainstormDetectionPanel ──
//
// Variant of the playground side panel for brainstorm mode. Key differences:
//   - Entity matches are grouped by SPACE (user sees which space each match belongs to)
//   - "Jump to space" affordance on each match
//   - No "add to canvas" action — brainstorm doesn't have a local canvas here
//     (MVP Phase X3 is detection + submit-with-target; local canvas is a later add)

import React from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
  Database,
  FolderOpen,
  BookOpen,
  HelpCircle,
  Lightbulb,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { Entity, Claim } from "@/types";

interface EntityMatch {
  entity: Entity;
  score: number;
  matchedTokens: string[];
  reason: string;
  space_id: string;
  space_name: string;
}

interface PatternMatch {
  pattern: {
    signature: string;
    canonical_tag: string;
    canonical_description: string | null;
    canonical_mechanism: string | null;
    typical_polarity: string | null;
    occurrence_count: number;
  };
  score: number;
}

interface ClaimMatch {
  claim: Claim;
  score: number;
  space_id: string;
  space_name: string;
}

export interface BrainstormDetectionResult {
  entities: EntityMatch[];
  entities_by_space?: Record<string, EntityMatch[]>;
  patterns: PatternMatch[];
  claims: ClaimMatch[];
  open_questions: Array<{ text: string; triggered_by: string }>;
  spaces: Array<{ id: string; name: string; entity_count: number }>;
  meta?: {
    total_entities_searched: number;
    total_spaces_searched: number;
  };
}

const POLARITY_ICON = {
  positive: ArrowUpRight,
  negative: ArrowDownRight,
  neutral: Minus,
  conditional: AlertCircle,
} as const;

const POLARITY_COLOR = {
  positive: "text-emerald-600 bg-emerald-50",
  negative: "text-rose-600 bg-rose-50",
  neutral: "text-gray-500 bg-gray-50",
  conditional: "text-amber-600 bg-amber-50",
} as const;

interface Props {
  loading: boolean;
  userText: string;
  detection: BrainstormDetectionResult | null;
  // Called when the user clicks "Use this space as destination" on a match
  onSuggestSpace?: (spaceId: string) => void;
  className?: string;
}

export function BrainstormDetectionPanel({ loading, userText, detection, onSuggestSpace, className }: Props) {
  const isInitial = !loading && !detection;
  const hasAny =
    detection &&
    (detection.entities.length > 0 || detection.patterns.length > 0 || detection.claims.length > 0 || detection.open_questions.length > 0);

  return (
    <aside className={cn("flex flex-col h-full bg-white/75 backdrop-blur-md border-l border-gray-200 overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          <Sparkles className="h-3 w-3" />
          Cross-space detection
        </div>
        <div className="mt-0.5 text-sm font-semibold text-gray-900">
          {loading ? "Searching your graph…" : hasAny ? "Matches across all spaces" : "Type to detect"}
        </div>
        {detection?.meta && (
          <div className="mt-0.5 text-[10px] text-gray-500">
            {detection.meta.total_entities_searched} entities across {detection.meta.total_spaces_searched} spaces
          </div>
        )}
        {userText && !loading && (
          <div className="mt-1.5 text-[11px] text-gray-500 italic line-clamp-2">“{userText}”</div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {isInitial && (
          <div className="py-10 text-center text-xs text-gray-500">
            <Lightbulb className="h-6 w-6 mx-auto mb-2 text-gray-300" />
            Anything you type will be matched against every space you own. Pick a destination before
            you submit.
          </div>
        )}

        {!loading && detection && !hasAny && (
          <div className="py-6 text-center text-xs text-gray-500">
            <div className="mb-1 font-medium">No matches</div>
            <div>Your thought may be genuinely new — that's fine. You can still submit it.</div>
          </div>
        )}

        {/* Entities grouped by space */}
        {detection && detection.entities.length > 0 && (
          <section>
            <SectionHeader icon={Database} label="Entities (grouped by space)" count={detection.entities.length} />
            <div className="space-y-3">
              {Object.entries(detection.entities_by_space ?? {}).map(([spaceId, matches]) => {
                const spaceName = matches[0]?.space_name ?? "(unknown)";
                return (
                  <div key={spaceId}>
                    <div className="flex items-center justify-between gap-2 mb-1.5 px-0.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
                        <FolderOpen className="h-3 w-3 text-gray-400" />
                        <span className="truncate">{spaceName}</span>
                        <span className="text-[9px] font-mono text-gray-400">{matches.length}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {onSuggestSpace && (
                          <button
                            onClick={() => onSuggestSpace(spaceId)}
                            className="text-[9px] font-semibold text-indigo-600 hover:text-indigo-900 uppercase tracking-wider"
                            title="Use this space as the destination when you submit"
                          >
                            use as target
                          </button>
                        )}
                        <Link
                          href={`/app/space/${spaceId}/graph`}
                          className="p-0.5 rounded text-gray-400 hover:text-gray-800"
                          title="Open this space"
                          target="_blank"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {matches.map((m) => (
                        <EntityMatchRow key={m.entity.id} match={m} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Patterns */}
        {detection && detection.patterns.length > 0 && (
          <section>
            <SectionHeader icon={Database} label="Patterns (global library)" count={detection.patterns.length} />
            <div className="space-y-1.5">
              {detection.patterns.map((m) => <PatternRow key={m.pattern.signature} match={m} />)}
            </div>
          </section>
        )}

        {/* Claims */}
        {detection && detection.claims.length > 0 && (
          <section>
            <SectionHeader icon={BookOpen} label="Relevant claims" count={detection.claims.length} />
            <div className="space-y-1.5">
              {detection.claims.map((m, i) => <ClaimRow key={m.claim.id ?? i} match={m} />)}
            </div>
          </section>
        )}

        {/* Open questions */}
        {detection && detection.open_questions.length > 0 && (
          <section>
            <SectionHeader icon={HelpCircle} label="Questions to ask" count={detection.open_questions.length} />
            <div className="space-y-1.5">
              {detection.open_questions.map((q, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900 leading-snug">
                  <div className="flex items-start gap-2">
                    <HelpCircle className="h-3 w-3 mt-0.5 text-amber-600 flex-shrink-0" />
                    {q.text}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading && !detection && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching all spaces + pattern library…
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="h-3 bg-gray-100 rounded w-2/3" />
                <div className="h-2 bg-gray-100 rounded w-full" />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionHeader({ icon: Icon, label, count }: { icon: React.ComponentType<{ className?: string }>; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      <span className="ml-auto font-mono text-gray-400">{count}</span>
    </div>
  );
}

function EntityMatchRow({ match }: { match: EntityMatch }) {
  const pct = Math.round(match.score * 100);
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5">
      <div className="text-[12px] font-semibold text-gray-900 truncate">{match.entity.name}</div>
      {match.entity.description && (
        <div className="mt-0.5 text-[10px] text-gray-500 line-clamp-2">{match.entity.description}</div>
      )}
      <div className="mt-1 flex items-center gap-1.5 text-[9px]">
        <span className="rounded bg-gray-100 px-1.5 py-[1px] font-medium text-gray-600 uppercase tracking-wider">
          {match.entity.importance ?? "moderate"}
        </span>
        {match.entity.layer && (
          <span className="rounded bg-indigo-50 px-1.5 py-[1px] font-medium text-indigo-700 uppercase tracking-wider">
            {match.entity.layer}
          </span>
        )}
        <span className="ml-auto font-mono text-gray-400">{pct}%</span>
      </div>
    </div>
  );
}

function PatternRow({ match }: { match: PatternMatch }) {
  const pol = (match.pattern.typical_polarity ?? "neutral") as keyof typeof POLARITY_ICON;
  const PolIcon = POLARITY_ICON[pol];
  return (
    <div className="rounded-md border border-purple-200 bg-purple-50/40 px-2.5 py-1.5">
      <div className="flex items-start gap-2">
        <div className={cn("flex-shrink-0 w-4 h-4 rounded-full grid place-items-center", POLARITY_COLOR[pol])}>
          <PolIcon className="h-2.5 w-2.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-semibold text-purple-900">{match.pattern.canonical_tag}</div>
          {match.pattern.canonical_description && (
            <div className="mt-0.5 text-[11px] text-gray-600 line-clamp-2">{match.pattern.canonical_description}</div>
          )}
          <div className="mt-0.5 text-[9px] text-purple-700">
            ×{match.pattern.occurrence_count} · {Math.round(match.score * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function ClaimRow({ match }: { match: ClaimMatch }) {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/40 px-2.5 py-1.5">
      <div className="text-[11px] text-sky-900 leading-snug line-clamp-2">{match.claim.claim_text}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-sky-700">
        <FolderOpen className="h-2.5 w-2.5" />
        <span className="truncate">{match.space_name}</span>
        <span className="ml-auto font-mono text-gray-400">{Math.round(match.score * 100)}%</span>
      </div>
    </div>
  );
}
