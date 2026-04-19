"use client";

import React from "react";
import { T } from "./tokens";

export const Mono = ({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => <span style={{ fontFamily: T.mono, ...style }}>{children}</span>;

export function Pill({
  children,
  color = T.ink2,
  bg,
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        fontSize: 9,
        fontFamily: T.mono,
        fontWeight: 600,
        border: `1px solid ${color}`,
        borderRadius: 3,
        color,
        background: bg || "transparent",
        letterSpacing: "0.03em",
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export const Label = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 600,
      color: T.ink2,
      fontFamily: T.mono,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      marginBottom: 6,
    }}
  >
    {children}
  </div>
);

export function StatCard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: T.raised,
        borderRadius: 8,
        border: `1px solid ${T.borderLt}`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: T.ink2,
          fontFamily: T.mono,
          fontWeight: 600,
          marginBottom: 3,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: T.mono, color: color ?? T.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.ink3, fontFamily: T.mono, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function GlobalStyles() {
  return (
    <style jsx global>{`
      @import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@300;400;500;600;700;800&display=swap");
      .crci-root *::-webkit-scrollbar { width: 6px; height: 6px; }
      .crci-root *::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
      .crci-root *::-webkit-scrollbar-track { background: transparent; }
      .crci-root ::selection { background: #BFDBFE; }
      .crci-root input[type="number"]::-webkit-inner-spin-button { opacity: 0.3; }
      .crci-root input[type="range"] { height: 4px; -webkit-appearance: none; appearance: none; background: #F1F5F9; border-radius: 2px; outline: none; }
      .crci-root input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; background: currentColor; }
      @keyframes crci-fade-in { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
      @keyframes crci-pulse-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4);} 50% { box-shadow: 0 0 0 8px rgba(59,130,246,0);} }
      .crci-glass {
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: saturate(140%) blur(12px);
        -webkit-backdrop-filter: saturate(140%) blur(12px);
        border: 1px solid rgba(15, 23, 42, 0.06);
        box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 32px rgba(15,23,42,0.06);
      }
      .crci-rail-gradient {
        background: linear-gradient(180deg, #0F172A 0%, #0B1120 100%);
      }
    `}</style>
  );
}
