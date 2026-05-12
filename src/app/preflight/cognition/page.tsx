// ── Cognition template · preflight design (rigorous) ────────────────
//
// Static visual preview of the cognition-template whiteboard. Every chart
// is driven by real CRCI data (NODES + EDGES + meta params) — no decorative
// fillers. Each visualization carries: units, methodology line, citation
// trail, and a DATA / MODEL chip distinguishing measured quantities from
// model output.

"use client";

import { OperationalTimeline } from "./operational-timeline";
import React, { useMemo, useState } from "react";
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

// ── MULTI-VIEW LENSES (4 KG layouts side-by-side) ───────────────────

function MiniLayered({ W = 220, H = 160 }: { W?: number; H?: number }) {
  const padX = 18;
  const padY = 12;
  const positions = useMemo(() => layoutKG(W, H, padX, padY), [W, H]);
  const layerColors = ["#94A3B8", "#06B6D4", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#1E293B"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {EDGES.map((e) => {
        const s = positions[e.s]; const t = positions[e.t];
        if (!s || !t) return null;
        return <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={e.b > 0 ? "#CBD5E1" : "#FCA5A5"} strokeWidth={Math.max(0.3, Math.abs(e.b) * 1.4)} strokeOpacity={0.6} />;
      })}
      {NODES.map((n) => {
        const p = positions[n.id]; if (!p) return null;
        const r = Math.max(1.4, Math.min(4, 1.2 + p.degree * 0.4));
        return (
          <g key={n.id}>
            {n.id === "N30" && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke="#F59E0B" strokeWidth="1" strokeDasharray="2 1.5" />}
            <circle cx={p.x} cy={p.y} r={r} fill={layerColors[p.layer]} opacity={p.degree >= 3 ? 1 : 0.6} stroke="white" strokeWidth="0.6" />
          </g>
        );
      })}
    </svg>
  );
}

function MiniSphere({ W = 220, H = 160 }: { W?: number; H?: number }) {
  const cx = W / 2; const cy = H / 2;
  // Round trig outputs to 2 decimals so SSR + CSR agree byte-for-byte.
  const rd = (v: number) => Math.round(v * 100) / 100;
  const positions: Record<string, { x: number; y: number; layer: number; ring: number }> = {};
  positions["N30"] = { x: cx, y: cy, layer: 3, ring: 0 };
  const ring1 = Array.from(new Set(EDGES.filter((e) => e.s === "N30" || e.t === "N30").map((e) => (e.s === "N30" ? e.t : e.s))));
  ring1.forEach((id, i) => {
    const a = (i / ring1.length) * Math.PI * 2;
    positions[id] = { x: rd(cx + Math.cos(a) * 32), y: rd(cy + Math.sin(a) * 32), layer: NODE_BY_ID.get(id)?.layer ?? 3, ring: 1 };
  });
  const ring2set = new Set<string>();
  for (const id of ring1) {
    EDGES.filter((e) => e.s === id || e.t === id).forEach((e) => {
      const other = e.s === id ? e.t : e.s;
      if (other !== "N30" && !ring1.includes(other)) ring2set.add(other);
    });
  }
  const ring2 = [...ring2set];
  ring2.forEach((id, i) => {
    const a = (i / ring2.length) * Math.PI * 2 + 0.15;
    positions[id] = { x: rd(cx + Math.cos(a) * 60), y: rd(cy + Math.sin(a) * 60), layer: NODE_BY_ID.get(id)?.layer ?? 3, ring: 2 };
  });
  const layerColors = ["#94A3B8", "#06B6D4", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#1E293B"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      <circle cx={cx} cy={cy} r={32} fill="none" stroke="#F1F5F9" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r={60} fill="none" stroke="#F1F5F9" strokeWidth="0.5" />
      {EDGES.map((e) => {
        const s = positions[e.s]; const t = positions[e.t];
        if (!s || !t) return null;
        return <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={e.b > 0 ? "#CBD5E1" : "#FCA5A5"} strokeWidth="0.5" strokeOpacity="0.7" />;
      })}
      {Object.entries(positions).map(([id, p]) => {
        const node = NODE_BY_ID.get(id); if (!node) return null;
        const r = id === "N30" ? 5 : p.ring === 1 ? 3 : 2;
        return <circle key={id} cx={p.x} cy={p.y} r={r} fill={layerColors[node.layer]} stroke="white" strokeWidth="0.6" />;
      })}
      <circle cx={cx} cy={cy} r={6} fill="none" stroke="#F59E0B" strokeWidth="1.2" />
    </svg>
  );
}

function MiniForce({ W = 220, H = 160 }: { W?: number; H?: number }) {
  // Deterministic pseudo-force layout: cluster nodes by domain, jitter
  const domainCenters: Record<string, { x: number; y: number }> = {
    treatment: { x: 30, y: 30 },
    behavior: { x: 30, y: 130 },
    biomarker: { x: 80, y: 80 },
    pathway: { x: W / 2, y: H / 2 },
    symptom: { x: 165, y: 50 },
    cognitive: { x: 175, y: 110 },
    composite: { x: 200, y: 80 },
    demographic: { x: 30, y: 80 },
    genetic: { x: 50, y: 30 },
  };
  const rd = (v: number) => Math.round(v * 100) / 100;
  const positions: Record<string, { x: number; y: number; layer: number }> = {};
  NODES.forEach((n, i) => {
    const c = domainCenters[n.domain] ?? { x: W / 2, y: H / 2 };
    const ang = pseudo(i * 7) * Math.PI * 2;
    const dist = pseudo(i * 11) * 18 + 4;
    positions[n.id] = { x: rd(c.x + Math.cos(ang) * dist), y: rd(c.y + Math.sin(ang) * dist), layer: n.layer };
  });
  const layerColors = ["#94A3B8", "#06B6D4", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#1E293B"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {EDGES.map((e) => {
        const s = positions[e.s]; const t = positions[e.t];
        if (!s || !t) return null;
        return <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#CBD5E1" strokeWidth="0.4" strokeOpacity="0.5" />;
      })}
      {NODES.map((n) => {
        const p = positions[n.id]; if (!p) return null;
        const deg = nodeDegree(n.id);
        const r = Math.max(1.5, Math.min(4, 1.2 + deg * 0.4));
        return <circle key={n.id} cx={p.x} cy={p.y} r={r} fill={layerColors[n.layer]} opacity={deg >= 3 ? 1 : 0.65} stroke="white" strokeWidth="0.5" />;
      })}
    </svg>
  );
}

function MiniMatrix({ W = 220, H = 160 }: { W?: number; H?: number }) {
  // Adjacency matrix: rows/cols = layers L0-L6, cells = edge counts between
  const layerEdgeCount: number[][] = Array.from({ length: 7 }, () => Array(7).fill(0));
  for (const e of EDGES) {
    const sl = NODE_BY_ID.get(e.s)?.layer; const tl = NODE_BY_ID.get(e.t)?.layer;
    if (sl !== undefined && tl !== undefined) layerEdgeCount[sl][tl] += 1;
  }
  const max = Math.max(1, ...layerEdgeCount.flat());
  const padL = 14; const padT = 14;
  const cellW = (W - padL - 6) / 7; const cellH = (H - padT - 6) / 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {layerEdgeCount.map((row, r) =>
        row.map((c, t) => {
          const op = c === 0 ? 0.04 : Math.min(0.85, c / max * 0.85 + 0.15);
          return (
            <g key={`${r}-${t}`}>
              <rect
                x={padL + t * cellW + 0.5} y={padT + r * cellH + 0.5}
                width={cellW - 1} height={cellH - 1} rx={1.5}
                fill={`rgba(124, 58, 237, ${op.toFixed(2)})`}
              />
              {c > 0 && <text x={padL + t * cellW + cellW / 2} y={padT + r * cellH + cellH / 2 + 2}
                fontSize="6" textAnchor="middle" fill={c / max > 0.4 ? "white" : "#475569"} fontFamily="ui-monospace">{c}</text>}
            </g>
          );
        }),
      )}
      {Array.from({ length: 7 }).map((_, i) => (
        <g key={i}>
          <text x={padL + i * cellW + cellW / 2} y={padT - 4} fontSize="6" textAnchor="middle" fill="#94A3B8">L{i}</text>
          <text x={padL - 4} y={padT + i * cellH + cellH / 2 + 2} fontSize="6" textAnchor="end" fill="#94A3B8">L{i}</text>
        </g>
      ))}
    </svg>
  );
}

function ViewLensCard({ kind, title, sub, badge }: { kind: "layered" | "sphere" | "force" | "matrix"; title: string; sub: string; badge: string }) {
  return (
    <Card className="w-[260px]">
      <div className="flex items-center justify-between">
        <Eyebrow>◫ View {badge}</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>
      <div className="mt-3 h-[160px] rounded-md bg-gradient-to-br from-slate-50/40 to-white p-1">
        {kind === "layered" && <MiniLayered />}
        {kind === "sphere" && <MiniSphere />}
        {kind === "force" && <MiniForce />}
        {kind === "matrix" && <MiniMatrix />}
      </div>
      <Methodology>Same {TOTAL_NODES} nodes · {TOTAL_EDGES} edges · different lens</Methodology>
    </Card>
  );
}

// ── TEMPORAL ATLAS ──────────────────────────────────────────────────

const TEMPORAL_EDGES = [
  { id: "ER_ACT_IL6", label: "Activity → IL-6", onset: [3, 5, 9], peak: [10, 14, 21], persist: [42, 60, 90], decay: "exp" as const, k: 4, i2: 0.32 },
  { id: "ER_OIC_PROCSPEED", label: "OIC → Proc Speed", onset: [7, 14, 21], peak: [28, 42, 70], persist: [180, 365, 730], decay: "sustained" as const, k: 25, i2: 0.64 },
  { id: "ER_SLEEP_CORTISOL", label: "Sleep → Cortisol", onset: [1, 2, 3], peak: [3, 5, 7], persist: [7, 14, 28], decay: "linear" as const, k: 2, i2: 0.18 },
  { id: "ER_BDNF_NEUROPLAST", label: "BDNF → Neuroplast", onset: [14, 28, 56], peak: [60, 90, 120], persist: [180, 365, 730], decay: "biphasic" as const, k: 3, i2: 0.41 },
  { id: "ER_CHEMO_IL6", label: "Chemo → IL-6", onset: [1, 3, 7], peak: [7, 14, 28], persist: [60, 90, 180], decay: "exp" as const, k: 8, i2: 0.61 },
];

function TimingPoolCard() {
  const W = 460; const H = 30;
  const xMax = 365; // log days
  const xLog = (d: number) => Math.log10(Math.max(1, d));
  const xLogMax = xLog(xMax);
  const xScale = (d: number) => 70 + (xLog(d) / xLogMax) * (W - 80);
  return (
    <Card className="w-[480px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◴ Edge timing pool</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">Onset · peak · persistence (days)</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">REML pooled · p10 / p50 / p90 · log scale</div>
        </div>
        <Chip kind="model">POOLED</Chip>
      </div>
      <div className="mt-4 space-y-2.5">
        {TEMPORAL_EDGES.map((e) => (
          <div key={e.id}>
            <div className="flex items-baseline justify-between text-[10px]">
              <span className="font-medium text-slate-700">{e.label}</span>
              <span className="font-mono tabular-nums text-slate-400">k={e.k} · I²={(e.i2 * 100).toFixed(0)}%</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-0.5 h-[30px] w-full">
              <line x1={70} y1={H / 2} x2={W - 10} y2={H / 2} stroke="#F1F5F9" strokeWidth="0.5" />
              {/* onset range */}
              <line x1={xScale(e.onset[0])} y1={H / 2 - 6} x2={xScale(e.onset[2])} y2={H / 2 - 6} stroke="#06B6D4" strokeWidth="2" opacity="0.7" />
              <circle cx={xScale(e.onset[1])} cy={H / 2 - 6} r="2.5" fill="#06B6D4" />
              <text x={64} y={H / 2 - 4} fontSize="7" textAnchor="end" fill="#06B6D4">onset</text>
              {/* peak range */}
              <line x1={xScale(e.peak[0])} y1={H / 2} x2={xScale(e.peak[2])} y2={H / 2} stroke="#7C3AED" strokeWidth="2" opacity="0.7" />
              <circle cx={xScale(e.peak[1])} cy={H / 2} r="2.5" fill="#7C3AED" />
              <text x={64} y={H / 2 + 2} fontSize="7" textAnchor="end" fill="#7C3AED">peak</text>
              {/* persistence range */}
              <line x1={xScale(e.persist[0])} y1={H / 2 + 6} x2={xScale(e.persist[2])} y2={H / 2 + 6} stroke="#F59E0B" strokeWidth="2" opacity="0.7" />
              <circle cx={xScale(e.persist[1])} cy={H / 2 + 6} r="2.5" fill="#F59E0B" />
              <text x={64} y={H / 2 + 8} fontSize="7" textAnchor="end" fill="#F59E0B">persist</text>
            </svg>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[8px] tabular-nums text-slate-400">
        <span>1d</span><span>10d</span><span>30d</span><span>90d</span><span>1yr</span>
      </div>
      <Methodology>REML random-effects per component · I²=between-study heterogeneity · default SE = 0.25·μ for point-only</Methodology>
    </Card>
  );
}

function DecayKineticsCard() {
  const kinetics = [
    { id: "linear", label: "Linear", count: 6, color: "#06B6D4", path: "M 4 22 L 60 6" },
    { id: "exp", label: "Exponential", count: 9, color: "#7C3AED", path: "M 4 6 Q 18 18 60 22" },
    { id: "sustained", label: "Sustained", count: 5, color: "#F59E0B", path: "M 4 6 L 18 6 L 18 8 L 60 8" },
    { id: "biphasic", label: "Biphasic", count: 3, color: "#EC4899", path: "M 4 22 L 18 6 L 32 18 L 46 8 L 60 14" },
  ];
  const total = kinetics.reduce((a, k) => a + k.count, 0);
  return (
    <Card className="w-[280px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◔ Decay kinetics</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-900">Modal decay shape</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">across {total} edges with temporal data</div>
      <div className="mt-4 space-y-2.5">
        {kinetics.map((k) => (
          <div key={k.id} className="flex items-center gap-3">
            <svg viewBox="0 0 64 28" className="h-7 w-16 shrink-0">
              <path d={k.path} fill="none" stroke={k.color} strokeWidth="1.6" />
            </svg>
            <span className="flex-1 text-[11px] text-slate-700">{k.label}</span>
            <span className="font-mono text-[10px] tabular-nums text-slate-500">{k.count}</span>
            <div className="h-1 w-12 rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${((k.count / total) * 100).toFixed(1)}%`, background: k.color }} />
            </div>
          </div>
        ))}
      </div>
      <Methodology>Most-common shape per edge from study reports · biphasic = 2-stage</Methodology>
    </Card>
  );
}

function CalibrationScatterCard() {
  // 14 dots: predicted_peak_week vs observed_peak_week
  const points = [
    { p: 7, o: 9, label: "OIC→PS", regime: "expected" },
    { p: 14, o: 12, label: "ACT→IL6", regime: "expected" },
    { p: 4, o: 5, label: "SLEEP→CORT", regime: "expected" },
    { p: 21, o: 28, label: "BDNF→NPL", regime: "regime_shift" },
    { p: 10, o: 8, label: "TNF→OIC", regime: "expected" },
    { p: 5, o: 11, label: "FAT→PS", regime: "regime_shift" },
    { p: 7, o: 6, label: "CRP→OIC", regime: "expected" },
    { p: 14, o: 14, label: "IL6→OIC", regime: "expected" },
    { p: 21, o: 9, label: "MYELIN→PS", regime: "surprise" },
    { p: 28, o: 30, label: "NFL→MYELIN", regime: "expected" },
    { p: 12, o: 13, label: "OIC→FAT", regime: "expected" },
    { p: 4, o: 4, label: "OIC→DEP", regime: "expected" },
    { p: 8, o: 10, label: "DEP→WM", regime: "expected" },
    { p: 14, o: 22, label: "OIC→EM", regime: "regime_shift" },
  ];
  const W = 280; const H = 200; const padL = 28; const padR = 8; const padT = 16; const padB = 28;
  const max = 32;
  const xs = (v: number) => padL + (v / max) * (W - padL - padR);
  const ys = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const regimeColor: Record<string, string> = {
    expected: "#10B981",
    regime_shift: "#F59E0B",
    surprise: "#EF4444",
  };
  // Pearson r
  const ps = points.map((p) => p.p); const os = points.map((p) => p.o);
  const mP = ps.reduce((a, b) => a + b, 0) / ps.length;
  const mO = os.reduce((a, b) => a + b, 0) / os.length;
  const num = ps.reduce((acc, v, i) => acc + (v - mP) * (os[i] - mO), 0);
  const denP = Math.sqrt(ps.reduce((acc, v) => acc + (v - mP) ** 2, 0));
  const denO = Math.sqrt(os.reduce((acc, v) => acc + (v - mO) ** 2, 0));
  const r = num / (denP * denO);
  return (
    <Card className="w-[320px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◯ Calibration scatter</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">Predicted vs observed peak</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">14 resolved predictions · r={r.toFixed(2)}</div>
        </div>
        <Chip kind="model">RESOLVED</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[200px] w-full">
        {[0, 8, 16, 24, 32].map((g) => (
          <g key={g}>
            <line x1={xs(g)} y1={padT} x2={xs(g)} y2={H - padB} stroke="#F1F5F9" strokeWidth="0.5" />
            <line x1={padL} y1={ys(g)} x2={W - padR} y2={ys(g)} stroke="#F1F5F9" strokeWidth="0.5" />
            <text x={xs(g)} y={H - padB + 12} fontSize="7" textAnchor="middle" fill="#94A3B8">{g}</text>
            <text x={padL - 4} y={ys(g) + 2} fontSize="7" textAnchor="end" fill="#94A3B8">{g}</text>
          </g>
        ))}
        {/* diagonal y=x */}
        <line x1={xs(0)} y1={ys(0)} x2={xs(max)} y2={ys(max)} stroke="#CBD5E1" strokeDasharray="2 2" strokeWidth="0.6" />
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
        <text x={W / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="#64748B">predicted peak (weeks)</text>
        <text x={6} y={padT + 4} fontSize="8" fill="#64748B">observed</text>
        {points.map((p, i) => (
          <circle key={i} cx={xs(p.p)} cy={ys(p.o)} r="3" fill={regimeColor[p.regime]} stroke="white" strokeWidth="0.8" opacity="0.9" />
        ))}
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[9px] tabular-nums">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />expected</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />regime shift</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />surprise</span>
      </div>
      <Methodology>path_aware_temporal_v1 · |Δ|/|p50| → expected &lt;10% · regime 10–50% · surprise &gt;50%</Methodology>
    </Card>
  );
}

// ── HIDDEN INSIGHTS ─────────────────────────────────────────────────

function InsightCalloutCard({
  kind, title, finding, evidence, action, glyph,
}: {
  kind: "cycle" | "bridge" | "discordance" | "temporal";
  title: string; finding: string; evidence: string; action: string; glyph: string;
}) {
  const tones: Record<string, { ribbon: "violet" | "rose" | "purple" | "amber"; eyebrow: string }> = {
    cycle: { ribbon: "purple", eyebrow: "↻ Cycle detected" },
    bridge: { ribbon: "amber", eyebrow: "▴ Bridge node" },
    discordance: { ribbon: "rose", eyebrow: "▲ Discordance" },
    temporal: { ribbon: "violet", eyebrow: "◴ Temporal mismatch" },
  };
  const tone = tones[kind];
  return (
    <Card className="w-[260px]" ribbon={tone.ribbon}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{tone.eyebrow}</span>
        <Chip kind="model">SURFACED</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold leading-tight text-slate-900">{title}</div>
      <div className="mt-3 rounded-md bg-slate-50 p-2 font-mono text-[10px] leading-relaxed tabular-nums text-slate-700">
        {glyph} {finding}
      </div>
      <div className="mt-2 text-[10px] leading-snug text-slate-500">{evidence}</div>
      <div className="mt-3 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-700">
        <span className="font-semibold">→ </span>{action}
      </div>
    </Card>
  );
}

function HiddenInsightsRow() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <InsightCalloutCard
        kind="cycle"
        glyph="↻"
        title="Inflammation–HPA closed loop"
        finding="N20 → N30 → N32 → N24 → N20"
        evidence="Tarjan SCC · 4 nodes · period ≈ 21d · gain 1.34"
        action="Break by reducing N20 below 0.4z (Activity intervention)"
      />
      <InsightCalloutCard
        kind="bridge"
        glyph="◇"
        title="N30 single articulation point"
        finding="73% of treatment → cognition paths route through N30"
        evidence="Betweenness centrality 0.54 · removal disconnects 8 nodes"
        action="Highest-leverage suppression target → see counterfactual"
      />
      <InsightCalloutCard
        kind="discordance"
        glyph="≠"
        title="Chain–direct β gap"
        finding="β_chain = −0.18  vs  β_direct = −0.34  (Z=2.1)"
        evidence="Suggests latent mediator missing on OIC→ProcSpeed path"
        action="Probe N3F (myelin) as candidate · run interaction test"
      />
      <InsightCalloutCard
        kind="temporal"
        glyph="Δt"
        title="Onset mismatch on OIC→Episodic"
        finding="Predicted: 14d · Observed: 28d  (Δ = +14d)"
        evidence="path_aware_temporal_v1 · regime_shift · 6 calibrated points"
        action="Update edge prior · re-pool with biphasic kinetics"
      />
    </div>
  );
}

// ── ANALYTICS: VARIANCE DECOMP, CALIBRATION CASCADE, FOREST ─────────

function VarianceDecompCard() {
  const sources = [
    { l: "Edge SE (between-edge)", p: 38, c: "#7C3AED" },
    { l: "Proxy approximation", p: 23, c: "#0EA5E9" },
    { l: "Heterogeneity τ²", p: 18, c: "#F59E0B" },
    { l: "Latent confounders", p: 15, c: "#10B981" },
    { l: "Adherence drift", p: 6, c: "#94A3B8" },
  ];
  return (
    <Card className="w-[320px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◐ Variance decomposition</Eyebrow>
        <Chip kind="model">MODEL</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-900">Where does uncertainty come from?</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">Posterior variance contribution · forecast at m=12</div>
      {/* stacked bar */}
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
        <div className="flex h-full">
          {sources.map((s) => (
            <div key={s.l} className="h-full" style={{ width: `${s.p}%`, background: s.c }} title={`${s.l}: ${s.p}%`} />
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {sources.map((s) => (
          <div key={s.l} className="flex items-center gap-2 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.c }} />
            <span className="flex-1 truncate text-slate-700">{s.l}</span>
            <span className="font-mono tabular-nums text-slate-500">{s.p}%</span>
          </div>
        ))}
      </div>
      <Methodology>
        Total Var(ŷ) = Σ contributions · proxy = NIHTB-CB↔CRCI composite map · adherence from wearable telemetry
      </Methodology>
    </Card>
  );
}

function CalibrationCascadeCard() {
  const layers = [
    { l: "SE_raw", v: 0.32, op: "—", c: "#94A3B8" },
    { l: "Study design", v: 0.272, op: "× 0.85", c: "#06B6D4" },
    { l: "Population", v: 0.250, op: "× 0.92", c: "#06B6D4" },
    { l: "Hetero. τ²", v: 0.270, op: "+ 0.020", c: "#F59E0B" },
    { l: "Measurement", v: 0.284, op: "× 1.05", c: "#06B6D4" },
    { l: "GRADE", v: 0.270, op: "× 0.95", c: "#10B981" },
    { l: "Temporal match", v: 0.254, op: "× 0.94", c: "#7C3AED" },
    { l: "Freshness", v: 0.249, op: "× 0.98", c: "#7C3AED" },
    { l: "SE_eff", v: 0.21, op: "✓", c: "#1E293B" },
  ];
  const max = 0.34;
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◇ Calibration cascade</Eyebrow>
        <Chip kind="model">PIPELINE</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-900">7-layer SE pipeline</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">SE_raw 0.32 → SE_eff 0.21 · 34% reduction</div>
      <div className="mt-4 space-y-1">
        {layers.map((s, i) => {
          const w = (s.v / max) * 100;
          const isFirst = i === 0; const isLast = i === layers.length - 1;
          return (
            <div key={s.l} className="flex items-center gap-2 text-[10px]">
              <span className={`w-24 truncate ${isFirst || isLast ? "font-semibold text-slate-800" : "text-slate-600"}`}>{s.l}</span>
              <div className="relative h-3 flex-1 rounded-sm bg-slate-50">
                <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${w}%`, background: s.c, opacity: isLast ? 1 : 0.7 }} />
              </div>
              <span className="w-12 text-right font-mono tabular-nums text-slate-700">{s.v.toFixed(3)}</span>
              <span className="w-14 text-right font-mono text-[9px] tabular-nums text-slate-400">{s.op}</span>
            </div>
          );
        })}
      </div>
      <Methodology>
        Multiplicative SE adjustments per layer · τ² additive · 4 trust-boundary gates pass before SE_eff
      </Methodology>
    </Card>
  );
}

function ForestPlotCard() {
  // 6 cognitive domains + composite, with point + 95% CI before / after intervention
  const W = 320; const H = 220;
  const padL = 110; const padR = 16; const padT = 16; const padB = 28;
  const min = -1.5; const max = 0.6;
  const xs = (v: number) => padL + ((v - min) / (max - min)) * (W - padL - padR);
  const rows = [
    { name: "Processing Speed", base: -0.82, baseCi: [-1.24, -0.40], post: -0.42, postCi: [-0.78, -0.06] },
    { name: "Sustained Attention", base: -0.61, baseCi: [-1.18, -0.04], post: -0.28, postCi: [-0.71, 0.15] },
    { name: "Episodic Memory", base: -0.58, baseCi: [-1.08, -0.08], post: -0.31, postCi: [-0.72, 0.10] },
    { name: "Working Memory", base: -0.49, baseCi: [-1.05, 0.07], post: -0.19, postCi: [-0.65, 0.27] },
    { name: "Executive Planning", base: -0.35, baseCi: [-0.98, 0.28], post: -0.11, postCi: [-0.62, 0.40] },
    { name: "Selective Attention", base: -0.31, baseCi: [-1.03, 0.41], post: -0.08, postCi: [-0.71, 0.55] },
    { name: "CRCI Composite ◆", base: -0.51, baseCi: [-0.92, -0.10], post: -0.20, postCi: [-0.55, 0.15], emph: true as const },
  ];
  const rowH = (H - padT - padB) / rows.length;
  return (
    <Card className="w-[480px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◆ Forest plot</Eyebrow>
        <Chip kind="model">POSTERIOR</Chip>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-900">Cognitive domains · baseline vs +intervention</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">z-units · 95% credible interval · MCMC M=2000</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[220px] w-full">
        {/* zero line */}
        <line x1={xs(0)} y1={padT} x2={xs(0)} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" strokeDasharray="2 2" />
        {/* gridlines */}
        {[-1.5, -1, -0.5, 0, 0.5].map((g) => (
          <g key={g}>
            <line x1={xs(g)} y1={padT} x2={xs(g)} y2={H - padB} stroke="#F1F5F9" strokeWidth="0.5" />
            <text x={xs(g)} y={H - padB + 12} fontSize="8" textAnchor="middle" fill="#94A3B8">{g.toFixed(1)}</text>
          </g>
        ))}
        <text x={W / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="#64748B">Effect size (z-units)</text>
        {rows.map((r, i) => {
          const y = padT + i * rowH + rowH / 2;
          return (
            <g key={r.name}>
              {/* row label */}
              <text x={padL - 6} y={y + 3} fontSize="9" textAnchor="end" fill={r.emph ? "#0F172A" : "#475569"} fontWeight={r.emph ? 600 : 400}>
                {r.name}
              </text>
              {/* baseline CI */}
              <line x1={xs(r.baseCi[0])} y1={y - 3} x2={xs(r.baseCi[1])} y2={y - 3} stroke="#94A3B8" strokeWidth="1.4" opacity="0.6" />
              <circle cx={xs(r.base)} cy={y - 3} r={r.emph ? 3 : 2.2} fill="#475569" />
              {/* post-intervention CI */}
              <line x1={xs(r.postCi[0])} y1={y + 3} x2={xs(r.postCi[1])} y2={y + 3} stroke="#7C3AED" strokeWidth="1.4" opacity="0.7" />
              {r.emph ? (
                <polygon
                  points={`${xs(r.post) - 5},${y + 3} ${xs(r.post)},${y + 3 - 4} ${xs(r.post) + 5},${y + 3} ${xs(r.post)},${y + 3 + 4}`}
                  fill="#7C3AED"
                />
              ) : (
                <circle cx={xs(r.post)} cy={y + 3} r="2.2" fill="#7C3AED" />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 bg-slate-500" />baseline</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-3 bg-violet-600" />+intervention (12mo)</span>
      </div>
      <Methodology>Bayesian model averaging · per-domain posterior shifted by intervention coefficient · ◆ = composite diamond</Methodology>
    </Card>
  );
}

// ── PROPOSALS PANELS ────────────────────────────────────────────────

function VariableProposalsCard() {
  const proposals = [
    {
      name: "Sleep efficiency (TST/TIB)",
      role: "mediator",
      conf: 0.84,
      source: "llm" as const,
      depends: ["N11", "N43"],
      justification: "Mediates Sleep Quality (N11) → BDNF (N23) link; current model treats them as direct.",
    },
    {
      name: "Inflammation composite (IL-6+CRP+TNF-α)",
      role: "outcome",
      conf: 0.91,
      source: "llm" as const,
      depends: ["N20", "N21", "N22"],
      justification: "Reduces 3-edge fan-in to OIC into a single index; cuts shared-source noise.",
    },
    {
      name: "Time since last chemo cycle",
      role: "modifier",
      conf: 0.78,
      source: "llm" as const,
      depends: ["N01"],
      justification: "Effect-size of chemo→IL-6 attenuates with elapsed time — currently unmodeled.",
    },
    {
      name: "APOE ε4 status",
      role: "modifier",
      conf: 0.86,
      source: "manual" as const,
      depends: ["N08"],
      justification: "Genetic risk factor affecting recovery slope; raise-on-population evidence.",
    },
  ];
  const roleColor: Record<string, string> = {
    outcome: "bg-rose-50 text-rose-700 ring-rose-200",
    mediator: "bg-violet-50 text-violet-700 ring-violet-200",
    modifier: "bg-amber-50 text-amber-700 ring-amber-200",
    instrument: "bg-cyan-50 text-cyan-700 ring-cyan-200",
    confounding: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>⊕ Variable proposals</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">Awaiting approval</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">{proposals.length} pending · LLM + manual sources</div>
        </div>
        <Chip kind="model">QUEUE</Chip>
      </div>
      <div className="mt-4 space-y-3">
        {proposals.map((p) => (
          <div key={p.name} className="rounded-md border border-slate-200/70 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-medium text-slate-800">{p.name}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${roleColor[p.role]}`}>{p.role}</span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-500">{p.justification}</p>
            <div className="mt-2 flex items-center justify-between text-[9px] tabular-nums">
              <div className="flex items-center gap-1.5 text-slate-500">
                <span className="font-mono">depends on:</span>
                {p.depends.map((d) => (
                  <span key={d} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-600">{d}</span>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">{p.source}</span>
                <span className="rounded-full bg-slate-50 px-1.5 py-0.5 font-mono text-slate-700">conf {p.conf.toFixed(2)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Methodology>
        variable_proposals · roles: outcome | mediator | modifier | instrument · materializes to entity_id on approve
      </Methodology>
    </Card>
  );
}

function DiscoveryProposalsCard() {
  const proposals = [
    {
      source: "convergent_point",
      title: "OIC convergence",
      signal: "5 incoming pathways → N30 (IL-6, CRP, TNF-α, Cortisol, MDA)",
      priority: 0.92,
      confidence: 0.88,
    },
    {
      source: "what_if",
      title: "Activity ↑2σ at month 3",
      signal: "Δz Processing Speed = +0.31 (95% CI [0.18, 0.44])",
      priority: 0.85,
      confidence: 0.79,
    },
    {
      source: "combination",
      title: "Activity + Sleep super-additivity",
      signal: "Joint effect 1.4× sum-of-parts (interaction β = +0.11)",
      priority: 0.78,
      confidence: 0.72,
    },
    {
      source: "interaction_probe",
      title: "APOE × Activity",
      signal: "ε4 carriers Δz = −0.12 vs non-carriers Δz = +0.31",
      priority: 0.71,
      confidence: 0.69,
    },
  ];
  const sourceGlyph: Record<string, string> = {
    convergent_point: "◉",
    what_if: "?→",
    combination: "⊕",
    interaction_probe: "×",
  };
  const sourceColor: Record<string, string> = {
    convergent_point: "#F59E0B",
    what_if: "#7C3AED",
    combination: "#06B6D4",
    interaction_probe: "#EC4899",
  };
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◈ Discovery queue</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">High-confidence findings</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">{proposals.length} pending · auto-promoted to twin_proposals</div>
        </div>
        <Chip kind="model">QUEUE</Chip>
      </div>
      <div className="mt-4 space-y-3">
        {proposals.map((p) => (
          <div key={p.title} className="rounded-md border border-slate-200/70 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px]" style={{ color: sourceColor[p.source] }}>{sourceGlyph[p.source]}</span>
                <span className="text-[12px] font-medium text-slate-800">{p.title}</span>
              </div>
              <span className="shrink-0 rounded-full bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-slate-500">
                pri {p.priority.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] leading-snug tabular-nums text-slate-600">{p.signal}</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="relative h-1 flex-1 rounded-full bg-slate-100">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(p.confidence * 100).toFixed(0)}%`, background: sourceColor[p.source] }} />
              </div>
              <span className="font-mono text-[9px] tabular-nums text-slate-400">conf {p.confidence.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-400">{p.source.replace("_", " ")}</div>
          </div>
        ))}
      </div>
      <Methodology>
        twin_proposals.discovery_source · thresholds conf≥0.75, prob≥0.65, alignment≥0.6 · gated by user approval
      </Methodology>
    </Card>
  );
}

// ── DATA INGESTION PIPELINE ─────────────────────────────────────────

function IngestionPipelineCard() {
  const stages = [
    { l: "URL / DOI / CSV ingest", state: "complete", icon: "↧" },
    { l: "Metadata fetch (CrossRef)", state: "complete", icon: "✓" },
    { l: "Full-text retrieval", state: "complete", icon: "✓" },
    { l: "Edge identification", state: "complete", icon: "✓" },
    { l: "Effect-size extraction", state: "complete", icon: "✓" },
    { l: "Moderator coding", state: "complete", icon: "✓" },
    { l: "Quality assessment (GRADE)", state: "complete", icon: "✓" },
    { l: "Trust boundary (4 gates)", state: "complete", icon: "✓" },
    { l: "SE cascade (7 layers)", state: "complete", icon: "✓" },
    { l: "Temporal pooling (REML)", state: "complete", icon: "✓" },
    { l: "DB load + audit log", state: "active", icon: "►" },
  ];
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◌ Ingestion pipeline</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">11-stage extraction</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">PDF · DOI · CSV · panel data · audit-logged</div>
        </div>
        <Chip kind="data">LIVE</Chip>
      </div>
      <div className="mt-4 space-y-1.5">
        {stages.map((s, i) => {
          const isActive = s.state === "active";
          return (
            <div key={s.l} className="flex items-center gap-2 text-[10px]">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[8px] ${isActive ? "bg-violet-100 text-violet-700 ring-1 ring-violet-300" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"}`}>
                {s.icon}
              </span>
              <span className="font-mono text-[8px] text-slate-400 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 text-slate-700">{s.l}</span>
              <span className={`text-[9px] uppercase tracking-wider ${isActive ? "text-violet-600" : "text-emerald-600"}`}>{s.state}</span>
            </div>
          );
        })}
      </div>
      <Methodology>11-prompt LLM pipeline · DOI provenance per edge · trust boundary blocks low-quality records</Methodology>
    </Card>
  );
}

function CSVDropCard() {
  const sampleRows = [
    { id: "S001", week: 0, il6: 1.23, crp: 1.05, ps: -0.78 },
    { id: "S001", week: 4, il6: 0.84, crp: 0.71, ps: -0.62 },
    { id: "S001", week: 8, il6: 0.42, crp: 0.38, ps: -0.41 },
    { id: "S001", week: 12, il6: 0.18, crp: 0.21, ps: -0.22 },
    { id: "S002", week: 0, il6: 1.61, crp: 1.34, ps: -1.05 },
  ];
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>↧ CSV / panel data</Eyebrow>
          <div className="mt-2 text-[13px] font-semibold text-slate-900">Drop file to ingest</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">subject_id × week × biomarkers · auto-pooled into edge timing</div>
        </div>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-4 rounded-md border border-dashed border-violet-200 bg-violet-50/30 p-4 text-center">
        <div className="text-[20px] text-violet-400">↧</div>
        <div className="mt-1 text-[11px] font-medium text-violet-700">Drop CSV / parquet here</div>
        <div className="mt-0.5 text-[9px] text-violet-500">or paste URL · 168 records currently loaded</div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-slate-200/70">
        <table className="w-full text-[9px] tabular-nums">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">subject</th>
              <th className="px-2 py-1 text-right font-medium">week</th>
              <th className="px-2 py-1 text-right font-medium">IL-6</th>
              <th className="px-2 py-1 text-right font-medium">CRP</th>
              <th className="px-2 py-1 text-right font-medium">ProcSpd z</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {sampleRows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 text-slate-700">
                <td className="px-2 py-0.5 font-mono">{r.id}</td>
                <td className="px-2 py-0.5 text-right">{r.week}</td>
                <td className="px-2 py-0.5 text-right">{r.il6.toFixed(2)}</td>
                <td className="px-2 py-0.5 text-right">{r.crp.toFixed(2)}</td>
                <td className="px-2 py-0.5 text-right">{r.ps.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-100 text-slate-400">
              <td className="px-2 py-0.5" colSpan={5}>… 163 more rows</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Methodology>Auto-detect subject-week panel · feed REML pooler · time_points JSONB per edge</Methodology>
    </Card>
  );
}

// ── UNIFIED PROPOSAL INTAKE FUNNEL (6 streams) ──────────────────────

const INTAKE_STREAMS = [
  {
    id: "concept",
    label: "Concept",
    sub: "ambient · canvas spans",
    glyph: "◌",
    color: "#06B6D4",
    pending: 7,
    superseded: 2,
    items: [
      { title: "\"glymphatic clearance\"", role: "new entity", conf: 0.83, source: "ambient" },
      { title: "\"sleep-wake cycle disruption\"", role: "→ N43", conf: 0.79, source: "weave" },
      { title: "\"chemobrain\"", role: "→ N60", conf: 0.92, source: "ambient" },
    ],
  },
  {
    id: "router",
    label: "Router",
    sub: "intelligence engine",
    glyph: "↻",
    color: "#7C3AED",
    pending: 4,
    superseded: 1,
    items: [
      { title: "Refresh synthesis (3 new edges)", role: "synthesis_refresh", conf: 0.88 },
      { title: "Critique cycle N20→N30→N32→N24", role: "critique", conf: 0.81 },
      { title: "Promote sub-objective: \"reduce IL-6 ≥30%\"", role: "sub_objective_accept", conf: 0.74 },
    ],
  },
  {
    id: "variable",
    label: "Variable",
    sub: "experimental + causal",
    glyph: "⊕",
    color: "#10B981",
    pending: 4,
    superseded: 0,
    items: [
      { title: "Sleep efficiency (TST/TIB)", role: "mediator", conf: 0.84, source: "llm" },
      { title: "Inflammation composite", role: "outcome", conf: 0.91, source: "llm" },
      { title: "APOE ε4 status", role: "modifier", conf: 0.86, source: "manual" },
    ],
  },
  {
    id: "twin",
    label: "Twin",
    sub: "strategy + justification",
    glyph: "◇",
    color: "#F59E0B",
    pending: 1,
    superseded: 3,
    items: [
      { title: "Anti-inflammatory layered strategy v4", role: "Strategy", conf: 0.79, source: "llm" },
    ],
  },
  {
    id: "discovery",
    label: "Discovery",
    sub: "sim → KG closure",
    glyph: "◉",
    color: "#EF4444",
    pending: 4,
    superseded: 0,
    items: [
      { title: "OIC convergence (5 in-paths)", role: "convergent_point", conf: 0.88 },
      { title: "Activity ↑2σ at m=3 → +0.31z", role: "what_if", conf: 0.79 },
      { title: "APOE × Activity heterogeneity", role: "interaction_probe", conf: 0.69 },
    ],
  },
  {
    id: "rigor",
    label: "Rigor",
    sub: "experiment specs · ranked",
    glyph: "⬢",
    color: "#0EA5E9",
    pending: 5,
    superseded: 0,
    items: [
      { title: "RCT: aerobic 150 vs 300 min/wk", role: "specs ready", conf: 0.91 },
      { title: "Mediation test: Sleep → Cortisol", role: "specs ready", conf: 0.85 },
      { title: "Crossover: MBSR vs CBT-I", role: "draft", conf: 0.74 },
    ],
  },
];

function ProposalIntakeFunnel() {
  const [active, setActive] = useState<string>("concept");
  const stream = INTAKE_STREAMS.find((s) => s.id === active) ?? INTAKE_STREAMS[0];
  const totalPending = INTAKE_STREAMS.reduce((a, s) => a + s.pending, 0);
  const totalSuperseded = INTAKE_STREAMS.reduce((a, s) => a + s.superseded, 0);

  return (
    <Card className="w-[940px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>⊞ Proposal intake · 6-stream funnel</Eyebrow>
          <div className="mt-2 text-[15px] font-semibold text-slate-900">
            {totalPending} awaiting review · {totalSuperseded} superseded
          </div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            Each stream has independent proposed → approved/rejected/superseded lifecycle. Supersede tracking prevents
            queue-clog on regen.
          </div>
        </div>
        <Chip kind="model">QUEUE</Chip>
      </div>

      {/* Stream tabs */}
      <div className="mt-5 grid grid-cols-6 gap-2">
        {INTAKE_STREAMS.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`rounded-lg border p-3 text-left transition-all ${
                isActive
                  ? "border-slate-300 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  : "border-slate-200/70 bg-slate-50/50 hover:bg-white"
              }`}
              style={isActive ? { borderColor: s.color } : undefined}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[14px]" style={{ color: s.color }}>
                  {s.glyph}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums"
                  style={{ background: `${s.color}1a`, color: s.color }}
                >
                  {s.pending}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] font-semibold text-slate-800">{s.label}</div>
              <div className="text-[9px] tabular-nums text-slate-500">{s.sub}</div>
              {s.superseded > 0 && (
                <div className="mt-1 font-mono text-[9px] tabular-nums text-slate-400">
                  ↶ {s.superseded} superseded
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Active stream detail */}
      <div className="mt-5 grid grid-cols-[1fr_240px] gap-6">
        {/* Items list */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {stream.label} · top {stream.items.length} (rank-sorted)
            </span>
            <span className="font-mono text-[9px] tabular-nums text-slate-400">
              + {Math.max(0, stream.pending - stream.items.length)} more pending
            </span>
          </div>
          <div className="space-y-2">
            {stream.items.map((it, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-slate-200/70 bg-white p-2.5"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-semibold tabular-nums"
                  style={{ background: `${stream.color}1a`, color: stream.color }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-slate-800">{it.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[9px] tabular-nums text-slate-500">
                    <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 font-mono">{it.role}</span>
                    {"source" in it && it.source ? <span>· {it.source}</span> : null}
                  </div>
                </div>
                {/* confidence bar */}
                <div className="flex w-28 items-center gap-2">
                  <div className="relative h-1 flex-1 rounded-full bg-slate-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(it.conf * 100).toFixed(0)}%`, background: stream.color }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[9px] tabular-nums text-slate-600">
                    {it.conf.toFixed(2)}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100">
                    ✓
                  </button>
                  <button className="rounded-full bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Threshold gauges + bulk actions */}
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50/60 p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
              Auto-promote thresholds
            </div>
            {stream.id === "discovery" ? (
              <div className="mt-2 space-y-1.5 text-[10px] tabular-nums">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">conf ≥</span>
                  <span className="font-mono text-slate-800">0.75</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">prob ≥</span>
                  <span className="font-mono text-slate-800">0.65</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">align ≥</span>
                  <span className="font-mono text-slate-800">0.60</span>
                </div>
              </div>
            ) : stream.id === "rigor" ? (
              <div className="mt-2 text-[10px] tabular-nums">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">rank_score ≥</span>
                  <span className="font-mono text-slate-800">0.70</span>
                </div>
                <div className="mt-1 text-[9px] text-slate-500">
                  AI-driven proposal ranking, top-N surfaced first.
                </div>
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-slate-600">
                Manual review · approve to materialize entity / edge / strategy / mechanism.
              </div>
            )}
          </div>

          <div className="rounded-md bg-slate-50/60 p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Supersede chain</div>
            <div className="mt-2 flex items-center gap-1.5 text-[9px] tabular-nums">
              {Array.from({ length: Math.min(stream.superseded + 1, 4) }).map((_, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] ${
                      i === Math.min(stream.superseded, 3) ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400 line-through"
                    }`}
                  >
                    v{i + 1}
                  </span>
                  {i < Math.min(stream.superseded, 3) ? <span className="text-slate-300">→</span> : null}
                </div>
              ))}
              <span className="ml-1 font-mono text-[9px] text-slate-500">latest</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <button className="w-full rounded-md bg-slate-900 py-1.5 text-[10px] font-medium text-white hover:bg-slate-800">
              Approve top {Math.min(3, stream.pending)}
            </button>
            <button className="w-full rounded-md bg-slate-50 py-1.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
              Defer all · re-rank
            </button>
          </div>
        </div>
      </div>

      <Methodology>
        Streams: concept_proposals · router_proposals · variable_proposals · twin_proposals (incl. discovery_source) ·
        rigor_runs.experiment_specs · all RLS-scoped owner-only · supersede pattern preserves audit trail
      </Methodology>
    </Card>
  );
}

// ── APPS PORTFOLIO MATRIX ───────────────────────────────────────────

const APPS_DATA = [
  {
    id: "cog_game",
    name: "Cognitive Game",
    type: "intervention",
    priority: 0.78,
    complexity: 0.62,
    health: 0.84,
    entities: 18,
    metrics: 4,
    stale: null,
    color: "#7C3AED",
  },
  {
    id: "cog_measure",
    name: "Cognitive Measurement",
    type: "instrument",
    priority: 0.82,
    complexity: 0.41,
    health: 0.91,
    entities: 12,
    metrics: 6,
    stale: null,
    color: "#06B6D4",
  },
  {
    id: "anti_inflam",
    name: "Anti-Inflammatory Stack",
    type: "intervention",
    priority: 0.91,
    complexity: 0.55,
    health: 0.71,
    entities: 14,
    metrics: 5,
    stale: "missing temporal data on 2 edges",
    color: "#F59E0B",
  },
  {
    id: "sleep_protocol",
    name: "Sleep Protocol",
    type: "intervention",
    priority: 0.69,
    complexity: 0.34,
    health: 0.88,
    entities: 9,
    metrics: 3,
    stale: null,
    color: "#0EA5E9",
  },
  {
    id: "stress_mgmt",
    name: "MBSR / Stress",
    type: "intervention",
    priority: 0.54,
    complexity: 0.48,
    health: 0.62,
    entities: 7,
    metrics: 2,
    stale: "no review in 21d",
    color: "#10B981",
  },
];

function AppsPortfolioCard() {
  const W = 380;
  const H = 240;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const xs = (v: number) => padL + v * (W - padL - padR);
  const ys = (v: number) => padT + (1 - v) * (H - padT - padB);
  return (
    <Card className="w-[460px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>▣ Apps portfolio</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">Priority × complexity</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {APPS_DATA.length} apps · bubble = entity count · ring = health
          </div>
        </div>
        <Chip kind="data">DATA</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[240px] w-full">
        {/* quadrant guides */}
        <line x1={xs(0.5)} y1={padT} x2={xs(0.5)} y2={H - padB} stroke="#F1F5F9" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1={padL} y1={ys(0.5)} x2={W - padR} y2={ys(0.5)} stroke="#F1F5F9" strokeWidth="0.6" strokeDasharray="3 3" />
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        {/* ticks */}
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <text x={xs(g)} y={H - padB + 12} fontSize="8" textAnchor="middle" fill="#94A3B8">
              {g.toFixed(1)}
            </text>
            <text x={padL - 5} y={ys(g) + 3} fontSize="8" textAnchor="end" fill="#94A3B8">
              {g.toFixed(1)}
            </text>
          </g>
        ))}
        {/* quadrant labels */}
        <text x={W - padR - 4} y={padT + 10} fontSize="7" textAnchor="end" fill="#94A3B8" fontStyle="italic">
          high priority · high effort
        </text>
        <text x={padL + 4} y={padT + 10} fontSize="7" fill="#94A3B8" fontStyle="italic">
          quick wins ↗
        </text>
        <text x={W / 2} y={H - 6} fontSize="8" textAnchor="middle" fill="#64748B">
          complexity →
        </text>
        <text x={4} y={padT + 4} fontSize="8" fill="#64748B">
          ↑ priority
        </text>
        {/* bubbles */}
        {APPS_DATA.map((a) => {
          const r = 6 + (a.entities / 18) * 14;
          return (
            <g key={a.id}>
              {/* health ring */}
              <circle cx={xs(a.complexity)} cy={ys(a.priority)} r={r + 3} fill="none" stroke={a.color} strokeWidth="1.2" strokeOpacity="0.45" />
              {/* solid bubble */}
              <circle cx={xs(a.complexity)} cy={ys(a.priority)} r={r} fill={a.color} fillOpacity="0.78" stroke="white" strokeWidth="1" />
              {a.stale && (
                <circle cx={xs(a.complexity) + r - 2} cy={ys(a.priority) - r + 2} r="3" fill="#F59E0B" stroke="white" strokeWidth="0.8" />
              )}
              <text x={xs(a.complexity)} y={ys(a.priority) - r - 5} fontSize="7" textAnchor="middle" fill="#475569" fontWeight="600">
                {a.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 space-y-1">
        {APPS_DATA.slice(0, 3).map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-[10px] tabular-nums">
            <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
            <span className="flex-1 truncate text-slate-700">{a.name}</span>
            <span className="font-mono text-slate-500">h={a.health.toFixed(2)}</span>
            <span className="font-mono text-slate-400">{a.entities}e · {a.metrics}m</span>
          </div>
        ))}
      </div>
      <Methodology>apps table · health = f(coverage, calibration, recency) · ⚠ stale_reason badge</Methodology>
    </Card>
  );
}

// ── INTERVENTION DAG (effort × impact + dependency graph) ──────────

const INTERVENTIONS_DAG = [
  { id: "iv_aerobic", name: "Aerobic Exercise", effort: 0.55, impact: 0.85, deps: [], target: "N20", color: "#1E40AF" },
  { id: "iv_resist", name: "Resistance Training", effort: 0.62, impact: 0.62, deps: ["iv_aerobic"], target: "N23", color: "#3B82F6" },
  { id: "iv_cbti", name: "CBT-I", effort: 0.48, impact: 0.71, deps: [], target: "N24", color: "#7C3AED" },
  { id: "iv_mbsr", name: "MBSR", effort: 0.41, impact: 0.58, deps: [], target: "N32", color: "#0F766E" },
  { id: "iv_diet", name: "Mediterranean Diet", effort: 0.65, impact: 0.44, deps: [], target: "N20", color: "#B45309" },
  { id: "iv_cog", name: "Cognitive Training", effort: 0.32, impact: 0.51, deps: ["iv_aerobic", "iv_cbti"], target: "N33", color: "#DC2626" },
];

function InterventionDAGCard() {
  const W = 360;
  const H = 240;
  const padL = 28;
  const padR = 12;
  const padT = 24;
  const padB = 32;
  const xs = (v: number) => padL + v * (W - padL - padR);
  const ys = (v: number) => padT + (1 - v) * (H - padT - padB);
  const positions: Record<string, { x: number; y: number }> = {};
  INTERVENTIONS_DAG.forEach((iv) => {
    positions[iv.id] = { x: xs(iv.effort), y: ys(iv.impact) };
  });
  return (
    <Card className="w-[420px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>⬡ Intervention DAG</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">Effort × Impact (with deps)</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {INTERVENTIONS_DAG.length} intervention kernels · arrows = depends_on_intervention_ids
          </div>
        </div>
        <Chip kind="data">DATA</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[240px] w-full">
        <line x1={xs(0.5)} y1={padT} x2={xs(0.5)} y2={H - padB} stroke="#F1F5F9" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1={padL} y1={ys(0.5)} x2={W - padR} y2={ys(0.5)} stroke="#F1F5F9" strokeWidth="0.6" strokeDasharray="3 3" />
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        {/* axis labels */}
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <text x={xs(g)} y={H - padB + 12} fontSize="8" textAnchor="middle" fill="#94A3B8">
              {g.toFixed(1)}
            </text>
            <text x={padL - 5} y={ys(g) + 3} fontSize="8" textAnchor="end" fill="#94A3B8">
              {g.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} fontSize="8" textAnchor="middle" fill="#64748B">
          effort →
        </text>
        <text x={4} y={padT - 6} fontSize="8" fill="#64748B">
          ↑ impact
        </text>
        {/* "Quick wins" annotation */}
        <text x={xs(0.25)} y={ys(0.85)} fontSize="7" fill="#10B981" fontStyle="italic" textAnchor="middle">
          quick wins
        </text>
        {/* dep arrows */}
        {INTERVENTIONS_DAG.map((iv) =>
          iv.deps.map((d) => {
            const s = positions[d];
            const t = positions[iv.id];
            if (!s || !t) return null;
            return (
              <line
                key={`${d}-${iv.id}`}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke="#CBD5E1"
                strokeWidth="0.8"
                markerEnd="url(#arrowdag)"
                opacity="0.7"
              />
            );
          }),
        )}
        <defs>
          <marker id="arrowdag" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="#94A3B8" />
          </marker>
        </defs>
        {/* nodes */}
        {INTERVENTIONS_DAG.map((iv) => (
          <g key={iv.id}>
            <circle cx={positions[iv.id].x} cy={positions[iv.id].y} r="6" fill={iv.color} stroke="white" strokeWidth="1.2" />
            <text x={positions[iv.id].x} y={positions[iv.id].y - 10} fontSize="7" textAnchor="middle" fill="#475569" fontWeight="600">
              {iv.name}
            </text>
            <text x={positions[iv.id].x} y={positions[iv.id].y + 14} fontSize="6" textAnchor="middle" fill="#94A3B8" fontFamily="ui-monospace">
              → {iv.target}
            </text>
          </g>
        ))}
      </svg>
      <Methodology>interventions table · effort, impact ∈ [0,1] · DAG by depends_on_intervention_ids</Methodology>
    </Card>
  );
}

// ── PREDICTION FAN CHART (weekly p10/p50/p90) ───────────────────────

function PredictionFanCard() {
  const W = 460;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const weeks = Array.from({ length: 27 }, (_, i) => i);
  const wMax = 26;
  const xs = (w: number) => padL + (w / wMax) * (W - padL - padR);
  const ymin = -1.0;
  const ymax = 0.4;
  const ys = (z: number) => padT + (1 - (z - ymin) / (ymax - ymin)) * (H - padT - padB);
  // Trajectory: predicted curve gradually approaching baseline
  const p50 = (w: number) => -0.78 + 0.62 * (1 - Math.exp(-w / 14));
  const p10 = (w: number) => p50(w) - (0.18 + 0.005 * w);
  const p90 = (w: number) => p50(w) + (0.18 + 0.005 * w);
  // Actual observations (resolved through week 8)
  const actual = [
    { w: 0, v: -0.78 },
    { w: 2, v: -0.71 },
    { w: 4, v: -0.62 },
    { w: 6, v: -0.50 },
    { w: 8, v: -0.41 },
  ];
  const upper = weeks.map((w) => `${xs(w).toFixed(1)},${ys(p90(w)).toFixed(1)}`).join(" L ");
  const lowerRev = [...weeks].reverse().map((w) => `${xs(w).toFixed(1)},${ys(p10(w)).toFixed(1)}`).join(" L ");
  const fanPath = `M ${upper} L ${lowerRev} Z`;
  const p50Path = weeks.map((w) => `${w === 0 ? "M" : "L"} ${xs(w).toFixed(1)} ${ys(p50(w)).toFixed(1)}`).join(" ");
  return (
    <Card className="w-[480px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◞ Prediction trajectory · fan chart</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">Processing Speed (N50) · 26-week forecast</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            Monte Carlo M=2000 · weekly p10/p50/p90 · resolved through w8 (expected)
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip kind="model">MODEL</Chip>
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            expected
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[220px] w-full">
        {/* gridlines */}
        {[ymin, -0.7, -0.4, -0.1, 0.2].map((g) => (
          <g key={g}>
            <line x1={padL} y1={ys(g)} x2={W - padR} y2={ys(g)} stroke="#F1F5F9" strokeWidth="0.5" />
            <text x={padL - 4} y={ys(g) + 3} fontSize="8" textAnchor="end" fill="#94A3B8">
              {g.toFixed(1)}
            </text>
          </g>
        ))}
        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        {/* fan band */}
        <path d={fanPath} fill="#7C3AED" opacity="0.18" />
        {/* p50 */}
        <path d={p50Path} fill="none" stroke="#7C3AED" strokeWidth="1.8" />
        {/* baseline at zero */}
        <line x1={padL} y1={ys(0)} x2={W - padR} y2={ys(0)} stroke="#CBD5E1" strokeDasharray="3 2" strokeWidth="0.6" />
        {/* "now" marker at w=8 */}
        <line x1={xs(8)} y1={padT} x2={xs(8)} y2={H - padB} stroke="#F59E0B" strokeWidth="0.8" strokeDasharray="2 2" />
        <text x={xs(8) + 2} y={padT + 8} fontSize="8" fill="#F59E0B" fontWeight="600">
          now (w8)
        </text>
        {/* actual points + connecting line */}
        {actual.map((a, i) => (
          <g key={i}>
            {i > 0 && (
              <line
                x1={xs(actual[i - 1].w)}
                y1={ys(actual[i - 1].v)}
                x2={xs(a.w)}
                y2={ys(a.v)}
                stroke="#0F172A"
                strokeWidth="1.4"
              />
            )}
            <circle cx={xs(a.w)} cy={ys(a.v)} r="3" fill="#0F172A" stroke="white" strokeWidth="1" />
          </g>
        ))}
        {/* x labels */}
        {[0, 4, 8, 13, 18, 26].map((w) => (
          <text key={w} x={xs(w)} y={H - padB + 12} fontSize="8" textAnchor="middle" fill="#94A3B8">
            w{w}
          </text>
        ))}
        <text x={W / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="#64748B">
          weeks since intervention start
        </text>
        <text x={4} y={padT + 4} fontSize="8" fill="#64748B">
          z (N50)
        </text>
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 bg-violet-300" />
          80% PI band
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-violet-600" />
          p50 forecast
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-900" />
          actual (resolved)
        </span>
      </div>
      <Methodology>
        prediction_ledger.predicted_trajectory + actual_trajectory · IVW basis edges N20→N30→N50 · deviation_tag = expected
      </Methodology>
    </Card>
  );
}

// ── EDGE CALIBRATION DRIFT (heatmap) ────────────────────────────────

function EdgeCalibrationDriftCard() {
  // 8 edges × 6 calibration events; cell = relative_error
  const edges = ["IL6→OIC", "OIC→PS", "ACT→IL6", "OIC→EM", "BDNF→NPL", "TNF→OIC", "OIC→FAT", "FAT→PS"];
  const events = ["c01", "c02", "c03", "c04", "c05", "c06"];
  // Synthetic but plausible relative errors; some edges drift (regime shifts)
  const data = [
    [0.05, 0.08, 0.04, 0.07, 0.06, 0.09],
    [0.07, 0.12, 0.18, 0.22, 0.34, 0.41],
    [0.04, 0.05, 0.06, 0.04, 0.05, 0.04],
    [0.09, 0.16, 0.21, 0.31, 0.28, 0.35],
    [0.18, 0.14, 0.11, 0.08, 0.07, 0.05],
    [0.05, 0.06, 0.07, 0.06, 0.05, 0.06],
    [0.08, 0.09, 0.07, 0.10, 0.11, 0.09],
    [0.12, 0.14, 0.16, 0.18, 0.21, 0.24],
  ];
  const W = 360;
  const H = 220;
  const padL = 76;
  const padT = 28;
  const padR = 8;
  const padB = 24;
  const cw = (W - padL - padR) / events.length;
  const rh = (H - padT - padB) / edges.length;
  return (
    <Card className="w-[420px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>▦ Edge calibration drift</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">Relative error over time</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {edges.length} edges × {events.length} calibration events · |Δ|/|p50|
          </div>
        </div>
        <Chip kind="model">RESOLVED</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[220px] w-full">
        {edges.map((e, r) => (
          <text key={e} x={padL - 6} y={padT + r * rh + rh / 2 + 3} fontSize="8" textAnchor="end" fill="#475569">
            {e}
          </text>
        ))}
        {events.map((ev, c) => (
          <text key={ev} x={padL + c * cw + cw / 2} y={padT - 6} fontSize="8" textAnchor="middle" fill="#94A3B8">
            {ev}
          </text>
        ))}
        {data.map((row, r) =>
          row.map((v, c) => {
            // Color: green (<0.10), amber (0.10-0.30), red (>0.30)
            const color = v < 0.1 ? "#10B981" : v < 0.3 ? "#F59E0B" : "#EF4444";
            const op = Math.max(0.18, Math.min(0.85, v * 2 + 0.15));
            return (
              <g key={`${r}-${c}`}>
                <rect
                  x={padL + c * cw + 1}
                  y={padT + r * rh + 1}
                  width={cw - 2}
                  height={rh - 2}
                  rx="2"
                  fill={color}
                  fillOpacity={op}
                />
                <text
                  x={padL + c * cw + cw / 2}
                  y={padT + r * rh + rh / 2 + 3}
                  fontSize="7"
                  textAnchor="middle"
                  fill={op > 0.55 ? "white" : "#475569"}
                  fontFamily="ui-monospace"
                >
                  {v.toFixed(2)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[9px] tabular-nums">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" />
          &lt;0.10 expected
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-500" />
          0.10–0.30 regime
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-500" />
          &gt;0.30 surprise
        </span>
      </div>
      <Methodology>edge_calibrations · path_aware_temporal_v1 · drift = monotonic |Δ| growth across events</Methodology>
    </Card>
  );
}

// ── LOOP CYCLE BURNDOWN (cycle-by-cycle KG growth) ──────────────────

const LOOP_CYCLES = [
  { n: 1, eAdd: 12, edAdd: 18, gapsClose: 4, covBefore: 0.42, covAfter: 0.51 },
  { n: 2, eAdd: 8, edAdd: 14, gapsClose: 6, covBefore: 0.51, covAfter: 0.58 },
  { n: 3, eAdd: 6, edAdd: 11, gapsClose: 5, covBefore: 0.58, covAfter: 0.64 },
  { n: 4, eAdd: 4, edAdd: 9, gapsClose: 7, covBefore: 0.64, covAfter: 0.71 },
  { n: 5, eAdd: 3, edAdd: 6, gapsClose: 4, covBefore: 0.71, covAfter: 0.76 },
  { n: 6, eAdd: 2, edAdd: 4, gapsClose: 6, covBefore: 0.76, covAfter: 0.82 },
];

function LoopCycleBurndownCard() {
  const W = 380;
  const H = 220;
  const padL = 32;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const xs = (n: number) =>
    padL + ((n - 1) / Math.max(1, LOOP_CYCLES.length - 1)) * (W - padL - padR);
  const max = Math.max(...LOOP_CYCLES.map((c) => c.eAdd + c.edAdd + c.gapsClose));
  const ys = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const covYs = (v: number) => padT + (1 - v) * (H - padT - padB);
  const barW = ((W - padL - padR) / LOOP_CYCLES.length) * 0.62;
  return (
    <Card className="w-[420px]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>↗ Loop cycle burndown</Eyebrow>
          <div className="mt-2 text-[14px] font-semibold text-slate-900">KG growth per cycle</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {LOOP_CYCLES.length} cycles run · diminishing-returns pattern · coverage 0.42 → 0.82
          </div>
        </div>
        <Chip kind="data">DATA</Chip>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[220px] w-full">
        {/* gridlines */}
        {[0, max / 2, max].map((g) => (
          <g key={g}>
            <line x1={padL} y1={ys(g)} x2={W - padR} y2={ys(g)} stroke="#F1F5F9" strokeWidth="0.5" />
            <text x={padL - 4} y={ys(g) + 3} fontSize="8" textAnchor="end" fill="#94A3B8">
              {g.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.6" />
        {/* stacked bars */}
        {LOOP_CYCLES.map((c) => {
          const x = xs(c.n) - barW / 2;
          let yCursor = ys(c.eAdd + c.edAdd + c.gapsClose);
          const eH = ((c.eAdd / max) * (H - padT - padB));
          const edH = ((c.edAdd / max) * (H - padT - padB));
          const gH = ((c.gapsClose / max) * (H - padT - padB));
          return (
            <g key={c.n}>
              <rect x={x} y={yCursor} width={barW} height={eH} fill="#7C3AED" opacity="0.85" />
              <rect x={x} y={yCursor + eH} width={barW} height={edH} fill="#06B6D4" opacity="0.85" />
              <rect x={x} y={yCursor + eH + edH} width={barW} height={gH} fill="#F59E0B" opacity="0.85" />
              <text x={xs(c.n)} y={H - padB + 12} fontSize="8" textAnchor="middle" fill="#94A3B8">
                c{c.n}
              </text>
            </g>
          );
        })}
        {/* coverage line (right axis) */}
        <path
          d={LOOP_CYCLES.map(
            (c, i) => `${i === 0 ? "M" : "L"} ${xs(c.n).toFixed(1)} ${covYs(c.covAfter).toFixed(1)}`,
          ).join(" ")}
          fill="none"
          stroke="#10B981"
          strokeWidth="1.6"
          strokeDasharray="2 2"
        />
        {LOOP_CYCLES.map((c) => (
          <circle key={c.n} cx={xs(c.n)} cy={covYs(c.covAfter)} r="2.5" fill="#10B981" stroke="white" strokeWidth="1" />
        ))}
        <text x={4} y={padT + 4} fontSize="8" fill="#64748B">
          count
        </text>
        <text x={W - padR + 2} y={padT + 4} fontSize="8" fill="#10B981">
          cov
        </text>
        <text x={W / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="#64748B">
          loop cycle
        </text>
      </svg>
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-violet-500" />
          entities added
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-cyan-500" />
          edges added
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-500" />
          gaps closed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-emerald-500" />
          coverage
        </span>
      </div>
      <Methodology>loop_cycle_records.delta · phases[] timing · coverage_after monotone non-decreasing</Methodology>
    </Card>
  );
}

// ── STRATEGY BASELINE T0 → NOW DELTA ────────────────────────────────

function StrategyBaselineDeltaCard() {
  const rows = [
    { label: "Entities", t0: 24, now: 64, unit: "" },
    { label: "Edges", t0: 8, now: 23, unit: "" },
    { label: "Cycles detected", t0: 0, now: 4, unit: "" },
    { label: "Bridges", t0: 0, now: 7, unit: "" },
    { label: "Coverage", t0: 0.31, now: 0.82, unit: "" },
    { label: "Stack health", t0: 0.42, now: 0.78, unit: "" },
    { label: "Calibrated edges", t0: 0, now: 14, unit: "" },
  ];
  return (
    <Card className="w-[360px]">
      <div className="flex items-start justify-between">
        <Eyebrow>◷ Strategy baseline · T0 → now</Eyebrow>
        <Chip kind="data">DATA</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold text-slate-900">KG state at strategy birth vs current</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
        Snapshotted on Twin proposal v1 · delta tracks drift
      </div>
      <div className="mt-4 space-y-1.5">
        {rows.map((r) => {
          const delta = r.now - r.t0;
          const ratio = r.t0 === 0 ? null : ((r.now / r.t0 - 1) * 100).toFixed(0);
          const isUp = delta > 0;
          return (
            <div key={r.label} className="grid grid-cols-[100px_56px_28px_56px_60px] items-baseline gap-2 text-[11px]">
              <span className="text-slate-700">{r.label}</span>
              <span className="text-right font-mono tabular-nums text-slate-400">
                {Number.isInteger(r.t0) ? r.t0 : r.t0.toFixed(2)}
              </span>
              <span className="text-center text-slate-300">→</span>
              <span className="text-right font-mono font-semibold tabular-nums text-slate-900">
                {Number.isInteger(r.now) ? r.now : r.now.toFixed(2)}
              </span>
              <span
                className={`text-right font-mono text-[9px] tabular-nums ${
                  isUp ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {isUp ? "↑" : "↓"} {Number.isInteger(delta) ? Math.abs(delta) : Math.abs(delta).toFixed(2)}
                {ratio !== null ? ` (${isUp ? "+" : ""}${ratio}%)` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <Methodology>strategy_baselines.kg_snapshot · twin_state diff · captured at twin_proposal.approved_at</Methodology>
    </Card>
  );
}

// ── REALITY CALIBRATION SCOREBOARD ──────────────────────────────────

function RealityCalibrationCard() {
  const baselines = [
    { name: "OIC mediates chemo→PS", attempts: 4, passed: 3, score: 0.78, status: "passing" },
    { name: "Sleep ↑ → cortisol slope ↓", attempts: 3, passed: 3, score: 0.91, status: "passing" },
    { name: "BDNF mediates exercise→memory", attempts: 5, passed: 2, score: 0.41, status: "weak" },
    { name: "APOE × age interaction", attempts: 2, passed: 0, score: 0.12, status: "blocked" },
  ];
  const statusTone: Record<string, string> = {
    passing: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    weak: "bg-amber-50 text-amber-700 ring-amber-200",
    blocked: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  return (
    <Card className="w-[420px]">
      <div className="flex items-start justify-between">
        <Eyebrow>✓ Reality calibration · scoreboard</Eyebrow>
        <Chip kind="model">RESOLVED</Chip>
      </div>
      <div className="mt-2 text-[14px] font-semibold text-slate-900">Baseline reproduction</div>
      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
        4 declared baselines · 8 attempts · aggregate 0.56
      </div>
      <div className="mt-4 space-y-3">
        {baselines.map((b) => (
          <div key={b.name}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-slate-700">{b.name}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ${statusTone[b.status]}`}>
                {b.status}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${(b.score * 100).toFixed(0)}%`,
                    background: b.score > 0.7 ? "#10B981" : b.score > 0.4 ? "#F59E0B" : "#EF4444",
                  }}
                />
              </div>
              <span className="font-mono text-[10px] tabular-nums text-slate-600">{b.score.toFixed(2)}</span>
              <span className="font-mono text-[9px] tabular-nums text-slate-400">
                {b.passed}/{b.attempts}
              </span>
            </div>
          </div>
        ))}
      </div>
      <Methodology>
        reality_calibrations · per-baseline {"{computed_value, verdict, blocker_entity_ids}"} · aggregate from passed/attempts
      </Methodology>
    </Card>
  );
}

// ── OBJECTIVE TREE (improvement_goals → sub_objectives → tactics) ──

type TreeMetric = {
  name: string;
  current: string;
  target: string;
  threshold: "green" | "yellow" | "red";
};
type TreeTactic = { name: string; effort: number; impact: number; metrics: TreeMetric[]; linked_app?: string; status: "active" | "queued" | "deferred" };
type TreeSub = { id: string; name: string; rationale: string; tactics: TreeTactic[] };
type TreeGoal = { id: string; name: string; horizon: string; subs: TreeSub[] };

const OBJECTIVE_TREE: TreeGoal[] = [
  {
    id: "g1",
    name: "Reduce CRCI burden by 0.30z within 12mo",
    horizon: "12 months",
    subs: [
      {
        id: "g1.s1",
        name: "Suppress neuroinflammation (N30) ≥30%",
        rationale: "Bottleneck — 73% of treatment→cognition paths route through N30",
        tactics: [
          {
            name: "150 min/wk aerobic exercise",
            effort: 0.55,
            impact: 0.85,
            status: "active",
            linked_app: "Anti-Inflammatory Stack",
            metrics: [
              { name: "IL-6 (pg/mL)", current: "+0.42z", target: "≤0", threshold: "yellow" },
              { name: "MVPA min/wk", current: "60", target: "150", threshold: "yellow" },
            ],
          },
          {
            name: "Mediterranean diet score ≥7",
            effort: 0.65,
            impact: 0.44,
            status: "queued",
            metrics: [{ name: "MIND score", current: "5.2", target: "≥7", threshold: "yellow" }],
          },
        ],
      },
      {
        id: "g1.s2",
        name: "Restore HPA rhythm (N32 cortisol slope)",
        rationale: "Slow-burn risk; flat AM rise compounds over months",
        tactics: [
          {
            name: "CBT-I 8-week protocol",
            effort: 0.48,
            impact: 0.71,
            status: "queued",
            linked_app: "Sleep Protocol",
            metrics: [
              { name: "PSQI score", current: "11", target: "<5", threshold: "red" },
              { name: "AM cortisol", current: "8.4 nmol/L", target: "12–18", threshold: "red" },
            ],
          },
          {
            name: "MBSR 8-week",
            effort: 0.41,
            impact: 0.58,
            status: "deferred",
            linked_app: "MBSR / Stress",
            metrics: [{ name: "PSS-10", current: "26", target: "<14", threshold: "red" }],
          },
        ],
      },
      {
        id: "g1.s3",
        name: "Promote neuroplasticity (BDNF + cog reserve)",
        rationale: "Direct effect Δz≈0.30 on Processing Speed + multiplier on other interventions",
        tactics: [
          {
            name: "Cognitive training 3×/wk",
            effort: 0.32,
            impact: 0.51,
            status: "active",
            linked_app: "Cognitive Game",
            metrics: [
              { name: "BrainHQ adherence", current: "2.1×/wk", target: "3×/wk", threshold: "yellow" },
              { name: "BDNF (ng/mL)", current: "−0.18z", target: "+0.20z", threshold: "yellow" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "g2",
    name: "Maintain functional autonomy (ADL + IADL)",
    horizon: "Continuous",
    subs: [
      {
        id: "g2.s1",
        name: "Composite ProcSpeed ≥ -0.40z",
        rationale: "Threshold below which IADL impairment becomes detectable",
        tactics: [
          {
            name: "NIHTB-CB battery quarterly",
            effort: 0.20,
            impact: 0.28,
            status: "active",
            linked_app: "Cognitive Measurement",
            metrics: [{ name: "ProcSpeed z", current: "−0.78", target: "≥−0.40", threshold: "red" }],
          },
        ],
      },
    ],
  },
];

// Apple-tier design tokens (replicating ObjectivesDecompositionShell)
const TREE_S = {
  l1Bg: "rgba(26,122,255,0.15)",
  l1Color: "#0051ff",
  l1Border: "rgba(26,122,255,0.32)",
  l2Bg: "rgba(88,86,214,0.15)",
  l2Color: "#3c44d9",
  l2Border: "rgba(88,86,214,0.32)",
  l3Bg: "rgba(255,149,0,0.18)",
  l3Color: "#c77400",
  l3Border: "rgba(255,149,0,0.36)",
  shellBg: "rgba(255, 255, 255, 0.82)",
  shellBorder: "1px solid rgba(255, 255, 255, 0.85)",
  shellShadow:
    "0 40px 100px -30px rgba(8,60,180,0.20), 0 18px 40px -18px rgba(8,60,180,0.14), inset 0 1.5px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(255,255,255,0.35)",
  shellInnerTint: "linear-gradient(180deg, rgba(240,245,255,0.5), rgba(255,255,255,0))",
  cardBg: "rgba(255,255,255,0.65)",
  cardBorder: "1px solid rgba(255,255,255,0.9)",
  cardShadow:
    "0 10px 28px -12px rgba(8,60,180,0.18), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.3)",
};

function NumberMarker({ level, label }: { level: 1 | 2 | 3; label: string }) {
  const size = level === 1 ? 36 : level === 2 ? 28 : 22;
  const fontSize = level === 1 ? 13 : level === 2 ? 11 : 9;
  const bg = level === 1 ? TREE_S.l1Bg : level === 2 ? TREE_S.l2Bg : TREE_S.l3Bg;
  const color = level === 1 ? TREE_S.l1Color : level === 2 ? TREE_S.l2Color : TREE_S.l3Color;
  const border = level === 1 ? TREE_S.l1Border : level === 2 ? TREE_S.l2Border : TREE_S.l3Border;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-mono font-semibold tabular-nums"
      style={{ width: size, height: size, background: bg, color, border: `1px solid ${border}`, fontSize, boxShadow: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px ${color}20` }}
    >
      {label}
    </div>
  );
}

function ObjectiveTreeCard() {
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({ "g1.s1": true });
  const goalCount = OBJECTIVE_TREE.length;
  const subCount = OBJECTIVE_TREE.reduce((a, g) => a + g.subs.length, 0);
  const tacticCount = OBJECTIVE_TREE.reduce(
    (a, g) => a + g.subs.reduce((b, s) => b + s.tactics.length, 0),
    0,
  );
  const metricCount = OBJECTIVE_TREE.reduce(
    (a, g) =>
      a +
      g.subs.reduce((b, s) => b + s.tactics.reduce((c, t) => c + t.metrics.length, 0), 0),
    0,
  );

  const thresholdColor: Record<string, string> = {
    green: "#10B981",
    yellow: "#F59E0B",
    red: "#EF4444",
  };
  const statusStyles: Record<string, { bg: string; text: string; border: string }> = {
    active: { bg: "rgba(124,58,237,0.12)", text: "#7C3AED", border: "rgba(124,58,237,0.28)" },
    queued: { bg: "rgba(15,23,42,0.06)", text: "#475569", border: "rgba(15,23,42,0.12)" },
    deferred: { bg: "rgba(15,23,42,0.04)", text: "#94A3B8", border: "rgba(15,23,42,0.08)" },
  };

  return (
    <div
      className="relative w-[1080px] overflow-hidden rounded-3xl"
      style={{
        background: TREE_S.shellBg,
        border: TREE_S.shellBorder,
        boxShadow: TREE_S.shellShadow,
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: TREE_S.shellInnerTint }} />

      {/* Header with mission icon */}
      <div className="relative px-8 pb-4 pt-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
              style={{
                background: "linear-gradient(145deg, #0a1020 0%, #1f2d5a 55%, #0051ff 110%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 12px 32px rgba(0,30,140,0.35), 0 4px 12px rgba(0,30,140,0.2)",
              }}
            >
              <span className="relative z-10 font-mono text-[16px] font-semibold text-white">▤</span>
              <div
                className="absolute inset-0 animate-spin"
                style={{
                  background: "conic-gradient(from 0deg, rgba(79,163,255,0) 0deg, rgba(79,163,255,0.5) 60deg, rgba(79,163,255,0) 120deg)",
                  animationDuration: "4s",
                  mixBlendMode: "screen",
                }}
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Objective Decomposition
              </div>
              <div className="mt-1 text-[18px] font-semibold leading-tight tracking-tight text-slate-900">
                Improvement goals → sub-objectives → tactics → metrics
              </div>
              <div className="mt-1 flex items-center gap-3 font-mono text-[10px] tabular-nums text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                </span>
                <span className="text-slate-300">·</span>
                <span><span className="text-slate-700 font-semibold">{goalCount}</span> L1</span>
                <span className="text-slate-300">·</span>
                <span><span className="text-slate-700 font-semibold">{subCount}</span> L2</span>
                <span className="text-slate-300">·</span>
                <span><span className="text-slate-700 font-semibold">{tacticCount}</span> L3</span>
                <span className="text-slate-300">·</span>
                <span><span className="text-slate-700 font-semibold">{metricCount}</span> metrics</span>
              </div>
            </div>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: TREE_S.l1Bg, color: TREE_S.l1Color, border: `1px solid ${TREE_S.l1Border}` }}
          >
            strategy v4
          </span>
        </div>
      </div>

      {/* Tree body with bezier connectors */}
      <div className="relative px-8 pb-6 pt-2">
        {OBJECTIVE_TREE.map((goal, gi) => (
          <div key={goal.id} className="relative mb-5 last:mb-0">
            {/* L1: GOAL */}
            <div
              className="relative rounded-2xl p-4"
              style={{ background: TREE_S.cardBg, border: TREE_S.cardBorder, boxShadow: TREE_S.cardShadow, backdropFilter: "blur(12px)" }}
            >
              <div className="flex items-start gap-3">
                <NumberMarker level={1} label={String(gi + 1)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[8.5px] font-semibold uppercase tracking-wider"
                      style={{ background: TREE_S.l1Bg, color: TREE_S.l1Color, border: `1px solid ${TREE_S.l1Border}` }}
                    >
                      L1 · Concept
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">{goal.id}</span>
                    <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-600 ring-1 ring-slate-200">
                      ◷ {goal.horizon}
                    </span>
                  </div>
                  <div className="mt-2 text-[16px] font-semibold leading-tight tracking-tight text-slate-900">
                    {goal.name}
                  </div>
                </div>
              </div>
            </div>

            {/* L2: SUB-OBJECTIVES with gradient bezier */}
            <div className="relative ml-[18px] mt-3">
              {/* Vertical connector spine (L1 → L2 gradient) */}
              <div
                className="absolute left-0 top-0 bottom-3 w-px"
                style={{ background: "linear-gradient(180deg, rgba(26,122,255,0.5) 0%, rgba(88,86,214,0.5) 100%)" }}
              />

              {goal.subs.map((sub, si) => {
                const isOpen = openSubs[sub.id] ?? false;
                return (
                  <div key={sub.id} className="relative pb-3 pl-7 last:pb-0">
                    {/* Horizontal stem */}
                    <div
                      className="absolute left-0 top-7 h-px w-6"
                      style={{ background: "linear-gradient(90deg, rgba(88,86,214,0.5) 0%, rgba(88,86,214,0.18) 100%)" }}
                    />
                    {/* Junction dot */}
                    <div className="absolute left-[24px] top-[26px] h-1 w-1 rounded-full" style={{ background: TREE_S.l2Color }} />

                    {/* L2 card */}
                    <div
                      className="rounded-xl"
                      style={{ background: TREE_S.cardBg, border: TREE_S.cardBorder, boxShadow: TREE_S.cardShadow, backdropFilter: "blur(10px)" }}
                    >
                      <button
                        className="flex w-full items-start gap-3 p-3.5 text-left"
                        onClick={() => setOpenSubs((p) => ({ ...p, [sub.id]: !isOpen }))}
                      >
                        <NumberMarker level={2} label={`${gi + 1}.${si + 1}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span
                              className="rounded-full px-2 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-wider"
                              style={{ background: TREE_S.l2Bg, color: TREE_S.l2Color, border: `1px solid ${TREE_S.l2Border}` }}
                            >
                              L2 · {sub.tactics.some((t) => t.status === "active") ? "Active" : "Pending"}
                            </span>
                            <span className="font-mono text-[8.5px] uppercase tracking-wider text-slate-400">{sub.id}</span>
                            <span className="ml-auto font-mono text-[9px] tabular-nums text-slate-400">
                              {sub.tactics.length} tactic{sub.tactics.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="mt-1.5 text-[13px] font-semibold leading-snug tracking-tight text-slate-900">
                            {sub.name}
                          </div>
                          <div className="mt-1 text-[11px] italic leading-snug text-slate-600">{sub.rationale}</div>
                        </div>
                        <span
                          className="shrink-0 self-center font-mono text-[14px] text-slate-400 transition-transform duration-200"
                          style={{ transform: isOpen ? "rotate(45deg)" : "rotate(0deg)" }}
                        >
                          +
                        </span>
                      </button>

                      {/* L3: TACTICS with gradient bezier */}
                      {isOpen && (
                        <div className="relative ml-[18px] border-t border-slate-100/60 px-3 pb-3 pt-3">
                          <div
                            className="absolute left-0 top-0 bottom-2 w-px"
                            style={{ background: "linear-gradient(180deg, rgba(88,86,214,0.5) 0%, rgba(255,149,0,0.5) 100%)" }}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            {sub.tactics.map((t, ti) => {
                              const status = statusStyles[t.status];
                              const tacticLabel = String.fromCharCode(97 + ti); // a, b, c…
                              return (
                                <div key={ti} className="relative">
                                  {/* Horizontal stem to L3 */}
                                  <div
                                    className="absolute -left-4 top-4 h-px w-3"
                                    style={{ background: "linear-gradient(90deg, rgba(255,149,0,0.5) 0%, rgba(255,149,0,0.18) 100%)" }}
                                  />
                                  <div
                                    className="rounded-lg p-3"
                                    style={{
                                      background: "rgba(255,255,255,0.95)",
                                      border: "1px solid rgba(255,255,255,0.95)",
                                      boxShadow: "0 6px 18px -10px rgba(255,149,0,0.18), inset 0 1px 0 rgba(255,255,255,0.85)",
                                    }}
                                  >
                                    <div className="flex items-start gap-2">
                                      <NumberMarker level={3} label={tacticLabel} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline gap-2">
                                          <span
                                            className="rounded-full px-1.5 py-0.5 font-mono text-[7px] font-semibold uppercase tracking-wider"
                                            style={{ background: TREE_S.l3Bg, color: TREE_S.l3Color, border: `1px solid ${TREE_S.l3Border}` }}
                                          >
                                            L3 · Tactic
                                          </span>
                                          <span
                                            className="rounded-full px-1.5 py-0.5 font-mono text-[7px] font-semibold uppercase tracking-wider"
                                            style={{ background: status.bg, color: status.text, border: `1px solid ${status.border}` }}
                                          >
                                            {t.status}
                                          </span>
                                        </div>
                                        <div className="mt-1 truncate text-[11.5px] font-semibold leading-tight text-slate-900">
                                          {t.name}
                                        </div>
                                        {t.linked_app && (
                                          <div className="mt-0.5 truncate font-mono text-[8.5px] tabular-nums text-slate-500">
                                            ↳ {t.linked_app}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                                      <div className="rounded-md bg-slate-50/80 px-1.5 py-1 text-center">
                                        <div className="font-mono text-[7px] uppercase tracking-wider text-slate-400">effort</div>
                                        <div className="mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700">{t.effort.toFixed(2)}</div>
                                      </div>
                                      <div className="rounded-md bg-slate-50/80 px-1.5 py-1 text-center">
                                        <div className="font-mono text-[7px] uppercase tracking-wider text-slate-400">impact</div>
                                        <div className="mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-700">{t.impact.toFixed(2)}</div>
                                      </div>
                                    </div>
                                    {t.metrics.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {t.metrics.map((m, mi) => (
                                          <div key={mi} className="flex items-center gap-1.5 rounded bg-slate-50/60 px-1.5 py-1 text-[8.5px]">
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: thresholdColor[m.threshold] }} />
                                            <span className="flex-1 truncate text-slate-600">{m.name}</span>
                                            <span className="font-mono tabular-nums text-slate-700">{m.current}</span>
                                            <span className="text-slate-300">→</span>
                                            <span className="font-mono tabular-nums text-slate-500">{m.target}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer methodology */}
      <div className="relative border-t border-slate-200/40 bg-white/40 px-8 py-3">
        <div className="font-mono text-[9px] tabular-nums leading-snug text-slate-500">
          strategy_snapshots.improvement_goals → sub_objectives → micro_tactics · L1 blue / L2 purple / L3 orange ·
          gradient bezier connectors · metrics carry green/yellow/red thresholds from variable_proposals.metric_definition
        </div>
      </div>
    </div>
  );
}

// ── TEMPLATE ARCHITECTURE (whiteboard view of card data flow) ───────

type TArchCard = {
  id: string;
  label: string;
  layer: number;
  yIdx: number;
  glyph: string;
  hint?: string;
  status?: "wired" | "partial" | "missing";
  family: string; // semantic cluster id within the column
  role: "trunk" | "branch"; // trunk = encompassing topic; branch = sub-operation
};

type TArchEdge = { from: string; to: string; kind?: "data" | "feedback" };

// Family display labels — shown as eyebrow on background zones
const TEMPLATE_ARCH_FAMILIES: Record<string, string> = {
  // L0
  "L0:setup": "Setup",
  "L0:materialize": "Materialize",
  "L0:strategy": "Strategy",
  "L0:data": "User data",
  // L1
  "L1:graph": "Graph",
  "L1:profile": "Profiles",
  "L1:reference": "Reference",
  "L1:app": "Apps",
  // L2
  "L2:bottleneck": "Bottleneck",
  "L2:temporal": "Temporal",
  "L2:intervention": "Intervention",
  "L2:agent": "Agent fleet",
  // L3
  "L3:insights": "Insights",
  "L3:hypothesis": "Hypothesis",
  // L4
  "L4:twin": "Digital twin",
  "L4:action": "Action plan",
  "L4:observation": "Observation",
  "L4:lab": "Lab",
  // L5
  "L5:calibration": "Calibration",
  "L5:loop": "Loop",
  "L5:intel": "Intel",
  // L6
  "L6:proposal": "Proposal",
};

const TEMPLATE_ARCH_LAYERS = [
  { id: 0, label: "Ingest", color: "#0EA5E9" },
  { id: 1, label: "Substrate", color: "#94A3B8" },
  { id: 2, label: "Analysis", color: "#F59E0B" },
  { id: 3, label: "Insights", color: "#EC4899" },
  { id: 4, label: "Forecast", color: "#7C3AED" },
  { id: 5, label: "Audit", color: "#10B981" },
  { id: 6, label: "Proposals", color: "#1E293B" },
];

const TEMPLATE_ARCH_CARDS: TArchCard[] = [
  // ── L0 · INGEST ──────────────────────────────────────────────────
  // Setup family
  { id: "template_select", label: "Template selection", layer: 0, yIdx: 0, glyph: "◐", hint: "/app/explore gallery", family: "L0:setup", role: "trunk" },
  { id: "objective_intake", label: "Objective intake", layer: 0, yIdx: 1, glyph: "◎", hint: "goal · horizon · scope", family: "L0:setup", role: "branch" },
  // Materialize family — the build chain
  { id: "seed_materialize", label: "Seed materialize", layer: 0, yIdx: 2, glyph: "◇", hint: "template → DB", family: "L0:materialize", role: "trunk" },
  { id: "edge_augmenter", label: "Edge augmenter (D11)", layer: 0, yIdx: 3, glyph: "⌅", hint: "auto-wire isolates", family: "L0:materialize", role: "branch" },
  { id: "ingestion_pipeline", label: "Evidence pipeline", layer: 0, yIdx: 4, glyph: "◌", hint: "11-stage DOI/CSV", family: "L0:materialize", role: "branch" },
  { id: "research_orchestration", label: "Research orchestration", layer: 0, yIdx: 5, glyph: "↻", hint: "LLM passes", family: "L0:materialize", role: "branch" },
  { id: "synthesis_decomp", label: "Synthesis decomp", layer: 0, yIdx: 6, glyph: "▣", hint: "leverage/risk + goals", family: "L0:materialize", role: "branch" },
  // Strategy family
  { id: "strategy_twin", label: "Strategy + Twin proposal", layer: 0, yIdx: 7, glyph: "◇", hint: "ranked + justified", family: "L0:strategy", role: "trunk" },
  { id: "intake_review", label: "Intake review wizard", layer: 0, yIdx: 8, glyph: "▤", hint: "4-step approve/defer", family: "L0:strategy", role: "branch" },
  // Data family
  { id: "csv_drop", label: "CSV / panel data", layer: 0, yIdx: 9, glyph: "↧", hint: "ongoing user data", family: "L0:data", role: "trunk" },

  // ── L1 · SUBSTRATE ──────────────────────────────────────────────
  // Graph family — kg_graph is the principal artifact
  { id: "kg_graph", label: "Layered DAG (full)", layer: 1, yIdx: 0, glyph: "◫", hint: "L0→L6", family: "L1:graph", role: "trunk" },
  { id: "kg_overview", label: "KG overview", layer: 1, yIdx: 1, glyph: "▦", hint: "64n · 23e", family: "L1:graph", role: "branch" },
  { id: "multi_lenses", label: "Multi-view (4 lenses)", layer: 1, yIdx: 2, glyph: "▣", hint: "lay·sph·force·mat", family: "L1:graph", role: "branch" },
  // Profile family
  { id: "subjects", label: "Subjects (4 types)", layer: 1, yIdx: 3, glyph: "◯", hint: "patient profiles", family: "L1:profile", role: "trunk" },
  { id: "vuln_matrix", label: "Vulnerability matrix", layer: 1, yIdx: 4, glyph: "▦", hint: "7c × 8p", family: "L1:profile", role: "branch" },
  // Reference family
  { id: "ref_domains", label: "Reference domains", layer: 1, yIdx: 5, glyph: "◐", hint: "z-score CIs", family: "L1:reference", role: "trunk" },
  // App family
  { id: "app_materializer", label: "App materializer", layer: 1, yIdx: 6, glyph: "▢", hint: "1 proposal → N apps", status: "wired", family: "L1:app", role: "trunk" },

  // ── L2 · ANALYSIS ────────────────────────────────────────────────
  // Bottleneck family
  { id: "master_bottleneck", label: "Master bottleneck", layer: 2, yIdx: 0, glyph: "▴", hint: "N30 CF", family: "L2:bottleneck", role: "trunk" },
  // Temporal family
  { id: "temporal_atlas", label: "Temporal atlas", layer: 2, yIdx: 1, glyph: "◴", hint: "REML pools", family: "L2:temporal", role: "trunk" },
  { id: "decay_kinetics", label: "Decay kinetics", layer: 2, yIdx: 2, glyph: "◔", hint: "lin·exp·sus·bi", family: "L2:temporal", role: "branch" },
  { id: "recovery_curves", label: "Recovery curves", layer: 2, yIdx: 3, glyph: "◜", hint: "Weibull 10c", family: "L2:temporal", role: "branch" },
  // Intervention family
  { id: "interv_dag", label: "Intervention DAG", layer: 2, yIdx: 4, glyph: "⬡", hint: "effort × impact", family: "L2:intervention", role: "trunk" },
  { id: "apps_portfolio", label: "Apps portfolio", layer: 2, yIdx: 5, glyph: "▣", hint: "pri × cmplx", family: "L2:intervention", role: "branch" },
  { id: "dose_response", label: "Dose-response (6)", layer: 2, yIdx: 6, glyph: "⬢", hint: "Hill curves", family: "L2:intervention", role: "branch" },
  // Agent family
  { id: "agent_fleet", label: "Agent fleet (Sprint 3)", layer: 2, yIdx: 7, glyph: "◴", hint: "autonomous ops · Sprint 3", status: "wired", family: "L2:agent", role: "trunk" },
  { id: "app_tether", label: "App tether (pairs)", layer: 2, yIdx: 8, glyph: "⊜", hint: "complementary_app_ids", status: "partial", family: "L2:agent", role: "branch" },

  // ── L3 · INSIGHTS ────────────────────────────────────────────────
  // Insights family
  { id: "hidden_insights", label: "Hidden insights", layer: 3, yIdx: 0, glyph: "↻", hint: "cyc·brg·dis·tmp", family: "L3:insights", role: "trunk" },
  { id: "variance_decomp", label: "Variance decomp", layer: 3, yIdx: 1, glyph: "◐", hint: "5-source", family: "L3:insights", role: "branch" },
  { id: "calib_cascade", label: "Calibration cascade", layer: 3, yIdx: 2, glyph: "◇", hint: "7-layer SE", family: "L3:insights", role: "branch" },
  { id: "forest_plot", label: "Forest plot", layer: 3, yIdx: 3, glyph: "◆", hint: "6 dom + comp", family: "L3:insights", role: "branch" },
  // Hypothesis family
  { id: "hypothesis_ladders", label: "Hypothesis ladders", layer: 3, yIdx: 4, glyph: "≡", hint: "claim·mech·falsifier·verdict", family: "L3:hypothesis", role: "trunk" },
  { id: "argument_tribunal", label: "Argument tribunal", layer: 3, yIdx: 5, glyph: "⚖", hint: "claim vs counter-claim", family: "L3:hypothesis", role: "branch" },
  { id: "cycle_break_planner", label: "Cycle break planner", layer: 3, yIdx: 6, glyph: "✂", hint: "lowest-cost break point", family: "L3:hypothesis", role: "branch" },

  // ── L4 · FORECAST ────────────────────────────────────────────────
  // Twin family
  { id: "twin", label: "Digital twin", layer: 4, yIdx: 0, glyph: "◯", hint: "fwd-pass", family: "L4:twin", role: "trunk" },
  { id: "trajectory", label: "Trajectory · 37mo", layer: 4, yIdx: 1, glyph: "◇", hint: "rec + IV", family: "L4:twin", role: "branch" },
  { id: "prediction_fan", label: "Prediction fan", layer: 4, yIdx: 2, glyph: "◞", hint: "p10/50/90", family: "L4:twin", role: "branch" },
  // Action family
  { id: "action_plan", label: "Action plan", layer: 4, yIdx: 3, glyph: "▤", hint: "4 phases", family: "L4:action", role: "trunk" },
  // Observation family
  { id: "metric_observations", label: "Metric observations", layer: 4, yIdx: 4, glyph: "↧", hint: "user/sensor outcomes", status: "wired", family: "L4:observation", role: "trunk" },
  { id: "app_outcomes", label: "App outcomes", layer: 4, yIdx: 5, glyph: "◑", hint: "what each app delivered", status: "wired", family: "L4:observation", role: "branch" },
  { id: "prediction_resolver", label: "Prediction resolver", layer: 4, yIdx: 6, glyph: "◎", hint: "actual vs p50 · path_aware_temporal_v1", status: "wired", family: "L4:observation", role: "branch" },
  // Lab family
  { id: "lab_scaffold", label: "Lab scaffold (assembly)", layer: 4, yIdx: 7, glyph: "◫", hint: "multi-app experiments", status: "missing", family: "L4:lab", role: "trunk" },

  // ── L5 · AUDIT ───────────────────────────────────────────────────
  // Calibration family
  { id: "calib_scatter", label: "Calibration scatter", layer: 5, yIdx: 0, glyph: "◯", hint: "pred vs obs", family: "L5:calibration", role: "trunk" },
  { id: "edge_drift", label: "Edge calib drift", layer: 5, yIdx: 1, glyph: "▦", hint: "8e × 6c", family: "L5:calibration", role: "branch" },
  { id: "reality_calib", label: "Reality scoreboard", layer: 5, yIdx: 2, glyph: "✓", hint: "baselines", family: "L5:calibration", role: "branch" },
  // Loop family
  { id: "loop_recorder", label: "Loop cycle recorder", layer: 5, yIdx: 3, glyph: "↺", hint: "writes loop_cycle_records", status: "missing", family: "L5:loop", role: "trunk" },
  { id: "loop_burndown", label: "Loop burndown", layer: 5, yIdx: 4, glyph: "↗", hint: "6 cycles", family: "L5:loop", role: "branch" },
  { id: "baseline_delta", label: "Baseline T0→Now", layer: 5, yIdx: 5, glyph: "◷", hint: "KG diff", family: "L5:loop", role: "branch" },
  // Intel family
  { id: "intel_radar", label: "Intelligence radar", layer: 5, yIdx: 6, glyph: "◬", hint: "6-axis system health", family: "L5:intel", role: "trunk" },

  // ── L6 · PROPOSALS ───────────────────────────────────────────────
  // Proposal family
  { id: "proposal_funnel", label: "Proposal intake", layer: 6, yIdx: 0, glyph: "⊞", hint: "6-stream", family: "L6:proposal", role: "trunk" },
  { id: "discovery_auto_propose", label: "Discovery auto-propose", layer: 6, yIdx: 1, glyph: "↻", hint: "drift → next cycle", status: "partial", family: "L6:proposal", role: "branch" },
];

const TEMPLATE_ARCH_EDGES: TArchEdge[] = [
  // L0 intra-flow (sequential intake chain)
  { from: "template_select", to: "objective_intake" },
  { from: "template_select", to: "seed_materialize" },
  { from: "objective_intake", to: "strategy_twin" },
  { from: "seed_materialize", to: "edge_augmenter" },
  { from: "edge_augmenter", to: "ingestion_pipeline" },
  { from: "ingestion_pipeline", to: "research_orchestration" },
  { from: "research_orchestration", to: "synthesis_decomp" },
  { from: "synthesis_decomp", to: "strategy_twin" },
  { from: "strategy_twin", to: "intake_review" },

  // L0 → L1 Substrate (template seeds + ongoing data)
  { from: "seed_materialize", to: "kg_overview" },
  { from: "seed_materialize", to: "kg_graph" },
  { from: "seed_materialize", to: "subjects" },
  { from: "edge_augmenter", to: "kg_graph" },
  { from: "research_orchestration", to: "kg_graph" },
  { from: "csv_drop", to: "kg_graph" },
  { from: "csv_drop", to: "vuln_matrix" },
  { from: "csv_drop", to: "ref_domains" },

  // L0 → L2/L3 (synthesis populates analysis & insights directly)
  { from: "synthesis_decomp", to: "master_bottleneck" },
  { from: "synthesis_decomp", to: "hidden_insights" },
  { from: "synthesis_decomp", to: "forest_plot" },
  { from: "synthesis_decomp", to: "variance_decomp" },

  // L0 → L4 (strategy → twin + apps + interventions)
  { from: "strategy_twin", to: "twin" },
  { from: "strategy_twin", to: "apps_portfolio" },
  { from: "strategy_twin", to: "interv_dag" },

  // L0 → L4 (intake review gates apps + action plan)
  { from: "intake_review", to: "apps_portfolio" },
  { from: "intake_review", to: "action_plan" },

  // ─── Deployment & feedback chain ─────────────────────────────────
  // Approval → app materialization
  { from: "intake_review", to: "app_materializer" },
  { from: "strategy_twin", to: "app_materializer" },
  { from: "app_materializer", to: "apps_portfolio" },
  { from: "app_materializer", to: "interv_dag" },

  // Apps → agent fleet → cross-app coordination
  { from: "apps_portfolio", to: "agent_fleet" },
  { from: "agent_fleet", to: "app_tether" },

  // Apps → metric capture → app outcomes → resolution
  { from: "agent_fleet", to: "metric_observations" },
  { from: "metric_observations", to: "app_outcomes" },
  { from: "apps_portfolio", to: "app_outcomes" },
  { from: "agent_fleet", to: "app_outcomes" },
  { from: "app_outcomes", to: "prediction_resolver" },
  { from: "app_outcomes", to: "action_plan" },
  { from: "metric_observations", to: "prediction_resolver" },
  { from: "metric_observations", to: "prediction_fan" },
  { from: "prediction_resolver", to: "edge_drift" },
  { from: "prediction_resolver", to: "calib_scatter" },
  { from: "prediction_resolver", to: "reality_calib" },

  // Lab scaffold composes multiple apps
  { from: "apps_portfolio", to: "lab_scaffold" },
  { from: "subjects", to: "lab_scaffold" },

  // Loop recorder consumes cycle outcomes
  { from: "app_outcomes", to: "loop_recorder" },
  { from: "loop_recorder", to: "loop_burndown" },
  { from: "loop_recorder", to: "baseline_delta" },

  // Hypothesis ladders: derived from leverage points + edge calibrations
  { from: "synthesis_decomp", to: "hypothesis_ladders" },
  { from: "edge_drift", to: "hypothesis_ladders" },
  { from: "hypothesis_ladders", to: "proposal_funnel" },

  // Argument tribunal: contradictions from synthesis
  { from: "synthesis_decomp", to: "argument_tribunal" },
  { from: "argument_tribunal", to: "proposal_funnel" },

  // Cycle break planner: actionable from cycle detection
  { from: "hidden_insights", to: "cycle_break_planner" },
  { from: "cycle_break_planner", to: "interv_dag" },
  { from: "cycle_break_planner", to: "action_plan" },

  // Intelligence radar: aggregates signals from across system
  { from: "kg_overview", to: "intel_radar" },
  { from: "hidden_insights", to: "intel_radar" },
  { from: "edge_drift", to: "intel_radar" },
  { from: "loop_burndown", to: "intel_radar" },

  // Closed loop: drift → discovery auto-propose → proposal funnel
  { from: "edge_drift", to: "discovery_auto_propose" },
  { from: "loop_burndown", to: "discovery_auto_propose" },
  { from: "discovery_auto_propose", to: "proposal_funnel" },
  // Substrate → Substrate (peer)
  { from: "kg_overview", to: "kg_graph" },
  { from: "kg_graph", to: "multi_lenses" },
  // Substrate → Analysis
  { from: "kg_graph", to: "master_bottleneck" },
  { from: "kg_graph", to: "temporal_atlas" },
  { from: "kg_graph", to: "interv_dag" },
  { from: "kg_graph", to: "apps_portfolio" },
  { from: "temporal_atlas", to: "decay_kinetics" },
  { from: "vuln_matrix", to: "recovery_curves" },
  { from: "interv_dag", to: "dose_response" },
  { from: "subjects", to: "trajectory" },
  // Analysis → Insights
  { from: "master_bottleneck", to: "hidden_insights" },
  { from: "temporal_atlas", to: "hidden_insights" },
  { from: "interv_dag", to: "hidden_insights" },
  { from: "temporal_atlas", to: "calib_cascade" },
  { from: "ref_domains", to: "forest_plot" },
  { from: "kg_graph", to: "variance_decomp" },
  // Analysis/Insights → Forecast
  { from: "recovery_curves", to: "trajectory" },
  { from: "interv_dag", to: "trajectory" },
  { from: "kg_graph", to: "twin" },
  { from: "temporal_atlas", to: "prediction_fan" },
  { from: "forest_plot", to: "twin" },
  { from: "trajectory", to: "action_plan" },
  { from: "twin", to: "action_plan" },
  // Forecast → Audit (calibration feedback loop)
  { from: "prediction_fan", to: "calib_scatter" },
  { from: "prediction_fan", to: "edge_drift" },
  { from: "prediction_fan", to: "reality_calib" },
  { from: "edge_drift", to: "loop_burndown" },
  { from: "loop_burndown", to: "baseline_delta" },
  // Everything material → Proposals
  { from: "hidden_insights", to: "proposal_funnel" },
  { from: "edge_drift", to: "proposal_funnel" },
  { from: "interv_dag", to: "proposal_funnel" },
  { from: "twin", to: "proposal_funnel" },
  { from: "reality_calib", to: "proposal_funnel" },
  // Feedback (dashed): proposals → substrate
  { from: "proposal_funnel", to: "kg_graph", kind: "feedback" },
];

// Module-level: count edges per card → importance tier (stable across renders)
const _CARD_EDGE_COUNT: Record<string, number> = {};
for (const _c of TEMPLATE_ARCH_CARDS) {
  _CARD_EDGE_COUNT[_c.id] = TEMPLATE_ARCH_EDGES.filter(
    (e) => e.from === _c.id || e.to === _c.id,
  ).length;
}
function getImportanceTier(id: string): "hero" | "key" | "peripheral" {
  const n = _CARD_EDGE_COUNT[id] ?? 0;
  if (n >= 5) return "hero";
  if (n >= 2) return "key";
  return "peripheral";
}

// Per-card per-objective content slots. Each card answers different questions
// in different objectives — these strings drive the "brief" mode body.
type ObjectiveKey = "orient" | "diagnose" | "plan" | "predict" | "calibrate" | "explore" | "decide";

const OBJECTIVE_LENSES: { key: ObjectiveKey; label: string; glyph: string; ask: string; color: string }[] = [
  { key: "orient", label: "Orient", glyph: "◎", ask: "where am I?", color: "#94A3B8" },
  { key: "diagnose", label: "Diagnose", glyph: "▴", ask: "what's broken?", color: "#F59E0B" },
  { key: "plan", label: "Plan", glyph: "▤", ask: "what to do?", color: "#7C3AED" },
  { key: "predict", label: "Predict", glyph: "◞", ask: "how will it evolve?", color: "#0EA5E9" },
  { key: "calibrate", label: "Calibrate", glyph: "◯", ask: "are predictions right?", color: "#10B981" },
  { key: "explore", label: "Explore", glyph: "↻", ask: "what's hidden?", color: "#EC4899" },
  { key: "decide", label: "Decide", glyph: "⊞", ask: "what to approve?", color: "#1E293B" },
];

// Per-objective content for each card. Each slot is a tuple [primaryMetric, secondaryDetail].
// If a card has no relevant content for an objective, the card dims in that lens.
const ARCH_CONTENT: Record<string, Partial<Record<ObjectiveKey, [string, string]>>> = {
  template_select: {
    orient: ["mind-body cognition", "1 of 3 templates"],
    plan: ["63n + 91e seeded", "+ 4 subjects + 6 IVs"],
    decide: ["template confirmed", "/app/explore"],
  },
  objective_intake: {
    orient: ["1 goal · 12mo horizon", "improvement_goals[0]"],
    plan: ["3 sub-objectives decomposed", "g1.s1 / g1.s2 / g1.s3"],
    decide: ["needs review", "g1.s2 deferred"],
    diagnose: ["scope unbounded?", "horizon ambiguous"],
  },
  seed_materialize: {
    orient: ["64ent · 23edges · 6IV", "+ 4 subj + 6 instr"],
    diagnose: ["all gates pass", "manual_authoring=true"],
    calibrate: ["seeded ≤2s", "171 rows in DB"],
  },
  edge_augmenter: {
    orient: ["D11 auto-wire", "isolates → connected"],
    diagnose: ["3 augmentations", "0 errors · best-effort"],
    calibrate: ["confidence 0.85", "non-fatal failures"],
  },
  ingestion_pipeline: {
    orient: ["11 stages", "URL/DOI/CSV → DB"],
    diagnose: ["0 stalled", "all gates pass"],
    calibrate: ["168 records · 74 papers", "trust gates 4/4"],
  },
  research_orchestration: {
    orient: ["3 LLM passes", "triangulation · adversarial"],
    explore: ["last run · 47 signals", "12 new entities · 6 edges"],
    calibrate: ["depth=standard", "M=2000 MC draws"],
    diagnose: ["1 pass timed out", "retry queued"],
  },
  synthesis_decomp: {
    orient: ["6-section synthesis", "side panels populated"],
    explore: ["6 leverage · 4 risks", "feedback loops + cycles"],
    diagnose: ["3 contradictions", "1 high-severity"],
    plan: ["+ 5 improvement_goals", "ranked by impact"],
  },
  strategy_twin: {
    orient: ["1 ranked strategy v4", "twin_proposal generated"],
    plan: ["chosen + 3 rejected", "alternatives_rejected[]"],
    decide: ["awaiting approval", "supersede chain v1→v4"],
    explore: ["mechanism_ids: 8", "infrastructure: 5 apps"],
  },
  intake_review: {
    orient: ["4-step wizard", "metrics → apps → tactics"],
    decide: ["3 deferred · 5 approved", "ready to materialize"],
    plan: ["8 trackers queued", "5 apps · 6 tactics"],
    diagnose: ["1 priority override", "2 target overrides"],
  },
  csv_drop: {
    orient: ["168 rows", "subj × wk × biom"],
    diagnose: ["1 schema mismatch", "2 unparsed dates"],
    calibrate: ["last load 2d ago", "REML auto-pooled"],
  },
  app_materializer: {
    orient: ["1 → 5 apps", "from twin_proposal v4"],
    plan: ["+ 24 trackers built", "metric_trackers persisted"],
    decide: ["awaiting confirm", "intake_review gate"],
    diagnose: ["complementary pairing", "schema only · gap"],
  },
  agent_fleet: {
    orient: ["8 mechanisms · approved", "Sprint 3 agent fleet"],
    plan: ["3 agents executing", "5 paused/queued"],
    diagnose: ["1 stale agent", "no envelope > 24h"],
    explore: ["agent write-back", "config.manifest patches"],
  },
  app_tether: {
    orient: ["2 pairs declared", "cog_game ↔ cog_measure"],
    diagnose: ["runtime population MISSING", "schema-only"],
    plan: ["bidirectional links pending", "F3 feature"],
  },
  metric_observations: {
    orient: ["42 obs · 8 metrics", "subject × week × value"],
    calibrate: ["last obs 6h ago", "wearable + self-report"],
    explore: ["3 outliers flagged", "z > 2.5"],
    predict: ["feeds resolver", "→ actual_trajectory"],
  },
  prediction_resolver: {
    orient: ["resolveTrajectoryPrediction", "path_aware_temporal_v1"],
    calibrate: ["MRE + temporal_delta", "expected/regime/surprise"],
    diagnose: ["3 regime · 1 surprise", "edges drifting"],
    predict: ["per-edge calibration emit", "edges.strength mutate"],
  },
  discovery_auto_propose: {
    orient: ["proposeFromConvergent...", "loop closure path"],
    decide: ["3 candidates ready", "manual trigger only"],
    diagnose: ["NOT auto-fired", "needs after() chain wiring"],
    explore: ["thresholds: conf 0.75", "prob 0.65 · align 0.60"],
  },
  app_outcomes: {
    orient: ["5 apps · live outcomes", "health · adherence · Δz"],
    plan: ["3 apps on target", "2 apps off-target → adjust"],
    diagnose: ["MBSR adherence 38%", "Anti-Inflam stale 21d"],
    calibrate: ["est Δz vs predicted", "delivers 0.18 of 0.31 expected"],
    explore: ["unintended ↑Sleep quality", "from Activity app"],
  },
  lab_scaffold: {
    orient: ["multi-app composition", "experiments table"],
    diagnose: ["assembly logic MISSING", "approval endpoint exists"],
    plan: ["compose A+B+C", "shared subjects · shared metrics"],
  },
  loop_recorder: {
    orient: ["loop_cycle_records", "phases + delta tracking"],
    diagnose: ["table exists · NO writers", "manual reconstruction only"],
    calibrate: ["coverage_before / coverage_after", "needs cycle-watcher agent"],
  },
  hypothesis_ladders: {
    orient: ["6 leverage points", "→ 6 falsifiable claims"],
    explore: ["3 supported · 1 refuted", "2 awaiting evidence"],
    diagnose: ["BDNF claim weakening", "k=3 · CI widening"],
    calibrate: ["evidence verdicts", "auto-update from edge_calibrations"],
  },
  argument_tribunal: {
    orient: ["3 contradictions surfaced", "from synthesis_data"],
    diagnose: ["1 high-severity", "Sleep ↔ Stress causation"],
    explore: ["assumption brittleness", "0.41 weakest"],
    decide: ["awaiting resolution", "research probe queued"],
  },
  cycle_break_planner: {
    orient: ["1 cycle detected", "OIC ↔ HPA · period 21d"],
    plan: ["break at N20 · cost 0.31", "downstream Δz +0.18"],
    explore: ["3 break-points compared", "ranked by cost/benefit"],
    diagnose: ["self-sustaining loop", "won't dissipate alone"],
  },
  intel_radar: {
    orient: ["6-axis system health", "convergence · contradict · etc"],
    diagnose: ["coverage 0.82 ↑", "freshness 0.61 ↓ stale"],
    calibrate: ["radar polygon · live", "computed from 4 signals"],
    explore: ["bridge_redundancy 0.34", "low · single-point risks"],
  },
  kg_overview: {
    orient: ["64 nodes · 23 edges", "L0–L6 · 7 layers"],
    diagnose: ["1 orphan · 2 sparse", "3 stale > 60d"],
    explore: ["4 cycles · 7 bridges", "Tarjan SCC"],
  },
  kg_graph: {
    orient: ["full DAG", "degree-sorted"],
    diagnose: ["k=2 edges flagged", "low-coverage paths"],
    plan: ["73% paths via N30", "intervene here"],
    predict: ["fwd-pass IVW ready", "from L1 inputs"],
    explore: ["2 hubs · 1 articulation", "N30 + N20"],
  },
  multi_lenses: {
    orient: ["4 layouts", "lay·sph·force·matrix"],
    explore: ["sphere reveals N30 hub", "matrix shows L2→L3 dense"],
  },
  subjects: {
    orient: ["4 patient profiles", "z range −0.84 to +0.05"],
    plan: ["Resident: try CBT-I", "Post-chemo: aerobic"],
    predict: ["per-subject trajectory", "ready to fork"],
  },
  vuln_matrix: {
    orient: ["7 cancers × 8 paths", "0–1 risk"],
    diagnose: ["HEM × OIC = 0.94", "highest cell"],
    plan: ["BCA: target N20", "LNG: target sleep"],
  },
  ref_domains: {
    orient: ["6 cog domains", "z-norms vs controls"],
    diagnose: ["ProcSpd −0.82z", "CI excludes 0"],
    calibrate: ["95% CI on each", "n=38–78 obs"],
  },
  master_bottleneck: {
    orient: ["N30 · L3 pathway", "in=8 out=5"],
    diagnose: ["bottleneck identified", "betweenness 0.54"],
    plan: ["50% suppression →", "+0.18z PS"],
    predict: ["28d onset · 90d plat", "biphasic decay"],
    explore: ["center of cycle", "N20→N30→N32→N24"],
  },
  temporal_atlas: {
    orient: ["5 edge timing pools", "REML + I²"],
    diagnose: ["I² > 60% on 2 edges", "high heterogeneity"],
    predict: ["onset/peak/persist", "p10/p50/p90 ready"],
    calibrate: ["last pooled 4d ago", "auto-rerun on intake"],
  },
  decay_kinetics: {
    orient: ["4 shapes", "lin · exp · sus · bi"],
    explore: ["biphasic on BDNF", "rare · investigate"],
  },
  recovery_curves: {
    orient: ["10 cancer types", "Weibull r∞,τ,γ"],
    predict: ["r∞ 0.50–0.80", "37mo horizon"],
    plan: ["Breast: 0.75 ceiling", "CNS: 0.50 ceiling"],
  },
  apps_portfolio: {
    orient: ["5 apps tracked", "2 seeded by template"],
    diagnose: ["2 stale flags", "MBSR · Anti-Inflam"],
    plan: ["Anti-Inflam high pri", "0.91 priority"],
    decide: ["1 app awaiting refresh", "MBSR · 21d idle"],
  },
  interv_dag: {
    orient: ["6 interventions", "effort × impact"],
    plan: ["quick wins:", "CogTrain (0.32, 0.51)"],
    decide: ["3 dependencies open", "Aerobic blocks 2"],
  },
  dose_response: {
    orient: ["6 Hill curves", "EC50 + Emax + h"],
    plan: ["Aerobic EC50=90 min/wk", "below = under-dosed"],
    predict: ["k=24 studies pooled", "I²=58% on Aerobic"],
  },
  hidden_insights: {
    explore: ["4 surfaced findings", "cycle · bridge · disc · tmp"],
    diagnose: ["chain–direct gap Z=2.1", "missing mediator"],
    plan: ["break cycle at N20", "Activity intervention"],
  },
  variance_decomp: {
    diagnose: ["Edge SE = 38%", "biggest reducible"],
    calibrate: ["τ² = 18%", "irreducible heterogeneity"],
  },
  calib_cascade: {
    orient: ["7-layer SE pipeline", "raw → eff"],
    calibrate: ["SE_raw 0.32 → 0.21", "34% reduction"],
    diagnose: ["measurement layer +5%", "only inflator"],
  },
  forest_plot: {
    orient: ["6 dom + composite", "credible intervals"],
    predict: ["+intervention shift", "−0.51 → −0.20 comp"],
    diagnose: ["3 domains CI ⊃ 0", "weak evidence"],
  },
  trajectory: {
    predict: ["37mo · BCA Weibull", "+IV trapezoid"],
    plan: ["fork by cancer type", "10 selectable"],
    calibrate: ["±8% PI band", "actuals overlay"],
  },
  twin: {
    predict: ["Bayesian fwd-pass", "23 edges · IVW"],
    plan: ["3 sliders → forecast", "Activity / Sleep / Chemo"],
    diagnose: ["±SE per output", "δ-method"],
  },
  prediction_fan: {
    predict: ["MC M=2000 weekly", "p10/50/90 fan"],
    calibrate: ["resolved through w8", "deviation: expected"],
  },
  action_plan: {
    plan: ["4 phases", "today→re-evaluate"],
    decide: ["10 actions queued", "ASCO 2024 mapped"],
  },
  calib_scatter: {
    calibrate: ["14 resolved", "r = 0.74"],
    diagnose: ["3 regime shifts", "1 surprise"],
  },
  edge_drift: {
    calibrate: ["8 edges × 6 events", "drift heatmap"],
    diagnose: ["OIC→PS drifting up", "5 events monotone"],
  },
  reality_calib: {
    calibrate: ["4 baselines · 8 attempts", "aggregate 0.56"],
    diagnose: ["1 blocked baseline", "APOE × age"],
  },
  loop_burndown: {
    orient: ["6 cycles run", "coverage 0.42→0.82"],
    calibrate: ["diminishing returns", "c4–c6 trend"],
  },
  baseline_delta: {
    orient: ["T0 → now KG diff", "edges 8→23"],
    calibrate: ["coverage +0.51", "since strategy v1"],
  },
  proposal_funnel: {
    decide: ["25 pending · 6 streams", "rank-sorted"],
    plan: ["approve top 3", "+ defer all rest"],
    diagnose: ["3 streams clogged", "router · variable · rigor"],
  },
};

// Full-content mini-renderer per card. Returns inline visualization that
// fits a 320×196 slot. Goal: show the actual data shape, not just metrics.
function FullCardContent({ cardId, lensColor, layerColor }: { cardId: string; lensColor: string; layerColor: string }) {
  switch (cardId) {
    case "template_select":
      return (
        <div className="space-y-1.5">
          {[
            { name: "Mind-Body Cognition", n: "63 ent · 91 edges", c: "#7C3AED", chosen: true },
            { name: "Sleep Optimization", n: "22 ent · 26 edges", c: "#0EA5E9", chosen: false },
            { name: "Cancer-Related Fatigue", n: "38 ent · 47 edges", c: "#F59E0B", chosen: false },
          ].map((t) => (
            <div key={t.name} className={`flex items-center gap-2 rounded-md border p-1.5 ${t.chosen ? "bg-violet-50/40" : "bg-white"}`} style={{ borderColor: t.chosen ? t.c : "#E2E8F0", borderLeftWidth: t.chosen ? 3 : 1, borderLeftColor: t.c }}>
              <span className="font-mono text-[12px]" style={{ color: t.c }}>{t.chosen ? "●" : "○"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[9px] font-semibold text-slate-800">{t.name}</div>
                <div className="font-mono text-[7px] tabular-nums text-slate-500">{t.n}</div>
              </div>
              {t.chosen && <span className="rounded-full bg-violet-100 px-1.5 py-0 text-[7px] font-semibold uppercase tracking-wider text-violet-700">chosen</span>}
            </div>
          ))}
        </div>
      );
    case "objective_intake":
      return (
        <div>
          <div className="rounded-md bg-slate-50/60 p-2">
            <div className="text-[7px] font-semibold uppercase tracking-wider text-slate-500">primary goal</div>
            <div className="mt-1 text-[10px] font-semibold leading-snug text-slate-800">Reduce CRCI burden by 0.30z within 12mo</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[7px] tabular-nums text-slate-500">
              <span className="rounded bg-white px-1.5 py-0 ring-1 ring-slate-200">horizon 12mo</span>
              <span className="rounded bg-white px-1.5 py-0 ring-1 ring-slate-200">scope: clinical</span>
            </div>
          </div>
          <div className="mt-2 space-y-0.5">
            {["g1.s1 Suppress neuroinflammation", "g1.s2 Restore HPA rhythm", "g1.s3 Promote neuroplasticity"].map((s, i) => (
              <div key={i} className="flex items-baseline gap-1.5 text-[8px]">
                <span className="font-mono text-[7px] text-slate-400">→</span>
                <span className="flex-1 truncate text-slate-600">{s}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "seed_materialize":
      return (
        <div>
          <div className="grid grid-cols-3 gap-1">
            {[
              { l: "Entities", v: 64 }, { l: "Edges", v: 23 }, { l: "Layers", v: 7 },
              { l: "Subjects", v: 4 }, { l: "Interventions", v: 6 }, { l: "Instruments", v: 6 },
            ].map((s) => (
              <div key={s.l} className="rounded bg-slate-50/70 p-1.5 text-center">
                <div className="font-mono text-[12px] font-semibold tabular-nums text-slate-700">{s.v}</div>
                <div className="text-[6px] uppercase tracking-wider text-slate-400">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[8px] tabular-nums text-emerald-600">
            <span className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-50 text-[7px] ring-1 ring-emerald-200">✓</span>
            <span>171 rows · {"<"}2s materialize · authoring=true</span>
          </div>
        </div>
      );
    case "edge_augmenter":
      return (
        <div className="space-y-1.5">
          <div className="rounded bg-slate-50/60 p-1.5">
            <div className="text-[7px] font-semibold uppercase tracking-wider text-slate-500">D11 · auto-wire</div>
            <div className="mt-1 font-mono text-[10px] tabular-nums text-slate-700">isolated → connected</div>
            <div className="mt-0.5 text-[7px] tabular-nums text-slate-500">runs after seed_materialize · best-effort</div>
          </div>
          <div className="space-y-0.5">
            {[
              { l: "Aerobic → IL-6 · CRP · TNF-α", c: "#10B981" },
              { l: "CBT-I → Cortisol", c: "#10B981" },
              { l: "MBSR → Cortisol · Anxiety", c: "#10B981" },
            ].map((e, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[7px]">
                <span className="h-1 w-1 rounded-full" style={{ background: e.c }} />
                <span className="flex-1 truncate font-mono text-slate-600">{e.l}</span>
                <span className="font-mono text-slate-400">+1</span>
              </div>
            ))}
          </div>
          <div className="font-mono text-[7px] tabular-nums text-slate-400">3 augmentations · 0 errors</div>
        </div>
      );
    case "ingestion_pipeline":
      return (
        <div className="space-y-0.5 overflow-hidden">
          {["URL/DOI/CSV", "Metadata", "Full text", "Edge ID", "Effect-size", "Moderator", "GRADE", "Trust gates", "SE cascade", "REML pool", "DB load"].map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px] tabular-nums">
              <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[7px] text-emerald-700 ring-1 ring-emerald-200">✓</span>
              <span className="font-mono text-[7px] text-slate-400">{String(i + 1).padStart(2, "0")}</span>
              <span className="truncate text-[9px] text-slate-700">{s}</span>
            </div>
          ))}
        </div>
      );
    case "research_orchestration":
      return (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[7px] tabular-nums">
            <span className="font-semibold uppercase tracking-wider text-slate-500">LLM passes</span>
            <span className="text-slate-400">depth=standard</span>
          </div>
          <div className="space-y-1">
            {[
              { l: "Triangulation pass", n: 18, c: "#7C3AED", state: "complete" },
              { l: "Adversarial pass", n: 12, c: "#EC4899", state: "complete" },
              { l: "Convergence detect", n: 5, c: "#F59E0B", state: "active" },
            ].map((p) => (
              <div key={p.l} className="rounded border border-slate-200/60 bg-white p-1.5">
                <div className="flex items-baseline justify-between text-[8px]">
                  <span className="font-medium text-slate-700">{p.l}</span>
                  <span className="font-mono tabular-nums" style={{ color: p.c }}>{p.n} signals</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[7px] tabular-nums">
                  <span className={`h-1 w-1 rounded-full ${p.state === "complete" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
                  <span className="text-slate-400">{p.state}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 font-mono text-[7px] tabular-nums text-slate-400">+ 12 entities · + 6 edges materialized</div>
        </div>
      );
    case "synthesis_decomp":
      return (
        <div className="space-y-1">
          {[
            { l: "Leverage points", n: 6, c: "#7C3AED" },
            { l: "Risk points", n: 4, c: "#EF4444" },
            { l: "Master bottleneck", n: 1, c: "#F59E0B" },
            { l: "Feedback loops", n: 2, c: "#EC4899" },
            { l: "Contradictions", n: 3, c: "#0EA5E9" },
            { l: "Improvement goals", n: 5, c: "#10B981" },
          ].map((s) => (
            <div key={s.l} className="flex items-center gap-2 rounded bg-slate-50/40 px-1.5 py-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.c }} />
              <span className="flex-1 truncate text-[8px] text-slate-700">{s.l}</span>
              <span className="font-mono text-[9px] font-semibold tabular-nums text-slate-700">{s.n}</span>
            </div>
          ))}
        </div>
      );
    case "strategy_twin":
      return (
        <div>
          <div className="rounded-md bg-amber-50/40 p-1.5">
            <div className="flex items-center justify-between text-[7px] tabular-nums">
              <span className="font-semibold uppercase tracking-wider text-amber-700">chosen approach v4</span>
              <span className="rounded-full bg-amber-100 px-1 py-0 font-mono text-[6px] uppercase text-amber-700">supersede</span>
            </div>
            <div className="mt-1 truncate text-[8px] font-medium leading-snug text-slate-800">Anti-inflammatory + sleep restoration layered</div>
            <div className="mt-0.5 font-mono text-[7px] tabular-nums text-amber-600">conf 0.79 · 8 mechanism_ids</div>
          </div>
          <div className="mt-1.5 space-y-0.5">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">alternatives rejected (3)</div>
            {[
              "v3 cog-training-only · low impact",
              "v2 mono-intervention · brittle",
              "v1 generic protocol · no targets",
            ].map((a, i) => (
              <div key={i} className="truncate text-[7px] tabular-nums text-slate-400 line-through">↶ {a}</div>
            ))}
          </div>
        </div>
      );
    case "intake_review":
      return (
        <div>
          <div className="grid grid-cols-4 gap-0.5">
            {[
              { l: "Metrics", n: 8, done: true },
              { l: "Apps", n: 5, done: true },
              { l: "Tactics", n: 6, done: false, active: true },
              { l: "Confirm", n: null, done: false },
            ].map((s, i) => (
              <div key={s.l} className={`rounded p-1 text-center ${s.done ? "bg-emerald-50" : s.active ? "bg-amber-50" : "bg-slate-50/50"}`}>
                <div className="font-mono text-[7px] uppercase tracking-wider" style={{ color: s.done ? "#10B981" : s.active ? "#F59E0B" : "#94A3B8" }}>{i + 1}</div>
                <div className="text-[8px] font-semibold text-slate-700">{s.l}</div>
                {s.n !== null && <div className="font-mono text-[7px] tabular-nums text-slate-500">{s.n}</div>}
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-0.5">
            <div className="flex items-center justify-between text-[8px] tabular-nums">
              <span className="text-slate-600">approved</span>
              <span className="font-mono text-emerald-600">5</span>
            </div>
            <div className="flex items-center justify-between text-[8px] tabular-nums">
              <span className="text-slate-600">deferred</span>
              <span className="font-mono text-amber-600">3</span>
            </div>
            <div className="flex items-center justify-between text-[8px] tabular-nums">
              <span className="text-slate-600">priority overrides</span>
              <span className="font-mono text-violet-600">1</span>
            </div>
          </div>
        </div>
      );
    case "csv_drop":
      return (
        <div>
          <div className="rounded border border-dashed border-violet-200 bg-violet-50/30 p-2 text-center text-[9px] text-violet-600">
            ↧ drop CSV / parquet
          </div>
          <table className="mt-2 w-full text-[8px] tabular-nums">
            <thead className="text-slate-400"><tr><th className="text-left">subj</th><th className="text-right">w</th><th className="text-right">IL-6</th><th className="text-right">PS z</th></tr></thead>
            <tbody className="text-slate-700">
              <tr><td className="font-mono">S001</td><td className="text-right">0</td><td className="text-right">1.23</td><td className="text-right">−0.78</td></tr>
              <tr><td className="font-mono">S001</td><td className="text-right">4</td><td className="text-right">0.84</td><td className="text-right">−0.62</td></tr>
              <tr><td className="font-mono">S001</td><td className="text-right">8</td><td className="text-right">0.42</td><td className="text-right">−0.41</td></tr>
              <tr><td colSpan={4} className="text-slate-400">… 165 more rows</td></tr>
            </tbody>
          </table>
        </div>
      );
    case "kg_overview":
      return (
        <div>
          <div className="grid grid-cols-7 gap-0.5">
            {LAYER_COUNTS.map((c, i) => (
              <div key={i} className="rounded bg-slate-50/80 p-1 text-center">
                <div className="font-mono text-[10px] font-semibold tabular-nums text-slate-700">{c}</div>
                <div className="text-[6px] uppercase tracking-wider text-slate-400">L{i}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-0.5">
            {HUB_RANK.slice(0, 4).map((n) => (
              <div key={n.id} className="flex items-baseline gap-1.5 text-[9px]">
                <span className="font-mono text-[8px] text-slate-400">{n.id}</span>
                <span className="flex-1 truncate text-slate-700">{n.label}</span>
                <span className="font-mono text-[8px] tabular-nums text-slate-500">k={nodeDegree(n.id)}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "kg_graph":
      return <MiniLayered W={296} H={140} />;
    case "multi_lenses":
      return (
        <div className="grid h-full grid-cols-2 grid-rows-2 gap-1">
          <div className="rounded border border-slate-100 bg-white p-0.5"><MiniLayered W={140} H={62} /></div>
          <div className="rounded border border-slate-100 bg-white p-0.5"><MiniSphere W={140} H={62} /></div>
          <div className="rounded border border-slate-100 bg-white p-0.5"><MiniForce W={140} H={62} /></div>
          <div className="rounded border border-slate-100 bg-white p-0.5"><MiniMatrix W={140} H={62} /></div>
        </div>
      );
    case "subjects":
      return (
        <div className="space-y-1">
          {SUBJECTS.map((s) => (
            <div key={s.name} className="flex items-baseline gap-2 rounded bg-slate-50/60 px-2 py-1 text-[9px]">
              <span className="flex-1 truncate font-medium text-slate-700">{s.name}</span>
              <span className={`rounded-full px-1 py-0 text-[7px] font-semibold ring-1 ${s.badgeTone === "teal" ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>{s.badge}</span>
            </div>
          ))}
        </div>
      );
    case "vuln_matrix": {
      const cancers = Object.keys(VULN_MATRIX).slice(0, 6);
      return (
        <div className="overflow-hidden">
          <table className="w-full text-[7px] tabular-nums">
            <thead><tr><th /> {cancers.map((c) => <th key={c} className="px-0.5 text-center font-medium text-slate-400">{c}</th>)}</tr></thead>
            <tbody>
              {PATHWAYS.slice(0, 6).map((p, pi) => (
                <tr key={p}>
                  <td className="pr-1 text-right text-[7px] text-slate-600">{p.slice(0, 12)}</td>
                  {cancers.map((c) => {
                    const v = (VULN_MATRIX[c] ?? [])[pi] ?? 0;
                    return <td key={c} className="p-0.5"><div className="h-3 w-full rounded-sm" style={{ background: `rgba(245,158,11,${Math.max(0.06, v * 0.85)})` }} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "ref_domains":
      return (
        <div className="space-y-1.5">
          {REF_DOMAINS.slice(0, 5).map((d) => {
            const min = -1.5, max = 0.5;
            const pct = (v: number) => ((v - min) / (max - min)) * 100;
            return (
              <div key={d.name}>
                <div className="flex items-baseline justify-between text-[8px]">
                  <span className="truncate text-slate-700">{d.name}</span>
                  <span className="font-mono tabular-nums text-slate-800">{d.z.toFixed(2)}z</span>
                </div>
                <div className="relative mt-0.5 h-1 rounded-full bg-slate-100">
                  <div className="absolute top-0 bottom-0 w-px bg-slate-400" style={{ left: `${pct(0)}%` }} />
                  <div className="absolute inset-y-0 rounded-full bg-slate-300" style={{ left: `${pct(d.ci[0])}%`, width: `${pct(d.ci[1]) - pct(d.ci[0])}%` }} />
                  <div className="absolute -top-0.5 h-2 w-2 rounded-full bg-slate-900" style={{ left: `calc(${pct(d.z)}% - 4px)` }} />
                </div>
              </div>
            );
          })}
        </div>
      );
    case "master_bottleneck":
      return (
        <div>
          <div className="rounded-md bg-amber-50/60 p-2">
            <div className="text-[8px] font-semibold uppercase tracking-wider text-amber-700">Counterfactual</div>
            <div className="mt-0.5 font-mono text-[16px] font-bold tabular-nums text-amber-900">+0.18</div>
            <div className="text-[8px] tabular-nums text-amber-600">Δz Processing Speed if N30 ↓50%</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded bg-slate-50 p-1.5 text-center">
              <div className="text-[7px] uppercase tracking-wider text-slate-400">in-edges</div>
              <div className="font-mono text-[12px] font-semibold tabular-nums text-slate-700">{nodeInDeg("N30")}</div>
            </div>
            <div className="rounded bg-slate-50 p-1.5 text-center">
              <div className="text-[7px] uppercase tracking-wider text-slate-400">out-edges</div>
              <div className="font-mono text-[12px] font-semibold tabular-nums text-slate-700">{nodeOutDeg("N30")}</div>
            </div>
          </div>
        </div>
      );
    case "temporal_atlas": {
      const xMax = 365;
      const xs = (d: number) => 50 + (Math.log10(Math.max(1, d)) / Math.log10(xMax)) * 240;
      return (
        <svg viewBox="0 0 296 140" className="h-full w-full">
          {TEMPORAL_EDGES.slice(0, 4).map((e, i) => (
            <g key={e.id} transform={`translate(0 ${i * 32 + 8})`}>
              <text x={4} y={10} fontSize="7" fill="#475569">{e.label.slice(0, 18)}</text>
              <line x1={xs(e.onset[0])} y1={18} x2={xs(e.onset[2])} y2={18} stroke="#06B6D4" strokeWidth="1.6" opacity="0.7" />
              <circle cx={xs(e.onset[1])} cy={18} r="2" fill="#06B6D4" />
              <line x1={xs(e.peak[0])} y1={22} x2={xs(e.peak[2])} y2={22} stroke="#7C3AED" strokeWidth="1.6" opacity="0.7" />
              <circle cx={xs(e.peak[1])} cy={22} r="2" fill="#7C3AED" />
              <line x1={xs(e.persist[0])} y1={26} x2={xs(e.persist[2])} y2={26} stroke="#F59E0B" strokeWidth="1.6" opacity="0.7" />
              <circle cx={xs(e.persist[1])} cy={26} r="2" fill="#F59E0B" />
            </g>
          ))}
          <text x={50} y={138} fontSize="6" fill="#94A3B8">1d</text>
          <text x={170} y={138} fontSize="6" fill="#94A3B8">90d</text>
          <text x={278} y={138} fontSize="6" fill="#94A3B8" textAnchor="end">1yr</text>
        </svg>
      );
    }
    case "decay_kinetics":
      return (
        <div className="space-y-1.5">
          {[
            { l: "Linear", n: 6, c: "#06B6D4", path: "M 4 18 L 60 4" },
            { l: "Exponential", n: 9, c: "#7C3AED", path: "M 4 4 Q 18 14 60 18" },
            { l: "Sustained", n: 5, c: "#F59E0B", path: "M 4 4 L 18 4 L 18 6 L 60 6" },
            { l: "Biphasic", n: 3, c: "#EC4899", path: "M 4 18 L 18 4 L 32 14 L 46 6 L 60 12" },
          ].map((k) => (
            <div key={k.l} className="flex items-center gap-2">
              <svg viewBox="0 0 64 22" className="h-5 w-12 shrink-0"><path d={k.path} fill="none" stroke={k.c} strokeWidth="1.4" /></svg>
              <span className="flex-1 text-[9px] text-slate-700">{k.l}</span>
              <span className="font-mono text-[8px] tabular-nums text-slate-500">{k.n}</span>
            </div>
          ))}
        </div>
      );
    case "recovery_curves": {
      const W = 296, H = 140, padL = 24, padR = 4, padT = 6, padB = 18;
      const xs = (m: number) => padL + (m / 36) * (W - padL - padR);
      const ys = (z: number) => padT + (1 - z) * (H - padT - padB);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          {[0, 0.5, 1].map((g) => <line key={g} x1={padL} y1={ys(g)} x2={W - padR} y2={ys(g)} stroke="#F1F5F9" strokeWidth="0.5" />)}
          {(Object.keys(REC) as CancerType[]).slice(0, 6).map((k) => {
            const r = REC[k];
            const path = Array.from({ length: 37 }, (_, m) => `${m === 0 ? "M" : "L"} ${xs(m).toFixed(1)} ${ys(r.rInf * (1 - Math.exp(-Math.pow(m / r.tau, r.gam)))).toFixed(1)}`).join(" ");
            return <path key={k} d={path} fill="none" stroke={r.color} strokeWidth="1.2" />;
          })}
          <text x={padL - 2} y={ys(1) + 3} fontSize="6" textAnchor="end" fill="#94A3B8">1.0</text>
          <text x={padL - 2} y={ys(0) + 3} fontSize="6" textAnchor="end" fill="#94A3B8">0.0</text>
          <text x={padL} y={H - 4} fontSize="6" fill="#94A3B8">0mo</text>
          <text x={W - padR} y={H - 4} fontSize="6" textAnchor="end" fill="#94A3B8">36mo</text>
        </svg>
      );
    }
    case "apps_portfolio": {
      const W = 296, H = 140, padL = 18, padR = 8, padT = 8, padB = 18;
      const xs = (v: number) => padL + v * (W - padL - padR);
      const ys = (v: number) => padT + (1 - v) * (H - padT - padB);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <line x1={xs(0.5)} y1={padT} x2={xs(0.5)} y2={H - padB} stroke="#F1F5F9" strokeDasharray="2 2" />
          <line x1={padL} y1={ys(0.5)} x2={W - padR} y2={ys(0.5)} stroke="#F1F5F9" strokeDasharray="2 2" />
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
          {APPS_DATA.map((a) => {
            const r = 4 + (a.entities / 18) * 8;
            return (
              <g key={a.id}>
                <circle cx={xs(a.complexity)} cy={ys(a.priority)} r={r + 2} fill="none" stroke={a.color} strokeWidth="0.8" strokeOpacity="0.45" />
                <circle cx={xs(a.complexity)} cy={ys(a.priority)} r={r} fill={a.color} fillOpacity="0.78" stroke="white" strokeWidth="0.8" />
                {a.stale && <circle cx={xs(a.complexity) + r - 1} cy={ys(a.priority) - r + 1} r="1.6" fill="#F59E0B" stroke="white" strokeWidth="0.5" />}
              </g>
            );
          })}
          <text x={4} y={padT + 4} fontSize="6" fill="#64748B">↑ pri</text>
          <text x={W / 2} y={H - 4} fontSize="6" textAnchor="middle" fill="#64748B">complexity →</text>
        </svg>
      );
    }
    case "interv_dag": {
      const W = 296, H = 140, padL = 14, padR = 4, padT = 10, padB = 14;
      const xs = (v: number) => padL + v * (W - padL - padR);
      const ys = (v: number) => padT + (1 - v) * (H - padT - padB);
      const positions: Record<string, { x: number; y: number }> = {};
      INTERVENTIONS_DAG.forEach((iv) => { positions[iv.id] = { x: xs(iv.effort), y: ys(iv.impact) }; });
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <line x1={xs(0.5)} y1={padT} x2={xs(0.5)} y2={H - padB} stroke="#F1F5F9" strokeDasharray="2 2" />
          <line x1={padL} y1={ys(0.5)} x2={W - padR} y2={ys(0.5)} stroke="#F1F5F9" strokeDasharray="2 2" />
          {INTERVENTIONS_DAG.map((iv) =>
            iv.deps.map((d) => positions[d] && <line key={`${d}-${iv.id}`} x1={positions[d].x} y1={positions[d].y} x2={positions[iv.id].x} y2={positions[iv.id].y} stroke="#CBD5E1" strokeWidth="0.6" />)
          )}
          {INTERVENTIONS_DAG.map((iv) => (
            <g key={iv.id}>
              <circle cx={positions[iv.id].x} cy={positions[iv.id].y} r="4" fill={iv.color} stroke="white" strokeWidth="0.8" />
              <text x={positions[iv.id].x} y={positions[iv.id].y - 6} fontSize="6" textAnchor="middle" fill="#475569" fontWeight="600">{iv.name.split(" ")[0]}</text>
            </g>
          ))}
        </svg>
      );
    }
    case "dose_response":
      return (
        <div className="grid grid-cols-3 gap-1">
          {IVS.slice(0, 6).map((iv) => {
            const W = 90, H = 50;
            const xMax = iv.dr.plat;
            const xs = (x: number) => 4 + (x / xMax) * (W - 8);
            const ys = (y: number) => 4 + (1 - y / iv.dr.emax) * (H - 8);
            const path = Array.from({ length: 30 }, (_, i) => {
              const x = (i / 29) * xMax;
              const y = (iv.dr.emax * Math.pow(x, iv.dr.hill)) / (Math.pow(iv.dr.ec50, iv.dr.hill) + Math.pow(x, iv.dr.hill));
              return `${i === 0 ? "M" : "L"} ${xs(x).toFixed(1)} ${ys(y).toFixed(1)}`;
            }).join(" ");
            return (
              <div key={iv.id} className="rounded border border-slate-100 bg-white p-1">
                <div className="truncate text-[7px] font-medium text-slate-700">{iv.name.split(" ")[0]}</div>
                <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full">
                  <path d={path} fill="none" stroke={iv.color} strokeWidth="1.4" />
                </svg>
              </div>
            );
          })}
        </div>
      );
    case "hidden_insights":
      return (
        <div className="space-y-1.5">
          {[
            { glyph: "↻", title: "OIC cycle", detail: "N20→N30→N32→N24→N20", c: "#7C3AED" },
            { glyph: "◇", title: "N30 bridge", detail: "73% paths · betweenness 0.54", c: "#F59E0B" },
            { glyph: "≠", title: "Chain–direct gap", detail: "β_chain −0.18 vs −0.34 (Z=2.1)", c: "#EF4444" },
            { glyph: "Δt", title: "Onset mismatch", detail: "predicted 14d · observed 28d", c: "#06B6D4" },
          ].map((i) => (
            <div key={i.title} className="rounded bg-slate-50/60 px-2 py-1">
              <div className="flex items-baseline gap-1.5 text-[9px]">
                <span className="font-mono" style={{ color: i.c }}>{i.glyph}</span>
                <span className="font-semibold text-slate-800">{i.title}</span>
              </div>
              <div className="mt-0.5 font-mono text-[7px] tabular-nums text-slate-500">{i.detail}</div>
            </div>
          ))}
        </div>
      );
    case "variance_decomp": {
      const sources = [
        { l: "Edge SE", p: 38, c: "#7C3AED" }, { l: "Proxy", p: 23, c: "#0EA5E9" },
        { l: "τ²", p: 18, c: "#F59E0B" }, { l: "Latent", p: 15, c: "#10B981" }, { l: "Adherence", p: 6, c: "#94A3B8" },
      ];
      return (
        <div>
          <div className="flex h-3 overflow-hidden rounded-full">
            {sources.map((s) => <div key={s.l} className="h-full" style={{ width: `${s.p}%`, background: s.c }} />)}
          </div>
          <div className="mt-2 space-y-0.5">
            {sources.map((s) => (
              <div key={s.l} className="flex items-center gap-1.5 text-[9px]">
                <span className="h-1.5 w-1.5 rounded-sm" style={{ background: s.c }} />
                <span className="flex-1 truncate text-slate-700">{s.l}</span>
                <span className="font-mono tabular-nums text-slate-500">{s.p}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "calib_cascade": {
      const layers = [
        { l: "SE_raw", v: 0.32, c: "#94A3B8" }, { l: "Study", v: 0.272, c: "#06B6D4" }, { l: "Pop", v: 0.250, c: "#06B6D4" },
        { l: "τ²", v: 0.270, c: "#F59E0B" }, { l: "Meas", v: 0.284, c: "#06B6D4" }, { l: "GRADE", v: 0.270, c: "#10B981" },
        { l: "Temp", v: 0.254, c: "#7C3AED" }, { l: "Fresh", v: 0.249, c: "#7C3AED" }, { l: "SE_eff", v: 0.21, c: "#1E293B" },
      ];
      const max = 0.34;
      return (
        <div className="space-y-0.5">
          {layers.map((s, i) => (
            <div key={s.l} className="flex items-center gap-1.5 text-[8px]">
              <span className={`w-12 truncate ${i === 0 || i === layers.length - 1 ? "font-semibold text-slate-800" : "text-slate-600"}`}>{s.l}</span>
              <div className="relative h-2 flex-1 rounded-sm bg-slate-50">
                <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(s.v / max) * 100}%`, background: s.c, opacity: i === layers.length - 1 ? 1 : 0.7 }} />
              </div>
              <span className="w-9 text-right font-mono tabular-nums text-slate-700">{s.v.toFixed(3)}</span>
            </div>
          ))}
        </div>
      );
    }
    case "forest_plot": {
      const W = 296, H = 140, padL = 80, padR = 6, padT = 4, padB = 14;
      const min = -1.5, max = 0.6;
      const xs = (v: number) => padL + ((v - min) / (max - min)) * (W - padL - padR);
      const rows = [
        { name: "ProcSpeed", base: -0.82, baseCi: [-1.24, -0.40], post: -0.42, postCi: [-0.78, -0.06] },
        { name: "Sust Attn", base: -0.61, baseCi: [-1.18, -0.04], post: -0.28, postCi: [-0.71, 0.15] },
        { name: "Episodic", base: -0.58, baseCi: [-1.08, -0.08], post: -0.31, postCi: [-0.72, 0.10] },
        { name: "Working", base: -0.49, baseCi: [-1.05, 0.07], post: -0.19, postCi: [-0.65, 0.27] },
        { name: "Exec Plan", base: -0.35, baseCi: [-0.98, 0.28], post: -0.11, postCi: [-0.62, 0.40] },
        { name: "CRCI ◆", base: -0.51, baseCi: [-0.92, -0.10], post: -0.20, postCi: [-0.55, 0.15], emph: true },
      ];
      const rowH = (H - padT - padB) / rows.length;
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <line x1={xs(0)} y1={padT} x2={xs(0)} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" strokeDasharray="2 2" />
          {rows.map((r, i) => {
            const y = padT + i * rowH + rowH / 2;
            return (
              <g key={r.name}>
                <text x={padL - 4} y={y + 2} fontSize="7" textAnchor="end" fill={r.emph ? "#0F172A" : "#475569"} fontWeight={r.emph ? 600 : 400}>{r.name}</text>
                <line x1={xs(r.baseCi[0])} y1={y - 2} x2={xs(r.baseCi[1])} y2={y - 2} stroke="#94A3B8" strokeWidth="1" opacity="0.6" />
                <circle cx={xs(r.base)} cy={y - 2} r={r.emph ? 2.4 : 1.6} fill="#475569" />
                <line x1={xs(r.postCi[0])} y1={y + 2} x2={xs(r.postCi[1])} y2={y + 2} stroke="#7C3AED" strokeWidth="1" opacity="0.7" />
                <circle cx={xs(r.post)} cy={y + 2} r={r.emph ? 2.4 : 1.6} fill="#7C3AED" />
              </g>
            );
          })}
          {[-1.5, -1, -0.5, 0, 0.5].map((g) => <text key={g} x={xs(g)} y={H - 4} fontSize="6" textAnchor="middle" fill="#94A3B8">{g.toFixed(1)}</text>)}
        </svg>
      );
    }
    case "trajectory": {
      const W = 296, H = 140, padL = 18, padR = 4, padT = 8, padB = 16;
      const xs = (m: number) => padL + (m / 36) * (W - padL - padR);
      const ys = (z: number) => padT + (1 - z) * (H - padT - padB);
      const r = REC.BCA;
      const recovery = (m: number) => r.rInf * (1 - Math.exp(-Math.pow(m / r.tau, r.gam)));
      const recPath = Array.from({ length: 37 }, (_, m) => `${m === 0 ? "M" : "L"} ${xs(m).toFixed(1)} ${ys(recovery(m)).toFixed(1)}`).join(" ");
      const ivPath = Array.from({ length: 37 }, (_, m) => {
        const t = m - 4;
        const peak = 0.25;
        const iv = t < 0 ? 0 : t < 8 ? (t / 8) * peak : t < 26 ? peak : t < 34 ? peak * (1 - (t - 26) / 8) : 0;
        return `${m === 0 ? "M" : "L"} ${xs(m).toFixed(1)} ${ys(Math.min(1, recovery(m) + iv)).toFixed(1)}`;
      }).join(" ");
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <path d={recPath} fill="none" stroke="#94A3B8" strokeWidth="1.2" strokeDasharray="3 2" />
          <path d={ivPath} fill="none" stroke="#7C3AED" strokeWidth="1.6" />
          <text x={padL} y={H - 4} fontSize="6" fill="#94A3B8">0mo</text>
          <text x={W - padR} y={H - 4} fontSize="6" textAnchor="end" fill="#94A3B8">36mo</text>
          <text x={4} y={padT + 4} fontSize="6" fill="#64748B">r(z)</text>
        </svg>
      );
    }
    case "twin":
      return (
        <div className="space-y-1">
          {[
            { l: "Activity", v: 0.50, c: "#1E40AF" },
            { l: "Sleep", v: 0.40, c: "#7C3AED" },
            { l: "Chemo", v: 1.00, c: "#DC2626" },
          ].map((s) => (
            <div key={s.l}>
              <div className="flex items-baseline justify-between text-[8px]">
                <span className="text-slate-700">{s.l}</span>
                <span className="font-mono tabular-nums text-slate-600">{s.v.toFixed(2)}</span>
              </div>
              <div className="relative h-1 rounded-full bg-slate-100">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${s.v * 100}%`, background: s.c, opacity: 0.7 }} />
              </div>
            </div>
          ))}
          <div className="mt-2 rounded bg-slate-900 p-1.5 text-white">
            <div className="text-[7px] uppercase tracking-wider text-slate-400">forecast</div>
            {[{ l: "OIC", v: "+0.13" }, { l: "Proc Speed", v: "−0.02" }, { l: "Episodic", v: "−0.01" }].map((o) => (
              <div key={o.l} className="flex items-baseline justify-between text-[8px]">
                <span className="text-slate-300">{o.l}</span>
                <span className="font-mono font-semibold tabular-nums">{o.v}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "prediction_fan": {
      const W = 296, H = 140, padL = 18, padR = 4, padT = 8, padB = 16;
      const xs = (w: number) => padL + (w / 26) * (W - padL - padR);
      const ymin = -1.0, ymax = 0.4;
      const ys = (z: number) => padT + (1 - (z - ymin) / (ymax - ymin)) * (H - padT - padB);
      const p50 = (w: number) => -0.78 + 0.62 * (1 - Math.exp(-w / 14));
      const p10 = (w: number) => p50(w) - (0.18 + 0.005 * w);
      const p90 = (w: number) => p50(w) + (0.18 + 0.005 * w);
      const upper = Array.from({ length: 27 }, (_, w) => `${xs(w).toFixed(1)},${ys(p90(w)).toFixed(1)}`).join(" L ");
      const lower = Array.from({ length: 27 }, (_, w) => 26 - w).map((w) => `${xs(w).toFixed(1)},${ys(p10(w)).toFixed(1)}`).join(" L ");
      const p50Path = Array.from({ length: 27 }, (_, w) => `${w === 0 ? "M" : "L"} ${xs(w).toFixed(1)} ${ys(p50(w)).toFixed(1)}`).join(" ");
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <path d={`M ${upper} L ${lower} Z`} fill="#7C3AED" opacity="0.18" />
          <path d={p50Path} fill="none" stroke="#7C3AED" strokeWidth="1.4" />
          <line x1={xs(8)} y1={padT} x2={xs(8)} y2={H - padB} stroke="#F59E0B" strokeWidth="0.6" strokeDasharray="2 2" />
          {[{ w: 0, v: -0.78 }, { w: 4, v: -0.62 }, { w: 8, v: -0.41 }].map((a, i, arr) => (
            <g key={i}>
              {i > 0 && <line x1={xs(arr[i - 1].w)} y1={ys(arr[i - 1].v)} x2={xs(a.w)} y2={ys(a.v)} stroke="#0F172A" strokeWidth="1" />}
              <circle cx={xs(a.w)} cy={ys(a.v)} r="2" fill="#0F172A" />
            </g>
          ))}
          <text x={padL} y={H - 4} fontSize="6" fill="#94A3B8">w0</text>
          <text x={W - padR} y={H - 4} fontSize="6" textAnchor="end" fill="#94A3B8">w26</text>
        </svg>
      );
    }
    case "action_plan":
      return (
        <div className="space-y-1.5">
          {[
            { l: "Today", b: "!", t: "rose", a: "Baseline NIHTB-CB" },
            { l: "Wk 1–2", b: "7", t: "amber", a: "150 min/wk aerobic" },
            { l: "Mo 1–3", b: "30", t: "violet", a: "Cog training 3–5×/wk" },
            { l: "Re-eval", b: "✓", t: "teal", a: "Re-run battery wk12" },
          ].map((s) => (
            <div key={s.l} className="flex items-center gap-2">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-semibold ring-1 ${
                s.t === "rose" ? "bg-rose-50 text-rose-700 ring-rose-200" :
                s.t === "amber" ? "bg-amber-50 text-amber-700 ring-amber-200" :
                s.t === "violet" ? "bg-violet-50 text-violet-700 ring-violet-200" :
                "bg-teal-50 text-teal-700 ring-teal-200"
              }`}>{s.b}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-700 w-14">{s.l}</span>
              <span className="flex-1 truncate text-[9px] text-slate-600">{s.a}</span>
            </div>
          ))}
        </div>
      );
    case "calib_scatter": {
      const W = 296, H = 140, padL = 18, padR = 4, padT = 8, padB = 16;
      const max = 32;
      const xs = (v: number) => padL + (v / max) * (W - padL - padR);
      const ys = (v: number) => padT + (1 - v / max) * (H - padT - padB);
      const points = [
        { p: 7, o: 9, c: "#10B981" }, { p: 14, o: 12, c: "#10B981" }, { p: 4, o: 5, c: "#10B981" },
        { p: 21, o: 28, c: "#F59E0B" }, { p: 10, o: 8, c: "#10B981" }, { p: 5, o: 11, c: "#F59E0B" },
        { p: 7, o: 6, c: "#10B981" }, { p: 14, o: 14, c: "#10B981" }, { p: 21, o: 9, c: "#EF4444" },
        { p: 28, o: 30, c: "#10B981" }, { p: 12, o: 13, c: "#10B981" }, { p: 4, o: 4, c: "#10B981" },
        { p: 8, o: 10, c: "#10B981" }, { p: 14, o: 22, c: "#F59E0B" },
      ];
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          <line x1={xs(0)} y1={ys(0)} x2={xs(max)} y2={ys(max)} stroke="#CBD5E1" strokeDasharray="2 2" strokeWidth="0.6" />
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#CBD5E1" strokeWidth="0.5" />
          {points.map((p, i) => <circle key={i} cx={xs(p.p)} cy={ys(p.o)} r="2.4" fill={p.c} stroke="white" strokeWidth="0.6" />)}
          <text x={W / 2} y={H - 3} fontSize="6" textAnchor="middle" fill="#64748B">predicted</text>
          <text x={4} y={padT + 4} fontSize="6" fill="#64748B">observed</text>
        </svg>
      );
    }
    case "edge_drift": {
      const edges = ["IL6→OIC", "OIC→PS", "ACT→IL6", "OIC→EM", "BDNF→NPL", "TNF→OIC"];
      const data = [
        [0.05, 0.08, 0.04, 0.07, 0.06, 0.09], [0.07, 0.12, 0.18, 0.22, 0.34, 0.41],
        [0.04, 0.05, 0.06, 0.04, 0.05, 0.04], [0.09, 0.16, 0.21, 0.31, 0.28, 0.35],
        [0.18, 0.14, 0.11, 0.08, 0.07, 0.05], [0.05, 0.06, 0.07, 0.06, 0.05, 0.06],
      ];
      const W = 296, H = 140, padL = 60, padT = 4, padR = 4, padB = 14;
      const cw = (W - padL - padR) / 6;
      const rh = (H - padT - padB) / 6;
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          {edges.map((e, r) => <text key={e} x={padL - 3} y={padT + r * rh + rh / 2 + 2} fontSize="6" textAnchor="end" fill="#475569">{e}</text>)}
          {data.map((row, r) => row.map((v, c) => {
            const color = v < 0.1 ? "#10B981" : v < 0.3 ? "#F59E0B" : "#EF4444";
            const op = Math.max(0.18, Math.min(0.85, v * 2 + 0.15));
            return <rect key={`${r}-${c}`} x={padL + c * cw + 0.5} y={padT + r * rh + 0.5} width={cw - 1} height={rh - 1} rx={1} fill={color} fillOpacity={op} />;
          }))}
        </svg>
      );
    }
    case "reality_calib":
      return (
        <div className="space-y-1.5">
          {[
            { name: "OIC mediates chemo→PS", score: 0.78, status: "green" },
            { name: "Sleep ↑ → cortisol slope ↓", score: 0.91, status: "green" },
            { name: "BDNF mediates exercise→memory", score: 0.41, status: "yellow" },
            { name: "APOE × age interaction", score: 0.12, status: "red" },
          ].map((b) => (
            <div key={b.name}>
              <div className="flex items-baseline justify-between text-[8px]">
                <span className="truncate text-slate-700">{b.name}</span>
                <span className="font-mono tabular-nums text-slate-600">{b.score.toFixed(2)}</span>
              </div>
              <div className="relative mt-0.5 h-1 rounded-full bg-slate-100">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${b.score * 100}%`, background: b.status === "green" ? "#10B981" : b.status === "yellow" ? "#F59E0B" : "#EF4444" }} />
              </div>
            </div>
          ))}
        </div>
      );
    case "loop_burndown": {
      const W = 296, H = 140, padL = 16, padR = 14, padT = 6, padB = 14;
      const cycles = LOOP_CYCLES;
      const xs = (n: number) => padL + ((n - 1) / Math.max(1, cycles.length - 1)) * (W - padL - padR);
      const max = Math.max(...cycles.map((c) => c.eAdd + c.edAdd + c.gapsClose));
      const ys = (v: number) => padT + (1 - v / max) * (H - padT - padB);
      const covYs = (v: number) => padT + (1 - v) * (H - padT - padB);
      const barW = ((W - padL - padR) / cycles.length) * 0.55;
      return (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
          {cycles.map((c) => {
            const x = xs(c.n) - barW / 2;
            const yT = ys(c.eAdd + c.edAdd + c.gapsClose);
            const eH = (c.eAdd / max) * (H - padT - padB);
            const edH = (c.edAdd / max) * (H - padT - padB);
            const gH = (c.gapsClose / max) * (H - padT - padB);
            return (
              <g key={c.n}>
                <rect x={x} y={yT} width={barW} height={eH} fill="#7C3AED" opacity="0.85" />
                <rect x={x} y={yT + eH} width={barW} height={edH} fill="#06B6D4" opacity="0.85" />
                <rect x={x} y={yT + eH + edH} width={barW} height={gH} fill="#F59E0B" opacity="0.85" />
              </g>
            );
          })}
          <path d={cycles.map((c, i) => `${i === 0 ? "M" : "L"} ${xs(c.n).toFixed(1)} ${covYs(c.covAfter).toFixed(1)}`).join(" ")} fill="none" stroke="#10B981" strokeWidth="1.4" strokeDasharray="2 2" />
          {cycles.map((c) => <circle key={c.n} cx={xs(c.n)} cy={covYs(c.covAfter)} r="2" fill="#10B981" />)}
        </svg>
      );
    }
    case "baseline_delta": {
      const rows = [
        { l: "Entities", t0: 24, now: 64 }, { l: "Edges", t0: 8, now: 23 },
        { l: "Cycles", t0: 0, now: 4 }, { l: "Bridges", t0: 0, now: 7 },
        { l: "Coverage", t0: 0.31, now: 0.82 }, { l: "Stack health", t0: 0.42, now: 0.78 },
        { l: "Calibrated", t0: 0, now: 14 },
      ];
      return (
        <div className="space-y-1">
          {rows.map((r) => {
            const isInt = Number.isInteger(r.t0);
            const delta = r.now - r.t0;
            return (
              <div key={r.l} className="grid grid-cols-[80px_44px_12px_44px_36px] items-baseline gap-1 text-[8px]">
                <span className="truncate text-slate-700">{r.l}</span>
                <span className="text-right font-mono tabular-nums text-slate-400">{isInt ? r.t0 : r.t0.toFixed(2)}</span>
                <span className="text-center text-slate-300">→</span>
                <span className="text-right font-mono font-semibold tabular-nums text-slate-900">{isInt ? r.now : r.now.toFixed(2)}</span>
                <span className="text-right font-mono tabular-nums text-emerald-600">↑{isInt ? delta : delta.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      );
    }
    case "proposal_funnel":
      return (
        <div className="grid grid-cols-3 gap-1">
          {INTAKE_STREAMS.map((s) => (
            <div key={s.id} className="rounded border border-slate-100 bg-white p-1.5 text-center">
              <div className="font-mono text-[12px]" style={{ color: s.color }}>{s.glyph}</div>
              <div className="text-[8px] font-semibold text-slate-700">{s.label}</div>
              <div className="font-mono text-[7px] tabular-nums" style={{ color: s.color }}>{s.pending} pending</div>
              {s.superseded > 0 && <div className="font-mono text-[6px] tabular-nums text-slate-400">↶ {s.superseded}</div>}
            </div>
          ))}
        </div>
      );
    case "app_materializer":
      return (
        <div>
          <div className="rounded-md bg-slate-50/60 p-1.5">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">infrastructure_proposal[]</div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-800">twin_proposal v4 → 5 apps</div>
            <div className="font-mono text-[7px] tabular-nums text-slate-500">+ 24 metric_trackers built</div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {[
              { l: "Anti-Inflam Stack", c: "#F59E0B", ent: 14 },
              { l: "Sleep Protocol", c: "#0EA5E9", ent: 9 },
              { l: "Cog Game", c: "#7C3AED", ent: 18 },
              { l: "Cog Measure", c: "#06B6D4", ent: 12 },
              { l: "MBSR Stack", c: "#10B981", ent: 7 },
            ].slice(0, 4).map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded border border-slate-100 px-1.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.c }} />
                <span className="flex-1 truncate text-[7px] text-slate-700">{a.l}</span>
                <span className="font-mono text-[6px] tabular-nums text-slate-400">{a.ent}e</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">stable identity: source_infrastructure_proposal_id</div>
        </div>
      );
    case "agent_fleet":
      return (
        <div>
          <div className="mb-1 flex items-center justify-between text-[7px] tabular-nums">
            <span className="font-semibold uppercase tracking-wider text-slate-500">Sprint 3 agents</span>
            <span className="text-slate-400">8 mechanisms</span>
          </div>
          <div className="space-y-0.5">
            {[
              { name: "anti-inflam-coordinator", state: "running", c: "#10B981" },
              { name: "sleep-monitor", state: "running", c: "#10B981" },
              { name: "cog-training-coach", state: "running", c: "#10B981" },
              { name: "metric-aggregator", state: "queued", c: "#94A3B8" },
              { name: "cycle-watcher", state: "queued", c: "#94A3B8" },
              { name: "calibration-feedback", state: "stale", c: "#F59E0B" },
            ].map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded bg-slate-50/40 px-1.5 py-0.5 text-[7px]">
                <span className={`h-1 w-1 rounded-full ${a.state === "running" ? "animate-pulse" : ""}`} style={{ background: a.c }} />
                <span className="flex-1 truncate font-mono text-slate-700">{a.name}</span>
                <span className="font-mono text-[6px] uppercase tracking-wider" style={{ color: a.c }}>{a.state}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">writes apps.config.manifest · app_versions audit</div>
        </div>
      );
    case "app_tether":
      return (
        <div>
          <div className="rounded-md bg-amber-50/40 p-1.5">
            <div className="flex items-center gap-1.5 text-[7px] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="font-semibold uppercase tracking-wider text-amber-700">PARTIAL — schema only</span>
            </div>
            <div className="mt-1 text-[8px] leading-snug text-slate-700">complementary_app_ids[] declared but no runtime populator found</div>
          </div>
          <div className="mt-1.5 space-y-1">
            {[
              { a: "Cog Game", b: "Cog Measure", arrow: "↔" },
              { a: "Anti-Inflam", b: "Lab Scaffold", arrow: "↔" },
            ].map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-slate-50/40 px-1.5 py-1 text-[8px]">
                <span className="font-medium text-slate-700">{p.a}</span>
                <span className="font-mono text-amber-500">{p.arrow}</span>
                <span className="font-medium text-slate-700">{p.b}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">UI overlay exists · runtime missing</div>
        </div>
      );
    case "metric_observations":
      return (
        <div>
          <div className="grid grid-cols-2 gap-1">
            <div className="rounded bg-slate-50/60 p-1.5 text-center">
              <div className="font-mono text-[14px] font-semibold tabular-nums text-slate-700">42</div>
              <div className="text-[7px] uppercase tracking-wider text-slate-400">observations</div>
            </div>
            <div className="rounded bg-slate-50/60 p-1.5 text-center">
              <div className="font-mono text-[14px] font-semibold tabular-nums text-slate-700">8</div>
              <div className="text-[7px] uppercase tracking-wider text-slate-400">metrics tracked</div>
            </div>
          </div>
          <div className="mt-1.5 space-y-0.5">
            {[
              { l: "PSQI score", v: "11", ago: "2d", flag: false },
              { l: "MVPA min/wk", v: "60", ago: "5d", flag: false },
              { l: "Cortisol AUC", v: "−1.8", ago: "12h", flag: true },
              { l: "BrainHQ adherence", v: "2.1×/wk", ago: "1d", flag: false },
            ].map((m, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[7px]">
                <span className={`h-1 w-1 rounded-full ${m.flag ? "bg-amber-500" : "bg-emerald-500"}`} />
                <span className="flex-1 truncate text-slate-700">{m.l}</span>
                <span className="font-mono tabular-nums text-slate-700">{m.v}</span>
                <span className="font-mono text-[6px] tabular-nums text-slate-400">{m.ago}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">→ prediction_ledger.actual_trajectory</div>
        </div>
      );
    case "prediction_resolver":
      return (
        <div>
          <div className="rounded-md bg-slate-50/60 p-1.5">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">resolveTrajectoryPrediction</div>
            <div className="mt-0.5 text-[8px] leading-snug text-slate-700">actual_trajectory vs p50 → MRE + temporal_delta</div>
          </div>
          <div className="mt-1.5 space-y-1">
            {[
              { tag: "expected", c: "#10B981", n: 8, w: 75 },
              { tag: "regime_shift", c: "#F59E0B", n: 3, w: 28 },
              { tag: "surprise", c: "#EF4444", n: 1, w: 9 },
            ].map((d) => (
              <div key={d.tag} className="flex items-center gap-1.5 text-[7px]">
                <span className="h-1.5 w-1.5 rounded-sm" style={{ background: d.c }} />
                <span className="w-20 font-mono text-slate-700">{d.tag}</span>
                <div className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${d.w}%`, background: d.c, opacity: 0.7 }} />
                </div>
                <span className="font-mono tabular-nums text-slate-600">{d.n}</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 font-mono text-[7px] tabular-nums text-slate-400">emits edge_calibrations · path_aware_temporal_v1</div>
        </div>
      );
    case "app_outcomes": {
      const apps = [
        { name: "Anti-Inflam Stack", c: "#F59E0B", health: 0.71, healthDelta: -0.06, adher: 64, deliveredZ: 0.12, expectedZ: 0.21, target: "IL-6 ↓" },
        { name: "Sleep Protocol", c: "#0EA5E9", health: 0.88, healthDelta: 0.04, adher: 81, deliveredZ: 0.18, expectedZ: 0.15, target: "PSQI ↓" },
        { name: "Cog Game", c: "#7C3AED", health: 0.84, healthDelta: 0.02, adher: 72, deliveredZ: 0.09, expectedZ: 0.14, target: "BDNF ↑" },
        { name: "Cog Measure", c: "#06B6D4", health: 0.91, healthDelta: 0.01, adher: 95, deliveredZ: null, expectedZ: null, target: "monitor" },
        { name: "MBSR Stack", c: "#10B981", health: 0.62, healthDelta: -0.09, adher: 38, deliveredZ: 0.04, expectedZ: 0.18, target: "Cortisol ↓" },
      ];
      return (
        <div className="space-y-1">
          {apps.map((a) => {
            const onTarget = a.deliveredZ !== null && a.expectedZ !== null && a.deliveredZ >= a.expectedZ * 0.7;
            return (
              <div key={a.name} className="rounded border border-slate-100 bg-white px-1.5 py-1">
                <div className="flex items-baseline gap-1.5 text-[8px]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.c }} />
                  <span className="flex-1 truncate font-medium text-slate-800">{a.name}</span>
                  <span className="font-mono tabular-nums text-slate-500">h={a.health.toFixed(2)}</span>
                  <span className={`font-mono tabular-nums ${a.healthDelta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {a.healthDelta >= 0 ? "↑" : "↓"}{Math.abs(a.healthDelta).toFixed(2)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[7px] tabular-nums">
                  <span className="text-slate-500">adher</span>
                  <div className="relative h-0.5 w-10 rounded-full bg-slate-100">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${a.adher}%`, background: a.adher >= 70 ? "#10B981" : a.adher >= 50 ? "#F59E0B" : "#EF4444" }} />
                  </div>
                  <span className="font-mono text-slate-600">{a.adher}%</span>
                  {a.deliveredZ !== null && (
                    <>
                      <span className="ml-auto text-slate-500">Δz</span>
                      <span className={`font-mono ${onTarget ? "text-emerald-600" : "text-amber-600"}`}>
                        {a.deliveredZ.toFixed(2)}
                      </span>
                      <span className="text-slate-400">/</span>
                      <span className="font-mono text-slate-500">{a.expectedZ?.toFixed(2)}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="font-mono text-[7px] tabular-nums text-slate-400">aggregated from app_versions + metric_observations + actual_trajectory</div>
        </div>
      );
    }
    case "lab_scaffold":
      return (
        <div>
          <div className="rounded-md bg-rose-50/40 p-1.5">
            <div className="flex items-center gap-1.5 text-[7px] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="font-semibold uppercase tracking-wider text-rose-700">MISSING — assembly</span>
            </div>
            <div className="mt-1 text-[8px] leading-snug text-slate-700">approval endpoint exists; no code assembles multi-app experiments yet</div>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">scaffolded · 1</div>
            <div className="rounded bg-slate-50/40 p-1.5">
              <div className="text-[8px] font-semibold text-slate-800">CRCI · 12-week intervention RCT</div>
              <div className="mt-0.5 font-mono text-[7px] tabular-nums text-slate-500">3 arms × 50 subjects · uses 4 apps</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {["Anti-Inflam", "Sleep", "CogGame", "CogMeasure"].map((a) => (
                  <span key={a} className="rounded bg-white px-1 py-0 font-mono text-[6px] text-slate-500 ring-1 ring-slate-200">{a}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">approves but doesn't compose · /api/lab-scaffolds/[id]/approve</div>
        </div>
      );
    case "hypothesis_ladders": {
      const claims = [
        { c: "OIC mediates chemo→PS", evidence: "supported", k: 25, color: "#10B981" },
        { c: "Activity → IL-6 ↓", evidence: "supported", k: 4, color: "#10B981" },
        { c: "BDNF mediates exercise→memory", evidence: "weakening", k: 3, color: "#F59E0B" },
        { c: "Sleep ↑ → cortisol slope ↓", evidence: "supported", k: 2, color: "#10B981" },
        { c: "APOE × Activity heterogeneity", evidence: "awaiting", k: 0, color: "#94A3B8" },
        { c: "MBSR causes sustained Δz", evidence: "refuted", k: 5, color: "#EF4444" },
      ];
      return (
        <div className="space-y-1">
          {claims.map((cl, i) => (
            <div key={i} className="rounded border border-slate-100 bg-white px-1.5 py-1">
              <div className="flex items-baseline gap-1.5 text-[8px]">
                <span className="font-mono text-slate-400">≡{i + 1}</span>
                <span className="flex-1 truncate text-slate-700">{cl.c}</span>
                <span className="rounded-full px-1 py-0 font-mono text-[7px] uppercase tracking-wider"
                      style={{ background: `${cl.color}1a`, color: cl.color }}>
                  {cl.evidence}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[7px] tabular-nums text-slate-400">k={cl.k} studies · falsifier active</div>
            </div>
          ))}
          <div className="font-mono text-[7px] tabular-nums text-slate-400">→ verdict updates from edge_calibrations</div>
        </div>
      );
    }
    case "argument_tribunal": {
      const debates = [
        {
          claim: "Sleep deprivation → CRCI",
          counter: "CRCI → Sleep disturbance",
          severity: "high",
          weakAssump: 0.41,
          color: "#EF4444",
        },
        {
          claim: "BDNF mediates exercise effect",
          counter: "Direct neurogenesis pathway",
          severity: "med",
          weakAssump: 0.62,
          color: "#F59E0B",
        },
        {
          claim: "Cortisol slope causal",
          counter: "Marker not mechanism",
          severity: "low",
          weakAssump: 0.73,
          color: "#10B981",
        },
      ];
      return (
        <div className="space-y-1.5">
          {debates.map((d, i) => (
            <div key={i} className="rounded bg-slate-50/40 p-1.5">
              <div className="flex items-baseline justify-between text-[7px] tabular-nums">
                <span className="font-semibold uppercase tracking-wider" style={{ color: d.color }}>{d.severity}</span>
                <span className="font-mono text-slate-500">brittleness {d.weakAssump.toFixed(2)}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1fr_8px_1fr] items-baseline gap-1 text-[8px]">
                <div className="rounded border border-slate-100 bg-white px-1 py-0.5 text-slate-700">{d.claim}</div>
                <div className="text-center font-mono text-slate-400">vs</div>
                <div className="rounded border border-slate-100 bg-white px-1 py-0.5 text-slate-700">{d.counter}</div>
              </div>
            </div>
          ))}
          <div className="font-mono text-[7px] tabular-nums text-slate-400">synthesis_data.contradictions · weakest assumption highlighted</div>
        </div>
      );
    }
    case "cycle_break_planner": {
      const breaks = [
        { node: "N20 (IL-6)", cost: 0.31, benefit: 0.18, app: "Anti-Inflam Stack", best: true },
        { node: "N32 (HPA)", cost: 0.41, benefit: 0.14, app: "MBSR / Stress" },
        { node: "N24 (Cortisol)", cost: 0.55, benefit: 0.16, app: "Sleep Protocol" },
      ];
      return (
        <div>
          <div className="rounded-md bg-violet-50/40 p-1.5">
            <div className="flex items-center gap-1.5 text-[7px] tabular-nums">
              <span className="font-mono text-violet-700">↻</span>
              <span className="font-semibold uppercase tracking-wider text-violet-700">cycle: N20 → N30 → N32 → N24 → N20</span>
            </div>
            <div className="mt-0.5 font-mono text-[7px] tabular-nums text-slate-500">period ≈ 21d · gain 1.34 · self-sustaining</div>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">break-point candidates</div>
            {breaks.map((b, i) => (
              <div key={i} className={`flex items-baseline gap-1.5 rounded px-1.5 py-1 text-[8px] ${b.best ? "bg-emerald-50/40 ring-1 ring-emerald-200" : "bg-slate-50/40"}`}>
                <span className="font-mono text-[7px] text-slate-400">{i + 1}</span>
                <span className="flex-1 truncate font-medium text-slate-800">{b.node}</span>
                <span className="font-mono tabular-nums text-rose-600">−{b.cost.toFixed(2)}</span>
                <span className="text-slate-400">→</span>
                <span className="font-mono tabular-nums text-emerald-600">+{b.benefit.toFixed(2)}</span>
                {b.best && <span className="rounded-full bg-emerald-100 px-1 py-0 font-mono text-[6px] uppercase tracking-wider text-emerald-700">best</span>}
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">cost = 0.5σ intervention magnitude · benefit = downstream Δz on N50</div>
        </div>
      );
    }
    case "intel_radar": {
      const signals = [
        { l: "Convergence", v: 0.82, c: "#7C3AED" },
        { l: "Contradiction", v: 0.34, c: "#EF4444" },
        { l: "Cycle dynamics", v: 0.71, c: "#F59E0B" },
        { l: "Bridge redundancy", v: 0.34, c: "#06B6D4" },
        { l: "Coverage", v: 0.82, c: "#10B981" },
        { l: "Freshness", v: 0.61, c: "#0EA5E9" },
      ];
      const cx = 75, cy = 75, r = 60;
      const angleFor = (i: number) => -Math.PI / 2 + (i / signals.length) * 2 * Math.PI;
      const pointFor = (i: number, value: number) => {
        const a = angleFor(i);
        return [cx + Math.cos(a) * r * value, cy + Math.sin(a) * r * value];
      };
      const polyPoints = signals.map((s, i) => pointFor(i, s.v).join(",")).join(" ");
      return (
        <div className="flex h-full items-start gap-2">
          <svg viewBox="0 0 150 150" className="h-full w-[150px]">
            {[0.25, 0.5, 0.75, 1].map((g) => (
              <polygon key={g}
                points={signals.map((_, i) => pointFor(i, g).join(",")).join(" ")}
                fill="none" stroke="#E2E8F0" strokeWidth="0.5" />
            ))}
            {signals.map((s, i) => {
              const [x, y] = pointFor(i, 1);
              return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#F1F5F9" strokeWidth="0.5" />;
            })}
            <polygon points={polyPoints} fill="#7C3AED" fillOpacity="0.2" stroke="#7C3AED" strokeWidth="1.4" />
            {signals.map((s, i) => {
              const [x, y] = pointFor(i, s.v);
              return <circle key={i} cx={x} cy={y} r="2" fill={s.c} stroke="white" strokeWidth="0.6" />;
            })}
          </svg>
          <div className="flex-1 space-y-0.5">
            {signals.map((s) => (
              <div key={s.l} className="flex items-center gap-1.5 text-[8px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.c }} />
                <span className="flex-1 truncate text-slate-700">{s.l}</span>
                <span className="font-mono tabular-nums" style={{ color: s.v < 0.5 ? "#EF4444" : s.v < 0.7 ? "#F59E0B" : "#10B981" }}>
                  {s.v.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "loop_recorder":
      return (
        <div>
          <div className="rounded-md bg-rose-50/40 p-1.5">
            <div className="flex items-center gap-1.5 text-[7px] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="font-semibold uppercase tracking-wider text-rose-700">MISSING — writers</span>
            </div>
            <div className="mt-1 text-[8px] leading-snug text-slate-700">loop_cycle_records table exists; no active writer found</div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {[
              { l: "phases[]", v: "—", c: "#94A3B8" },
              { l: "delta", v: "—", c: "#94A3B8" },
              { l: "coverage Δ", v: "—", c: "#94A3B8" },
              { l: "trigger_type", v: "—", c: "#94A3B8" },
            ].map((f) => (
              <div key={f.l} className="rounded bg-slate-50/40 px-1.5 py-1 text-[7px]">
                <div className="font-mono text-slate-500">{f.l}</div>
                <div className="mt-0.5 font-mono tabular-nums" style={{ color: f.c }}>{f.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">needs cycle-watcher agent · ~1h fix</div>
        </div>
      );
    case "discovery_auto_propose":
      return (
        <div>
          <div className="rounded-md bg-amber-50/40 p-1.5">
            <div className="flex items-center gap-1.5 text-[7px] tabular-nums">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="font-semibold uppercase tracking-wider text-amber-700">PARTIAL — manual trigger</span>
            </div>
            <div className="mt-1 text-[8px] leading-snug text-slate-700">proposeFromConvergentPointsBatch() exists but not auto-fired post-resolution</div>
          </div>
          <div className="mt-1.5 space-y-0.5">
            <div className="font-mono text-[7px] uppercase tracking-wider text-slate-500">candidates ready</div>
            {[
              { l: "OIC convergence", c: 0.88 },
              { l: "Activity ↑ → Δz +0.31", c: 0.79 },
              { l: "APOE × Activity", c: 0.69 },
            ].map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-[7px]">
                <span className="flex-1 truncate text-slate-600">{p.l}</span>
                <span className="font-mono tabular-nums text-slate-600">conf {p.c.toFixed(2)}</span>
                <span className={`rounded-full px-1 py-0 text-[6px] font-semibold ${p.c >= 0.75 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{p.c >= 0.75 ? "≥0.75 ✓" : "<0.75"}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[7px] tabular-nums text-slate-400">→ twin_proposals (discovery_source)</div>
        </div>
      );
    default:
      return <div className="text-[9px] italic text-slate-400">{cardId}</div>;
  }
}

// ── CARD DETAIL INSPECTOR ────────────────────────────────────────────
// For each card: what it currently renders (static mock), what the
// codebase ACTUALLY produces (tables + columns + code paths), and what
// the ideal expanded version should show beyond current capability.

type CardDetail = {
  current: string[];
  codebase: { tables: string[]; producers: string[]; key_fields?: string[] };
  ideal: string[];
  long_form_section?: string;
};

const CARD_DETAILS: Record<string, CardDetail> = {
  kg_graph: {
    current: [
      "Static SVG of 64 nodes + 23 edges from data.ts hardcoded NODES/EDGES",
      "Layer-sorted positions computed once in layoutKG()",
      "Edge color by sign of β (grey positive, red negative)",
      "N30 highlighted with dashed amber callout",
    ],
    codebase: {
      tables: ["entities", "edges", "evidence_registries", "layer_ontology"],
      key_fields: [
        "entity.id, name, layer_ontology_id, confidence, node_signature, mechanism_id",
        "edge.id, source/target_entity_id, strength, polarity, edge_kind, onset_days, peak_days, persistence_days",
      ],
      producers: ["api/explore/create (seed materialize)", "api/pipeline/research (LLM extraction)", "lib/templates/template-edge-augmenter.ts (D11)"],
    },
    ideal: [
      "Click edge → citation registry rows + GRADE rating + DOI links",
      "Click node → entity properties, in/out edges, mechanism_id, node_signature panel",
      "Filter chips: layer · domain · status (confirmed/mixed/sparse)",
      "Temporal scrubber → graph at prior loop_cycle",
      "Confidence/freshness colorwash overlay",
      "Drag edge endpoints to propose alternate wiring (creates twin_proposal)",
    ],
    long_form_section: "KG Substrate · Knowledge Graph",
  },
  trajectory: {
    current: [
      "Static Weibull r(t) = r∞·(1−exp(−(t/τ)^γ)) using REC[BCA] hardcoded",
      "Fixed trapezoidal intervention overlay (peak 0.25, plateau 18mo)",
      "95% PI band as ±0.08 constant — not derived from real uncertainty",
    ],
    codebase: {
      tables: ["recovery_baselines", "intervention_kernels", "prediction_ledger", "scenario_deltas"],
      key_fields: [
        "recovery_baselines.r_inf, tau_months, gamma_shape, cancer_type, n_cohort",
        "intervention_kernels.kind (linear|exp|sustained|biphasic), onset_days, plateau_days, peak_amplitude",
        "prediction_ledger.predicted_trajectory, actual_trajectory, deviation_tag",
      ],
      producers: ["api/pipeline/strategy-refresh (initial)", "api/pipeline/twin/run-forward", "lib/twin/run-monte-carlo.ts (M=2000)"],
    },
    ideal: [
      "Actuals overlay from prediction_ledger.actual_trajectory",
      "Multi-scenario fork A/B/C with action_list diffs",
      "Per-subject curve forking (4 patient profiles → 4 curves)",
      "Time scrubber: prediction made at any past loop cycle",
      "Click peak → 'what intervention was scheduled to peak here?'",
      "Confidence band live-updates as new evidence arrives",
      "Deviation_tag annotations: surprise / regime_shift markers on curve",
    ],
    long_form_section: "Workspaces · Trajectory · 37mo",
  },
  twin: {
    current: [
      "3 input sliders: Activity, Sleep, Chemo (z-units)",
      "Bayesian forward-pass through 23 hardcoded edges (IVW pooling)",
      "Output: 5 biomarkers + 3 cognitive composites with ±SE",
    ],
    codebase: {
      tables: ["twin_states", "twin_proposals", "mechanisms", "edges"],
      key_fields: [
        "twin_states.input_state, computed_state, computed_se",
        "twin_proposals.justification (chosen_approach, alternatives_rejected[]), mechanism_ids[], basis_edge_ids[]",
        "mechanisms.classification (functional|structural), confidence",
      ],
      producers: ["lib/twin/compute-state.ts", "lib/twin/wire-twin-proposal.ts", "api/spaces/[id]/twin-proposal/approve"],
    },
    ideal: [
      "Per-subject twins: 4 patient profiles, 4 forecasts",
      "Cohort comparison: median + IQR across subjects",
      "Sensitivity heatmap: which input matters for which output?",
      "Counterfactual: 'if I held BDNF at +1z, what changes?'",
      "Live calibration: actual measured biomarker vs predicted with delta",
      "Click output → trace propagation path (with edge β values)",
      "Save state as scenario, parliament-compare scenarios",
    ],
    long_form_section: "Workspaces · Digital Twin",
  },
  master_bottleneck: {
    current: [
      "Static N30 (Neuroinflammation) shown as the bottleneck",
      "Counterfactual: +0.18z Δ ProcessingSpeed if N30 ↓50%",
      "In/out degree (3, 6) as small tiles",
    ],
    codebase: {
      tables: ["entities", "edges", "synthesis_data.master_bottleneck"],
      key_fields: ["synthesis_data.master_bottleneck.entity_id, counterfactual_unlock, candidates_considered[], betweenness_centrality"],
      producers: ["api/pipeline/synthesize (LLM identifies)", "lib/synthesis/master-bottleneck.ts"],
    },
    ideal: [
      "Top-3 bottleneck candidates ranked, deferred ones visible",
      "Mechanism panel: phenomenology + literature_grounding + falsifiable_prediction",
      "CF range slider: see Δ at 25/50/75% suppression",
      "Branching: 'what if we picked a different bottleneck?'",
      "Causes-of-bottleneck: which upstream nodes contribute most?",
      "Historical bottleneck shift: when did N30 become the bottleneck?",
    ],
    long_form_section: "Orient · Master bottleneck",
  },
  hidden_insights: {
    current: [
      "4 hand-curated callouts: Cycle, Bridge, Discordance, Temporal mismatch",
      "Each shows finding + evidence + suggested action",
      "Static text — not from live computation",
    ],
    codebase: {
      tables: ["cycles", "bridges", "novel_connections", "synthesis_data.contradictions", "edge_calibrations"],
      key_fields: [
        "cycles.entity_path[], period_estimate, gain_factor",
        "bridges.articulation_node, paths_blocked, betweenness",
        "novel_connections.source/target_entity_id, strength, reasoning",
      ],
      producers: ["lib/synthesis/cycle-detection.ts (Tarjan SCC)", "lib/synthesis/articulation-points.ts", "api/pipeline/synthesize"],
    },
    ideal: [
      "Top-N insights ranked by surprise score (impact × novelty × confidence)",
      "Detection algorithm metadata: 'Tarjan SCC' / 'discordance Z-test' / 'Phase 5'",
      "Falsifier ladder: what observation refutes this?",
      "Action wiring: clicking 'recommended action' → twin_proposal",
      "Insight history: confirmed/refuted timeline per insight",
      "Group-by: cluster by mechanism / pathway / pattern type",
    ],
    long_form_section: "Hidden insights · what we surfaced",
  },
  forest_plot: {
    current: [
      "6 cognitive domains + composite diamond, baseline vs +intervention",
      "Static effect sizes from REF_DOMAINS hardcoded",
      "MCMC M=2000 draws labeled but not actually run",
    ],
    codebase: {
      tables: ["reference_domains", "synthesis_data.domain_posteriors", "prediction_ledger"],
      key_fields: [
        "reference_domain.name, mean_z, ci_lo, ci_hi, n_obs, dominant_edge",
        "domain_posteriors.baseline_post, intervention_post, mcmc_samples",
      ],
      producers: ["api/pipeline/synthesize (computes posteriors)", "lib/synthesis/posterior-shift.ts"],
    },
    ideal: [
      "Per-subject forest plots (subject-specific posteriors)",
      "Dominant-edge tooltip on each row",
      "Click row → drill into citation tree for that domain",
      "Comparison: baseline vs +intervention vs actual (3 forests)",
      "Sensitivity ribbon: prior strength affects shape",
      "Heterogeneity diagnostic: τ² per domain, fixed-vs-random toggle",
    ],
    long_form_section: "Posterior analytics · Forest plot",
  },
  variance_decomp: {
    current: [
      "5-source stacked bar: Edge SE 38% / Proxy 23% / τ² 18% / Latent 15% / Adherence 6%",
      "Static percentages — not derived from live posterior",
    ],
    codebase: {
      tables: ["synthesis_data.variance_decomposition", "edges", "trackers"],
      key_fields: ["variance_decomposition.edge_contribution, proxy_contribution, tau_squared, latent_contribution, adherence_drift"],
      producers: ["lib/synthesis/variance-decomposition.ts", "uses edge.standard_error + tracker.adherence_telemetry"],
    },
    ideal: [
      "Per-output decomposition: pick a target node, see its breakdown",
      "Reducible vs irreducible split (Edge SE = reducible, τ² = irreducible)",
      "Click source → 'how do I reduce this?' (e.g., latent → mediator var)",
      "Time series across loop cycles (calibration tracking)",
      "What-if: 'add 5 studies on edge X → Edge SE drops by ?'",
    ],
    long_form_section: "Posterior analytics · Variance decomposition",
  },
  calib_cascade: {
    current: [
      "9-row mini cascade: SE_raw 0.32 → 7 layers → SE_eff 0.21",
      "Each layer multiplicative or additive (τ²)",
      "34% reduction shown",
    ],
    codebase: {
      tables: ["evidence_registries", "edge_calibrations", "audit_log"],
      key_fields: ["evidence_registry.se_raw, study_design, population, tau_squared, measurement, grade, temporal_match, freshness, se_eff"],
      producers: ["lib/calibration/se-cascade.ts (7-layer)", "lib/calibration/grade-scoring.ts"],
    },
    ideal: [
      "Per-edge cascade — currently aggregate; show one edge's full pipeline",
      "Layer drilldown: 'why is measurement_factor 1.05?'",
      "Trust-boundary gate visualization: which edges fail which gates?",
      "Freshness decay slider: scrub time, see SE inflate",
      "Comparison view: same edge across cohorts (heterogeneity spot)",
    ],
    long_form_section: "Posterior analytics · Calibration cascade",
  },
  apps_portfolio: {
    current: [
      "Static bubble chart: 5 apps positioned by priority × complexity",
      "Bubble size = entity count, amber dot = stale flag",
    ],
    codebase: {
      tables: ["apps", "trackers", "interventions", "improvement_goals"],
      key_fields: [
        "app.dominant_entity_ids, tracker_ids, health_score, stale_reason, priority, complexity, status, complementary_app_ids, linked_objective_id",
        "app.mechanism_grounding (phenomenology + falsifiable_prediction)",
      ],
      producers: ["api/pipeline/strategy-refresh (materializes from infrastructure_proposals)", "intake-review (gates active)"],
    },
    ideal: [
      "Click app → tracker rows with current/target/threshold + telemetry",
      "Supersede chain: app version history (v1 → v2 → v3)",
      "Dependency graph: complementary_app_ids visualized",
      "Health timeline across loop cycles",
      "Pause/resume affordance directly from view",
      "Mechanism grounding tooltip: phenomenology + falsifier",
    ],
    long_form_section: "(referenced in Workspaces / Insight rail)",
  },
  strategy_twin: {
    current: [
      "Static 'chosen approach v4' panel + 3 alternatives_rejected with strikethrough",
      "Confidence 0.79, 8 mechanism_ids referenced",
    ],
    codebase: {
      tables: ["twin_proposals", "mechanisms", "improvement_goals", "ranked_strategies"],
      key_fields: [
        "twin_proposal.justification (chosen_approach, key_tradeoffs, alternatives_rejected[].rejection_reason)",
        "ranked_strategies (perspectives[], micro_tactics[], infrastructure_proposals[])",
      ],
      producers: ["api/pipeline/strategy-refresh + lib/twin/wire-twin-proposal.ts", "lib/prompts/strategic-recommendation.ts"],
    },
    ideal: [
      "Side-by-side: chosen vs each rejected with full tradeoff matrix",
      "Re-rank affordance: drag alternatives to swap chosen",
      "Mechanism panel: drill into 8 mechanism_ids",
      "Citation thread: every basis_edge_id linked to evidence chain",
      "Discussion thread: comments / critiques (proposal_thread)",
      "Approval flow: explicit approve / defer / counter-propose",
    ],
    long_form_section: "Pending proposals · Variable + Discovery",
  },
  proposal_funnel: {
    current: [
      "3×2 stream tile grid: 6 streams with pending counts",
      "Some show supersede badges",
    ],
    codebase: {
      tables: ["concept_proposals", "twin_proposals", "variable_proposals", "discovery_proposals", "router_proposals", "rigor_runs"],
      key_fields: ["proposal.id, source, status, confidence, priority, depends_on, alternatives_rejected[]", "rigor_runs.experiment_specs[]"],
      producers: ["api/pipeline/synthesize → variable_proposals", "api/pipeline/discovery → discovery_proposals", "api/router/propose → router_proposals", "lib/rigor/intake.ts → rigor_runs"],
    },
    ideal: [
      "Unified queue across 6 streams in priority order",
      "Supersede chain visualization per proposal",
      "Bulk actions: 'approve top 3', 'defer all variable'",
      "Filter by source / lens / linked_app",
      "Auto-routing: high-conf proposals auto-promote",
      "Time-to-resolution sparkline per stream",
      "Proposal thread: discussion + critiques",
    ],
    long_form_section: "Pending proposals + Audit",
  },
  synthesis_decomp: {
    current: ["6-section list: leverage 6, risk 4, bottleneck 1, feedback 2, contradictions 3, goals 5"],
    codebase: {
      tables: ["synthesis_data (JSONB on spaces)", "improvement_goals", "novel_connections"],
      key_fields: ["synthesis_data.leverage_points, risk_points, master_bottleneck, feedback_loops, contradictions, suggested_objectives, intelligence_radar, mechanism_grounding"],
      producers: ["api/pipeline/synthesize (LLM)", "lib/prompts/synthesis-prompt.ts"],
    },
    ideal: [
      "Click section → drill into items with reasoning + falsifier",
      "Re-run with different prompt presets (conservative / aggressive)",
      "Supersede history: leverage points across runs",
      "LLM critique loop: synthesis self-critiques + refines",
      "Cross-template synthesis: same prompt across templates, compare",
    ],
    long_form_section: "(linked from Pending proposals)",
  },
};

function CardDetailInspector({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  if (!cardId) return null;
  const card = TEMPLATE_ARCH_CARDS.find((c) => c.id === cardId);
  const layer = card ? TEMPLATE_ARCH_LAYERS[card.layer] : null;
  const detail = CARD_DETAILS[cardId];
  if (!card || !layer) return null;
  // Compute upstream + downstream neighbors
  const upstream = TEMPLATE_ARCH_EDGES.filter((e) => e.to === cardId).map((e) => e.from);
  const downstream = TEMPLATE_ARCH_EDGES.filter((e) => e.from === cardId).map((e) => e.to);
  const archContent = ARCH_CONTENT[cardId];
  const w = CARD_WEATHER[cardId];
  return (
    <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◯ Card detail · click-to-inspect</Eyebrow>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-[16px]" style={{ color: layer.color }}>{card.glyph}</span>
            <span className="text-[15px] font-semibold text-slate-900">{card.label}</span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ background: `${layer.color}1a`, color: layer.color }}>
              L{card.layer} · {layer.label}
            </span>
            {card.status && card.status !== "wired" && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${card.status === "partial" ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"}`}>
                {card.status === "partial" ? "⚠ partial" : "✗ missing"}
              </span>
            )}
          </div>
          {card.hint && (
            <div className="mt-1 font-mono text-[10px] tabular-nums text-slate-500">{card.hint}</div>
          )}
        </div>
        <button onClick={onClose} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50">✕ close</button>
      </div>

      {/* Always render: large inline visualization + lens variants + neighbors + weather */}
      <div className="mt-5 grid grid-cols-[1fr_360px] gap-6">
        {/* Left: large inline content + lens variants */}
        <div>
          <div className="rounded-lg border border-slate-200/60 bg-slate-50/30 p-4">
            <Eyebrow>◫ Inline visualization</Eyebrow>
            <div className="mt-3 min-h-[240px]">
              <FullCardContent cardId={cardId} lensColor={layer.color} layerColor={layer.color} />
            </div>
          </div>

          {/* Per-objective variants */}
          <div className="mt-4 rounded-lg border border-slate-200/60 bg-white p-4">
            <Eyebrow>◐ Across all 7 objective lenses</Eyebrow>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {OBJECTIVE_LENSES.map((o) => {
                const slot = archContent?.[o.key];
                return (
                  <div key={o.key} className={`rounded-md p-2.5 ${slot ? "bg-slate-50/60" : "bg-slate-50/20"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px]" style={{ color: o.color }}>{o.glyph}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: o.color }}>{o.label}</span>
                      <span className="ml-auto text-[9px] italic text-slate-400">{o.ask}</span>
                    </div>
                    {slot ? (
                      <>
                        <div className="mt-1 font-mono text-[12px] font-semibold tabular-nums text-slate-900">{slot[0]}</div>
                        <div className="text-[10px] tabular-nums text-slate-500">{slot[1]}</div>
                      </>
                    ) : (
                      <div className="mt-1 text-[10px] italic tabular-nums text-slate-400">not relevant in this lens</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: neighbors + weather + status */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200/60 bg-white p-4">
            <Eyebrow>↧ Upstream feeds</Eyebrow>
            <div className="mt-2 text-[10px] tabular-nums text-slate-500">{upstream.length} cards feed into this</div>
            <div className="mt-2 space-y-1">
              {upstream.length === 0 && <div className="text-[10px] italic text-slate-400">— no upstream sources</div>}
              {upstream.map((id) => {
                const n = TEMPLATE_ARCH_CARDS.find((c) => c.id === id);
                if (!n) return null;
                const nLayer = TEMPLATE_ARCH_LAYERS[n.layer];
                return (
                  <div key={id} className="flex items-baseline gap-1.5 rounded bg-slate-50/40 px-2 py-1 text-[10px]">
                    <span className="font-mono" style={{ color: nLayer.color }}>{n.glyph}</span>
                    <span className="flex-1 truncate text-slate-700">{n.label}</span>
                    <span className="font-mono text-[8px] tabular-nums text-slate-400">L{n.layer}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/60 bg-white p-4">
            <Eyebrow>↥ Downstream consumers</Eyebrow>
            <div className="mt-2 text-[10px] tabular-nums text-slate-500">{downstream.length} cards consume this</div>
            <div className="mt-2 space-y-1">
              {downstream.length === 0 && <div className="text-[10px] italic text-slate-400">— no downstream</div>}
              {downstream.map((id) => {
                const n = TEMPLATE_ARCH_CARDS.find((c) => c.id === id);
                if (!n) return null;
                const nLayer = TEMPLATE_ARCH_LAYERS[n.layer];
                return (
                  <div key={id} className="flex items-baseline gap-1.5 rounded bg-slate-50/40 px-2 py-1 text-[10px]">
                    <span className="font-mono" style={{ color: nLayer.color }}>{n.glyph}</span>
                    <span className="flex-1 truncate text-slate-700">{n.label}</span>
                    <span className="font-mono text-[8px] tabular-nums text-slate-400">L{n.layer}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {w && (
            <div className="rounded-lg border border-slate-200/60 bg-white p-4">
              <Eyebrow>◔ Health signals</Eyebrow>
              <div className="mt-2 space-y-1.5">
                {[
                  { l: "Freshness", v: w.fresh },
                  { l: "Coverage", v: w.cov },
                  { l: "Confidence", v: w.conf },
                ].map((s) => (
                  <div key={s.l} className="flex items-center gap-2 text-[10px]">
                    <span className="w-20 text-slate-700">{s.l}</span>
                    <div className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${s.v * 100}%`, background: weatherColor(s.v) }} />
                    </div>
                    <span className="font-mono tabular-nums" style={{ color: weatherColor(s.v) }}>{s.v.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Codebase deep-dive (only when CARD_DETAILS has entry) */}
      {detail && (
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200/60 bg-slate-50/40 p-4">
            <div className="flex items-center gap-2"><Chip kind="ci">CURRENT</Chip><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">static mock</span></div>
            <div className="mt-2 text-[12px] font-semibold text-slate-900">What it shows now</div>
            <ul className="mt-2.5 space-y-1.5">
              {detail.current.map((c, i) => <li key={i} className="text-[11px] leading-snug text-slate-600">• {c}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border p-4" style={{ background: "#06B6D408", borderColor: "#06B6D433" }}>
            <div className="flex items-center gap-2"><Chip kind="data">CODEBASE</Chip><span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700">production data</span></div>
            <div className="mt-2 text-[12px] font-semibold text-slate-900">What's actually generated</div>
            <div className="mt-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Tables</div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {detail.codebase.tables.map((t) => <span key={t} className="rounded bg-cyan-50 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-cyan-700 ring-1 ring-cyan-200">{t}</span>)}
              </div>
            </div>
            {detail.codebase.key_fields && (
              <div className="mt-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Key fields</div>
                <ul className="mt-0.5 space-y-0.5">
                  {detail.codebase.key_fields.map((f, i) => <li key={i} className="font-mono text-[9px] leading-snug tabular-nums text-slate-600">{f}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-2.5">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Producers</div>
              <ul className="mt-0.5 space-y-0.5">
                {detail.codebase.producers.map((p, i) => <li key={i} className="font-mono text-[10px] leading-snug tabular-nums text-slate-700">{p}</li>)}
              </ul>
            </div>
          </div>
          <div className="rounded-lg border p-4" style={{ background: "#7C3AED08", borderColor: "#7C3AED33" }}>
            <div className="flex items-center gap-2"><Chip kind="model">IDEAL</Chip><span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">target state</span></div>
            <div className="mt-2 text-[12px] font-semibold text-slate-900">What it should show</div>
            <ul className="mt-2.5 space-y-1.5">
              {detail.ideal.map((d, i) => <li key={i} className="text-[11px] leading-snug text-slate-600">+ {d}</li>)}
            </ul>
            {detail.long_form_section && (
              <div className="mt-3 border-t border-violet-200/40 pt-2 text-[10px] tabular-nums text-violet-700">
                ↓ Live in zone: <span className="font-mono">{detail.long_form_section}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Use-case presets — pre-curated card subsets for specialized research workflows.
type PresetKey = "all" | "discovery" | "simulation" | "deviation" | "biomarker" | "assessment" | "twin_modeling";

const USE_CASE_PRESETS: {
  key: PresetKey;
  label: string;
  glyph: string;
  blurb: string;
  outputs: string;
  prominent: string[];
  secondary: string[];
  lens: ObjectiveKey;
  color: string;
}[] = [
  { key: "all", label: "All cards", glyph: "⊞", blurb: "Every card surfaced equally — generic system overview.", outputs: "Full system map · 37 cards · 51 data-flow edges", prominent: [], secondary: [], lens: "orient", color: "#94A3B8" },
  { key: "discovery", label: "Hidden pattern discovery", glyph: "✦", blurb: "Detect relationships missed by variable-by-variable analysis. Surfaces cycles, bridges, discordances, convergent points.", outputs: "Pattern map · candidate mechanisms · variable interactions · recommended follow-ups", prominent: ["kg_graph", "multi_lenses", "hidden_insights", "variance_decomp", "synthesis_decomp", "research_orchestration", "proposal_funnel"], secondary: ["temporal_atlas", "calib_cascade", "decay_kinetics", "kg_overview"], lens: "explore", color: "#EC4899" },
  { key: "simulation", label: "Protocol simulation", glyph: "⚡", blurb: "Model intervention logic, baselines, and expected outcomes before a study runs.", outputs: "Predicted outcome distributions · missing-variable alerts · protocol risk areas · measurement priorities", prominent: ["subjects", "trajectory", "twin", "prediction_fan", "interv_dag", "dose_response", "action_plan", "recovery_curves"], secondary: ["master_bottleneck", "vuln_matrix", "apps_portfolio", "objective_intake"], lens: "predict", color: "#7C3AED" },
  { key: "deviation", label: "Deviation analysis", glyph: "↻", blurb: "Compare expected vs observed outcomes. Explain weak, opposite, heterogeneous, or subgroup-specific effects.", outputs: "Deviation report · subgroup hypotheses · confounder candidates · pattern library updates", prominent: ["calib_scatter", "edge_drift", "reality_calib", "hidden_insights", "forest_plot", "prediction_fan", "baseline_delta"], secondary: ["synthesis_decomp", "variance_decomp", "calib_cascade", "loop_burndown"], lens: "calibrate", color: "#F59E0B" },
  { key: "biomarker", label: "Wearable / biomarker", glyph: "◴", blurb: "Connect low-friction signals (sleep, HRV, activity, respiration) to cognition and biological mechanisms.", outputs: "Biometric–cognition maps · proxy indicators · real-world monitoring logic · signal priorities", prominent: ["kg_graph", "temporal_atlas", "csv_drop", "recovery_curves", "decay_kinetics", "forest_plot", "ingestion_pipeline"], secondary: ["subjects", "ref_domains", "hidden_insights", "edge_drift"], lens: "explore", color: "#0EA5E9" },
  { key: "assessment", label: "Cognitive assessment refinement", glyph: "✓", blurb: "Distinguish whether test performance reflects target cognitive domain or confounders (attention, fatigue, stress, engagement).", outputs: "Assessment weakness map · measurement recommendations · adaptive testing logic", prominent: ["ref_domains", "variance_decomp", "calib_cascade", "apps_portfolio", "twin", "forest_plot"], secondary: ["subjects", "vuln_matrix", "kg_graph", "intake_review"], lens: "diagnose", color: "#10B981" },
  { key: "twin_modeling", label: "Subject-level digital twin", glyph: "◯", blurb: "Each participant as a structured biological-cognitive profile with baseline, measurements, predicted response, and deviation history.", outputs: "Subject profile · personalized prediction · subgroup clustering · intervention matching", prominent: ["subjects", "twin", "trajectory", "vuln_matrix", "prediction_fan", "recovery_curves", "action_plan"], secondary: ["temporal_atlas", "calib_scatter", "intake_review", "objective_intake"], lens: "predict", color: "#1E293B" },
];

// Per-card weather data — freshness/coverage/confidence per surface
// Defaults wired from real codebase signals: cards backed by recent data are
// fresh, cards with rich edges have high coverage, cards with τ²-narrowed
// posteriors have high confidence.
const CARD_WEATHER: Record<string, { fresh: number; cov: number; conf: number }> = {
  template_select: { fresh: 1.0, cov: 1.0, conf: 1.0 },
  objective_intake: { fresh: 0.92, cov: 0.85, conf: 0.78 },
  seed_materialize: { fresh: 1.0, cov: 1.0, conf: 0.95 },
  edge_augmenter: { fresh: 0.88, cov: 0.65, conf: 0.72 },
  ingestion_pipeline: { fresh: 0.94, cov: 0.91, conf: 0.88 },
  research_orchestration: { fresh: 0.81, cov: 0.74, conf: 0.69 },
  synthesis_decomp: { fresh: 0.86, cov: 0.82, conf: 0.74 },
  strategy_twin: { fresh: 0.74, cov: 0.71, conf: 0.79 },
  intake_review: { fresh: 0.62, cov: 0.85, conf: 0.81 },
  csv_drop: { fresh: 0.55, cov: 0.40, conf: 0.62 },
  kg_overview: { fresh: 0.92, cov: 0.88, conf: 0.91 },
  kg_graph: { fresh: 0.88, cov: 0.84, conf: 0.85 },
  multi_lenses: { fresh: 0.92, cov: 0.84, conf: 0.85 },
  subjects: { fresh: 0.81, cov: 0.62, conf: 0.78 },
  vuln_matrix: { fresh: 0.74, cov: 0.78, conf: 0.81 },
  ref_domains: { fresh: 0.88, cov: 0.95, conf: 0.91 },
  app_materializer: { fresh: 0.78, cov: 0.71, conf: 0.84 },
  master_bottleneck: { fresh: 0.84, cov: 0.92, conf: 0.88 },
  temporal_atlas: { fresh: 0.78, cov: 0.62, conf: 0.71 },
  decay_kinetics: { fresh: 0.62, cov: 0.55, conf: 0.65 },
  recovery_curves: { fresh: 0.84, cov: 0.91, conf: 0.88 },
  apps_portfolio: { fresh: 0.71, cov: 0.62, conf: 0.78 },
  interv_dag: { fresh: 0.78, cov: 0.71, conf: 0.78 },
  dose_response: { fresh: 0.81, cov: 0.84, conf: 0.85 },
  agent_fleet: { fresh: 0.72, cov: 0.55, conf: 0.71 },
  app_tether: { fresh: 0.34, cov: 0.21, conf: 0.41 },
  hidden_insights: { fresh: 0.78, cov: 0.75, conf: 0.71 },
  variance_decomp: { fresh: 0.84, cov: 0.91, conf: 0.85 },
  calib_cascade: { fresh: 0.81, cov: 0.88, conf: 0.91 },
  forest_plot: { fresh: 0.84, cov: 0.91, conf: 0.88 },
  hypothesis_ladders: { fresh: 0.71, cov: 0.65, conf: 0.62 },
  argument_tribunal: { fresh: 0.62, cov: 0.45, conf: 0.51 },
  cycle_break_planner: { fresh: 0.81, cov: 0.74, conf: 0.78 },
  trajectory: { fresh: 0.78, cov: 0.81, conf: 0.85 },
  twin: { fresh: 0.84, cov: 0.78, conf: 0.81 },
  prediction_fan: { fresh: 0.81, cov: 0.74, conf: 0.78 },
  action_plan: { fresh: 0.62, cov: 0.71, conf: 0.84 },
  metric_observations: { fresh: 0.94, cov: 0.65, conf: 0.78 },
  app_outcomes: { fresh: 0.78, cov: 0.74, conf: 0.81 },
  prediction_resolver: { fresh: 0.71, cov: 0.62, conf: 0.84 },
  lab_scaffold: { fresh: 0.18, cov: 0.12, conf: 0.31 },
  calib_scatter: { fresh: 0.81, cov: 0.62, conf: 0.78 },
  edge_drift: { fresh: 0.74, cov: 0.71, conf: 0.71 },
  reality_calib: { fresh: 0.62, cov: 0.55, conf: 0.65 },
  loop_burndown: { fresh: 0.71, cov: 0.84, conf: 0.78 },
  baseline_delta: { fresh: 0.78, cov: 0.91, conf: 0.85 },
  loop_recorder: { fresh: 0.18, cov: 0.12, conf: 0.31 },
  intel_radar: { fresh: 0.78, cov: 0.84, conf: 0.81 },
  proposal_funnel: { fresh: 0.71, cov: 0.78, conf: 0.74 },
  discovery_auto_propose: { fresh: 0.32, cov: 0.41, conf: 0.55 },
};

const STAKEHOLDERS = [
  { key: "all" as const, label: "All", glyph: "◯", color: "#94A3B8", focus: [] as string[] },
  { key: "clinician" as const, label: "Clinician", glyph: "✚", color: "#10B981", focus: ["action_plan", "apps_portfolio", "trajectory", "subjects", "ref_domains", "interv_dag", "dose_response", "intake_review"] },
  { key: "researcher" as const, label: "Researcher", glyph: "≡", color: "#7C3AED", focus: ["ingestion_pipeline", "research_orchestration", "synthesis_decomp", "hypothesis_ladders", "forest_plot", "argument_tribunal", "calib_cascade", "variance_decomp"] },
  { key: "patient" as const, label: "Patient", glyph: "◉", color: "#0EA5E9", focus: ["subjects", "trajectory", "action_plan", "twin", "metric_observations", "app_outcomes", "objective_intake"] },
  { key: "payer" as const, label: "Payer", glyph: "◎", color: "#F59E0B", focus: ["apps_portfolio", "interv_dag", "action_plan", "reality_calib", "baseline_delta", "loop_burndown", "intel_radar"] },
];

type StakeholderKey = (typeof STAKEHOLDERS)[number]["key"];
type WeatherDim = "off" | "fresh" | "cov" | "conf";

function weatherColor(v: number): string {
  if (v >= 0.75) return "#10B981";
  if (v >= 0.55) return "#F59E0B";
  return "#EF4444";
}

function weatherGlyph(v: number): string {
  if (v >= 0.75) return "☀";
  if (v >= 0.55) return "☁";
  return "⛈";
}

// ─────────────────────────────────────────────────────────────────────────
// KG Flow Sankey — Mode 2 of the Architecture card
// Diamond-shaped drill-Sankey: input (narrow) → intake → KG (wide) →
// hypotheses → strategies (narrow). Column heights vary with total count
// so the diamond/dilation shape emerges naturally.
// ─────────────────────────────────────────────────────────────────────────

type SankeyBand = {
  id: string;
  label: string;
  count: number;
  userPortion: number; // 0..1 — left-edge stripe blue (user) vs violet (agent)
  detail?: string;
};

type SankeyStage = {
  id: string;
  label: string;
  sublabel: string;
  color: string;
  bands: SankeyBand[];
};

type SankeyFlow = {
  from: string; // band id
  to: string;
  count: number;
};

const SANKEY_STAGES: SankeyStage[] = [
  {
    id: "input",
    label: "Input",
    sublabel: "3 sources · 1 user · 2 agent",
    color: "#3b82f6", // blue
    bands: [
      { id: "in_prompt", label: "User prompt", count: 1, userPortion: 1.0, detail: "12mo improvement goal" },
      { id: "in_pdfs", label: "Dropped PDFs", count: 8, userPortion: 1.0, detail: "literature uploads" },
      { id: "in_research", label: "Research", count: 12, userPortion: 0.0, detail: "agent web orchestration" },
    ],
  },
  {
    id: "intake",
    label: "Intake",
    sublabel: "63 ent · 23 edges",
    color: "#06b6d4", // cyan
    bands: [
      { id: "ik_subjects", label: "Subjects", count: 4, userPortion: 0.5 },
      { id: "ik_ivs", label: "IV variables", count: 6, userPortion: 0.5 },
      { id: "ik_entities", label: "Entities", count: 60, userPortion: 0.4 },
      { id: "ik_edges", label: "Edges", count: 23, userPortion: 0.3 },
    ],
  },
  {
    id: "kg",
    label: "KG state",
    sublabel: "248 ent · 511 edges · 4 cycles",
    color: "#6366f1", // indigo
    bands: [
      { id: "kg_entities", label: "Entities", count: 248, userPortion: 0.18 },
      { id: "kg_edges", label: "Edges", count: 80, userPortion: 0.10, detail: "511 total · top 80 by weight" },
      { id: "kg_cycles", label: "Cycles", count: 8, userPortion: 0.0 },
      { id: "kg_bridges", label: "Bridges", count: 12, userPortion: 0.0 },
    ],
  },
  {
    id: "hypothesis",
    label: "Hypotheses",
    sublabel: "24 candidates · 8 active",
    color: "#8b5cf6", // violet
    bands: [
      { id: "hyp_active", label: "Active", count: 8, userPortion: 0.45, detail: "carry forward" },
      { id: "hyp_deferred", label: "Deferred", count: 12, userPortion: 0.20, detail: "needs more evidence" },
      { id: "hyp_pruned", label: "Pruned", count: 4, userPortion: 0.0, detail: "low calibration" },
    ],
  },
  {
    id: "strategy",
    label: "Strategies",
    sublabel: "3 ranked · 2 alt · 3 rejected",
    color: "#f97316", // orange — the waist
    bands: [
      // Band counts = supporting evidence units (so ribbons are visible at the waist)
      { id: "st_a", label: "Strategy A · 0.82", count: 6, userPortion: 0.5, detail: "concentrative · top-ranked" },
      { id: "st_b", label: "Strategy B · 0.74", count: 5, userPortion: 0.4, detail: "diffuse · runner-up" },
      { id: "st_c", label: "Strategy C · 0.61", count: 4, userPortion: 0.3, detail: "rebound posture" },
      { id: "st_alt", label: "Alternatives", count: 5, userPortion: 0.2, detail: "2 strategies on hold" },
      { id: "st_rej", label: "Rejected", count: 4, userPortion: 0.0, detail: "3 ruled out" },
    ],
  },
  {
    id: "apps",
    label: "Apps",
    sublabel: "8 apps · 5 types",
    color: "#10b981", // emerald — operational fan-out begins
    bands: [
      // Apps clustered by app_type (from /src/types/app.ts)
      { id: "app_dashboard", label: "Dashboards", count: 8, userPortion: 0.25, detail: "3 apps · health + signals" },
      { id: "app_workflow", label: "Workflows", count: 6, userPortion: 0.30, detail: "2 apps · DAG steps" },
      { id: "app_tool", label: "Tools", count: 6, userPortion: 0.20, detail: "2 apps · single-action" },
      { id: "app_monitor", label: "Monitors", count: 4, userPortion: 0.10, detail: "1 app · drift watch" },
      { id: "app_integration", label: "Integrations", count: 4, userPortion: 0.20, detail: "wearables · APIs" },
    ],
  },
  {
    id: "interventions",
    label: "Interventions",
    sublabel: "33 features · 5 actions",
    color: "#14b8a6", // teal — fan-out continues
    bands: [
      // Interventions clustered by infrastructure_action (from /src/types/intervention.ts)
      { id: "iv_build", label: "Build", count: 11, userPortion: 0.20 },
      { id: "iv_strengthen", label: "Strengthen", count: 9, userPortion: 0.30 },
      { id: "iv_connect", label: "Connect", count: 6, userPortion: 0.20 },
      { id: "iv_monitor", label: "Monitor", count: 4, userPortion: 0.10 },
      { id: "iv_configure", label: "Configure", count: 3, userPortion: 0.40, detail: "if-then implementation" },
    ],
  },
  {
    id: "outcomes",
    label: "Outcomes",
    sublabel: "predictions · metrics · signals",
    color: "#0ea5e9", // sky — widest tail
    bands: [
      { id: "ot_predictions", label: "Predictions", count: 14, userPortion: 0.05, detail: "prediction_ledger rows" },
      { id: "ot_metrics", label: "Metric obs", count: 12, userPortion: 0.10, detail: "tracker write-backs" },
      { id: "ot_signals", label: "Agent signals", count: 9, userPortion: 0.0, detail: "recent_signals[]" },
      { id: "ot_health", label: "Health rollups", count: 8, userPortion: 0.0, detail: "per-app score" },
    ],
  },
];

const SANKEY_FLOWS: SankeyFlow[] = [
  // ── Input → Intake ──────────────────────────────────────────────
  { from: "in_prompt", to: "ik_subjects", count: 1 },
  { from: "in_pdfs", to: "ik_entities", count: 5 },
  { from: "in_pdfs", to: "ik_edges", count: 3 },
  { from: "in_research", to: "ik_entities", count: 8 },
  { from: "in_research", to: "ik_edges", count: 4 },
  // ── Intake → KG ─────────────────────────────────────────────────
  { from: "ik_subjects", to: "kg_entities", count: 4 },
  { from: "ik_ivs", to: "kg_entities", count: 6 },
  { from: "ik_entities", to: "kg_entities", count: 50 },
  { from: "ik_edges", to: "kg_edges", count: 20 },
  // ── KG → Hypothesis ─────────────────────────────────────────────
  { from: "kg_entities", to: "hyp_active", count: 5 },
  { from: "kg_entities", to: "hyp_deferred", count: 8 },
  { from: "kg_entities", to: "hyp_pruned", count: 2 },
  { from: "kg_edges", to: "hyp_active", count: 2 },
  { from: "kg_edges", to: "hyp_deferred", count: 3 },
  { from: "kg_edges", to: "hyp_pruned", count: 1 },
  { from: "kg_cycles", to: "hyp_active", count: 1 },
  { from: "kg_bridges", to: "hyp_deferred", count: 1 },
  { from: "kg_bridges", to: "hyp_pruned", count: 1 },
  // ── Hypothesis → Strategy (the waist — convergent narrowing) ────
  { from: "hyp_active", to: "st_a", count: 3 },
  { from: "hyp_active", to: "st_b", count: 2 },
  { from: "hyp_active", to: "st_c", count: 2 },
  { from: "hyp_active", to: "st_alt", count: 1 },
  { from: "hyp_deferred", to: "st_a", count: 3 },
  { from: "hyp_deferred", to: "st_b", count: 3 },
  { from: "hyp_deferred", to: "st_c", count: 2 },
  { from: "hyp_deferred", to: "st_alt", count: 3 },
  { from: "hyp_deferred", to: "st_rej", count: 1 },
  { from: "hyp_pruned", to: "st_alt", count: 1 },
  { from: "hyp_pruned", to: "st_rej", count: 3 },
  // ── Strategy → Apps (divergent fan-out begins) ─────────────────
  { from: "st_a", to: "app_dashboard", count: 3 },
  { from: "st_a", to: "app_workflow", count: 2 },
  { from: "st_a", to: "app_tool", count: 1 },
  { from: "st_b", to: "app_dashboard", count: 2 },
  { from: "st_b", to: "app_workflow", count: 2 },
  { from: "st_b", to: "app_tool", count: 1 },
  { from: "st_c", to: "app_dashboard", count: 1 },
  { from: "st_c", to: "app_tool", count: 2 },
  { from: "st_c", to: "app_integration", count: 1 },
  { from: "st_alt", to: "app_dashboard", count: 2 },
  { from: "st_alt", to: "app_monitor", count: 2 },
  { from: "st_alt", to: "app_integration", count: 1 },
  { from: "st_rej", to: "app_workflow", count: 2 },
  { from: "st_rej", to: "app_monitor", count: 2 },
  // ── Apps → Interventions (each app houses 2-8 interventions) ────
  { from: "app_dashboard", to: "iv_build", count: 3 },
  { from: "app_dashboard", to: "iv_strengthen", count: 3 },
  { from: "app_dashboard", to: "iv_monitor", count: 2 },
  { from: "app_workflow", to: "iv_build", count: 3 },
  { from: "app_workflow", to: "iv_connect", count: 2 },
  { from: "app_workflow", to: "iv_configure", count: 1 },
  { from: "app_tool", to: "iv_strengthen", count: 3 },
  { from: "app_tool", to: "iv_build", count: 2 },
  { from: "app_tool", to: "iv_configure", count: 1 },
  { from: "app_monitor", to: "iv_monitor", count: 2 },
  { from: "app_monitor", to: "iv_strengthen", count: 1 },
  { from: "app_monitor", to: "iv_connect", count: 1 },
  { from: "app_integration", to: "iv_connect", count: 3 },
  { from: "app_integration", to: "iv_build", count: 1 },
  // ── Interventions → Outcomes (operational tail) ─────────────────
  { from: "iv_build", to: "ot_predictions", count: 5 },
  { from: "iv_build", to: "ot_metrics", count: 4 },
  { from: "iv_build", to: "ot_signals", count: 2 },
  { from: "iv_strengthen", to: "ot_metrics", count: 4 },
  { from: "iv_strengthen", to: "ot_predictions", count: 3 },
  { from: "iv_strengthen", to: "ot_health", count: 2 },
  { from: "iv_connect", to: "ot_signals", count: 3 },
  { from: "iv_connect", to: "ot_health", count: 2 },
  { from: "iv_connect", to: "ot_predictions", count: 1 },
  { from: "iv_monitor", to: "ot_signals", count: 2 },
  { from: "iv_monitor", to: "ot_metrics", count: 1 },
  { from: "iv_monitor", to: "ot_health", count: 1 },
  { from: "iv_configure", to: "ot_predictions", count: 1 },
  { from: "iv_configure", to: "ot_metrics", count: 1 },
  { from: "iv_configure", to: "ot_signals", count: 2 },
  { from: "iv_configure", to: "ot_health", count: 3 },
];

// Stage progression timing — used by the time scrubber to show partial KG state
// 8 stages now: input, intake, kg, hypothesis, strategy, apps, interventions, outcomes
const STAGE_T_THRESHOLDS = [0.0, 0.08, 0.22, 0.42, 0.55, 0.65, 0.78, 0.88];
const STAGE_T_RAMP = 0.08; // ramp-up duration

function sankeyStageProgress(stageIdx: number, scrubT: number): number {
  const start = STAGE_T_THRESHOLDS[stageIdx];
  const t = (scrubT - start) / STAGE_T_RAMP;
  return Math.max(0, Math.min(1, t));
}

function KGFlowSankey({ scrubT, onPickStage }: { scrubT: number; onPickStage?: (stageId: string) => void }) {
  const [hoveredFlow, setHoveredFlow] = useState(null as number | null);
  const [hoveredBand, setHoveredBand] = useState(null as string | null);

  // Layout constants — wider for 8 stages with comfortable label space
  const W = 1640;
  const H = 520;
  const PAD_X = 60;
  const PAD_TOP = 60;
  const PAD_BOT = 56;
  const BAND_W = 16;
  const NCOLS = SANKEY_STAGES.length;
  const COL_GAP = (W - 2 * PAD_X - BAND_W * NCOLS) / (NCOLS - 1);
  const usableH = H - PAD_TOP - PAD_BOT;

  // Apply scrubT to all band counts
  const liveStages = SANKEY_STAGES.map((stage, i) => {
    const p = sankeyStageProgress(i, scrubT);
    return {
      ...stage,
      bands: stage.bands.map((b) => ({ ...b, count: Math.round(b.count * p) })),
      progress: p,
    };
  });

  // Compute total count per stage
  const stageTotals = liveStages.map((s) => s.bands.reduce((a, b) => a + b.count, 0));
  const maxTotal = Math.max(1, ...stageTotals);

  // Compute band positions
  type BandPos = { x: number; y0: number; y1: number; color: string; band: SankeyBand; stageIdx: number };
  const positions: Record<string, BandPos> = {};

  liveStages.forEach((stage, i) => {
    const total = stageTotals[i];
    const stageH = (total / maxTotal) * usableH;
    const startY = PAD_TOP + (usableH - stageH) / 2;
    const x = PAD_X + i * (BAND_W + COL_GAP);
    const bandPad = 4;
    const usable = Math.max(0, stageH - bandPad * Math.max(0, stage.bands.length - 1));
    let cy = startY;
    stage.bands.forEach((b) => {
      const h = total > 0 ? (b.count / total) * usable : 0;
      positions[b.id] = { x, y0: cy, y1: cy + h, color: stage.color, band: b, stageIdx: i };
      cy += h + bandPad;
    });
  });

  // Compute flow ribbons
  const sourceCursors: Record<string, number> = {};
  const targetCursors: Record<string, number> = {};
  Object.keys(positions).forEach((id) => {
    sourceCursors[id] = positions[id].y0;
    targetCursors[id] = positions[id].y0;
  });

  const flowRibbons = SANKEY_FLOWS.map((flow, idx) => {
    const sp = positions[flow.from];
    const tp = positions[flow.to];
    if (!sp || !tp) return null;
    const sBand = sp.band;
    const tBand = tp.band;
    if (sBand.count <= 0 || tBand.count <= 0) return null;
    const sFrac = flow.count / Math.max(1, SANKEY_STAGES.flatMap((s) => s.bands).find((b) => b.id === flow.from)!.count);
    const tFrac = flow.count / Math.max(1, SANKEY_STAGES.flatMap((s) => s.bands).find((b) => b.id === flow.to)!.count);
    const sH = (sp.y1 - sp.y0);
    const tH = (tp.y1 - tp.y0);
    const sFlowH = sFrac * sH;
    const tFlowH = tFrac * tH;
    if (sFlowH < 0.5 || tFlowH < 0.5) return null;
    const sY0 = sourceCursors[flow.from];
    const sY1 = sY0 + sFlowH;
    sourceCursors[flow.from] = sY1;
    const tY0 = targetCursors[flow.to];
    const tY1 = tY0 + tFlowH;
    targetCursors[flow.to] = tY1;
    const sX = sp.x + BAND_W;
    const tX = tp.x;
    const cp1x = sX + (tX - sX) * 0.5;
    const cp2x = tX - (tX - sX) * 0.5;
    const path = `M ${sX} ${sY0} C ${cp1x} ${sY0}, ${cp2x} ${tY0}, ${tX} ${tY0} L ${tX} ${tY1} C ${cp2x} ${tY1}, ${cp1x} ${sY1}, ${sX} ${sY1} Z`;
    return { idx, flow, path, sourceColor: sp.color, targetColor: tp.color, midY: (sY0 + sY1 + tY0 + tY1) / 4, midX: (sX + tX) / 2 };
  }).filter(Boolean) as Array<{ idx: number; flow: SankeyFlow; path: string; sourceColor: string; targetColor: string; midY: number; midX: number }>;

  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200/60 bg-gradient-to-b from-white to-slate-50/40 p-4">
      <svg width={W} height={H} className="block" style={{ minWidth: W }}>
        <defs>
          {liveStages.map((stage, i) => {
            const next = liveStages[i + 1];
            if (!next) return null;
            return (
              <linearGradient key={`grad-${i}`} id={`sankey-grad-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={stage.color} stopOpacity="0.55" />
                <stop offset="100%" stopColor={next.color} stopOpacity="0.55" />
              </linearGradient>
            );
          })}
          {liveStages.map((stage, i) => {
            const next = liveStages[i + 1];
            if (!next) return null;
            return (
              <linearGradient key={`grad-hi-${i}`} id={`sankey-grad-hi-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={stage.color} stopOpacity="0.85" />
                <stop offset="100%" stopColor={next.color} stopOpacity="0.85" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Stage column headers */}
        {liveStages.map((stage, i) => {
          const x = PAD_X + i * (BAND_W + COL_GAP);
          const isFirst = i === 0;
          const isLast = i === liveStages.length - 1;
          return (
            <g key={`hdr-${stage.id}`}>
              <text x={x + BAND_W / 2} y={22} textAnchor="middle" fontSize="11" fontWeight={700} fill="#0a1020">
                {!isFirst && <tspan dx="-30" fill="#94a3b8" style={{ cursor: "pointer" }}>‹ </tspan>}
                {stage.label}
                {!isLast && <tspan dx="2" fill="#94a3b8" style={{ cursor: "pointer" }}> ›</tspan>}
              </text>
              <text x={x + BAND_W / 2} y={36} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily='"SF Mono", ui-monospace, monospace'>
                {stage.sublabel}
              </text>
              <text x={x + BAND_W / 2} y={48} textAnchor="middle" fontSize="8" fill="#94a3b8" fontFamily='"SF Mono", ui-monospace, monospace'>
                {Math.round(sankeyStageProgress(i, scrubT) * 100)}%
              </text>
            </g>
          );
        })}

        {/* Flow ribbons */}
        {flowRibbons.map((r) => {
          const isHovered = hoveredFlow === r.idx;
          const isBandHovered = hoveredBand !== null && (r.flow.from === hoveredBand || r.flow.to === hoveredBand);
          const dimmed = (hoveredFlow !== null && !isHovered) || (hoveredBand !== null && !isBandHovered);
          const opacity = dimmed ? 0.08 : isHovered || isBandHovered ? 0.85 : 0.42;
          const sourceStageIdx = positions[r.flow.from].stageIdx;
          const fillId = isHovered || isBandHovered ? `sankey-grad-hi-${sourceStageIdx}` : `sankey-grad-${sourceStageIdx}`;
          return (
            <path
              key={r.idx}
              d={r.path}
              fill={`url(#${fillId})`}
              opacity={opacity}
              onMouseEnter={() => setHoveredFlow(r.idx)}
              onMouseLeave={() => setHoveredFlow(null)}
              style={{ cursor: "pointer", transition: "opacity 120ms ease" }}
            />
          );
        })}

        {/* Bands */}
        {Object.values(positions).map((p) => {
          if (p.band.count <= 0) return null;
          const h = p.y1 - p.y0;
          if (h < 1) return null;
          const isHovered = hoveredBand === p.band.id;
          const stripeH = h * p.band.userPortion;
          return (
            <g
              key={p.band.id}
              onMouseEnter={() => setHoveredBand(p.band.id)}
              onMouseLeave={() => setHoveredBand(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Main band rect */}
              <rect x={p.x} y={p.y0} width={BAND_W} height={h} fill={p.color} rx={2} ry={2} />
              {/* User-portion stripe (blue overlay on left edge) */}
              {stripeH > 0.5 && (
                <rect x={p.x} y={p.y0} width={3} height={stripeH} fill="#1d4ed8" />
              )}
              {/* Agent-portion stripe (violet on bottom of left edge) */}
              {h - stripeH > 0.5 && (
                <rect x={p.x} y={p.y0 + stripeH} width={3} height={h - stripeH} fill="#7c3aed" />
              )}
              {/* Hover highlight */}
              {isHovered && (
                <rect x={p.x - 2} y={p.y0 - 2} width={BAND_W + 4} height={h + 4} fill="none" stroke="#0f172a" strokeWidth="1.5" rx={3} />
              )}
            </g>
          );
        })}

        {/* Band labels (right side of column for first 4, left for last) */}
        {Object.values(positions).map((p) => {
          if (p.band.count <= 0) return null;
          const h = p.y1 - p.y0;
          const cy = (p.y0 + p.y1) / 2;
          const isLast = p.stageIdx === NCOLS - 1;
          const labelX = isLast ? p.x - 8 : p.x + BAND_W + 8;
          const anchor = isLast ? "end" : "start";
          const showLabel = h >= 10;
          if (!showLabel) return null;
          const total = stageTotals[p.stageIdx];
          const pct = total > 0 ? (p.band.count / total) * 100 : 0;
          return (
            <g key={`lbl-${p.band.id}`} style={{ pointerEvents: "none" }}>
              <text x={labelX} y={cy - 3} fontSize="10.5" fontWeight={600} fill="#0a1020" textAnchor={anchor}>
                {p.band.label}
              </text>
              <text x={labelX} y={cy + 9} fontSize="9" fill="#64748b" fontFamily='"SF Mono", ui-monospace, monospace' textAnchor={anchor}>
                {p.band.count}
                <tspan dx="6" fill="#94a3b8">{pct.toFixed(0)}%</tspan>
              </text>
            </g>
          );
        })}

        {/* Hover tooltip — flow */}
        {hoveredFlow !== null && flowRibbons[hoveredFlow] && (() => {
          const r = flowRibbons[hoveredFlow];
          const fromBand = positions[r.flow.from].band;
          const toBand = positions[r.flow.to].band;
          const fromStage = SANKEY_STAGES.find((s) => s.bands.some((b) => b.id === r.flow.from))!;
          const toStage = SANKEY_STAGES.find((s) => s.bands.some((b) => b.id === r.flow.to))!;
          const totalFromStage = stageTotals[positions[r.flow.from].stageIdx] || 1;
          const pct = (r.flow.count / totalFromStage) * 100;
          const tipX = Math.min(W - 220, Math.max(10, r.midX - 110));
          const tipY = Math.max(10, r.midY - 56);
          return (
            <g style={{ pointerEvents: "none" }}>
              <rect x={tipX} y={tipY} width={220} height={48} rx={6} fill="white" stroke="#cbd5e1" strokeWidth="1" filter="url(#none)" />
              <text x={tipX + 10} y={tipY + 16} fontSize="9.5" fill="#475569" fontFamily='"SF Mono", ui-monospace, monospace'>
                {fromStage.label} → {toStage.label}
              </text>
              <text x={tipX + 10} y={tipY + 31} fontSize="11" fontWeight={600} fill="#0a1020">
                {fromBand.label} → {toBand.label}
              </text>
              <text x={tipX + 10} y={tipY + 43} fontSize="10" fill="#64748b" fontFamily='"SF Mono", ui-monospace, monospace'>
                <tspan fill="#0a1020" fontWeight={600}>{r.flow.count}</tspan>
                <tspan dx="4">·</tspan>
                <tspan dx="4" fill="#3b82f6" fontWeight={600}>{pct.toFixed(1)}%</tspan>
                <tspan dx="6">of {fromStage.label.toLowerCase()}</tspan>
              </text>
            </g>
          );
        })()}

        {/* Hover tooltip — band */}
        {hoveredBand !== null && positions[hoveredBand] && (() => {
          const p = positions[hoveredBand];
          const bandMidY = (p.y0 + p.y1) / 2;
          const stage = SANKEY_STAGES.find((s) => s.bands.some((b) => b.id === hoveredBand))!;
          const total = stageTotals[p.stageIdx] || 1;
          const pct = total > 0 ? (p.band.count / total) * 100 : 0;
          const isLast = p.stageIdx === NCOLS - 1;
          const outflows = SANKEY_FLOWS.filter((f) => f.from === hoveredBand).slice(0, 3);
          const hasDetail = Boolean(p.band.detail);
          const tipH = (hasDetail ? 104 : 90) + outflows.length * 14;
          const tipW = 248;
          const tipX = isLast
            ? Math.max(10, p.x - tipW - 14)
            : Math.min(W - tipW - 8, p.x + BAND_W + 14);
          const tipY = Math.max(10, Math.min(H - tipH - 10, bandMidY - tipH / 2));
          const barY = tipY + (hasDetail ? 70 : 57);
          const barW = tipW - 28;
          const uW = Math.round(barW * p.band.userPortion);
          const divY = barY + 17;
          const flowsY = divY + 8;
          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Drop shadow */}
              <rect x={tipX + 2} y={tipY + 3} width={tipW} height={tipH} rx={8} fill="rgba(15,23,42,0.07)" />
              {/* Card bg */}
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={8} fill="white" stroke="#e2e8f0" strokeWidth="1" />
              {/* Stage color stripe */}
              <rect x={tipX} y={tipY + 8} width={4} height={tipH - 16} fill={stage.color} opacity={0.85} rx={2} />
              {/* Stage label */}
              <text x={tipX + 14} y={tipY + 15} fontSize="8.5" fontWeight={700} fill={stage.color} fontFamily='"SF Mono", ui-monospace, monospace'>
                {stage.label.toUpperCase()}
              </text>
              {/* Band name */}
              <text x={tipX + 14} y={tipY + 30} fontSize="12.5" fontWeight={700} fill="#0a1020">
                {p.band.label}
              </text>
              {/* Count + % */}
              <text x={tipX + 14} y={tipY + 44} fontSize="9.5" fill="#64748b" fontFamily='"SF Mono", ui-monospace, monospace'>
                <tspan fill="#0f172a" fontWeight={600}>{p.band.count}</tspan>
                <tspan dx="5" fill="#3b82f6" fontWeight={600}>{pct.toFixed(0)}%</tspan>
                <tspan dx="5">of stage</tspan>
              </text>
              {/* Detail */}
              {hasDetail && (
                <text x={tipX + 14} y={tipY + 57} fontSize="9" fill="#94a3b8" fontFamily='"SF Mono", ui-monospace, monospace'>
                  {p.band.detail}
                </text>
              )}
              {/* User / agent split bar */}
              <rect x={tipX + 14} y={barY} width={barW} height={4} rx={2} fill="#f1f5f9" />
              {uW > 0 && <rect x={tipX + 14} y={barY} width={uW} height={4} rx={2} fill="#1d4ed8" opacity={0.75} />}
              {barW - uW > 0 && <rect x={tipX + 14 + uW} y={barY} width={barW - uW} height={4} rx={2} fill="#7c3aed" opacity={0.55} />}
              <text x={tipX + 14} y={barY + 13} fontSize="8" fill="#94a3b8" fontFamily='"SF Mono", ui-monospace, monospace'>
                {Math.round(p.band.userPortion * 100)}% user · {Math.round((1 - p.band.userPortion) * 100)}% agent
              </text>
              {/* Divider */}
              <line x1={tipX + 14} y1={divY} x2={tipX + tipW - 14} y2={divY} stroke="#f1f5f9" strokeWidth="1" />
              {/* Flows to */}
              {outflows.length === 0 ? (
                <text x={tipX + 14} y={flowsY + 11} fontSize="9" fill="#cbd5e1" fontFamily='"SF Mono", ui-monospace, monospace'>
                  Terminal · no downstream flows
                </text>
              ) : (
                <g>
                  <text x={tipX + 14} y={flowsY + 10} fontSize="8" fontWeight={700} fill="#94a3b8" fontFamily='"SF Mono", ui-monospace, monospace'>
                    FLOWS TO
                  </text>
                  {outflows.map((f, i) => {
                    const toPos = positions[f.to];
                    const toStage = toPos ? SANKEY_STAGES.find((s) => s.bands.some((b) => b.id === f.to)) : null;
                    if (!toPos || !toStage) return null;
                    return (
                      <g key={f.to}>
                        <circle cx={tipX + 19} cy={flowsY + 22 + i * 14} r={3} fill={toStage.color} opacity={0.85} />
                        <text x={tipX + 28} y={flowsY + 26 + i * 14} fontSize="9.5" fill="#0f172a">
                          {toPos.band.label}
                        </text>
                        <text x={tipX + tipW - 14} y={flowsY + 26 + i * 14} fontSize="9" fill="#64748b" fontFamily='"SF Mono", ui-monospace, monospace' textAnchor="end">
                          {f.count}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          );
        })()}
      </svg>

      {/* Legend + footnote */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-2 text-[10px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3" style={{ background: "#1d4ed8" }} />
            user contribution
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3" style={{ background: "#7c3aed" }} />
            agent contribution
          </span>
          <span className="text-slate-300">·</span>
          <span>left-edge stripe shows split per band</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Want to test alternative KG mechanisms?</span>
          <a
            href="/app/lab/insight-stacks"
            className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
          >
            → InsightLab
          </a>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Time scrubber — shared header across all view modes
// ─────────────────────────────────────────────────────────────────────────

function TimeScrubber({
  scrubT,
  setScrubT,
  granularity,
  setGranularity,
}: {
  scrubT: number;
  setScrubT: (n: number) => void;
  granularity: "all" | "stages" | "events";
  setGranularity: (g: "all" | "stages" | "events") => void;
}) {
  const stagePoints = [
    { id: "t0", label: "Prompt", t: 0.0 },
    { id: "t1", label: "Intake", t: 0.16 },
    { id: "t2", label: "KG", t: 0.32 },
    { id: "t3", label: "Hyps", t: 0.5 },
    { id: "t4", label: "Strategy", t: 0.62 },
    { id: "t5", label: "Apps", t: 0.74 },
    { id: "t6", label: "Intvs", t: 0.86 },
    { id: "t7", label: "Outcomes", t: 1.0 },
  ];
  return (
    <div className="rounded-xl border border-slate-200/60 bg-gradient-to-r from-blue-50/40 via-indigo-50/30 to-orange-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">KG state</span>
          <span className="font-mono text-[10px] tabular-nums text-slate-600">
            t = {(scrubT * 18).toFixed(1)}m
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-mono text-[10px] tabular-nums text-slate-700">
            {Math.round(248 * Math.min(1, scrubT / 0.42))} ent ·{" "}
            {Math.round(511 * Math.min(1, scrubT / 0.42))} edges ·{" "}
            {Math.round(8 * Math.min(1, scrubT / 0.42))} cycles ·{" "}
            <span className="text-emerald-600">
              {Math.round(8 * Math.max(0, Math.min(1, (scrubT - 0.65) / 0.08)))} apps
            </span>{" "}
            ·{" "}
            <span className="text-teal-600">
              {Math.round(33 * Math.max(0, Math.min(1, (scrubT - 0.78) / 0.08)))} intvs
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["all", "stages", "events"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-md px-2.5 py-0.5 text-[10px] font-medium tabular-nums transition-all ${
                  granularity === g ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {g === "all" ? "All" : g === "stages" ? "Stages" : "Events"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrubber track */}
      <div className="relative mt-3 mb-1 h-7">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-200 via-indigo-200 to-orange-200" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-orange-500"
          style={{ left: 0, width: `${scrubT * 100}%` }}
        />
        {stagePoints.map((sp) => (
          <button
            key={sp.id}
            onClick={() => setScrubT(sp.t)}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${sp.t * 100}%` }}
            title={sp.label}
          >
            <span
              className={`block h-3 w-3 rounded-full border-2 transition-all ${
                Math.abs(scrubT - sp.t) < 0.03
                  ? "border-slate-900 bg-white shadow-md"
                  : scrubT >= sp.t
                  ? "border-indigo-500 bg-white"
                  : "border-slate-300 bg-white"
              }`}
            />
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={scrubT}
          onChange={(e) => setScrubT(parseFloat(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <div
          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 shadow-lg ring-2 ring-white"
          style={{ left: `${scrubT * 100}%`, width: 14, height: 14, pointerEvents: "none" }}
        />
      </div>

      {/* Stage labels under track */}
      <div className="relative mt-1 h-3">
        {stagePoints.map((sp) => (
          <span
            key={sp.id}
            className="absolute -translate-x-1/2 font-mono text-[8.5px] uppercase tracking-wider text-slate-500"
            style={{ left: `${sp.t * 100}%` }}
          >
            {sp.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Dashboard Mirror — Mode 3 (link-out preview)
// ─────────────────────────────────────────────────────────────────────────

function DashboardMirrorPreview() {
  return (
    <div className="rounded-xl border border-slate-200/60 bg-[#FAFAF7] p-5">
      {/* Header strip */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold text-slate-900">Production dashboard view</div>
          <div className="mt-1 text-[10.5px] leading-snug text-slate-500">
            The structured non-canvas alternative to the whiteboard, surfaced at{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700">/app/space/[id]</code>{" "}
            — vertically stacked panels, same data, different lens.
          </div>
        </div>
        <a
          href="/app/space/preview"
          className="rounded-lg border border-slate-300 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
        >
          Open dashboard →
        </a>
      </div>

      {/* Stacked panel mockups */}
      <div className="space-y-3">
        <DashMain />
        <DashSynthesis />
        <DashCommandCenter />
        <DashTwin />
        <DashTrajectory />
        <DashProductionSequence />
        <DashAppGrid />
      </div>
    </div>
  );
}

// Shared shell for each dashboard panel preview
function DashPanel({ idx, name, src, children }: { idx: number; name: string; src: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <header className="mb-2 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-slate-400">L{idx}</span>
          <h4 className="text-[11.5px] font-semibold text-slate-800">{name}</h4>
        </div>
        <code className="font-mono text-[8.5px] text-slate-400">{src}</code>
      </header>
      {children}
    </section>
  );
}

// 1 — Main objective banner
function DashMain() {
  return (
    <DashPanel idx={1} name="Main objective banner" src="MainObjectiveBanner">
      <div className="rounded-lg bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4">
        <div className="flex items-baseline gap-2">
          <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-violet-700">L1 · Concept</span>
          <span className="font-mono text-[9px] text-slate-500">G1 · Reduce CRCI burden</span>
        </div>
        <div className="mt-1.5 text-[14px] font-semibold leading-tight text-slate-900">
          Reduce CRCI burden by 0.30z within 12mo
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px]">
          <span className="rounded-md bg-white px-2 py-0.5 font-mono tabular-nums text-slate-600 ring-1 ring-slate-200">12mo horizon</span>
          <span className="rounded-md bg-white px-2 py-0.5 font-mono tabular-nums text-slate-600 ring-1 ring-slate-200">64 ent · 511 edges</span>
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono tabular-nums text-emerald-700 ring-1 ring-emerald-200">3 ranked strategies</span>
          <span className="ml-auto font-mono text-slate-400">updated 18m ago</span>
        </div>
      </div>
    </DashPanel>
  );
}

// 2 — Synthesis view (leverage / risks / cycles)
function DashSynthesis() {
  const items = [
    { kind: "Bottleneck", color: "#b42318", title: "N30 routes 73% of paths", body: "Master bottleneck — single-node failure" },
    { kind: "Leverage", color: "#15803d", title: "Activity → BDNF +0.42z", body: "Direct Δz≈0.30 + multiplier" },
    { kind: "Risk", color: "#a16207", title: "HPA flat AM rise", body: "Slow-burn; compounds over months" },
    { kind: "Cycle", color: "#6d28d9", title: "OIC cycle: N20→N30→N32", body: "Self-reinforcing — needs break" },
  ];
  return (
    <DashPanel idx={2} name="Synthesis view" src="SynthesisView">
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <div
            key={it.kind}
            className="rounded-lg border bg-gradient-to-br from-white to-slate-50/40 p-2.5"
            style={{ borderLeft: `3px solid ${it.color}`, borderColor: `${it.color}33`, borderLeftColor: it.color }}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[8px] font-bold uppercase tracking-wider" style={{ color: it.color }}>{it.kind}</span>
              <span className="font-mono text-[8px] tabular-nums text-slate-400">·</span>
              <span className="font-mono text-[8px] tabular-nums text-slate-400">conf 0.84</span>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold leading-tight text-slate-900">{it.title}</div>
            <div className="mt-0.5 text-[9.5px] leading-snug text-slate-500">{it.body}</div>
          </div>
        ))}
      </div>
    </DashPanel>
  );
}

// 3 — Command center row (3-pane live activity strip)
function DashCommandCenter() {
  return (
    <DashPanel idx={3} name="Command center row" src="CommandCenterRow">
      <div className="grid grid-cols-3 gap-2">
        {/* Live pipeline */}
        <div className="rounded-lg border border-slate-200/70 bg-white p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">Live pipeline</span>
            <span className="flex items-center gap-1 font-mono text-[8px] tabular-nums text-emerald-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              streaming
            </span>
          </div>
          <svg viewBox="0 0 120 32" className="mt-1.5 w-full">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} x={i * 20} y={28 - (i + 2) * 3} width={16} height={(i + 2) * 3} fill="#0EA5E9" opacity={0.6 + i * 0.06} rx={1.5} />
            ))}
          </svg>
          <div className="mt-1 flex justify-between font-mono text-[8px] tabular-nums text-slate-500">
            <span>intake</span><span>kg</span><span>synth</span><span>twin</span><span>apps</span><span>now</span>
          </div>
        </div>
        {/* Agent fleet */}
        <div className="rounded-lg border border-slate-200/70 bg-white p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">Agent fleet</span>
            <span className="font-mono text-[8px] tabular-nums text-slate-600">5 / 7 active</span>
          </div>
          <div className="mt-1.5 space-y-1">
            {["materializer", "researcher", "synthesizer", "calibrator", "predictor"].map((a, i) => (
              <div key={a} className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${i < 2 ? "bg-emerald-500" : i < 4 ? "bg-amber-500" : "bg-slate-300"}`} />
                <span className="text-[9px] text-slate-700">{a}</span>
                <span className="ml-auto font-mono text-[8px] tabular-nums text-slate-400">{i < 2 ? "0.91" : i < 4 ? "0.62" : "—"}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Per-agent perf */}
        <div className="rounded-lg border border-slate-200/70 bg-white p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">Per-agent perf</span>
            <span className="font-mono text-[8px] tabular-nums text-slate-600">7d window</span>
          </div>
          <svg viewBox="0 0 120 36" className="mt-1.5 w-full">
            {[16, 22, 28, 19, 31, 24].map((h, i) => (
              <g key={i}>
                <rect x={i * 20} y={36 - h} width={6} height={h} fill="#7C3AED" rx={1} />
                <rect x={i * 20 + 8} y={36 - h * 0.6} width={6} height={h * 0.6} fill="#0EA5E9" rx={1} />
              </g>
            ))}
          </svg>
        </div>
      </div>
    </DashPanel>
  );
}

// 4 — Twin surface (state + trajectory snapshot)
function DashTwin() {
  return (
    <DashPanel idx={4} name="Twin surface" src="TwinSurface">
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        {/* State pills */}
        <div className="space-y-1.5">
          <div className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">State (z)</div>
          {[
            { name: "ProcSpeed", val: -0.42, target: -0.10 },
            { name: "Memory", val: -0.31, target: 0 },
            { name: "Executive", val: -0.18, target: 0 },
            { name: "Mood", val: 0.04, target: 0 },
          ].map((s) => {
            const pct = Math.max(0, Math.min(100, ((s.val + 1) / 2) * 100));
            const targetPct = Math.max(0, Math.min(100, ((s.target + 1) / 2) * 100));
            return (
              <div key={s.name}>
                <div className="flex items-baseline justify-between font-mono text-[9px] tabular-nums">
                  <span className="text-slate-700">{s.name}</span>
                  <span className={s.val < -0.2 ? "text-rose-600" : "text-slate-500"}>{s.val.toFixed(2)}</span>
                </div>
                <div className="relative mt-0.5 h-1.5 rounded-full bg-slate-100">
                  <div className="absolute h-full rounded-full" style={{ left: `${Math.min(pct, targetPct)}%`, width: `${Math.abs(pct - targetPct)}%`, background: pct < targetPct ? "#EF4444" : "#10B981", opacity: 0.5 }} />
                  <div className="absolute h-2 w-0.5 -translate-y-0.5 bg-emerald-500" style={{ left: `${targetPct}%`, top: 0 }} />
                  <div className="absolute h-2 w-1 -translate-y-0.5 rounded-full bg-slate-700" style={{ left: `${pct}%`, top: 0 }} />
                </div>
              </div>
            );
          })}
        </div>
        {/* Trajectory mini line */}
        <div className="rounded-lg bg-slate-50/40 p-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">Trajectory · 37mo</span>
            <span className="font-mono text-[8px] tabular-nums text-slate-500">target reached t+24mo</span>
          </div>
          <svg viewBox="0 0 200 60" className="mt-1 h-[48px] w-full">
            <line x1={0} y1={48} x2={200} y2={48} stroke="#E2E8F0" strokeDasharray="2 3" strokeWidth={0.6} />
            <line x1={0} y1={20} x2={200} y2={20} stroke="#E2E8F0" strokeDasharray="2 3" strokeWidth={0.6} />
            <path d="M 0 48 Q 50 44, 100 32 Q 150 22, 200 18" fill="none" stroke="#7C3AED" strokeWidth={1.4} />
            <path d="M 0 50 Q 50 47, 100 38 Q 150 30, 200 27" fill="none" stroke="#7C3AED" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
            <path d="M 0 46 Q 50 41, 100 26 Q 150 16, 200 11" fill="none" stroke="#7C3AED" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
            <circle cx={120} cy={28} r={2.4} fill="#7C3AED" />
            <text x={124} y={26} fontSize={6} fill="#7C3AED" fontWeight={600}>target</text>
          </svg>
        </div>
      </div>
    </DashPanel>
  );
}

// 5 — Trajectory panel (Monte Carlo fan)
function DashTrajectory() {
  return (
    <DashPanel idx={5} name="Trajectory panel" src="TrajectoryPanel">
      <div className="rounded-lg border border-slate-200/70 bg-white p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-slate-500">Monte Carlo · 1000 runs · over KG subgraph</span>
          <span className="font-mono text-[8px] tabular-nums text-slate-600">p10 / p50 / p90</span>
        </div>
        <svg viewBox="0 0 400 90" className="mt-1.5 h-[60px] w-full">
          {/* p10–p90 fan */}
          <path d="M 0 70 Q 100 68, 200 50 Q 300 30, 400 18 L 400 50 Q 300 56, 200 64 Q 100 70, 0 75 Z" fill="#0EA5E9" opacity={0.12} />
          {/* p25–p75 */}
          <path d="M 0 72 Q 100 70, 200 55 Q 300 38, 400 28 L 400 44 Q 300 50, 200 60 Q 100 70, 0 74 Z" fill="#0EA5E9" opacity={0.18} />
          {/* p50 */}
          <path d="M 0 73 Q 100 70, 200 58 Q 300 44, 400 36" fill="none" stroke="#0EA5E9" strokeWidth={1.6} />
          {/* baseline target */}
          <line x1={0} y1={36} x2={400} y2={36} stroke="#10B981" strokeDasharray="3 3" strokeWidth={0.8} />
          <text x={4} y={32} fontSize={7} fill="#10B981" fontWeight={600}>target z</text>
          {/* x-axis ticks */}
          {[0, 6, 12, 18, 24, 30, 36].map((m, i) => (
            <text key={m} x={i * (400 / 6)} y={88} fontSize={6} fill="#94A3B8" textAnchor="middle">{m}mo</text>
          ))}
        </svg>
      </div>
    </DashPanel>
  );
}

// 6 — Production sequence (causal pipeline pills)
function DashProductionSequence() {
  const items = [
    { name: "Information", count: 11, color: "#0EA5E9", note: "sources" },
    { name: "Sub-objectives", count: 3, color: "#7C3AED", note: "g1.s1 / s2 / s3" },
    { name: "Interventions", count: 6, color: "#F59E0B", note: "ranked by Δimpact" },
    { name: "Apps", count: 8, color: "#10B981", note: "5 types · pri × cmplx" },
  ];
  return (
    <DashPanel idx={6} name="Production sequence" src="ProductionSequence">
      <div className="flex items-center gap-1.5 overflow-hidden rounded-lg bg-gradient-to-r from-slate-50/40 to-white p-3">
        {items.map((it, i) => (
          <React.Fragment key={it.name}>
            <div
              className="flex flex-1 items-center gap-2 rounded-lg p-2"
              style={{ background: `${it.color}10`, border: `1px solid ${it.color}33` }}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white"
                style={{ background: it.color }}
              >
                {it.count}
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold leading-tight text-slate-800">{it.name}</div>
                <div className="truncate text-[8.5px] text-slate-500">{it.note}</div>
              </div>
            </div>
            {i < items.length - 1 && (
              <span className="font-mono text-[14px] text-slate-300" style={{ lineHeight: 0 }}>→</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </DashPanel>
  );
}

// 7 — App card grid
function DashAppGrid() {
  const apps = [
    { name: "Aerobic exercise", type: "behavior", status: "active", impact: 0.85, effort: 0.55 },
    { name: "Mediterranean diet", type: "nutrition", status: "queued", impact: 0.62, effort: 0.65 },
    { name: "Sleep regularity", type: "behavior", status: "active", impact: 0.71, effort: 0.42 },
    { name: "Mindfulness 10m", type: "cognitive", status: "queued", impact: 0.48, effort: 0.30 },
    { name: "Polyphenol stack", type: "supplement", status: "active", impact: 0.55, effort: 0.20 },
    { name: "Cog training", type: "cognitive", status: "deferred", impact: 0.66, effort: 0.78 },
    { name: "Vitamin D3", type: "supplement", status: "active", impact: 0.32, effort: 0.10 },
    { name: "Stress titration", type: "behavior", status: "queued", impact: 0.50, effort: 0.45 },
  ];
  const TYPE_COLOR: Record<string, string> = {
    behavior: "#0EA5E9",
    nutrition: "#10B981",
    cognitive: "#7C3AED",
    supplement: "#F59E0B",
  };
  const STATUS_TINT: Record<string, string> = {
    active: "#10B98122",
    queued: "#94A3B822",
    deferred: "#EF444422",
  };
  return (
    <DashPanel idx={7} name="App card grid" src="AppCardGrid">
      <div className="grid grid-cols-4 gap-2">
        {apps.map((a) => {
          const c = TYPE_COLOR[a.type] ?? "#94A3B8";
          return (
            <div
              key={a.name}
              className="rounded-lg border border-slate-200/70 bg-white p-2"
              style={{ borderLeft: `3px solid ${c}` }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[7.5px] font-bold uppercase tracking-wider" style={{ color: c }}>{a.type}</span>
                <span className="rounded px-1 py-0.5 font-mono text-[7.5px] font-bold uppercase tracking-wider text-slate-700" style={{ background: STATUS_TINT[a.status] }}>{a.status}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-800">{a.name}</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <div>
                  <div className="font-mono text-[7px] uppercase tracking-wider text-slate-400">impact</div>
                  <div className="font-mono text-[10px] font-bold tabular-nums" style={{ color: c }}>{a.impact.toFixed(2)}</div>
                </div>
                <div>
                  <div className="font-mono text-[7px] uppercase tracking-wider text-slate-400">effort</div>
                  <div className="font-mono text-[10px] font-bold tabular-nums text-slate-700">{a.effort.toFixed(2)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashPanel>
  );
}

function TemplateArchitectureCard() {
  // v3: 3-mode view switcher (architecture / sankey / dashboard) + shared time scrubber
  const [viewMode, setViewMode] = useState<"arch" | "sankey" | "dashboard">("arch");
  const [scrubT, setScrubT] = useState<number>(1.0); // 0=start, 1=now
  const [scrubGran, setScrubGran] = useState<"all" | "stages" | "events">("stages");
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"stub" | "sparkline" | "brief" | "full">("stub");
  const [objective, setObjective] = useState<ObjectiveKey>("orient");
  const [preset, setPreset] = useState<PresetKey>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherDim>("off");
  const [stakeholder, setStakeholder] = useState<StakeholderKey>("all");
  // Edge density — "principal" hides branch-branch noise by default; "all" shows everything
  const [edgeDensity, setEdgeDensity] = useState<"principal" | "all">("principal");
  const activeStakeholder = STAKEHOLDERS.find((s) => s.key === stakeholder)!;
  const activePreset = USE_CASE_PRESETS.find((p) => p.key === preset)!;
  const cardW = zoom === "full" ? 320 : zoom === "brief" ? 220 : 200;
  const cardH = zoom === "stub" ? 42 : zoom === "sparkline" ? 64 : zoom === "brief" ? 96 : 196;
  const colGap = zoom === "full" ? 72 : zoom === "brief" ? 56 : 80;
  const rowGap = zoom === "stub" ? 56 : zoom === "sparkline" ? 76 : zoom === "brief" ? 110 : 220;
  const layerXs = TEMPLATE_ARCH_LAYERS.map((_, i) => 24 + i * (cardW + colGap));
  const totalW = layerXs[layerXs.length - 1] + cardW + 24;
  const headerH = 36;
  const topPad = headerH + 24;
  const presetActive = preset !== "all";

  // Compute which cards are visible under active filters — hidden cards vanish + reflow
  const visibleCardIds = new Set(
    TEMPLATE_ARCH_CARDS.filter((c) => {
      if (presetActive && !activePreset.prominent.includes(c.id) && !activePreset.secondary.includes(c.id)) return false;
      if (activeStakeholder.key !== "all" && activeStakeholder.focus.length > 0 && !activeStakeholder.focus.includes(c.id)) return false;
      return true;
    }).map((c) => c.id),
  );

  // ── Family-aware compact reflow ─────────────────────────────────────
  // Trunks sit at column-x with full width; branches indent right with
  // narrower width. Family-changes get an extra vertical gap. Families
  // also get tracked as bg-zone rectangles so we can render containment.
  const indent = 22;
  const familyGap = 14;
  type Pos = { x: number; y: number; layer: number; w: number; isTrunk: boolean; family: string };
  const positions: Record<string, Pos> = {};
  const layerY: number[] = new Array(TEMPLATE_ARCH_LAYERS.length).fill(topPad);
  const layerLastFamily: (string | null)[] = new Array(TEMPLATE_ARCH_LAYERS.length).fill(null);
  type FamilyBound = { layer: number; family: string; x: number; w: number; y0: number; y1: number; trunkY: number | null; trunkX: number; childrenIds: string[]; trunkId: string | null };
  const familyBounds: Record<string, FamilyBound> = {};
  for (const c of [...TEMPLATE_ARCH_CARDS].sort((a, b) => a.layer - b.layer || a.yIdx - b.yIdx)) {
    if (!visibleCardIds.has(c.id)) continue;
    const isTrunk = c.role === "trunk";
    if (layerLastFamily[c.layer] !== null && layerLastFamily[c.layer] !== c.family) {
      layerY[c.layer] += familyGap;
    }
    layerLastFamily[c.layer] = c.family;
    const w = isTrunk ? cardW : cardW - indent;
    const x = isTrunk ? layerXs[c.layer] : layerXs[c.layer] + indent;
    const y = layerY[c.layer];
    positions[c.id] = { x, y, layer: c.layer, w, isTrunk, family: c.family };
    const existing = familyBounds[c.family];
    if (!existing) {
      familyBounds[c.family] = {
        layer: c.layer,
        family: c.family,
        x: layerXs[c.layer],
        w: cardW,
        y0: y,
        y1: y + cardH,
        trunkY: isTrunk ? y : null,
        trunkX: layerXs[c.layer],
        childrenIds: isTrunk ? [] : [c.id],
        trunkId: isTrunk ? c.id : null,
      };
    } else {
      existing.y1 = Math.max(existing.y1, y + cardH);
      if (isTrunk) {
        existing.trunkY = y;
        existing.trunkId = c.id;
      } else {
        existing.childrenIds.push(c.id);
      }
    }
    layerY[c.layer] += rowGap;
  }
  const totalH = Math.max(topPad + 80, ...layerY.map((y) => y + 60));

  // Highlighted set: the hovered card's neighbors (in or out)
  const neighbors = new Set<string>();
  if (hovered) {
    neighbors.add(hovered);
    for (const e of TEMPLATE_ARCH_EDGES) {
      if (e.from === hovered) neighbors.add(e.to);
      if (e.to === hovered) neighbors.add(e.from);
    }
  }

  const isEdgeHighlighted = (e: TArchEdge) =>
    hovered !== null && (e.from === hovered || e.to === hovered);

  // ── Family-pair edge aggregation ─────────────────────────────────────
  // Cross-family edges are bucketed by (sourceFamily, targetFamily). In
  // Principal mode we render exactly ONE representative edge per bucket
  // (the trunk-trunk version if it exists, else the highest-tier edge).
  // The bucket-size becomes a count badge + scales the stroke weight,
  // so multiplicity is communicated without redundant parallel lines.
  const cardById = new Map<string, TArchCard>(TEMPLATE_ARCH_CARDS.map((c) => [c.id, c]));
  type FamPair = { key: string; representative: TArchEdge; count: number; allEdges: TArchEdge[] };
  const familyPairBuckets = new Map<string, FamPair>();
  // Track which individual edges are the "representative" so the renderer can decide
  const representativeEdgeKeys = new Set<string>();
  for (const e of TEMPLATE_ARCH_EDGES) {
    if (e.kind === "feedback") continue;
    const fc = cardById.get(e.from);
    const tc = cardById.get(e.to);
    if (!fc || !tc) continue;
    if (fc.family === tc.family) continue; // intra-family already covered by spine
    if (fc.layer === tc.layer) continue; // same-column-cross-family handled by tree connector
    const key = `${fc.family}::${tc.family}`;
    const fromTier = fc.role === "trunk" ? 2 : 1;
    const toTier = tc.role === "trunk" ? 2 : 1;
    const tier = fromTier + toTier; // 4 = trunk-trunk, 3 = mixed, 2 = branch-branch
    const existing = familyPairBuckets.get(key);
    if (!existing) {
      familyPairBuckets.set(key, { key, representative: e, count: 1, allEdges: [e] });
    } else {
      existing.count++;
      existing.allEdges.push(e);
      // Promote representative to higher tier if found
      const rfc = cardById.get(existing.representative.from)!;
      const rtc = cardById.get(existing.representative.to)!;
      const repTier = (rfc.role === "trunk" ? 2 : 1) + (rtc.role === "trunk" ? 2 : 1);
      if (tier > repTier) existing.representative = e;
    }
  }
  // Mark representatives by their (from,to) string so render can check fast
  for (const fp of familyPairBuckets.values()) {
    representativeEdgeKeys.add(`${fp.representative.from}::${fp.representative.to}`);
  }
  // Helper: get bucket for a given edge
  const getEdgeBucket = (e: TArchEdge): FamPair | null => {
    const fc = cardById.get(e.from);
    const tc = cardById.get(e.to);
    if (!fc || !tc) return null;
    return familyPairBuckets.get(`${fc.family}::${tc.family}`) ?? null;
  };

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between">
        <div>
          <Eyebrow>◫ Template architecture · whiteboard view</Eyebrow>
          <div className="mt-2 text-[15px] font-semibold text-slate-900">
            How cards feed each other
          </div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            <span className="font-semibold text-slate-700">{visibleCardIds.size}</span>
            {visibleCardIds.size !== TEMPLATE_ARCH_CARDS.length && (
              <span className="text-slate-400"> / {TEMPLATE_ARCH_CARDS.length}</span>
            )}
            {" "}cards · {TEMPLATE_ARCH_EDGES.length} data-flow edges · 7 layers · zoom + lens
            change what each card emphasizes
          </div>
        </div>
        <Chip kind="data">STRUCTURE</Chip>
      </div>

      {/* ── Shared header: view mode toggle + time scrubber ────────────── */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/60 bg-slate-50/50 p-2.5">
          <div className="flex items-center gap-2">
            <span className="ml-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">View</span>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {(
                [
                  { key: "arch" as const, label: "Architecture", glyph: "◫" },
                  { key: "sankey" as const, label: "KG Flow Sankey", glyph: "◇" },
                  { key: "dashboard" as const, label: "Dashboard Mirror", glyph: "▦" },
                ]
              ).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setViewMode(m.key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[10.5px] font-medium tabular-nums transition-all ${
                    viewMode === m.key
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span className="font-mono text-[12px]">{m.glyph}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span className="font-mono uppercase tracking-wider">
              {viewMode === "arch"
                ? "topology · what feeds what"
                : viewMode === "sankey"
                ? "process · how the kg evolves"
                : "synthesis · what gets produced"}
            </span>
          </div>
        </div>

        <TimeScrubber
          scrubT={scrubT}
          setScrubT={setScrubT}
          granularity={scrubGran}
          setGranularity={setScrubGran}
        />
      </div>

      {viewMode === "sankey" && (
        <div className="mt-3">
          <KGFlowSankey scrubT={scrubT} />
        </div>
      )}

      {viewMode === "dashboard" && (
        <div className="mt-3">
          <DashboardMirrorPreview />
        </div>
      )}

      {viewMode === "arch" && (
        <>

      {/* Use-case preset selector */}
      <div className="mt-4 rounded-xl border border-slate-200/60 bg-white p-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Preset</span>
          <div className="flex flex-wrap gap-1.5">
            {USE_CASE_PRESETS.map((p) => {
              const active = preset === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    setPreset(p.key);
                    if (p.key !== "all") setObjective(p.lens);
                  }}
                  title={p.blurb}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-medium transition-all ${
                    active ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                  style={active ? { boxShadow: `inset 0 0 0 1.5px ${p.color}, 0 1px 2px rgba(0,0,0,0.05)` } : undefined}
                >
                  <span className="font-mono" style={{ color: p.color }}>{p.glyph}</span>
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        {preset !== "all" && (
          <div className="mt-3 rounded-lg p-3" style={{ background: `${activePreset.color}10`, border: `1px solid ${activePreset.color}33` }}>
            <div className="flex items-start gap-2">
              <span className="font-mono text-[14px]" style={{ color: activePreset.color }}>{activePreset.glyph}</span>
              <div className="flex-1">
                <div className="text-[12px] font-semibold leading-snug" style={{ color: activePreset.color }}>{activePreset.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{activePreset.blurb}</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">outputs</span>
                  <span className="font-mono text-[10px] tabular-nums text-slate-700">{activePreset.outputs}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] tabular-nums">
                  <span className="text-slate-500">prominent:</span>
                  <span className="font-mono text-slate-700">{activePreset.prominent.length}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">supporting:</span>
                  <span className="font-mono text-slate-700">{activePreset.secondary.length}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">lens auto-set to</span>
                  <span className="font-mono font-semibold text-slate-700">{OBJECTIVE_LENSES.find((o) => o.key === activePreset.lens)?.label}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar — zoom level + objective lens */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/60 bg-slate-50/40 p-3">
        {/* zoom segmented control */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Zoom</span>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["stub", "sparkline", "brief", "full"] as const).map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`rounded-md px-3 py-1 text-[10px] font-medium tabular-nums transition-all ${
                  zoom === z ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {z === "stub" ? "Stub" : z === "sparkline" ? "Sparkline" : z === "brief" ? "Brief" : "Full"}
              </button>
            ))}
          </div>
        </div>

        {/* objective lens */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Lens</span>
          <div className="flex flex-wrap gap-1">
            {OBJECTIVE_LENSES.map((o) => {
              const active = objective === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => setObjective(o.key)}
                  title={o.ask}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all ${
                    active ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-500 hover:bg-white"
                  }`}
                  style={active ? { boxShadow: `inset 0 0 0 1.5px ${o.color}, 0 1px 2px rgba(0,0,0,0.05)` } : undefined}
                >
                  <span className="font-mono" style={{ color: o.color }}>{o.glyph}</span>
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Secondary toolbar — Weather overlay + Stakeholder mode */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/60 bg-slate-50/40 p-3">
        {/* weather overlay */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Weather</span>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["off", "fresh", "cov", "conf"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWeather(w)}
                title={w === "off" ? "no overlay" : w === "fresh" ? "data freshness" : w === "cov" ? "coverage" : "confidence"}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium tabular-nums transition-all ${
                  weather === w ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {w === "off" ? "Off" : w === "fresh" ? "Freshness" : w === "cov" ? "Coverage" : "Confidence"}
              </button>
            ))}
          </div>
          {weather !== "off" && (
            <div className="ml-2 flex items-center gap-2 text-[9px] tabular-nums">
              <span className="flex items-center gap-1"><span className="text-emerald-500">☀</span>≥0.75</span>
              <span className="flex items-center gap-1"><span className="text-amber-500">☁</span>0.55–0.75</span>
              <span className="flex items-center gap-1"><span className="text-rose-500">⛈</span>&lt;0.55</span>
            </div>
          )}
        </div>

        {/* stakeholder mode */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Audience</span>
          <div className="flex flex-wrap gap-1">
            {STAKEHOLDERS.map((s) => {
              const active = stakeholder === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setStakeholder(s.key)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-all ${
                    active ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-500 hover:bg-white"
                  }`}
                  style={active ? { boxShadow: `inset 0 0 0 1.5px ${s.color}, 0 1px 2px rgba(0,0,0,0.05)` } : undefined}
                >
                  <span className="font-mono" style={{ color: s.color }}>{s.glyph}</span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Edge density toggle — collapse branch-branch noise by default */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Edges</span>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["principal", "all"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setEdgeDensity(d)}
                title={d === "principal" ? "Show only trunk-trunk + trunk-branch edges (cleaner)" : "Show every edge (noisy but complete)"}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium tabular-nums transition-all ${
                  edgeDensity === d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {d === "principal" ? "Principal" : "All"}
              </button>
            ))}
          </div>
        </div>

        {/* Live reflow indicator — shows when filters are hiding cards */}
        {(presetActive || activeStakeholder.key !== "all") && (
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] tabular-nums text-slate-500">
            <span className="font-mono text-emerald-500">●</span>
            <span>
              <span className="font-semibold text-slate-700">{visibleCardIds.size}</span>
              {" of "}
              <span>{TEMPLATE_ARCH_CARDS.length}</span>
              {" cards · auto-reflowed"}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200/60 bg-[#FAFAF7]">
        <div
          className="relative"
          style={{
            width: totalW,
            height: totalH,
            backgroundImage:
              "radial-gradient(circle, rgba(15,23,42,0.05) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        >
          {/* SVG layer for arrows */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={totalW}
            height={totalH}
          >
            <defs>
              {/* Soft slate arrowhead — default */}
              <marker id="arch-arrow-data" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 z" fill="#475569" />
              </marker>
              {/* Strong dark arrowhead — highlighted (hover/preset) */}
              <marker id="arch-arrow-data-hi" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#0F172A" />
              </marker>
              {/* Feedback violet */}
              <marker id="arch-arrow-feedback" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 z" fill="#7C3AED" />
              </marker>
            </defs>

            {/* ── Family background zones — subtle rounded rectangles
                visually grouping each family's cards, gives the eye an
                anchor for "this cluster is one topic". */}
            {Object.values(familyBounds).map((fb) => {
              const layer = TEMPLATE_ARCH_LAYERS[fb.layer];
              return (
                <rect
                  key={`fam-bg-${fb.family}`}
                  x={fb.x - 6}
                  y={fb.y0 - 8}
                  width={fb.w + 12}
                  height={fb.y1 - fb.y0 + 16}
                  rx={10}
                  fill={`${layer.color}06`}
                  stroke={`${layer.color}1f`}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              );
            })}

            {/* ── Family spines — vertical rail from each trunk's bottom
                down through its branches, with horizontal stubs into each
                branch (mirrors the objective-decomposition tree grammar). */}
            {Object.values(familyBounds).map((fb) => {
              if (fb.trunkY === null || fb.childrenIds.length === 0) return null;
              const layer = TEMPLATE_ARCH_LAYERS[fb.layer];
              const spineX = fb.x + indent / 2;
              const spineY0 = fb.trunkY + cardH;
              const lastBranch = fb.childrenIds
                .map((id) => positions[id])
                .filter(Boolean)
                .reduce<Pos | null>((acc, p) => (!acc || p.y > acc.y ? p : acc), null);
              if (!lastBranch) return null;
              const spineY1 = lastBranch.y + cardH / 2;
              const fadedColor = `${layer.color}66`;
              return (
                <g key={`fam-spine-${fb.family}`}>
                  <path
                    d={`M ${spineX} ${spineY0} V ${spineY1}`}
                    stroke={fadedColor}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    fill="none"
                  />
                  {fb.childrenIds.map((id) => {
                    const bp = positions[id];
                    if (!bp) return null;
                    const midY = bp.y + cardH / 2;
                    return (
                      <g key={`stub-${id}`}>
                        <path
                          d={`M ${spineX} ${midY} H ${bp.x}`}
                          stroke={fadedColor}
                          strokeWidth={1.2}
                          strokeLinecap="round"
                          fill="none"
                        />
                        <circle cx={spineX} cy={midY} r={1.8} fill={layer.color} />
                      </g>
                    );
                  })}
                  {/* Trunk anchor dot */}
                  <circle cx={spineX} cy={spineY0} r={2.2} fill={layer.color} />
                </g>
              );
            })}

            {TEMPLATE_ARCH_EDGES.map((e, i) => {
              // Skip edges where either endpoint is filtered out (card was hidden + reflowed)
              if (!visibleCardIds.has(e.from) || !visibleCardIds.has(e.to)) return null;
              const f = positions[e.from];
              const t = positions[e.to];
              if (!f || !t) return null;
              const isFeedback = e.kind === "feedback";
              const hi = isEdgeHighlighted(e);
              const fromInPreset = activePreset.prominent.includes(e.from) || activePreset.secondary.includes(e.from);
              const toInPreset = activePreset.prominent.includes(e.to) || activePreset.secondary.includes(e.to);
              const inPreset = !presetActive || (fromInPreset && toInPreset);
              const presetEdgeOpacity = !presetActive ? 1 : inPreset ? 1 : 0.18;

              if (isFeedback) {
                const sx = f.x;
                const sy = f.y + cardH;
                const tx = t.x + t.w;
                const ty = t.y + cardH;
                const bottomY = totalH - 18;
                const path = `M ${sx} ${sy} C ${sx} ${bottomY}, ${tx} ${bottomY}, ${tx} ${ty}`;
                return (
                  <g key={i}>
                    <path
                      d={path}
                      fill="none"
                      stroke="#7C3AED"
                      strokeWidth={hi ? 2 : 1.4}
                      strokeDasharray="4 4"
                      strokeOpacity={(hi ? 0.95 : hovered ? 0.18 : 0.55) * presetEdgeOpacity}
                      markerEnd="url(#arch-arrow-feedback)"
                    />
                    <text x={(sx + tx) / 2} y={bottomY - 4} fontSize="9" textAnchor="middle" fill="#7C3AED" fontStyle="italic" opacity={(hi ? 1 : hovered ? 0.4 : 0.75) * presetEdgeOpacity}>
                      approve → materialize
                    </text>
                  </g>
                );
              }

              // ── Intra-column edge handling ─────────────────────────────
              // If trunk → branch within the same family, the family spine
              // already represents the relationship — skip explicit edge.
              if (f.layer === t.layer) {
                const fc = TEMPLATE_ARCH_CARDS.find((c) => c.id === e.from);
                const tc = TEMPLATE_ARCH_CARDS.find((c) => c.id === e.to);
                const sameFamilyTrunkBranch =
                  fc && tc && fc.family === tc.family && fc.role === "trunk" && tc.role === "branch";
                if (sameFamilyTrunkBranch) return null;
                // Otherwise — different family same column, or sequential branch chain —
                // route as left-side orthogonal stub (mirrors objective tree).
                const stemX = layerXs[f.layer] - 14;
                const srcMidY = f.y + cardH / 2;
                const tgtMidY = t.y + cardH / 2;
                const treeStroke = hi ? "#0F172A" : presetActive && inPreset ? activePreset.color : "#94A3B8";
                const treeSW = hi ? 2 : 1;
                const treeOp = (hi ? 0.95 : hovered ? 0.12 : 0.6) * presetEdgeOpacity;
                return (
                  <g key={i} opacity={treeOp}>
                    <path
                      d={`M ${f.x} ${srcMidY} H ${stemX} V ${tgtMidY} H ${t.x}`}
                      fill="none"
                      stroke={treeStroke}
                      strokeWidth={treeSW}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="2 4"
                      markerEnd={hi ? "url(#arch-arrow-data-hi)" : "url(#arch-arrow-data)"}
                    />
                  </g>
                );
              }

              // ── Cross-column orthogonal routing with highway lanes ──────
              // Adjacent layers (skip=1): simple H V H through the gutter.
              // Skip-layer (skip≥2): route via top/bottom highway above/below
              // all cards so the path NEVER crosses unrelated cards.
              const sx = f.x + f.w;
              const sy = f.y + cardH / 2;
              const tx = t.x;
              const ty = t.y + cardH / 2;
              const skipLayers = t.layer - f.layer;
              const isSkip = skipLayers >= 2;

              // ── Family-pair aggregation (Principal mode) ────────────────
              // In Principal mode, render exactly ONE edge per family-pair —
              // the representative — and let its weight + count badge
              // communicate how many underlying edges it stands for.
              // Hover bypasses the dedup so the user sees real connectivity.
              const edgeKey = `${e.from}::${e.to}`;
              const isRepresentative = representativeEdgeKeys.has(edgeKey);
              const bucket = getEdgeBucket(e);
              if (edgeDensity === "principal" && !isRepresentative && !hi) return null;

              // Tier from role drives visibility + visual weight
              const isPrincipal = f.isTrunk && t.isTrunk;
              const isSecondary = (f.isTrunk || t.isTrunk) && !isPrincipal;
              const isPeripheral = !isPrincipal && !isSecondary;

              let pathD: string;
              const sourceGutterX = layerXs[f.layer] + cardW + colGap / 2;
              const targetGutterX = layerXs[t.layer] - colGap / 2;

              if (isSkip) {
                // Skip-layer → highway routing
                // Pick top highway when going up, bottom when going down,
                // so each direction gets its own clean lane.
                const goingUp = ty < sy;
                // Top highway sits in the gap between layer headers (y≈42)
                // and the first card row (y=topPad=60). Bottom highway sits
                // above the feedback arc which runs at y=totalH-18.
                const baseHighwayY = goingUp ? topPad - 12 : totalH - 50;
                // Stagger so multiple skip edges from same source don't stack
                const skipPeers = TEMPLATE_ARCH_EDGES.filter(
                  (ed) =>
                    ed.from === e.from &&
                    ed.kind !== "feedback" &&
                    visibleCardIds.has(ed.to) &&
                    positions[ed.to] &&
                    positions[ed.to].layer - f.layer >= 2,
                );
                const skipIdx = skipPeers.indexOf(e);
                const stagger = skipPeers.length > 1 ? (skipIdx - (skipPeers.length - 1) / 2) * 5 : 0;
                const highwayY = baseHighwayY + (goingUp ? -stagger : stagger);
                pathD = `M ${sx} ${sy} H ${sourceGutterX} V ${highwayY} H ${targetGutterX} V ${ty} H ${tx}`;
              } else {
                // Adjacent layer → simple H V H, staggered per source
                const adjacentPeers = TEMPLATE_ARCH_EDGES.filter(
                  (ed) =>
                    ed.from === e.from &&
                    ed.kind !== "feedback" &&
                    visibleCardIds.has(ed.to) &&
                    positions[ed.to] &&
                    positions[ed.to].layer - f.layer === 1,
                );
                const idx = adjacentPeers.indexOf(e);
                const baseMidX = sx + (tx - sx) * 0.5;
                const stagger = adjacentPeers.length > 1 ? (idx - (adjacentPeers.length - 1) / 2) * 7 : 0;
                const midX = baseMidX + stagger;
                pathD = `M ${sx} ${sy} H ${midX} V ${ty} H ${tx}`;
              }

              const stroke = hi
                ? "#0F172A"
                : presetActive && inPreset
                  ? activePreset.color
                  : isPrincipal
                    ? "#334155"
                    : isSecondary
                      ? "#64748B"
                      : "#94A3B8";
              // In Principal mode, the representative edge's weight scales
              // with bucket size — each underlying edge adds a bit of mass
              // so the "Materialize→Graph" highway visibly carries more
              // load than "Data→Profile". Capped to avoid runaway thickness.
              const bucketCount = (edgeDensity === "principal" && bucket) ? bucket.count : 1;
              const bucketBoost = Math.min(1.4, Math.log2(1 + bucketCount) * 0.5);
              const strokeWidth = hi
                ? 2.6
                : isPrincipal
                  ? 2 + bucketBoost
                  : isSecondary
                    ? 1.3 + bucketBoost * 0.6
                    : 0.9;
              // Stronger hover-dim so unrelated edges nearly disappear
              const baseOp = isPrincipal ? 0.78 : isSecondary ? 0.5 : 0.18;
              const dimOp = 0.04;
              const strokeOpacity = (hi ? 0.95 : hovered ? dimOp : baseOp) * presetEdgeOpacity;
              const dashed = isPeripheral || (isSkip && !isPrincipal);

              // Compute label position at the visual midpoint of the path
              const showCountBadge =
                edgeDensity === "principal" &&
                isRepresentative &&
                bucketCount > 1 &&
                !hovered;
              let badgeX = (sx + tx) / 2;
              let badgeY = (sy + ty) / 2;
              if (isSkip) {
                const goingUp = ty < sy;
                const highwayY = goingUp ? topPad - 12 : totalH - 50;
                badgeX = (sx + tx) / 2;
                badgeY = highwayY;
              }

              return (
                <g key={i}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeOpacity={strokeOpacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={dashed ? (isSkip ? "3 5" : "2 4") : undefined}
                    markerEnd={hi ? "url(#arch-arrow-data-hi)" : "url(#arch-arrow-data)"}
                  />
                  {/* Source endpoint dot — flat at card edge */}
                  <circle cx={sx} cy={sy} r={hi ? 2.4 : isPrincipal ? 2.2 : 1.6} fill={stroke} opacity={strokeOpacity} />
                  {/* Count badge — shows how many underlying edges this single
                      principal-mode line aggregates. Hover bypasses dedup so
                      the badge is hidden during hover (real edges are visible). */}
                  {showCountBadge && (
                    <g>
                      {/* White halo for legibility against line + canvas bg */}
                      <circle
                        cx={badgeX}
                        cy={badgeY}
                        r={11}
                        fill="white"
                        opacity={0.94}
                      />
                      <circle
                        cx={badgeX}
                        cy={badgeY}
                        r={10}
                        fill="white"
                        stroke={stroke}
                        strokeWidth={1.6}
                        opacity={0.96}
                      />
                      <text
                        x={badgeX}
                        y={badgeY + 3.5}
                        fontSize={10}
                        fontFamily="SF Mono, ui-monospace, monospace"
                        fontWeight={700}
                        textAnchor="middle"
                        fill={stroke}
                        opacity={0.92}
                      >
                        {bucketCount}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Layer headers */}
          {TEMPLATE_ARCH_LAYERS.map((l, i) => (
            <div
              key={l.id}
              className="absolute"
              style={{ left: layerXs[i], top: 12, width: cardW }}
            >
              <div
                className="rounded-md px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  background: `${l.color}1a`,
                  color: l.color,
                  border: `1px solid ${l.color}33`,
                }}
              >
                <span className="font-mono">L{l.id}</span> · {l.label}
              </div>
            </div>
          ))}

          {/* Cards */}
          {TEMPLATE_ARCH_CARDS.map((card) => {
            // Hard-hide cards excluded by active filters — they are already absent from positions
            if (!visibleCardIds.has(card.id)) return null;
            const pos = positions[card.id];
            const layer = TEMPLATE_ARCH_LAYERS[card.layer];
            const isHovered = hovered === card.id;
            const inNeighborhood = neighbors.has(card.id);
            const objContent = ARCH_CONTENT[card.id]?.[objective];
            const objApplies = !!objContent;
            const isProminent = activePreset.prominent.includes(card.id);
            // Hover dim: non-neighborhood cards fade when hovering
            const hoverDim = hovered !== null && !inNeighborhood;
            const lensDim = !objApplies && hovered === null && !presetActive;
            // Weather: read per-card freshness/coverage/confidence
            const w = CARD_WEATHER[card.id];
            const weatherVal = weather === "fresh" ? w?.fresh : weather === "cov" ? w?.cov : weather === "conf" ? w?.conf : null;
            const weatherTint = weather !== "off" && weatherVal !== undefined ? weatherColor(weatherVal!) : null;
            // Visual tier driven by role (trunk = encompassing topic, branch = sub-operation)
            const isTrunk = card.role === "trunk";
            const cardEdgeCount = _CARD_EDGE_COUNT[card.id] ?? 0;

            // Aggressive hover-dim — unrelated cards fade hard so the
            // hovered card's neighborhood reads as a clear focal subset.
            const baseOpacity = hoverDim ? 0.16 : lensDim ? 0.45 : 1;
            const lensColor = OBJECTIVE_LENSES.find((o) => o.key === objective)?.color ?? "#94A3B8";
            return (
              <div
                key={card.id}
                // Stable DOM id so the operational timeline below can
                // scroll-link cover chips back up to their matching
                // L0-L6 card. Format kept namespaced (`arch-card-`)
                // to avoid collisions with other ids on the page.
                id={`arch-card-${card.id}`}
                onMouseEnter={() => setHovered(card.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(card.id)}
                className={`absolute cursor-pointer scroll-mt-32 rounded-md border shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: pos.w,
                  height: cardH,
                  background: weatherTint
                    ? `linear-gradient(180deg, ${weatherTint}14 0%, white 60%)`
                    : isTrunk
                    ? `linear-gradient(180deg, ${layer.color}0d 0%, white 55%)`
                    : "white",
                  borderColor: selected === card.id ? "#0F172A" : isHovered ? layer.color : weatherTint ? `${weatherTint}55` : isTrunk ? `${layer.color}55` : "#E2E8F0",
                  borderLeftWidth: selected === card.id ? 4 : isTrunk ? 4 : 2,
                  borderLeftColor: layer.color,
                  opacity: baseOpacity,
                  zIndex: isTrunk ? 3 : 2,
                  boxShadow: isHovered
                    ? `0 6px 16px ${layer.color}33, 0 0 0 2px ${layer.color}55`
                    : presetActive && isProminent
                      ? `inset 0 0 0 1.5px ${activePreset.color}88, 0 4px 12px ${activePreset.color}22`
                      : isTrunk
                      ? `0 2px 8px ${layer.color}1a, inset 0 0 0 1px ${layer.color}26`
                      : objApplies
                      ? `inset 0 0 0 1px ${lensColor}1a`
                      : undefined,
                }}
              >
                {/* Trunk eyebrow — names the family this card heads */}
                {isTrunk && zoom !== "stub" && (
                  <span
                    className="absolute -top-2 left-2 z-10 rounded-full px-1.5 py-0.5 font-mono text-[7px] font-bold uppercase tracking-[0.12em] shadow-sm ring-1 ring-white"
                    style={{ background: layer.color, color: "white" }}
                    title={`${TEMPLATE_ARCH_FAMILIES[card.family] ?? card.family} family · ${cardEdgeCount} edges`}
                  >
                    {TEMPLATE_ARCH_FAMILIES[card.family] ?? card.family}
                  </span>
                )}
                {/* Hero edge-count badge — only for trunks at non-stub zoom */}
                {isTrunk && zoom !== "stub" && cardEdgeCount >= 3 && (
                  <span
                    className="absolute -top-1.5 -right-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[7px] font-bold shadow-sm ring-1 ring-white"
                    style={{ background: layer.color, color: "white" }}
                    title={`${cardEdgeCount} connections`}
                  >
                    {cardEdgeCount}
                  </span>
                )}
                {/* Weather glyph in corner */}
                {weatherTint && weatherVal !== undefined && weatherVal !== null && (
                  <span
                    className="absolute -top-1.5 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[8px] shadow-sm ring-1"
                    style={{ color: weatherTint, borderColor: `${weatherTint}55` }}
                    title={`${weather === "fresh" ? "freshness" : weather === "cov" ? "coverage" : "confidence"}: ${weatherVal.toFixed(2)}`}
                  >
                    {weatherGlyph(weatherVal)}
                  </span>
                )}
                {zoom === "stub" ? (
                  // STUB — glyph + title + 1-line hint
                  <div className="flex h-full items-center gap-1.5 px-2.5">
                    <span className="font-mono text-[12px]" style={{ color: layer.color }}>
                      {card.glyph}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold leading-tight text-slate-800">
                        {card.label}
                      </div>
                      {card.hint ? (
                        <div className="truncate font-mono text-[8px] tabular-nums text-slate-400">
                          {card.hint}
                        </div>
                      ) : null}
                    </div>
                    {card.status && card.status !== "wired" && (
                      <span
                        className="shrink-0 font-mono text-[10px]"
                        title={card.status === "partial" ? "Partial — schema or some code, gaps remain" : "Missing — needs to be built"}
                        style={{ color: card.status === "partial" ? "#F59E0B" : "#EF4444" }}
                      >
                        {card.status === "partial" ? "⚠" : "✗"}
                      </span>
                    )}
                  </div>
                ) : zoom === "sparkline" ? (
                  // SPARKLINE — title + objective metric in lens color
                  <div className="flex h-full flex-col p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px]" style={{ color: layer.color }}>
                        {card.glyph}
                      </span>
                      <span className="truncate text-[10px] font-semibold leading-tight text-slate-800">
                        {card.label}
                      </span>
                      {card.status && card.status !== "wired" && (
                        <span className="ml-auto font-mono text-[9px]" style={{ color: card.status === "partial" ? "#F59E0B" : "#EF4444" }}>
                          {card.status === "partial" ? "⚠" : "✗"}
                        </span>
                      )}
                    </div>
                    {objContent ? (
                      <div className="mt-auto">
                        <div className="truncate font-mono text-[11px] font-semibold tabular-nums" style={{ color: lensColor }}>
                          {objContent[0]}
                        </div>
                        <div className="truncate text-[8px] tabular-nums text-slate-400">{objContent[1]}</div>
                      </div>
                    ) : (
                      <div className="mt-auto truncate text-[8px] italic tabular-nums text-slate-300">
                        n/a in {objective}
                      </div>
                    )}
                  </div>
                ) : zoom === "brief" ? (
                  // BRIEF — full card with glyph header + objective body + lens stripe
                  <div className="flex h-full flex-col p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px]" style={{ color: layer.color }}>
                        {card.glyph}
                      </span>
                      <span className="truncate text-[11px] font-semibold leading-tight text-slate-800">
                        {card.label}
                      </span>
                      {card.status && card.status !== "wired" && (
                        <span className="font-mono text-[10px]" style={{ color: card.status === "partial" ? "#F59E0B" : "#EF4444" }} title={card.status}>
                          {card.status === "partial" ? "⚠" : "✗"}
                        </span>
                      )}
                      {objApplies && (
                        <span
                          className="ml-auto rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider"
                          style={{ background: `${lensColor}1a`, color: lensColor }}
                        >
                          {OBJECTIVE_LENSES.find((o) => o.key === objective)?.glyph}
                        </span>
                      )}
                    </div>
                    {objContent ? (
                      <>
                        <div
                          className="mt-1.5 truncate font-mono text-[14px] font-semibold tabular-nums"
                          style={{ color: lensColor }}
                        >
                          {objContent[0]}
                        </div>
                        <div className="truncate text-[9px] leading-snug text-slate-500">
                          {objContent[1]}
                        </div>
                      </>
                    ) : (
                      <div className="mt-auto rounded-md bg-slate-50 px-2 py-1 text-center font-mono text-[8px] italic tabular-nums text-slate-400">
                        not relevant in {OBJECTIVE_LENSES.find((o) => o.key === objective)?.label} lens
                      </div>
                    )}
                    <div className="mt-auto flex items-baseline justify-between font-mono text-[8px] tabular-nums text-slate-400">
                      <span>{card.hint}</span>
                      <span>L{card.layer}</span>
                    </div>
                  </div>
                ) : (
                  // FULL — actual mini visualization inline
                  <div className="flex h-full flex-col p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px]" style={{ color: layer.color }}>
                        {card.glyph}
                      </span>
                      <span className="truncate text-[11px] font-semibold leading-tight text-slate-800">
                        {card.label}
                      </span>
                      {card.status && card.status !== "wired" && (
                        <span
                          className="rounded-full px-1.5 py-0 font-mono text-[8px] font-semibold uppercase tracking-wider ring-1"
                          style={{
                            background: card.status === "partial" ? "#F59E0B1a" : "#EF44441a",
                            color: card.status === "partial" ? "#B45309" : "#B91C1C",
                            borderColor: card.status === "partial" ? "#FCD34D" : "#FCA5A5",
                          }}
                        >
                          {card.status === "partial" ? "⚠ partial" : "✗ missing"}
                        </span>
                      )}
                      {objApplies && (
                        <span
                          className="ml-auto rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider"
                          style={{ background: `${lensColor}1a`, color: lensColor }}
                        >
                          {OBJECTIVE_LENSES.find((o) => o.key === objective)?.glyph}
                        </span>
                      )}
                    </div>
                    {objContent && (
                      <div className="mt-1 flex items-baseline gap-2 border-b border-slate-100 pb-1">
                        <span
                          className="truncate font-mono text-[10px] font-semibold tabular-nums"
                          style={{ color: lensColor }}
                        >
                          {objContent[0]}
                        </span>
                        <span className="truncate text-[8px] tabular-nums text-slate-500">
                          {objContent[1]}
                        </span>
                      </div>
                    )}
                    <div className="mt-1.5 flex-1 overflow-hidden">
                      <FullCardContent cardId={card.id} lensColor={lensColor} layerColor={layer.color} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[9px] tabular-nums">
        {TEMPLATE_ARCH_LAYERS.map((l) => (
          <span key={l.id} className="flex items-center gap-1 text-slate-500">
            <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
            <span className="font-mono">L{l.id}</span> {l.label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 text-slate-500">
          <span className="flex items-center gap-1">
            <svg width="22" height="6">
              <line x1="0" y1="3" x2="20" y2="3" stroke="#94A3B8" strokeWidth="1" />
            </svg>
            data flow
          </span>
          <span className="flex items-center gap-1">
            <svg width="22" height="6">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke="#7C3AED"
                strokeWidth="1.4"
                strokeDasharray="3 3"
              />
            </svg>
            feedback
          </span>
          {/* Wiring status legend */}
          <span className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <span className="font-semibold uppercase tracking-wider text-slate-400">Wiring:</span>
            <span className="flex items-center gap-1">
              <span className="text-slate-400">○</span> wired ({TEMPLATE_ARCH_CARDS.filter((c) => !c.status || c.status === "wired").length})
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <span>⚠</span> partial ({TEMPLATE_ARCH_CARDS.filter((c) => c.status === "partial").length})
            </span>
            <span className="flex items-center gap-1 text-rose-600">
              <span>✗</span> missing ({TEMPLATE_ARCH_CARDS.filter((c) => c.status === "missing").length})
            </span>
          </span>
        </span>
      </div>
        </>
      )}

      <Methodology>
        Every card on this page is one node here. Solid arrows trace upstream → downstream data flow; dashed arc closes
        the discovery loop (approved proposals materialize back into the substrate). Switching templates rewires this
        graph — same shape, different sources/edges/predictions. Click any card to inspect current vs. codebase vs.
        ideal renderings below.
      </Methodology>

      {/* Card detail inspector — opens below when a card is clicked */}
      <CardDetailInspector cardId={selected} onClose={() => setSelected(null)} />
    </div>
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
            {/* Jump-to-timeline anchor — surfaces the new operational
                timeline section that lives below the L0-L5 lens grid.
                Highlighted with an emerald accent so it stands out
                from the decorative chrome chips next to it. */}
            <a
              href="#operational-timeline"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
              title="Skip to the time-sequential operational flow + KG growth markers"
            >
              <span aria-hidden>↓</span>
              <span>Operational timeline</span>
            </a>
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

        {/* Whiteboard view of card lineage */}
        <div className="mt-12">
          <TemplateArchitectureCard />
        </div>

        {/* Objective tree — improvement_goals → sub_objectives → tactics → metrics */}
        <div className="mt-8 flex justify-center">
          <ObjectiveTreeCard />
        </div>

        {/* Top — Orient */}
        <SectionDivider label="Orient" />
        <div className="flex flex-wrap items-start justify-center gap-8">
          <ContextCard />
          <KGOverviewCard />
          <MasterBottleneckCard />
        </div>

        {/* Multi-View Lenses (NEW) — same data, 4 layouts */}
        <SectionDivider label="Multi-view lenses" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            Same {TOTAL_NODES} nodes & {TOTAL_EDGES} edges through four different lenses.
            Switch on demand — each surfaces a different shape of insight.
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-4">
          <ViewLensCard kind="layered" badge="01" title="Layered DAG" sub="Forward causal flow · L0→L6" />
          <ViewLensCard kind="sphere" badge="02" title="Sphere · radial" sub="N30 bottleneck centered · 2-hop neighborhood" />
          <ViewLensCard kind="force" badge="03" title="Force-directed" sub="Domain clustering · emergent structure" />
          <ViewLensCard kind="matrix" badge="04" title="Adjacency matrix" sub="Layer-to-layer edge density heatmap" />
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

        {/* Temporal Atlas (NEW) — Phase 1-5 temporal infrastructure */}
        <SectionDivider label="Temporal atlas" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            Every edge carries onset · peak · persistence pools (REML).
            Predicted vs observed peak weeks → calibration feedback loop closes.
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-6">
          <TimingPoolCard />
          <DecayKineticsCard />
          <CalibrationScatterCard />
        </div>
        <div className="mt-6 flex flex-wrap items-start justify-center gap-6">
          <PredictionFanCard />
          <EdgeCalibrationDriftCard />
        </div>

        {/* Apps & Interventions zone (NEW) */}
        <SectionDivider label="Apps & interventions" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            What's running, what's planned. Apps as first-class objects, interventions as a dependency DAG.
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-6">
          <AppsPortfolioCard />
          <InterventionDAGCard />
        </div>

        {/* Dose-response row */}
        <div className="mt-10">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            ⬢ Interventions · dose-response (Hill equation)
          </div>
          <div className="flex flex-wrap gap-4">
            {IVS.slice(0, 6).map((iv) => (
              <DoseResponseCard key={iv.id} iv={iv} />
            ))}
          </div>
        </div>

        {/* Hidden Insights (NEW) — what the system surfaced */}
        <SectionDivider label="Hidden insights · what we surfaced" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            Cycles, bridges, discordances, temporal mismatches — non-obvious findings the layered system can detect that single-layer analysis cannot.
          </p>
        </div>
        <HiddenInsightsRow />

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

        {/* Analytics row (NEW) — Variance decomp + Calibration cascade + Forest plot */}
        <SectionDivider label="Posterior analytics" />
        <div className="flex flex-wrap items-start justify-center gap-6">
          <VarianceDecompCard />
          <CalibrationCascadeCard />
          <ForestPlotCard />
        </div>

        {/* Proposal Intake — UNIFIED 6-stream funnel (REPLACES variable+discovery cards) */}
        <SectionDivider label="Proposal intake · 6-stream funnel" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            Concept · Router · Variable · Twin · Discovery · Rigor — every stream of incoming proposals, supersede-tracked, rank-sorted.
            Click a stream tab to see its queue.
          </p>
        </div>
        <div className="flex justify-center">
          <ProposalIntakeFunnel />
        </div>

        {/* Audit & Provenance zone (NEW) */}
        <SectionDivider label="Audit · history · calibration" />
        <div className="mb-3 text-center">
          <p className="text-[11px] tabular-nums text-slate-500">
            Where did the data come from? How is the model doing? What's changed since strategy birth?
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-6">
          <LoopCycleBurndownCard />
          <StrategyBaselineDeltaCard />
          <RealityCalibrationCard />
        </div>
        <div className="mt-6 flex flex-wrap items-start justify-center gap-6">
          <IngestionPipelineCard />
          <CSVDropCard />
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

        {/* ── Operational timeline (the new linear sequence) ───────────
             Sits below the L0–L5 lens grid because that grid is
             role-categorical, not time-sequential. This timeline shows
             the actual order of operations + KG growth markers so users
             have an honest picture of what runs when. */}
        <OperationalTimeline />

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
