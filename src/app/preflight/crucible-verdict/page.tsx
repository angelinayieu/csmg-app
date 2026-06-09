"use client";

// Preflight: the 1-SECOND layer. A graph is a "study it" object; comprehension-
// in-a-second needs a single focal point + a blunt headline. So we LEAD with the
// verdict (one sentence), support with ≤3 blunt lines, and defer the graph to a
// drill-down. Overview-first, taken literally: the overview is a sentence.

import { useState } from "react";

const DOT = { first_principle: "#7C3AED", leverage_point: "#F59E0B", variable: "#0D9488", constraint: "#E11D48", feature: "#2563EB" } as const;

export default function PreflightVerdictPage() {
  const [altitude, setAltitude] = useState(0); // 0 verdict · 1 connections · 2 map

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 640, background: "#fff", borderRadius: 22, border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 30px 70px -30px rgba(11,18,40,0.35)", padding: "34px 38px 26px" }}>
        {/* eyebrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: DOT.leverage_point }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#B45309" }}>The one thing that matters most</span>
        </div>

        {/* THE VERDICT — one fixation */}
        <div style={{ fontSize: 31, fontWeight: 800, lineHeight: 1.12, color: "#0F172A", letterSpacing: "-0.02em", marginTop: 12 }}>
          Use <span style={{ background: "linear-gradient(180deg, transparent 62%, #FCD34D88 62%)" }}>one metaphor</span>&nbsp;instead of nodes &amp; edges.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 15, color: "#475569", lineHeight: 1.5 }}>Everything else follows from this one move.</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 800, color: "#B45309", background: "#FEF3C7", padding: "3px 9px", borderRadius: 999 }}>92 · highest leverage</span>
        </div>

        {/* WHY — three blunt lines */}
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", margin: "24px 0 10px" }}>Why it wins</div>
        {[
          { c: DOT.variable, t: "People get it in seconds." },
          { c: DOT.first_principle, t: "It only works if it stays instantly readable." },
          { c: DOT.feature, t: "It renders as a star-map you can scan." },
        ].map((b, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "7px 0" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: b.c, flexShrink: 0 }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1E293B" }}>{b.t}</span>
          </div>
        ))}

        {/* SO — the single next move */}
        <div style={{ marginTop: 22, padding: "14px 16px", borderRadius: 14, background: "#0F172A", color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" }}>Build first</span>
          <span style={{ fontSize: 15.5, fontWeight: 700 }}>Constellation view</span>
          <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: "#CBD5E1" }}>Prototype ↗</span>
        </div>

        {/* altitude footer — this is the TOP of a progressive stack */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22, paddingTop: 16, borderTop: "1px solid rgba(15,23,42,0.06)" }}>
          {["Verdict", "Connections", "Map"].map((l, i) => (
            <button key={l} type="button" onClick={() => setAltitude(i)} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: i === altitude ? 700 : 500, color: i === altitude ? "#0F172A" : "#94A3B8" }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: i === altitude ? "#0F172A" : "#CBD5E1" }} />{l}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#2563EB", cursor: "pointer" }}>
            {altitude === 0 ? "Read the why →" : altitude === 1 ? "See the map →" : "Explore →"}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 8 }}>
          Grasp the verdict in a second. Drop a level only when you want the why (9 connections) or the full map (4 layers).
        </div>
      </div>
    </div>
  );
}
