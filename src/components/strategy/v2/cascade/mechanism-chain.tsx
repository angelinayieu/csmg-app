"use client";

import Link from "next/link";
import { ChevronRight, CheckCircle2, Square, Layers, Target } from "lucide-react";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";

interface MechanismChainProps {
  chain: CausalChain;
  entityMap: Map<string, Entity>;
  spaceId: string;
  assetEntityIds: string[];
}

const ICON_BG: Record<string, string> = {
  concept: "#7C3AED",
  research: "#047857",
  deliverable: "var(--accent-600)",
  application: "#B45309",
  outcome: "#B91C1C",
  goal: "#0B0D12",
};

const STAGE_LABEL: Record<string, string> = {
  concept: "drivers",
  research: "validation",
  deliverable: "rules",
  application: "scope",
  outcome: "outcome",
  goal: "→ goal",
};

export function MechanismChain({
  chain,
  entityMap,
  spaceId,
  assetEntityIds,
}: MechanismChainProps) {
  const assets = assetEntityIds
    .map((id) => entityMap.get(id))
    .filter((x): x is Entity => !!x)
    .slice(0, 6);

  return (
    <div
      className="border-t mt-2"
      style={{
        borderColor: "rgba(11,13,18,0.08)",
        background: "rgba(247,248,250,0.6)",
        padding: "12px 14px 14px",
      }}
    >
      {/* Section header */}
      <div
        className="font-mono flex items-center gap-1.5 mb-2"
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: "rgba(11,13,18,0.34)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <Layers className="w-2.5 h-2.5" />
        Mechanism chain — what enables this outcome
      </div>

      {/* Chain stages */}
      <div className="flex flex-col relative">
        {chain.stages.map((stage, i) => {
          const bg = ICON_BG[stage.kind] ?? "#6B7280";
          const isLast = i === chain.stages.length - 1;
          return (
            <div
              key={i}
              className="grid items-center gap-2 py-1 relative"
              style={{
                gridTemplateColumns: "18px 1fr auto",
              }}
            >
              {/* Connector line */}
              {!isLast && (
                <span
                  className="absolute"
                  style={{
                    left: 8.5,
                    top: 24,
                    width: 1,
                    height: 10,
                    background: "rgba(11,13,18,0.2)",
                  }}
                />
              )}
              <div
                className="w-[18px] h-[18px] rounded flex items-center justify-center text-white flex-shrink-0"
                style={{ background: bg }}
              >
                {stage.kind === "research" ? (
                  <CheckCircle2 className="w-2 h-2" />
                ) : stage.kind === "goal" ? (
                  <Target className="w-2 h-2" />
                ) : (
                  <Square className="w-2 h-2" />
                )}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "#0B0D12",
                  fontWeight: 500,
                  lineHeight: 1.35,
                }}
              >
                {stage.title}
                {stage.meta && (
                  <span
                    className="block"
                    style={{
                      fontSize: 9,
                      color: "rgba(11,13,18,0.48)",
                      fontWeight: 500,
                      marginTop: 1,
                    }}
                  >
                    {stage.meta}
                  </span>
                )}
              </div>
              <div
                className="tabular-nums"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: stage.kind === "outcome" ? "#047857" : "#0B0D12",
                  letterSpacing: "-0.01em",
                }}
              >
                {stage.value_label ?? STAGE_LABEL[stage.kind]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Assets */}
      {assets.length > 0 && (
        <>
          <div
            className="font-mono flex items-center gap-1.5 mt-4 mb-2"
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "rgba(11,13,18,0.34)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Assets involved
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assets.map((e) => (
              <span
                key={e.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-semibold"
                style={{
                  background: "#fff",
                  border: "1px solid rgba(11,13,18,0.08)",
                  color: "rgba(11,13,18,0.74)",
                }}
                title={e.description ?? e.name}
              >
                {e.name}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Links */}
      <div
        className="flex flex-wrap gap-1.5 mt-3 pt-2.5"
        style={{ borderTop: "1px solid rgba(11,13,18,0.08)" }}
      >
        <Link
          href={`/app/space/${spaceId}/trace/${chain.id}`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
          style={{
            background: "#0B0D12",
            color: "#fff",
            border: "1px solid #0B0D12",
          }}
        >
          Reasoning trace
          <ChevronRight className="w-2 h-2" />
        </Link>
        <Link
          href={`/app/space/${spaceId}/graph`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-white transition-colors"
          style={{
            background: "#fff",
            border: "1px solid rgba(11,13,18,0.08)",
            color: "rgba(11,13,18,0.74)",
          }}
        >
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "#7C3AED" }} />
          Knowledge Graph
          <ChevronRight className="w-2 h-2" />
        </Link>
        <Link
          href={`/app/space/${spaceId}/convergence`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-white transition-colors"
          style={{
            background: "#fff",
            border: "1px solid rgba(11,13,18,0.08)",
            color: "rgba(11,13,18,0.74)",
          }}
        >
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "var(--accent-500)" }} />
          Convergence
          <ChevronRight className="w-2 h-2" />
        </Link>
        <Link
          href={`/app/space/${spaceId}/causal-chains`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold hover:bg-white transition-colors"
          style={{
            background: "#fff",
            border: "1px solid rgba(11,13,18,0.08)",
            color: "rgba(11,13,18,0.74)",
          }}
        >
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "#10B981" }} />
          Causal Chain
          <ChevronRight className="w-2 h-2" />
        </Link>
      </div>
    </div>
  );
}
