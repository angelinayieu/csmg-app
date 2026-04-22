"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Target, ChevronDown } from "lucide-react";
import type { Entity } from "@/types";
import type { ProbabilitySpace, FailurePoint } from "@/types/probability-space";
import { useProbabilitySpaces } from "@/lib/hooks/use-probability-spaces";

export interface LabChamberProximityProps {
  spaceId: string;
  focal: Entity;
}

// ── Visual grammar ─────────────────────────────────────────────
// Without goal context: radial distance encodes probability-space risk
// (failures + weak pathways land outward; colored by quality tier; halo by
// worst blast radius).
// With goal context (Phase 2): radial distance encodes IMPACT on the
// active goal — edges that matter most to reaching the goal land closer
// to center. Halo still tracks blast radius, so the eye sees two axes:
// how much the relationship matters × how bad its failure would be.

const QUALITY_COLOR: Record<NonNullable<ProbabilitySpace["quality_tier"]>, string> = {
  verified: "#4ade80",
  estimated: "#22d3ee",
  speculative: "#a78bfa",
};

const BLAST_COLOR: Record<FailurePoint["blast_radius"], string> = {
  local: "#fbbf24",
  cascading: "#fb923c",
  systemic: "#ef4444",
};

const BLAST_RING_FRAC: Record<FailurePoint["blast_radius"], number> = {
  local: 0.32,
  cascading: 0.62,
  systemic: 0.92,
};

// Impact-mode zones (higher impact = closer to center → smaller radius frac).
const IMPACT_RING_FRAC = {
  high: 0.28,
  medium: 0.58,
  low: 0.9,
} as const;

interface Plot {
  space: ProbabilitySpace;
  counterpartyId: string;
  counterpartyName: string;
  angle: number;
  radiusFrac: number;
  worstBlast: FailurePoint["blast_radius"];
  color: string;
  importanceR: number;
  impactPct: number | null;
  impactDirect: boolean;
}

function chooseWorstBlast(fps: FailurePoint[]): FailurePoint["blast_radius"] | null {
  if (fps.length === 0) return null;
  if (fps.some((f) => f.blast_radius === "systemic")) return "systemic";
  if (fps.some((f) => f.blast_radius === "cascading")) return "cascading";
  return "local";
}

export function LabChamberProximity({ spaceId, focal }: LabChamberProximityProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [goalMenuOpen, setGoalMenuOpen] = useState(false);

  const { spaces, goalContext, loading, error, total } = useProbabilitySpaces({
    spaceId,
    focalEntityId: focal.id,
    goalId: selectedGoalId,
  });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setDims({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = dims.w;
  const H = dims.h;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.max(80, Math.min(W, H) / 2 - 48);

  // Impact mode activates when the API returned at least one goal-entity in
  // the active context. When true, every space should carry an `impact`
  // annotation; when false, we fall back to the blast-radius / pathway view.
  const impactMode =
    (goalContext?.active_goal_entity_ids.length ?? 0) > 0;

  const plots = useMemo<Plot[]>(() => {
    if (spaces.length === 0) return [];
    const items: Plot[] = [];
    const count = spaces.length;

    for (let i = 0; i < count; i++) {
      const space = spaces[i];
      const isSource = space.source_entity_id === focal.id;
      const counterpartyId = isSource ? space.target_entity_id : space.source_entity_id;
      const counterpartyName = isSource ? space.target_entity_name : space.source_entity_name;

      const worstBlast = chooseWorstBlast(space.failure_points);
      const quality = space.quality_tier ?? "estimated";
      const color = QUALITY_COLOR[quality];

      let radiusFrac: number;
      let impactPct: number | null = null;
      let impactDirect = false;

      if (impactMode && space.impact) {
        // Impact mode: closer to center = higher impact on goal.
        impactPct = Math.round(space.impact.impact_probability * 100);
        impactDirect = space.impact.direct;
        // Clamp so nothing collides with the focal glyph.
        const distance = 1 - space.impact.impact_probability;
        radiusFrac = Math.max(0.18, Math.min(0.95, distance));
      } else if (worstBlast) {
        radiusFrac = BLAST_RING_FRAC[worstBlast];
      } else {
        radiusFrac = Math.max(0.2, Math.min(0.9, 1 - (space.total_pathway_probability ?? 0.5)));
      }

      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const importanceR = Math.min(7, 3 + Math.sqrt(space.nodes.length));

      items.push({
        space,
        counterpartyId,
        counterpartyName,
        angle,
        radiusFrac,
        worstBlast: worstBlast ?? "local",
        color,
        importanceR,
        impactPct,
        impactDirect,
      });
    }
    return items;
  }, [spaces, focal.id, impactMode]);

  const hovered = hoverIdx !== null ? plots[hoverIdx] : null;

  const stats = useMemo(() => {
    let systemic = 0, cascading = 0, local = 0, fpCount = 0;
    let avgPath = 0;
    let avgImpact = 0;
    let directCount = 0;
    let impactSampleSize = 0;
    for (const s of spaces) {
      avgPath += s.total_pathway_probability ?? 0;
      if (s.impact) {
        avgImpact += s.impact.impact_probability;
        impactSampleSize++;
        if (s.impact.direct) directCount++;
      }
      for (const f of s.failure_points) {
        fpCount++;
        if (f.blast_radius === "systemic") systemic++;
        else if (f.blast_radius === "cascading") cascading++;
        else local++;
      }
    }
    return {
      fpCount,
      systemic,
      cascading,
      local,
      avgPath: spaces.length > 0 ? avgPath / spaces.length : 0,
      avgImpact: impactSampleSize > 0 ? avgImpact / impactSampleSize : 0,
      directCount,
    };
  }, [spaces]);

  const goalsWithEntity = goalContext?.available_goals.filter((g) => g.has_entity) ?? [];
  const activeGoalLabel = (() => {
    if (!goalContext) return "All goals";
    if (selectedGoalId) {
      return goalContext.available_goals.find((g) => g.id === selectedGoalId)?.title ?? "Unknown";
    }
    if (goalContext.active_goal_ids.length === 0) return "No goals defined";
    return `All goals (${goalContext.active_goal_ids.length})`;
  })();

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden bg-[var(--lab-bg)]"
    >
      {/* HUD — top-left */}
      <div className="pointer-events-none absolute left-5 top-5 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 flex gap-2.5">
          <span>CHAMBER</span>
          <b className="font-medium text-[var(--lab-text)]">REACTOR-01</b>
        </div>
        <div className="mb-1 flex gap-2.5">
          <span>FIELD</span>
          <b className="font-medium text-[var(--lab-text)]">
            {impactMode ? "IMPACT · GOAL" : "PROXIMITY"}
          </b>
        </div>
        <div className="flex gap-2.5">
          <span>SPACES</span>
          <b className="font-medium text-[var(--lab-text)]">
            {spaces.length}
            {total > spaces.length ? ` / ${total}` : ""}
          </b>
        </div>
      </div>

      {/* HUD — top-right: stats + goal selector */}
      <div className="absolute right-5 top-5 flex flex-col items-end gap-2 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        {impactMode ? (
          <div className="pointer-events-none text-right">
            <div className="text-[var(--lab-text-mid)]">
              ⟨IMPACT⟩ · <b className="text-[var(--lab-text)]">{(stats.avgImpact * 100).toFixed(0)}%</b>
            </div>
            <div className="mt-0.5 text-[var(--lab-text-mid)]">
              DIRECT · <b className="text-[var(--lab-accent)]">{stats.directCount}</b>
            </div>
            <div className="mt-0.5 text-[var(--lab-text-mid)]">
              FP · <b className="text-[var(--lab-text)]">{stats.fpCount}</b>
            </div>
          </div>
        ) : (
          <div className="pointer-events-none text-right">
            <div className="text-[var(--lab-text-mid)]">
              FAILURE POINTS · <b className="text-[var(--lab-text)]">{stats.fpCount}</b>
            </div>
            <div className="mt-1 flex justify-end gap-3">
              <span style={{ color: BLAST_COLOR.systemic }}>SYS {stats.systemic}</span>
              <span style={{ color: BLAST_COLOR.cascading }}>CAS {stats.cascading}</span>
              <span style={{ color: BLAST_COLOR.local }}>LOC {stats.local}</span>
            </div>
            <div className="mt-1 text-[var(--lab-text-mid)]">
              ⟨P⟩ · <b className="text-[var(--lab-text)]">{(stats.avgPath * 100).toFixed(0)}%</b>
            </div>
          </div>
        )}

        {/* Goal selector */}
        {goalsWithEntity.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setGoalMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-[3px] border border-[var(--lab-accent)] bg-[var(--lab-panel-bg)] px-2 py-1 text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--lab-accent)] transition-colors hover:border-[var(--lab-accent)]"
              title="Choose goal context for impact propagation"
            >
              <Target className="h-3 w-3" />
              <span className="max-w-[180px] truncate text-[var(--lab-text)] normal-case tracking-normal">
                {activeGoalLabel}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {goalMenuOpen && (
              <div className="absolute right-0 top-[30px] z-10 w-[240px] rounded-[3px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] py-1 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
                <GoalMenuItem
                  label={`All goals (${goalContext?.available_goals.filter((g) => g.has_entity).length ?? 0})`}
                  active={selectedGoalId === null}
                  onClick={() => {
                    setSelectedGoalId(null);
                    setGoalMenuOpen(false);
                  }}
                />
                {goalsWithEntity.map((g) => (
                  <GoalMenuItem
                    key={g.id}
                    label={g.title}
                    active={selectedGoalId === g.id}
                    onClick={() => {
                      setSelectedGoalId(g.id);
                      setGoalMenuOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend — bottom-left */}
      <div className="pointer-events-none absolute bottom-5 left-5 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 text-[var(--lab-text-mid)]">QUALITY</div>
        <div className="flex flex-col gap-0.5">
          <LegendDot color={QUALITY_COLOR.verified} label="VERIFIED" />
          <LegendDot color={QUALITY_COLOR.estimated} label="ESTIMATED" />
          <LegendDot color={QUALITY_COLOR.speculative} label="SPECULATIVE" />
        </div>
      </div>

      {/* Legend — bottom-right */}
      <div className="pointer-events-none absolute bottom-5 right-5 text-right text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 text-[var(--lab-text-mid)]">
          {impactMode ? "BLAST HALO" : "BLAST RADIUS"}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <LegendDot color={BLAST_COLOR.local} label="LOCAL" reverse />
          <LegendDot color={BLAST_COLOR.cascading} label="CASCADING" reverse />
          <LegendDot color={BLAST_COLOR.systemic} label="SYSTEMIC" reverse />
        </div>
      </div>

      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <radialGradient id="prox-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
            <stop offset="60%" stopColor="#4ade80" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Zone rings — labels switch between blast-radius and impact tiers */}
        {impactMode
          ? (["high", "medium", "low"] as const).map((k) => {
              const r = R * IMPACT_RING_FRAC[k];
              const color = k === "high" ? "#4ade80" : k === "medium" ? "#22d3ee" : "#64748b";
              return (
                <g key={`impact-ring-${k}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.14}
                    strokeWidth={0.8}
                    strokeDasharray="2 4"
                  />
                  <text
                    x={cx + r - 4}
                    y={cy - 4}
                    textAnchor="end"
                    fill={color}
                    fontSize="8"
                    fontFamily="monospace"
                    letterSpacing="0.14em"
                    opacity={0.6}
                  >
                    {k.toUpperCase()} IMPACT
                  </text>
                </g>
              );
            })
          : (["local", "cascading", "systemic"] as const).map((k) => {
              const r = R * BLAST_RING_FRAC[k];
              return (
                <g key={`ring-${k}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={BLAST_COLOR[k]}
                    strokeOpacity={0.14}
                    strokeWidth={0.8}
                    strokeDasharray="2 4"
                  />
                  <text
                    x={cx + r - 4}
                    y={cy - 4}
                    textAnchor="end"
                    fill={BLAST_COLOR[k]}
                    fontSize="8"
                    fontFamily="monospace"
                    letterSpacing="0.14em"
                    opacity={0.6}
                  >
                    {k.toUpperCase()}
                  </text>
                </g>
              );
            })}

        {/* Micro ring guides */}
        {[0.15, 0.46, 0.77].map((f) => (
          <circle
            key={`micro-${f}`}
            cx={cx}
            cy={cy}
            r={R * f}
            fill="none"
            stroke="#94a3b8"
            strokeOpacity={0.04}
            strokeWidth={0.5}
          />
        ))}

        {/* Central focal glow */}
        <circle cx={cx} cy={cy} r={R * 0.22} fill="url(#prox-core)" />

        {/* Focal node at center */}
        <g>
          <circle
            cx={cx}
            cy={cy}
            r={14}
            fill="#02050a"
            stroke="#4ade80"
            strokeWidth={1.5}
            style={{ filter: "drop-shadow(0 0 12px rgba(74,222,128,0.6))" }}
          />
          <circle cx={cx} cy={cy} r={4} fill="#4ade80" />
          <text
            x={cx}
            y={cy - 26}
            textAnchor="middle"
            fill="#e8edf4"
            fontSize="11"
            fontWeight="700"
            style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
          >
            {focal.name.length > 28 ? focal.name.slice(0, 28) + "…" : focal.name}
          </text>
          <text
            x={cx}
            y={cy + 30}
            textAnchor="middle"
            fill="#64748b"
            fontSize="9"
            fontFamily="monospace"
            letterSpacing="0.16em"
          >
            FOCAL
          </text>
        </g>

        {/* Plot dots */}
        {plots.map((p, i) => {
          const px = cx + Math.cos(p.angle) * R * p.radiusFrac;
          const py = cy + Math.sin(p.angle) * R * p.radiusFrac;
          const isHovered = hoverIdx === i;
          return (
            <g
              key={`plot-${p.space.id}`}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer" }}
            >
              <line
                x1={cx}
                y1={cy}
                x2={px}
                y2={py}
                stroke={p.color}
                strokeOpacity={isHovered ? 0.55 : p.impactDirect ? 0.3 : 0.14}
                strokeWidth={isHovered ? 1.4 : p.impactDirect ? 1 : 0.6}
                strokeDasharray={p.space.quality_tier === "speculative" ? "2 3" : undefined}
              />
              {p.space.failure_points.length > 0 && (
                <circle
                  cx={px}
                  cy={py}
                  r={p.importanceR + 5}
                  fill={BLAST_COLOR[p.worstBlast]}
                  fillOpacity={isHovered ? 0.25 : 0.12}
                />
              )}
              {p.impactDirect && (
                <circle
                  cx={px}
                  cy={py}
                  r={p.importanceR + 9}
                  fill="none"
                  stroke="#4ade80"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="1 2"
                />
              )}
              <circle
                cx={px}
                cy={py}
                r={p.importanceR}
                fill={p.color}
                stroke="#02050a"
                strokeWidth={1.2}
                style={{
                  filter: isHovered
                    ? `drop-shadow(0 0 8px ${p.color})`
                    : undefined,
                }}
              />
              <circle
                cx={px}
                cy={py}
                r={Math.max(12, p.importanceR + 6)}
                fill="transparent"
              />
            </g>
          );
        })}

        {/* Hover label */}
        {hovered && (() => {
          const px = cx + Math.cos(hovered.angle) * R * hovered.radiusFrac;
          const py = cy + Math.sin(hovered.angle) * R * hovered.radiusFrac;
          const labelOffset = hovered.radiusFrac > 0.55 ? -1 : 1;
          const lx = px + Math.cos(hovered.angle) * 16 * labelOffset;
          const ly = py + Math.sin(hovered.angle) * 16 * labelOffset;
          const align = hovered.angle > -Math.PI / 2 && hovered.angle < Math.PI / 2
            ? labelOffset > 0 ? "start" : "end"
            : labelOffset > 0 ? "end" : "start";
          const pathPct = (hovered.space.total_pathway_probability * 100).toFixed(0);
          return (
            <g pointerEvents="none">
              <text
                x={lx}
                y={ly - 6}
                textAnchor={align}
                fill="#e8edf4"
                fontSize="11"
                fontWeight="700"
                style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
              >
                {hovered.counterpartyName.length > 28
                  ? hovered.counterpartyName.slice(0, 28) + "…"
                  : hovered.counterpartyName}
              </text>
              <text
                x={lx}
                y={ly + 7}
                textAnchor={align}
                fill={hovered.color}
                fontSize="9"
                fontFamily="monospace"
                letterSpacing="0.14em"
                style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
              >
                {hovered.impactPct !== null
                  ? `IMPACT·${hovered.impactPct}% · P·${pathPct}%`
                  : `P·${pathPct}% · ${(hovered.space.quality_tier ?? "estimated").toUpperCase()}`}
              </text>
              {hovered.impactDirect && (
                <text
                  x={lx}
                  y={ly + 19}
                  textAnchor={align}
                  fill="#4ade80"
                  fontSize="9"
                  fontFamily="monospace"
                  letterSpacing="0.14em"
                  style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
                >
                  ⊕ TOUCHES GOAL
                </text>
              )}
              {hovered.space.failure_points.length > 0 && (
                <text
                  x={lx}
                  y={ly + (hovered.impactDirect ? 31 : 19)}
                  textAnchor={align}
                  fill={BLAST_COLOR[hovered.worstBlast]}
                  fontSize="9"
                  fontFamily="monospace"
                  letterSpacing="0.14em"
                  style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
                >
                  {hovered.space.failure_points.length} FP · {hovered.worstBlast.toUpperCase()}
                </text>
              )}
            </g>
          );
        })()}
      </svg>

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-[3px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)]/80 px-3 py-2 text-[11px] text-[var(--lab-accent)]/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Computing probability spaces…
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-[3px] border border-[var(--lab-danger)] bg-[var(--lab-panel-bg)] px-4 py-3 text-center text-[11px] text-[var(--lab-danger)]">
            {error}
          </div>
        </div>
      )}

      {!loading && !error && spaces.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-[3px] border border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] px-4 py-3 text-center text-[11px] text-[var(--lab-text-mid)]">
            No probability spaces touch this entity yet. Add edges or expand
            neighboring entities to populate this field.
          </div>
        </div>
      )}
    </div>
  );
}

function GoalMenuItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[10.5px] transition-colors hover:bg-[var(--lab-panel-raised)] ${
        active ? "text-[var(--lab-accent)]" : "text-[var(--lab-text-mid)]"
      }`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background: active ? "#4ade80" : "transparent",
          boxShadow: active ? "0 0 6px #4ade80" : undefined,
          border: active ? undefined : "1px solid #475569",
        }}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function LegendDot({
  color,
  label,
  reverse,
}: {
  color: string;
  label: string;
  reverse?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${reverse ? "flex-row-reverse" : ""}`}>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="text-[var(--lab-text-mid)]">{label}</span>
    </div>
  );
}
