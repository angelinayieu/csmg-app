// Dark flow-builder connector LOOK — Step 7 aesthetic preview (no tldraw yet).
//
// Faithful to the user's chosen reference: a dark canvas + dot grid, dark
// rounded node cards, smooth bezier wires with CIRCULAR ports + a green→pink
// gradient. Encoding (our feature/variable model): GREEN port = output ("feeds",
// right edge) · PINK port = input ("depends_on", left edge). The wire runs
// green→pink so a glance shows what flows into what.
//
// This is the LOOK only — once approved, the same visual gets wired onto REAL
// bound connectors (custom tldraw shape over the native-arrow binding the
// connector-drag-layer already uses), so it moves with the cards.
//
// SAFE TO DELETE — exploration. Route: /preflight/dark-connectors

"use client";

const BG = "#0e0e12";
const GRID = "#26262e";
const CARD = "#1b1b21";
const CARD_BORDER = "#30303a";
const TEXT = "#e9e9ee";
const SUBTEXT = "#9a9aa6";
const GREEN = "#34d399"; // output · "feeds"
const PINK = "#ec4899"; // input · "depends_on"

const KIND_COLOR: Record<string, string> = {
  OBJECTIVE: "#8b5cf6",
  FEATURE: "#38bdf8",
  VARIABLE: "#fbbf24",
};

interface Node {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  tag: keyof typeof KIND_COLOR;
}

const NODES: Node[] = [
  { id: "obj", x: 56, y: 246, w: 236, h: 96, title: "Task-Linked Music App", sub: "The objective", tag: "OBJECTIVE" },
  { id: "remix", x: 432, y: 118, w: 236, h: 96, title: "Stem Remix Blender", sub: "Swap stems into one blend", tag: "FEATURE" },
  { id: "match", x: 432, y: 372, w: 236, h: 96, title: "Interest Matching", sub: "Rank listeners by taste + task", tag: "FEATURE" },
  { id: "quality", x: 812, y: 120, w: 212, h: 78, title: "Match Quality", tag: "VARIABLE" },
  { id: "source", x: 812, y: 250, w: 212, h: 78, title: "Remix Source", tag: "VARIABLE" },
  { id: "taste", x: 812, y: 380, w: 212, h: 78, title: "Music Taste", tag: "VARIABLE" },
];

const EDGES: { from: string; to: string }[] = [
  { from: "obj", to: "remix" },
  { from: "obj", to: "match" },
  { from: "remix", to: "source" },
  { from: "remix", to: "quality" },
  { from: "match", to: "quality" },
  { from: "match", to: "taste" },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<string, Node>;

// Distribute each node's out-ports along its right edge and in-ports along its
// left edge, so multi-connection nodes fan cleanly (as in the reference).
function computeWires() {
  const outs: Record<string, number[]> = {};
  const ins: Record<string, number[]> = {};
  EDGES.forEach((e, i) => {
    (outs[e.from] ??= []).push(i);
    (ins[e.to] ??= []).push(i);
  });
  return EDGES.map((e, i) => {
    const a = byId[e.from];
    const b = byId[e.to];
    const oList = outs[e.from];
    const iList = ins[e.to];
    const oi = oList.indexOf(i);
    const ii = iList.indexOf(i);
    const x1 = a.x + a.w;
    const y1 = a.y + (a.h * (oi + 1)) / (oList.length + 1);
    const x2 = b.x;
    const y2 = b.y + (b.h * (ii + 1)) / (iList.length + 1);
    return { i, x1, y1, x2, y2 };
  });
}

const WIRES = computeWires();

export default function DarkConnectorsPreflight() {
  const W = 1080;
  const H = 580;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#08080a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        padding: "32px 0 64px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ color: "#cfcfd6", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
        Dark flow-builder — connector look
      </div>
      <div style={{ color: "#74747f", fontSize: 12, display: "flex", gap: 18, alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
          output · feeds
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: PINK, boxShadow: `0 0 8px ${PINK}` }} />
          input · depends&nbsp;on
        </span>
      </div>

      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ borderRadius: 18, border: `1px solid ${CARD_BORDER}`, boxShadow: "0 30px 80px -30px rgba(0,0,0,0.8)" }}
      >
        <defs>
          <pattern id="dots" width={26} height={26} patternUnits="userSpaceOnUse">
            <circle cx={1.5} cy={1.5} r={1.5} fill={GRID} />
          </pattern>
          {WIRES.map((w) => (
            <linearGradient
              key={`g${w.i}`}
              id={`wire${w.i}`}
              gradientUnits="userSpaceOnUse"
              x1={w.x1}
              y1={w.y1}
              x2={w.x2}
              y2={w.y2}
            >
              <stop offset="0%" stopColor={GREEN} />
              <stop offset="100%" stopColor={PINK} />
            </linearGradient>
          ))}
        </defs>

        {/* canvas */}
        <rect x={0} y={0} width={W} height={H} fill={BG} />
        <rect x={0} y={0} width={W} height={H} fill="url(#dots)" />

        {/* wires — strong gradient beziers, behind the cards */}
        {WIRES.map((w) => {
          const dx = Math.max(40, Math.abs(w.x2 - w.x1) * 0.5);
          const d = `M ${w.x1} ${w.y1} C ${w.x1 + dx} ${w.y1}, ${w.x2 - dx} ${w.y2}, ${w.x2} ${w.y2}`;
          return (
            <g key={`w${w.i}`}>
              <path d={d} fill="none" stroke={`url(#wire${w.i})`} strokeWidth={3} strokeLinecap="round" opacity={0.95} />
            </g>
          );
        })}

        {/* node cards */}
        {NODES.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx={14}
              fill={CARD}
              stroke={CARD_BORDER}
              strokeWidth={1}
            />
            <text x={n.x + 16} y={n.y + 24} fill={KIND_COLOR[n.tag]} fontSize={9} fontWeight={700} letterSpacing="1.2">
              {n.tag}
            </text>
            <text x={n.x + 16} y={n.y + (n.sub ? 48 : 47)} fill={TEXT} fontSize={15} fontWeight={650}>
              {n.title}
            </text>
            {n.sub && (
              <text x={n.x + 16} y={n.y + 70} fill={SUBTEXT} fontSize={12}>
                {n.sub}
              </text>
            )}
          </g>
        ))}

        {/* ports — circular, on the card edges, on top of everything */}
        {WIRES.map((w) => (
          <g key={`p${w.i}`}>
            <circle cx={w.x1} cy={w.y1} r={6} fill={GREEN} stroke={BG} strokeWidth={2} />
            <circle cx={w.x1} cy={w.y1} r={6} fill="none" stroke={GREEN} strokeWidth={1} opacity={0.5}>
              <animate attributeName="r" values="6;9;6" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={w.x2} cy={w.y2} r={6} fill={PINK} stroke={BG} strokeWidth={2} />
          </g>
        ))}
      </svg>

      <div style={{ color: "#5a5a64", fontSize: 11.5, maxWidth: 680, textAlign: "center", lineHeight: 1.5 }}>
        Look only. Once approved, this exact style renders on REAL bound connectors
        (a custom tldraw connector shape over the native-arrow binding) so the wires
        move with the cards. Strong circular ports + gradient wires; nodes are
        title-first and expand for detail.
      </div>
    </div>
  );
}
