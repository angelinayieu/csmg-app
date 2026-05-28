"use client";

// ── MapInsightsPanel ──────────────────────────────────────────────
//
// Phase 12.A. A compact, readable synthesis of the canvas map's signal,
// shown beneath the map (canvas altitude). Where the map's in-canvas
// chrome is interactive (hover a loop, click a band), this panel is the
// at-a-glance READ: what's structurally missing, what's compounding,
// how healthy the work is, and which rooms are most entangled — plus a
// single headline recommendation.
//
// Self-contained: it rebuilds the graph + re-detects loops from the same
// props the map uses, so it never disagrees with what's rendered. Lives
// outside the map component so it composes with whatever the map chrome
// is doing.

import { useMemo } from "react";
import {
  AlertTriangle,
  Activity,
  GitBranch,
  Link2,
  Sparkles,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import type { ObjectiveStack } from "@/lib/objective-canvas/layer-model";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import { buildCanvasGraph } from "./lib/graph-build";
import { useLoopDetection } from "./hooks/useLoopDetection";
import { summarizeCanvasMap } from "./lib/summarize-map";
import { HEALTH_COLORS, LOOP_COLORS } from "./lib/visual-grammar";
import type { HealthBand } from "./lib/types";

interface Props {
  spaceId: string;
  subs: MainCanvasSub[];
  objectiveStack?: ObjectiveStack | null;
  crossRoomSignals?: CrossRoomSignals | null;
}

const HEALTH_ORDER: HealthBand[] = ["strong", "moderate", "weak", "unknown"];

export function MapInsightsPanel({
  spaceId,
  subs,
  objectiveStack,
  crossRoomSignals,
}: Props) {
  const graph = useMemo(
    () => buildCanvasGraph({ spaceId, subs, objectiveStack, crossRoomSignals }),
    [spaceId, subs, objectiveStack, crossRoomSignals],
  );
  const loops = useLoopDetection(graph.nodes, graph.edges);
  const insights = useMemo(
    () => summarizeCanvasMap(graph, loops),
    [graph, loops],
  );

  if (subs.length === 0) return null;

  const totalLoops = insights.loops.reinforcing + insights.loops.balancing;
  const scored =
    insights.health.strong + insights.health.moderate + insights.health.weak;

  return (
    <div
      className="mt-3 w-full rounded-2xl p-4"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Headline */}
      <div className="flex items-start gap-2">
        <Sparkles
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: appleVibe.accent.primary }}
          strokeWidth={2.2}
        />
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[10px] font-bold uppercase tracking-wide"
            style={{ color: appleVibe.text.tertiary }}
          >
            Map insights
          </span>
          <span
            className="text-[13px] font-semibold leading-snug"
            style={{ color: appleVibe.text.primary }}
          >
            {insights.headline ??
              "The stack is covered and your sub-objectives are taking shape."}
          </span>
        </div>
      </div>

      {/* Signal row */}
      <div className="mt-3 flex flex-wrap items-stretch gap-2">
        {/* Health distribution */}
        <Tile icon={<Activity className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Health">
          {scored === 0 ? (
            <span className="text-[11px]" style={{ color: appleVibe.text.faint }}>
              unscored
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {HEALTH_ORDER.map((band) => {
                const n = insights.health[band];
                if (n === 0) return null;
                const c = HEALTH_COLORS[band];
                return (
                  <span
                    key={band}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums"
                    style={{ color: appleVibe.text.secondary }}
                    title={c.label}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: c.dot }}
                    />
                    {n}
                  </span>
                );
              })}
            </div>
          )}
        </Tile>

        {/* Loops */}
        <Tile icon={<GitBranch className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Loops">
          {totalLoops === 0 ? (
            <span className="text-[11px]" style={{ color: appleVibe.text.faint }}>
              none
            </span>
          ) : (
            <div className="flex items-center gap-2">
              {insights.loops.reinforcing > 0 ? (
                <LoopPip
                  kind="reinforcing"
                  count={insights.loops.reinforcing}
                />
              ) : null}
              {insights.loops.balancing > 0 ? (
                <LoopPip kind="balancing" count={insights.loops.balancing} />
              ) : null}
            </div>
          )}
        </Tile>

        {/* Coverage */}
        <Tile
          icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />}
          label="Coverage"
        >
          {!insights.hasLayerStack ? (
            <span className="text-[11px]" style={{ color: appleVibe.text.faint }}>
              no stack
            </span>
          ) : insights.uncoveredLayers.length === 0 ? (
            <span
              className="text-[11px] font-semibold"
              style={{ color: "#15803D" }}
            >
              all layers covered
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              {insights.uncoveredLayers.map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "rgba(217,119,6,0.12)", color: "#B45309" }}
                  title={l.name}
                >
                  {l.id}
                </span>
              ))}
            </span>
          )}
        </Tile>
      </div>

      {/* Top cross-room links */}
      {insights.topLinks.length > 0 ? (
        <div className="mt-3">
          <span
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: appleVibe.text.tertiary }}
          >
            <Link2 className="h-3 w-3" strokeWidth={2.4} />
            Most entangled rooms
          </span>
          <ul className="mt-1.5 flex flex-col gap-1">
            {insights.topLinks.map((link, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-[11px]"
                style={{ color: appleVibe.text.secondary }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{
                    background: appleVibe.accent.primary,
                    opacity: 0.35 + link.strength * 0.5,
                  }}
                />
                <span className="font-medium truncate">{link.from}</span>
                <span style={{ color: appleVibe.text.faint }}>·{link.label}·</span>
                <span className="font-medium truncate">{link.to}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl px-3 py-2"
      style={{
        background: appleVibe.surface.base,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        minWidth: 120,
      }}
    >
      <span
        className="flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide"
        style={{ color: appleVibe.text.tertiary }}
      >
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

function LoopPip({
  kind,
  count,
}: {
  kind: "reinforcing" | "balancing";
  count: number;
}) {
  const c = LOOP_COLORS[kind];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums"
      style={{ color: appleVibe.text.secondary }}
      title={kind}
    >
      <span
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
        style={{ background: c.ring }}
      >
        {c.label}
      </span>
      {count}
    </span>
  );
}
