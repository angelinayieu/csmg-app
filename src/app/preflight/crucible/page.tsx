"use client";

// Preflight: THE canonical merged surface — "understand it in a second."
// One reasoning brief: the single highest-leverage MOVE (hero) · the key
// relationships as plain ranked SENTENCES · a calm glance-MAP · the NEXT moves.
// Direct, targeted, simple — sophisticated insight with zero tracing.
// Consolidates pillmap (map) + connections (sentences) + layers (leverage).

import { useState } from "react";
import { PillMap } from "@/components/objective/crucible/pill-map";
import type { PillEdge, PillNode } from "@/lib/objective-canvas/crucible/crucible-strength";

// ── The brief (what an agent would emit from the converged graph) ──
const HERO = {
  eyebrow: "The highest-leverage move",
  move: "Pick one metaphor that replaces nodes & edges.",
  why: "The single choice that reframes the whole UI for non-technical users.",
  restsOn: "Legibility beats completeness",
  score: 92,
};

interface Conn { from: string; fromType: string; verb: string; to: string; toType: string; score: number; line: string }
const CONNECTIONS: Conn[] = [
  { from: "Metaphor", fromType: "leverage_point", verb: "speeds up", to: "Comprehension", toType: "variable", score: 92, line: "A familiar metaphor lets people grasp the graph in seconds." },
  { from: "Metaphor", fromType: "leverage_point", verb: "must stay", to: "Legibility", toType: "first_principle", score: 88, line: "The metaphor only works if it stays instantly readable." },
  { from: "Metaphor", fromType: "leverage_point", verb: "renders as", to: "Constellation", toType: "feature", score: 84, line: "It becomes a star-map you scan at a glance — clusters = topics." },
  { from: "Onboarding", fromType: "leverage_point", verb: "proves", to: "Metaphor", toType: "leverage_point", score: 78, line: "A guided first-run makes the metaphor obvious on contact." },
];

const PROPOSALS = [
  { n: 1, title: "Constellation-first", score: 86, color: "#2563EB" },
  { n: 2, title: "Onboarding-first", score: 79, color: "#0EA5E9" },
  { n: 3, title: "Filter-first", score: 71, color: "#0D9488" },
];

// Glance-map: apex + only what it directly turns on.
const MAP_NODES: PillNode[] = [
  { id: "lp1", keyword: "Metaphor", label: "One metaphor replaces nodes/edges", type: "leverage_point", score: 92 },
  { id: "v1", keyword: "Comprehension", label: "Time-to-comprehension", type: "variable", score: 72 },
  { id: "fp1", keyword: "Legibility", label: "Legibility beats completeness", type: "first_principle", score: 80 },
  { id: "ft1", keyword: "Constellation", label: "Constellation view", type: "feature", score: 74 },
  { id: "lp2", keyword: "Onboarding", label: "Onboarding makes metaphor obvious", type: "leverage_point", score: 70 },
];
const MAP_EDGES: PillEdge[] = [
  { source: "lp1", target: "v1" }, { source: "lp1", target: "fp1" }, { source: "lp1", target: "ft1" }, { source: "lp2", target: "lp1" },
];

const DOT: Record<string, string> = { leverage_point: "#F59E0B", first_principle: "#7C3AED", variable: "#0D9488", constraint: "#E11D48", sub_objective: "#0EA5E9", feature: "#2563EB" };

export default function PreflightCruciblePage() {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#EEF1F6", overflow: "auto", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "28px 24px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* context bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#10B981" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#10B981", boxShadow: "0 0 0 3px rgba(16,185,129,0.18)" }} /> LIVE
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Consumer-readable knowledge graph</span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#94A3B8" }}>9 of 38 connections surfaced</span>
        </div>

        {/* ── HERO: the one move, readable in a second ── */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 24px 60px -30px rgba(11,18,40,0.4)", padding: "26px 28px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, width: 5, height: "100%", background: "linear-gradient(180deg,#F59E0B,#F59E0B00)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B45309" }}>{HERO.eyebrow}</span>
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 28, lineHeight: 1.18, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em", maxWidth: 680 }}>{HERO.move}</h1>
          <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#475569", maxWidth: 620 }}>{HERO.why}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18 }}>
            <Score value={HERO.score} />
            <span style={{ fontSize: 12, color: "#94A3B8" }}>rests on <b style={{ color: "#7C3AED", fontWeight: 600 }}>{HERO.restsOn}</b></span>
          </div>
        </div>

        {/* ── two columns: WHY (sentences) + glance MAP ── */}
        <div style={{ display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" }}>
          {/* WHY IT WINS — ranked connection sentences */}
          <div style={{ flex: "2 1 460px", minWidth: 380, background: "#fff", borderRadius: 18, border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 18px 44px -28px rgba(11,18,40,0.34)", padding: "18px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 12 }}>Why it wins · the relationships that matter</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {CONNECTIONS.map((c, i) => (
                <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  style={{ padding: "12px 0", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <MiniPill label={c.from} type={c.fromType} />
                    <span style={{ fontSize: 12, fontStyle: "italic", color: "#94A3B8" }}>{c.verb} ›</span>
                    <MiniPill label={c.to} type={c.toType} />
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 56, height: 5, borderRadius: 999, background: "rgba(15,23,42,0.08)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${c.score}%`, borderRadius: 999, background: "linear-gradient(90deg,#F59E0B,#2563EB)" }} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>{c.score}</span>
                    </span>
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: hover === i ? "#0F172A" : "#64748B", transition: "color 120ms" }}>{c.line}</p>
                </div>
              ))}
            </div>
          </div>

          {/* glance MAP */}
          <div style={{ flex: "1 1 280px", minWidth: 260, background: "#fff", borderRadius: 18, border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 18px 44px -28px rgba(11,18,40,0.34)", padding: "12px 8px 4px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", padding: "6px 12px 0" }}>At a glance</div>
            <div style={{ flex: 1, minHeight: 220 }}>
              <PillMap nodes={MAP_NODES} edges={MAP_EDGES} budget={6} />
            </div>
          </div>
        </div>

        {/* ── DO NEXT: proposals ── */}
        <div style={{ background: "#fff", borderRadius: 18, border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 18px 44px -28px rgba(11,18,40,0.34)", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" }}>Do next</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {PROPOSALS.map((p) => (
                <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px 7px 8px", borderRadius: 999, border: `1px solid ${p.color}33`, background: "#fff", boxShadow: "0 5px 12px rgba(11,18,40,0.06)" }}>
                  <span style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 999, background: p.color, color: "#fff", fontSize: 10, fontWeight: 800 }}>{p.n}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{p.title}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: p.color }}>{p.score}</span>
                </div>
              ))}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#94A3B8" }}>each → spec → prototype</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Score({ value }: { value: number }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "6px 12px", borderRadius: 12, background: "rgba(245,158,11,0.10)" }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: "#B45309", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#B45309", opacity: 0.7 }}>/ 100 leverage</span>
    </div>
  );
}

function MiniPill({ label, type }: { label: string; type: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, background: "#fff", border: "1px solid rgba(15,23,42,0.10)", boxShadow: "0 3px 8px rgba(11,18,40,0.05)" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: DOT[type] ?? "#64748B" }} />
      <span style={{ fontSize: 12.5, fontWeight: 650, color: "#0F172A" }}>{label}</span>
    </span>
  );
}
