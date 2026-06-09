"use client";

// Preflight harness for the Crucible REASONING CANVAS — the professional single-
// spine UI from CRUCIBLE_MASTER_PLAN §5.8 (anti-mess law). Board routes are auth-
// gated, so this renders the whole vision with MOCK data on a public route:
//   objective → reasoning frame (lens + overlay toggles) → proposals (bud below,
//   expand to structural lanes → prototype) → right-side detail panel.
// Sample = the user's own objective (consumer KG viz), seeded with generic NOISE
// nodes to prove the signal-vs-noise filter sinks them.

import { useMemo, useState } from "react";
import { PillMap, type Lens, type Overlay } from "@/components/objective/crucible/pill-map";
import {
  scoreGraph,
  type PillEdge,
  type PillNode,
} from "@/lib/objective-canvas/crucible/crucible-strength";

const NODES: PillNode[] = [
  { id: "obj", keyword: "Objective", label: "Consumer-readable knowledge graph", type: "objective", score: 100, meta: { uncertainty: 0.1, source: "intake", note: "Visualize a KG for non-technical consumers, beautifully + legibly." } },

  { id: "fp1", keyword: "Legibility", label: "Legibility beats completeness", type: "first_principle", score: 90, meta: { uncertainty: 0.1, irreducibility: 5, counterfactual: 5, why: "If the view isn't instantly readable, no amount of data helps." } },
  { id: "fp2", keyword: "Relationships", label: "Meaning lives in relationships", type: "first_principle", score: 84, meta: { uncertainty: 0.15, irreducibility: 4, counterfactual: 5 } },
  { id: "fp3", keyword: "Familiarity", label: "Familiarity lowers entry cost", type: "first_principle", score: 80, meta: { uncertainty: 0.2 } },

  { id: "lp1", keyword: "Metaphor", label: "One metaphor replaces nodes/edges", type: "leverage_point", score: 92, meta: { uncertainty: 0.35, meadows: "Paradigm", why: "The single highest-leverage choice — it reframes the entire UI." } },
  { id: "lp2", keyword: "Onboarding", label: "Onboarding makes metaphor obvious", type: "leverage_point", score: 81, meta: { uncertainty: 0.3, meadows: "Information flows" } },
  { id: "lp3", keyword: "Team data", label: "Show team-level data only", type: "leverage_point", score: 74, meta: { uncertainty: 0.5, meadows: "Rules" } },
  { id: "lp4", keyword: "Disclosure", label: "Progressive disclosure of detail", type: "leverage_point", score: 78, meta: { uncertainty: 0.3, meadows: "Rules" } },
  { id: "lp5", keyword: "Cross-domain", label: "Borrow a cross-domain visual language", type: "leverage_point", score: 70, meta: { uncertainty: 0.75, meadows: "Self-organization" } },

  { id: "v1", keyword: "Comprehension", label: "Time-to-comprehension", type: "variable", score: 72, meta: { uncertainty: 0.4 } },
  { id: "v2", keyword: "Metaphor fit", label: "Metaphor fit", type: "variable", score: 70, meta: { uncertainty: 0.6 } },
  { id: "v3", keyword: "Cognition", label: "Cognitive load", type: "variable", score: 66, meta: { uncertainty: 0.45 } },
  { id: "v4", keyword: "Density", label: "Data density", type: "variable", score: 60, meta: { uncertainty: 0.5 } },

  { id: "c1", keyword: "Non-technical", label: "Non-technical users", type: "constraint", score: 65, meta: { uncertainty: 0.2, kind: "hard" } },
  { id: "c2", keyword: "Mobile", label: "Mobile-first", type: "constraint", score: 55, meta: { uncertainty: 0.7, kind: "soft" } },

  { id: "so1", keyword: "Pick metaphor", label: "Choose the metaphor", type: "sub_objective", score: 76, meta: { uncertainty: 0.55 } },
  { id: "so2", keyword: "Onboarding UX", label: "Design first-run onboarding", type: "sub_objective", score: 70, meta: { uncertainty: 0.4 } },

  { id: "ft1", keyword: "Constellation", label: "Constellation view", type: "feature", score: 74, meta: { uncertainty: 0.5, confidence: 0.8 } },
  { id: "ft2", keyword: "Tour", label: "Guided first-run tour", type: "feature", score: 68, meta: { uncertainty: 0.4, confidence: 0.7 } },
  { id: "ft3", keyword: "Filters", label: "Smart filters", type: "feature", score: 62, meta: { uncertainty: 0.45, confidence: 0.6 } },

  { id: "n1", keyword: "Beautiful UI", label: "Beautiful UI", type: "feature", score: 71, meta: { uncertainty: 0.6, note: "Generic — no structural role." } },
  { id: "n2", keyword: "Performance", label: "Robust performance", type: "feature", score: 68, meta: { uncertainty: 0.6, note: "Generic — no structural role." } },
];

const EDGES: PillEdge[] = [
  { source: "obj", target: "fp1" }, { source: "obj", target: "fp2" }, { source: "obj", target: "fp3" },
  { source: "lp1", target: "fp1" }, { source: "lp1", target: "fp2" }, { source: "lp1", target: "v2" },
  { source: "lp1", target: "so1" }, { source: "lp1", target: "ft1" }, { source: "lp1", target: "v1" },
  { source: "lp2", target: "fp3" }, { source: "lp2", target: "so2" }, { source: "lp2", target: "ft2" }, { source: "lp2", target: "v1" },
  { source: "lp3", target: "c1" }, { source: "lp3", target: "v4" },
  { source: "lp4", target: "v3" }, { source: "lp4", target: "ft3" },
  { source: "lp5", target: "v2" }, { source: "lp5", target: "fp2" },
  { source: "v1", target: "fp1" }, { source: "v3", target: "c1" },
  { source: "so1", target: "ft1" }, { source: "so2", target: "ft2" }, { source: "c2", target: "ft2" },
];

interface Proposal {
  id: string; title: string; score: number; color: string; leverage: string;
  lanes: { type: "Feature" | "Variable"; label: string }[];
}
const PROPOSALS: Proposal[] = [
  { id: "pA", title: "Constellation-first", score: 86, color: "#2563EB", leverage: "One metaphor replaces nodes/edges", lanes: [ { type: "Feature", label: "Constellation view" }, { type: "Variable", label: "Metaphor fit" }, { type: "Feature", label: "Guided first-run tour" } ] },
  { id: "pB", title: "Onboarding-first", score: 79, color: "#0EA5E9", leverage: "Onboarding makes metaphor obvious", lanes: [ { type: "Feature", label: "Guided first-run tour" }, { type: "Variable", label: "User comprehension" } ] },
  { id: "pC", title: "Filter-first", score: 71, color: "#069494", leverage: "Show team-level data only", lanes: [ { type: "Feature", label: "Smart filters" }, { type: "Variable", label: "Data density" } ] },
];

const TYPE_LABEL: Record<string, string> = { objective: "Objective", leverage_point: "Leverage point", first_principle: "First principle", variable: "Variable", constraint: "Constraint", sub_objective: "Sub-objective", feature: "Feature", concept: "Concept" };

export default function PreflightCanvasPage() {
  const [lens, setLens] = useState<Lens>("concept");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [budget, setBudget] = useState(6);
  const scored = useMemo(() => scoreGraph(NODES, EDGES), []);
  const apexId = useMemo(() => [...scored].sort((a, b) => b.strength - a.strength)[0]?.id ?? null, [scored]);
  const [selectedId, setSelectedId] = useState<string | null>(apexId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sel = scored.find((s) => s.id === selectedId) ?? null;
  const effBudget = budget >= 999 ? NODES.length : budget;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#F1F5F9", padding: 20, display: "flex", gap: 14, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* ── SPINE ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {/* Objective card */}
        <div style={{ alignSelf: "center", maxWidth: 520, width: "100%", background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 14px 36px -20px rgba(11,18,40,0.3)", padding: "12px 16px" }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94A3B8" }}>Objective</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginTop: 2 }}>Consumer-readable knowledge graph</div>
        </div>

        {/* Reasoning frame */}
        <div style={{ flex: 1, position: "relative", background: "#fff", borderRadius: 18, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 20px 50px -24px rgba(11,18,40,0.3)", overflow: "hidden", minHeight: 0 }}>
          {/* toolbar */}
          <div style={{ position: "absolute", top: 12, left: 14, right: 14, zIndex: 2, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>Reasoning ground</span>
            <Segmented label="Lens" options={[["concept", "Concept"], ["structure", "Structure"], ["cause", "Cause"]]} value={lens} onChange={(v) => setLens(v as Lens)} />
            <Segmented label="Overlay" options={[["none", "None"], ["heat", "Heat"], ["size", "Size"]]} value={overlay} onChange={(v) => setOverlay(v as Overlay)} />
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {[["4", "Apex+3"], ["6", "Apex+5"], ["9", "Apex+8"], ["999", "All"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setBudget(Number(v))} style={chip(budget === Number(v))}>{l}</button>
              ))}
            </div>
          </div>
          <PillMap nodes={NODES} edges={EDGES} budget={effBudget} lens={lens} overlay={overlay} selectedId={selectedId} onSelect={setSelectedId} />
          {overlay === "heat" && <Legend />}
        </div>

        {/* Proposals — bud from the leverage surface */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 14px 36px -20px rgba(11,18,40,0.3)", padding: "11px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 8 }}>Proposals · bud from leverage · ranked</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {PROPOSALS.map((p, i) => (
              <button key={p.id} type="button" onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999, border: `1px solid ${p.color}40`, background: expanded === p.id ? `${p.color}10` : "#fff", cursor: "pointer", boxShadow: "0 6px 14px rgba(11,18,40,0.08)" }}>
                <span style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 999, background: p.color, color: "#fff", fontSize: 10, fontWeight: 800 }}>{i + 1}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A" }}>{p.title}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: p.color }}>{p.score}</span>
                <span style={{ fontSize: 11, color: "#94A3B8" }}>{expanded === p.id ? "▾" : "▸"}</span>
              </button>
            ))}
          </div>
          {/* expanded → structural lanes → prototype */}
          {expanded && (() => { const p = PROPOSALS.find((x) => x.id === expanded)!; return (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(15,23,42,0.06)" }}>
              <div style={{ fontSize: 11, color: "#64748B", marginBottom: 8 }}>operationalizes: <b style={{ color: "#0F172A" }}>{p.leverage}</b></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {p.lanes.map((l, j) => (
                  <div key={j} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {j > 0 && <span style={{ color: "#CBD5E1" }}>→</span>}
                    <div style={{ minWidth: 150, background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: "9px 11px" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: l.type === "Feature" ? "#2563EB" : "#069494" }}>{l.type}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", marginTop: 2 }}>{l.label}</div>
                    </div>
                  </div>
                ))}
                <span style={{ color: "#CBD5E1" }}>→</span>
                <div style={{ padding: "9px 14px", borderRadius: 12, background: "#0F172A", color: "#fff", fontSize: 12, fontWeight: 700 }}>Prototype ↗</div>
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                {["Sketch · ~1 call", "Standard · ~3", "Forge · ~20"].map((t, k) => (
                  <span key={t} style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 10px", borderRadius: 999, border: "1px solid rgba(15,23,42,0.12)", background: k === 0 ? "#0F172A" : "#fff", color: k === 0 ? "#fff" : "#475569" }}>{t}</span>
                ))}
              </div>
            </div>
          ); })()}
        </div>
      </div>

      {/* ── DETAIL PANEL (metadata inside, never on canvas) ── */}
      <div style={{ width: 290, borderRadius: 18, background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 20px 50px -24px rgba(11,18,40,0.3)", padding: "16px 16px 18px", overflowY: "auto", fontSize: 13, color: "#334155" }}>
        {!sel ? <div style={{ color: "#94A3B8" }}>Click a pill.</div> : (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8" }}>{TYPE_LABEL[sel.type] ?? sel.type}</div>
            <div style={{ fontSize: 16.5, fontWeight: 700, color: "#0F172A", lineHeight: 1.25, marginTop: 4 }}>{sel.label}</div>
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 12, background: "rgba(15,23,42,0.03)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B" }}>STRENGTH</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#0F172A" }}>{sel.strength}</span>
              </div>
              <Bar label="Rubric score" value={(sel.score ?? 50) / 100} />
              <Bar label="Centrality (load-bearing)" value={sel.centrality} />
              <Bar label="Novelty" value={sel.novelty} />
              {sel.generic > 0 && <div style={{ marginTop: 6, fontSize: 11, color: "#E11D48", fontWeight: 600 }}>− generic-language penalty (noise)</div>}
            </div>
            {sel.meta && Object.keys(sel.meta).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 6 }}>Details</div>
                {Object.entries(sel.meta).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 8, padding: "4px 0", borderTop: "1px solid rgba(15,23,42,0.06)" }}>
                    <span style={{ minWidth: 92, fontSize: 11.5, color: "#94A3B8", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
                    <span style={{ flex: 1, fontSize: 12, color: "#334155" }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16, fontSize: 11, lineHeight: 1.5, color: "#94A3B8" }}>Pill shows only the label; everything here lives behind the click. One graph, lens + overlay toggles — never a new card.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Segmented({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#94A3B8" }}>{label}</span>
      <div style={{ display: "flex", background: "rgba(15,23,42,0.05)", borderRadius: 999, padding: 2 }}>
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "none", cursor: "pointer", background: value === v ? "#fff" : "transparent", color: value === v ? "#0F172A" : "#64748B", boxShadow: value === v ? "0 1px 3px rgba(11,18,40,0.12)" : "none" }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function chip(active: boolean) {
  return { fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(15,23,42,0.12)", background: active ? "#0F172A" : "#fff", color: active ? "#fff" : "#334155", cursor: "pointer" } as const;
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#64748B", marginBottom: 3 }}>{label}</div>
      <div style={{ height: 5, borderRadius: 999, background: "rgba(15,23,42,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "linear-gradient(90deg,#0EA5E9,#2563EB)" }} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ position: "absolute", bottom: 12, left: 14, zIndex: 2, display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "#64748B", background: "rgba(255,255,255,0.85)", padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(15,23,42,0.08)" }}>
      <span style={{ fontWeight: 600 }}>Ambiguity</span>
      <span style={{ width: 9, height: 9, borderRadius: 999, background: "#10B981" }} /> resolved
      <span style={{ width: 9, height: 9, borderRadius: 999, background: "#F59E0B" }} /> open
      <span style={{ width: 9, height: 9, borderRadius: 999, background: "#E11D48" }} /> ambiguous
    </div>
  );
}
