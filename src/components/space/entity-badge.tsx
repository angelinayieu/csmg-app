import { cn } from "@/lib/utils";
import { Star, AlertTriangle } from "lucide-react";
import type { Entity } from "@/types";

const categoryColors: Record<string, { bg: string; text: string }> = {
  concrete: { bg: "bg-blue-50", text: "text-blue-700" },
  abstract: { bg: "bg-purple-50", text: "text-purple-700" },
  process: { bg: "bg-teal-50", text: "text-teal-700" },
  relational: { bg: "bg-orange-50", text: "text-orange-700" },
  epistemic: { bg: "bg-pink-50", text: "text-pink-700" },
};

const importanceSize: Record<string, string> = {
  fundamental: "ring-2 ring-amber-300",
  critical: "ring-1 ring-amber-200",
  important: "",
  moderate: "opacity-80",
};

export function EntityBadge({ entity }: { entity: Entity }) {
  const colors = categoryColors[entity.entity_category] ?? {
    bg: "bg-gray-50",
    text: "text-gray-700",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2",
        colors.bg,
        importanceSize[entity.importance ?? "moderate"]
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold",
              colors.text,
              colors.bg
            )}
          >
            {entity.entity_id}
          </span>
          <span className={cn("text-sm font-medium truncate", colors.text)}>
            {entity.name}
          </span>
          {entity.is_leverage_point && (
            <Star className="h-3.5 w-3.5 flex-shrink-0 text-amber-500 fill-amber-500" />
          )}
          {entity.is_risk_point && (
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
          )}
        </div>
        {entity.description && (
          <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">
            {entity.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            {entity.entity_type}
          </span>
          <span className="text-[10px] text-gray-300">|</span>
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            {entity.source_tag}
          </span>
        </div>
      </div>
    </div>
  );
}
