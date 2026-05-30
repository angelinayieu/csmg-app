"use client";

// ── MacroChainSpine ───────────────────────────────────────────────
//
// Renders the cross-level chains from compute-macro-chain.ts as a
// readable data-flow spine — the system/subsystem interweaving:
//
//   MACRO problem → micro problem → mechanism → outcome → MACRO outcome
//
// Deliberately plain: left-to-right, one row per micro-problem, honest
// about partial wiring + how the macro-outcome roll-up was derived.

import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { MacroChain } from "@/lib/objective-canvas/compute-macro-chain";

const RED = "#DC2626"; // problems
const BLUE = "#2563EB"; // mechanisms
const GREEN = "#16A34A"; // outcomes
const SLATE = "#334155"; // macro bookends

function tint(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function Arrow() {
  return (
    <span style={{ color: appleVibe.text.faint, fontSize: 13, padding: "0 2px" }}>→</span>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="rounded-lg px-2 py-1 text-[12px] font-medium leading-tight"
      style={{ background: tint(color, 0.08), color: appleVibe.text.primary, border: `1px solid ${tint(color, 0.18)}` }}
    >
      {text}
    </span>
  );
}

export function MacroChainSpine({ chains }: { chains: MacroChain[] }) {
  return (
    <div className="flex flex-col gap-4" style={{ fontFamily: appleVibe.font.stack }}>
      {chains.map((chain) => (
        <div
          key={chain.macroProblem.id}
          className="flex flex-col gap-3 rounded-2xl px-5 py-4"
          style={{
            background: "#FFFFFF",
            border: `1px solid ${appleVibe.stroke.soft}`,
            boxShadow: "0 1px 2px rgba(11,18,40,0.04), 0 12px 30px -22px rgba(11,18,40,0.18)",
          }}
        >
          {/* bookends: macro problem → macro outcome */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: tint(SLATE, 0.08), color: SLATE }}>
              {`L${chain.macroProblem.layerOrdinal}`} · {chain.macroProblem.layerName}
            </span>
            <span className="text-[13.5px] font-semibold" style={{ color: appleVibe.text.primary }}>
              {chain.macroProblem.name}
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px]" style={{ color: appleVibe.text.tertiary }}>
              rolls up to
              <span style={{ color: appleVibe.text.faint }}>→</span>
              <span className="font-semibold" style={{ color: GREEN }}>{chain.macroOutcome.name}</span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: chain.macroOutcome.basis === "objective_edge" ? tint(GREEN, 0.1) : tint(SLATE, 0.07),
                  color: chain.macroOutcome.basis === "objective_edge" ? GREEN : appleVibe.text.tertiary,
                }}
                title={chain.macroOutcome.basis === "objective_edge" ? "Anchored by a real outcome→objective edge" : "Structural roll-up to the top layer (no direct edge)"}
              >
                {chain.macroOutcome.basis === "objective_edge" ? "linked" : "structural"}
              </span>
            </span>
          </div>

          {!chain.complete && (
            <span className="text-[11px] italic" style={{ color: appleVibe.text.faint }}>
              Partial — some of this macro-problem's rooms aren't fully wired (mechanism→outcome) yet.
            </span>
          )}

          <div className="h-px w-full" style={{ background: appleVibe.stroke.hairline }} />

          {/* per micro-problem: problem → mechanism → outcome */}
          <div className="flex flex-col gap-2.5">
            {chain.hops.map((hop) => (
              <div key={hop.microProblem.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: RED }} />
                  <Pill text={hop.microProblem.name} color={RED} />
                </div>
                {hop.mechanisms.length > 0 ? (
                  <div className="flex flex-col gap-1.5 pl-[18px]">
                    {hop.mechanisms.map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center gap-1.5">
                        <Arrow />
                        <Pill text={m.name} color={BLUE} />
                        {m.outcomes.length > 0 ? (
                          m.outcomes.map((o) => (
                            <span key={o.id} className="flex items-center gap-1.5">
                              <Arrow />
                              <Pill text={o.name} color={GREEN} />
                              <span className="text-[10.5px]" style={{ color: appleVibe.text.faint }}>
                                {Math.round(o.composite * 100)}%
                              </span>
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] italic" style={{ color: appleVibe.text.faint }}>
                            → (no outcome wired)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="pl-[18px] text-[11px] italic" style={{ color: appleVibe.text.faint }}>
                    → no mechanism wired to this problem yet
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
