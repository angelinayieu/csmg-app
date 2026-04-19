"use client";

import React, { useMemo, useState } from "react";
import { T } from "../tokens";
import { Mono, Pill } from "../ui";

// ─── Priority queue data ────────────────────────────────────────
interface PriorityItem {
  rank: number;
  title: string;
  type: "Chain" | "Sparse" | "Population";
  cls: string;
  z?: number;
  score: number;
  color: string;
  detail: string;
  searches: string[];
  edges?: string[];
  metrics?: { label: string; value: string; color?: string }[];
}

const PRIORITIES: PriorityItem[] = [
  {
    rank: 1,
    title: "OIC→Fatigue→ProcSpeed",
    type: "Chain",
    cls: "DISCORDANT",
    z: 1.64,
    score: 94,
    color: T.lo,
    detail:
      "Fatigue exerts cognitive effects through additional mechanisms beyond OIC: sleep fragmentation, autonomic dysregulation, motivational deficit, unmodeled network disruptions. β_chain=−0.09 signals missing parallel pathways relative to β_direct=−0.24.",
    edges: ["ER_OIC_FATIGUE", "ER_FATIGUE_PROCSPD"],
    metrics: [
      { label: "β_chain", value: "-0.091" },
      { label: "β_direct", value: "-0.240" },
      { label: "Ratio", value: "2.67", color: T.lo },
      { label: "Z-score", value: "1.64", color: T.lo },
    ],
    searches: [
      "fatigue-cognition pathways beyond neuroinflammation cancer",
      "autonomic dysregulation CRCI parallel mechanisms",
      "sleep fragmentation processing speed chemotherapy",
    ],
  },
  {
    rank: 2,
    title: "OIC→Depression→WorkMem",
    type: "Chain",
    cls: "DISCORDANT",
    z: 1.91,
    score: 91,
    color: T.lo,
    detail:
      "Depression→cognition operates through attentional resource depletion, rumination-driven working memory interference, and neurovegetative sleep disruption—none currently modeled as separate edges.",
    edges: ["ER_OIC_DEPRESSION", "ER_DEP_WORKMEM"],
    metrics: [
      { label: "β_chain", value: "-0.064" },
      { label: "β_direct", value: "-0.220" },
      { label: "Ratio", value: "3.67", color: T.lo },
      { label: "Z-score", value: "1.91", color: T.lo },
    ],
    searches: [
      "rumination working memory cancer",
      "attentional depletion depression cognition",
      "neurovegetative sleep working memory chemotherapy",
    ],
  },
  {
    rank: 3,
    title: "BBB→OIC (k=0)",
    type: "Sparse",
    cls: "[PROTO]",
    score: 82,
    color: T.purple,
    detail:
      "BBB disruption permits peripheral cytokine CNS entry, amplifying neuroinflammation. Critical for HEM/HNC populations where BBB vulnerability is high (0.68/0.75). Currently a structural placeholder with prior-dominated SE.",
    metrics: [
      { label: "β̂ (prior)", value: "0.22" },
      { label: "SE_eff", value: "0.40" },
      { label: "95% CrI", value: "[-0.56, 1.00]" },
      { label: "Downstream", value: "4 nodes" },
    ],
    searches: [
      "blood brain barrier chemotherapy permeability",
      "tight junction cytokine CNS infiltration cancer",
      "BBB disruption cognitive decline longitudinal",
    ],
  },
  {
    rank: 4,
    title: "Chemo→p16→Sen→OIC→ProcSpeed",
    type: "Chain",
    cls: "DISCORDANT",
    z: 1.22,
    score: 78,
    color: T.lo,
    detail:
      "No single study measured the complete 4-edge chain. Estimand incompatible. Reclassified as THEORETICAL. The senescence→OIC link (k=1) is the weakest edge.",
    metrics: [
      { label: "Edges", value: "4" },
      { label: "k_min", value: "1" },
      { label: "Ratio", value: "3.00", color: T.lo },
    ],
    searches: [
      "cellular senescence neuroinflammation cancer longitudinal",
      "SASP cognitive impairment chemotherapy",
      "p16 senescence chemobrain",
    ],
  },
  {
    rank: 5,
    title: "Glymphatic→OIC (k=0)",
    type: "Sparse",
    cls: "[DISCOVERY]",
    score: 75,
    color: T.purple,
    detail:
      "Sleep-dependent glymphatic clearance of neurotoxic waste products may modulate neuroinflammatory burden. If parameterized, could add a mechanistic route from sleep interventions to OIC reduction independent of cortisol.",
    metrics: [
      { label: "β̂ (prior)", value: "0.15" },
      { label: "SE_eff", value: "0.45" },
      { label: "Profiles", value: "18" },
    ],
    searches: [
      "glymphatic clearance chemotherapy",
      "sleep waste clearance neuroinflammation",
      "aquaporin-4 cancer cognition",
    ],
  },
  {
    rank: 6,
    title: "CNS: All pathways",
    type: "Population",
    cls: "GAP",
    score: 72,
    color: T.mid,
    detail:
      "Only 1 extractable record for CNS tumors. Direct parenchymal injury superimposed on treatment mechanisms creates unique profile. Worst composite: z=−0.85.",
    metrics: [
      { label: "Records", value: "1/15" },
      { label: "Profiles", value: "6" },
      { label: "Coverage", value: "7%", color: T.lo },
    ],
    searches: [
      "CNS tumor radiation cognitive impairment longitudinal",
      "parenchymal injury neuroinflammation glioma survivor",
      "brain tumor treatment cognitive trajectory",
    ],
  },
  {
    rank: 7,
    title: "Stress→Cortisol→HPA→WorkMem",
    type: "Chain",
    cls: "MARGINAL",
    z: 0.78,
    score: 68,
    color: T.mid,
    detail:
      "HPA pathway may operate through autonomic-immune crosstalk and additional unmeasured routes not currently modeled.",
    metrics: [
      { label: "β_chain", value: "-0.050" },
      { label: "β_direct", value: "-0.110" },
      { label: "Ratio", value: "2.20", color: T.mid },
    ],
    searches: [
      "autonomic immune crosstalk cortisol cognition",
      "HPA working memory moderators cancer",
      "stress cognition pathways beyond cortisol",
    ],
  },
  {
    rank: 8,
    title: "Exercise→BDNF→Neuroplast→Episodic",
    type: "Chain",
    cls: "MARGINAL",
    z: 0.52,
    score: 65,
    color: T.mid,
    detail:
      "Exercise→BDNF has I²=68% with conflicting RCTs. Two breast cancer trials reported null; AYA study shows moderate positive effect. Subgroup heterogeneity needs resolution.",
    metrics: [
      { label: "I²", value: "68%", color: T.mid },
      { label: "k", value: "3" },
      { label: "Ratio", value: "2.00", color: T.mid },
    ],
    searches: [
      "exercise BDNF AYA cancer survivor",
      "exercise intensity BDNF breast cancer",
      "neuroplasticity RCT cognitive cancer subgroup",
    ],
  },
];

// ─── Impact simulator ───────────────────────────────────────────
function simulateImpact(currentBeta: number, currentSe: number, currentK: number, hypBeta: number, hypSe: number) {
  const wCurr = currentK > 0 ? 1 / (currentSe ** 2) : 0;
  const wNew = 1 / (hypSe ** 2);
  const wTot = wCurr + wNew;
  const newBeta = (wCurr * currentBeta + wNew * hypBeta) / wTot;
  const newSe = Math.sqrt(1 / wTot);
  return {
    before: { beta: currentBeta, se: currentSe, k: currentK, ci: [currentBeta - 1.96 * currentSe, currentBeta + 1.96 * currentSe] },
    after: { beta: newBeta, se: newSe, k: currentK + 1, ci: [newBeta - 1.96 * newSe, newBeta + 1.96 * newSe] },
    seReduction: ((currentSe - newSe) / currentSe) * 100,
  };
}

function MiniForest({ before, after, width = 380 }: { before: { beta: number; se: number; ci: number[] }; after: { beta: number; se: number; ci: number[] }; width?: number }) {
  const h = 60;
  const pad = { l: 60, r: 90 };
  const pW = width - pad.l - pad.r;
  const allV = [...before.ci, ...after.ci];
  const xMin = Math.min(0, ...allV) - 0.05;
  const xMax = Math.max(0, ...allV) + 0.05;
  const xS = (v: number) => pad.l + ((v - xMin) / (xMax - xMin)) * pW;
  return (
    <svg width={width} height={h}>
      <line x1={xS(0)} y1={4} x2={xS(0)} y2={h - 4} stroke={T.border} strokeWidth={0.5} strokeDasharray="3,3" />
      {[{ d: before, y: 18, label: "Before", color: T.ink3 }, { d: after, y: 42, label: "After", color: T.blue }].map(({ d, y, label, color }) => (
        <g key={label}>
          <text x={pad.l - 6} y={y + 4} textAnchor="end" style={{ fontSize: 10, fill: color, fontFamily: T.sans, fontWeight: 500 }}>{label}</text>
          <line x1={xS(d.ci[0])} y1={y} x2={xS(d.ci[1])} y2={y} stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
          <circle cx={xS(d.beta)} cy={y} r={3.5} fill={color} />
          <text x={width - pad.r + 6} y={y + 4} style={{ fontSize: 9, fill: color, fontFamily: T.mono }}>
            {d.beta >= 0 ? "+" : ""}{d.beta.toFixed(3)} ±{d.se.toFixed(3)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ImpactPanel() {
  const [hypBeta, setHypBeta] = useState("-0.20");
  const [hypSe, setHypSe] = useState("0.08");
  const [result, setResult] = useState<ReturnType<typeof simulateImpact> | null>(null);
  const run = () => {
    const b = parseFloat(hypBeta);
    const s = parseFloat(hypSe);
    if (!isNaN(b) && !isNaN(s) && s > 0) {
      setResult(simulateImpact(-0.24, 0.07, 4, b, s));
    }
  };

  return (
    <div style={{ marginTop: 20, padding: "14px 16px", background: T.raised, borderRadius: 8, border: `1px solid ${T.borderLt}` }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Impact Simulation</div>
      <div style={{ fontSize: 11, color: T.ink2, marginBottom: 10 }}>
        Preview effect of adding hypothetical evidence to the weakest edge. IVW posterior update.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
        <div>
          <label style={{ fontSize: 10, color: T.ink2, display: "block", marginBottom: 3 }}>Hyp. β</label>
          <input value={hypBeta} onChange={(e) => setHypBeta(e.target.value)}
            style={{ width: "100%", padding: "5px 8px", fontSize: 11, fontFamily: T.mono, border: `1px solid ${T.border}`, borderRadius: 3, outline: "none" }} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: T.ink2, display: "block", marginBottom: 3 }}>Hyp. SE</label>
          <input value={hypSe} onChange={(e) => setHypSe(e.target.value)}
            style={{ width: "100%", padding: "5px 8px", fontSize: 11, fontFamily: T.mono, border: `1px solid ${T.border}`, borderRadius: 3, outline: "none" }} />
        </div>
        <button onClick={run} style={{ padding: "5px 14px", fontSize: 11, fontWeight: 600, background: T.ink, color: T.bg, border: "none", borderRadius: 4, cursor: "pointer", fontFamily: T.sans }}>
          Preview
        </button>
      </div>
      {result && (
        <div style={{ marginTop: 12, padding: "12px 14px", background: T.bg, borderRadius: 6, border: `1px solid ${T.borderLt}` }}>
          <MiniForest before={result.before} after={result.after} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <div style={{ padding: "6px 10px", background: T.hiBg, borderRadius: 4, border: `1px solid ${T.hiLt}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: T.mono, color: T.hi }}>-{result.seReduction.toFixed(1)}%</div>
              <div style={{ fontSize: 9, color: T.hi, fontFamily: T.mono }}>SE reduction</div>
            </div>
            <div style={{ padding: "6px 10px", background: T.blueBg, borderRadius: 4, border: `1px solid ${T.blueLt}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: T.mono, color: T.blue }}>k={result.after.k}</div>
              <div style={{ fontSize: 9, color: T.blue, fontFamily: T.mono }}>New study count</div>
            </div>
            <div style={{ padding: "6px 10px", background: T.purpleBg, borderRadius: 4, border: `1px solid ${T.purpleLt}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: T.mono, color: T.purple }}>Δβ={Math.abs(result.after.beta - result.before.beta).toFixed(3)}</div>
              <div style={{ fontSize: 9, color: T.purple, fontFamily: T.mono }}>Beta shift</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Version history sparkline ─────────────────────────────────
const VERSION_HISTORY = [
  { v: "0.1", concordance: 0.71, edges: 42 },
  { v: "0.2", concordance: 0.76, edges: 58 },
  { v: "0.3", concordance: 0.80, edges: 72 },
  { v: "0.4", concordance: 0.84, edges: 82 },
  { v: "0.5", concordance: 0.86, edges: 88 },
  { v: "1.0", concordance: 0.84, edges: 91 },
];

export default function DiscoveryWorkspace() {
  const [filter, setFilter] = useState<"all" | "Chain" | "Sparse" | "Population">("all");
  const [sel, setSel] = useState<PriorityItem>(PRIORITIES[0]);

  const filtered = useMemo(() => (filter === "all" ? PRIORITIES : PRIORITIES.filter((p) => p.type === filter)), [filter]);
  const counts = { all: PRIORITIES.length, Chain: PRIORITIES.filter((p) => p.type === "Chain").length, Sparse: PRIORITIES.filter((p) => p.type === "Sparse").length, Population: PRIORITIES.filter((p) => p.type === "Population").length };

  const filterBtn = (f: "all" | "Chain" | "Sparse" | "Population", label: string) => (
    <button
      key={f}
      onClick={() => setFilter(f)}
      style={{
        padding: "4px 10px", fontSize: 10, fontFamily: T.mono, fontWeight: filter === f ? 600 : 400,
        border: `1px solid ${filter === f ? T.ink : T.border}`, borderRadius: 3, cursor: "pointer",
        background: filter === f ? T.ink : "transparent", color: filter === f ? T.bg : T.ink2,
      }}
    >
      {label} ({counts[f]})
    </button>
  );

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* LEFT: Queue */}
      <div style={{ width: 400, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", flexShrink: 0, background: "rgba(248,250,252,0.6)", backdropFilter: "blur(6px)" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.ink2, fontFamily: T.mono, marginBottom: 6 }}>
            PRIORITY QUEUE · {PRIORITIES.length} items
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {filterBtn("all", "All")}
            {filterBtn("Chain", "Chains")}
            {filterBtn("Sparse", "Sparse")}
            {filterBtn("Population", "Pop")}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map((p) => (
            <div
              key={p.rank}
              onClick={() => setSel(p)}
              style={{
                padding: "12px 14px",
                cursor: "pointer",
                borderBottom: `1px solid ${T.borderLt}`,
                background: sel.rank === p.rank ? T.blueBg : "transparent",
                borderLeft: sel.rank === p.rank ? `3px solid ${T.blue}` : "3px solid transparent",
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Mono style={{ fontSize: 10, fontWeight: 700, color: T.ink3 }}>#{p.rank}</Mono>
                    <Pill color={p.color}>{p.cls}</Pill>
                    <Pill>{p.type}</Pill>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.ink, fontFamily: T.mono, lineHeight: 1.4 }}>{p.title}</div>
                  {p.z != null && <Mono style={{ fontSize: 10, color: T.ink3, marginTop: 2, display: "inline-block" }}>Z={p.z}</Mono>}
                </div>
                <div style={{ flexShrink: 0 }}>
                  <div
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: `conic-gradient(${p.color} ${(p.score / 100) * 360}deg, ${T.borderLt} 0deg)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: sel.rank === p.rank ? T.blueBg : T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, fontFamily: T.mono, color: T.ink }}>
                      {p.score}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: Detail */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, fontFamily: T.mono, letterSpacing: "-0.02em", color: T.ink, marginBottom: 6 }}>{sel.title}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill color={sel.color}>{sel.cls}</Pill>
            <Pill>{sel.type}</Pill>
            {sel.z != null && <Pill>Z = {sel.z}</Pill>}
            <Pill color={T.ink2}>Priority: {sel.score}/100</Pill>
          </div>
        </div>

        {sel.metrics && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${sel.metrics.length}, 1fr)`, gap: 10, marginBottom: 16 }}>
            {sel.metrics.map((m, i) => (
              <div key={i} style={{ padding: "10px 12px", background: T.raised, borderRadius: 6, border: `1px solid ${T.borderLt}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: T.mono, color: m.color || T.ink }}>{m.value}</div>
                <div style={{ fontSize: 9, color: T.ink2, fontFamily: T.mono, marginTop: 2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            fontSize: 12,
            color: T.ink,
            lineHeight: 1.7,
            padding: "14px 16px",
            background: T.raised,
            borderRadius: 6,
            borderLeft: `3px solid ${sel.color}`,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: sel.color, marginBottom: 6, letterSpacing: "0.02em" }}>MECHANISTIC DIAGNOSIS</div>
          {sel.detail}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Suggested Evidence Searches</div>
          {sel.searches.map((q, i) => (
            <div key={i} style={{ padding: "8px 12px", marginBottom: 6, background: T.raised, borderRadius: 5, border: `1px solid ${T.borderLt}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Mono style={{ fontSize: 10, color: T.blue, fontWeight: 600, flexShrink: 0 }}>Q{i + 1}</Mono>
              <Mono style={{ fontSize: 11, color: T.ink }}>{q}</Mono>
            </div>
          ))}
        </div>

        <ImpactPanel />

        {/* Self-improvement loop */}
        <div style={{ marginTop: 24, padding: "14px 16px", background: T.raised, borderRadius: 8, border: `1px solid ${T.borderLt}` }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Self-Improvement Evidence Loop</div>
          <div style={{ fontSize: 10, color: T.ink2, marginBottom: 10 }}>
            Cumulative model progression. Chain-vs-direct concordance as quality metric.
          </div>
          <svg width="100%" height="120" viewBox="0 0 500 120">
            {VERSION_HISTORY.map((v, i) => {
              const x = 40 + i * ((500 - 80) / (VERSION_HISTORY.length - 1));
              const y = 90 - (v.concordance - 0.65) * 250;
              return (
                <g key={i}>
                  {i > 0 && (
                    <line
                      x1={40 + (i - 1) * ((500 - 80) / (VERSION_HISTORY.length - 1))}
                      y1={90 - (VERSION_HISTORY[i - 1].concordance - 0.65) * 250}
                      x2={x}
                      y2={y}
                      stroke={T.hi}
                      strokeWidth={2}
                    />
                  )}
                  <circle cx={x} cy={y} r={i === VERSION_HISTORY.length - 1 ? 5 : 3.5} fill={T.hi} />
                  <text x={x} y={y - 10} textAnchor="middle" style={{ fontSize: 9, fill: T.hi, fontFamily: T.mono, fontWeight: 600 }}>{v.concordance.toFixed(2)}</text>
                  <text x={x} y={110} textAnchor="middle" style={{ fontSize: 9, fill: T.ink3, fontFamily: T.mono }}>v{v.v}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
