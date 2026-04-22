"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity } from "@/types";

export interface LabChamber2DProps {
  focal: Entity;
  subunits: Entity[];
  upstreamPartners: Entity[];
  downstreamPartners: Entity[];
  hoveredSubunitId: string | null;
  onHoverSubunit: (id: string | null) => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  concrete: "#4ade80",
  abstract: "#a78bfa",
  process: "#fbbf24",
  relational: "#22d3ee",
  epistemic: "#f472b6",
  fault: "#ef4444",
};

function colorOf(e: Entity, fallback = "#4ade80"): string {
  const cat = (e.entity_category as string) ?? "";
  return CATEGORY_COLOR[cat] ?? fallback;
}

function sizeOf(e: Entity): number {
  const imp = e.importance ?? "moderate";
  return imp === "fundamental" ? 18 : imp === "critical" ? 15 : imp === "important" ? 12 : 10;
}

export function LabChamber2D({
  focal,
  subunits,
  upstreamPartners,
  downstreamPartners,
  hoveredSubunitId,
  onHoverSubunit,
}: LabChamber2DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [tick, setTick] = useState(0);

  // Resize observer
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

  // Subtle breathing animation — one state update per ~60ms via RAF.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last > 60) {
        setTick((t) => t + 1);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  const nucleusR = 22;
  const subunitRadius = Math.min(180, Math.max(110, Math.min(dims.w, dims.h) * 0.22));
  const externalRadius = Math.min(320, Math.max(220, Math.min(dims.w, dims.h) * 0.4));

  // Subunit positions on a ring — deterministic so layout stays stable.
  const subunitPositions = useMemo(() => {
    const n = subunits.length;
    if (n === 0) return [];
    return subunits.map((s, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2; // start at 12 o'clock
      return {
        entity: s,
        angle,
        x: cx + Math.cos(angle) * subunitRadius,
        y: cy + Math.sin(angle) * subunitRadius,
      };
    });
  }, [subunits, cx, cy, subunitRadius]);

  const upstreamPositions = useMemo(() => {
    const n = upstreamPartners.length;
    if (n === 0) return [];
    return upstreamPartners.map((e, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI - Math.PI; // upper half-circle
      return {
        entity: e,
        angle,
        x: cx + Math.cos(angle) * externalRadius,
        y: cy + Math.sin(angle) * externalRadius,
      };
    });
  }, [upstreamPartners, cx, cy, externalRadius]);

  const downstreamPositions = useMemo(() => {
    const n = downstreamPartners.length;
    if (n === 0) return [];
    return downstreamPartners.map((e, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI; // lower half-circle
      return {
        entity: e,
        angle,
        x: cx + Math.cos(angle) * externalRadius,
        y: cy + Math.sin(angle) * externalRadius,
      };
    });
  }, [downstreamPartners, cx, cy, externalRadius]);

  const t = tick / 16;
  const breath = 1 + Math.sin(t) * 0.03;
  const shellPulse = 0.55 + Math.sin(t * 0.8) * 0.08;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at center, rgba(74,222,128,0.04), transparent 60%), #02050a",
      }}
    >
      {/* Crosshair overlay (subtle) */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-0 right-0 h-px"
          style={{ top: "50%", background: "rgba(148,163,184,0.05)" }}
        />
        <div
          className="absolute bottom-0 top-0 w-px"
          style={{ left: "50%", background: "rgba(148,163,184,0.05)" }}
        />
      </div>

      {/* Corner brackets */}
      <CornerBrackets />

      {/* HUD readouts */}
      <div className="pointer-events-none absolute left-5 top-5 text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 flex gap-2.5">
          <span>CHAMBER</span>
          <b className="font-medium text-[var(--lab-text)]">REACTOR-01</b>
        </div>
        <div className="mb-1 flex gap-2.5">
          <span>FIELD</span>
          <b className="font-medium text-[var(--lab-text)]">STRUCTURE</b>
        </div>
        <div className="flex gap-2.5">
          <span>SUBUNITS</span>
          <b className="font-medium text-[var(--lab-text)]">{subunits.length}</b>
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 top-5 text-right text-[9px] font-mono uppercase tracking-widest text-[var(--lab-accent)]/75">
        <div className="mb-1 flex justify-end gap-2.5">
          <span>BONDS</span>
          <b className="font-medium text-[var(--lab-text)]">
            {upstreamPartners.length + downstreamPartners.length}
          </b>
        </div>
        <div className="mb-1 flex justify-end gap-2.5">
          <span>STATE</span>
          <b className="font-medium text-[var(--lab-text)]">
            {subunits.length === 0 ? "UNDER-DECOMPOSED" : "STABLE"}
          </b>
        </div>
        <div className="flex justify-end gap-2.5">
          <span>SCAN ●</span>
        </div>
      </div>

      {/* SVG chamber */}
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <radialGradient id="lab-nucleus" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#166534" />
          </radialGradient>
          <radialGradient id="lab-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </radialGradient>
          <filter id="lab-soft">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* Outer probability shell */}
        <circle
          cx={cx}
          cy={cy}
          r={externalRadius + 30}
          fill="none"
          stroke="#4ade80"
          strokeOpacity={0.08}
          strokeDasharray="1 4"
        />
        <circle
          cx={cx}
          cy={cy}
          r={externalRadius}
          fill="none"
          stroke="#4ade80"
          strokeOpacity={0.1}
          strokeDasharray="3 6"
        />

        {/* Subunit ring */}
        <circle
          cx={cx}
          cy={cy}
          r={subunitRadius}
          fill="none"
          stroke="#22d3ee"
          strokeOpacity={0.15}
        />
        {/* Tilted orbital accents (rotating) */}
        <circle
          cx={cx}
          cy={cy}
          r={subunitRadius * 1.1}
          fill="none"
          stroke="#a78bfa"
          strokeOpacity={0.1}
          strokeDasharray="2 8"
          transform={`rotate(${(t * 12) % 360} ${cx} ${cy})`}
        />
        <circle
          cx={cx}
          cy={cy}
          r={subunitRadius * 1.25}
          fill="none"
          stroke="#f472b6"
          strokeOpacity={0.08}
          strokeDasharray="1 6"
          transform={`rotate(${(-t * 10) % 360} ${cx} ${cy})`}
        />

        {/* Tethers from nucleus to each subunit */}
        {subunitPositions.map(({ entity, x, y }) => {
          const color = colorOf(entity);
          const isHover = hoveredSubunitId === entity.id;
          return (
            <line
              key={`tether-${entity.id}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={color}
              strokeOpacity={isHover ? 0.7 : 0.3}
              strokeWidth={isHover ? 1.5 : 1}
            />
          );
        })}

        {/* External bond curves */}
        {[...upstreamPositions, ...downstreamPositions].map((p, i) => {
          const isUpstream = i < upstreamPositions.length;
          const color = isUpstream ? "#22d3ee" : "#fbbf24";
          const midX = (cx + p.x) / 2;
          const midY = (cy + p.y) / 2 + (isUpstream ? -40 : 40);
          return (
            <path
              key={`bond-${p.entity.id}-${i}`}
              d={`M ${cx} ${cy} Q ${midX} ${midY} ${p.x} ${p.y}`}
              fill="none"
              stroke={color}
              strokeOpacity={0.3}
              strokeWidth={1}
              strokeDasharray={isUpstream ? undefined : "3 3"}
            />
          );
        })}

        {/* Nucleus glow */}
        <circle cx={cx} cy={cy} r={nucleusR * 2.6} fill="url(#lab-glow)" opacity={shellPulse} />

        {/* Nucleus */}
        <circle
          cx={cx}
          cy={cy}
          r={nucleusR * breath}
          fill="url(#lab-nucleus)"
          filter="url(#lab-soft)"
          opacity={0.92}
        />
        <circle
          cx={cx}
          cy={cy}
          r={nucleusR * breath - 2}
          fill="#ffffff"
          opacity={0.28}
        />

        {/* Subunit nodes */}
        {subunitPositions.map(({ entity, x, y }) => {
          const color = colorOf(entity);
          const r = sizeOf(entity);
          const isHover = hoveredSubunitId === entity.id;
          return (
            <g
              key={`sub-${entity.id}`}
              onMouseEnter={() => onHoverSubunit(entity.id)}
              onMouseLeave={() => onHoverSubunit(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={x}
                cy={y}
                r={r * 1.8}
                fill={color}
                opacity={isHover ? 0.28 : 0.1}
              />
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={color}
                opacity={0.92}
                style={{ filter: `drop-shadow(0 0 ${isHover ? 10 : 4}px ${color})` }}
              />
              <circle cx={x} cy={y} r={r * 0.4} fill="#ffffff" opacity={0.38} />
              {isHover && (
                <text
                  x={x}
                  y={y + r + 14}
                  textAnchor="middle"
                  className="select-none"
                  fill="#e8edf4"
                  fontSize="10"
                  fontWeight="600"
                  style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
                >
                  {entity.name.length > 24 ? entity.name.slice(0, 24) + "…" : entity.name}
                </text>
              )}
            </g>
          );
        })}

        {/* Upstream external nodes */}
        {upstreamPositions.map(({ entity, x, y }) => (
          <ExternalNode key={`up-${entity.id}`} x={x} y={y} color="#22d3ee" name={entity.name} />
        ))}
        {/* Downstream external nodes */}
        {downstreamPositions.map(({ entity, x, y }) => (
          <ExternalNode key={`dn-${entity.id}`} x={x} y={y} color="#fbbf24" name={entity.name} />
        ))}

        {/* Focal label under nucleus */}
        <text
          x={cx}
          y={cy + nucleusR + 22}
          textAnchor="middle"
          fill="#e8edf4"
          fontSize="12"
          fontWeight="700"
          style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 4 }}
        >
          {focal.name.length > 36 ? focal.name.slice(0, 36) + "…" : focal.name}
        </text>
      </svg>
    </div>
  );
}

function ExternalNode({
  x,
  y,
  color,
  name,
}: {
  x: number;
  y: number;
  color: string;
  name: string;
}) {
  return (
    <g>
      <circle cx={x} cy={y} r={8} fill={color} opacity={0.18} />
      <circle cx={x} cy={y} r={4.5} fill={color} opacity={0.88} />
      <text
        x={x}
        y={y + 16}
        textAnchor="middle"
        fill="#a8b3c4"
        fontSize="9"
        fontWeight="500"
        style={{ paintOrder: "stroke", stroke: "#02050a", strokeWidth: 3 }}
      >
        {name.length > 22 ? name.slice(0, 22) + "…" : name}
      </text>
    </g>
  );
}

function CornerBrackets() {
  return (
    <div className="pointer-events-none absolute inset-[18px]">
      {[
        { top: 0, left: 0, borderTop: true, borderLeft: true },
        { top: 0, right: 0, borderTop: true, borderRight: true },
        { bottom: 0, left: 0, borderBottom: true, borderLeft: true },
        { bottom: 0, right: 0, borderBottom: true, borderRight: true },
      ].map((pos, i) => (
        <span
          key={i}
          className="absolute h-5 w-5"
          style={{
            top: pos.top as number | undefined,
            left: pos.left as number | undefined,
            right: pos.right as number | undefined,
            bottom: pos.bottom as number | undefined,
            borderColor: "#475569",
            borderTop: pos.borderTop ? "1px solid" : undefined,
            borderRight: pos.borderRight ? "1px solid" : undefined,
            borderBottom: pos.borderBottom ? "1px solid" : undefined,
            borderLeft: pos.borderLeft ? "1px solid" : undefined,
          }}
        />
      ))}
    </div>
  );
}
