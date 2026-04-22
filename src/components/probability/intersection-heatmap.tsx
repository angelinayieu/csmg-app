"use client";

// ── Probability intersection heatmap ───────────────────────────────────
//
// Square matrix of probability spaces × probability spaces. Each cell is
// coloured by the intersection impact between the two spaces. Darker =
// higher impact × novelty. Click any cell to open the detail panel.
//
// Pure SVG — d3 is already installed but the entire math is one linear
// scale and one color map, so importing the runtime would be overkill.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Grid3x3 } from "lucide-react";
import type {
  ProbabilitySpace,
  SpaceIntersection,
} from "@/types/probability-space";
import { VizContainer } from "@/components/viz/viz-container";
import { DataStateLayer } from "@/components/viz/data-state";
import { sequentialColor, CHART } from "@/components/viz/chart-theme";

interface Props {
  spaces: ProbabilitySpace[];
  intersections: SpaceIntersection[];
}

interface CellMeta {
  intersection: SpaceIntersection;
  score: number; // combined impact * novelty
}

// Truncate a long edge label for axis ticks.
function shortLabel(s: string, max = 22): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function spaceLabel(s: ProbabilitySpace): string {
  return `${s.source_entity_name} → ${s.target_entity_name}`;
}

const INNOV_BADGE: Record<
  SpaceIntersection["innovation_potential"],
  { color: string; label: string }
> = {
  high: { color: "#059669", label: "High innovation" },
  medium: { color: "#D97706", label: "Medium innovation" },
  low: { color: "#9CA3AF", label: "Low innovation" },
};

export function IntersectionHeatmap({ spaces, intersections }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ row: number; col: number; x: number; y: number } | null>(
    null,
  );

  // Build the cell lookup keyed by the unordered pair {a, b}.
  const cellByPair = useMemo(() => {
    const map = new Map<string, CellMeta>();
    for (const i of intersections) {
      // Combine impact + novelty into one score so the heatmap reads as
      // "which pairs matter and are unusual at the same time."
      const score = 0.6 * i.impact_score + 0.4 * i.novelty_score;
      const key = [i.space_a_id, i.space_b_id].sort().join("::");
      // Keep the higher-scoring duplicate if there are any.
      const existing = map.get(key);
      if (!existing || score > existing.score) {
        map.set(key, { intersection: i, score });
      }
    }
    return map;
  }, [intersections]);

  const spaceIdIndex = useMemo(() => {
    const map = new Map<string, number>();
    spaces.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [spaces]);

  // Layout — responsive but capped so the cells don't get microscopic.
  const n = spaces.length;
  const MAX_CELL = 28;
  const MIN_CELL = 12;
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(520 / Math.max(1, n))));
  const LABEL_W = 180;
  const LABEL_H = 120;
  const gridSize = cell * n;
  const width = LABEL_W + gridSize + 20;
  const height = LABEL_H + gridSize + 20;

  const selectedIntersection = selectedId
    ? intersections.find((i) => i.id === selectedId) ?? null
    : null;

  const getCell = (r: number, c: number): CellMeta | null => {
    if (r === c) return null;
    const aId = spaces[r].id;
    const bId = spaces[c].id;
    const key = [aId, bId].sort().join("::");
    return cellByPair.get(key) ?? null;
  };

  return (
    <VizContainer
      icon={Grid3x3}
      title="Probability intersections"
      subtitle={
        spaces.length === 0
          ? "Probability spaces populate after a deep analysis run."
          : `${spaces.length} space${spaces.length === 1 ? "" : "s"} · ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} — darker cells = higher impact × novelty.`
      }
      minBodyHeight={360}
    >
      <DataStateLayer
        empty={spaces.length === 0}
        emptyHint="No probability spaces yet. They materialize during synthesis + strategy refresh."
      >
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative">
            <svg width={width} height={height} role="img" aria-label="Intersection heatmap">
              {/* Column labels — rotated so long edge labels don't overlap. */}
              {spaces.map((s, c) => (
                <text
                  key={`col-${s.id}`}
                  x={LABEL_W + c * cell + cell / 2}
                  y={LABEL_H - 6}
                  transform={`rotate(-55 ${LABEL_W + c * cell + cell / 2} ${LABEL_H - 6})`}
                  textAnchor="end"
                  fontSize={9.5}
                  fill={CHART.font.label.color}
                  fontWeight={500}
                >
                  {shortLabel(spaceLabel(s))}
                </text>
              ))}

              {/* Row labels */}
              {spaces.map((s, r) => (
                <text
                  key={`row-${s.id}`}
                  x={LABEL_W - 8}
                  y={LABEL_H + r * cell + cell / 2 + 3}
                  textAnchor="end"
                  fontSize={9.5}
                  fill={CHART.font.label.color}
                  fontWeight={500}
                >
                  {shortLabel(spaceLabel(s))}
                </text>
              ))}

              {/* Cells */}
              {spaces.map((sa, r) =>
                spaces.map((sb, c) => {
                  const meta = getCell(r, c);
                  const isDiag = r === c;
                  const x = LABEL_W + c * cell;
                  const y = LABEL_H + r * cell;
                  if (isDiag) {
                    return (
                      <rect
                        key={`cell-${r}-${c}`}
                        x={x + 1}
                        y={y + 1}
                        width={cell - 2}
                        height={cell - 2}
                        fill="#F3F4F6"
                        stroke="#E5E7EB"
                        strokeWidth={0.5}
                      />
                    );
                  }
                  const fill = meta
                    ? sequentialColor(meta.score)
                    : "rgba(0,0,0,0.025)";
                  const selected =
                    meta && selectedId === meta.intersection.id;
                  // Diagonal-wave stagger: delay grows along r+c so the
                  // heatmap materializes from top-left to bottom-right.
                  const wave = Math.min(r + c, 24) * 0.012;
                  return (
                    <motion.rect
                      key={`cell-${r}-${c}`}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.3,
                        delay: wave,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      x={x + 1}
                      y={y + 1}
                      width={cell - 2}
                      height={cell - 2}
                      fill={fill}
                      stroke={selected ? CHART.color.primary[600] : "transparent"}
                      strokeWidth={selected ? 2 : 0}
                      rx={2}
                      style={{
                        cursor: meta ? "pointer" : "default",
                        transformBox: "fill-box",
                        transformOrigin: "center",
                      }}
                      onMouseEnter={() =>
                        meta && setHover({ row: r, col: c, x, y })
                      }
                      onMouseLeave={() => setHover(null)}
                      onClick={() =>
                        meta && setSelectedId(meta.intersection.id)
                      }
                    >
                      {meta && (
                        <title>
                          {`${shortLabel(spaceLabel(sa))} × ${shortLabel(spaceLabel(sb))}\nImpact ${Math.round(meta.intersection.impact_score * 100)}% · Novelty ${Math.round(meta.intersection.novelty_score * 100)}% · ${meta.intersection.innovation_potential}`}
                        </title>
                      )}
                    </motion.rect>
                  );
                }),
              )}

              {/* Hover highlight ring */}
              {hover && (
                <rect
                  x={hover.x}
                  y={hover.y}
                  width={cell}
                  height={cell}
                  fill="none"
                  stroke={CHART.color.primary[500]}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />
              )}
            </svg>

            {/* Legend */}
            <div className="mt-3 flex items-center gap-3 text-[10px] text-gray-500">
              <span>Impact × Novelty</span>
              <div className="flex items-center gap-[2px]">
                {CHART.sequential.map((c, i) => (
                  <span
                    key={i}
                    className="h-3 w-4 ring-1 ring-black/5"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <span className="text-gray-400">low → high</span>
              <span className="mx-2 h-3 w-px bg-gray-200" />
              <span>Innovation:</span>
              {(["high", "medium", "low"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: INNOV_BADGE[k].color }}
                  />
                  {k}
                </span>
              ))}
            </div>
          </div>

          {/* Detail panel — slot to the right on wide screens, below on narrow. */}
          <aside className="flex-1 min-w-[240px] rounded-lg bg-white/60 ring-1 ring-black/5 p-3">
            {selectedIntersection ? (
              <IntersectionDetail
                intersection={selectedIntersection}
                spaces={spaces}
                spaceIdIndex={spaceIdIndex}
              />
            ) : (
              <div className="text-[11px] text-gray-400 italic">
                Click a heatmap cell to inspect the intersection between two
                probability spaces.
              </div>
            )}
          </aside>
        </div>
      </DataStateLayer>
    </VizContainer>
  );
}

function IntersectionDetail({
  intersection,
  spaces,
  spaceIdIndex,
}: {
  intersection: SpaceIntersection;
  spaces: ProbabilitySpace[];
  spaceIdIndex: Map<string, number>;
}) {
  const innov = INNOV_BADGE[intersection.innovation_potential];
  const aIdx = spaceIdIndex.get(intersection.space_a_id);
  const bIdx = spaceIdIndex.get(intersection.space_b_id);
  const spaceA = aIdx != null ? spaces[aIdx] : null;
  const spaceB = bIdx != null ? spaces[bIdx] : null;

  return (
    <div className="space-y-2">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
            Intersection
          </p>
          <p className="text-[12px] font-semibold text-gray-900 leading-tight">
            {intersection.space_a_label}
          </p>
          <p className="text-[10px] text-gray-400 leading-tight">
            ×
          </p>
          <p className="text-[12px] font-semibold text-gray-900 leading-tight">
            {intersection.space_b_label}
          </p>
        </div>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
          style={{ background: `${innov.color}14`, color: innov.color }}
        >
          {innov.label}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Impact" value={`${Math.round(intersection.impact_score * 100)}%`} />
        <Stat label="Novelty" value={`${Math.round(intersection.novelty_score * 100)}%`} />
      </div>

      {intersection.insight ? (
        <p className="text-[11.5px] text-gray-700 leading-relaxed">
          {intersection.insight}
        </p>
      ) : null}

      {intersection.shared_nodes.length > 0 ? (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
            Shared nodes ({intersection.shared_nodes.length})
          </p>
          <ul className="space-y-1">
            {intersection.shared_nodes.slice(0, 6).map((n, i) => (
              <li
                key={`${n.node_a_id}-${i}`}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="truncate text-gray-700">{n.name}</span>
                <span className="text-[9.5px] text-gray-400 tabular-nums">
                  {Math.round(n.similarity * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(spaceA?.critical_path || spaceB?.critical_path) && (
        <div className="text-[10px] text-gray-400">
          Pathway probability:{" "}
          {spaceA
            ? `${Math.round(spaceA.total_pathway_probability * 100)}%`
            : "—"}{" "}
          ×{" "}
          {spaceB
            ? `${Math.round(spaceB.total_pathway_probability * 100)}%`
            : "—"}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="text-[13px] font-mono text-gray-800 tabular-nums">{value}</p>
    </div>
  );
}
