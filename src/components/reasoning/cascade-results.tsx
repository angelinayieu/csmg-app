"use client";

import { useState } from "react";
import { Waypoints } from "lucide-react";
import { MermaidDiagram } from "@/components/diagrams/mermaid-diagram";
import { generateCascadeDiagram } from "@/lib/diagrams/cascade-diagram";

interface CascadeResultsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function CascadeResults({ result }: CascadeResultsProps) {
  const [showDiagram, setShowDiagram] = useState(false);

  if (!result) return null;

  const affected = result.affected_entities ?? [];
  const sourceId: string =
    result.source_entity_id ?? result.entity_id ?? "source";
  const sourceName: string = result.source_entity_name ?? result.entity_name ?? sourceId;

  const diagramSource =
    affected.length > 0
      ? generateCascadeDiagram({
          source_entity_id: sourceId,
          source_entity_name: sourceName,
          blast_radius:
            typeof result.blast_radius === "number" && result.blast_radius <= 1
              ? result.blast_radius
              : undefined,
          affected: affected.map(
            (a: { entity_id: string; name?: string; distance: number; impact?: string }) => ({
              entity_id: a.entity_id,
              name: a.name,
              distance: a.distance,
              impact: a.impact,
            }),
          ),
        })
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Failure Simulation
        </div>
        {diagramSource && (
          <button
            type="button"
            onClick={() => setShowDiagram((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <Waypoints className="h-3 w-3" />
            {showDiagram ? "Hide diagram" : "Diagram"}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50/40 p-3">
        <div className="text-lg font-bold text-red-600">
          {result.blast_radius ?? affected.length}
        </div>
        <div className="text-[11px] text-gray-500">elements affected</div>
      </div>

      {result.narrative && (
        <p className="text-xs leading-relaxed text-gray-600">{result.narrative}</p>
      )}

      {showDiagram && diagramSource && (
        <MermaidDiagram source={diagramSource} ariaLabel="Cascade failure diagram" />
      )}

      {affected.length > 0 && (
        <div className="space-y-1">
          {affected.map(
            (
              a: { entity_id: string; name: string; distance: number; impact: string },
              i: number,
            ) => (
              <div
                key={i}
                className="rounded-lg bg-gray-50 px-3 py-2 text-xs"
                style={{ opacity: 1 - a.distance * 0.15 }}
              >
                <span className="font-mono text-gray-400">{a.entity_id}</span>{" "}
                <span className="font-medium text-gray-700">{a.name}</span>
                <div className="mt-0.5 text-gray-500">{a.impact}</div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
