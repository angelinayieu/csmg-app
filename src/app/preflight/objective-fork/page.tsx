// Objective → two-way downward fork — LAYOUT preview (Step 7 structure).
//
// The user's spec: the summarized objective card is PURE title + description.
// The details (the ambiguity heatmap + the priority map) are NOT inside it —
// they FORK OUT as their own cards, one level down, joined by a single
// connector that drops from the objective and splits TWO ways (a "downward
// root"). The two forked cards are the SAME size, clean, and scaled so the
// content the user must see is visible.
//
// LAYOUT only (light board, matching the current app). Once approved, the same
// structure gets wired onto the real board: the sharpening card sheds its
// embedded heatmap/priority sections, and deployHeatmapCard + deployPriorityMapCard
// drop the two cards below it with the fork connector.
//
// SAFE TO DELETE — exploration. Route: /preflight/objective-fork

"use client";

const BOARD = "#f5f6f8";
const DOT = "#d7dae1";
const CARD = "#ffffff";
const BORDER = "#e6e8ee";
const INK = "#0f172a";
const SUB = "#475569";
const FAINT = "#94a3b8";
const ACCENT = "#2563eb";

const SEV: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#94a3b8" };
const KIND: Record<string, string> = { GOAL: "#eab308", TERM: "#ec4899", LIMIT: "#f97316" };

const ZONES: { name: string; sev: keyof typeof SEV; note: string }[] = [
  { name: "Intent", sev: "medium", note: "‘social media’ is broad" },
  { name: "Target user", sev: "high", note: "no persona defined" },
  { name: "Problem", sev: "medium", note: "what gap it closes" },
  { name: "Outcome", sev: "high", note: "no success metric" },
  { name: "Scope", sev: "high", note: "‘frontier problems’ vague" },
  { name: "Mechanism", sev: "high", note: "debate format unset" },
  { name: "Output format", sev: "medium", note: "no deliverable" },
  { name: "Source", sev: "low", note: "no reference set" },
  { name: "Constraint", sev: "low", note: "none given" },
  { name: "Routing", sev: "medium", note: "where it feeds" },
];

const PRIORITY: { tag: keyof typeof KIND; phrase: string }[] = [
  { tag: "GOAL", phrase: "flow mood when doing a task" },
  { tag: "GOAL", phrase: "match people by interest" },
  { tag: "TERM", phrase: "specific task" },
  { tag: "TERM", phrase: "music remix" },
  { tag: "LIMIT", phrase: "anyone can join" },
];

// ── geometry: one objective card on top, two same-size cards below ──
const W = 792;
const H = 660;
const OBJ = { x: 226, y: 36, w: 340, h: 112 };
const CARD_W = 360;
const CARD_H = 320;
const ROW_Y = 300;
const LEFT = { x: 28, y: ROW_Y, w: CARD_W, h: CARD_H };
const RIGHT = { x: W - CARD_W - 28, y: ROW_Y, w: CARD_W, h: CARD_H };

const objBottom = { x: OBJ.x + OBJ.w / 2, y: OBJ.y + OBJ.h };
const forkY = ROW_Y - 46; // where the single stem splits into two
const leftTop = { x: LEFT.x + LEFT.w / 2, y: LEFT.y };
const rightTop = { x: RIGHT.x + RIGHT.w / 2, y: RIGHT.y };

export default function ObjectiveForkPreflight() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eceef2",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "30px 0 60px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ color: SUB, fontSize: 13, fontWeight: 600 }}>
        Objective → two-way downward fork (layout)
      </div>

      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ borderRadius: 18, border: `1px solid ${BORDER}`, boxShadow: "0 24px 60px -28px rgba(15,23,42,0.28)" }}>
        <defs>
          <pattern id="g" width={24} height={24} patternUnits="userSpaceOnUse">
            <circle cx={1.4} cy={1.4} r={1.4} fill={DOT} />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={BOARD} />
        <rect width={W} height={H} fill="url(#g)" />

        {/* ── the downward "root" connector: one stem from the objective, then
              it splits two ways down to each card ── */}
        <path
          d={`M ${objBottom.x} ${objBottom.y} L ${objBottom.x} ${forkY}`}
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${objBottom.x} ${forkY} C ${objBottom.x} ${ROW_Y}, ${leftTop.x} ${forkY}, ${leftTop.x} ${leftTop.y}`}
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${objBottom.x} ${forkY} C ${objBottom.x} ${ROW_Y}, ${rightTop.x} ${forkY}, ${rightTop.x} ${rightTop.y}`}
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />

        {/* ── objective card: PURE title + description ── */}
        <g>
          <rect x={OBJ.x} y={OBJ.y} width={OBJ.w} height={OBJ.h} rx={16} fill={CARD} stroke={BORDER} />
          <text x={OBJ.x + 18} y={OBJ.y + 26} fill={FAINT} fontSize={9.5} fontWeight={700} letterSpacing="1.4">
            OBJECTIVE
          </text>
          <text x={OBJ.x + 18} y={OBJ.y + 52} fill={INK} fontSize={16} fontWeight={700}>
            Debate-Focused Social Platform
          </text>
          <text x={OBJ.x + 18} y={OBJ.y + 78} fill={SUB} fontSize={12.5}>
            A space to debate the world&apos;s frontier
          </text>
          <text x={OBJ.x + 18} y={OBJ.y + 96} fill={SUB} fontSize={12.5}>
            problems with people who share the interest.
          </text>
        </g>

        {/* ── forked card 1: ambiguity heatmap (10 zones, 2-col, scaled) ── */}
        <g>
          <rect x={LEFT.x} y={LEFT.y} width={LEFT.w} height={LEFT.h} rx={16} fill={CARD} stroke={BORDER} />
          <text x={LEFT.x + 18} y={LEFT.y + 28} fill={FAINT} fontSize={9.5} fontWeight={700} letterSpacing="1.2">
            AMBIGUITY HEATMAP
          </text>
          {ZONES.map((z, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const cx = LEFT.x + 18 + col * 168;
            const cy = LEFT.y + 54 + row * 50;
            return (
              <g key={z.name}>
                <circle cx={cx + 4} cy={cy + 6} r={4} fill={SEV[z.sev]} />
                <text x={cx + 16} y={cy + 10} fill={INK} fontSize={11.5} fontWeight={600}>
                  {z.name}
                </text>
                <text x={cx + 16} y={cy + 26} fill={FAINT} fontSize={9.5}>
                  {z.note}
                </text>
              </g>
            );
          })}
        </g>

        {/* ── forked card 2: priority map (same size, scaled) ── */}
        <g>
          <rect x={RIGHT.x} y={RIGHT.y} width={RIGHT.w} height={RIGHT.h} rx={16} fill={CARD} stroke={BORDER} />
          <text x={RIGHT.x + 18} y={RIGHT.y + 28} fill={FAINT} fontSize={9.5} fontWeight={700} letterSpacing="1.2">
            PRIORITY MAP · WHAT TO OPTIMIZE FOR
          </text>
          {PRIORITY.map((p, i) => {
            const cy = RIGHT.y + 54 + i * 50;
            return (
              <g key={i}>
                <rect x={RIGHT.x + 18} y={cy - 6} width={RIGHT.w - 36} height={40} rx={9} fill="#f8fafc" stroke={BORDER} />
                <circle cx={RIGHT.x + 32} cy={cy + 14} r={4} fill={KIND[p.tag]} />
                <text x={RIGHT.x + 44} y={cy + 11} fill={FAINT} fontSize={8.5} fontWeight={700} letterSpacing="0.6">
                  {p.tag}
                </text>
                <text x={RIGHT.x + 44} y={cy + 26} fill={INK} fontSize={12} fontWeight={600}>
                  {p.phrase}
                </text>
                <circle cx={RIGHT.x + RIGHT.w - 40} cy={cy + 14} r={3.5} fill={ACCENT} opacity={0.85} />
                <circle cx={RIGHT.x + RIGHT.w - 28} cy={cy + 14} r={3.5} fill={FAINT} />
              </g>
            );
          })}
        </g>

        {/* ports drawn LAST so the circular endpoints sit ON TOP of the card
            edges — never half-cropped under a card. */}
        <circle cx={objBottom.x} cy={objBottom.y} r={5} fill={ACCENT} stroke={CARD} strokeWidth={2.5} />
        <circle cx={objBottom.x} cy={forkY} r={4} fill={ACCENT} />
        <circle cx={leftTop.x} cy={leftTop.y} r={5} fill={ACCENT} stroke={CARD} strokeWidth={2.5} />
        <circle cx={rightTop.x} cy={rightTop.y} r={5} fill={ACCENT} stroke={CARD} strokeWidth={2.5} />
      </svg>

      <div style={{ color: FAINT, fontSize: 11.5, maxWidth: 660, textAlign: "center", lineHeight: 1.5 }}>
        Objective card = title + description only. The heatmap + priority map fork
        OUT as their own same-size cards, joined by one connector that drops and
        splits two ways. Layout only — wired onto the real board (light or dark)
        once approved.
      </div>
    </div>
  );
}
