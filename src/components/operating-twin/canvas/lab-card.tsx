"use client";

import { cn } from "@/lib/utils";
import { Target, Zap, AlertTriangle, Activity, Compass, GitBranch } from "lucide-react";
import type { LabCard as LabCardType } from "@/types/operating-twin";

interface LabCardProps {
  lab: LabCardType;
  x: number;
  y: number;
  dimmed: boolean;
  onHover: (lab: LabCardType | null) => void;
  onClick: (lab: LabCardType) => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  leverage: "#007AFF",       // app blue (leverage)
  perspective: "#3B82F6",    // slightly different blue
  objective: "#34C759",      // green (success)
  risk: "#FF3B30",           // red
  bottleneck: "#FF9500",     // amber
  process: "#10B981",
};

function CategoryIcon({ category, size = 14 }: { category: string; size?: number }) {
  const common = { width: size, height: size, strokeWidth: 1.6 };
  switch (category) {
    case "leverage":
      return <Zap {...common} />;
    case "perspective":
      return <Compass {...common} />;
    case "objective":
      return <Target {...common} />;
    case "risk":
      return <AlertTriangle {...common} />;
    case "bottleneck":
      return <GitBranch {...common} />;
    default:
      return <Activity {...common} />;
  }
}

export function LabCard({ lab, x, y, dimmed, onHover, onClick }: LabCardProps) {
  const color = CATEGORY_COLOR[lab.category] ?? "#6e7079";
  const size = lab.size ?? "m";

  const sizeConfig = {
    xl: { minWidth: 210, padding: "14px 16px", valueSize: 26, nameSize: 13.5 },
    l: { minWidth: 195, padding: "13px 15px", valueSize: 24, nameSize: 13.5 },
    m: { minWidth: 180, padding: "12px 14px 13px", valueSize: 22, nameSize: 13 },
    s: { minWidth: 165, padding: "11px 13px", valueSize: 19, nameSize: 12.5 },
  }[size];

  const primary = lab.metrics[0];
  const isDraft = lab.mode === "draft";

  const statusDotColor =
    lab.status === "healthy"
      ? "#10b981"
      : lab.status === "warning"
        ? "#f59e0b"
        : lab.status === "critical"
          ? "#ef4444"
          : "#a4a6ad";

  return (
    <div
      data-no-pan
      data-lab-id={lab.id}
      className={cn(
        "operating-twin-lab-card",
        dimmed && "opacity-30",
        isDraft && "is-draft",
      )}
      onMouseEnter={() => onHover(lab)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(lab)}
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        background: isDraft ? "#fafafa" : "#ffffff",
        border: isDraft ? "1px dashed #d2d3d7" : "0.5px solid rgba(10,11,15,0.08)",
        borderRadius: 12,
        padding: sizeConfig.padding,
        minWidth: sizeConfig.minWidth,
        cursor: "pointer",
        zIndex: 6,
        boxShadow: "0 1px 2px rgba(10,11,15,0.03)",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        ["--category-color" as string]: color,
      } as React.CSSProperties}
    >
      {/* Status dot */}
      <div
        style={{
          position: "absolute",
          top: -4,
          right: -4,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: statusDotColor,
          border: "2px solid #ffffff",
        }}
      />

      {/* Update badge */}
      {lab.has_update && (
        <div
          className="font-mono"
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            fontSize: 9,
            fontWeight: 700,
            color: "#fff",
            background: "var(--accent-600)",
            padding: "3px 6px",
            borderRadius: 5,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            border: "1.5px solid #fff",
            boxShadow: "0 2px 6px rgba(0, 81, 204, 0.3)",
          }}
        >
          1 new
        </div>
      )}

      {/* Top row: icon + mode tag + contribution */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: color,
            flexShrink: 0,
          }}
        >
          <CategoryIcon category={lab.category} size={14} />
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            color: lab.mode === "lab" ? "var(--accent-600)" : "#6e7079",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "2px 6px",
            background: lab.mode === "lab" ? "var(--accent-50)" : "#f5f5f7",
            borderRadius: 3,
          }}
        >
          {lab.mode === "draft" ? "DRAFT" : lab.mode === "lab" ? "LAB" : "TRACKER"}
        </span>
        <span
          className="font-mono"
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 700,
            color: isDraft ? "#a4a6ad" : color,
          }}
        >
          {isDraft ? "—" : `${lab.contribution_pct > 0 ? "+" : ""}${lab.contribution_pct}%`}
        </span>
      </div>

      {/* Lab name */}
      <div
        style={{
          fontSize: sizeConfig.nameSize,
          fontWeight: 600,
          color: isDraft ? "#6e7079" : "#0a0b0f",
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          marginBottom: isDraft ? 0 : 10,
        }}
      >
        {lab.name}
      </div>

      {/* Metric row */}
      {primary && !isDraft && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontSize: sizeConfig.valueSize,
              fontWeight: 700,
              color: "#0a0b0f",
              letterSpacing: "-0.045em",
              lineHeight: 1,
              fontFeatureSettings: "'tnum'",
            }}
          >
            {primary.value}
          </span>
          {primary.unit && (
            <span style={{ fontSize: 11, color: "#6e7079", fontWeight: 500, marginLeft: 2 }}>
              {primary.unit}
            </span>
          )}
          {primary.label && !primary.unit && (
            <span style={{ fontSize: 11, color: "#6e7079", fontWeight: 500, marginLeft: 4 }}>
              {primary.label}
            </span>
          )}
          {primary.trend_delta && (
            <span
              className="font-mono"
              style={{
                marginLeft: "auto",
                fontSize: 10.5,
                fontWeight: 700,
                color:
                  primary.trend === "up"
                    ? "#10b981"
                    : primary.trend === "down"
                      ? "#ef4444"
                      : "#6e7079",
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              {primary.trend_delta}
            </span>
          )}
        </div>
      )}

      {isDraft && (
        <div style={{ fontSize: 12, color: "#6e7079", fontWeight: 500, marginTop: 4 }}>
          awaiting approval
        </div>
      )}
    </div>
  );
}
