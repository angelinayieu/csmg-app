import { StatusBadge } from "@/components/ui/status-badge";
import type { WeaveBridge } from "@/types/weave";

const typeColors: Record<string, { bg: string; text: string; border: string }> = {
  identity: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  influence: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  structural: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
};

export function SharedVariableCard({ bridge }: { bridge: WeaveBridge }) {
  const colors = typeColors[bridge.bridge_type] ?? typeColors.identity;

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge
            variant={
              bridge.bridge_type === "identity"
                ? "stated"
                : bridge.bridge_type === "influence"
                  ? "inferred"
                  : "predicted"
            }
          >
            {bridge.bridge_type}
          </StatusBadge>
          <StatusBadge
            variant={
              bridge.coupling_strength === "strong"
                ? "strong"
                : bridge.coupling_strength === "moderate"
                  ? "moderate"
                  : "speculative"
            }
          >
            {bridge.coupling_strength}
          </StatusBadge>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-sm">
        <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs font-semibold text-gray-700">
          {bridge.source_entity_id}
        </span>
        <span className="text-gray-500 truncate">{bridge.source_entity_name}</span>
        <svg className="h-3 w-4 flex-shrink-0 text-gray-400" viewBox="0 0 16 12" fill="none">
          <path d="M1 6h14M11 1l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs font-semibold text-gray-700">
          {bridge.target_entity_id}
        </span>
        <span className="text-gray-500 truncate">{bridge.target_entity_name}</span>
      </div>

      <div className="mt-1.5 text-xs font-medium text-gray-600">
        Shared: {bridge.shared_variable_name}
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
        {bridge.description}
      </p>
    </div>
  );
}
