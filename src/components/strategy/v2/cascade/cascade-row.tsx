"use client";

import { useRef, useImperativeHandle, forwardRef, useState, useCallback, useEffect } from "react";
import { PerspectiveCard } from "./perspective-card";
import { ProxyIndicatorList } from "./proxy-indicator-list";
import { CascadeObjectiveCard } from "./cascade-objective";
import type { CascadeRowVM } from "../strategy-view-model";
import { palette } from "../strategy-palette";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";

export interface CascadeRowHandle {
  getAnchors: () => {
    container: HTMLDivElement | null;
    perspectiveRight: { x: number; y: number } | null;
    proxyLeft: { x: number; y: number } | null;
    objectiveAnchors: Array<{ leftX: number; rightX: number; y: number }>;
  };
}

interface CascadeRowProps {
  row: CascadeRowVM;
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  isLast: boolean;
  onLayoutChange?: () => void;
}

export const CascadeRow = forwardRef<CascadeRowHandle, CascadeRowProps>(function CascadeRow(
  { row, causalChains, entityMap, spaceId, isLast, onLayoutChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const perspectiveRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLDivElement>(null);
  const objectiveRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [, forceTick] = useState(0);

  const p = palette(row.paletteKey);

  const handleObjectiveLayoutChange = useCallback(() => {
    forceTick((x) => x + 1);
    onLayoutChange?.();
  }, [onLayoutChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      forceTick((x) => x + 1);
      onLayoutChange?.();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [onLayoutChange]);

  useImperativeHandle(
    ref,
    () => ({
      getAnchors: () => {
        const container = containerRef.current;
        if (!container) {
          return {
            container: null,
            perspectiveRight: null,
            proxyLeft: null,
            objectiveAnchors: [],
          };
        }
        const containerRect = container.getBoundingClientRect();
        const perspectiveRect = perspectiveRef.current?.getBoundingClientRect();
        const proxyRect = proxyRef.current?.getBoundingClientRect();

        const perspectiveRight = perspectiveRect
          ? {
              x: perspectiveRect.right - containerRect.left,
              y: perspectiveRect.top + 28 - containerRect.top,
            }
          : null;
        const proxyLeft = proxyRect
          ? {
              x: proxyRect.left - containerRect.left,
              y: proxyRect.top + 28 - containerRect.top,
            }
          : null;

        const objectiveAnchors = objectiveRefs.current
          .filter((el): el is HTMLDivElement => !!el)
          .map((el) => {
            const r = el.getBoundingClientRect();
            const y = r.top + Math.min(32, r.height / 2) - containerRect.top;
            return {
              leftX: r.left - containerRect.left,
              rightX: r.right - containerRect.left,
              y,
            };
          });

        return {
          container,
          perspectiveRight,
          proxyLeft,
          objectiveAnchors,
        };
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="grid items-start gap-[0_56px] px-5 py-4 relative"
      style={{
        gridTemplateColumns: "40px 260px 1fr 280px",
        borderTop: isLast ? "none" : undefined,
        borderBottom: "1px solid rgba(11,13,18,0.08)",
      }}
    >
      {/* Numbox */}
      <div
        className="flex items-center justify-center rounded-lg relative z-[1] self-start mt-0.5"
        style={{
          width: 38,
          height: 44,
          background: p.softBg,
          border: `1px solid ${p.accent}`,
          color: p.deep,
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        {row.index}
      </div>

      {/* Perspective card */}
      <div ref={perspectiveRef} className="relative z-[1]">
        <PerspectiveCard row={row} />
      </div>

      {/* Objectives column */}
      <div className="flex flex-col gap-2 relative z-[1] self-start">
        {row.objectives.length === 0 && (
          <div
            className="rounded-[8px] px-3.5 py-2.5 text-center"
            style={{
              fontSize: 11,
              color: "rgba(11,13,18,0.48)",
              background: "#fff",
              border: "1px dashed rgba(11,13,18,0.12)",
            }}
          >
            No objectives mapped yet
          </div>
        )}
        {row.objectives.map((obj, i) => (
          <div
            key={obj.id}
            ref={(el) => {
              objectiveRefs.current[i] = el;
            }}
          >
            <CascadeObjectiveCard
              objective={obj}
              row={row}
              causalChains={causalChains}
              entityMap={entityMap}
              spaceId={spaceId}
              onLayoutChange={handleObjectiveLayoutChange}
            />
          </div>
        ))}
      </div>

      {/* Proxy indicators */}
      <div ref={proxyRef} className="relative z-[1]">
        <ProxyIndicatorList row={row} />
      </div>
    </div>
  );
});
