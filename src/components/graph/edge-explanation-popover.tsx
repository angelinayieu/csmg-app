"use client";

import { useEffect, useState, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import type { Edge, Entity } from "@/types";

interface EdgeExplanationPopoverProps {
  edge: Edge;
  entities: Entity[];
  position: { x: number; y: number };
  spaceDescription: string;
  onClose: () => void;
  onExplanationCached: (edgeId: string, explanation: string) => void;
}

export function EdgeExplanationPopover({
  edge,
  entities,
  position,
  spaceDescription,
  onClose,
  onExplanationCached,
}: EdgeExplanationPopoverProps) {
  const [explanation, setExplanation] = useState<string | null>(
    edge.conditions || null
  );
  const [loading, setLoading] = useState(!edge.conditions);
  const ref = useRef<HTMLDivElement>(null);

  const sourceEntity = entities.find((e) => e.id === edge.source_entity_id);
  const targetEntity = entities.find((e) => e.id === edge.target_entity_id);

  useEffect(() => {
    if (edge.conditions) return;

    const controller = new AbortController();
    async function fetchExplanation() {
      try {
        const res = await fetch("/api/explain-edge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            edgeId: edge.id,
            sourceName: sourceEntity?.name ?? "Unknown",
            targetName: targetEntity?.name ?? "Unknown",
            relationshipType: edge.relationship_type,
            dimension: edge.dimension,
            spaceContext: spaceDescription,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.explanation) {
          setExplanation(data.explanation);
          onExplanationCached(edge.id, data.explanation);
        } else {
          setExplanation("Could not generate explanation.");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setExplanation("Failed to load explanation.");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchExplanation();
    return () => controller.abort();
  }, [edge, sourceEntity, targetEntity, spaceDescription, onExplanationCached]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid immediately closing from the click that opened it
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  // Dimension color
  const dimColors: Record<string, string> = {
    structural: "#888780",
    functional: "#1D9E75",
    temporal: "#BA7517",
    causal: "#D85A30",
    correlational: "#888780",
    logical: "#7F77DD",
    epistemic: "#D4537E",
    comparative: "#378ADD",
    agentive: "#639922",
  };
  const dimColor = dimColors[edge.dimension] ?? "#888";

  return (
    <div
      ref={ref}
      className="absolute z-50 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -100%) translateY(-12px)",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute right-2 top-2 rounded p-0.5 text-gray-400 hover:text-gray-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: dimColor }}
        />
        <span className="text-xs font-medium capitalize text-gray-500">
          {edge.dimension}
        </span>
        <span className="text-xs text-gray-400">
          {Math.round(edge.confidence * 100)}% confident
        </span>
      </div>

      {/* Relationship */}
      <div className="mb-3 text-sm font-medium text-gray-800">
        <span className="text-interaxis-600">
          {sourceEntity?.entity_id ?? "?"}
        </span>{" "}
        {sourceEntity?.name}
        <span className="mx-1.5 text-gray-400">{edge.relationship_type}</span>
        <span className="text-interaxis-600">
          {targetEntity?.entity_id ?? "?"}
        </span>{" "}
        {targetEntity?.name}
      </div>

      {/* Explanation */}
      <div className="text-[13px] leading-relaxed text-gray-600">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating explanation...
          </div>
        ) : (
          explanation
        )}
      </div>

      {/* Source tag */}
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            edge.source_tag === "stated"
              ? "bg-blue-50 text-blue-600"
              : edge.source_tag === "inferred"
                ? "bg-amber-50 text-amber-600"
                : "bg-purple-50 text-purple-600"
          }`}
        >
          {edge.source_tag}
        </span>
        {edge.is_tradeoff && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
            tradeoff
          </span>
        )}
        {edge.polarity !== "positive" && (
          <span className="text-[10px] text-gray-400">{edge.polarity}</span>
        )}
      </div>

      {/* Dynamics */}
      {edge.dynamics && (
        <div className="mt-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              edge.dynamics === "threshold"
                ? "bg-amber-50 text-amber-600"
                : edge.dynamics === "compounding"
                  ? "bg-green-50 text-green-600"
                  : edge.dynamics === "exponential"
                    ? "bg-red-50 text-red-600"
                    : edge.dynamics === "delayed"
                      ? "bg-blue-50 text-blue-600"
                      : edge.dynamics === "decay"
                        ? "bg-orange-50 text-orange-600"
                        : "bg-gray-100 text-gray-500"
            }`}
          >
            {edge.dynamics}
          </span>
          {edge.dynamics_properties &&
            typeof edge.dynamics_properties === "object" &&
            !Array.isArray(edge.dynamics_properties) && (() => {
              const dp = edge.dynamics_properties as Record<string, unknown>;
              const parts: { label: string; value: string }[] = [];
              if (dp.threshold_condition) parts.push({ label: "Gate", value: String(dp.threshold_condition) });
              if (dp.delay) parts.push({ label: "Delay", value: String(dp.delay) });
              if (dp.cycle_time) parts.push({ label: "Cycle", value: String(dp.cycle_time) });
              else if (dp.estimated_cycle_time) parts.push({ label: "Cycle", value: String(dp.estimated_cycle_time) });
              if (dp.before_threshold && dp.after_threshold) {
                parts.push({ label: "Before", value: `${String(dp.before_threshold)} \u2192 After: ${String(dp.after_threshold)}` });
              }
              return (
                <div className="mt-1 space-y-0.5">
                  {parts.map((p, i) => (
                    <div key={i} className="text-[11px] text-gray-500">
                      <span className="font-medium">{p.label}:</span> {p.value}
                    </div>
                  ))}
                  {dp.compounding_mechanism ? (
                    <div className="text-[11px] italic text-gray-400">
                      {String(dp.compounding_mechanism)}
                    </div>
                  ) : null}
                </div>
              );
            })()}
        </div>
      )}

      {/* Utility context */}
      {edge.utility && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(edge.utility as any)?.actionability && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              (edge.utility as any).actionability === "directly_controllable"
                ? "bg-green-50 text-green-600"
                : (edge.utility as any).actionability === "fixed_constraint"
                  ? "bg-gray-100 text-gray-500"
                  : (edge.utility as any).actionability === "observable_only"
                    ? "bg-purple-50 text-purple-600"
                    : "bg-amber-50 text-amber-600"
            }`}>
              {((edge.utility as any).actionability as string)?.replace(/_/g, " ")}
            </span>
          )}
          {(edge.utility as any)?.failure_consequence === "catastrophic" && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              catastrophic if broken
            </span>
          )}
          {(edge.utility as any)?.failure_consequence === "degrading" && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              degrades target
            </span>
          )}
          {(edge.utility as any)?.information_value === "decision_critical" && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              decision critical
            </span>
          )}
          {(edge.utility as any)?.propagation_speed && (edge.utility as any).propagation_speed !== "immediate" && (
            <span className="text-[10px] text-gray-400">
              propagates: {(edge.utility as any).propagation_speed}
            </span>
          )}
          {(edge.utility as any)?.decision_question && (
            <div className="mt-1.5 w-full rounded-md bg-blue-50 px-2 py-1.5 text-[11px] text-blue-700">
              <span className="font-medium">Key decision:</span>{" "}
              {(edge.utility as any).decision_question}
            </div>
          )}
        </div>
      )}

      {/* Temporal validity */}
      {edge.temporal_validity && (
        <div className="mt-2 space-y-1">
          {(edge.temporal_validity as any)?.temporal_scope && (
            <div className="text-[11px] text-gray-500">
              <span className="font-medium">Time scope:</span>{" "}
              {(edge.temporal_validity as any).temporal_scope}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(edge.temporal_validity as any)?.valid_from && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                from: {(edge.temporal_validity as any).valid_from}
              </span>
            )}
            {(edge.temporal_validity as any)?.valid_until && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                until: {(edge.temporal_validity as any).valid_until}
              </span>
            )}
            {(edge.temporal_validity as any)?.decay_rate && (edge.temporal_validity as any).decay_rate !== "none" && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                (edge.temporal_validity as any).decay_rate === "immediate"
                  ? "bg-red-50 text-red-600"
                  : (edge.temporal_validity as any).decay_rate === "fast"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-gray-100 text-gray-500"
              }`}>
                {(edge.temporal_validity as any).decay_rate} decay
              </span>
            )}
          </div>
        </div>
      )}

      {/* Arrow pointer */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ bottom: -6 }}
      >
        <div className="h-3 w-3 rotate-45 border-b border-r border-gray-200 bg-white" />
      </div>
    </div>
  );
}
