"use client";

// ── MacroSummaryCard (the "Overview" face) ────────────────────────
//
// The concise, professional overview that pairs with the detailed
// cards/layers via a toggle (Overview ⇄ Blueprint) — never both at once,
// so it isn't a duplicate and it doesn't add cognitive load.
//
// Deliberately near-monochrome and bullet-tight: the GOAL stated once,
// then the causal path as numbered steps, each with a plain gloss and its
// 2-3 macro problems as plain bullets. Solutions live in the detailed
// cards (the other toggle face), not re-listed here.

import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface MacroSubProblem {
  name: string;
  description?: string;
}

export interface MacroSummaryLayer {
  ordinal: number;
  name: string;
  /** Plain-language one-liner — what this step IS, no jargon. */
  gloss: string;
  /** Solution names (rendered in the detailed face, not here). */
  subObjectives?: string[];
  macroProblems: MacroSubProblem[];
}

interface Props {
  distilledObjective: string;
  layers: MacroSummaryLayer[];
}

const INK = appleVibe.text.primary;
// One restrained accent for the step index — monochrome slate, no rainbow.
const STEP_INK = "#334155";

const label = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: "rgba(15,23,42,0.5)",
} as const;

export function MacroSummaryCard({ distilledObjective, layers }: Props) {
  const ordered = [...layers].sort((a, b) => a.ordinal - b.ordinal);

  return (
    <div
      className="flex flex-col gap-7 rounded-2xl px-8 py-7"
      style={{
        fontFamily: appleVibe.font.stack,
        background: "#FFFFFF",
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: "0 1px 2px rgba(11,18,40,0.04), 0 12px 32px -20px rgba(11,18,40,0.16)",
      }}
    >
      {/* Goal — stated once */}
      <div className="flex flex-col gap-2">
        <span style={label}>The goal</span>
        <p
          className="text-[18px] font-semibold leading-snug"
          style={{ color: INK, letterSpacing: "-0.012em", maxWidth: "58ch" }}
        >
          {distilledObjective}
        </p>
      </div>

      <div className="h-px w-full" style={{ background: appleVibe.stroke.hairline }} />

      {/* The path — numbered causal steps, concise */}
      <div className="flex flex-col gap-5">
        <span style={label}>The path</span>

        {ordered.map((layer, i) => (
          <div key={layer.ordinal} className="flex gap-4">
            <span
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums"
              style={{ background: "rgba(51,65,85,0.07)", color: STEP_INK }}
            >
              {i + 1}
            </span>

            <div className="flex flex-1 flex-col gap-1.5">
              {/* name · plain gloss, on one line */}
              <p className="text-[14px] leading-snug">
                <span className="font-semibold" style={{ color: INK }}>
                  {layer.name}
                </span>
                <span style={{ color: appleVibe.text.tertiary }}>
                  {"  ·  "}
                  {layer.gloss}
                </span>
              </p>

              {/* problems — plain bullets, monochrome */}
              {layer.macroProblems.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {layer.macroProblems.map((mp, k) => (
                    <li key={k} className="flex items-start gap-2">
                      <span
                        className="mt-[8px] h-[3px] w-[3px] flex-shrink-0 rounded-full"
                        style={{ background: "rgba(15,23,42,0.35)" }}
                      />
                      <span className="text-[13px] leading-snug" style={{ color: appleVibe.text.secondary }}>
                        {mp.name}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[12px]" style={{ color: appleVibe.text.faint }}>
                  Not mapped yet — this step's rooms aren't built.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
