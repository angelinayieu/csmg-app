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
