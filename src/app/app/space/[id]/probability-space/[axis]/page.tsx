"use client";

// ── Probability-space axis detail page ──
// Route: /app/space/[id]/probability-space/[axis]
//
// The drill-down for a single probability-space lens. Reached by
// double-clicking a probability-space-shell card on the canvas (handler
// in src/components/canvas/shapes/probability-space-shell-shape.tsx).
//
// Shows the FULL underlying KG slice the lens produced — every entity
// the axis generator surfaced + every edge between them + the semantic
// score breakdown. Replaces the old probability-space-rail's drill-down
// affordance which was lost when shells became tldraw shapes
// (commit 213047b).
//
// Data source: GET /api/spaces/[id]/probability-space/[axis] returns
// the latest probability_space_runs row including axis_output_json
// (full entities + edges + score) and axis_semantic_score (peer-review
// breakdown).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProbabilitySpaceAxisDetail } from "@/app/api/spaces/[id]/probability-space/[axis]/route";

// Shape of axis_output_json — mirrors what /api/pipeline/probability-space/[axis]
// persists. We type defensively because legacy rows may have partial shape.
interface AxisEntity {
  entityId?: string;
  entity_id?: string;
  name: string;
  weight?: number;
  description?: string;
  category?: string;
}
interface AxisEdge {
  sourceEntityId?: string;
  source_entity_id?: string;
  targetEntityId?: string;
  target_entity_id?: string;
  mechanism?: string;
  polarity?: "positive" | "negative" | "conditional" | "neutral";
  dynamics?: string;
  confidence?: number;
}
interface AxisOutput {
  entities?: AxisEntity[];
  edges?: AxisEdge[];
  score?: {
    weighted?: number;
    breakdown?: Record<string, number>;
    notes?: string;
  };
}
interface SemanticScore {
  score?: number;
  breakdown?: Record<string, number>;
  notes?: string;
}

const POLARITY_COLOR: Record<string, string> = {
  positive: "text-emerald-600",
  negative: "text-rose-600",
  conditional: "text-amber-600",
  neutral: "text-slate-500",
};

const POLARITY_GLYPH: Record<string, string> = {
  positive: "+",
  negative: "−",
  conditional: "?",
  neutral: "·",
};

export default function ProbabilitySpaceAxisPage() {
  const params = useParams<{ id: string; axis: string }>();
  const router = useRouter();
  const spaceId = params.id;
  const axis = params.axis;

  const [data, setData] = useState<ProbabilitySpaceAxisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/spaces/${spaceId}/probability-space/${encodeURIComponent(axis)}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setData(json as ProbabilitySpaceAxisDetail);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, axis]);

  const output: AxisOutput | null = useMemo(() => {
    const raw = data?.run?.axis_output_json;
    if (!raw || typeof raw !== "object") return null;
    return raw as AxisOutput;
  }, [data]);

  const semanticScore: SemanticScore | null = useMemo(() => {
    const raw = data?.run?.axis_semantic_score;
    if (!raw || typeof raw !== "object") return null;
    return raw as SemanticScore;
  }, [data]);

  const accent = data?.catalog?.accent ?? "#2563eb";
  const label = data?.catalog?.label ?? axis;
  const tagline = data?.catalog?.tagline ?? "";

  // Build a name lookup for resolving edge endpoints back to entity names.
  const idToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of output?.entities ?? []) {
      const id = e.entityId ?? e.entity_id;
      if (id) m.set(id, e.name);
    }
    return m;
  }, [output]);

  const entities = output?.entities ?? [];
  const edges = output?.edges ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Back nav */}
        <button
          onClick={() => router.back()}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to whiteboard
        </button>

        {/* Header */}
        <header
          className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 6%, white) 0%, white 70%)`,
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{ color: accent }}
              >
                Probability space · {axis}
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">
                {label}
              </h1>
              {tagline && (
                <p className="mt-1 text-sm text-slate-600">{tagline}</p>
              )}
              {data?.run?.rationale && (
                <p className="mt-3 text-sm italic text-slate-600">
                  &ldquo;{data.run.rationale}&rdquo;
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <div className="text-3xl font-semibold tabular-nums" style={{ color: accent }}>
                {entities.length}
              </div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {entities.length === 1 ? "entity" : "entities"}
              </div>
              {data?.run?.status && (
                <div
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    data.run.status === "merged"
                      ? "bg-emerald-100 text-emerald-700"
                      : data.run.status === "failed"
                        ? "bg-rose-100 text-rose-700"
                        : data.run.status === "generating"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600",
                  )}
                >
                  {data.run.status}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Loading / error / empty */}
        {loading && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading probability space…
          </div>
        )}
        {error && !loading && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <div className="font-semibold">Couldn&rsquo;t load this axis</div>
              <div className="mt-1 text-xs">{error}</div>
            </div>
          </div>
        )}
        {!loading && !error && !data?.run && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            This axis hasn&rsquo;t been generated for this whiteboard yet.
          </div>
        )}

        {/* Score breakdown */}
        {!loading && !error && (semanticScore || output?.score) && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Semantic rigor score
              </h2>
              <div className="text-2xl font-semibold tabular-nums" style={{ color: accent }}>
                {(semanticScore?.score ?? output?.score?.weighted ?? 0).toFixed(2)}
              </div>
            </div>
            {(semanticScore?.breakdown || output?.score?.breakdown) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(
                  semanticScore?.breakdown ?? output?.score?.breakdown ?? {},
                ).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {k.replace(/_/g, " ")}
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">
                      {typeof v === "number" ? v.toFixed(2) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(semanticScore?.notes || output?.score?.notes) && (
              <p className="mt-3 text-xs italic text-slate-600">
                {semanticScore?.notes ?? output?.score?.notes}
              </p>
            )}
          </section>
        )}

        {/* Entities */}
        {!loading && !error && entities.length > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              Entities ({entities.length})
            </h2>
            <ul className="divide-y divide-slate-100">
              {entities.map((e, i) => {
                const id = e.entityId ?? e.entity_id ?? `idx-${i}`;
                return (
                  <li key={id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/app/space/${spaceId}/entity/${encodeURIComponent(id)}`}
                          className="text-sm font-semibold text-slate-900 hover:underline"
                        >
                          {e.name}
                        </Link>
                        {e.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                            {e.description}
                          </p>
                        )}
                      </div>
                      {typeof e.weight === "number" && (
                        <div
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                          style={{
                            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                            color: accent,
                          }}
                          title="weight"
                        >
                          {e.weight.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Edges */}
        {!loading && !error && edges.length > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              Edges ({edges.length})
            </h2>
            <ul className="space-y-2">
              {edges.map((edge, i) => {
                const src = edge.sourceEntityId ?? edge.source_entity_id ?? "";
                const dst = edge.targetEntityId ?? edge.target_entity_id ?? "";
                const polarity = edge.polarity ?? "neutral";
                return (
                  <li
                    key={`${src}-${dst}-${i}`}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="font-semibold text-slate-800">
                        {idToName.get(src) ?? src.slice(0, 8)}
                      </span>
                      <span
                        className={cn(
                          "font-bold",
                          POLARITY_COLOR[polarity] ?? POLARITY_COLOR.neutral,
                        )}
                        title={polarity}
                      >
                        {POLARITY_GLYPH[polarity] ?? "·"}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {idToName.get(dst) ?? dst.slice(0, 8)}
                      </span>
                      {typeof edge.confidence === "number" && (
                        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                          conf {edge.confidence.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {edge.mechanism && (
                      <p className="mt-1 text-slate-600">{edge.mechanism}</p>
                    )}
                    {edge.dynamics && (
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                        dynamics · {edge.dynamics}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Generator focus (catalog metadata) */}
        {!loading && !error && data?.catalog?.generator_focus && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-xs text-slate-600 shadow-sm">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Generator focus
            </div>
            <p>{data.catalog.generator_focus}</p>
          </section>
        )}

        {/* Footer / open whiteboard link */}
        <div className="mt-6 flex justify-end">
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Open whiteboard
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
