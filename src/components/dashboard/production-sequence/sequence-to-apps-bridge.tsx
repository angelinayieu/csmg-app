"use client";

/**
 * SequenceToAppsBridge
 *
 * Visual bridge between the Production Sequence (4 stage pills) and the
 * App Card Grid. Draws SVG paths that *converge from each app card's column
 * position* up to the "Apps" pill at the right of the sequence row —
 * making the "information → apps" production line feel continuous.
 *
 * Geometry:
 *   - The SVG strip is ~44px tall, full width, positioned between sections.
 *   - Each path starts at the Apps pill's bottom-center (column 4 of 4 ⇒
 *     center X = 87.5%), runs down a bit, bends 90° to the target card's
 *     center X, bends 90° again, continues down to the top of that card.
 *   - At mobile/small widths: cards stack to 1-2 columns; paths degrade
 *     gracefully to simple vertical tubes.
 *
 * Accent: uses var(--accent-rgb) with soft gradient stroke. A muted
 * animated dot flows along a random path every few seconds to signal
 * "data flowing from apps pill to this card".
 */

import { motion } from "framer-motion";
import { useMemo } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

export interface SequenceToAppsBridgeProps {
  appCount: number;
  /** How many columns the app grid uses at its widest (xl) breakpoint. */
  gridColumns?: 2 | 3 | 4;
}

export function SequenceToAppsBridge({
  appCount,
  gridColumns = 4,
}: SequenceToAppsBridgeProps) {
  // Anchor of the Apps pill — rightmost of 4 stage columns in ProductionSequence.
  // X = 87.5% puts it at the center of the 4th column.
  const appsAnchorX = 87.5;
  const trunkStartY = 0;     // top of bridge (touching sequence bottom)
  const trunkBendY = 12;     // where the trunk bends horizontally
  const branchBendY = 32;    // where each branch bends down into a card
  const bridgeBottomY = 44;  // bottom of bridge (touching grid top)

  // Compute target X for each card based on how many cards the grid
  // packs per row at xl. We assume cards are evenly spaced — so for
  // `n` cards across `gridColumns`, card i's center is at
  //   ((i % gridColumns) + 0.5) / gridColumns * 100 %.
  const targets = useMemo(() => {
    const n = Math.max(1, Math.min(appCount, gridColumns));
    const positions: number[] = [];
    for (let i = 0; i < n; i++) {
      const centerPct = ((i + 0.5) / gridColumns) * 100;
      positions.push(centerPct);
    }
    return positions;
  }, [appCount, gridColumns]);

  if (appCount === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none relative -mt-2 h-[44px] w-full overflow-hidden"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="bridge-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.4" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="bridge-grad-hover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.25" />
          </linearGradient>
        </defs>

        {/* Soft trunk stem descending from the Apps pill */}
        <motion.path
          d={`M ${appsAnchorX} ${trunkStartY} L ${appsAnchorX} ${trunkBendY}`}
          stroke="url(#bridge-grad)"
          strokeWidth="0.6"
          fill="none"
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
        />

        {/* Branches — each one bends from the trunk end to its card top */}
        {targets.map((targetX, i) => {
          // Path: (anchorX, trunkBendY) → horizontal → (targetX, trunkBendY)
          //       → vertical → (targetX, branchBendY) → (targetX, bridgeBottomY)
          // Bent-corner style: two hard 90° bends, softened by short bezier arcs
          // at each corner for a polished curve (~1.2 unit radius).

          // Going right-to-left: if targetX < anchorX, the first bend is leftward
          const dir = targetX < appsAnchorX ? -1 : 1;
          const cornerR = 1.2;

          const d = [
            // Start at trunk end
            `M ${appsAnchorX} ${trunkBendY}`,
            // Nudge horizontally away from the trunk
            `h ${dir * cornerR}`,
            // Horizontal run to just before the target X
            `L ${targetX - dir * cornerR} ${trunkBendY}`,
            // Soft corner into vertical descent
            `Q ${targetX} ${trunkBendY} ${targetX} ${trunkBendY + cornerR}`,
            // Straight down to bottom of bridge
            `L ${targetX} ${bridgeBottomY}`,
          ].join(" ");

          return (
            <g key={i}>
              <motion.path
                d={d}
                stroke="url(#bridge-grad)"
                strokeWidth="0.6"
                fill="none"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  duration: 0.9,
                  ease: EASE,
                  delay: 0.3 + i * 0.08,
                }}
              />
              {/* Terminal dot where branch meets card top */}
              <motion.circle
                cx={targetX}
                cy={bridgeBottomY - 0.5}
                r={0.5}
                fill="rgb(var(--accent-rgb))"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.3,
                  ease: EASE,
                  delay: 1.0 + i * 0.08,
                }}
              />
            </g>
          );
        })}

        {/* Flow dot — travels along one branch at a time, signalling "data flow" */}
        {targets.length > 0 ? (
          <circle
            r="0.4"
            fill="rgb(var(--accent-rgb))"
            opacity="0.85"
          >
            <animateMotion
              dur="3.4s"
              repeatCount="indefinite"
              path={buildFlowPath(appsAnchorX, targets, trunkStartY, trunkBendY, bridgeBottomY)}
            />
          </circle>
        ) : null}
      </svg>
    </div>
  );
}

/**
 * Concatenate the full tour path that the animated flow dot traverses:
 * trunk → first branch → return to trunk end → second branch → …
 * This way one animating circle visits every branch in turn.
 */
function buildFlowPath(
  anchorX: number,
  targets: number[],
  y0: number,
  yBend: number,
  yBottom: number
): string {
  const parts: string[] = [`M ${anchorX} ${y0}`, `L ${anchorX} ${yBend}`];
  for (const t of targets) {
    parts.push(`L ${t} ${yBend}`, `L ${t} ${yBottom}`);
    // Come back up to the trunk end to start the next branch
    parts.push(`L ${t} ${yBend}`, `L ${anchorX} ${yBend}`);
  }
  return parts.join(" ");
}
