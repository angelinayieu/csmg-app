"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T } from "./tokens";
import { Mono, Pill, GlobalStyles } from "./ui";
import { SEARCH_INDEX } from "./data";
import DagWorkspace from "./workspaces/dag";
import SimulationWorkspace from "./workspaces/simulation";
import DiscoveryWorkspace from "./workspaces/discovery";
import AuditWorkspace from "./workspaces/audit";
import TrajectoryWorkspace from "./workspaces/trajectory";
import TwinWorkspace from "./workspaces/twin";

type Ws = "dag" | "sim" | "disc" | "audit" | "traj" | "twin";

const NAV: { id: Ws; label: string; icon: React.ReactNode; key: string; desc: string }[] = [
  {
    id: "dag",
    label: "DAG Explorer",
    key: "1",
    desc: "63-node knowledge graph",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="4" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/><circle cx="14" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/><circle cx="9" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/><line x1="5.5" y1="6.5" x2="8" y2="12.5" stroke="currentColor" strokeWidth="1"/><line x1="12.5" y1="6.5" x2="10" y2="12.5" stroke="currentColor" strokeWidth="1"/></svg>
    ),
  },
  {
    id: "sim",
    label: "Simulation",
    key: "2",
    desc: "Patient-stratified Bayesian inference",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="4" width="3" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="7.5" y="2" width="3" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="13" y="6" width="3" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
    ),
  },
  {
    id: "disc",
    label: "Discovery",
    key: "3",
    desc: "Self-improvement evidence loop",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.3"/><line x1="9" y1="3" x2="9" y2="8" stroke="currentColor" strokeWidth="1.2"/><circle cx="9" cy="8" r="1" fill="currentColor"/><line x1="12.5" y1="12" x2="15" y2="15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
    ),
  },
  {
    id: "audit",
    label: "Audit Trail",
    key: "4",
    desc: "Full provenance & source ingestion",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><rect x="4" y="2" width="10" height="14" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2"/><line x1="7" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1"/><line x1="7" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1"/><line x1="7" y1="12" x2="10" y2="12" stroke="currentColor" strokeWidth="1"/><circle cx="5.5" cy="6" r="0.6" fill="currentColor"/><circle cx="5.5" cy="9" r="0.6" fill="currentColor"/><circle cx="5.5" cy="12" r="0.6" fill="currentColor"/></svg>
    ),
  },
  {
    id: "traj",
    label: "Trajectory",
    key: "5",
    desc: "Temporal · dose-response · population",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 14 Q5 6 9 9 T16 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/></svg>
    ),
  },
  {
    id: "twin",
    label: "Digital Twin",
    key: "6",
    desc: "Live simulator · patient-specific forecast",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="9" cy="9" r="2.5" fill="currentColor" opacity="0.9"/><circle cx="9" cy="2.5" r="1" fill="currentColor"/><circle cx="15.5" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15.5" r="1" fill="currentColor"/><circle cx="2.5" cy="9" r="1" fill="currentColor"/></svg>
    ),
  },
];

// ─── Command Palette ─────────────────────────────────────────────
function CommandPalette({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (ws: Ws) => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.focus();
    setQ("");
  }, [open]);

  const results = useMemo(() => {
    if (!q) return SEARCH_INDEX.filter((s) => s.type === "workspace");
    const t = q.toLowerCase();
    return SEARCH_INDEX.filter((s) => s.label.toLowerCase().includes(t) || s.short.toLowerCase().includes(t) || (s.sub || "").toLowerCase().includes(t)).slice(0, 14);
  }, [q]);

  const typeColors: Record<string, string> = {
    node: T.blue,
    edge: T.hi,
    workspace: T.ink,
    chain: T.mid,
    paper: T.purple,
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.44)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        paddingTop: 120,
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 580,
          maxHeight: 460,
          background: "rgba(255,255,255,0.96)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(15,23,42,0.24), 0 0 0 1px rgba(15,23,42,0.06)",
          overflow: "hidden",
          animation: "crci-fade-in 0.18s ease",
          backdropFilter: "blur(20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "2px 6px 2px 18px", borderBottom: `1px solid ${T.border}` }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0, opacity: 0.3 }}>
            <circle cx="7" cy="7" r="5.5" stroke="#64748B" fill="none" strokeWidth="1.5" />
            <line x1="11" y1="11" x2="14" y2="14" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search nodes, edges, papers, workspaces..."
            style={{
              flex: 1,
              padding: "14px 12px",
              fontSize: 14,
              border: "none",
              outline: "none",
              fontFamily: T.sans,
              background: "transparent",
              color: T.ink,
            }}
          />
          <Mono style={{ fontSize: 9, color: T.ink3, padding: "4px 8px", background: T.raised, borderRadius: 4, marginRight: 10 }}>ESC</Mono>
        </div>
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {results.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: T.ink3, fontSize: 12 }}>No results</div>
          )}
          {results.map((r) => (
            <div
              key={r.id}
              style={{
                padding: "10px 18px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: `1px solid ${T.borderLt}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = T.hover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              onClick={() => {
                onSelect((r.target as { ws: Ws }).ws);
                onClose();
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.ink }}>{r.label}</div>
                <div style={{ fontSize: 10, color: T.ink3, marginTop: 1 }}>{r.sub}</div>
              </div>
              <Pill color={typeColors[r.type] || T.ink2}>{r.type}</Pill>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Platform Shell ─────────────────────────────────────────
export default function CRCIPlatform() {
  const [ws, setWs] = useState<Ws>("dag");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [railHover, setRailHover] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if (e.key === "Escape") setCmdOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (NAV[idx]) setWs(NAV[idx].id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleNavigate = useCallback((target: string) => {
    if (target === "dag" || target === "sim" || target === "disc" || target === "audit" || target === "traj" || target === "twin") {
      setWs(target);
    }
  }, []);

  return (
    <div
      className="crci-root"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        fontFamily: T.sans,
        color: T.ink,
        background: "#FAFBFC",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <GlobalStyles />

      {/* LEFT RAIL */}
      <div
        className="crci-rail-gradient"
        style={{
          width: T.rail,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 10,
          flexShrink: 0,
          zIndex: 30,
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.04)",
        }}
        onMouseEnter={() => setRailHover(true)}
        onMouseLeave={() => setRailHover(false)}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "linear-gradient(145deg, rgba(59,130,246,0.32), rgba(109,40,217,0.2))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            fontSize: 12.5,
            fontWeight: 800,
            color: "#E0E7FF",
            fontFamily: T.mono,
            letterSpacing: "-0.05em",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
          }}
        >
          C
        </div>

        {NAV.map((n) => (
          <div
            key={n.id}
            onClick={() => setWs(n.id)}
            title={`${n.label} (⌘${n.key})`}
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: ws === n.id ? "#FFFFFF" : "#64748B",
              background: ws === n.id ? "rgba(255,255,255,0.12)" : "transparent",
              marginBottom: 4,
              transition: "all 0.15s",
              position: "relative",
            }}
          >
            {n.icon}
            {ws === n.id && (
              <div
                style={{
                  position: "absolute",
                  left: -6,
                  top: 8,
                  bottom: 8,
                  width: 3,
                  borderRadius: 2,
                  background: "#3B82F6",
                  boxShadow: "0 0 8px rgba(59,130,246,0.6)",
                }}
              />
            )}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <div
          onClick={() => setCmdOpen(true)}
          title="Search (⌘K)"
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#64748B",
            marginBottom: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Rail expanded overlay */}
      {railHover && (
        <div
          className="crci-rail-gradient"
          onMouseEnter={() => setRailHover(true)}
          onMouseLeave={() => setRailHover(false)}
          style={{
            position: "absolute",
            left: T.rail,
            top: 0,
            bottom: 0,
            width: 180,
            zIndex: 29,
            paddingTop: 58,
            animation: "crci-fade-in 0.18s ease",
            boxShadow: "4px 0 24px rgba(15,23,42,0.24)",
          }}
        >
          {NAV.map((n) => (
            <div
              key={n.id}
              onClick={() => {
                setWs(n.id);
                setRailHover(false);
              }}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                color: ws === n.id ? "#FFFFFF" : "#94A3B8",
                fontSize: 12,
                fontWeight: ws === n.id ? 600 : 400,
                background: ws === n.id ? "rgba(255,255,255,0.06)" : "transparent",
                fontFamily: T.sans,
                borderLeft: ws === n.id ? "2px solid #3B82F6" : "2px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{n.label}</span>
                <span style={{ fontSize: 9, opacity: 0.45, fontFamily: T.mono }}>⌘{n.key}</span>
              </div>
              <div style={{ fontSize: 9.5, color: "#64748B", marginTop: 2, fontFamily: T.mono }}>{n.desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div
          className="crci-glass"
          style={{
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            height: 46,
            flexShrink: 0,
            borderLeft: "none",
            borderTop: "none",
            borderRight: "none",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {NAV.find((n) => n.id === ws)?.label}
          </div>
          <Mono style={{ fontSize: 10, color: T.ink3, marginLeft: 10 }}>
            CRCI Bayesian Causal Evidence Navigator
          </Mono>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 14, fontFamily: T.mono, fontSize: 10, color: T.ink3 }}>
            <span><b style={{ color: T.ink }}>63</b> nodes</span>
            <span><b style={{ color: T.ink }}>91</b> edges</span>
            <span><b style={{ color: T.ink }}>168</b> records</span>
            <span><b style={{ color: T.ink }}>74</b> papers</span>
          </div>
          <div style={{ width: 1, height: 18, background: T.border, margin: "0 14px" }} />
          <button
            onClick={() => setCmdOpen(true)}
            style={{
              padding: "5px 12px",
              fontSize: 10.5,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              background: T.raised,
              cursor: "pointer",
              fontFamily: T.mono,
              color: T.ink2,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>Search</span>
            <span style={{ opacity: 0.5 }}>⌘K</span>
          </button>
          <div style={{ width: 1, height: 18, background: T.border, margin: "0 14px" }} />
          <Mono style={{ fontSize: 10, color: T.ink3 }}>v1.0 · 2026-04-15</Mono>
        </div>

        {/* Workspace content */}
        <div style={{ flex: 1, overflow: "hidden", background: "#FAFBFC" }}>
          {ws === "dag" && <DagWorkspace onNavigate={handleNavigate} />}
          {ws === "sim" && <SimulationWorkspace />}
          {ws === "disc" && <DiscoveryWorkspace />}
          {ws === "audit" && <AuditWorkspace />}
          {ws === "traj" && <TrajectoryWorkspace />}
          {ws === "twin" && <TwinWorkspace />}
        </div>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onSelect={setWs} />
    </div>
  );
}
