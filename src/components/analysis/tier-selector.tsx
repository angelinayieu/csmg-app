"use client";

import { cn } from "@/lib/utils";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { TierIcons } from "@/components/ui/tier-icons";

interface TierSelectorProps {
  selected: AnalysisTier;
  onSelect: (tier: AnalysisTier) => void;
  creditBalance: number;
}

const tierOrder: AnalysisTier[] = ["quick", "standard", "deep", "comprehensive"];

export function TierSelector({
  selected,
  onSelect,
  creditBalance,
}: TierSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {tierOrder.map((tierId) => {
        const tier = TIERS[tierId];
        const canAfford = creditBalance >= tier.credits;
        const isSelected = selected === tierId;

        return (
          <button
            key={tierId}
            onClick={() => canAfford && onSelect(tierId)}
            disabled={!canAfford}
            className={cn(
              "rounded-xl border p-3 text-left transition-all duration-200",
              isSelected
                ? "border-interaxis-400 bg-interaxis-50/60 ring-1 ring-interaxis-300"
                : canAfford
                  ? "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                  : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-50"
            )}
          >
            <div className="flex items-center justify-between">
              {(() => {
                const IconComponent = TierIcons[tierId];
                return IconComponent ? <IconComponent size={28} active={isSelected} /> : <span className="text-base">{tier.icon}</span>;
              })()}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  isSelected
                    ? "bg-interaxis-100 text-interaxis-700"
                    : "bg-gray-100 text-gray-500"
                )}
              >
                {tier.credits} {tier.credits === 1 ? "credit" : "credits"}
              </span>
            </div>
            <div className="mt-1.5">
              <div
                className={cn(
                  "text-sm font-semibold",
                  isSelected ? "text-interaxis-700" : "text-gray-800"
                )}
              >
                {tier.label}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                {tier.time}
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-tight text-gray-400">
              {tier.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
