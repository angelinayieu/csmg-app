"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReasoningOp } from "@/lib/hooks/use-reasoning";
import type { Entity } from "@/types";

interface ReasoningToolbarProps {
  activeOp: ReasoningOp | null;
  loading: boolean;
  onRun: (
    op: ReasoningOp,
    params?: { entityId?: string; fromId?: string; toId?: string }
  ) => void;
  onClear: () => void;
  selectedEntity?: Entity | null;
  entities?: Entity[];
}

const operations: {
  op: ReasoningOp;
  label: string;
  color: string;
  needsEntity?: boolean;
  needsTwoEntities?: boolean;
}[] = [
  { op: "centrality", label: "Leverage", color: "#007AFF" },
  { op: "cycles", label: "Loops", color: "#FF9500" },
  { op: "cascade", label: "Risks", color: "#FF3B30", needsEntity: true },
  { op: "path", label: "Paths", color: "#34C759", needsTwoEntities: true },
  { op: "link_prediction", label: "Predict", color: "#AF52DE" },
];

export function ReasoningToolbar({
  activeOp,
  loading,
  onRun,
  onClear,
  selectedEntity,
  entities = [],
}: ReasoningToolbarProps) {
  function handleRun(op: ReasoningOp) {
    const opDef = operations.find((o) => o.op === op);

    if (opDef?.needsEntity) {
      // Cascade: use selected entity, or pick the bottleneck/highest-risk
      if (selectedEntity) {
        onRun(op, { entityId: selectedEntity.entity_id });
      } else {
        // Auto-pick: bottleneck > risk point > first entity
        const auto =
          entities.find((e) => e.is_master_bottleneck) ??
          entities.find((e) => e.is_risk_point) ??
          entities[0];
        if (auto) {
          onRun(op, { entityId: auto.entity_id });
        }
      }
      return;
    }

    if (opDef?.needsTwoEntities) {
      // Path: use selected entity as source, pick most distant as target
      if (selectedEntity) {
        // Pick a target: leverage point or last entity by centrality
        const target =
          entities.find(
            (e) =>
              e.is_leverage_point && e.entity_id !== selectedEntity.entity_id
          ) ??
          entities.find((e) => e.entity_id !== selectedEntity.entity_id);
        if (target) {
          onRun(op, {
            fromId: selectedEntity.entity_id,
            toId: target.entity_id,
          });
        }
      } else {
        // Auto-pick: bottleneck → leverage point
        const from =
          entities.find((e) => e.is_master_bottleneck) ??
          entities.find((e) => e.is_risk_point) ??
          entities[0];
        const to =
          entities.find(
            (e) =>
              e.is_leverage_point && e.entity_id !== from?.entity_id
          ) ?? entities[entities.length - 1];
        if (from && to) {
          onRun(op, {
            fromId: from.entity_id,
            toId: to.entity_id,
          });
        }
      }
      return;
    }

    onRun(op);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-gray-400">
          Reasoning:
        </span>
        {operations.map(({ op, label, color, needsEntity, needsTwoEntities }) => {
          const isActive = activeOp === op;
          const needsSelection = (needsEntity || needsTwoEntities) && !selectedEntity;
          return (
            <button
              key={op}
              onClick={() => (isActive ? onClear() : handleRun(op))}
              disabled={loading && !isActive}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "text-white shadow-sm"
                  : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
                loading && !isActive && "cursor-not-allowed opacity-40"
              )}
              style={{
                backgroundColor: isActive ? color : undefined,
                borderColor: isActive ? color : undefined,
              }}
              title={
                needsSelection
                  ? `Click a node first, or auto-selects ${needsTwoEntities ? "bottleneck → leverage point" : "highest-risk entity"}`
                  : undefined
              }
            >
              {loading && isActive && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {label}
            </button>
          );
        })}
        {activeOp && !loading && (
          <button
            onClick={onClear}
            className="ml-1 text-[10px] text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* Context hint for entity-dependent operations */}
      {selectedEntity && (
        <div className="text-[10px] text-gray-400">
          Selected: <span className="font-medium text-gray-600">{selectedEntity.entity_id}</span> {selectedEntity.name}
          <span className="text-gray-300"> · </span>
          Risks will simulate failure of this entity. Paths will trace from this entity.
        </div>
      )}
    </div>
  );
}
