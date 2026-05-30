"use client";

// ── DataLineageView (the base-unit data-flow / "Data Flow" view) ───
//
// Traces ONE base data unit from collection → transformation → realized
// outcome, across the layer stack. The lens nobody else provides:
//   • CausalMap                = causal graph (entities + causal edges)
//   • data_flow_cross_feature  = feature → feature flows (in the tech spec)
//   • THIS                     = the DATA-STATE lineage on the atomic unit —
//                                what we collect first, and what it becomes
//                                at each layer on the way to the outcome.
//
// Pure presentation. The parent composes `stages` from the layer stack's
// per-layer `variables` (the data state) + the layer transitions /
// data_flow_cross_feature (the transform labels). No new generation.
// Prototype — proposed 4th Goal-card view beside Overview/Blueprint/Map.

import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface LineageStage {
  ordinal: number;
  layerName: string;
  /** substrate | mechanism | process | outcome */
  archetype: string;
  /** The data state at this layer (the layer's variables). */
  dataItems: string[];
  /** True at the base layer — the raw collection point. */
  collected?: boolean;
  /** The mechanism that converts THIS layer's data into the next layer's. */
  transformInto?: string;
}

interface Props {
  /** The atomic unit we trace, e.g. "Attention". */
  baseUnit: string;
  /** Plain list of what's actually captured at the base, e.g. "searches, sites, time". */
  baseCollected: string;
  /** What the unit is ultimately realized as, e.g. "Money earned". */
  outcomeLabel: string;
  /** Layers in causal order (collection → outcome). */
  stages: LineageStage[];
}

const ACCENTS = ["#475569", "#0EA5E9", "#10B981", "#D97706", "#475569"];

function tint(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function DataLineageView({ baseUnit, baseCollected, outcomeLabel, stages }: Props) {
  const ordered = [...stages].sort((a, b) => a.ordinal - b.ordinal);

  return (
    <div
      className="flex flex-col gap-5 rounded-3xl px-7 py-6"
      style={{
        fontFamily: appleVibe.font.stack,
        background: "#FFFFFF",
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: "0 1px 2px rgba(11,18,40,0.04), 0 14px 36px -22px rgba(11,18,40,0.18)",
      }}
    >
      {/* The one-line story */}
      <div className="flex flex-col gap-1.5">
        <span
          className="text-[11px] font-semibold tracking-[0.02em]"
          style={{ color: "rgba(15,23,42,0.5)" }}
        >
          Data flow
        </span>
        <p className="text-[15.5px] leading-snug" style={{ color: appleVibe.text.primary }}>
          We collect{" "}
          <span className="font-semibold">{baseUnit}</span>
          <span style={{ color: appleVibe.text.tertiary }}> ({baseCollected})</span>
          {" "}and turn it, step by step, into{" "}
          <span className="font-semibold" style={{ color: "#16A34A" }}>{outcomeLabel}</span>.
        </p>
      </div>

      <div className="h-px w-full" style={{ background: appleVibe.stroke.hairline }} />

      {/* The lineage — collected at top, realized at bottom */}
      <div className="flex flex-col">
        {ordered.map((s, i) => {
          const accent = ACCENTS[i % ACCENTS.length];
          const isLast = i === ordered.length - 1;
          return (
            <div key={s.ordinal} className="flex flex-col">
              {/* stage card */}
              <div
                className="flex flex-col gap-2 rounded-2xl px-4 py-3"
                style={{
                  background: tint(accent, 0.07),
                  boxShadow: `0 6px 22px -8px ${tint(accent, 0.42)}, 0 1px 0 rgba(255,255,255,0.65) inset`,
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={{ background: tint(accent, 0.14), color: accent }}
                  >
                    {`L${s.ordinal}`} · {s.archetype}
                  </span>
                  <span className="text-[14px] font-semibold" style={{ color: appleVibe.text.primary }}>
                    {s.layerName}
                  </span>
                  {s.collected && (
                    <span
                      className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: tint(accent, 0.12), color: accent }}
                    >
                      ◉ collected here
                    </span>
                  )}
                  {isLast && (
                    <span
                      className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ background: tint("#16A34A", 0.12), color: "#16A34A" }}
                    >
                      ★ realized value
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px]" style={{ color: appleVibe.text.tertiary }}>
                    {s.collected ? "captures:" : isLast ? "becomes:" : "holds:"}
                  </span>
                  {s.dataItems.map((d, k) => (
                    <span
                      key={k}
                      className="rounded-lg px-2 py-0.5 text-[11.5px]"
                      style={{ background: "rgba(15,23,42,0.04)", color: appleVibe.text.secondary }}
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>

              {/* transform connector to the next layer */}
              {!isLast && (
                <div className="flex items-center gap-2 py-1.5 pl-4">
                  <span style={{ color: appleVibe.text.faint, fontSize: 14 }}>↓</span>
                  <span className="text-[11.5px]" style={{ color: appleVibe.text.tertiary }}>
                    transformed by{" "}
                    <span className="font-semibold" style={{ color: appleVibe.text.secondary }}>
                      {s.transformInto ?? "—"}
                    </span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
