import { AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WeaveContradiction } from "@/types/weave";

export function ContradictionAlert({
  contradiction,
}: {
  contradiction: WeaveContradiction;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <StatusBadge
          variant={
            contradiction.severity === "critical"
              ? "blocked"
              : contradiction.severity === "moderate"
                ? "waiting"
                : "theory"
          }
        >
          {contradiction.severity}
        </StatusBadge>
      </div>
      <div className="mt-2 space-y-1 text-xs leading-relaxed">
        <p className="text-gray-700">
          <span className="font-medium text-gray-900">Assumes:</span>{" "}
          {contradiction.assumption_text}
        </p>
        <p className="text-gray-700">
          <span className="font-medium text-gray-900">But concludes:</span>{" "}
          {contradiction.conclusion_text}
        </p>
      </div>
      {contradiction.description && (
        <p className="mt-1.5 text-xs text-gray-500">
          {contradiction.description}
        </p>
      )}
    </div>
  );
}
