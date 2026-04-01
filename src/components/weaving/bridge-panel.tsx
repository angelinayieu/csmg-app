import { SectionHeader } from "@/components/ui/section-header";
import type { Bridge, Space } from "@/types";

interface BridgePanelProps {
  bridges: Bridge[];
  spaces: Space[];
}

export function BridgePanel({ bridges, spaces }: BridgePanelProps) {
  if (bridges.length === 0) return null;

  const spaceMap = new Map(spaces.map((s) => [s.id, s]));

  return (
    <div>
      <SectionHeader label="Bridges" color="blue" />
      <div className="mt-2 space-y-1.5">
        {bridges.map((bridge) => {
          const targetSpace = spaceMap.get(bridge.target_space_id);
          return (
            <div
              key={bridge.id}
              className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 transition-colors hover:bg-interaxis-50/50 hover:border-interaxis-100"
            >
              <div className="flex items-center gap-1.5 text-xs">
                <svg
                  className="h-3 w-3 text-interaxis-500"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M2 6h8M7 3l3 3-3 3"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="font-medium text-interaxis-600 truncate">
                  {targetSpace?.name ?? "Unknown space"}
                </span>
              </div>
              <p className="mt-0.5 pl-[18px] text-[10px] text-gray-400 truncate">
                {bridge.shared_variable_name}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
