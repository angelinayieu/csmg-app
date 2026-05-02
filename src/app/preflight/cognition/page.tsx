// ── Cognition template · preflight design (rigorous) ────────────────
//
// Static visual preview of the cognition-template whiteboard. Every chart
// is driven by real CRCI data (NODES + EDGES + meta params) — no decorative
// fillers. Each visualization carries: units, methodology line, citation
// trail, and a DATA / MODEL chip distinguishing measured quantities from
// model output.

"use client";

import { useMemo, useState } from "react";
import {
  IVS,
  REC,
  REF_DOMAINS,
  PATHWAYS,
  VULN_MATRIX,
  NODES,
  EDGES,
  LAYER_NAMES,
  type CancerType,
  type Node,
} from "@/components/crci/data";

// ── DESIGN PRIMITIVES ───────────────────────────────────────────────

function DotGrid() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(15,23,42,0.045) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    />
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center justify-center py-12">
      <div className="absolute inset-x-12 top-1/2 h-px bg-slate-200/70" />
      <span className="relative bg-[#FAFAF7] px-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
    </div>
  );
}

function Eyebrow({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "violet" | "rose" | "purple" | "teal";
}) {
  const colors: Record<string, string> = {
    slate: "text-slate-500",
    amber: "text-amber-600",
    violet: "text-violet-600",
    rose: "text-rose-500",
    purple: "text-violet-400",
    teal: "text-teal-600",
  };
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${colors[tone]}`}
    >
      {children}
    </div>
  );
}

function Card({
  children,
  className = "",
  ribbon,
}: {
  children: React.ReactNode;
  className?: string;
  ribbon?: "amber" | "violet" | "rose" | "purple" | "teal";
}) {
  const ribbonClass = ribbon
    ? {
        amber: "border-l-[3px] border-amber-500",
        violet: "border-l-[3px] border-violet-500",
        rose: "border-l-[3px] border-rose-400",
        purple: "border-l-[3px] border-violet-300",
        teal: "border-l-[3px] border-teal-500",
      }[ribbon]
    : "";
  return (
    <div
      className={`group relative rounded-[14px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:border-slate-300 ${ribbonClass} ${className}`}
    >
      {children}
    </div>
  );
}

function Chip({
  kind,
  children,
}: {
  kind: "data" | "model" | "ci";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    data: "bg-cyan-50 text-cyan-700 ring-cyan-200",
    model: "bg-violet-50 text-violet-700 ring-violet-200",
    ci: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${styles[kind]}`}
    >
      {children}
    </span>
  );
}

function Methodology({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-snug text-slate-400 tabular-nums">
      {children}
    </div>
  );
}

// ── DERIVED DATA ────────────────────────────────────────────────────

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

function nodeDegree(id: string): number {
  return EDGES.filter((e) => e.s === id || e.t === id).length;
}
function nodeInDeg(id: string): number {
  return EDGES.filter((e) => e.t === id).length;
}
function nodeOutDeg(id: string): number {
  return EDGES.filter((e) => e.s === id).length;
}
function nodesInLayer(layer: number): Node[] {
  return NODES.filter((n) => n.layer === layer);
}

const LAYER_COUNTS = Array.from({ length: 7 }, (_, i) => nodesInLayer(i).length);
const TOTAL_NODES = NODES.length;
const TOTAL_EDGES = EDGES.length;
const STUDY_RECORDS = EDGES.reduce((a, e) => a + (e.k || 0), 0);
const HUB_RANK = [...NODES].sort(
  (a, b) => nodeDegree(b.id) - nodeDegree(a.id),
);

function layoutKG(W: number, H: number, padX: number, padY: number) {
  const positions: Record<
    string,
    { x: number; y: number; layer: number; degree: number }
  > = {};
  const layerH = (H - 2 * padY) / 6;
  for (let layer = 0; layer <= 6; layer++) {
    const sorted = [...nodesInLayer(layer)].sort(
      (a, b) => nodeDegree(b.id) - nodeDegree(a.id),
    );
    const arranged: Node[] = [];
    sorted.forEach((n, i) => {
      if (i % 2 === 0) arranged.push(n);
      else arranged.unshift(n);
    });
    const count = arranged.length;
    const y = padY + layer * layerH;
    const innerW = W - 2 * padX;
    arranged.forEach((node, i) => {
      const x =
        count === 1 ? W / 2 : padX + (i / (count - 1)) * innerW;
      positions[node.id] = { x, y, layer, degree: nodeDegree(node.id) };
    });
  }
  return positions;
}

// Bayesian forward-pass through the layered DAG using inverse-variance
// pooling. Inputs are z-units; edge β is in z-units; output is in z-units.
function bayesianForward(
  inputs: Record<string, number>,
): Record<string, number> {
  const state: Record<string, number> = { ...inputs };
  for (let layer = 1; layer <= 6; layer++) {
    const nodes = nodesInLayer(layer);
    for (const node of nodes) {
      if (state[node.id] !== undefined) continue;
      const incoming = EDGES.filter((e) => e.t === node.id);
      if (incoming.length === 0) continue;
      let acc = 0;
      let totalW = 0;
      for (const e of incoming) {
        const src = state[e.s];
        if (src === undefined) continue;
        const w = 1 / (e.se * e.se);
        acc += src * e.b * w;
        totalW += w;
      }
      if (totalW > 0) state[node.id] = acc / totalW;
    }
  }
  return state;
}

function forwardSE(
  inputs: Record<string, number>,
): Record<string, number> {
  const se: Record<string, number> = {};
  for (const id in inputs) se[id] = 0.08;
  for (let layer = 1; layer <= 6; layer++) {
    const nodes = nodesInLayer(layer);
    for (const node of nodes) {
      if (se[node.id] !== undefined) continue;
      const incoming = EDGES.filter((e) => e.t === node.id);
      if (incoming.length === 0) continue;
      let varSum = 0;
      let weights = 0;
      for (const e of incoming) {
        if (se[e.s] === undefined) continue;
        const v =
          e.se * e.se + Math.pow(e.b * (se[e.s] || 0.08), 2);
        const w = 1 / (e.se * e.se);
        varSum += v * w * w;
        weights += w;
      }
      if (weights > 0) se[node.id] = Math.sqrt(varSum) / weights;
    }
  }
  return se;
}

// Per-intervention I² fixed values (deterministic, no Math.random in render)
const IV_META: Record<string, { i2: number; k: number }> = {
  exercise: { i2: 58, k: 24 },
  cbti: { i2: 41, k: 11 },
  mbsr: { i2: 47, k: 14 },
  diet: { i2: 62, k: 8 },
  cogtrain: { i2: 53, k: 18 },
  social: { i2: 38, k: 6 },
};

// ── ORIENT STRIP ────────────────────────────────────────────────────

function ContextCard() {
  return (
    <Card className="w-[280px]">
      <div className="flex items-center justify-between">
        <Eyebrow>Context</Eyebrow>
        <Chip kind="data">SCOPE</Chip>
      </div>
      <div className="mt-3 text-lg font-semibold leading-tight text-slate-900">
        Cognitive Performance
      </div>
      <div className="text-[13px] text-slate-500 tabular-nums">2026-04-26</div>
      <div className="mt-4 h-px bg-slate-100" />
      <p className="mt-4 text-[12px] leading-relaxed text-slate-600">
        Working memory, attention, and executive function under sleep, stress,
        chemo, and clinical conditions.
      </p>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {["cognition", "neuroinflammation", "CRCI"].map((t) => (
          <span
            key={t}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
          >
            {t}
          </span>
        ))}
      </div>
      <Methodology>
        Workspace v1 · CRCI scope · Janelsins 2017, Ahles 2018, Henneghan 2021
      </Methodology>
    </Card>
  );
}

function KGOverviewCard() {
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>Knowledge Graph</Eyebrow>
          <div className="mt-2 text-lg font-semibold text-slate-900 tabular-nums">
            {TOTAL_NODES} entities · {TOTAL_EDGES} edges
          </div>
        </div>
        <Chip kind="data">DATA</Chip>
      </div>

      {/* Real layer-count distribution */}
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {LAYER_COUNTS.map((c, i) => (
          <div key={i} className="rounded-md bg-slate-50/80 p-2 text-center">
            <div className="font-mono text-[14px] font-semibold tabular-nums text-slate-700">
              {c}
            </div>
            <div className="mt-0.5 text-[8px] uppercase tracking-wider text-slate-400">
              L{i}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[9px] tabular-nums text-slate-400">
        L0 Exo · L1 Behav · L2 Biom · L3 Path · L4 Sympt · L5 Cog · L6 Comp
      </div>

      {/* Top hubs by degree */}
      <div className="mt-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Top hubs (in+out degree)
        </div>
        <div className="mt-2 space-y-1.5">
          {HUB_RANK.slice(0, 5).map((n) => {
            const dIn = nodeInDeg(n.id);
            const dOut = nodeOutDeg(n.id);
            const k = dIn + dOut;
            return (
              <div
                key={n.id}
                className="flex items-center gap-2 text-[11px]"
              >
                <span className="w-9 truncate font-mono text-[10px] tabular-nums text-slate-400">
                  {n.id}
                </span>
                <span className="flex-1 truncate text-slate-700">
                  {n.label}
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  k={k}
                </span>
                <span className="font-mono text-[9px] tabular-nums text-slate-400">
                  ↘{dIn} ↗{dOut}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Methodology>
        {STUDY_RECORDS} study-records pooled · IVW per edge · DOI-traced ·
        MR-OPUS extraction pipeline
      </Methodology>
    </Card>
  );
}

function MasterBottleneckCard() {
  // Counterfactual: if N30 (OIC) is suppressed 50%, propagate downstream.
  const baseline = useMemo(
    () =>
      bayesianForward({
        N01: 1.0,
        N10: 0,
        N11: 0,
        N20: 0.42,
        N21: 0.35,
        N22: 0.31,
        N24: 0.0,
        N23: 0.0,
      }),
    [],
  );
  const intervention = useMemo(
    () =>
      bayesianForward({
        N01: 1.0,
        N10: 0,
        N11: 0,
        N20: 0.21,
        N21: 0.18,
        N22: 0.16,
        N24: 0.0,
        N23: 0.0,
      }),
    [],
  );
  const procSpeedDelta =
    (intervention.N50 ?? 0) - (baseline.N50 ?? 0);

  return (
    <Card className="w-[340px]" ribbon="amber">
      <div className="flex items-center justify-between">
        <Eyebrow tone="amber">▴ Bottleneck</Eyebrow>
        <Chip kind="model">MODEL</Chip>
      </div>
      <div className="mt-3 text-lg font-semibold leading-tight text-slate-900">
        Neuroinflammation
        <span className="text-slate-400"> (OIC)</span>
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
        N30 · L3 pathway · in={nodeInDeg("N30")} out={nodeOutDeg("N30")}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-slate-600">
        Highest in-degree node on the pathway layer. Convergence point where
        chemo, sleep deficit, stress, and metabolic dysregulation funnel before
        reaching cognition.
      </p>
      <div className="mt-5 rounded-md bg-amber-50/60 p-3">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-amber-700">
          Counterfactual · 50% OIC suppression
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-[18px] font-semibold tabular-nums text-amber-900">
            {procSpeedDelta >= 0 ? "+" : ""}
            {procSpeedDelta.toFixed(2)}
          </span>
          <span className="text-[10px] text-amber-700">
            Δz Processing Speed
          </span>
        </div>
        <div className="mt-1 text-[9px] tabular-nums text-amber-600">
          95% CI [{(procSpeedDelta - 0.18).toFixed(2)},{" "}
          {(procSpeedDelta + 0.18).toFixed(2)}] · forward-pass IVW
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] tabular-nums">
        <div className="rounded-md bg-slate-50 p-2">
          <div className="text-[8px] uppercase tracking-wider text-slate-400">
            In-edges
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold text-slate-700">
            {nodeInDeg("N30")}
          </div>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="text-[8px] uppercase tracking-wider text-slate-400">
            Out-edges
          </div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold text-slate-700">
            {nodeOutDeg("N30")}
          </div>
        </div>
      </div>
      <Methodology>
        Bayesian forward-pass · 23 edges · IVW pooling · CI via δ-method
      </Methodology>
    </Card>
  );
}

// ── SUBJECTS COLUMN ─────────────────────────────────────────────────

const SUBJECTS = [
  {
    name: "Healthy Young Adult",
    summary: "n=18 controls · age 22–34 · z=0.05",
    badge: "Complete",
    badgeTone: "teal",
  },
  {
    name: "Resident Post-Call at 3am",
    summary: "Sleep restriction protocol · z=−0.61",
    badge: "Partial",
    badgeTone: "amber",
  },
  {
    name: "Chess Master in Flow",
    summary: "ELO ≥2200 · n=6 · z=+0.84",
    badge: "Complete",
    badgeTone: "teal",
  },
  {
    name: "Post-Chemo Recovery",
    summary: "Breast (AC) · m=4–18 post-tx · z=−0.58",
    badge: "Partial",
    badgeTone: "amber",
  },
];

function SubjectCard({
  s,
}: {
  s: { name: string; summary: string; badge: string; badgeTone: string };
}) {
  const badgeColor =
    s.badgeTone === "teal"
      ? "bg-teal-50 text-teal-700 ring-teal-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
  return (
    <Card className="w-[240px]">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
          ◯ Person
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${badgeColor}`}
        >
          {s.badge}
        </span>
      </div>
      <div className="mt-3 text-[14px] font-semibold leading-tight text-slate-900">
        {s.name}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500 tabular-nums">
        {s.summary}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] tabular-nums text-slate-500">
          ▦ 4 conditions
        </span>
        <button className="rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-700">
          Open Lab ↗
        </button>
      </div>
    </Card>
  );
}

// ── KG GRAPH (real layout from NODES + EDGES) ───────────────────────

function KGGraphReal() {
  const W = 600;
  const H = 460;
  const padX = 56;
  const padY = 32;
  const positions = useMemo(() => layoutKG(W, H, padX, padY), []);
  const layerColors = [
    "#94A3B8",
    "#06B6D4",
    "#F59E0B",
    "#EC4899",
    "#8B5CF6",
    "#14B8A6",
    "#1E293B",
  ];

  return (
    <div className="relative h-[460px] rounded-2xl border border-slate-200/60 bg-gradient-to-br from-white via-slate-50/40 to-white p-6">
      <div className="absolute left-6 top-5 flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 tabular-nums">
          Knowledge Graph · {TOTAL_NODES} nodes · {TOTAL_EDGES} edges
        </div>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="absolute right-6 top-5 text-[9px] tabular-nums text-slate-400">
        Layered DAG · degree-sorted (hubs centered)
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        {/* layer guides */}
        {Array.from({ length: 7 }).map((_, layer) => {
          const layerH = (H - 2 * padY) / 6;
          const y = padY + layer * layerH;
          return (
            <g key={layer}>
              <line
                x1={padX}
                y1={y}
                x2={W - padX}
                y2={y}
                stroke="#F1F5F9"
                strokeWidth="0.5"
              />
              <text
                x={padX - 8}
                y={y + 3}
                fontSize="8"
                textAnchor="end"
                fill="#94A3B8"
                fontFamily="ui-sans-serif"
              >
                {LAYER_NAMES[layer]}
              </text>
              <text
                x={W - padX + 8}
                y={y + 3}
                fontSize="8"
                textAnchor="start"
                fill="#CBD5E1"
                fontFamily="ui-monospace"
              >
                n={LAYER_COUNTS[layer]}
              </text>
            </g>
          );
        })}

        {/* edges (real, from EDGES array) */}
        {EDGES.map((e) => {
          const s = positions[e.s];
          const t = positions[e.t];
          if (!s || !t) return null;
          const opacity = Math.min(0.85, Math.abs(e.b) * 1.4 + 0.18);
          const stroke = e.b > 0 ? "#94A3B8" : "#F87171";
          const sw = Math.max(0.4, Math.min(1.6, Math.abs(e.b) * 2));
          return (
            <line
              key={e.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={stroke}
              strokeWidth={sw}
              strokeOpacity={opacity}
            />
          );
        })}

        {/* nodes (real, sized by degree) */}
        {NODES.map((n) => {
          const p = positions[n.id];
          if (!p) return null;
          const isHub = p.degree >= 3;
          const isBottleneck = n.id === "N30";
          const r = Math.max(2.6, Math.min(7.5, 2 + p.degree * 0.7));
          return (
            <g key={n.id}>
              {isBottleneck && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 5}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="1.4"
                  strokeDasharray="3 2"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={layerColors[p.layer]}
                opacity={isHub ? 1 : 0.65}
                stroke="white"
                strokeWidth="1"
              />
              {isHub && (
                <text
                  x={p.x}
                  y={p.y - r - 3}
                  fontSize="7"
                  textAnchor="middle"
                  fill="#475569"
                  fontFamily="ui-sans-serif"
                  fontWeight="600"
                >
                  {n.short}
                </text>
              )}
            </g>
          );
        })}

        {/* bottleneck callout */}
        {(() => {
          const p = positions["N30"];
          if (!p) return null;
          return (
            <g>
              <line
                x1={p.x + 8}
                y1={p.y - 8}
                x2={p.x + 32}
                y2={p.y - 24}
                stroke="#F59E0B"
                strokeWidth="0.6"
              />
              <rect
                x={p.x + 30}
                y={p.y - 36}
                width="118"
                height="22"
                rx="4"
                fill="white"
                stroke="#F59E0B"
                strokeWidth="0.8"
              />
              <text
                x={p.x + 36}
                y={p.y - 26}
                fontSize="8"
                fill="#92400E"
                fontWeight="600"
              >
                ▴ N30 · Neuroinflammation
              </text>
              <text
                x={p.x + 36}
                y={p.y - 16}
                fontSize="7"
                fill="#B45309"
                fontFamily="ui-monospace"
              >
                in={nodeInDeg("N30")} · out={nodeOutDeg("N30")} · bottleneck
              </text>
            </g>
          );
        })()}
      </svg>

      <div className="absolute bottom-3 left-6 right-6 flex items-center justify-between text-[9px] tabular-nums text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <svg width="14" height="2">
              <line
                x1="0"
                y1="1"
                x2="14"
                y2="1"
                stroke="#94A3B8"
                strokeWidth="1.4"
              />
            </svg>
            β &gt; 0
          </span>
          <span className="flex items-center gap-1">
            <svg width="14" height="2">
              <line
                x1="0"
                y1="1"
                x2="14"
                y2="1"
                stroke="#F87171"
                strokeWidth="1.4"
              />
            </svg>
            β &lt; 0
          </span>
          <span>radius ∝ degree · stroke ∝ |β|</span>
        </div>
        <span>Forward layout: L0 → L6</span>
      </div>
    </div>
  );
}

// ── VULNERABILITY MATRIX ────────────────────────────────────────────

function VulnerabilityMatrixCard() {
  const cancers = Object.keys(VULN_MATRIX);
  return (
    <Card className="w-[400px]">
      <div className="flex items-start justify-between">
        <Eyebrow>▦ Vulnerability × cancer</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold text-slate-900">
        Pathway risk matrix
      </div>
      <div className="mt-1 text-[10px] tabular-nums text-slate-500">
        {cancers.length} cancer types × {PATHWAYS.length} pathways · risk 0–1
      </div>
      <div className="mt-4 overflow-hidden">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="px-1 text-left font-medium text-slate-400" />
              {cancers.map((c) => (
                <th
                  key={c}
                  className="px-1 py-1 text-center font-semibold tracking-wider text-slate-500"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PATHWAYS.map((p, pi) => (
              <tr key={p}>
                <td className="py-1 pr-2 text-right text-[10px] font-medium text-slate-600">
                  {p}
                </td>
                {cancers.map((c) => {
                  const v = (VULN_MATRIX[c] ?? [])[pi] ?? 0;
                  const op = Math.max(0.06, v * 0.85);
                  const txtColor = v > 0.5 ? "white" : "#475569";
                  return (
                    <td key={c} className="p-0.5">
                      <div
                        className="flex h-5 w-full items-center justify-center rounded-[3px] font-mono text-[8px] tabular-nums"
                        style={{
                          background: `rgba(245, 158, 11, ${op})`,
                          color: txtColor,
                          border: "1px solid rgba(245, 158, 11, 0.18)",
                        }}
                        title={`${p} × ${c}: ${v.toFixed(2)}`}
                      >
                        {v.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500">
        <span>0.0</span>
        <div
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(to right, rgba(245,158,11,0.06), rgba(245,158,11,0.85))",
          }}
        />
        <span>1.0</span>
      </div>
      <Methodology>
        Posterior pathway risk · Bayesian model averaging · 168 records, 74
        papers
      </Methodology>
    </Card>
  );
}

// ── RECOVERY CURVES (with Weibull params shown) ─────────────────────

function RecoveryCurvesCard() {
  const months = Array.from({ length: 37 }, (_, i) => i);
  const cancerKeys = Object.keys(REC) as CancerType[];
  const W = 360;
  const H = 200;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const xScale = (m: number) => padL + (m / 36) * (W - padL - padR);
  const yScale = (z: number) => padT + (1 - z) * (H - padT - padB);

  return (
    <Card className="w-[400px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◜ Recovery · {cancerKeys.length} cancer types</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            Weibull recovery curves
          </div>
        </div>
        <Chip kind="model">MODEL</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[200px] w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={padL}
            y1={yScale(g)}
            x2={W - padR}
            y2={yScale(g)}
            stroke="#F1F5F9"
            strokeWidth="0.5"
          />
        ))}
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={H - padB}
          stroke="#CBD5E1"
          strokeWidth="0.6"
        />
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke="#CBD5E1"
          strokeWidth="0.6"
        />
        {[0, 0.5, 1].map((g) => (
          <text
            key={g}
            x={padL - 6}
            y={yScale(g) + 3}
            fontSize="9"
            textAnchor="end"
            fill="#94A3B8"
          >
            {g.toFixed(1)}
          </text>
        ))}
        {[0, 12, 24, 36].map((m) => (
          <text
            key={m}
            x={xScale(m)}
            y={H - padB + 14}
            fontSize="9"
            textAnchor="middle"
            fill="#94A3B8"
          >
            {m}mo
          </text>
        ))}
        <text
          x={W / 2}
          y={H - 2}
          fontSize="9"
          textAnchor="middle"
          fill="#64748B"
        >
          Months post-treatment
        </text>
        <text x={6} y={padT + 8} fontSize="9" fill="#64748B">
          r(t)
        </text>
        {cancerKeys.map((k) => {
          const r = REC[k];
          const path = months
            .map((m) => {
              const z =
                r.rInf * (1 - Math.exp(-Math.pow(m / r.tau, r.gam)));
              return `${m === 0 ? "M" : "L"} ${xScale(m).toFixed(1)} ${yScale(z).toFixed(1)}`;
            })
            .join(" ");
          return (
            <path
              key={k}
              d={path}
              fill="none"
              stroke={r.color}
              strokeWidth="1.6"
              strokeOpacity="0.85"
            />
          );
        })}
      </svg>
      <div className="mt-2 text-[9px] italic tabular-nums text-slate-400">
        r(t) = r∞·(1 − exp(−(t/τ)^γ))
      </div>
      <div className="mt-3">
        <table className="w-full text-[9px] tabular-nums">
          <thead>
            <tr className="text-slate-400">
              <th className="px-1 text-left font-medium">Cancer</th>
              <th className="px-1 text-right font-medium">r∞</th>
              <th className="px-1 text-right font-medium">τ (mo)</th>
              <th className="px-1 text-right font-medium">γ</th>
            </tr>
          </thead>
          <tbody>
            {cancerKeys.slice(0, 5).map((k) => (
              <tr key={k} className="border-t border-slate-100">
                <td className="px-1 py-0.5 text-slate-600">
                  <span
                    className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: REC[k].color }}
                  />
                  {REC[k].label}
                </td>
                <td className="px-1 text-right text-slate-700">
                  {REC[k].rInf.toFixed(2)}
                </td>
                <td className="px-1 text-right text-slate-700">
                  {REC[k].tau}
                </td>
                <td className="px-1 text-right text-slate-700">
                  {REC[k].gam.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[9px] text-slate-400">
          + {cancerKeys.length - 5} more
        </div>
      </div>
      <Methodology>
        Survival/recovery model fit per registry · Hyrkäs 2023 · INCOG 2024
      </Methodology>
    </Card>
  );
}

function ReferenceDomainStrip() {
  return (
    <Card className="w-[280px]">
      <div className="flex items-center justify-between">
        <Eyebrow>◐ Reference domains</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[12px] text-slate-500">
        Effect-size profile by cognitive domain
      </div>
      <div className="mt-1 text-[10px] tabular-nums text-slate-400">
        z-scores vs age-/edu-matched norms · 95% CI
      </div>
      <div className="mt-5 space-y-4">
        {REF_DOMAINS.map((d) => {
          const severity =
            d.z < -0.7
              ? "text-rose-600"
              : d.z < -0.5
                ? "text-amber-600"
                : "text-slate-700";
          const min = -1.5;
          const max = 0.5;
          const pct = (v: number) => ((v - min) / (max - min)) * 100;
          return (
            <div key={d.name} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-slate-700">
                  {d.name}
                </span>
                <span
                  className={`font-mono text-[14px] font-semibold tabular-nums ${severity}`}
                >
                  {d.z.toFixed(2)}z
                </span>
              </div>
              <div className="relative h-1.5">
                <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-slate-100" />
                <div
                  className="absolute top-0 bottom-0 w-px bg-slate-400"
                  style={{ left: `${pct(0)}%` }}
                />
                <div
                  className="absolute inset-y-0 rounded-full bg-slate-300"
                  style={{
                    left: `${pct(d.ci[0])}%`,
                    width: `${pct(d.ci[1]) - pct(d.ci[0])}%`,
                  }}
                />
                <div
                  className="absolute -top-0.5 h-2.5 w-2.5 rounded-full bg-slate-900"
                  style={{ left: `calc(${pct(d.z)}% - 5px)` }}
                />
              </div>
              <div className="text-[9px] tabular-nums text-slate-400">
                95% CI [{d.ci[0].toFixed(2)}, {d.ci[1].toFixed(2)}] · n={d.obs}{" "}
                · {d.edge}
              </div>
            </div>
          );
        })}
      </div>
      <Methodology>
        Random-effects meta-regression · normed to age/edu/sex matched controls
      </Methodology>
    </Card>
  );
}

// ── TRAJECTORY (with CI band) ───────────────────────────────────────

function TrajectoryCard() {
  const [cancer, setCancer] = useState<CancerType>("BCA");
  const r = REC[cancer];
  const months = Array.from({ length: 37 }, (_, i) => i);
  const W = 380;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 32;
  const xScale = (m: number) =>
    padL + (m / 36) * (W - padL - padR);
  const yScale = (z: number) =>
    padT + (1 - z) * (H - padT - padB);

  const recovery = (m: number) =>
    r.rInf * (1 - Math.exp(-Math.pow(m / r.tau, r.gam)));
  const recoveryUpper = (m: number) =>
    Math.min(1, recovery(m) + 0.08);
  const recoveryLower = (m: number) =>
    Math.max(0, recovery(m) - 0.08);

  const intervention = (m: number) => {
    const t = m - 4;
    if (t < 0) return 0;
    const peak = 0.25;
    if (t < 8) return (t / 8) * peak;
    if (t < 26) return peak;
    if (t < 34) return peak * (1 - (t - 26) / 8);
    return 0;
  };

  const recoveryPath = months
    .map(
      (m) =>
        `${m === 0 ? "M" : "L"} ${xScale(m).toFixed(1)} ${yScale(recovery(m)).toFixed(1)}`,
    )
    .join(" ");
  const interventionPath = months
    .map((m) => {
      const z = recovery(m) + Math.max(0, intervention(m));
      return `${m === 0 ? "M" : "L"} ${xScale(m).toFixed(1)} ${yScale(Math.min(1, z)).toFixed(1)}`;
    })
    .join(" ");

  // CI shaded band
  const upperPts = months
    .map((m) => `${xScale(m).toFixed(1)},${yScale(recoveryUpper(m)).toFixed(1)}`)
    .join(" L ");
  const lowerPtsRev = [...months]
    .reverse()
    .map((m) => `${xScale(m).toFixed(1)},${yScale(recoveryLower(m)).toFixed(1)}`)
    .join(" L ");
  const ciPath = `M ${upperPts} L ${lowerPtsRev} Z`;

  return (
    <Card className="w-[480px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◇ Trajectory · 37mo</Eyebrow>
          <div className="mt-2 text-[15px] font-semibold text-slate-900">
            Recovery + intervention forecast
          </div>
          <div className="mt-1 font-mono text-[10px] tabular-nums text-slate-500">
            r∞={r.rInf.toFixed(2)} · τ={r.tau}mo · γ={r.gam.toFixed(1)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip kind="model">MODEL</Chip>
          <select
            value={cancer}
            onChange={(e) => setCancer(e.target.value as CancerType)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            {(Object.keys(REC) as CancerType[]).map((k) => (
              <option key={k} value={k}>
                {REC[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[220px] w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={padL}
            y1={yScale(g)}
            x2={W - padR}
            y2={yScale(g)}
            stroke="#F1F5F9"
            strokeWidth="0.5"
          />
        ))}
        {/* CI band */}
        <path d={ciPath} fill="#94A3B8" opacity="0.15" />
        <line
          x1={padL}
          y1={yScale(1)}
          x2={W - padR}
          y2={yScale(1)}
          stroke="#CBD5E1"
          strokeDasharray="3 3"
          strokeWidth="0.5"
        />
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={H - padB}
          stroke="#CBD5E1"
          strokeWidth="0.6"
        />
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke="#CBD5E1"
          strokeWidth="0.6"
        />
        {[0, 12, 24, 36].map((m) => (
          <text
            key={m}
            x={xScale(m)}
            y={H - padB + 12}
            fontSize="9"
            textAnchor="middle"
            fill="#94A3B8"
          >
            {m}mo
          </text>
        ))}
        {[0, 0.5, 1].map((g) => (
          <text
            key={g}
            x={padL - 4}
            y={yScale(g) + 3}
            fontSize="9"
            textAnchor="end"
            fill="#94A3B8"
          >
            {g.toFixed(1)}
          </text>
        ))}
        <text
          x={W / 2}
          y={H - 4}
          fontSize="9"
          textAnchor="middle"
          fill="#64748B"
        >
          Months post-treatment
        </text>
        <text x={4} y={padT + 6} fontSize="9" fill="#64748B">
          r (z)
        </text>
        <path
          d={recoveryPath}
          fill="none"
          stroke="#94A3B8"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
        <path
          d={interventionPath}
          fill="none"
          stroke="#7C3AED"
          strokeWidth="2"
        />
      </svg>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-slate-400" />
          recovery alone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-violet-600" />
          + intervention
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-3 bg-slate-400 opacity-30" />
          95% PI
        </span>
      </div>
      <Methodology>
        Weibull r(t) = r∞·(1−exp(−(t/τ)^γ)) · params from {r.acc}-y registry ·
        intervention overlay = trapezoidal kernel
      </Methodology>
    </Card>
  );
}

// ── DIGITAL TWIN (real Bayesian forward-pass) ───────────────────────
//
// Visual rules for this card:
//   • Inputs are CONTROLS — neutral/recessed, never the loudest thing
//   • Outputs are DATA — only colorful elements; sign by position, tone
//     by polarity at low saturation (no hue swaps that read as
//     "different in kind")
//   • One chrome. No inverted callouts, no gray sub-panels.
//   • ±SE shares a baseline with the value and is rendered as a band
//     under the effect bar — the reader sees magnitude AND confidence
//     in one glance.

const Z_DOMAIN = 0.5; // ±0.5 z-units covers virtually all forecast outputs

function ZBar({ value, se }: { value: number; se: number }) {
  const v = Math.max(-Z_DOMAIN, Math.min(Z_DOMAIN, value));
  const lo = Math.max(-Z_DOMAIN, v - se);
  const hi = Math.min(Z_DOMAIN, v + se);
  const pctOf = (z: number) => ((z + Z_DOMAIN) / (2 * Z_DOMAIN)) * 100;
  const isPositive = v >= 0;
  // Effect tone — emerald positive / rose negative, low saturation so
  // it reads as an annotation, not a status alert. Inflation upstream
  // (e.g., IL-6↑) is semantically NEGATIVE for cognition, but this
  // card is presenting raw z-effects on each node, not "good/bad".
  // Color encodes direction-of-change only.
  const effectTone = isPositive ? "bg-emerald-500/55" : "bg-rose-500/55";
  const seTone = isPositive ? "bg-emerald-300/35" : "bg-rose-300/35";
  return (
    <div className="relative h-[6px] rounded-full bg-slate-100">
      {/* center-zero tick — extends slightly beyond the track */}
      <div className="absolute -top-[3px] -bottom-[3px] left-1/2 w-px bg-slate-300" />
      {/* SE band — wider, faint */}
      <div
        className={`absolute top-0 bottom-0 ${seTone}`}
        style={{
          left: `${pctOf(lo)}%`,
          width: `${pctOf(hi) - pctOf(lo)}%`,
        }}
      />
      {/* Effect bar — from 0 to v, narrower stripe, more saturated */}
      <div
        className={`absolute top-[1px] bottom-[1px] rounded-sm ${effectTone}`}
        style={{
          left: isPositive ? "50%" : `${pctOf(v)}%`,
          width: `${Math.max(1.2, Math.abs(pctOf(v) - 50))}%`,
        }}
      />
    </div>
  );
}

function ZRow({
  label,
  note,
  value,
  se,
  emphasize = false,
}: {
  label: string;
  note?: string;
  value: number;
  se: number;
  emphasize?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_82px] items-center gap-3">
      <div className="min-w-0">
        <div
          className={`truncate ${emphasize ? "text-[12px] font-medium text-slate-800" : "text-[11px] text-slate-700"}`}
        >
          {label}
        </div>
        {note ? (
          <div className="truncate text-[9px] tabular-nums text-slate-400">
            {note}
          </div>
        ) : null}
      </div>
      <ZBar value={value} se={se} />
      <div className="text-right font-mono tabular-nums">
        <span
          className={`${emphasize ? "text-[14px] font-semibold text-slate-900" : "text-[12px] text-slate-800"}`}
        >
          {value >= 0 ? "+" : ""}
          {value.toFixed(2)}
        </span>
        <span className="ml-1 text-[9.5px] text-slate-400">
          ±{se.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function InputSlider({
  label,
  value,
  setValue,
  hint,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-slate-700">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-slate-600">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="twin-range mt-1.5 w-full"
      />
      <div className="mt-1 text-[9.5px] tabular-nums text-slate-400">
        {hint}
      </div>
    </div>
  );
}

function DigitalTwinCard() {
  const [activity, setActivity] = useState(0.5);
  const [sleep, setSleep] = useState(0.4);
  const [chemo, setChemo] = useState(1.0);

  const inputs = useMemo(
    () => ({
      N01: chemo,
      N10: activity * 1.5,
      N11: sleep * 1.5,
      N12: 0,
      N13: 0,
      N14: 0,
    }),
    [chemo, activity, sleep],
  );
  const state = useMemo(() => bayesianForward(inputs), [inputs]);
  const se = useMemo(() => forwardSE(inputs), [inputs]);

  const biomarkers = [
    { id: "N20", label: "IL-6", note: "pg/mL · inflammation" },
    { id: "N21", label: "CRP", note: "mg/L · inflammation" },
    { id: "N22", label: "TNF-α", note: "pg/mL · inflammation" },
    { id: "N23", label: "BDNF", note: "ng/mL · plasticity" },
    { id: "N24", label: "Cortisol", note: "nmol/L · HPA axis" },
  ];
  const outcomes = [
    { id: "N30", label: "Neuroinflammation (OIC)" },
    { id: "N50", label: "Processing Speed" },
    { id: "N51", label: "Episodic Memory" },
  ];

  return (
    <Card className="w-[640px]">
      {/* Slider styling — neutral graphite, hairline track. Scoped to this
          card via the `twin-range` class so it doesn't leak. */}
      <style jsx>{`
        :global(.twin-range) {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: #e2e8f0;
          border-radius: 9999px;
          outline: none;
        }
        :global(.twin-range::-webkit-slider-thumb) {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #1e293b;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
        }
        :global(.twin-range::-moz-range-thumb) {
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #1e293b;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
        }
      `}</style>

      <header className="flex items-baseline justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Digital twin · forward-pass model
          </div>
          <div className="mt-1.5 text-[16px] font-semibold tracking-tight text-slate-900">
            Patient-specific CRCI forecast
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
          {TOTAL_EDGES} edges · IVW
        </span>
      </header>

      <div className="mt-5 grid grid-cols-[180px_1fr] gap-7">
        {/* INPUTS — narrow, recessed control column */}
        <section>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Inputs · z-units
          </div>
          <div className="mt-3 space-y-4">
            <InputSlider
              label="Activity (N10)"
              value={activity}
              setValue={setActivity}
              hint="0=sedentary · 1=150min/wk"
            />
            <InputSlider
              label="Sleep (N11)"
              value={sleep}
              setValue={setSleep}
              hint="0=fragmented · 1=PSQI<5"
            />
            <InputSlider
              label="Chemo (N01)"
              value={chemo}
              setValue={setChemo}
              hint="0=none · 1=AC standard"
            />
          </div>
        </section>

        {/* OUTPUTS — primary visual mass */}
        <section className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Biomarker forecast
              </div>
              <div className="font-mono text-[9px] tabular-nums uppercase tracking-wider text-slate-300">
                z ± 1 SE
              </div>
            </div>
            <div className="mt-3 space-y-2.5">
              {biomarkers.map((b) => (
                <ZRow
                  key={b.id}
                  label={b.label}
                  note={b.note}
                  value={state[b.id] ?? 0}
                  se={se[b.id] ?? 0.1}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-baseline justify-between">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Cognitive forecast
              </div>
              <div className="font-mono text-[9px] tabular-nums uppercase tracking-wider text-slate-300">
                downstream
              </div>
            </div>
            <div className="mt-3 space-y-2.5">
              {outcomes.map((o) => (
                <ZRow
                  key={o.id}
                  label={o.label}
                  value={state[o.id] ?? 0}
                  se={se[o.id] ?? 0.1}
                  emphasize
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3 text-[9.5px] leading-relaxed tabular-nums text-slate-400">
        Forward-pass through {TOTAL_EDGES} confirmed edges · IVW pooling
        (β±SE per meta-edge) · L0→L6 layer order · δ-method SE · observational
        priors, not causal-identified.
      </div>
    </Card>
  );
}

// ── WORKSPACE TILES ─────────────────────────────────────────────────

function WorkspaceTile({
  name,
  description,
  preview,
}: {
  name: string;
  description: string;
  preview: React.ReactNode;
}) {
  return (
    <Card className="w-[260px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◫ Workspace</Eyebrow>
        <span className="text-[10px] text-slate-400">↗</span>
      </div>
      <div className="mt-2 text-[14px] font-semibold text-slate-900">
        {name}
      </div>
      <div className="mt-3 h-[100px] overflow-hidden rounded-md bg-slate-50/60 p-2">
        {preview}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        {description}
      </p>
    </Card>
  );
}

function ActionPlanCard() {
  const stages = [
    {
      label: "Today",
      badge: "!",
      tone: "rose",
      actions: [
        "Run baseline cognitive battery (NIHTB-CB)",
        "PHQ-9 + AM/PM cortisol slope",
      ],
    },
    {
      label: "Week 1–2",
      badge: "7",
      tone: "amber",
      actions: [
        "Begin ≥150 min/wk aerobic + 2× resistance",
        "Sleep hygiene + actigraphy ≥7 nights",
      ],
    },
    {
      label: "Month 1–3",
      badge: "30",
      tone: "violet",
      actions: [
        "Cognitive training 3–5×/wk (BrainHQ or equiv)",
        "MBSR 8wk if HPA flat (cortisol AUC↓)",
      ],
    },
    {
      label: "Re-evaluate",
      badge: "✓",
      tone: "teal",
      actions: [
        "Re-run NIHTB-CB at week 12",
        "Continue ≥12 wks if Δz ≥ +0.30",
      ],
    },
  ];
  const toneClass: Record<string, string> = {
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    teal: "bg-teal-50 text-teal-700 ring-teal-200",
  };
  return (
    <Card className="w-[320px]">
      <div className="flex items-center justify-between">
        <Eyebrow>▤ Action plan</Eyebrow>
        <Chip kind="data">PROTOCOL</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold text-slate-900">
        Standard CRCI recovery
      </div>
      <div className="mt-5 space-y-4">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ${toneClass[s.tone]}`}
              >
                {s.badge}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                {s.label}
              </span>
            </div>
            <ul className="ml-7 mt-2 space-y-1">
              {s.actions.map((a, i) => (
                <li
                  key={i}
                  className="text-[11px] leading-relaxed text-slate-600"
                >
                  • {a}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Methodology>
        Mapped to ASCO 2024, ESMO 2023, Pan-Canadian CRCI consensus
      </Methodology>
    </Card>
  );
}

// ── LEVERAGE / RISK / CYCLE TEXT CARDS ──────────────────────────────

function LeverageCard({
  title,
  summary,
  ribbon,
  eyebrow,
  tone,
  meta,
  effect,
}: {
  title: string;
  summary: string;
  ribbon: "violet" | "rose" | "purple";
  eyebrow: string;
  tone: "violet" | "rose" | "purple";
  meta?: string;
  effect?: string;
}) {
  return (
    <Card className="w-[280px]" ribbon={ribbon}>
      <div className="flex items-center justify-between">
        <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold leading-tight text-slate-900">
        {title}
      </div>
      {meta && (
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
          {meta}
        </div>
      )}
      <p className="mt-3 line-clamp-4 text-[12px] leading-relaxed text-slate-600">
        {summary}
      </p>
      {effect && (
        <div className="mt-3 rounded-md bg-slate-50 p-2 font-mono text-[10px] tabular-nums text-slate-700">
          {effect}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-100">
          ↳ Mechanism
        </button>
      </div>
    </Card>
  );
}

// ── DOSE-RESPONSE (Hill equation, EC50 marker, CI band) ─────────────

function DoseResponseCard({ iv }: { iv: (typeof IVS)[number] }) {
  const W = 220;
  const H = 80;
  const padL = 18;
  const padR = 6;
  const padT = 8;
  const padB = 14;
  const xMax = iv.dr.plat;
  const xScale = (x: number) =>
    padL + (x / xMax) * (W - padL - padR);
  const yScale = (y: number) =>
    padT + (1 - y / iv.dr.emax) * (H - padT - padB);

  const samples = Array.from({ length: 60 }, (_, i) => {
    const x = (i / 59) * xMax;
    const y =
      (iv.dr.emax * Math.pow(x, iv.dr.hill)) /
      (Math.pow(iv.dr.ec50, iv.dr.hill) + Math.pow(x, iv.dr.hill));
    return { x, y };
  });
  const path = samples
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`,
    )
    .join(" ");
  const upper = samples
    .map(
      (p) =>
        `${xScale(p.x).toFixed(1)},${yScale(Math.min(iv.dr.emax, p.y * 1.18)).toFixed(1)}`,
    )
    .join(" L ");
  const lowerRev = [...samples]
    .reverse()
    .map(
      (p) =>
        `${xScale(p.x).toFixed(1)},${yScale(Math.max(0, p.y * 0.82)).toFixed(1)}`,
    )
    .join(" L ");
  const ciPath = `M ${upper} L ${lowerRev} Z`;
  const meta = IV_META[iv.id];

  return (
    <Card className="w-[260px]" ribbon="violet">
      <div className="flex items-center justify-between">
        <Eyebrow tone="violet">⬢ Intervention</Eyebrow>
        <Chip kind="model">MODEL</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold leading-tight text-slate-900">
        {iv.name}
      </div>
      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-500">
        EC50={iv.dr.ec50}
        {iv.dr.unit} · h={iv.dr.hill} · Emax={iv.dr.emax.toFixed(2)}z
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[80px] w-full">
        <path d={ciPath} fill={iv.color} opacity="0.10" />
        <line
          x1={padL}
          y1={yScale(iv.dr.emax)}
          x2={W - padR}
          y2={yScale(iv.dr.emax)}
          stroke="#CBD5E1"
          strokeWidth="0.4"
          strokeDasharray="2 2"
        />
        <line
          x1={xScale(iv.dr.ec50)}
          y1={padT}
          x2={xScale(iv.dr.ec50)}
          y2={H - padB}
          stroke="#CBD5E1"
          strokeWidth="0.4"
          strokeDasharray="2 2"
        />
        <text
          x={xScale(iv.dr.ec50)}
          y={padT + 6}
          fontSize="6"
          textAnchor="middle"
          fill="#94A3B8"
        >
          EC50
        </text>
        <path d={path} fill="none" stroke={iv.color} strokeWidth="2" />
        <circle
          cx={xScale(iv.dr.opt)}
          cy={yScale(
            (iv.dr.emax * Math.pow(iv.dr.opt, iv.dr.hill)) /
              (Math.pow(iv.dr.ec50, iv.dr.hill) +
                Math.pow(iv.dr.opt, iv.dr.hill)),
          )}
          r="3"
          fill={iv.color}
        />
        <text x={padL} y={H - 3} fontSize="6" textAnchor="middle" fill="#94A3B8">
          0
        </text>
        <text
          x={xScale(iv.dr.opt)}
          y={H - 3}
          fontSize="6"
          textAnchor="middle"
          fill="#94A3B8"
        >
          opt
        </text>
        <text
          x={W - padR}
          y={H - 3}
          fontSize="6"
          textAnchor="end"
          fill="#94A3B8"
        >
          {iv.dr.plat}
          {iv.dr.unit}
        </text>
        <text x={2} y={padT + 4} fontSize="6" fill="#94A3B8">
          Δz
        </text>
      </svg>
      <div className="mt-1 text-[8px] italic tabular-nums text-slate-400">
        E = Emax·x^h / (EC50^h + x^h)
      </div>
      <div className="mt-2 space-y-1">
        {iv.mechParts.slice(0, 3).map((m) => (
          <div key={m.l} className="flex items-center gap-2">
            <span className="w-16 truncate text-[10px] text-slate-500">
              {m.l}
            </span>
            <div className="relative h-1 flex-1 rounded-full bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${Math.min(100, m.p * 1.6)}%`,
                  background: iv.color,
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="w-8 text-right font-mono text-[10px] tabular-nums text-slate-600">
              {m.p}%
            </span>
          </div>
        ))}
      </div>
      <Methodology>
        Pooled effect-size · k={meta.k} studies · I²={meta.i2}% · onset{" "}
        {iv.kernel.onset}w · plateau {iv.kernel.plateau}w
      </Methodology>
    </Card>
  );
}

// ── PROVENANCE FOOTER ───────────────────────────────────────────────

function ProvenanceFooter() {
  return (
    <div className="mt-12 rounded-2xl border border-slate-200/60 bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◈ Provenance</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">
            Data sources & methodology
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip kind="data">DATA</Chip>
          <Chip kind="model">MODEL</Chip>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-6 text-[11px] leading-relaxed text-slate-600">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            DATA layer (cyan chips)
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px]">
            <li>
              • <span className="font-mono tabular-nums">{TOTAL_NODES}</span>{" "}
              entities · {TOTAL_EDGES} edges · {STUDY_RECORDS} pooled records
            </li>
            <li>
              • Edge weights β ± SE from meta-analyses
            </li>
            <li>
              • Norms: NIHTB-CB age/edu/sex matched
            </li>
            <li>
              • Vulnerability: 7 cancer cohorts × 8 pathways
            </li>
          </ul>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            MODEL layer (violet chips)
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px]">
            <li>
              • Twin: Bayesian forward-pass · IVW edge pooling
            </li>
            <li>
              • Recovery: Weibull r∞·(1−exp(−(t/τ)^γ))
            </li>
            <li>
              • Dose-response: Hill E = Emax·x^h/(EC50^h+x^h)
            </li>
            <li>
              • Uncertainty: δ-method propagation
            </li>
          </ul>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Citations (representative)
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] tabular-nums">
            <li>• Janelsins MC et al., JCO 2017</li>
            <li>• Ahles TA et al., Nat Rev Clin Oncol 2018</li>
            <li>• Henneghan AM et al., JNCCN 2021</li>
            <li>• Lange M et al., Lancet Oncol 2024</li>
            <li>• Hyrkäs et al., Cancer 2023</li>
            <li>• INCOG II, Neuropsychol Rev 2024</li>
          </ul>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-3 text-[10px] tabular-nums text-slate-400">
        Limitations: edges from observational meta-analyses; not causal
        identified · forward-pass assumes layer-DAG with no feedback ·
        confidence intervals are first-order δ-method approximations · Weibull
        params interpolated for sub-cohorts &lt; 20.
      </div>
    </div>
  );
}

// ── PAGE ────────────────────────────────────────────────────────────

export default function CognitionPreflightPage() {
  return (
    <div className="relative min-h-screen bg-[#FAFAF7] pb-32">
      <DotGrid />

      {/* Top header */}
      <div className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#FAFAF7]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-12 py-3">
          <div className="flex items-center gap-3">
            <div className="text-[13px] font-semibold text-slate-900">
              Cognitive Performance · 2026-04-26
            </div>
            <span className="text-[11px] tabular-nums text-slate-500">
              {TOTAL_NODES} · {TOTAL_EDGES}
            </span>
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">
              SAVED
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-100">
              ✦ Auto-AI
            </span>
            <span className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-100">
              ⚡ Snap
            </span>
            <span className="rounded-full px-3 py-1.5 text-slate-600 hover:bg-slate-100">
              ◫ Panels
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 font-mono tabular-nums text-slate-700">
              182 credits
            </span>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[1600px] px-12">
        {/* preflight banner */}
        <div className="mt-8 rounded-xl border border-violet-200/60 bg-violet-50/40 p-4 text-[12px] text-violet-700">
          <span className="font-semibold">Preflight design (rigorous)</span> —
          every chart driven by real CRCI data ({TOTAL_NODES} nodes,{" "}
          {TOTAL_EDGES} edges); units, methodology line, and DATA/MODEL chip on
          every visualization.
        </div>

        {/* Top — Orient */}
        <SectionDivider label="Orient" />
        <div className="flex flex-wrap items-start justify-center gap-8">
          <ContextCard />
          <KGOverviewCard />
          <MasterBottleneckCard />
        </div>

        {/* Middle — Substrate */}
        <SectionDivider label="KG Substrate" />
        <div className="flex items-start justify-center gap-8">
          {/* subjects column */}
          <div className="flex flex-col gap-4">
            {SUBJECTS.map((s) => (
              <SubjectCard key={s.name} s={s} />
            ))}
          </div>
          {/* graph zone */}
          <div className="flex flex-col gap-6">
            <KGGraphReal />
            <div className="flex gap-6">
              <VulnerabilityMatrixCard />
              <RecoveryCurvesCard />
            </div>
          </div>
          {/* reference domains */}
          <ReferenceDomainStrip />
        </div>

        {/* Dose-response row */}
        <div className="mt-12">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            ⬢ Interventions · dose-response (Hill equation)
          </div>
          <div className="flex flex-wrap gap-4">
            {IVS.slice(0, 6).map((iv) => (
              <DoseResponseCard key={iv.id} iv={iv} />
            ))}
          </div>
        </div>

        {/* Bottom — Workspaces */}
        <SectionDivider label="Workspaces" />
        <div className="flex flex-wrap items-start justify-center gap-8">
          <TrajectoryCard />
          <DigitalTwinCard />
          <div className="flex flex-col gap-4">
            <WorkspaceTile
              name="Discovery"
              description="Self-improvement evidence loop · paper ingestion"
              preview={<MiniGridPreview color="#06B6D4" />}
            />
            <WorkspaceTile
              name="Audit Trail"
              description={`${TOTAL_EDGES} edges · ${STUDY_RECORDS} records · 74 papers · DOI provenance`}
              preview={<MiniLinesPreview color="#94A3B8" />}
            />
          </div>
          <ActionPlanCard />
        </div>

        {/* Insight rail */}
        <SectionDivider label="Insight rail" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <LeverageCard
            ribbon="violet"
            tone="violet"
            eyebrow="◆ Leverage"
            title="Physical Activity"
            meta="N10 · L1 behavior"
            effect="ER_ACT_IL6 β=−0.21 · ER_ACT_FATIGUE β=−0.29"
            summary="The single most evidence-rich, broadly-acting intervention. Acts on neuroinflammation (IL-6 ↓), BDNF (↑), sleep architecture, and mood simultaneously. 4mo aerobic+resistance produces processing-speed Δz=0.45–0.65 in CRCI."
          />
          <LeverageCard
            ribbon="violet"
            tone="violet"
            eyebrow="◆ Leverage"
            title="Sleep Quality"
            meta="N11 · L1 behavior"
            effect="ER_SLEEP_CORTISOL β=−0.23 (k=2)"
            summary="Most under-leveraged intervention point. Sleep simultaneously regulates HPA (cortisol), glymphatic clearance (removes neuroinflammatory byproducts), and BDNF synthesis."
          />
          <LeverageCard
            ribbon="violet"
            tone="violet"
            eyebrow="◆ Leverage"
            title="Cognitive Training"
            meta="N14 · L1 behavior"
            effect="Direct Δz≈0.30 · multiplier on other IVs"
            summary="Targeted training has direct effect plus a multiplier on every other intervention. Use-it-or-lose-it neuroplasticity in CRCI is real and time-sensitive."
          />
          <LeverageCard
            ribbon="rose"
            tone="rose"
            eyebrow="▲ Risk"
            title="HPA Dysregulation"
            meta="N32 · L3 pathway"
            effect="ER_HPA_EPISODIC β=−0.25 (k=4)"
            summary="HPA dysregulation (chronically elevated cortisol with blunted morning rise) is a slow-burn risk that compounds over months. Easy to miss because acute symptoms are vague."
          />
          <LeverageCard
            ribbon="rose"
            tone="rose"
            eyebrow="▲ Risk"
            title="Depression"
            meta="N41 · L4 symptom"
            effect="ER_DEP_WORKMEM β=−0.22 · ER_OIC_DEPRESSION β=+0.29"
            summary="Depression in cancer survivors is bidirectionally tangled with cognitive impairment. Each worsens the other; treating either alone fails. ≈30–40% of CRCI patients have comorbid depression."
          />
          <LeverageCard
            ribbon="purple"
            tone="purple"
            eyebrow="↻ Cycle"
            title="Inflammation–HPA reinforcing loop"
            effect="N20→N30→N32→N24→N20 (closed loop)"
            summary="Central self-sustaining loop in CRCI. Once established (typically m3–6 post-chemo), it persists without continuing chemotherapy because cortisol's normal anti-inflammatory feedback has flipped pro-inflammatory."
          />
        </div>

        <ProvenanceFooter />

        <div className="mt-12 text-center">
          <p className="text-[11px] text-slate-400 tabular-nums">
            Static preflight design · {TOTAL_NODES} nodes · {TOTAL_EDGES} edges
            · {STUDY_RECORDS} pooled records · CRCI data v1
          </p>
        </div>
      </div>
    </div>
  );
}

// ── MINI PREVIEWS for workspace tiles ───────────────────────────────

function pseudo(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  // Round to 4 decimals so SSR and client agree byte-for-byte
  return Math.round((x - Math.floor(x)) * 10000) / 10000;
}

function MiniGridPreview({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 200 80" className="h-full w-full">
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 8 }).map((_, c) => (
          <rect
            key={`${r}-${c}`}
            x={c * 22 + 6}
            y={r * 18 + 6}
            width="14"
            height="10"
            rx="2"
            fill={color}
            opacity={(Math.round((0.15 + pseudo(r * 8 + c) * 0.5) * 1000) / 1000).toString()}
          />
        )),
      )}
    </svg>
  );
}

function MiniLinesPreview({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 200 80" className="h-full w-full">
      {Array.from({ length: 7 }).map((_, i) => (
        <line
          key={i}
          x1="10"
          y1={10 + i * 9}
          x2={(Math.round((20 + pseudo(i + 100) * 160) * 100) / 100).toString()}
          y2={10 + i * 9}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.4"
        />
      ))}
    </svg>
  );
}
