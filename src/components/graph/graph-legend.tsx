import { nodeColors, edgeDimensionStyles, edgeDynamicsStyles, graphOverlays, connectivityTiers } from "@/lib/design-tokens";

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

// Only show the most impactful dynamics types in legend (not linear)
const dynamicsLegendKeys = [
  "threshold",
  "compounding",
  "exponential",
  "decay",
  "delayed",
  "step_function",
] as const;

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

      {/* Connectivity tiers */}
      <div>
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-gray-400">
          Connectivity
        </p>
        <div className="space-y-1">
          {(["hub", "bridge", "leaf", "orphan"] as const).map((tier) => {
            const config = connectivityTiers[tier];
            const r = Math.round(6 * config.radiusMult);
            const label = tier === "hub" ? "Hub (5+ connections)"
              : tier === "bridge" ? "Bridge (3-4)"
              : tier === "leaf" ? "Leaf (1-2)"
              : "Orphan (0)";
            return (
              <div key={tier} className="flex items-center gap-2">
                <svg width={16} height={16}>
                  <circle
                    cx={8}
                    cy={8}
                    r={Math.max(r, 2)}
                    fill="#3B82F6"
                    opacity={config.opacityMult}
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
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill="none"
                stroke={graphOverlays.cycleIntervention.ring}
                strokeWidth={1.5}
                strokeDasharray="1 1 3 1"
              />
            </svg>
            <span className="text-gray-600">Cycle intervention</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill={graphOverlays.fieldStrength.color}
                opacity={0.3}
              />
            </svg>
            <span className="text-gray-600">Field strength</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={12} height={12}>
              <circle
                cx={6}
                cy={6}
                r={5}
                fill="none"
                stroke={graphOverlays.tensionZone.ring}
                strokeWidth={1.5}
                strokeDasharray="1 2"
              />
            </svg>
            <span className="text-gray-600">Tension zone</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={16} height={6}>
              <line
                x1={0}
                y1={3}
                x2={16}
                y2={3}
                stroke={graphOverlays.corridor.color}
                strokeWidth={3}
                opacity={0.5}
              />
            </svg>
            <span className="text-gray-600">Strategic corridor</span>
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

      {/* Edge dynamics */}
      <div>
        <p className="mb-1.5 font-semibold uppercase tracking-wider text-gray-400">
          Dynamics
        </p>
        <div className="space-y-1">
          {dynamicsLegendKeys.map((key) => {
            const ds = edgeDynamicsStyles[key];
            if (!ds) return null;
            return (
              <div key={key} className="flex items-center gap-2">
                <svg width={16} height={12}>
                  {/* Glow line */}
                  <line
                    x1={0}
                    y1={6}
                    x2={16}
                    y2={6}
                    stroke={ds.color}
                    strokeWidth={3}
                    opacity={ds.glowOpacity}
                  />
                  {/* Symbol dot */}
                  <circle cx={8} cy={6} r={4} fill={ds.color} opacity={0.9} />
                  <text
                    x={8}
                    y={6}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={5}
                    fontWeight={700}
                    fill="white"
                  >
                    {ds.symbol}
                  </text>
                </svg>
                <span className="text-gray-600">{ds.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
