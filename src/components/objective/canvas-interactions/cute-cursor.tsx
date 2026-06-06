"use client";

// ── CuteCollaboratorCursor ────────────────────────────────────────
//
// Custom replacement for tldraw's default collaborator cursor. tldraw
// gives us the page-space point + current zoom; we render an SVG
// "bubble pointer" — a chubby rounded teardrop in the peer's color
// with an inner gloss, a soft glow that pulses, and a curved name pill
// that hangs from the tip on a hair-thin connector. Stays a constant
// screen size via `scale(1/zoom)` so cursors don't grow as you zoom in.
//
// Wired into the board via TLComponents.CollaboratorCursor in
// whiteboard-base.tsx; the editor only mounts it when a presence record
// exists for a peer on the current page (see LiveCollaborators).

import type { TLCursorProps } from "tldraw";

export function CuteCollaboratorCursor({
  point,
  zoom,
  color = "#2563eb",
  name,
  className,
}: TLCursorProps) {
  if (!point) return null;
  // Hair-thin border + softer glow at deeper zooms; tldraw passes us
  // page-space coords, so we compensate to keep visual size constant.
  const inv = 1 / zoom;
  const safeName = (name ?? "").trim();
  const initial = safeName ? safeName.charAt(0).toUpperCase() : "✦";

  return (
    <div
      className={className}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        // translate in page coords, then inverse-scale so the visual stays
        // pixel-stable; transform-origin top-left so the tip sits exactly
        // on (point.x, point.y) at any zoom.
        transform: `translate(${point.x}px, ${point.y}px) scale(${inv})`,
        transformOrigin: "0 0",
        pointerEvents: "none",
        willChange: "transform",
      }}
    >
      {/* ── pointer bubble ── */}
      <svg
        width={30}
        height={34}
        viewBox="0 0 30 34"
        style={{
          display: "block",
          overflow: "visible",
          filter: `drop-shadow(0 6px 10px ${color}55) drop-shadow(0 1px 0 rgba(0,0,0,0.18))`,
          animation: "cute-cursor-bob 2.6s ease-in-out infinite",
        }}
      >
        <defs>
          <radialGradient id={`cc-fill-${safeName || "g"}`} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="55%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </radialGradient>
        </defs>
        {/* soft outer halo that breathes — subtle, only visible against
            light surfaces; sits behind the bubble */}
        <circle
          cx="9"
          cy="9"
          r="11"
          fill={color}
          opacity="0.18"
          style={{
            animation: "cute-cursor-pulse 2.2s ease-in-out infinite",
            transformOrigin: "9px 9px",
          }}
        />
        {/* bubble — rounded teardrop tipped at (0,0) like a cursor.
            Hand-tuned path: tip at top-left, fat lobe bottom-right. */}
        <path
          d="M1.5 1.5
             C 1.5 1.5, 22 6.5, 21 16
             C 20 24, 12 24, 9 21
             L 5.5 24
             C 4.2 25, 2.5 24, 2.5 22.3
             L 2.5 14
             C 2.5 12, 1 10.5, 1 6
             Z"
          fill={`url(#cc-fill-${safeName || "g"})`}
          stroke="#ffffff"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* inner gloss — a tiny white wink near the tip */}
        <ellipse cx="6.5" cy="6" rx="2" ry="1.2" fill="#ffffff" opacity="0.7" />
      </svg>

      {/* ── name pill ── hangs from the bubble like a little tag */}
      {safeName && (
        <div
          style={{
            position: "absolute",
            top: 26,
            left: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 9px 3px 6px",
            borderRadius: 999,
            background: color,
            color: "#fff",
            fontFamily:
              "ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "-0.005em",
            whiteSpace: "nowrap",
            boxShadow:
              `0 4px 10px -2px ${color}66, inset 0 1px 0 rgba(255,255,255,0.35)`,
            border: "1.5px solid rgba(255,255,255,0.85)",
            transform: "translateZ(0)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "rgba(255,255,255,0.95)",
              color,
              fontSize: 9,
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textTransform: "uppercase",
            }}
          >
            {initial}
          </span>
          {safeName}
        </div>
      )}

      {/* keyframes are scoped to <style> here so the cursor file ships
          self-contained — no global CSS coupling. */}
      <style>{`
        @keyframes cute-cursor-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-1.5px); }
        }
        @keyframes cute-cursor-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.18; }
          50%      { transform: scale(1.25); opacity: 0.08; }
        }
      `}</style>
    </div>
  );
}
