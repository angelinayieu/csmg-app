"use client";

// ── LayerGraph ───────────────────────────────────────────────────────
//
// Connections live between the DETAILS inside topics, not between topic names.
// Compound graph + bundling + expand-to-unbundle:
//
//   OVERVIEW — topics in abstraction LAYERS; between topics, ONE bundled edge
//              whose THICKNESS = how many micro-connections cross. Dense
//              relationships read as weight, not spaghetti.
//   FOCUS    — click a topic → a clean LOCAL MAP: the topic expands in the
//              centre with its detail rows; only its connected neighbours pull
//              in close around it; short edges run from the DETAILS to the
//              neighbours. Layer guides hide (we're zoomed into a neighbourhood).
//
// Styling is deliberately CALM: white pills, hairline neutral border, colour
// ONLY in the small type-dot. No saturated borders. Pure SVG.

import { useMemo } from "react";

export interface LGDetail { id: string; label: string }
export interface LGTopic { id: string; keyword: string; label: string; type: string; layer: number; details: LGDetail[] }
export interface LGMicro { source: string; target: string }

const DOT: Record<string, string> = {
  objective: "#0F172A", leverage_point: "#F59E0B", first_principle: "#7C3AED",
  variable: "#0D9488", constraint: "#E11D48", sub_objective: "#0EA5E9", feature: "#2563EB", concept: "#64748B",
};
const dotOf = (t: string) => DOT[t] ?? DOT.concept;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const W = 1160;
const H = 720;
export const LAYER_LABELS = ["First principles", "Leverage points", "Variables", "Features"];

// Calm, uniform pill chrome — white fill, hairline neutral border.
const STROKE = "rgba(15,23,42,0.10)";
const STROKE_HI = "rgba(15,23,42,0.28)";
const SHADOW = "drop-shadow(0 5px 12px rgba(11,18,40,0.07))";

export function LayerGraph({
  topics, micro, focusId, onFocus,
}: {
  topics: LGTopic[]; micro: LGMicro[]; focusId: string | null; onFocus: (id: string | null) => void;
}) {
  const m = useMemo(() => {
    const topicOf = new Map<string, string>();
    topics.forEach((t) => t.details.forEach((d) => topicOf.set(d.id, t.id)));
    const bundle = new Map<string, number>();
    for (const e of micro) {
      const a = topicOf.get(e.source), b = topicOf.get(e.target);
      if (!a || !b || a === b) continue;
      const k = [a, b].sort().join("|");
      bundle.set(k, (bundle.get(k) ?? 0) + 1);
    }
    const deg = new Map<string, number>();
    topics.forEach((t) => deg.set(t.id, 0));
    for (const [k, w] of bundle) { const [a, b] = k.split("|"); deg.set(a, (deg.get(a) ?? 0) + w); deg.set(b, (deg.get(b) ?? 0) + w); }
    const layers = new Map<number, LGTopic[]>();
    topics.forEach((t) => (layers.get(t.layer) ?? layers.set(t.layer, []).get(t.layer)!).push(t));
    const Ls = [...layers.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    Ls.forEach((L, li) => {
      const row = layers.get(L)!;
      const y = 120 + li * ((H - 200) / Math.max(1, Ls.length - 1));
      row.forEach((t, i) => pos.set(t.id, { x: ((i + 1) / (row.length + 1)) * W, y }));
    });
    return { topicOf, bundle, deg, pos, Ls, layers };
  }, [topics, micro]);

  const focus = focusId ? topics.find((t) => t.id === focusId) ?? null : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* layer guides — only in overview */}
      {!focus && m.Ls.map((L, li) => {
        const y = 120 + li * ((H - 200) / Math.max(1, m.Ls.length - 1));
        return (
          <g key={`lab-${L}`}>
            <line x1={28} y1={y} x2={W - 24} y2={y} stroke="rgba(15,23,42,0.035)" strokeWidth={1} />
            <text x={28} y={y - 20} fontSize={10} fontWeight={700} letterSpacing="0.08em" fill="#A4ADBA" style={{ textTransform: "uppercase" }}>{LAYER_LABELS[L] ?? `Layer ${L}`}</text>
          </g>
        );
      })}
      {!focus ? <Overview topics={topics} m={m} onFocus={onFocus} /> : <Focus focus={focus} topics={topics} micro={micro} m={m} onFocus={onFocus} />}
    </svg>
  );
}

function Pill({ x, y, keyword, type, badge, w, onClick, title, dim, h = 38 }: { x: number; y: number; keyword: string; type: string; badge?: number; w: number; onClick?: () => void; title?: string; dim?: boolean; h?: number }) {
  return (
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`} style={{ cursor: onClick ? "pointer" : "default", opacity: dim ? 0.32 : 1, transition: "opacity 140ms" }} onClick={onClick}>
      {title && <title>{title}</title>}
      <rect width={w} height={h} rx={h / 2} fill="#fff" stroke={STROKE} strokeWidth={1} style={{ filter: SHADOW }} />
      <circle cx={15} cy={h / 2} r={4} fill={dotOf(type)} />
      <text x={27} y={h / 2 + 0.5} dominantBaseline="central" fontSize={12.5} fontWeight={600} fill="#0F172A">{trunc(keyword, 16)}</text>
      {typeof badge === "number" && (
        <g transform={`translate(${w - 28}, ${h / 2 - 9})`}>
          <rect width={20} height={18} rx={9} fill="rgba(15,23,42,0.05)" />
          <text x={10} y={9.5} dominantBaseline="central" textAnchor="middle" fontSize={10} fontWeight={700} fill="#64748B">{badge}</text>
        </g>
      )}
    </g>
  );
}

// ── OVERVIEW: layered topics + weighted bundle edges (all neutral) ──
function Overview({ topics, m, onFocus }: { topics: LGTopic[]; m: any; onFocus: (id: string | null) => void }) {
  return (
    <>
      {[...m.bundle.entries()].map(([k, w]: [string, number]) => {
        const [a, b] = k.split("|");
        const pa = m.pos.get(a), pb = m.pos.get(b);
        if (!pa || !pb) return null;
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 - 24;
        return <path key={k} d={`M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`} fill="none" stroke="#0F172A" strokeOpacity={Math.min(0.34, 0.08 + w * 0.045)} strokeWidth={Math.min(6.5, 1 + w * 0.85)} strokeLinecap="round" />;
      })}
      {topics.map((t) => {
        const p = m.pos.get(t.id); if (!p) return null;
        const w = Math.max(96, t.keyword.length * 8 + 56);
        return <Pill key={t.id} x={p.x} y={p.y} keyword={t.keyword} type={t.type} badge={m.deg.get(t.id) ?? 0} w={w} title={`${t.label} — ${m.deg.get(t.id) ?? 0} connections · click to expand`} onClick={() => onFocus(t.id)} />;
      })}
    </>
  );
}

// ── FOCUS: clean local map — topic expands centre, neighbours ring close ──
function Focus({ focus, topics, micro, m, onFocus }: { focus: LGTopic; topics: LGTopic[]; micro: LGMicro[]; m: any; onFocus: (id: string | null) => void }) {
  const topicOf: Map<string, string> = m.topicOf;
  const fdet = new Set(focus.details.map((d) => d.id));

  // Which neighbour topics connect to focus details, and how many links each.
  const nbWeight = new Map<string, number>();
  for (const e of micro) {
    const aF = fdet.has(e.source), bF = fdet.has(e.target);
    if (aF === bF) continue;
    const other = topicOf.get(aF ? e.target : e.source);
    if (other && other !== focus.id) nbWeight.set(other, (nbWeight.get(other) ?? 0) + 1);
  }
  const neighbours = [...nbWeight.keys()].map((id) => topics.find((t) => t.id === id)!).filter(Boolean);

  // Card centre-left; details stacked. Neighbours on a right-arc, CLOSE.
  const cardW = 340, headH = 50, rowH = 30, rowGap = 8, pad = 14;
  const cardH = headH + focus.details.length * (rowH + rowGap) + pad;
  const cardX = 150, cardY = (H - cardH) / 2;
  const cardRight = cardX + cardW;
  const rowCY = (i: number) => cardY + headH + i * (rowH + rowGap) + rowH / 2;
  const detailY = new Map(focus.details.map((d, i) => [d.id, rowCY(i)]));

  // Neighbour positions: vertical column to the right, evenly spaced (short, parallel edges).
  const nbX = 760;
  const nbTop = 120, nbBottom = H - 120;
  const nbPos = new Map<string, { x: number; y: number }>();
  neighbours.forEach((t, i) => nbPos.set(t.id, { x: nbX, y: neighbours.length === 1 ? H / 2 : nbTop + (i * (nbBottom - nbTop)) / (neighbours.length - 1) }));

  // Edges: detail row → neighbour pill (neutral, short, exit the card's right edge).
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const e of micro) {
    const aF = fdet.has(e.source), bF = fdet.has(e.target);
    if (aF === bF) continue;
    const det = aF ? e.source : e.target;
    const other = topicOf.get(aF ? e.target : e.source);
    const dy = detailY.get(det); const np = other ? nbPos.get(other) : null;
    if (dy != null && np) edges.push({ x1: cardRight - 4, y1: dy, x2: np.x - Math.max(86, 0) / 2, y2: np.y });
  }

  return (
    <>
      {/* edges first (calm neutral) */}
      {edges.map((e, i) => (
        <path key={i} d={`M ${e.x1} ${e.y1} C ${e.x1 + 70} ${e.y1}, ${e.x2 - 70} ${e.y2}, ${e.x2} ${e.y2}`} fill="none" stroke="rgba(15,23,42,0.22)" strokeWidth={1.3} />
      ))}

      {/* focus card */}
      <g style={{ cursor: "pointer" }} onClick={() => onFocus(null)}>
        <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={16} fill="#fff" stroke={STROKE} strokeWidth={1} style={{ filter: "drop-shadow(0 18px 40px rgba(11,18,40,0.12))" }} />
        <circle cx={cardX + 20} cy={cardY + 26} r={4.5} fill={dotOf(focus.type)} />
        <text x={cardX + 33} y={cardY + 20} fontSize={9.5} fontWeight={700} letterSpacing="0.06em" fill="#A4ADBA" style={{ textTransform: "uppercase" }}>{focus.type.replace(/_/g, " ")}</text>
        <text x={cardX + 33} y={cardY + 36} fontSize={14} fontWeight={700} fill="#0F172A">{trunc(focus.label, 34)}</text>
      </g>
      {/* detail rows (the out-fork) */}
      {focus.details.map((d, i) => {
        const y = rowCY(i);
        return (
          <g key={d.id} transform={`translate(${cardX + 14}, ${y - rowH / 2})`}>
            <rect width={cardW - 28} height={rowH} rx={8} fill="#F8FAFC" stroke="rgba(15,23,42,0.06)" />
            <circle cx={12} cy={rowH / 2} r={3} fill={dotOf(focus.type)} />
            <text x={22} y={rowH / 2 + 0.5} dominantBaseline="central" fontSize={11.5} fontWeight={500} fill="#334155">{trunc(d.label, 38)}</text>
          </g>
        );
      })}

      {/* connected neighbours (close column, calm) */}
      {neighbours.map((t) => {
        const p = nbPos.get(t.id)!; const w = Math.max(96, t.keyword.length * 8 + 56);
        return <Pill key={t.id} x={p.x} y={p.y} keyword={t.keyword} type={t.type} badge={nbWeight.get(t.id)} w={w} title={t.label} onClick={() => onFocus(t.id)} />;
      })}

      {/* hint */}
      <text x={cardX} y={cardY - 16} fontSize={11} fontWeight={500} fill="#94A3B8">{focus.keyword} · {edges.length} connections from its details — click the card to collapse</text>
    </>
  );
}
