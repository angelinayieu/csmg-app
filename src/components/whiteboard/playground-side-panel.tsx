"use client";

// ── PlaygroundSidePanel ──
//
// Right-side panel that updates as the user types in the playground dock.
// Shows three sections:
//   1. Matching entities from the current space
//   2. Matching patterns from the global library
//   3. Matching claims / supporting evidence
// Plus auto-generated open questions at the bottom.
//
// Each item has an "add" action that pipes back to the playground view to
// drop the match onto the canvas.

import React from "react";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Plus,
  Sparkles,
  BookOpen,
  HelpCircle,
  Network,
  Database,
  X,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
} from "lucide-react";
import type { Entity, Claim } from "@/types";

export interface DetectionResult {
  entities: Array<{
    entity: Entity;
    score: number;
    matchedTokens: string[];
    reason: string;
  }>;
  patterns: Array<{
    pattern: {
      signature: string;
      canonical_tag: string;
      canonical_description: string | null;
      canonical_mechanism: string | null;
      typical_polarity: string | null;
      occurrence_count: number;
      example_descriptions: string[] | null;
    };
    score: number;
    matchedTokens: string[];
  }>;
  claims: Array<{
    claim: Claim;
    score: number;
    matchedTokens: string[];
  }>;
  open_questions: Array<{
    text: string;
    triggered_by: "entity" | "pattern" | "generic";
    related_id?: string;
  }>;
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

// ── Props ──

interface Props {
  loading: boolean;
  userText: string;
  detection: DetectionResult | null;
  onAddEntity?: (entity: Entity) => void;
  onAddPattern?: (pattern: DetectionResult["patterns"][number]["pattern"]) => void;
  onAddQuestion?: (question: DetectionResult["open_questions"][number]) => void;
  onClose?: () => void;
  className?: string;
}

export function PlaygroundSidePanel({
  loading,
  userText,
  detection,
  onAddEntity,
  onAddPattern,
  onAddQuestion,
  onClose,
  className,
}: Props) {
  const isEmpty =
    !loading &&
    detection &&
    detection.entities.length === 0 &&
    detection.patterns.length === 0 &&
    detection.claims.length === 0 &&
    detection.open_questions.length === 0;

  const hasAnyResult = !isEmpty && detection !== null;

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-white/75 backdrop-blur-md border-l border-gray-200 overflow-hidden",
        className,
      )}
    >
      {/* Panel header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            <Sparkles className="h-3 w-3" />
            Live detection
          </div>
          <div className="mt-0.5 text-sm font-semibold text-gray-900">
            {loading ? "Analyzing…" : hasAnyResult ? "Matches in your graph" : "Type to detect"}
          </div>
          {userText && (
            <div className="mt-1 text-[11px] text-gray-500 italic line-clamp-2">
              “{userText}”
            </div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex-shrink-0"
            title="Hide panel"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {/* Initial empty state */}
        {!loading && !detection && (
          <div className="py-10 text-center text-xs text-gray-500">
            <Lightbulb className="h-6 w-6 mx-auto mb-2 text-gray-300" />
            Start typing below. As you write, matches from your graph and the global pattern library
            will appear here.
          </div>
        )}

        {/* No-match state */}
        {isEmpty && (
          <div className="py-6 text-center text-xs text-gray-500">
            <div className="mb-1 font-medium">No matches yet</div>
            <div>Keep typing — suggestions update every 500ms.</div>
          </div>
        )}

        {/* Entities section */}
        {detection && detection.entities.length > 0 && (
          <section>
            <SectionHeader icon={Network} label="Entities in this graph" count={detection.entities.length} />
            <div className="space-y-1.5">
              {detection.entities.map((m) => (
                <EntityMatchRow
                  key={m.entity.id}
                  entity={m.entity}
                  score={m.score}
                  matchedTokens={m.matchedTokens}
                  onAdd={() => onAddEntity?.(m.entity)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Patterns section */}
        {detection && detection.patterns.length > 0 && (
          <section>
            <SectionHeader icon={Database} label="Patterns from library" count={detection.patterns.length} />
            <div className="space-y-1.5">
              {detection.patterns.map((m) => (
                <PatternMatchRow
                  key={m.pattern.signature}
                  pattern={m.pattern}
                  score={m.score}
                  onAdd={() => onAddPattern?.(m.pattern)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Claims section */}
        {detection && detection.claims.length > 0 && (
          <section>
            <SectionHeader icon={BookOpen} label="Relevant claims" count={detection.claims.length} />
            <div className="space-y-1.5">
              {detection.claims.map((m) => (
                <ClaimRow
                  key={m.claim.id}
                  claim={m.claim}
                  score={m.score}
                />
              ))}
            </div>
          </section>
        )}

        {/* Open questions */}
        {detection && detection.open_questions.length > 0 && (
          <section>
            <SectionHeader icon={HelpCircle} label="Open questions" count={detection.open_questions.length} />
            <div className="space-y-1.5">
              {detection.open_questions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onAddQuestion?.(q)}
                  className="w-full text-left rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-900 hover:bg-amber-100 transition-colors group"
                  title="Add as a sticky note to the canvas"
                >
                  <div className="flex items-start gap-2">
                    <HelpCircle className="h-3 w-3 mt-0.5 text-amber-600 flex-shrink-0" />
                    <span className="flex-1 leading-snug">{q.text}</span>
                    <Plus className="h-3 w-3 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Loading skeleton */}
        {loading && !detection && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching graph + library…
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

// ── Sub-components ──

function SectionHeader({
  icon: Icon,
  label,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
      <span className="ml-auto font-mono text-gray-400">{count}</span>
    </div>
  );
}

function EntityMatchRow({
  entity,
  score,
  matchedTokens,
  onAdd,
}: {
  entity: Entity;
  score: number;
  matchedTokens: string[];
  onAdd: () => void;
}) {
  const pct = Math.round(score * 100);
  return (
    <button
      onClick={onAdd}
      className="w-full text-left rounded-lg border border-gray-200 bg-white px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors group"
      title="Add to playground canvas"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-900 truncate">{entity.name}</span>
          </div>
          {entity.description && (
            <div className="mt-0.5 text-[11px] text-gray-500 line-clamp-2">{entity.description}</div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[9px]">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600 uppercase tracking-wider">
              {entity.importance ?? "moderate"}
            </span>
            {entity.layer && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700 uppercase tracking-wider">
                {entity.layer}
              </span>
            )}
            <span className="ml-auto font-mono text-gray-400">{pct}%</span>
          </div>
          {matchedTokens.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-0.5">
              {matchedTokens.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="inline-block rounded bg-yellow-100 text-yellow-800 px-1 py-0 text-[9px] font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <Plus className="h-4 w-4 text-gray-300 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
      </div>
    </button>
  );
}

function PatternMatchRow({
  pattern,
  score,
  onAdd,
}: {
  pattern: DetectionResult["patterns"][number]["pattern"];
  score: number;
  onAdd: () => void;
}) {
  const pct = Math.round(score * 100);
  const pol = (pattern.typical_polarity ?? "neutral") as keyof typeof POLARITY_ICON;
  const PolIcon = POLARITY_ICON[pol];
  return (
    <button
      onClick={onAdd}
      className="w-full text-left rounded-lg border border-purple-200 bg-purple-50/40 px-3 py-2 hover:bg-purple-50/80 hover:border-purple-300 transition-colors group"
      title="Add pattern as a context annotation"
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "flex-shrink-0 w-5 h-5 rounded-full grid place-items-center",
            POLARITY_COLOR[pol],
          )}
        >
          <PolIcon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] font-semibold text-purple-900 truncate">
            {pattern.canonical_tag}
          </div>
          {pattern.canonical_description && (
            <div className="mt-0.5 text-[11px] text-gray-600 line-clamp-2">
              {pattern.canonical_description}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[9px]">
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-purple-700 uppercase tracking-wider">
              {pattern.typical_polarity ?? "neutral"}
            </span>
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-gray-600">
              ×{pattern.occurrence_count}
            </span>
            <span className="ml-auto font-mono text-gray-400">{pct}%</span>
          </div>
        </div>
        <Plus className="h-4 w-4 text-gray-300 group-hover:text-purple-500 transition-colors flex-shrink-0" />
      </div>
    </button>
  );
}

function ClaimRow({ claim, score }: { claim: Claim; score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 px-3 py-2">
      <div className="text-[11px] text-sky-900 leading-snug">
        {claim.claim_text}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[9px]">
        <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-sky-700 uppercase tracking-wider">
          {claim.claim_type}
        </span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-gray-600">
          {Math.round((claim.confidence ?? 0) * 100)}%
        </span>
        <span className="ml-auto font-mono text-gray-400">{pct}%</span>
      </div>
    </div>
  );
}
