"use client";

interface LoopDetailCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function LoopDetailCards({ result }: LoopDetailCardProps) {
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
          i: number
        ) => {
          const isPositive = cycle.classification === "reinforcing_positive";
          const isNegative = cycle.classification === "reinforcing_negative";
          const color = isPositive
            ? "#34C759"
            : isNegative
              ? "#FF3B30"
              : "#FF9500";

          return (
            <div
              key={i}
              className="rounded-lg border bg-white p-3"
              style={{ borderColor: `${color}40` }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-medium text-gray-800">
                  {cycle.name}
                </span>
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
                  {cycle.intervention_description &&
                    ` — ${cycle.intervention_description}`}
                </div>
              )}
            </div>
          );
        }
      )}
    </div>
  );
}
