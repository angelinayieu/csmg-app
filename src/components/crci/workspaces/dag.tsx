"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { T } from "../tokens";
import { Mono, Pill } from "../ui";

/* ═══════════════════════════════════════════════════════════════════════
   CRCI 7-LAYER DAG EXPLORER
   Explicit-band layered layout (L0 → L6) with semantic shapes:
     · Rectangles = observable
     · Diamonds   = latent pathways
   Labels inside nodes, aggregate biomarker panels, k-evidence dots,
   bezier edges with sign/evidence encoding, L3 overflow row.
   ═══════════════════════════════════════════════════════════════════════ */

const FONT = "'IBM Plex Sans',-apple-system,sans-serif";
const MONO = "'IBM Plex Mono',monospace";
const C = {
  ink: "#0F172A", ink2: "#475569", ink3: "#94A3B8", ink4: "#CBD5E1",
  bg: "#FFFFFF", band: "#F6F7F8", border: "#D4D4D4", borderLt: "#E8E8E8",
  nodeFill: "#FFFFFF", nodeStroke: "#B0B0B0",
  latentFill: "#F4F4F5", latentStroke: "#9A9A9A",
  selFill: "#E8F0FE", selStroke: "#2563EB",
  hi: "#166534", mid: "#92400E", lo: "#991B1B",
  blue: "#2563EB", edgeDef: "#888", edgeNeg: "#C0392B",
  dot: "#DDD",
};

// Band Y positions (top of label) — L3 is wider for overflow row
const LY = [46, 148, 258, 395, 540, 648, 770];
const LL = [
  "L0  Exogenous Inputs",
  "L1  Modifiable Behaviors",
  "L2  Biological Mediators",
  "L3  Mechanistic Pathways",
  "L4  Symptom Clusters",
  "L5  Cognitive Domains",
  "L6  Composite Outcome",
];

interface DNode {
  id: string;
  x: number;
  y: number;
  label: string;
  obs: boolean;
  L: number;
  wide?: boolean;
  dashed?: boolean;
}

interface DEdge {
  s: string;
  t: string;
  w: number;
  sign: 1 | -1;
  k: number | null;
}

// ─── Nodes: banded layout, aggregate L2 panels, M1-M16 pathways ────
const NODES: DNode[] = [
  // L0 Exogenous
  { id: "N01", x: 135, y: LY[0], label: "Chemotherapy", obs: true, L: 0 },
  { id: "N02", x: 270, y: LY[0], label: "Radiation", obs: true, L: 0 },
  { id: "N03", x: 400, y: LY[0], label: "Cancer Type\n& Stage", obs: true, L: 0 },
  { id: "N04", x: 540, y: LY[0], label: "Treatment\nPhase", obs: true, L: 0 },
  { id: "N05", x: 700, y: LY[0], label: "Age \u00B7 Sex", obs: true, L: 0 },
  { id: "N06", x: 840, y: LY[0], label: "APOE\nGenotype", obs: true, L: 0 },
  { id: "N07", x: 960, y: LY[0], label: "Comorbidity", obs: true, L: 0 },
  // L1 Modifiable Behaviors
  { id: "N10", x: 110, y: LY[1], label: "Physical\nActivity", obs: true, L: 1 },
  { id: "N11", x: 270, y: LY[1], label: "Diet", obs: true, L: 1 },
  { id: "N12", x: 420, y: LY[1], label: "Sleep\nQuality", obs: true, L: 1 },
  { id: "N13", x: 580, y: LY[1], label: "Stress\nMgmt", obs: true, L: 1 },
  { id: "N14", x: 720, y: LY[1], label: "Social", obs: true, L: 1 },
  { id: "N15", x: 860, y: LY[1], label: "Cognitive\nTraining", obs: true, L: 1 },
  // L2 Biomarker aggregate panels
  { id: "BI", x: 160, y: LY[2], label: "IL-6 \u00B7 CRP\nTNF-\u03B1 \u00B7 MDA", obs: true, L: 2, wide: true },
  { id: "BN", x: 410, y: LY[2], label: "Cortisol\nSlope", obs: true, L: 2 },
  { id: "BP", x: 620, y: LY[2], label: "BDNF \u00B7 NfL", obs: true, L: 2 },
  { id: "BM", x: 850, y: LY[2], label: "p16 \u00B7 Glucose\n\u03B3-H2AX \u00B7 Shannon", obs: true, L: 2, wide: true },
  // L3 Pathways — primary row
  { id: "M1", x: 95, y: LY[3], label: "M1\nNeuro-\ninflam.", obs: false, L: 3 },
  { id: "M2", x: 190, y: LY[3], label: "M2\nOxidative\nStress", obs: false, L: 3 },
  { id: "M3", x: 295, y: LY[3], label: "M3\nHPA\nDysreg.", obs: false, L: 3 },
  { id: "M4", x: 395, y: LY[3], label: "M4\nNeuro-\nplasticity\u2193", obs: false, L: 3 },
  { id: "M5", x: 480, y: LY[3], label: "M5\nNeuro-\ngenesis\u2193", obs: false, L: 3, dashed: true },
  { id: "M6", x: 555, y: LY[3], label: "M6\nMito.\nDysfn", obs: false, L: 3 },
  { id: "M7", x: 630, y: LY[3], label: "M7\nDNA\nDamage", obs: false, L: 3 },
  { id: "M8", x: 705, y: LY[3], label: "M8\nGut-Brain", obs: false, L: 3 },
  { id: "M9", x: 780, y: LY[3], label: "M9\nSenescence", obs: false, L: 3 },
  { id: "M10", x: 855, y: LY[3], label: "M10\nGlymphatic", obs: false, L: 3 },
  { id: "M11", x: 930, y: LY[3], label: "M11\nCerebro-\nvascular\u2193", obs: false, L: 3, dashed: true },
  // L3 overflow row
  { id: "M12", x: 190, y: LY[3] + 58, label: "M12\nEpigenetic", obs: false, L: 3, dashed: true },
  { id: "M13", x: 555, y: LY[3] + 58, label: "M13\nMetabolic", obs: false, L: 3 },
  { id: "M14", x: 630, y: LY[3] + 58, label: "M14\nBBB", obs: false, L: 3 },
  { id: "M15", x: 395, y: LY[3] + 58, label: "M15\nSynaptic", obs: false, L: 3, dashed: true },
  { id: "M16", x: 480, y: LY[3] + 58, label: "M16\nMyelin", obs: false, L: 3 },
  // L4 Symptom clusters
  { id: "N40", x: 155, y: LY[4], label: "Fatigue", obs: true, L: 4 },
  { id: "N41", x: 340, y: LY[4], label: "Depression\nAnxiety", obs: true, L: 4 },
  { id: "N42", x: 530, y: LY[4], label: "Sleep\nDisturbance", obs: true, L: 4 },
  { id: "N43", x: 700, y: LY[4], label: "Pain", obs: true, L: 4 },
  { id: "N44", x: 860, y: LY[4], label: "Cog.\nComplaints", obs: true, L: 4 },
  // L5 Cognitive domains
  { id: "N50", x: 80, y: LY[5], label: "Attention", obs: true, L: 5 },
  { id: "N51", x: 210, y: LY[5], label: "Working\nMemory", obs: true, L: 5 },
  { id: "N52", x: 350, y: LY[5], label: "Episodic\nMemory", obs: true, L: 5 },
  { id: "N53", x: 490, y: LY[5], label: "Exec.\nFunction", obs: true, L: 5 },
  { id: "N54", x: 630, y: LY[5], label: "Processing\nSpeed", obs: true, L: 5 },
  { id: "N55", x: 770, y: LY[5], label: "Verbal\nFluency", obs: true, L: 5 },
  { id: "N56", x: 910, y: LY[5], label: "Visuospatial", obs: true, L: 5 },
  // L6 Composite
  { id: "N60", x: 490, y: LY[6], label: "CRCI\nComposite", obs: true, L: 6 },
];

const EDGES: DEdge[] = [
  // L0 → L2/L3
  { s: "N01", t: "BI", w: 2.5, sign: 1, k: 8 },
  { s: "N01", t: "BN", w: 1.0, sign: 1, k: 2 },
  { s: "N01", t: "BP", w: 0.8, sign: 1, k: 2 },
  { s: "N01", t: "BM", w: 1.2, sign: 1, k: 3 },
  { s: "N02", t: "BP", w: 0.7, sign: 1, k: 2 },
  { s: "N02", t: "BM", w: 0.6, sign: 1, k: 2 },
  { s: "N02", t: "M14", w: 0.6, sign: 1, k: 1 },
  { s: "N03", t: "M1", w: 0.5, sign: 1, k: 2 },
  { s: "N05", t: "N54", w: 0.6, sign: 1, k: 3 },
  { s: "N05", t: "N52", w: 0.5, sign: 1, k: 2 },
  { s: "N05", t: "M4", w: 0.4, sign: 1, k: 2 },
  { s: "N06", t: "M4", w: 0.4, sign: 1, k: 1 },
  { s: "N06", t: "N52", w: 0.4, sign: 1, k: 1 },
  // L1 → L2
  { s: "N10", t: "BI", w: 1.2, sign: -1, k: 4 },
  { s: "N10", t: "BP", w: 0.7, sign: 1, k: 3 },
  { s: "N10", t: "BN", w: 0.6, sign: -1, k: 2 },
  { s: "N11", t: "BI", w: 0.5, sign: -1, k: 2 },
  { s: "N11", t: "BM", w: 0.4, sign: -1, k: 1 },
  { s: "N12", t: "BN", w: 0.7, sign: -1, k: 2 },
  { s: "N12", t: "M10", w: 0.6, sign: 1, k: 1 },
  { s: "N13", t: "BN", w: 0.7, sign: -1, k: 2 },
  { s: "N13", t: "M3", w: 0.5, sign: -1, k: 2 },
  { s: "N15", t: "BP", w: 0.5, sign: 1, k: 1 },
  // L1 → L4 (direct)
  { s: "N10", t: "N40", w: 1.0, sign: -1, k: 4 },
  { s: "N13", t: "N41", w: 0.8, sign: -1, k: 2 },
  // L2 → L3
  { s: "BI", t: "M1", w: 2.5, sign: 1, k: 15 },
  { s: "BI", t: "M2", w: 1.5, sign: 1, k: 3 },
  { s: "BN", t: "M3", w: 1.5, sign: 1, k: 4 },
  { s: "BP", t: "M4", w: 1.2, sign: 1, k: 3 },
  { s: "BP", t: "M16", w: 0.8, sign: -1, k: 2 },
  { s: "BM", t: "M8", w: 0.8, sign: 1, k: 1 },
  { s: "BM", t: "M9", w: 1.0, sign: 1, k: 3 },
  { s: "BM", t: "M7", w: 0.9, sign: 1, k: 2 },
  { s: "BM", t: "M13", w: 0.6, sign: 1, k: 1 },
  // L3 internal (cross-pathway)
  { s: "M2", t: "M1", w: 0.7, sign: 1, k: 1 },
  { s: "M8", t: "M1", w: 0.5, sign: 1, k: 0 },
  { s: "M9", t: "M1", w: 0.4, sign: 1, k: 1 },
  { s: "M14", t: "M1", w: 0.4, sign: 1, k: 0 },
  { s: "M2", t: "M14", w: 0.5, sign: 1, k: 1 },
  { s: "M7", t: "M9", w: 0.6, sign: 1, k: 1 },
  // L3 → L4
  { s: "M1", t: "N40", w: 1.2, sign: 1, k: 6 },
  { s: "M3", t: "N41", w: 0.6, sign: 1, k: 2 },
  { s: "M3", t: "N42", w: 0.4, sign: 1, k: 2 },
  { s: "M6", t: "N40", w: 0.5, sign: 1, k: 1 },
  { s: "M9", t: "N40", w: 0.4, sign: 1, k: 1 },
  { s: "M1", t: "N41", w: 0.8, sign: 1, k: 3 },
  // L3 → L5
  { s: "M1", t: "N50", w: 1.5, sign: -1, k: 9 },
  { s: "M1", t: "N52", w: 1.2, sign: -1, k: 15 },
  { s: "M1", t: "N54", w: 1.8, sign: -1, k: 25 },
  { s: "M1", t: "N51", w: 0.8, sign: -1, k: 8 },
  { s: "M1", t: "N53", w: 0.5, sign: -1, k: 4 },
  { s: "M2", t: "N50", w: 0.6, sign: -1, k: 2 },
  { s: "M2", t: "N54", w: 0.7, sign: -1, k: 2 },
  { s: "M3", t: "N52", w: 0.8, sign: -1, k: 4 },
  { s: "M3", t: "N50", w: 0.5, sign: -1, k: 3 },
  { s: "M3", t: "N53", w: 0.4, sign: -1, k: 2 },
  { s: "M4", t: "N52", w: 1.0, sign: 1, k: 2 },
  { s: "M4", t: "N51", w: 0.7, sign: 1, k: 1 },
  { s: "M4", t: "N55", w: 0.4, sign: 1, k: 1 },
  { s: "M16", t: "N54", w: 0.8, sign: 1, k: 2 },
  { s: "M16", t: "N55", w: 0.5, sign: 1, k: 1 },
  { s: "M10", t: "N52", w: 0.4, sign: 1, k: 0 },
  { s: "M13", t: "N51", w: 0.5, sign: -1, k: 0 },
  { s: "M13", t: "N54", w: 0.5, sign: -1, k: 0 },
  // L4 → L5 (symptom → cognition)
  { s: "N40", t: "N50", w: 1.0, sign: -1, k: 3 },
  { s: "N40", t: "N54", w: 1.0, sign: -1, k: 4 },
  { s: "N40", t: "N51", w: 0.7, sign: -1, k: 2 },
  { s: "N41", t: "N51", w: 0.8, sign: -1, k: 3 },
  { s: "N41", t: "N52", w: 0.7, sign: -1, k: 2 },
  { s: "N41", t: "N53", w: 0.5, sign: -1, k: 2 },
  { s: "N41", t: "N44", w: 1.2, sign: 1, k: 5 },
  { s: "N42", t: "N50", w: 0.5, sign: -1, k: 2 },
  { s: "N42", t: "N52", w: 0.5, sign: -1, k: 2 },
  { s: "N42", t: "N51", w: 0.5, sign: -1, k: 2 },
  // L5 → L6
  { s: "N50", t: "N60", w: 1.2, sign: 1, k: null },
  { s: "N51", t: "N60", w: 1.0, sign: 1, k: null },
  { s: "N52", t: "N60", w: 1.0, sign: 1, k: null },
  { s: "N53", t: "N60", w: 1.0, sign: 1, k: null },
  { s: "N54", t: "N60", w: 1.2, sign: 1, k: null },
  { s: "N55", t: "N60", w: 0.7, sign: 1, k: null },
  { s: "N56", t: "N60", w: 0.5, sign: 1, k: null },
];

const nMap: Record<string, DNode> = {};
NODES.forEach((n) => { nMap[n.id] = n; });

// ─── Shape helpers ────────────────────────────────────────────────
interface RectDim { type: "rect"; w: number; h: number }
interface DiamondDim { type: "diamond"; s: number }
type Dim = RectDim | DiamondDim;

function dims(n: DNode): Dim {
  const lines = n.label.split("\n");
  if (!n.obs) return { type: "diamond", s: lines.length > 2 ? 26 : 22 };
  const w = n.wide ? 86 : lines.some((l) => l.length > 8) ? 72 : 60;
  const h = lines.length > 2 ? 38 : lines.length > 1 ? 28 : 22;
  return { type: "rect", w, h };
}

function dPts(cx: number, cy: number, s: number) {
  return `${cx},${cy - s} ${cx + s + 3},${cy} ${cx},${cy + s} ${cx - s - 3},${cy}`;
}
function bez(x1: number, y1: number, x2: number, y2: number) {
  const dy = y2 - y1, dx = x2 - x1;
  const off = Math.min(14, Math.abs(dx) * 0.04) * (dx >= 0 ? 1 : -1);
  return `M${x1},${y1} C${x1 + off},${y1 + dy * 0.4} ${x2 - off},${y1 + dy * 0.6} ${x2},${y2}`;
}
function kCol(k: number | null) {
  if (k == null) return C.ink4;
  if (k >= 3) return C.hi;
  if (k >= 1) return C.mid;
  return C.lo;
}

// ─── Pathway quick-filter presets ────────────────────────────────
const PATHWAYS: { name: string; nodes: string[] }[] = [
  { name: "Neuroinflammation", nodes: ["N01", "N10", "BI", "M1", "N40", "N50", "N52", "N54", "N51", "N60"] },
  { name: "HPA Axis", nodes: ["N01", "N13", "BN", "M3", "N41", "N42", "N51", "N52", "N60"] },
  { name: "Neuroplasticity", nodes: ["N10", "N15", "BP", "M4", "N51", "N52", "N55", "N60"] },
  { name: "Fatigue Loop", nodes: ["N10", "M1", "N40", "N50", "N54", "N60"] },
  { name: "Myelin", nodes: ["N01", "N02", "BP", "M16", "N54", "N55", "N60"] },
  { name: "Structural damage", nodes: ["N01", "N02", "BM", "M7", "M9", "M14", "N52", "N54"] },
];

export default function DagWorkspace({ onNavigate }: { onNavigate: (ws: string) => void }) {
  const VW = 1060;
  const VH = 860;
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hlPath, setHlPath] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const dr = useRef<{ x: number; y: number } | null>(null);

  const conn = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    EDGES.forEach((e) => {
      if (e.s === hover) s.add(e.t);
      if (e.t === hover) s.add(e.s);
    });
    return s;
  }, [hover]);

  const pathSet = useMemo(() => (hlPath ? new Set(hlPath) : null), [hlPath]);
  const searchSet = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    return new Set(NODES.filter((n) => n.label.toLowerCase().replace(/\n/g, " ").includes(q) || n.id.toLowerCase().includes(q)).map((n) => n.id));
  }, [search]);

  const dimSet = pathSet || searchSet;

  const onD = useCallback((e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest("[data-n]") || t.closest("[data-e]")) return;
    setDragging(true);
    dr.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);
  const onM = useCallback((e: React.MouseEvent) => {
    if (!dragging || !dr.current) return;
    setPan({ x: e.clientX - dr.current.x, y: e.clientY - dr.current.y });
  }, [dragging]);
  const onU = useCallback(() => setDragging(false), []);
  const onW = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.35, Math.min(2, z - e.deltaY * 0.001)));
  }, []);

  const selNode = sel ? nMap[sel] : null;
  const selIn = sel ? EDGES.filter((e) => e.t === sel) : [];
  const selOut = sel ? EDGES.filter((e) => e.s === sel) : [];

  const pBtn = (active: boolean): React.CSSProperties => ({
    padding: "3px 10px",
    fontSize: 9.5,
    border: `1px solid ${active ? C.ink : C.border}`,
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: MONO,
    background: active ? C.ink : "transparent",
    color: active ? C.bg : C.ink3,
    letterSpacing: "0.02em",
    fontWeight: active ? 600 : 500,
  });

  const linkBtn: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "7px 10px",
    fontSize: 10.5,
    fontWeight: 500,
    fontFamily: FONT,
    color: C.blue,
    background: "#EFF6FF",
    border: `1px solid #BFDBFE`,
    borderRadius: 5,
    cursor: "pointer",
    textAlign: "left",
    marginTop: 5,
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", fontFamily: FONT, color: C.ink, background: C.bg, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
      `}</style>

      {/* CANVAS */}
      <div
        style={{ flex: 1, position: "relative", overflow: "hidden", cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={onD}
        onMouseMove={onM}
        onMouseUp={onU}
        onMouseLeave={onU}
        onWheel={onW}
      >
        {/* Filter bar overlay */}
        <div style={{
          position: "absolute", top: 10, left: 10, right: 10, display: "flex", gap: 6, alignItems: "center",
          flexWrap: "wrap", zIndex: 5,
          padding: "7px 10px", background: "rgba(255,255,255,0.82)", backdropFilter: "blur(8px)",
          borderRadius: 8, border: `1px solid ${C.borderLt}`,
          boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
        }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter nodes..."
            style={{
              padding: "4px 10px", fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 4, width: 160,
              fontFamily: FONT, outline: "none", background: C.bg,
            }}
          />
          <div style={{ width: 1, height: 16, background: C.border }} />
          <button onClick={() => setHlPath(null)} style={pBtn(!hlPath)}>All</button>
          {PATHWAYS.map((pw) => (
            <button key={pw.name} onClick={() => setHlPath(hlPath === pw.nodes ? null : pw.nodes)} style={pBtn(hlPath === pw.nodes)}>
              {pw.name}
            </button>
          ))}
        </div>

        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <pattern
              id="dag-dots"
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${pan.x % 18},${pan.y % 18}) scale(${zoom})`}
            >
              <circle cx="9" cy="9" r="0.5" fill={C.dot} />
            </pattern>
            <marker id="dag-ap" markerWidth="6" markerHeight="4.5" refX="5.5" refY="2.25" orient="auto">
              <path d="M0,0 L6,2.25 L0,4.5" fill="none" stroke={C.edgeDef} strokeWidth="0.7" />
            </marker>
            <marker id="dag-an" markerWidth="6" markerHeight="4.5" refX="5.5" refY="2.25" orient="auto">
              <path d="M0,0 L6,2.25 L0,4.5" fill="none" stroke={C.edgeNeg} strokeWidth="0.7" />
            </marker>
            <marker id="dag-abl" markerWidth="6" markerHeight="5" refX="5.5" refY="2.5" orient="auto">
              <path d="M0,0 L6,2.5 L0,5" fill="none" stroke={C.blue} strokeWidth="0.9" />
            </marker>
            <filter id="dag-sh" x="-4%" y="-4%" width="110%" height="112%">
              <feDropShadow dx="0.3" dy="0.8" stdDeviation="1" floodOpacity="0.06" />
            </filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#dag-dots)" />

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* BANDS */}
            {LY.map((ly, i) => {
              const next = i < 6 ? (LY[i + 1] || ly + 70) : ly + 60;
              const h = next - ly + (i === 3 ? 50 : 0);
              return (
                <g key={i}>
                  <rect x={0} y={ly - 22} width={VW} height={h - 8} fill={i % 2 === 0 ? C.band : "none"} />
                  <text
                    x={14}
                    y={ly - 6}
                    style={{ fontSize: 9, fontFamily: MONO, fontWeight: 600, fill: C.ink3, letterSpacing: "0.4px" }}
                  >
                    {LL[i]}
                  </text>
                </g>
              );
            })}
            <text x={14} y={LY[3] + 52} style={{ fontSize: 7.5, fontFamily: MONO, fill: C.ink4, fontStyle: "italic" }}>
              Edgeless / sparse placeholders
            </text>

            {/* EDGES */}
            {EDGES.map((e, i) => {
              const sn = nMap[e.s];
              const tn = nMap[e.t];
              if (!sn || !tn) return null;
              const sd = dims(sn);
              const td = dims(tn);
              const sy = sn.y + (sd.type === "rect" ? sd.h / 2 + 1 : sd.s + 1);
              const ty = tn.y - (td.type === "rect" ? td.h / 2 + 7 : td.s + 7);
              const isHL = conn && conn.has(e.s) && conn.has(e.t) && (e.s === hover || e.t === hover);
              const isDim = (conn && !isHL) || (dimSet && !(dimSet.has(e.s) && dimSet.has(e.t)));
              const isSel = sel && (e.s === sel || e.t === sel);
              const isNeg = e.sign < 0;
              const baseOp = e.w > 1.5 ? 0.32 : e.w > 0.8 ? 0.2 : 0.1;
              const opacity = isDim ? 0.03 : isHL ? 0.75 : isSel ? 0.6 : baseOp;
              const sw = isDim ? 0.3 : isHL ? Math.max(1.5, e.w * 0.9) : isSel ? 2 : Math.max(0.5, e.w * 0.7);
              const color = isSel ? C.blue : isNeg ? C.edgeNeg : C.edgeDef;
              const dash = e.k === null ? "none" : e.k >= 3 ? "none" : e.k >= 1 ? "5,3" : "2,2.5";
              const mk = isSel ? "url(#dag-abl)" : isNeg ? "url(#dag-an)" : "url(#dag-ap)";
              return (
                <path
                  key={i}
                  d={bez(sn.x, sy, tn.x, ty)}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw}
                  opacity={opacity}
                  strokeDasharray={dash}
                  markerEnd={mk}
                  data-e="1"
                  style={{ transition: "opacity 0.12s,stroke-width 0.12s" }}
                />
              );
            })}

            {/* NODES */}
            {NODES.map((n) => {
              const d = dims(n);
              const isDim = (conn && !conn.has(n.id)) || (dimSet && !dimSet.has(n.id));
              const isHov = hover === n.id;
              const isSel = sel === n.id;
              const op = isDim ? 0.14 : 1;
              const fill = isSel ? C.selFill : n.obs ? C.nodeFill : C.latentFill;
              const stroke = isSel ? C.selStroke : isHov ? C.ink2 : n.obs ? C.nodeStroke : C.latentStroke;
              const sw = isSel ? 2 : isHov ? 1.6 : n.dashed ? 1 : 1.2;
              const lines = n.label.split("\n");
              const ks = EDGES.filter((e) => e.t === n.id && e.k != null).map((e) => e.k as number);
              const mk = ks.length > 0 ? Math.min(...ks) : null;
              const dotCx = d.type === "rect" ? n.x + d.w / 2 - 2 : n.x + d.s * 0.6;
              const dotCy = d.type === "rect" ? n.y - d.h / 2 + 2 : n.y - d.s * 0.6;

              return (
                <g
                  key={n.id}
                  data-n="1"
                  style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                  opacity={op}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSel(sel === n.id ? null : n.id);
                  }}
                >
                  {(isHov || isSel) && d.type === "rect" && (
                    <rect x={n.x - d.w / 2 - 3} y={n.y - d.h / 2 - 3} width={d.w + 6} height={d.h + 6} rx={6} fill={isSel ? C.blue : C.ink} opacity={0.06} />
                  )}
                  {(isHov || isSel) && d.type === "diamond" && (
                    <polygon points={dPts(n.x, n.y, d.s + 4)} fill={isSel ? C.blue : C.ink} opacity={0.06} />
                  )}
                  {d.type === "rect" ? (
                    <rect x={n.x - d.w / 2} y={n.y - d.h / 2} width={d.w} height={d.h} rx={3.5} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={n.dashed ? "4,3" : "none"} filter="url(#dag-sh)" />
                  ) : (
                    <polygon points={dPts(n.x, n.y, d.s)} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={n.dashed ? "4,3" : "none"} filter="url(#dag-sh)" />
                  )}

                  {lines.map((line, li) => {
                    const lh = n.obs ? 10 : 8.5;
                    const startY = n.y - (lines.length - 1) * lh / 2 + 1;
                    return (
                      <text
                        key={li}
                        x={n.x}
                        y={startY + li * lh}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize: n.obs ? 8 : 7,
                          fontFamily: FONT,
                          fontWeight: n.obs ? 500 : 600,
                          fill: isSel ? C.blue : C.ink,
                          letterSpacing: "-0.01em",
                          userSelect: "none",
                        }}
                      >
                        {line}
                      </text>
                    );
                  })}

                  {mk !== null && (
                    <circle cx={dotCx} cy={dotCy} r={2.5} fill={kCol(mk)} stroke={C.bg} strokeWidth={0.8} />
                  )}
                </g>
              );
            })}

            {/* HOVER TOOLTIP */}
            {hover && !sel && (() => {
              const n = nMap[hover];
              if (!n) return null;
              const inE = EDGES.filter((e) => e.t === n.id).length;
              const outE = EDGES.filter((e) => e.s === n.id).length;
              const d = dims(n);
              const tx = n.x + (d.type === "rect" ? d.w / 2 : d.s) + 10;
              const ty = n.y - 22;
              return (
                <g style={{ pointerEvents: "none" }}>
                  <rect x={tx} y={ty} width={162} height={42} rx={4} fill={C.ink} opacity={0.92} />
                  <text x={tx + 8} y={ty + 14} style={{ fontSize: 10, fill: "#EEE", fontFamily: FONT, fontWeight: 600 }}>
                    {n.label.replace(/\n/g, " ")}
                  </text>
                  <text x={tx + 8} y={ty + 26} style={{ fontSize: 8, fill: "#888", fontFamily: MONO }}>
                    {`L${n.L} \u00B7 ${n.obs ? "Observable" : "Latent"}`}
                  </text>
                  <text x={tx + 8} y={ty + 36} style={{ fontSize: 8, fill: "#888", fontFamily: MONO }}>
                    {`${inE} in \u00B7 ${outE} out`}
                  </text>
                </g>
              );
            })()}
          </g>
        </svg>

        {/* Zoom controls */}
        <div style={{ position: "absolute", bottom: 10, right: 10, display: "flex", gap: 2, background: C.bg, border: `1px solid ${C.borderLt}`, borderRadius: 4, padding: 2, zIndex: 5 }}>
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.15))} style={{ padding: "2px 7px", fontSize: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO, color: C.ink2 }}>+</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ padding: "2px 7px", fontSize: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO, color: C.ink2 }}>{`${Math.round(zoom * 100)}%`}</button>
          <button onClick={() => setZoom((z) => Math.max(0.35, z - 0.15))} style={{ padding: "2px 7px", fontSize: 10, border: "none", background: "transparent", cursor: "pointer", fontFamily: MONO, color: C.ink2 }}>−</button>
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 10, left: 10, display: "flex", gap: 14, fontSize: 9, fontFamily: MONO, color: C.ink3,
          background: "rgba(255,255,255,0.94)", padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.borderLt}`,
          boxShadow: "0 1px 3px rgba(15,23,42,0.04)", zIndex: 5,
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={14} height={12}><rect x={1} y={2} width={12} height={8} rx={2} fill={C.nodeFill} stroke={C.nodeStroke} strokeWidth={1} /></svg>
            Observable
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={14} height={14}><polygon points="7,1 13,7 7,13 1,7" fill={C.latentFill} stroke={C.latentStroke} strokeWidth={1} /></svg>
            Latent
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={14} height={14}><polygon points="7,1 13,7 7,13 1,7" fill={C.latentFill} stroke={C.latentStroke} strokeWidth={1} strokeDasharray="3,2" /></svg>
            Sparse
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={14} height={4}><line x1={0} y1={2} x2={14} y2={2} stroke={C.edgeDef} strokeWidth={1.4} /></svg>
            Positive
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={14} height={4}><line x1={0} y1={2} x2={14} y2={2} stroke={C.edgeNeg} strokeWidth={1.4} /></svg>
            Negative
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill={C.hi} /></svg>k≥3
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill={C.mid} /></svg>k 1-2
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill={C.lo} /></svg>k=0
          </span>
        </div>
      </div>

      {/* SIDEBAR INSPECTOR */}
      <div style={{ width: 320, borderLeft: `1px solid ${C.border}`, overflowY: "auto", flexShrink: 0, background: C.bg }}>
        {selNode ? (
          <div style={{ padding: "18px 16px" }}>
            <Mono style={{ fontSize: 10, color: C.ink3 }}>{selNode.id}</Mono>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1.25, marginTop: 2, letterSpacing: "-0.02em" }}>
              {selNode.label.replace(/\n/g, " ")}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <Pill>{`Layer ${selNode.L} · ${LL[selNode.L].split("  ")[1]}`}</Pill>
              <Pill color={selNode.obs ? C.hi : C.mid}>{selNode.obs ? "Observable" : "Latent"}</Pill>
              {selNode.dashed && <Pill color={C.lo}>Sparse</Pill>}
              {selNode.wide && <Pill color={C.ink2}>Panel</Pill>}
            </div>

            {/* Degree stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
              <div style={{ padding: "8px 10px", background: C.band, borderRadius: 5, border: `1px solid ${C.borderLt}` }}>
                <Mono style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{selIn.length}</Mono>
                <div style={{ fontSize: 9, color: C.ink3, fontFamily: MONO, marginTop: 2 }}>INCOMING</div>
              </div>
              <div style={{ padding: "8px 10px", background: C.band, borderRadius: 5, border: `1px solid ${C.borderLt}` }}>
                <Mono style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{selOut.length}</Mono>
                <div style={{ fontSize: 9, color: C.ink3, fontFamily: MONO, marginTop: 2 }}>OUTGOING</div>
              </div>
            </div>

            {selIn.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.ink2, fontFamily: MONO, marginBottom: 6, letterSpacing: "0.06em" }}>
                  INCOMING ({selIn.length})
                </div>
                {selIn.map((e, i) => {
                  const sn = nMap[e.s];
                  return (
                    <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${C.borderLt}`, fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: C.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sn ? sn.label.replace(/\n/g, " ") : e.s}
                      </span>
                      <Mono style={{ color: e.sign < 0 ? C.edgeNeg : C.ink2, flexShrink: 0, fontSize: 10 }}>
                        {`w=${e.w.toFixed(1)} k=${e.k != null ? e.k : "—"}`}
                      </Mono>
                    </div>
                  );
                })}
              </div>
            )}
            {selOut.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.ink2, fontFamily: MONO, marginBottom: 6, letterSpacing: "0.06em" }}>
                  OUTGOING ({selOut.length})
                </div>
                {selOut.map((e, i) => {
                  const tn = nMap[e.t];
                  return (
                    <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${C.borderLt}`, fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: C.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tn ? tn.label.replace(/\n/g, " ") : e.t}
                      </span>
                      <Mono style={{ color: e.sign < 0 ? C.edgeNeg : C.ink2, flexShrink: 0, fontSize: 10 }}>
                        {`w=${e.w.toFixed(1)} k=${e.k != null ? e.k : "—"}`}
                      </Mono>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cross-navigation */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.borderLt}` }}>
              <button onClick={() => onNavigate("disc")} style={linkBtn}>View in Discovery Engine →</button>
              <button onClick={() => onNavigate("audit")} style={linkBtn}>View Audit History →</button>
              <button onClick={() => onNavigate("sim")} style={linkBtn}>Run simulation with this edge →</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: "48px 22px", textAlign: "center", color: C.ink3 }}>
            <div style={{ fontSize: 32, opacity: 0.12, marginBottom: 12 }}>○</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.ink2, marginBottom: 8 }}>Select a node</div>
            <div style={{ fontSize: 11, lineHeight: 1.7 }}>
              Click any node to inspect edges and parameters. Hover highlights the connected subgraph.
              Use filter chips above to focus a pathway.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
