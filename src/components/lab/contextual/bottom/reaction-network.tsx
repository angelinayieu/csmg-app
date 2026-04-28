"use client";

// ── Reaction Network (bottom-left) ───────────────────────────────
//
// 8 named reactions across the 4 components. Each renders as:
//   [β + δ → name + desc] [conditional probability %]
//
// Probabilities are conditioned on the current configuration's
// effective K vs task demand — when K > demand, throughput-style
// reactions get a small bump; when K << demand, they degrade.
// Same gap-modulation as the reference HTML (gap*0.08, capped).

import { COMPONENTS, REACTIONS } from "../lib/components-defs";
import type { Prediction } from "../lib/types";

export interface ReactionNetworkProps {
  prediction: Prediction;
}

export function ReactionNetwork({ prediction }: ReactionNetworkProps) {
  const gap = prediction.K - prediction.demand;
  const mod = 1 + Math.min(0.05, Math.max(-0.3, gap * 0.08));

  return (
    <div className="flex flex-col overflow-hidden bg-white p-3 px-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
          Reaction Network
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">
          {REACTIONS.length} pathways
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {REACTIONS.map((r) => {
          const finalProb = Math.max(
            0,
            Math.min(99, r.baseProb * mod * 100),
          );
          const tone =
            finalProb >= 80 ? "hi" : finalProb >= 60 ? "md" : "lo";
          const probColor =
            tone === "hi"
              ? "#34c759"
              : tone === "md"
                ? "#ff9500"
                : "#ff3b30";

          return (
            <div
              key={r.id}
              className="mb-0.5 grid items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[#f2f2f4]"
              style={{
                gridTemplateColumns: "auto 1fr auto",
              }}
              title={r.desc}
            >
              {/* Equation: badges + plus + arrow */}
              <div className="flex min-w-[92px] items-center gap-1">
                {r.inputs.map((id, idx) => {
                  const c = COMPONENTS.find((x) => x.id === id);
                  if (!c) return null;
                  return (
                    <span
                      key={`${r.id}-${id}-${idx}`}
                      className="flex items-center gap-1"
                    >
                      {idx > 0 && (
                        <span className="text-[10px] text-[#86868b]">+</span>
                      )}
                      <span
                        className="relative grid h-[20px] w-[20px] place-items-center rounded-[8px] text-[10px] font-bold leading-none"
                        style={{
                          background: `${c.color}20`,
                          color: c.color,
                        }}
                      >
                        {c.sym}
                        {c.sub && (
                          <span className="absolute -bottom-[1px] right-[2px] text-[6.5px] font-bold leading-none">
                            {c.sub}
                          </span>
                        )}
                      </span>
                    </span>
                  );
                })}
                <span className="ml-0.5 text-[11px] text-[#86868b]">→</span>
              </div>

              {/* Body */}
              <div className="min-w-0">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold tracking-[-0.01em] text-[#1d1d1f]">
                  {r.name}
                </div>
                <div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[#6e6e73]">
                  {r.desc}
                </div>
              </div>

              {/* Probability */}
              <div
                className="min-w-[40px] text-right text-[14px] font-bold tracking-[-0.02em] tabular-nums"
                style={{ color: probColor }}
              >
                {Math.round(finalProb)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
