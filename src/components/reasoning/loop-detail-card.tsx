"use client";

import { useState } from "react";
import { Waypoints } from "lucide-react";
import { MermaidDiagram } from "@/components/diagrams/mermaid-diagram";
import { generateCycleDiagram } from "@/lib/diagrams/cycle-diagram";

interface LoopDetailCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  /** Optional map from entity_id → display name (makes diagrams more readable). */
  entityNames?: Record<string, string>;
}

export function LoopDetailCards({ result, entityNames }: LoopDetailCardProps) {
  const cycles = result?.cycles ?? [];

  if (cycles.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Detected Loops
      </div>
      {cycles.map(
        (
          cycle: {
            cycle_id: string;
            name: string;
            classification: string;
            entity_ids: string[];
            intervention_point: string;
            intervention_description: string;
            description: string;
          },
          i: number,
        ) => {
          return (
            <LoopCard key={cycle.cycle_id ?? i} cycle={cycle} entityNames={entityNames} />
          );
        },
      )}
    </div>
  );
}

function LoopCard({
  cycle,
  entityNames,
}: {
  cycle: {
    cycle_id: string;
    name: string;
    classification: string;
    entity_ids: string[];
    intervention_point: string;
    intervention_description: string;
    description: string;
  };
  entityNames?: Record<string, string>;
}) {
  const [showDiagram, setShowDiagram] = useState(false);

  const isPositive = cycle.classification === "reinforcing_positive";
  const isNegative = cycle.classification === "reinforcing_negative";
  const color = isPositive ? "#34C759" : isNegative ? "#FF3B30" : "#FF9500";

  const diagramSource = generateCycleDiagram({
    name: cycle.name,
    classification: cycle.classification,
    entity_ids: cycle.entity_ids,
    entity_names: entityNames,
    intervention_entity_id: cycle.intervention_point ?? null,
  });

  return (
    <div
      className="rounded-lg border bg-white p-3"
      style={{ borderColor: `${color}40` }}
    >
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-medium text-gray-800">{cycle.name}</span>
        <button
          type="button"
          onClick={() => setShowDiagram((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          title={showDiagram ? "Hide diagram" : "Show diagram"}
        >
          <Waypoints className="h-3 w-3" />
          {showDiagram ? "Hide diagram" : "Diagram"}
        </button>
      </div>

      <div className="mt-2 rounded bg-gray-50 px-2 py-1.5 font-mono text-[10px] text-gray-500">
        {cycle.entity_ids.join(" → ")} → {cycle.entity_ids[0]}
      </div>

      {cycle.description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          {cycle.description}
        </p>
      )}

      {cycle.intervention_point && (
        <div className="mt-1.5 text-[10px] text-green-600">
          Intervene at: {cycle.intervention_point}
          {cycle.intervention_description && ` — ${cycle.intervention_description}`}
        </div>
      )}

      {showDiagram && (
        <div className="mt-2">
          <MermaidDiagram source={diagramSource} ariaLabel={`Loop diagram for ${cycle.name}`} />
        </div>
      )}
    </div>
  );
}
