"use client";

import type { LabCard } from "@/types/operating-twin";

interface LabInspectorProps {
  lab: LabCard | null;
  position: { x: number; y: number } | null;
}

export function LabInspector({ lab, position }: LabInspectorProps) {
  if (!lab || !position) return null;

  const modeLabel = lab.mode === "draft" ? "DRAFT" : lab.mode === "lab" ? "LAB" : "TRACKER";
  const eyebrow =
    lab.source_type === "leverage_point"
      ? `LEVERAGE · ${lab.confidence >= 0.7 ? "high conf" : "mod conf"}`
      : lab.source_type === "strategy_perspective"
        ? "STRATEGY PERSPECTIVE"
        : lab.source_type === "goal"
          ? `${modeLabel} · OBJECTIVE`
          : lab.source_type === "risk_point"
            ? "RISK · CRITICAL"
            : modeLabel;

  const rows: Array<[string, string]> = [];
  if (lab.metrics[0]) {
    rows.push([lab.metrics[0].label, lab.metrics[0].value]);
    if (lab.metrics[0].target) rows.push(["target", lab.metrics[0].target]);
  }
  rows.push(["confidence", `${Math.round(lab.confidence * 100)}%`]);
  rows.push(["contribution", `${lab.contribution_pct > 0 ? "+" : ""}${lab.contribution_pct} pts`]);
  if (lab.entity_ids.length > 0) {
    rows.push(["entities", `${lab.entity_ids.length} linked`]);
  }

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        transform: "translateX(-50%)",
        background: "#0a0b0f",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 13px 11px",
        minWidth: 220,
        fontSize: "11.5px",
        boxShadow:
          "0 12px 32px rgba(10,11,15,0.2), 0 2px 8px rgba(10,11,15,0.12)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          color: "var(--accent-300, #a5b4fc)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          marginBottom: 8,
          letterSpacing: "-0.015em",
        }}
      >
        {lab.name}
      </div>
      {rows.map(([label, value], i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "4px 0",
            fontSize: 11,
            color: "rgba(255,255,255,0.7)",
            borderTop: i > 0 ? "0.5px solid rgba(255,255,255,0.08)" : undefined,
          }}
        >
          <span>{label}</span>
          <strong style={{ color: "#fff", fontWeight: 600 }}>{value}</strong>
        </div>
      ))}
    </div>
  );
}
