// ── Starburst (SVG fallback) ──
//
// The flat 2D starburst — the "idea" node as a hub with rays radiating
// out, a few terminating in dots. Hand-placed (no randomness) so SSR +
// client agree. Kept dependency-free (no three.js) so it can be the
// instant SSR paint AND the graceful fallback when WebGL is unavailable
// or prefers-reduced-motion is set. The 3D version (starburst-3d.tsx)
// renders this same star shape at rest, then reveals depth on hover.

const INK = "#0B0B0C";

const C = { x: 170, y: 105 };
const DOTTED = [
  { x: 162, y: 12 }, // top
  { x: 272, y: 48 }, // upper-right
  { x: 322, y: 116 }, // far-right
  { x: 176, y: 196 }, // bottom
  { x: 24, y: 92 }, // far-left
];
const LINES = [
  { x: 96, y: 26 }, // upper-left
  { x: 74, y: 168 }, // lower-left
  { x: 256, y: 176 }, // lower-right
  { x: 210, y: 36 }, // inner upper-right
];

/** Sized to the same box the 3D canvas uses, so swapping between them
 *  (loading / WebGL-fail) causes no layout shift. */
export function StarburstSVG({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        width: "100%",
        maxWidth: 420,
        margin: "0 auto",
        aspectRatio: "4 / 3",
      }}
    >
      <svg
        viewBox="0 0 340 210"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        {[...DOTTED, ...LINES].map((p, i) => (
          <line
            key={i}
            x1={C.x}
            y1={C.y}
            x2={p.x}
            y2={p.y}
            stroke={INK}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        ))}
        {DOTTED.map((p, i) => (
          <circle key={`d${i}`} cx={p.x} cy={p.y} r={5} fill={INK} />
        ))}
        <circle cx={C.x} cy={C.y} r={7} fill={INK} />
      </svg>
    </div>
  );
}
