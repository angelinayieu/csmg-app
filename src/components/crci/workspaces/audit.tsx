"use client";

import React, { useState } from "react";
import { T } from "../tokens";
import { Mono, Pill } from "../ui";

// ─── Event data ──────────────────────────────────────────────────
interface AuditEvent {
  id: string;
  ts: string;
  type: "edge_update" | "extraction" | "simulation" | "search" | "chain_validation" | "model_version" | "source_add";
  severity: "info" | "warning";
  headline: string;
  sub: string;
  steps: { title: string; desc: string; status: "complete" | "pass" | "warning" | "skipped" }[];
  calibration?: { raw: number; final: number; layers: { id: string; name: string; value: number; op: "×" | "÷" | "+"; reason: string }[] };
}

const EVENTS: AuditEvent[] = [
  {
    id: "E001",
    ts: "2026-04-15 14:23:00",
    type: "edge_update",
    severity: "info",
    headline: "Edge ER_CHEMO_IL6 updated: β 0.40 → 0.42, SE 0.09 → 0.08",
    sub: "Added Zhao 2024 (R168) — k=7→8",
    steps: [
      { title: "Record ingestion", desc: "Paper R168 (Zhao 2024) loaded via Evidence Registry. DOI: 10.1016/j.bbi.2024.03.012", status: "complete" },
      { title: "Effect-size extraction", desc: "Extracted: IL-6 post-chemo increase, d=0.48, 95% CI [0.31, 0.65], N=142, breast cancer, AC regimen, 3-month post-treatment", status: "complete" },
      { title: "Trust boundary (4/4 gates)", desc: "|d|=0.48 ≤ 5 ✓ | N=142 > 0 ✓ | p=0.001 ∈ [0,1] ✓ | CI width > 0 ✓", status: "pass" },
      { title: "SE derivation cascade", desc: "Level L2: CI-derived. SE = (0.65-0.31)/(2×1.96) = 0.087. Inflation: ×1.05 → SE_raw = 0.091", status: "complete" },
      { title: "7-layer calibration", desc: "SE_eff = 0.082 after full calibration pipeline", status: "complete" },
      { title: "IVW meta-analytic update", desc: "Random-effects model (I²=61% > 50%). k=7→8, β=0.40→0.42, SE=0.09→0.08", status: "complete" },
      { title: "Downstream impact", desc: "4 chains through this edge recalculated. Max concordance shift: +0.02", status: "complete" },
    ],
    calibration: {
      raw: 0.091,
      final: 0.082,
      layers: [
        { id: "L1", name: "Study design", value: 1.15, op: "×", reason: "Prospective cohort (not RCT)" },
        { id: "L2", name: "Population scope", value: 0.85, op: "÷", reason: "4/5 dimensions match → weight 0.85" },
        { id: "L3", name: "Statistical τ²", value: 0.003, op: "+", reason: "REML estimate (I²=61%): τ²=0.003 additive" },
        { id: "L4", name: "Measurement", value: 1.10, op: "×", reason: "1 conversion step: d → β (+10% SE)" },
        { id: "L5", name: "GRADE quality", value: 1.15, op: "×", reason: "Moderate: adequate blinding, minor attrition" },
        { id: "L6", name: "Temporal match", value: 1.00, op: "×", reason: "3-month post-treatment matches edge timeframe" },
        { id: "L7", name: "Freshness decay", value: 0.97, op: "÷", reason: "Published 2024, decay 0.97" },
      ],
    },
  },
  {
    id: "E002",
    ts: "2026-04-15 14:22:00",
    type: "extraction",
    severity: "info",
    headline: "Paper extraction: Zhao 2024 (3 claims, 3/3 trust boundary pass)",
    sub: "Manual import via Evidence Registry",
    steps: [
      { title: "Full text retrieval", desc: "9-API pipeline: PubMed (hit), Europe PMC (hit), Unpaywall (OA gold). Full PDF via Unpaywall.", status: "complete" },
      { title: "11-prompt LLM pipeline", desc: "Prompts 1-3: edge ID, effect extraction, moderator coding. Prompt 4: GRADE assessment (Moderate). Prompts 5-8: dose-response (skipped, observational). Prompts 9-11: cross-validation.", status: "complete" },
      { title: "Trust boundary (all 3 claims)", desc: "Claim 1: IL-6 d=0.48. Claim 2: CRP d=0.33. Claim 3: IL-6→FACT-Cog r=-0.38. All passed 4-gate plausibility.", status: "pass" },
      { title: "Database loading", desc: "3 records created: R166 (Chemo→CRP), R167 (IL-6→Cognition), R168 (Chemo→IL-6). Edge parameters scheduled for recomputation.", status: "complete" },
    ],
  },
  {
    id: "E003",
    ts: "2026-04-15 14:20:00",
    type: "simulation",
    severity: "info",
    headline: "Simulation: Reference patient (BCA/AC, 55F), M=10,000 — Exercise rank 1 (P=0.87)",
    sub: "Simulation Console auto-run",
    steps: [
      { title: "Profile configuration", desc: "Cancer: Breast. Regimen: AC. Age: 55. Phase: Early survivorship. Activity: Sedentary. Sleep: Fair. Biomarkers: IL-6=1.8z, Cortisol=0.6z", status: "complete" },
      { title: "Context-matched prior loading", desc: "Loaded: breast_earlysurvivorship prior set. Exact match, no fallback needed.", status: "complete" },
      { title: "MC sampling", desc: "M=10,000 draws. Seed=42. Edge sampling: N(β, SE²) × Bernoulli(P_incl). Duration: 847ms.", status: "complete" },
      { title: "State estimation", desc: "Composite CRCI z=-0.48 [-0.85, -0.11]. ProcSpeed: z=-0.82. Obs-driven: 58%.", status: "complete" },
      { title: "Intervention ranking", desc: "#1 Exercise +0.31 [0.12, 0.50] P(rank1)=0.87. #2 CBT-I +0.22. #3 MBSR +0.18.", status: "complete" },
    ],
  },
  {
    id: "E004",
    ts: "2026-04-15 13:45:00",
    type: "chain_validation",
    severity: "warning",
    headline: "Chain DISCORDANT: OIC→Fatigue→ProcSpeed (Z=1.64). SE inflated ×1.5.",
    sub: "Chain validation protocol — flagged for Discovery Engine",
    steps: [
      { title: "β_chain computation", desc: "β_chain = β(OIC→Fatigue) × β(Fatigue→ProcSpeed) = 0.38 × (-0.24) = -0.091", status: "complete" },
      { title: "β_direct lookup", desc: "β_direct(OIC→ProcSpeed) = -0.24 from k=25 studies (direct pathway).", status: "complete" },
      { title: "Classification", desc: "Z=1.64 ∈ [1.5, 2.0) → MONITOR. Direction: β_chain < β_direct → missing parallel pathways. Failure mode: Missing mediator.", status: "warning" },
      { title: "SE inflation applied", desc: "Fatigue→ProcSpeed edge SE inflated: 0.07 × 1.2 = 0.084. Downstream predictions widened accordingly.", status: "complete" },
      { title: "Discovery Engine flag", desc: "Added to priority queue rank #1. Suggested parallel pathways: sleep fragmentation, autonomic dysregulation, motivational deficit.", status: "complete" },
    ],
  },
  {
    id: "E005",
    ts: "2026-04-15 12:30:00",
    type: "model_version",
    severity: "info",
    headline: "Model v1.0 compiled: 91 edges, 168 records, concordance 0.84, 18 testable chains",
    sub: "Full recompilation — 21-pathway model",
    steps: [
      { title: "Edge recompilation", desc: "91 edges via IVW meta-analysis. Fixed-effects: 48 edges (I²<50%). Random-effects: 38 edges (I²≥50%). Single-source: 24. Structural: 28.", status: "complete" },
      { title: "Chain validation", desc: "18 testable chains evaluated. 9 concordant (50%), 5 marginal (28%), 4 discordant (22%). Mean concordance ratio: 0.84.", status: "complete" },
      { title: "Complexity calibration", desc: "Optimal zone confirmed: Levels 3-5 (3-11 pathways). Peak at Level 4 (0.88). Current model (Level 7): 0.84.", status: "complete" },
      { title: "Publication bias diagnostics", desc: "Egger's test applied to 8 edges with k≥10. 2 edges showed asymmetry (p<0.10). Trim-and-fill adjustment applied.", status: "complete" },
    ],
  },
  {
    id: "E006",
    ts: "2026-04-14 09:15:00",
    type: "edge_update",
    severity: "warning",
    headline: "Edge ER_ACT_BDNF flagged: I²=68%, conflicting RCTs, CrI spans zero",
    sub: "Heterogeneity review — Exercise→BDNF",
    steps: [
      { title: "Heterogeneity detected", desc: "I²=68% exceeds 50% threshold. Random-effects model applied. Between-study τ²=0.008.", status: "warning" },
      { title: "Study-level decomposition", desc: "Irwin 2021 (BCA, N=136): d=0.02 (NULL). Hartman 2019 (BCA, N=87): d=0.08 (NULL). Ng 2025 (AYA, N=68): r=0.31 (POSITIVE).", status: "warning" },
      { title: "Impact assessment", desc: "CrI spans zero: [-0.06, 0.34]. Neuroplasticity-mediated intervention effects carry appropriately wider posteriors.", status: "complete" },
      { title: "Flagged for Discovery Engine", desc: "Added to priority queue as Type B sparse-marginal edge. Suggested: AYA-specific or exercise-intensity-stratified BDNF studies.", status: "complete" },
    ],
  },
];

const TYPE_CFG: Record<string, { bg: string; color: string; icon: string; label: string }> = {
  edge_update: { bg: T.blueBg, color: T.blue, icon: "Δ", label: "Edge" },
  extraction: { bg: T.purpleBg, color: T.purple, icon: "⇩", label: "Extract" },
  simulation: { bg: T.hiBg, color: T.hi, icon: "▷", label: "Simulation" },
  search: { bg: T.cyanBg, color: T.cyan, icon: "⌕", label: "Search" },
  chain_validation: { bg: T.midBg, color: T.mid, icon: "≣", label: "Chain" },
  model_version: { bg: T.raised, color: T.ink, icon: "V", label: "Version" },
  source_add: { bg: T.hiBg, color: T.hi, icon: "+", label: "Source" },
};

function CalibrationWaterfall({ cal }: { cal: NonNullable<AuditEvent["calibration"]> }) {
  return (
    <div style={{ marginTop: 12, padding: "12px 14px", background: T.bg, borderRadius: 6, border: `1px solid ${T.borderLt}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>7-Layer SE Calibration</div>
      <Mono style={{ fontSize: 9, color: T.ink3, display: "block", marginBottom: 10 }}>
        SE_eff = √[SE²_raw × L1² × L5² × L6² + L3] / (L2 × L7) × L4
      </Mono>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 76px", gap: 8, alignItems: "center" }}>
          <Mono style={{ fontSize: 10, color: T.ink2, textAlign: "right" }}>SE_raw</Mono>
          <div style={{ height: 10, borderRadius: 2, background: T.ink3, width: `${(cal.raw / 0.15) * 100}%` }} />
          <Mono style={{ fontSize: 10, fontWeight: 600 }}>{cal.raw.toFixed(4)}</Mono>
        </div>
        {cal.layers.map((l) => {
          const isNeg = l.value < 1 || l.op === "÷";
          const barColor = isNeg ? T.hi : l.value > 1.1 ? T.lo : l.value > 1.0 ? T.mid : T.ink3;
          return (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 76px", gap: 8, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <Mono style={{ fontSize: 10, color: barColor, fontWeight: 600 }}>{l.id}</Mono>
                <div style={{ fontSize: 8, color: T.ink3 }}>{l.name}</div>
              </div>
              <div style={{ height: 18, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 4, height: 10, borderRadius: 2, background: barColor, opacity: 0.2, width: "100%" }} />
                <div style={{ position: "absolute", left: 0, top: 4, height: 10, borderRadius: 2, background: barColor, opacity: 0.65, width: `${Math.min(100, (l.value / 2) * 100)}%` }} />
                <span style={{ position: "absolute", right: 4, top: 0, fontSize: 8, color: T.ink3, fontFamily: T.mono }}>
                  {l.op === "+" ? `+${l.value}` : l.op === "÷" ? `÷${(1 / l.value).toFixed(2)}` : `×${l.value.toFixed(2)}`}
                </span>
              </div>
              <div style={{ fontSize: 9, color: T.ink2, lineHeight: 1.3 }}>
                {l.reason.slice(0, 38)}
                {l.reason.length > 38 ? "…" : ""}
              </div>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 76px", gap: 8, alignItems: "center", marginTop: 4, paddingTop: 6, borderTop: `1px solid ${T.border}` }}>
          <Mono style={{ fontSize: 10, color: T.blue, fontWeight: 700, textAlign: "right" }}>SE_eff</Mono>
          <div style={{ height: 10, borderRadius: 2, background: T.blue, width: `${(cal.final / 0.15) * 100}%` }} />
          <Mono style={{ fontSize: 12, fontWeight: 700, color: T.blue }}>{cal.final.toFixed(4)}</Mono>
        </div>
      </div>
    </div>
  );
}

function EventCard({ event, expanded, onToggle }: { event: AuditEvent; expanded: boolean; onToggle: () => void }) {
  const cfg = TYPE_CFG[event.type];
  return (
    <div style={{ borderBottom: `1px solid ${T.borderLt}` }}>
      <div
        onClick={onToggle}
        style={{
          padding: "12px 18px",
          cursor: "pointer",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          background: expanded ? T.blueBg : "transparent",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = T.hover;
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = "transparent";
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: cfg.bg,
            border: `1px solid ${cfg.color}30`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 700,
            color: cfg.color,
            fontFamily: T.mono,
            flexShrink: 0,
          }}
        >
          {cfg.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <Mono style={{ fontSize: 9, color: T.ink3 }}>{event.ts}</Mono>
            <Pill color={T.ink3}>{cfg.label}</Pill>
            {event.severity === "warning" && <Pill color={T.mid} bg={T.midLt}>FLAGGED</Pill>}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink, lineHeight: 1.4 }}>{event.headline}</div>
          <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>{event.sub}</div>
        </div>
        <span style={{ color: T.ink3, fontSize: 10, transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s", flexShrink: 0 }}>
          ▶
        </span>
      </div>
      {expanded && (
        <div style={{ padding: "0 18px 16px 60px" }}>
          {event.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20, flexShrink: 0 }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: s.status === "pass" ? T.hiBg : s.status === "warning" ? T.midBg : s.status === "skipped" ? T.raised : T.blueBg,
                    border: `1.5px solid ${s.status === "pass" ? T.hi : s.status === "warning" ? T.mid : s.status === "skipped" ? T.border : T.blue}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: T.mono,
                    color: s.status === "pass" ? T.hi : s.status === "warning" ? T.mid : T.blue,
                  }}
                >
                  {s.status === "pass" ? "✓" : s.status === "warning" ? "!" : s.status === "skipped" ? "—" : i + 1}
                </div>
                {i < event.steps.length - 1 && <div style={{ width: 1, flex: 1, background: T.borderLt, minHeight: 8 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: T.ink, marginBottom: 2 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: T.ink2, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            </div>
          ))}
          {event.calibration && <CalibrationWaterfall cal={event.calibration} />}
        </div>
      )}
    </div>
  );
}

// ─── Source ingestion panel ─────────────────────────────────────
const INGESTION_STAGES = [
  "URL Resolution",
  "Metadata Fetch",
  "Full Text Retrieval",
  "Edge Identification",
  "Effect Extraction",
  "Moderator Coding",
  "Quality Assessment",
  "Trust Boundary",
  "SE Cascade",
  "7-Layer Calibration",
  "Database Load",
];

function IngestionPanel() {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ title: string; claims: number; grade: string } | null>(null);

  const run = () => {
    if (!url.trim()) return;
    setRunning(true);
    setStage(0);
    setResult(null);
    let s = 0;
    const tick = () => {
      s++;
      setStage(s);
      if (s < 11) setTimeout(tick, 180 + Math.random() * 220);
      else {
        setRunning(false);
        setResult({ title: "Simulated Paper: " + url.split("/").pop(), claims: 3, grade: "Moderate" });
      }
    };
    setTimeout(tick, 300);
  };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 720 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Source Link Ingestion</div>
      <div style={{ fontSize: 11, color: T.ink2, marginBottom: 14, lineHeight: 1.6 }}>
        Paste a DOI, PubMed URL, or direct link. The system resolves metadata, runs the 11-prompt LLM extraction
        pipeline, and shows results for human review before database loading.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="e.g. 10.1016/j.bbi.2024.03.012"
          style={{
            flex: 1,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: T.mono,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            outline: "none",
            color: T.ink,
          }}
        />
        <button
          onClick={run}
          disabled={running || !url.trim()}
          style={{
            padding: "8px 20px",
            fontSize: 12,
            fontWeight: 600,
            background: running ? T.raised : T.ink,
            color: running ? T.ink2 : T.bg,
            border: "none",
            borderRadius: 6,
            cursor: running ? "wait" : "pointer",
            whiteSpace: "nowrap",
            boxShadow: running ? "none" : "0 4px 14px rgba(15,23,42,0.18)",
          }}
        >
          {running ? "Processing…" : "Extract"}
        </button>
      </div>

      {(running || result) && (
        <div style={{ padding: "14px 16px", background: T.raised, borderRadius: 8, border: `1px solid ${T.borderLt}`, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10 }}>11-Stage Extraction Pipeline</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {INGESTION_STAGES.map((name, i) => {
              const idx = i + 1;
              const done = stage >= idx;
              const active = stage === idx && running;
              return (
                <div
                  key={name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr 70px",
                    gap: 10,
                    alignItems: "center",
                    padding: "5px 8px",
                    borderRadius: 4,
                    background: active ? T.blueBg : "transparent",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: T.mono,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: done ? T.hi : active ? T.blue : T.borderLt,
                      color: done || active ? T.bg : T.ink3,
                      transition: "all 0.2s",
                    }}
                  >
                    {done ? "✓" : idx}
                  </div>
                  <Mono style={{ fontSize: 11, color: done ? T.ink : active ? T.blue : T.ink3, fontWeight: done ? 500 : 400 }}>{name}</Mono>
                  <Mono style={{ fontSize: 9, color: done ? T.hi : active ? T.blue : T.ink3, textAlign: "right" }}>
                    {done ? "complete" : active ? "running" : "—"}
                  </Mono>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result && (
        <div style={{ padding: "16px 18px", background: T.bg, borderRadius: 8, border: `1px solid ${T.border}`, boxShadow: "0 2px 6px rgba(15,23,42,0.04)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Extraction Results</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.ink }}>{result.title}</div>
              <div style={{ fontSize: 10, color: T.ink2, marginTop: 2 }}>Author et al., 2024 · Brain, Behavior, and Immunity</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <div style={{ padding: "8px 14px", background: T.hiBg, borderRadius: 5, border: `1px solid ${T.hiLt}`, textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.hi, fontFamily: T.mono }}>{result.claims}</div>
                <div style={{ fontSize: 9, color: T.hi, fontFamily: T.mono }}>Claims</div>
              </div>
              <div style={{ padding: "8px 14px", background: T.hiBg, borderRadius: 5, border: `1px solid ${T.hiLt}`, textAlign: "center" }}>
                <Mono style={{ fontSize: 14, fontWeight: 700, color: T.hi }}>{result.grade}</Mono>
                <div style={{ fontSize: 9, color: T.hi, fontFamily: T.mono, marginTop: 2 }}>GRADE</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={{ flex: 1, padding: "10px", fontSize: 12, fontWeight: 600, background: T.hi, color: T.bg, border: "none", borderRadius: 5, cursor: "pointer" }}>
              Approve & Load to Evidence Base
            </button>
            <button style={{ padding: "10px 20px", fontSize: 11, fontWeight: 500, background: "transparent", color: T.lo, border: `1px solid ${T.lo}`, borderRadius: 5, cursor: "pointer" }}>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditWorkspace() {
  const [view, setView] = useState<"timeline" | "ingest">("timeline");
  const [expanded, setExpanded] = useState<string | null>("E001");
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? EVENTS : EVENTS.filter((e) => e.type === filter);

  const tabStyle = (v: string) => ({
    padding: "8px 18px",
    fontSize: 11,
    fontWeight: view === v ? 600 : 400,
    fontFamily: T.sans,
    color: view === v ? T.ink : T.ink2,
    borderBottom: view === v ? `2px solid ${T.ink}` : "2px solid transparent",
    cursor: "pointer",
    background: "none",
    border: "none",
    letterSpacing: "0.02em",
  });

  const fBtn = (f: string, label: string): React.CSSProperties => ({
    padding: "4px 10px",
    fontSize: 9,
    fontFamily: T.mono,
    fontWeight: filter === f ? 600 : 400,
    border: `1px solid ${filter === f ? T.ink : T.border}`,
    borderRadius: 3,
    cursor: "pointer",
    background: filter === f ? T.ink : "transparent",
    color: filter === f ? T.bg : T.ink2,
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, paddingLeft: 20, flexShrink: 0 }}>
        <button style={tabStyle("timeline")} onClick={() => setView("timeline")}>Event Timeline</button>
        <button style={tabStyle("ingest")} onClick={() => setView("ingest")}>Source Ingestion</button>
      </div>

      {view === "timeline" ? (
        <>
          <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.borderLt}`, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "rgba(255,255,255,0.7)", backdropFilter: "blur(8px)", flexShrink: 0 }}>
            <Mono style={{ fontSize: 10, color: T.ink2, marginRight: 6 }}>3-tier disclosure · click to expand</Mono>
            <div style={{ width: 1, height: 16, background: T.border }} />
            {[["all", "All"], ["edge_update", "Edge"], ["extraction", "Extract"], ["simulation", "Sim"], ["chain_validation", "Chain"], ["model_version", "Version"]].map(([f, l]) => (
              <button key={f} style={fBtn(f, l)} onClick={() => setFilter(f)}>
                {l}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <Pill>{EVENTS.length} events</Pill>
            <Pill color={T.mid}>{EVENTS.filter((e) => e.severity === "warning").length} flagged</Pill>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.map((evt) => (
              <EventCard
                key={evt.id}
                event={evt}
                expanded={expanded === evt.id}
                onToggle={() => setExpanded(expanded === evt.id ? null : evt.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <IngestionPanel />
        </div>
      )}
    </div>
  );
}
