"use client";

interface CascadeResultsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function CascadeResults({ result }: CascadeResultsProps) {
  if (!result) return null;

  const affected = result.affected_entities ?? [];

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Failure Simulation
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50/40 p-3">
        <div className="text-lg font-bold text-red-600">
          {result.blast_radius ?? affected.length}
        </div>
        <div className="text-[11px] text-gray-500">elements affected</div>
      </div>

      {result.narrative && (
        <p className="text-xs leading-relaxed text-gray-600">
          {result.narrative}
        </p>
      )}

      {affected.length > 0 && (
        <div className="space-y-1">
          {affected.map(
            (
              a: { entity_id: string; name: string; distance: number; impact: string },
              i: number
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
            )
          )}
        </div>
      )}
    </div>
  );
}
