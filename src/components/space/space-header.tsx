import type { Space } from "@/types";
import { Boxes, GitFork, RefreshCw, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const maturityConfig: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  actionable_now: { label: "Actionable", color: "text-green-700", bg: "bg-green-50" },
  waiting_on_dependency: { label: "Waiting", color: "text-amber-700", bg: "bg-amber-50" },
  theoretical: { label: "Theoretical", color: "text-blue-700", bg: "bg-blue-50" },
  blocked: { label: "Blocked", color: "text-red-700", bg: "bg-red-50" },
};

export function SpaceHeader({ space }: { space: Space }) {
  const maturity = maturityConfig[space.maturity] ?? maturityConfig.theoretical;

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-interaxis-100 text-lg font-bold text-interaxis-700">
          {space.space_prefix}
        </span>
        <div>
          <h1 className="text-2xl font-bold">{space.name}</h1>
          {space.description && (
            <p className="mt-1 text-sm text-gray-600">{space.description}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <Boxes className="h-4 w-4" />
          <span>{space.entity_count} entities</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <GitFork className="h-4 w-4" />
          <span>{space.edge_count} edges</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <RefreshCw className="h-4 w-4" />
          <span>{space.cycle_count} cycles</span>
        </div>
        {space.orphan_count > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-gray-400">
            <Circle className="h-4 w-4" />
            <span>{space.orphan_count} orphans</span>
          </div>
        )}
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            maturity.color,
            maturity.bg
          )}
        >
          {maturity.label}
        </span>
      </div>
    </div>
  );
}
