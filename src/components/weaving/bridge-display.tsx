import { SectionHeader } from "@/components/ui/section-header";
import { SharedVariableCard } from "./shared-variable-card";
import { ContradictionAlert } from "./contradiction-alert";
import type { WeaveBridge, WeaveContradiction } from "@/types/weave";

interface BridgeDisplayProps {
  bridges: WeaveBridge[];
  contradictions: WeaveContradiction[];
  bridgesSaved: number;
}

export function BridgeDisplay({
  bridges,
  contradictions,
  bridgesSaved,
}: BridgeDisplayProps) {
  if (bridges.length === 0 && contradictions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center">
        <p className="text-sm text-gray-500">
          No shared variables or contradictions found between these spaces.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bridges */}
      {bridges.length > 0 && (
        <div>
          <SectionHeader
            label="Discovered Bridges"
            color="green"
            subtitle={`${bridgesSaved} saved`}
          />
          <div className="mt-3 space-y-2">
            {bridges.map((bridge, i) => (
              <SharedVariableCard key={i} bridge={bridge} />
            ))}
          </div>
        </div>
      )}

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <div>
          <SectionHeader label="Contradictions" color="amber" />
          <div className="mt-3 space-y-2">
            {contradictions.map((c, i) => (
              <ContradictionAlert key={i} contradiction={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
