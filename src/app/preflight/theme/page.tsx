// Dark board THEME iteration surface. Route: /preflight/theme
//
// Unlike a hand-authored mock, this renders the REAL appleVibe tokens inside a
// `.oc-board` / `.oc-board.oc-dark` wrapper — the exact scope the production
// board uses. So every card/chrome color here is driven by the `--av-*` CSS
// vars in globals.css: tweak those vars, reload, and this preview updates with
// the same values the live board will use. The real board sits behind auth, so
// this is the auth-free place to pixel-iterate the dark palette.
//
// SAFE TO DELETE once the palette is locked.

"use client";

import { useState } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// The canvas + dot grid are tldraw-controlled on the real board (not appleVibe
// tokens), so we mirror tldraw's light/dark canvas here by hand. Everything
// else themes through the tokens.
const CANVAS = { light: "#f6f6f4", dark: "#0e0e12" };
const DOT = { light: "rgba(15,23,42,0.07)", dark: "rgba(255,255,255,0.05)" };
// Flow-connector port colors (defined in flow-connector-shape, not tokens).
const GREEN = "#34d399"; // out / feeds
const PINK = "#ec4899"; // in / depends_on

function Card({
  x,
  y,
  w,
  tag,
  tagColor,
  title,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  tag?: string;
  tagColor?: string;
  title: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.md,
        boxShadow: appleVibe.shadow.card,
        padding: "14px 16px",
        boxSizing: "border-box",
      }}
    >
      {tag && (
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: tagColor ?? appleVibe.text.faint,
            marginBottom: 6,
          }}
        >
          {tag}
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 650, color: appleVibe.text.primary, lineHeight: 1.3 }}>
        {title}
      </div>
      {sub && (
        <div style={{ marginTop: 5, fontSize: 12, color: appleVibe.text.tertiary, lineHeight: 1.45 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Wire({ x1, y1, x2, y2, id }: { x1: number; y1: number; x2: number; y2: number; id: string }) {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return (
    <g>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset="0%" stopColor={GREEN} />
          <stop offset="100%" stopColor={PINK} />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth={3} strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={6} fill={GREEN} />
      <circle cx={x2} cy={y2} r={6} fill={PINK} />
    </g>
  );
}

export default function ThemePreflight() {
  const [dark, setDark] = useState(true);
  const mode = dark ? "dark" : "light";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: dark ? "#08080b" : "#ececea",
        padding: 24,
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ color: dark ? "#cfcfd6" : "#1f2937", fontSize: 14, fontWeight: 600 }}>
            Board theme — live token preview
          </div>
          <div style={{ color: dark ? "#74747f" : "#6b7280", fontSize: 12, marginTop: 2 }}>
            Real appleVibe tokens via <code>.oc-board.oc-dark</code>. Edit{" "}
            <code>--av-*</code> in globals.css → reload to iterate.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.14)"}`,
            background: dark ? "rgba(255,255,255,0.06)" : "#ffffff",
            color: dark ? "#e9e9ee" : "#1f2937",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {dark ? "◐ Dark" : "◑ Light"} · toggle
        </button>
      </div>

      {/* THE SCOPE WRAPPER — exactly what whiteboard-base renders. */}
      <div
        className={`oc-board${dark ? " oc-dark" : ""}`}
        style={{
          position: "relative",
          height: 660,
          borderRadius: 18,
          overflow: "hidden",
          border: `1px solid ${appleVibe.stroke.soft}`,
          backgroundColor: CANVAS[mode],
          backgroundImage: `radial-gradient(${DOT[mode]} 1.4px, transparent 1.4px)`,
          backgroundSize: "26px 26px",
        }}
      >
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <Wire id="w1" x1={238} y1={140} x2={258} y2={126} />
          <Wire id="w2" x1={238} y1={300} x2={258} y2={300} />
          <Wire id="w3" x1={358} y1={200} x2={358} y2={262} />
          <Wire id="w4" x1={358} y1={372} x2={358} y2={430} />
        </svg>

        <Card x={28} y={96} w={210} tag="OBJECTIVE" tagColor={appleVibe.stage.objective}
          title="Task-Linked Music Discovery App" sub="Press to open ↗" />
        <Card x={28} y={262} w={210} tag="SHARPENED" tagColor={appleVibe.stage.features}
          title="Debate-Focused Social Platform"
          sub="Tag community-curated tracks to lifestyle task categories." />
        <Card x={258} y={96} w={200} tag="FEATURE" tagColor={appleVibe.stage.features}
          title="Stem Remix Blender" sub="Swap stems into one blend." />
        <Card x={258} y={262} w={200} tag="VARIABLE" tagColor={appleVibe.stage.outcomes}
          title="Match Quality" sub="Fit between track + task mood." />
        <Card x={258} y={430} w={200} tag="VARIABLE" tagColor={appleVibe.stage.outcomes}
          title="Music Taste" sub="The user's evolving preference vector." />

        {/* goal rail — themed by tokens */}
        <div
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            bottom: 16,
            width: 250,
            background: appleVibe.surface.cardElevated,
            border: `1px solid ${appleVibe.stroke.soft}`,
            borderRadius: 14,
            padding: 14,
            boxSizing: "border-box",
            backdropFilter: "blur(12px)",
            boxShadow: appleVibe.shadow.card,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: appleVibe.text.primary, marginBottom: 12 }}>
            Goal &amp; alignment
          </div>
          <div className={appleVibe.label.className} style={{ color: appleVibe.label.color, textTransform: "uppercase" }}>
            Clarity &amp; priorities
          </div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: appleVibe.surface.chip, overflow: "hidden" }}>
            <span style={{ display: "block", width: "57%", height: "100%", background: appleVibe.stage.outcomes, borderRadius: 999 }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: appleVibe.text.tertiary }}>4 of 7 resolved</div>
          <div className={appleVibe.label.className} style={{ marginTop: 14, color: appleVibe.label.color, textTransform: "uppercase" }}>
            Nail next
          </div>
          {["flow mood", "match criteria", "remix meaning"].map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 0" }}>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: appleVibe.text.faint }}>Goal</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: appleVibe.text.primary }}>{t}</span>
            </div>
          ))}
          <button
            style={{
              marginTop: 12,
              width: "100%",
              padding: "8px",
              borderRadius: 10,
              border: "none",
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Resolve open questions →
          </button>
        </div>
      </div>
    </div>
  );
}
