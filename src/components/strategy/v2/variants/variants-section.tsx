"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { VariantCard } from "./variant-card";
import { VariantDetail } from "./variant-detail";
import type { VariantVM } from "../strategy-view-model";
import type { Entity } from "@/types";
import type { CausalChain } from "@/types/causal-chains";

interface VariantsSectionProps {
  variants: VariantVM[];
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  isConfirmed: boolean;
  loading: boolean;
  onConfirm: () => void;
  onSelectAlternative: (rank: number) => void;
  onRegenerate: () => void;
}

export function VariantsSection({
  variants,
  causalChains,
  entityMap,
  spaceId,
  isConfirmed,
  loading,
  onConfirm,
  onSelectAlternative,
  onRegenerate,
}: VariantsSectionProps) {
  const [activeRank, setActiveRank] = useState<number>(() => variants[0]?.rank ?? 1);
  const activeVariant = variants.find((v) => v.rank === activeRank) ?? variants[0];

  if (!activeVariant) {
    return (
      <div
        className="rounded-[14px] p-8 text-center"
        style={{
          background: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(11,13,18,0.14)",
        }}
      >
        <p style={{ fontSize: 13, color: "rgba(11,13,18,0.48)" }}>
          No strategy variants yet. Generate strategy to see ranked alternatives.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            fontSize: 11,
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <Sparkles className="w-2.5 h-2.5" style={{ color: "rgba(11,13,18,0.48)" }} />
          Strategy Variants
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 500,
          }}
        >
          {variants.length} variant{variants.length === 1 ? "" : "s"} synthesized from cascades · click to expand full decomposition · approve one to launch
        </span>
      </div>

      {/* Frosted container */}
      <div
        className="p-5 rounded-[14px]"
        style={{
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(11,13,18,0.14)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        <p
          className="mb-3.5 max-w-[760px]"
          style={{
            fontSize: 12,
            color: "rgba(11,13,18,0.74)",
            lineHeight: 1.5,
          }}
        >
          <b className="font-bold text-gray-900">Variant {String.fromCharCode(64 + activeRank)} is pre-selected</b> — click any variant below to swap and see its complete decomposition:
          drivers → rules → actions → outcomes → proxies. Every node is editable before approval.
        </p>

        {/* Cards grid */}
        <div
          className="grid gap-2.5 mb-3.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(3, variants.length)}, 1fr)` }}
        >
          {variants.map((v) => (
            <VariantCard
              key={v.rank}
              variant={v}
              active={v.rank === activeRank}
              onClick={() => setActiveRank(v.rank)}
            />
          ))}
        </div>

        {/* Expanded detail */}
        <VariantDetail
          variant={activeVariant}
          causalChains={causalChains}
          entityMap={entityMap}
          spaceId={spaceId}
          isConfirmed={isConfirmed && activeVariant.crown}
          loading={loading}
          onApprove={() => {
            if (activeVariant.crown) onConfirm();
            else onSelectAlternative(activeVariant.rank);
          }}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}
