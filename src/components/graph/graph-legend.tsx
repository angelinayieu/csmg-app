import { nodeColors, edgeDimensionStyles, graphOverlays } from "@/lib/design-tokens";

const categoryLabels: Record<string, string> = {
  concrete: "Concrete",
  abstract: "Abstract",
  process: "Process",
  relational: "Relational",
  epistemic: "Epistemic",
};

const dimensionLabels: Record<string, string> = {
  structural: "Structural",
  functional: "Functional",
  temporal: "Temporal",
  causal: "Causal",
  correlational: "Correlational",
  logical: "Logical",
  epistemic: "Epistemic",
  comparative: "Comparative",
  agentive: "Agentive",
};

export function GraphLegend() {
  return (
    <div className="space-y-4 text-[10px]">
      {/* Node categories */}
      <div>
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-gray-400">
          Nodes
        </p>
        <div className="space-y-1">
          {Object.entries(categoryLabels).map(([key, label]) => {
            const color = nodeColors[key as keyof typeof nodeColors];
            return (
              <div key={key} className="flex items-center gap-2">
                <svg width={12} height={12}>
                  <circle
                    cx={6}
                    cy={6}
                    r={5}
                    fill={color?.fill ?? "#F9F9FB"}
                    stroke={color?.stroke ?? "#86868B"}
                    strokeWidth={1}
                  />
                </svg>
                <span className="text-gray-600">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Overlays */}
      <div>
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-gray-400">
          Overlays
        </p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill="none"
                stroke={graphOverlays.leverage.ring}
                strokeWidth={1.5}
                strokeDasharray="2 1"
              />
            </svg>
            <span className="text-gray-600">Leverage point</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill="none"
                stroke={graphOverlays.risk.ring}
                strokeWidth={1.5}
                strokeDasharray="2 1"
              />
            </svg>
            <span className="text-gray-600">Risk point</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill="none"
                stroke={graphOverlays.bottleneck.ring}
                strokeWidth={2}
              />
            </svg>
            <span className="text-gray-600">Master bottleneck</span>
          </div>
        </div>
      </div>

      {/* Edge dimensions */}
      <div>
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-gray-400">
          Edges
        </p>
        <div className="space-y-1">
          {Object.entries(dimensionLabels).map(([key, label]) => {
            const style = edgeDimensionStyles[key];
            return (
              <div key={key} className="flex items-center gap-2">
                <svg width={16} height={6}>
                  <line
                    x1={0}
                    y1={3}
                    x2={16}
                    y2={3}
                    stroke={style?.color ?? "#888"}
                    strokeWidth={Math.max(style?.width ?? 1, 1)}
                    strokeDasharray={style?.dash ?? ""}
                  />
                </svg>
                <span className="text-gray-600">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
