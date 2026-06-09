"use client";

// Preflight: the COMPLEX, dense, layered reasoning graph — connections live
// between the DETAILS inside topics, surfaced as weighted bundles (overview)
// and unbundled on expand (focus). Simulates the live meeting/call case:
// many micro-connections detected, only the strong ones surfaced.

import { useMemo, useState } from "react";
import { LayerGraph, type LGMicro, type LGTopic } from "@/components/objective/crucible/layer-graph";

const TOPICS: LGTopic[] = [
  // L0 — first principles
  { id: "fp1", keyword: "Legibility", label: "Legibility beats completeness", type: "first_principle", layer: 0, details: [
    { id: "leg1", label: "Instant readability at a glance" }, { id: "leg2", label: "Pre-attentive grouping" }, { id: "leg3", label: "Low ink-to-data ratio" } ] },
  { id: "fp2", keyword: "Relationships", label: "Meaning lives in relationships", type: "first_principle", layer: 0, details: [
    { id: "rel1", label: "Edges carry the insight" }, { id: "rel2", label: "A node alone is mute" }, { id: "rel3", label: "Context comes from neighbours" } ] },
  // L1 — leverage
  { id: "lp1", keyword: "Metaphor", label: "One metaphor replaces nodes/edges", type: "leverage_point", layer: 1, details: [
    { id: "met1", label: "Domain-native encoding" }, { id: "met2", label: "Replaces the node-link form" }, { id: "met3", label: "Learnable in seconds" }, { id: "met4", label: "Maps to the mental model" } ] },
  { id: "lp2", keyword: "Onboarding", label: "Onboarding makes the metaphor obvious", type: "leverage_point", layer: 1, details: [
    { id: "onb1", label: "First-run reveal" }, { id: "onb2", label: "Show, don't tell" }, { id: "onb3", label: "Metaphor made self-evident" } ] },
  { id: "lp3", keyword: "Disclosure", label: "Progressive disclosure of detail", type: "leverage_point", layer: 1, details: [
    { id: "dis1", label: "Detail on demand" }, { id: "dis2", label: "Collapse by default" }, { id: "dis3", label: "Zoom to expand" } ] },
  // L2 — variables
  { id: "v1", keyword: "Comprehension", label: "Time-to-comprehension", type: "variable", layer: 2, details: [
    { id: "com1", label: "Time-to-aha" }, { id: "com2", label: "Recall accuracy" }, { id: "com3", label: "Scan-path length" } ] },
  { id: "v2", keyword: "Cognition", label: "Cognitive load", type: "variable", layer: 2, details: [
    { id: "cog1", label: "Working-memory load" }, { id: "cog2", label: "Visual clutter" } ] },
  { id: "v3", keyword: "Density", label: "Data density", type: "variable", layer: 2, details: [
    { id: "den1", label: "Items per screen" }, { id: "den2", label: "Edge crossings" } ] },
  // L3 — features
  { id: "ft1", keyword: "Constellation", label: "Constellation view", type: "feature", layer: 3, details: [
    { id: "con1", label: "Star clusters = topics" }, { id: "con2", label: "Brightness = strength" } ] },
  { id: "ft2", keyword: "Tour", label: "Guided first-run tour", type: "feature", layer: 3, details: [
    { id: "tou1", label: "Guided first path" }, { id: "tou2", label: "Annotated highlights" } ] },
  { id: "ft3", keyword: "Filters", label: "Smart filters", type: "feature", layer: 3, details: [
    { id: "fil1", label: "Team-level scope" }, { id: "fil2", label: "Facet narrowing" } ] },
];

const MICRO: LGMicro[] = [
  // Metaphor (lp1) is the dense hub — thick bundles radiate from it.
  { source: "met1", target: "leg1" }, { source: "met2", target: "leg3" }, { source: "met3", target: "leg2" }, { source: "met4", target: "leg1" },
  { source: "met1", target: "rel1" }, { source: "met4", target: "rel3" },
  { source: "met3", target: "onb3" }, { source: "met2", target: "onb2" },
  { source: "met1", target: "con1" }, { source: "met2", target: "con2" },
  { source: "met3", target: "com1" }, { source: "met4", target: "com2" }, { source: "met1", target: "com3" }, { source: "met2", target: "com1" }, { source: "met3", target: "com2" },
  { source: "met1", target: "met4" }, { source: "met2", target: "met3" }, // intra
  // Onboarding
  { source: "onb1", target: "tou1" }, { source: "onb2", target: "tou2" }, { source: "onb3", target: "com1" }, { source: "onb1", target: "onb3" },
  // Disclosure
  { source: "dis1", target: "cog1" }, { source: "dis2", target: "cog2" }, { source: "dis2", target: "den1" }, { source: "dis3", target: "den2" }, { source: "dis1", target: "dis3" },
  // Legibility / Relationships outward
  { source: "leg2", target: "cog2" }, { source: "leg2", target: "den2" }, { source: "leg1", target: "leg3" },
  { source: "rel1", target: "con1" }, { source: "rel2", target: "com2" }, { source: "rel3", target: "rel1" },
  // Variables / Features
  { source: "fil1", target: "den1" }, { source: "fil2", target: "den2" }, { source: "con2", target: "com2" }, { source: "tou1", target: "com1" },
  { source: "com1", target: "com3" }, { source: "den1", target: "den2" },
];

export default function PreflightLayersPage() {
  const [focusId, setFocusId] = useState<string | null>(null);
  const detected = MICRO.length;
  const surfaced = useMemo(() => {
    const topicOf = new Map<string, string>();
    TOPICS.forEach((t) => t.details.forEach((d) => topicOf.set(d.id, t.id)));
    const bundle = new Map<string, number>();
    for (const e of MICRO) { const a = topicOf.get(e.source), b = topicOf.get(e.target); if (!a || !b || a === b) continue; const k = [a, b].sort().join("|"); bundle.set(k, (bundle.get(k) ?? 0) + 1); }
    return [...bundle.values()].filter((w) => w >= 2).length;
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F1F5F9", padding: 20, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ height: "100%", background: "#fff", borderRadius: 18, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 20px 50px -24px rgba(11,18,40,0.3)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid rgba(15,23,42,0.06)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#10B981" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#10B981", boxShadow: "0 0 0 3px rgba(16,185,129,0.18)" }} /> LIVE
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Reasoning ground</span>
          <span style={{ fontSize: 11.5, color: "#64748B" }}>building the graph as the conversation streams</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11.5 }}>
            <span style={{ color: "#94A3B8" }}><b style={{ color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>{detected}</b> micro-connections detected</span>
            <span style={{ color: "#94A3B8" }}><b style={{ color: "#F59E0B", fontVariantNumeric: "tabular-nums" }}>{surfaced}</b> surfaced</span>
            <span style={{ color: "#94A3B8" }}>edge thickness = relationship strength</span>
            {focusId && <button type="button" onClick={() => setFocusId(null)} style={{ fontSize: 11, fontWeight: 600, color: "#2563EB", border: "none", background: "transparent", cursor: "pointer" }}>← overview</button>}
          </div>
        </div>
        {/* graph */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <LayerGraph topics={TOPICS} micro={MICRO} focusId={focusId} onFocus={setFocusId} />
        </div>
      </div>
    </div>
  );
}
