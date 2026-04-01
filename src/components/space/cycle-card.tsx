import { cn } from "@/lib/utils";
import type { Cycle } from "@/types";
import { RefreshCw, TrendingUp, TrendingDown, Scale } from "lucide-react";

const classificationConfig: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  reinforcing_positive: {
    label: "Reinforcing (+)",
    color: "text-green-700",
    bg: "bg-green-50 border-green-200",
    icon: <TrendingUp className="h-4 w-4 text-green-600" />,
  },
  reinforcing_negative: {
    label: "Reinforcing (-)",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
    icon: <TrendingDown className="h-4 w-4 text-red-600" />,
  },
  balancing: {
    label: "Balancing",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
    icon: <Scale className="h-4 w-4 text-blue-600" />,
  },
};

export function CycleCard({ cycle }: { cycle: Cycle }) {
  const config = classificationConfig[cycle.classification] ?? {
    label: cycle.classification,
    color: "text-gray-700",
    bg: "bg-gray-50 border-gray-200",
    icon: <RefreshCw className="h-4 w-4 text-gray-600" />,
  };

  return (
    <div className={cn("rounded-lg border p-4", config.bg)}>
      <div className="flex items-center gap-2">
        {config.icon}
        <h4 className={cn("font-medium", config.color)}>
          {cycle.name ?? cycle.cycle_id}
        </h4>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
            config.color,
            config.bg
          )}
        >
          {config.label}
        </span>
      </div>
      {cycle.description && (
        <p className="mt-2 text-sm text-gray-600">{cycle.description}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {cycle.entity_ids.map((eid) => (
          <span
            key={eid}
            className="rounded bg-white/60 px-1.5 py-0.5 text-xs font-mono text-gray-600"
          >
            {eid}
          </span>
        ))}
      </div>
    </div>
  );
}
