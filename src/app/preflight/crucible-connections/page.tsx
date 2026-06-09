"use client";

// Preflight: connections as PLAIN ENGLISH. A line can't tell you what a
// relationship means — so we render each surfaced connection as a super-blunt
// statement: [keyword] → verb → [keyword], with a one-line gloss + strength.
// Plus a color legend so every category is self-explaining.

import { useState } from "react";

// ── The color language (one place, self-explaining) ──
const LEGEND: { key: string; color: string; label: string; desc: string }[] = [
  { key: "first_principle", color: "#7C3AED", label: "First principle", desc: "an irreducible truth it all rests on" },
  { key: "leverage_point", color: "#F59E0B", label: "Leverage point", desc: "where acting moves the most" },
  { key: "variable", color: "#069494", label: "Variable", desc: "what we measure / optimize" },
  { key: "constraint", color: "#E11D48", label: "Constraint", desc: "a hard limit we must respect" },
  { key: "sub_objective", color: "#0EA5E9", label: "Sub-objective", desc: "a branch of the goal" },
  { key: "feature", color: "#2563EB", label: "Feature", desc: "a thing we build" },
];
const COLOR: Record<string, string> = Object.fromEntries(LEGEND.map((l) => [l.key, l.color]));

interface Conn {
  from: string; fromType: string;
  verb: string;
  to: string; toType: string;
  strength: number;
  blunt: string; // super-blunt plain-English gloss
}
const CONNECTIONS: Conn[] = [
  { from: "Metaphor", fromType: "leverage_point", verb: "speeds up", to: "Comprehension", toType: "variable", strength: 92, blunt: "A familiar metaphor lets people get it in seconds." },
  { from: "Metaphor", fromType: "leverage_point", verb: "must stay", to: "Legibility", toType: "first_principle", strength: 88, blunt: "The metaphor only works if it stays instantly readable." },
  { from: "Metaphor", fromType: "leverage_point", verb: "renders as", to: "Constellation", toType: "feature", strength: 84, blunt: "The metaphor becomes a star-map you can scan." },
  { from: "Disclosure", fromType: "leverage_point", verb: "lowers", to: "Cognition", toType: "variable", strength: 80, blunt: "Collapsing detail by default cuts mental load." },
  { from: "Onboarding", fromType: "leverage_point", verb: "proves", to: "Metaphor", toType: "leverage_point", strength: 78, blunt: "A first-run reveal makes the metaphor obvious." },
  { from: "Relationships", fromType: "first_principle", verb: "drive", to: "Constellation", toType: "feature", strength: 76, blunt: "The links matter more than the dots — so show the links." },
  { from: "Disclosure", fromType: "leverage_point", verb: "tames", to: "Density", toType: "variable", strength: 74, blunt: "Zoom-to-expand keeps the screen from overcrowding." },
  { from: "Non-technical", fromType: "constraint", verb: "rules out", to: "Density", toType: "variable", strength: 70, blunt: "Everyday users can't handle a dense wall of nodes." },
  { from: "Filters", fromType: "feature", verb: "narrow", to: "Density", toType: "variable", strength: 66, blunt: "Team-level scope cuts what's on screen at once." },
];

export default function PreflightConnectionsPage() {
  const [hi, setHi] = useState<string | null>(null);
  const sorted = [...CONNECTIONS].sort((a, b) => b.strength - a.strength);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F1F5F9", padding: 24, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        {/* ── Color legend ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 14px 36px -20px rgba(11,18,40,0.3)", padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 10 }}>What the colors mean</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px" }}>
            {LEGEND.map((l) => (
              <button key={l.key} type="button" onMouseEnter={() => setHi(l.key)} onMouseLeave={() => setHi(null)}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 6px", borderRadius: 9, border: "none", background: hi === l.key ? "rgba(15,23,42,0.04)" : "transparent", cursor: "default", textAlign: "left" }}>
                <span style={{ width: 11, height: 11, borderRadius: 999, background: l.color, flexShrink: 0, boxShadow: `0 0 0 3px ${l.color}22` }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A", minWidth: 104 }}>{l.label}</span>
                <span style={{ fontSize: 11.5, color: "#64748B" }}>{l.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Connections in plain English ── */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 14px 36px -20px rgba(11,18,40,0.3)", padding: "16px 18px 8px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>The strongest connections</span>
            <span style={{ fontSize: 11.5, color: "#94A3B8" }}>read it as sentences · ranked by strength</span>
          </div>
          {sorted.map((c, i) => {
            const dim = hi ? c.fromType !== hi && c.toType !== hi : false;
            return (
              <div key={i} style={{ padding: "12px 4px", borderTop: i === 0 ? "none" : "1px solid rgba(15,23,42,0.06)", opacity: dim ? 0.3 : 1, transition: "opacity 120ms" }}>
                {/* the blunt statement: keyword → verb → keyword */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Pill kw={c.from} color={COLOR[c.fromType]} />
                  <Verb v={c.verb} />
                  <Pill kw={c.to} color={COLOR[c.toType]} />
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 54, height: 5, borderRadius: 999, background: "rgba(15,23,42,0.08)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${c.strength}%`, background: "linear-gradient(90deg,#F59E0B,#0EA5E9)", borderRadius: 999 }} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0F172A", fontVariantNumeric: "tabular-nums", minWidth: 22, textAlign: "right" }}>{c.strength}</span>
                  </span>
                </div>
                {/* super-blunt gloss */}
                <div style={{ marginTop: 6, fontSize: 12.5, color: "#475569", lineHeight: 1.45 }}>{c.blunt}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", margin: "12px 0 20px" }}>Every connection is a plain sentence: <b style={{ color: "#475569" }}>keyword → verb → keyword</b>. Hover a legend color to spotlight its connections.</div>
      </div>
    </div>
  );
}

function Pill({ kw, color }: { kw: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, background: "#fff", border: `1px solid ${color}55`, boxShadow: "0 4px 10px rgba(11,18,40,0.07)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{kw}</span>
    </span>
  );
}

function Verb({ v }: { v: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#64748B", fontStyle: "italic" }}>
      <span style={{ color: "#CBD5E1" }}>—</span>{v}<span style={{ color: "#94A3B8" }}>▸</span>
    </span>
  );
}
