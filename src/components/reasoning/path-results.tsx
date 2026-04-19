"use client";

import { useState } from "react";
import { Waypoints } from "lucide-react";
import { MermaidDiagram } from "@/components/diagrams/mermaid-diagram";
import { generatePathDiagram } from "@/lib/diagrams/path-diagram";

interface PathResultsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function PathResults({ result }: PathResultsProps) {
  const [showDiagram, setShowDiagram] = useState(false);

  if (!result) return null;

  const path = result.path ?? [];
  const edges = result.edges ?? [];

  const diagramSource =
    path.length >= 2
      ? generatePathDiagram({
          path: path.map((n: { entity_id: string; name?: string }) => ({
            entity_id: n.entity_id,
            name: n.name,
          })),
          edges: edges.map((e: { relationship_type?: string }) => ({
            relationship_type: e.relationship_type,
          })),
          interpretation: result.interpretation,
        })
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Path Trace
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

      {/* Path visualization */}
      <div className="rounded-lg border border-green-200 bg-green-50/30 p-3">
        <div className="flex flex-wrap items-center gap-1">
          {path.map((node: { entity_id: string; name: string }, i: number) => (
            <div key={i} className="flex items-center gap-1">
              <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm">
                <span className="text-gray-400">{node.entity_id}</span> {node.name}
              </span>
              {i < path.length - 1 && edges[i] && (
                <span className="text-[10px] text-green-600">
                  → <span className="italic">{edges[i].relationship_type}</span> →
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {showDiagram && diagramSource && (
        <MermaidDiagram source={diagramSource} ariaLabel="Path trace diagram" />
      )}

      {result.interpretation && (
        <p className="text-xs leading-relaxed text-gray-600">
          {result.interpretation}
        </p>
      )}
    </div>
  );
}
