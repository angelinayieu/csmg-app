"use client";

interface PathResultsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export function PathResults({ result }: PathResultsProps) {
  if (!result) return null;

  const path = result.path ?? [];
  const edges = result.edges ?? [];

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Path Trace
      </div>

      {/* Path visualization */}
      <div className="rounded-lg border border-green-200 bg-green-50/30 p-3">
        <div className="flex flex-wrap items-center gap-1">
          {path.map(
            (node: { entity_id: string; name: string }, i: number) => (
              <div key={i} className="flex items-center gap-1">
                <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm">
                  <span className="text-gray-400">{node.entity_id}</span>{" "}
                  {node.name}
                </span>
                {i < path.length - 1 && edges[i] && (
                  <span className="text-[10px] text-green-600">
                    →{" "}
                    <span className="italic">
                      {edges[i].relationship_type}
                    </span>{" "}
                    →
                  </span>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {result.interpretation && (
        <p className="text-xs leading-relaxed text-gray-600">
          {result.interpretation}
        </p>
      )}
    </div>
  );
}
