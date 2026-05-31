"use client";

// ── SubsystemModulesView ──────────────────────────────────────────
//
// The re-altitude'd room "Subsystems" tab. Each LEVER (mechanism) is a
// subsystem MODULE previewing its internal data-flow; modules are laid
// out left→right by token-flow depth and wired by DIRECTIONAL
// produces→consumes edges (the rigorous "how levers interlock" axis
// the causal-flow Map drops). Click a module to expand its full
// internal step-DAG via the existing MechanismDataflowView (no fork).
//
// Replaces the old MechanismSubsystemView (symmetric composes_with
// clusters): coupling answered "which levers co-belong?" (low value);
// this answers "how does each lever work, and how do their internal
// data-flows chain into each other + the problem/result variables?".

import { useMemo, useState } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { MechanismDataflowView } from "@/components/objective/mechanism-dataflow-view";
import type {
  SubsystemModulesModel,
  SubsystemModuleSpec,
} from "@/lib/objective-canvas/build-subsystem-modules";

interface Props {
  model: SubsystemModulesModel;
  /** Open the lever's full detail drawer (parity with the Map). */
  onOpenItem?: (id: string) => void;
}

const PAD = 32;
const COL_W = 288;
const CARD_W = 244;
const CARD_H = 132;
const ROW_GAP = 22;

function tint(hex: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(71,85,105, ${alpha})`;
}

function clip(s: string | null, n: number): string | null {
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function SubsystemModulesView({ model, onOpenItem }: Props) {
  const { modules, groups, wires, conflicts, externalInputTokens, specsById } = model;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groupColor = useMemo(() => {
    const m = new Map(groups.map((g) => [g.id, g.color]));
    return (id: string) => m.get(id) ?? appleVibe.stage.features;
  }, [groups]);
  const nameById = useMemo(
    () => new Map(modules.map((m) => [m.id, m.name])),
    [modules],
  );

  // ── Layout: column = token-flow depth, stack within column. ──
  const layout = useMemo(() => {
    const byDepth = new Map<number, SubsystemModuleSpec[]>();
    for (const m of modules) {
      const arr = byDepth.get(m.depth) ?? [];
      arr.push(m);
      byDepth.set(m.depth, arr);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    let maxDepth = 0;
    for (const [depth, mods] of byDepth) {
      maxDepth = Math.max(maxDepth, depth);
      maxRows = Math.max(maxRows, mods.length);
      mods
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((m, i) => {
          pos.set(m.id, {
            x: PAD + depth * COL_W,
            y: PAD + i * (CARD_H + ROW_GAP),
          });
        });
    }
    const width = PAD * 2 + (maxDepth + 1) * CARD_W + maxDepth * (COL_W - CARD_W);
    const height = PAD * 2 + Math.max(1, maxRows) * (CARD_H + ROW_GAP) - ROW_GAP;
    return { pos, width, height };
  }, [modules]);

  // ── Hover: light the module + its directly-wired neighbors. ──
  const activeSet = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const w of wires) {
      if (w.from === hoverId) set.add(w.to);
      if (w.to === hoverId) set.add(w.from);
    }
    return set;
  }, [hoverId, wires]);

  const rightAnchor = (id: string) => {
    const p = layout.pos.get(id);
    return p ? { x: p.x + CARD_W, y: p.y + CARD_H / 2 } : { x: 0, y: 0 };
  };
  const leftAnchor = (id: string) => {
    const p = layout.pos.get(id);
    return p ? { x: p.x, y: p.y + CARD_H / 2 } : { x: 0, y: 0 };
  };

  if (modules.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl px-6 py-16 text-center"
        style={{
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.soft}`,
          fontFamily: appleVibe.font.stack,
          color: appleVibe.text.tertiary,
        }}
      >
        No mechanisms in this room yet — add levers to see their subsystems.
      </div>
    );
  }

  const specCount = modules.filter((m) => m.hasSpec).length;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {specCount === 0 ? (
        <div
          className="mb-3 rounded-xl px-3.5 py-2.5 text-[12px]"
          style={{ background: appleVibe.surface.card, boxShadow: appleVibe.shadow.chip, color: appleVibe.text.secondary }}
        >
          No mechanism specs generated yet. Each lever shows as a module;
          generate a mechanism spec to reveal its internal data-flow and how
          it wires to the others.
        </div>
      ) : null}

      <div
        className="relative overflow-auto rounded-2xl"
        style={{
          maxWidth: "100%",
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.soft}`,
        }}
      >
        <div className="relative" style={{ width: layout.width, height: layout.height + PAD }}>
          {/* ── Directional token wires ── */}
          <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
            <defs>
              <marker id="ssm-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                <path d="M0,0 L7,3 L0,6 Z" fill={tint("#475569", 0.85)} />
              </marker>
            </defs>
            {wires.map((w, i) => {
              const a = rightAnchor(w.from);
              const b = leftAnchor(w.to);
              const dim = activeSet ? !(activeSet.has(w.from) && activeSet.has(w.to)) : false;
              const dx = Math.max(40, (b.x - a.x) / 2);
              const showLabel = hoverId === w.from || hoverId === w.to;
              return (
                <g key={`w${i}`} style={{ opacity: dim ? 0.08 : 0.5, transition: "opacity 160ms ease" }}>
                  <path
                    d={`M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - 7} ${b.y}`}
                    fill="none"
                    stroke={tint("#475569", 0.85)}
                    strokeWidth={1.6}
                    markerEnd="url(#ssm-arrow)"
                  />
                  {showLabel ? (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 5}
                      textAnchor="middle"
                      fontSize="9.5"
                      fill={appleVibe.text.tertiary}
                    >
                      {w.tokens.slice(0, 2).join(", ")}
                      {w.tokens.length > 2 ? ` +${w.tokens.length - 2}` : ""}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/* ── Module cards ── */}
          {modules.map((m) => {
            const p = layout.pos.get(m.id);
            if (!p) return null;
            const accent = groupColor(m.subsystem);
            const faded = activeSet ? !activeSet.has(m.id) : false;
            const focused = hoverId === m.id;
            return (
              <div
                key={m.id}
                onMouseEnter={() => setHoverId(m.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => (m.hasSpec ? setExpandedId(expandedId === m.id ? null : m.id) : onOpenItem?.(m.id))}
                className="absolute flex cursor-pointer flex-col gap-1.5 rounded-2xl px-3.5 py-3"
                style={{
                  left: p.x,
                  top: p.y,
                  width: CARD_W,
                  height: CARD_H,
                  background: "rgba(255,255,255,0.8)",
                  backdropFilter: "blur(14px) saturate(140%)",
                  WebkitBackdropFilter: "blur(14px) saturate(140%)",
                  border: `1px solid ${focused || expandedId === m.id ? tint(accent, 0.5) : appleVibe.stroke.hairline}`,
                  boxShadow:
                    focused || expandedId === m.id
                      ? `0 1px 0 rgba(255,255,255,0.7) inset, 0 14px 34px -14px rgba(11,18,40,0.26), 0 0 22px -6px ${tint(accent, 0.45)}`
                      : `0 1px 0 rgba(255,255,255,0.7) inset, 0 8px 22px -14px rgba(11,18,40,0.22), 0 0 0 1px ${tint(accent, 0.05)}`,
                  opacity: faded ? 0.4 : 1,
                  transition: "opacity 160ms ease, box-shadow 180ms ease, border-color 180ms ease",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
                    style={{ background: accent, boxShadow: `0 0 0 3px ${tint(accent, 0.14)}` }}
                  />
                  <span className="truncate text-[12.5px] font-semibold leading-tight" style={{ color: appleVibe.text.primary }}>
                    {m.name}
                  </span>
                </div>

                {m.hasSpec ? (
                  <>
                    {m.mechanismOfAction ? (
                      <span className="text-[10px] leading-snug" style={{ color: appleVibe.text.tertiary }}>
                        {clip(m.mechanismOfAction, 84)}
                      </span>
                    ) : null}
                    <div className="mt-auto flex items-center gap-1.5 text-[9.5px]" style={{ color: appleVibe.text.secondary }}>
                      <span title="logic-model inputs">{m.inputs.length} in</span>
                      <span style={{ color: appleVibe.text.tertiary }}>›</span>
                      <span title="runtime steps">{m.stepCount} step{m.stepCount === 1 ? "" : "s"}</span>
                      <span style={{ color: appleVibe.text.tertiary }}>›</span>
                      <span className="truncate" title={m.outcome ?? ""}>{clip(m.outcome, 26) ?? "output"}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {m.consumes.slice(0, 2).map((t) => (
                        <span key={`c-${t}`} className="rounded-md px-1.5 py-0.5 text-[8.5px]" style={{ background: tint("#475569", 0.08), color: appleVibe.text.secondary }}>
                          ↳ {t}
                        </span>
                      ))}
                      {m.produces.slice(0, 2).map((t) => (
                        <span key={`p-${t}`} className="rounded-md px-1.5 py-0.5 text-[8.5px]" style={{ background: tint(accent, 0.1), color: appleVibe.text.secondary }}>
                          {t} ↦
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-auto flex flex-col gap-1">
                    <span className="text-[10px] italic leading-snug" style={{ color: appleVibe.text.tertiary }}>
                      Mechanism spec not generated yet.
                    </span>
                    <span className="text-[9px]" style={{ color: appleVibe.text.tertiary }}>
                      Click to open and generate it →
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Expanded internal data-flow (reuses MechanismDataflowView) ── */}
      {expandedId && specsById[expandedId] ? (
        <div
          className="mt-3 rounded-2xl p-3"
          style={{ background: appleVibe.surface.card, boxShadow: appleVibe.shadow.chip }}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[12.5px] font-semibold" style={{ color: appleVibe.text.primary }}>
              {nameById.get(expandedId)} — internal data flow
            </span>
            <div className="flex items-center gap-2">
              {onOpenItem ? (
                <button
                  onClick={() => onOpenItem(expandedId)}
                  className="rounded-lg px-2 py-1 text-[10.5px]"
                  style={{ color: appleVibe.text.secondary, border: `1px solid ${appleVibe.stroke.hairline}` }}
                >
                  Open full detail
                </button>
              ) : null}
              <button
                onClick={() => setExpandedId(null)}
                className="rounded-lg px-2 py-1 text-[10.5px]"
                style={{ color: appleVibe.text.secondary, border: `1px solid ${appleVibe.stroke.hairline}` }}
              >
                Close
              </button>
            </div>
          </div>
          <MechanismDataflowView spec={specsById[expandedId]} />
        </div>
      ) : null}

      {/* ── Legend + summary ── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px]" style={{ color: appleVibe.text.secondary }}>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={tint("#475569", 0.85)} strokeWidth="1.6" markerEnd="url(#ssm-arrow)" /></svg>
          data flows (produces → consumes)
        </span>
        {conflicts.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: "#DC2626" }}>!</span>
            conflict
          </span>
        ) : null}
        <span style={{ color: appleVibe.text.tertiary }}>
          {modules.length} levers · {wires.length} handoff{wires.length === 1 ? "" : "s"}
          {externalInputTokens.length > 0 ? ` · ${externalInputTokens.length} external input${externalInputTokens.length === 1 ? "" : "s"}` : ""}
        </span>
        <span style={{ color: appleVibe.text.tertiary }}>Click a module to open its internal data-flow.</span>
      </div>

      {/* ── Conflict strip (interferes_with) ── */}
      {conflicts.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {conflicts.map((c, i) => (
            <div key={`cf${i}`} className="flex items-start gap-3 rounded-xl px-3.5 py-2.5" style={{ background: "rgba(220,38,38,0.06)", boxShadow: appleVibe.shadow.chip }}>
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#DC2626" }}>!</span>
              <span className="text-[11.5px]" style={{ color: "#991B1B" }}>
                <strong>{nameById.get(c.a) ?? c.a}</strong> conflicts with{" "}
                <strong>{nameById.get(c.b) ?? c.b}</strong>
                {c.rationale ? ` — ${c.rationale}` : " — resolve the tension before shipping both"}.
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
