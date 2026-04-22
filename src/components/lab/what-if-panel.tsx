"use client";

import { useMemo, useState } from "react";
import {
  X,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Search,
  TrendingUp,
  TrendingDown,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import type { WhatIfResponse } from "@/lib/prompts/what-if";

/**
 * LLM-grounded What-If panel — opened from UniversalLabControlPanel's
 * "LLM scenario" button (or any Lab scope's equivalent).
 *
 * Flow:
 *   1. User picks a target entity (search by name) + direction + magnitude.
 *   2. We POST to /api/lab/what-if — the server walks the neighborhood
 *      subgraph and calls the LLM.
 *   3. Result renders inline: narrative + affected entities with effect
 *      direction + propagation paths + distribution + cautions.
 *
 * Impact-overlay callback lets the parent (Lab page) pulse the affected
 * entities in the 3D chamber. Call signature: onImpactOverlay(entityIds).
 * Pass null to clear.
 */

type Direction = "strengthen" | "weaken" | "remove";

interface WhatIfPanelProps {
  /** Entities the user can target. Universal Lab passes everything it
   *  knows about; space/entity Labs would pass their narrower slice. */
  entities: Array<Pick<Entity, "id" | "name" | "description" | "entity_category">>;
  onClose: () => void;
  onImpactOverlay?: (entityIds: string[] | null) => void;
}

export function WhatIfPanel({
  entities,
  onClose,
  onImpactOverlay,
}: WhatIfPanelProps) {
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("strengthen");
  const [magnitude, setMagnitude] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return entities.slice(0, 8);
    return entities
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [query, entities]);

  const targetEntity = useMemo(
    () => entities.find((e) => e.id === targetId) ?? null,
    [targetId, entities],
  );

  async function run() {
    if (!targetId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    onImpactOverlay?.(null);
    try {
      const res = await fetch("/api/lab/what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_entity_id: targetId,
          direction,
          magnitude,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "What-if failed");
      const r = body.result as WhatIfResponse;
      setResult(r);
      onImpactOverlay?.(r.affected_entities.map((a) => a.entity_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "What-if failed");
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    onImpactOverlay?.(null);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={running ? undefined : handleClose}
    >
      <div
        className="mx-4 w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] shadow-2xl"
        style={{
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--lab-border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--lab-info)]">
              <Sparkles className="h-3 w-3" />
              LLM scenario
            </div>
            <p className="mt-1 text-[13px] text-[var(--lab-text-mid)]">
              Walk your knowledge graph to predict what happens under a real
              intervention.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={running}
            className="rounded p-1 text-[var(--lab-text-dim)] hover:bg-[var(--lab-panel-raised)] hover:text-[var(--lab-text)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-[var(--lab-text)]">
          {/* Target picker */}
          <div>
            <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
              Target
            </label>
            {targetEntity ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--lab-info-border)] bg-[var(--lab-info-tint)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">
                    {targetEntity.name}
                  </div>
                  {targetEntity.description && (
                    <div className="truncate text-[11px] text-[var(--lab-text-dim)]">
                      {targetEntity.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setTargetId(null);
                    setResult(null);
                  }}
                  className="rounded p-1 text-[var(--lab-text-dim)] hover:bg-[var(--lab-panel-raised)]"
                  aria-label="Change target"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-2.5">
                  <Search className="h-3.5 w-3.5 text-[var(--lab-text-dim)]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for an entity to perturb…"
                    className="flex-1 border-0 bg-transparent py-2 text-[13px] text-[var(--lab-text)] placeholder-[var(--lab-text-faint)] focus:outline-none"
                  />
                </div>
                {matches.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-1.5">
                    {matches.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          setTargetId(e.id);
                          setQuery("");
                        }}
                        className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-[var(--lab-panel-bg)]"
                      >
                        <div className="truncate font-medium">{e.name}</div>
                        {e.description && (
                          <div className="truncate text-[10px] text-[var(--lab-text-dim)]">
                            {e.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Direction + magnitude */}
          {targetEntity && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
                  Direction
                </label>
                <div className="flex gap-1">
                  {(["strengthen", "weaken", "remove"] as Direction[]).map(
                    (d) => (
                      <button
                        key={d}
                        onClick={() => setDirection(d)}
                        className={cn(
                          "flex-1 rounded-md border px-2 py-1.5 text-[11px] capitalize",
                          direction === d
                            ? "border-[var(--lab-info)] bg-[var(--lab-info-tint-strong)] text-[var(--lab-info)]"
                            : "border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] text-[var(--lab-text-mid)] hover:border-[var(--lab-border-strong)]",
                        )}
                      >
                        {d}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1.5 flex items-baseline justify-between text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
                  Magnitude
                  <span className="tabular-nums text-[11px] text-[var(--lab-text)]">
                    {magnitude.toFixed(1)}
                  </span>
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  value={magnitude}
                  onChange={(e) => setMagnitude(parseFloat(e.target.value))}
                  className="w-full cursor-pointer appearance-none rounded-[2px] bg-[var(--lab-panel-inset)]"
                  style={{ height: 4 }}
                />
                <div className="mt-1 flex justify-between font-mono text-[8px] text-[var(--lab-text-faint)]">
                  <span>nudge</span>
                  <span>mid</span>
                  <span>full</span>
                </div>
              </div>
            </div>
          )}

          {/* Run button */}
          {targetEntity && !result && (
            <button
              onClick={run}
              disabled={running || !targetId}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--lab-info)] bg-[var(--lab-info-tint-strong)] px-3 py-2 text-[13px] font-semibold text-[var(--lab-info)] transition-colors hover:bg-[var(--lab-info-tint-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Simulating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Simulate
                </>
              )}
            </button>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}

          {result && (
            <ResultView
              result={result}
              entities={entities}
              onReRun={() => {
                setResult(null);
                onImpactOverlay?.(null);
              }}
            />
          )}
        </div>
      </div>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #00acc1;
          box-shadow: 0 0 6px #00acc1;
          cursor: pointer;
          border: 1px solid #10161f;
        }
      `}</style>
    </div>
  );
}

function ResultView({
  result,
  entities,
  onReRun,
}: {
  result: WhatIfResponse;
  entities: Array<Pick<Entity, "id" | "name">>;
  onReRun: () => void;
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  return (
    <div className="space-y-3">
      {/* Narrative */}
      <div className="rounded-lg border-l-2 border-[var(--lab-info)] bg-[var(--lab-info-tint)] px-3 py-2">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-info)]">
          Scenario
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--lab-text)]">
          {result.narrative || "No narrative returned."}
        </p>
      </div>

      {/* Distribution */}
      <div className="rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-3">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
          Predicted impact
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <DistroPill label="p10" value={result.derived_distribution.p10} muted />
          <DistroPill label="p50" value={result.derived_distribution.p50} />
          <DistroPill label="p90" value={result.derived_distribution.p90} muted />
        </div>
        {result.derived_distribution.rationale && (
          <p className="mt-2 text-[11px] italic text-[var(--lab-text-mid)]">
            {result.derived_distribution.rationale}
          </p>
        )}
      </div>

      {/* Affected entities */}
      {result.affected_entities.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Affected entities ({result.affected_entities.length})
          </div>
          <div className="space-y-1">
            {result.affected_entities.map((a) => (
              <AffectedRow
                key={a.entity_id}
                name={nameById.get(a.entity_id) ?? a.entity_id.slice(0, 8)}
                effect={a.effect}
                confidence={a.confidence}
                reasoning={a.reasoning}
              />
            ))}
          </div>
        </div>
      )}

      {/* Propagation paths */}
      {result.propagation_paths.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-dim)]">
            Propagation paths
          </div>
          <div className="space-y-1.5">
            {result.propagation_paths.map((p, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] p-2"
              >
                <div className="flex flex-wrap items-center gap-1 text-[12px]">
                  {p.path.map((id, idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <span className="rounded bg-[var(--lab-panel-bg)] px-1.5 py-0.5 text-[11px]">
                        {nameById.get(id) ?? id.slice(0, 8)}
                      </span>
                      {idx < p.path.length - 1 && (
                        <ArrowRight className="h-3 w-3 text-[var(--lab-text-faint)]" />
                      )}
                    </span>
                  ))}
                  <span
                    className={cn(
                      "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase",
                      p.likelihood === "high" &&
                        "bg-green-500/10 text-green-300",
                      p.likelihood === "medium" &&
                        "bg-amber-500/10 text-amber-300",
                      p.likelihood === "low" && "bg-gray-500/10 text-gray-400",
                    )}
                  >
                    {p.likelihood}
                  </span>
                </div>
                {p.description && (
                  <p className="mt-1 text-[11px] text-[var(--lab-text-mid)]">
                    {p.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cautions */}
      {result.cautions && result.cautions.length > 0 && (
        <div className="rounded-lg border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Cautions
          </div>
          <ul className="mt-1 space-y-0.5">
            {result.cautions.map((c, i) => (
              <li key={i} className="text-[12px] text-amber-200">
                • {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onReRun}
        className="w-full rounded-lg border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] py-2 text-[12px] font-medium text-[var(--lab-text-mid)] hover:border-[var(--lab-info-border)] hover:text-[var(--lab-info)]"
      >
        Run another scenario
      </button>
    </div>
  );
}

function DistroPill({
  label,
  value,
  muted,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-md border px-2 py-1.5 text-center",
        muted
          ? "border-[var(--lab-border)] bg-[var(--lab-panel-bg)]"
          : "border-[var(--lab-info-border)] bg-[var(--lab-info-tint)]",
      )}
    >
      <div
        className={cn(
          "text-[9px] uppercase tracking-widest",
          muted ? "text-[var(--lab-text-faint)]" : "text-[var(--lab-info)]",
        )}
      >
        {label}
      </div>
      <div className="mt-0.5 text-[16px] tabular-nums text-[var(--lab-text)]">
        {Math.round(value)}
        <span className="ml-0.5 text-[9px] text-[var(--lab-text-dim)]">%</span>
      </div>
    </div>
  );
}

function AffectedRow({
  name,
  effect,
  confidence,
  reasoning,
}: {
  name: string;
  effect: WhatIfResponse["affected_entities"][number]["effect"];
  confidence: number;
  reasoning: string;
}) {
  const Icon =
    effect === "increases"
      ? TrendingUp
      : effect === "decreases"
        ? TrendingDown
        : effect === "destabilizes"
          ? Zap
          : effect === "reinforces"
            ? Sparkles
            : null;
  const color =
    effect === "increases"
      ? "#4ade80"
      : effect === "decreases"
        ? "#f472b6"
        : effect === "destabilizes"
          ? "#f59e0b"
          : effect === "reinforces"
            ? "#00ACC1"
            : "#64748b";
  return (
    <div className="rounded-md border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 flex-shrink-0" style={{ color }} />}
        <span className="truncate text-[12px] font-semibold text-[var(--lab-text)]">
          {name}
        </span>
        <span
          className="ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
          style={{ background: `${color}18`, color }}
        >
          {effect}
        </span>
        <span className="flex-shrink-0 tabular-nums text-[10px] text-[var(--lab-text-dim)]">
          {Math.round(confidence * 100)}%
        </span>
      </div>
      {reasoning && (
        <p className="mt-0.5 text-[11px] text-[var(--lab-text-mid)]">{reasoning}</p>
      )}
    </div>
  );
}
