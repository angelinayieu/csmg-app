"use client";

// ── NodeProbabilitySpaceView ──
// Top-level view for a single focal node's probability space. Handles:
//   - Triggering generation (calls /api/pipeline/probability-space/for-node)
//   - Loading / empty / error states
//   - Filter + sort controls
//   - Rendering the ranked list of ConvergentPointCard
//
// Used by the route at /app/space/[id]/probability/node/[entityId] AND can
// be embedded into a drawer on the graph view.

import React, { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Loader2,
  Zap,
  RefreshCw,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
  Undo2,
} from "lucide-react";
import type { Entity } from "@/types";
import type {
  ConvergentPoint,
  Role,
  InteractorCandidate,
  ConvergentOutcome,
} from "@/types/convergent-point";
import type { NodeSignature } from "@/types/node-signature";
import { ConvergentPointCard } from "./convergent-point-card";
import { NodeSignatureRing } from "@/components/signatures/node-signature-ring";
import { NodeSignatureDetail } from "@/components/signatures/node-signature-detail";

// ── Phase 1.1 — Surface canonical NodeSignature on probability space ──
//
// Entities carry a `node_signature jsonb` column (populated by
// /api/pipeline/materialize-signatures). Until now that data was only
// surfaced on the Constellation widget + the standalone signature
// detail page. The probability space — the canvas the user actually
// inspects — never showed it. We're light-touch wiring it in:
//
//   • Header: focal entity's signature ring (size 56) — primary affordance
//   • Card expansion: row of focal + interactor signature rings
//   • Click any ring: opens NodeSignatureDetail drawer at parent scope
//
// `Entity.node_signature` is typed as `Json | null` because the column
// is jsonb. The shape conforms to NodeSignature (validated by the DB
// trigger in 20260423_node_signatures.sql at write time), so we cast
// at the boundary and treat the parsed value as authoritative.

function asSignature(json: Entity["node_signature"]): NodeSignature | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const sig = json as unknown as NodeSignature;
  // Cheap sanity check — DB trigger enforces the full invariant; here
  // we just guard against legacy rows missing rings/basis so the ring
  // primitive doesn't render an empty SVG.
  if (typeof sig.canonical_code !== "string") return null;
  if (!Array.isArray(sig.basis) || sig.basis.length === 0) return null;
  return sig;
}

interface Props {
  spaceId: string;
  focalEntity: Entity;
  entitiesByUuid: Map<string, Entity>;
  // Optional initial data (from SSR or cached). If not provided, the user
  // triggers generation manually via the "Analyze" button.
  initial?: {
    points: Array<ConvergentPoint & { composite_score?: number }>;
    roles?: Role[];
    interactors?: InteractorCandidate[];
  };
  className?: string;
}

type PolarityFilter = "all" | ConvergentOutcome["polarity"];
type ReversibilityFilter = "all" | ConvergentOutcome["reversibility"];
type SortMode = "composite" | "probability" | "confidence" | "recent";

interface APIResponse {
  roles: Role[];
  interactor_candidates: InteractorCandidate[];
  convergent_points: Array<ConvergentPoint & { composite_score?: number }>;
  stats: {
    tier_1_interactors: number;
    tier_2_interactors: number;
    tier_3_interactors: number;
    llm_calls: number;
    duration_ms: number;
  };
}

export function NodeProbabilitySpaceView({
  spaceId,
  focalEntity,
  entitiesByUuid,
  initial,
  className,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<APIResponse | null>(
    initial
      ? {
          convergent_points: initial.points,
          roles: initial.roles ?? [],
          interactor_candidates: initial.interactors ?? [],
          stats: { tier_1_interactors: 0, tier_2_interactors: 0, tier_3_interactors: 0, llm_calls: 0, duration_ms: 0 },
        }
      : null,
  );

  // Filters
  const [polarityFilter, setPolarityFilter] = useState<PolarityFilter>("all");
  const [reversibilityFilter, setReversibilityFilter] = useState<ReversibilityFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("composite");

  // Signature detail drawer (Phase 1.1) — single shared instance lives at
  // this level so all rings (header + per-card) drive the same panel.
  // Storing the entity name alongside the signature spares the drawer
  // from a second lookup against entitiesByUuid.
  const [selectedSig, setSelectedSig] = useState<{
    sig: NodeSignature;
    entityName: string;
  } | null>(null);

  const focalSignature = useMemo(
    () => asSignature(focalEntity.node_signature),
    [focalEntity],
  );

  // Phase 1.2 — index entities by canonical_code so the detail
  // drawer's `composes_with` chips can resolve siblings without an
  // extra round-trip. Built once per entitiesByUuid change; callers
  // (drawer chip handlers) get O(1) lookup.
  const signaturesByCode = useMemo(() => {
    const m = new Map<string, { sig: NodeSignature; name: string }>();
    for (const ent of entitiesByUuid.values()) {
      const sig = asSignature(ent.node_signature);
      if (sig) m.set(sig.canonical_code, { sig, name: ent.name });
    }
    return m;
  }, [entitiesByUuid]);

  const handleSelectByCode = useCallback(
    (code: string) => {
      const hit = signaturesByCode.get(code);
      if (hit) setSelectedSig({ sig: hit.sig, entityName: hit.name });
      // Silently no-op when the sibling isn't in the current entity
      // map — happens for cross-space combination codes that aren't
      // hydrated on this view. Phase 4 (combination signatures) wires
      // a server-backed resolver to handle that case.
    },
    [signaturesByCode],
  );

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/probability-space/for-node", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ space_id: spaceId, focal_entity_id: focalEntity.id }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as APIResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [spaceId, focalEntity.id]);

  // ── Derived: filtered + sorted points ──

  const visiblePoints = useMemo(() => {
    const all = data?.convergent_points ?? [];
    const filtered = all.filter((p) => {
      if (polarityFilter !== "all" && p.outcome.polarity !== polarityFilter) return false;
      if (reversibilityFilter !== "all" && p.outcome.reversibility !== reversibilityFilter) return false;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === "composite") return (b.composite_score ?? 0) - (a.composite_score ?? 0);
      if (sortMode === "probability") return b.probability - a.probability;
      if (sortMode === "confidence") return b.confidence - a.confidence;
      // recent — sorts by generated_at desc
      return (b.generated_at ?? "").localeCompare(a.generated_at ?? "");
    });
    return sorted;
  }, [data, polarityFilter, reversibilityFilter, sortMode]);

  // ── Polarity summary (for header chips) ──

  const polarityBreakdown = useMemo(() => {
    const counts: Record<string, number> = { positive: 0, negative: 0, neutral: 0, conditional: 0 };
    for (const p of data?.convergent_points ?? []) counts[p.outcome.polarity] = (counts[p.outcome.polarity] ?? 0) + 1;
    return counts;
  }, [data]);

  const hasData = data !== null && data.convergent_points.length > 0;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
        {/* Focal signature ring — Phase 1.1. Only renders when the
            entity has a materialized signature; otherwise the header
            collapses back to text-only so we don't show a hollow
            placeholder for un-materialized rows. */}
        {focalSignature && (
          <div className="flex-shrink-0">
            <NodeSignatureRing
              signature={focalSignature}
              size={56}
              showCode
              animated={false}
              onSelect={(sig) =>
                setSelectedSig({ sig, entityName: focalEntity.name })
              }
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Probability Space
          </div>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-gray-900">{focalEntity.name}</h2>
          {focalEntity.description && (
            <p className="mt-0.5 line-clamp-2 max-w-3xl text-xs text-gray-600">{focalEntity.description}</p>
          )}

          {/* Roles (if analyzed) */}
          {data?.roles && data.roles.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="text-gray-400">plays:</span>
              {data.roles.map((r) => (
                <span
                  key={r.key}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700"
                  title={r.question}
                >
                  {r.label} ({r.edge_count})
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={runAnalysis}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              loading
                ? "cursor-wait bg-gray-100 text-gray-400"
                : hasData
                  ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  : "bg-indigo-600 text-white hover:bg-indigo-700",
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing…
              </>
            ) : hasData ? (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Re-analyze
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Analyze probability space
              </>
            )}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && !hasData && !error && (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
          <Zap className="mb-3 h-8 w-8 text-indigo-400" />
          <div className="mb-1 text-sm font-medium text-gray-900">
            No probability space analyzed yet
          </div>
          <p className="max-w-md text-xs text-gray-500">
            Click <span className="font-medium">Analyze probability space</span> to enumerate the convergent outcomes of this node combined with its interactors across tiers 1–3 (empirical, structural, analogical).
          </p>
          <div className="mt-4 rounded-md bg-gray-50 p-3 text-[11px] text-gray-500">
            Expected: ~15–30 convergent points · 1 LLM call per combination · ranked against your objectives.
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="m-5 rounded-md border border-rose-200 bg-rose-50 p-4">
          <div className="mb-1 text-sm font-medium text-rose-900">Analysis failed</div>
          <div className="text-xs text-rose-700">{error}</div>
          <button
            onClick={runAnalysis}
            className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading placeholder */}
      {loading && !hasData && (
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
          <Loader2 className="mb-3 h-6 w-6 animate-spin text-indigo-500" />
          <div className="text-sm font-medium text-gray-900">Analyzing probability space…</div>
          <p className="mt-1 max-w-md text-xs text-gray-500">
            Extracting roles, generating interactors across three tiers, predicting convergent outcomes, ranking against objectives.
          </p>
        </div>
      )}

      {/* Results */}
      {hasData && (
        <>
          {/* Summary + filter bar */}
          <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {/* Stats summary */}
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span>
                  <span className="font-semibold text-gray-900">{data.convergent_points.length}</span> points
                </span>
                {data.interactor_candidates.length > 0 && (
                  <span>
                    across <span className="font-semibold text-gray-900">{data.interactor_candidates.length}</span> interactors
                    <span className="ml-1 text-gray-400">
                      ({data.stats.tier_1_interactors}T1/{data.stats.tier_2_interactors}T2/{data.stats.tier_3_interactors}T3)
                    </span>
                  </span>
                )}
              </div>

              {/* Polarity chips */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <FilterChip
                  label="All"
                  count={data.convergent_points.length}
                  active={polarityFilter === "all"}
                  onClick={() => setPolarityFilter("all")}
                />
                <FilterChip
                  label="Positive"
                  count={polarityBreakdown.positive}
                  active={polarityFilter === "positive"}
                  onClick={() => setPolarityFilter("positive")}
                  tint="emerald"
                  Icon={ArrowUpRight}
                />
                <FilterChip
                  label="Negative"
                  count={polarityBreakdown.negative}
                  active={polarityFilter === "negative"}
                  onClick={() => setPolarityFilter("negative")}
                  tint="rose"
                  Icon={ArrowDownRight}
                />
                <FilterChip
                  label="Neutral"
                  count={polarityBreakdown.neutral}
                  active={polarityFilter === "neutral"}
                  onClick={() => setPolarityFilter("neutral")}
                  tint="gray"
                  Icon={Minus}
                />
                {polarityBreakdown.conditional > 0 && (
                  <FilterChip
                    label="Conditional"
                    count={polarityBreakdown.conditional}
                    active={polarityFilter === "conditional"}
                    onClick={() => setPolarityFilter("conditional")}
                    tint="amber"
                    Icon={AlertCircle}
                  />
                )}
              </div>

              {/* Reversibility filter */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <Undo2 className="h-3 w-3 text-gray-400" />
                <select
                  value={reversibilityFilter}
                  onChange={(e) => setReversibilityFilter(e.target.value as ReversibilityFilter)}
                  className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                >
                  <option value="all">Any reversibility</option>
                  <option value="easily_reversible">Easily reversible</option>
                  <option value="costly_to_reverse">Costly to reverse</option>
                  <option value="irreversible">Irreversible</option>
                </select>
              </div>

              {/* Sort */}
              <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                <Filter className="h-3 w-3 text-gray-400" />
                <span className="text-gray-500">Sort</span>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                >
                  <option value="composite">Composite score</option>
                  <option value="probability">Probability</option>
                  <option value="confidence">Confidence</option>
                  <option value="recent">Most recent</option>
                </select>
              </div>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-3xl space-y-2">
              {visiblePoints.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-500">
                  No convergent points match the current filters.
                </div>
              ) : (
                visiblePoints.map((point, idx) => (
                  <ConvergentPointCard
                    key={point.id ?? `${point.focal_entity_id}-${idx}`}
                    point={point}
                    entitiesByUuid={entitiesByUuid}
                    rank={sortMode === "composite" ? idx : undefined}
                    onSelectSignature={(sig, name) =>
                      setSelectedSig({ sig, entityName: name })
                    }
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Signature detail drawer (Phase 1.1) — shared by header ring +
          per-card rings. Renders nothing when selectedSig is null, so
          there's no DOM cost when the drawer is closed.
          Phase 1.2: passes onSelectByCode so the drawer's
          `composes_with` chips can swap to a sibling signature in
          place without closing first. */}
      <NodeSignatureDetail
        signature={selectedSig?.sig ?? null}
        entityName={selectedSig?.entityName}
        onClose={() => setSelectedSig(null)}
        onSelectByCode={handleSelectByCode}
        resolveEntityName={(id) => entitiesByUuid.get(id)?.name ?? null}
      />
    </div>
  );
}

// ── FilterChip ──

function FilterChip({
  label,
  count,
  active,
  onClick,
  tint,
  Icon,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tint?: "emerald" | "rose" | "gray" | "amber";
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  const tintColors = {
    emerald: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
    rose: { bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-300" },
    gray: { bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-300" },
    amber: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300" },
  } as const;
  const colors = tint ? tintColors[tint] : undefined;

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium transition-colors",
        active
          ? colors
            ? `${colors.bg} ${colors.text} ${colors.border}`
            : "border-gray-300 bg-gray-100 text-gray-700"
          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
      <span className="ml-0.5 text-[10px] text-gray-400">{count}</span>
    </button>
  );
}
