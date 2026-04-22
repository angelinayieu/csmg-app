"use client";

// ── Canvas edge-detail drawer ──
//
// Closes the symmetry gap: users can click any kg-node and see its
// full richness (evidence, manifold, provenance, connections) via
// EntityDetailDrawer — but edges have always been mute. Arrows on
// the canvas carry an edge_id via their TL shape id (`shape:edge-<uuid>`)
// but no click handler surfaced anything about them.
//
// This drawer mirrors the entity drawer: fetches one endpoint for
// the full edge row + hydrated endpoints + linked evidence claims,
// then renders the fields that matter for rigor — dimension,
// polarity, dynamics, conditions, topology, utility sub-fields. The
// fields that already exist in the DB but have never reached any
// surface.

import { useCallback, useEffect, useState } from "react";
import { X, ArrowRight, TrendingUp, TrendingDown, Minus, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import type { Edge, Entity, Claim } from "@/types";

export interface EdgeDetailDrawerProps {
  edgeId: string | null;
  onClose: () => void;
}

interface EdgeDetailResponse {
  edge: Edge;
  sourceEntity: Entity | null;
  targetEntity: Entity | null;
  claims: Claim[];
}

const POLARITY_META: Record<string, { label: string; tone: string; Icon: typeof TrendingUp }> = {
  positive: { label: "Positive", tone: "text-emerald-700 bg-emerald-50 ring-emerald-200", Icon: TrendingUp },
  negative: { label: "Negative", tone: "text-red-700 bg-red-50 ring-red-200", Icon: TrendingDown },
  neutral: { label: "Neutral", tone: "text-gray-600 bg-gray-50 ring-gray-200", Icon: Minus },
  conditional: { label: "Conditional", tone: "text-amber-700 bg-amber-50 ring-amber-200", Icon: AlertTriangle },
};

const DYNAMICS_META: Record<string, { label: string; hint: string }> = {
  linear: { label: "Linear", hint: "Proportional response — doubling input doubles effect" },
  threshold: { label: "Threshold", hint: "Effect kicks in only after a tipping point" },
  compounding: { label: "Compounding", hint: "Effect amplifies over time (feedback loop)" },
  exponential: { label: "Exponential", hint: "Accelerates sharply" },
  decay: { label: "Decay", hint: "Weakens over time without reinforcement" },
  step_function: { label: "Step function", hint: "Discrete jumps" },
  delayed: { label: "Delayed", hint: "Effect lags behind cause" },
  logarithmic: { label: "Logarithmic", hint: "Diminishing returns" },
};

export function EdgeDetailDrawer({ edgeId, onClose }: EdgeDetailDrawerProps) {
  const [data, setData] = useState<EdgeDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!edgeId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/edges/${edgeId}/detail`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Lookup failed (${res.status})`);
        }
        return res.json() as Promise<EdgeDetailResponse>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lookup failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [edgeId]);

  const handleClose = useCallback(() => {
    setData(null);
    setError(null);
    onClose();
  }, [onClose]);

  if (!edgeId) return null;

  if (loading && !data) {
    return (
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col items-center justify-center border-l border-gray-200 bg-white shadow-lg"
        style={{ animation: "slideInRight 300ms ease forwards" }}
      >
        <div className="text-[12px] text-gray-400">Loading edge…</div>
        <style jsx>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col items-center justify-center border-l border-gray-200 bg-white px-8 text-center shadow-lg">
        <div className="mb-3 text-[13px] font-semibold text-gray-700">Couldn&apos;t load edge</div>
        <div className="mb-4 text-[11px] text-gray-500">{error}</div>
        <button
          onClick={handleClose}
          className="rounded-md border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { edge, sourceEntity, targetEntity, claims } = data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ae = edge as any;
  const polarity = (ae.polarity as string) ?? "neutral";
  const polMeta = POLARITY_META[polarity] ?? POLARITY_META.neutral;
  const PolIcon = polMeta.Icon;
  const dynamics = ae.dynamics as string | null;
  const dynMeta = dynamics ? DYNAMICS_META[dynamics] : null;
  const conf = typeof edge.confidence === "number" ? edge.confidence : 0.5;

  return (
    <div
      className="fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col border-l border-gray-200 bg-white shadow-lg"
      style={{ animation: "slideInRight 300ms ease forwards" }}
    >
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Edge · {edge.relationship_type?.replace(/_/g, " ")}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[14px] font-semibold tracking-tight text-gray-900">
              <span className="truncate">{sourceEntity?.name ?? "?"}</span>
              <ArrowRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
              <span className="truncate">{targetEntity?.name ?? "?"}</span>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Ring value={conf} size={38} />
            <button
              onClick={handleClose}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {ae.dimension && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 ring-1 ring-indigo-200">
              {ae.dimension}
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1",
              polMeta.tone,
            )}
          >
            <PolIcon className="h-2.5 w-2.5" />
            {polMeta.label}
          </span>
          {ae.is_tradeoff && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              TRADEOFF
            </span>
          )}
          {ae.is_part_of_cycle && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">
              IN CYCLE
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-[12px]">
        {ae.conditions && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Mechanism / conditions
            </h3>
            <p className="leading-relaxed text-gray-700">{ae.conditions}</p>
          </div>
        )}

        {dynMeta && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Dynamics
            </h3>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-[13px] font-semibold text-gray-900">{dynMeta.label}</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-600">{dynMeta.hint}</p>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Properties
          </h3>
          <div className="space-y-1 text-[12px]">
            {typeof ae.strength === "number" && (
              <Row label="Strength" value={ae.strength.toFixed(2)} />
            )}
            <Row label="Confidence" value={`${Math.round(conf * 100)}%`} />
            {ae.source_tag && <Row label="Source" value={String(ae.source_tag)} />}
            {ae.topology && ae.topology !== "disjoint" && (
              <Row label="Topology" value={String(ae.topology).replace(/_/g, " ")} />
            )}
            {ae.knowledge_layer && (
              <Row label="Layer" value={String(ae.knowledge_layer)} />
            )}
            {ae.utility?.actionability && (
              <Row label="Actionability" value={String(ae.utility.actionability)} />
            )}
            {ae.utility?.propagation_speed && (
              <Row label="Propagation" value={String(ae.utility.propagation_speed)} />
            )}
          </div>
        </div>

        {ae.utility?.failure_consequence && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Failure consequence
            </h3>
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
              {ae.utility.failure_consequence}
            </p>
          </div>
        )}

        {ae.utility?.decision_question && (
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Decision question
            </h3>
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11.5px] italic text-blue-700">
              &ldquo;{ae.utility.decision_question}&rdquo;
            </p>
          </div>
        )}

        {claims.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Evidence
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                {claims.length}
              </span>
            </h3>
            <div className="space-y-1.5">
              {claims.map((c) => (
                <div
                  key={c.id}
                  className="rounded-md bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-700"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-white px-1 py-0.5 text-[9px] font-semibold text-gray-600 ring-1 ring-gray-200">
                      {c.claim_type}
                    </span>
                    <span className="font-mono text-[9.5px] tabular-nums text-gray-400">
                      {Math.round(c.confidence * 100)}%
                    </span>
                  </div>
                  <p>{c.claim_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="max-w-[200px] truncate text-right font-medium text-gray-700">{value}</span>
    </div>
  );
}
