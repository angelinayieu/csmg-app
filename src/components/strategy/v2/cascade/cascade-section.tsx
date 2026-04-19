"use client";

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Layers } from "lucide-react";
import { CascadeRow, type CascadeRowHandle } from "./cascade-row";
import { CascadeRouterSvg } from "./cascade-router-svg";
import type { CascadeRowVM } from "../strategy-view-model";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";

interface CascadeSectionProps {
  cascade: CascadeRowVM[];
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
}

export function CascadeSection({
  cascade,
  causalChains,
  entityMap,
  spaceId,
}: CascadeSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const bump = useCallback(() => setLayoutVersion((v) => v + 1), []);

  // One ref per row
  const rowRefs = useRef<Array<React.RefObject<CascadeRowHandle | null>>>([]);
  if (rowRefs.current.length !== cascade.length) {
    rowRefs.current = cascade.map(
      (_, i) => rowRefs.current[i] ?? { current: null },
    );
  }

  const paletteKeys = useMemo(() => cascade.map((r) => r.paletteKey), [cascade]);

  // Trigger on window resize + on mount
  useEffect(() => {
    const onResize = () => bump();
    window.addEventListener("resize", onResize);
    // Initial tick after layout settles
    const id = window.setTimeout(bump, 50);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(id);
    };
  }, [bump]);

  if (cascade.length === 0) {
    return (
      <div
        className="glass-card rounded-[14px] p-8 text-center"
        style={{
          background: "rgba(255, 255, 255, 0.6)",
          border: "1px solid rgba(11,13,18,0.08)",
        }}
      >
        <p className="text-[13px] text-gray-500">
          No perspectives yet. Regenerate strategy to build the cascade.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            fontSize: 11,
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <Layers className="w-2.5 h-2.5" style={{ color: "rgba(11,13,18,0.48)" }} />
          Strategic Cascade
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 500,
          }}
        >
          {cascade.length} {cascade.length === 1 ? "perspective" : "perspectives"} · click any objective to expand its mechanism chain
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-[14px]"
        style={{
          background: "rgba(255, 255, 255, 0.72)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(11,13,18,0.14)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 12px 32px -16px rgba(var(--accent-rgb), 0.1)",
        }}
      >
        {cascade.map((row, i) => (
          <CascadeRow
            key={`row-${i}`}
            ref={rowRefs.current[i]}
            row={row}
            causalChains={causalChains}
            entityMap={entityMap}
            spaceId={spaceId}
            isLast={i === cascade.length - 1}
            onLayoutChange={bump}
          />
        ))}
        <CascadeRouterSvg
          rowRefs={rowRefs}
          paletteKeys={paletteKeys}
          containerRef={containerRef}
          layoutVersion={layoutVersion}
        />
      </div>
    </div>
  );
}
