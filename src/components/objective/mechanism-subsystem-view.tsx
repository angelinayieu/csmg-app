"use client";

// ── MechanismSubsystemView ────────────────────────────────────────
//
// A SEPARATE view for the relationships the causal-flow Map deliberately
// drops: mechanism↔mechanism `composes_with` / `interferes_with`. The flow
// Map answers "how does each lever reach the result?" (a directed spine);
// this answers "how do the levers interlock?" — a different axis (coupling,
// not flow), so it gets its own representation instead of being tangled in.
//
// Faithful encoding (verified against the generator):
//   • `composes_with` is SYMMETRIC ("two mechanisms share a load-bearing
//     first-principle") → an undirected "composes" link. NOT a dependency
//     arrow — there is no upstream/downstream between mechanisms.
//   • `interferes_with` is a symmetric CONFLICT → a dashed red link.
//   • Mechanisms group into SUBSYSTEMS by sub_category (the "layers of
//     concern"), shown as soft folder-tabbed halos — so "everything relates
//     to everything" collapses into a few legible modules, not a hairball.
//
// The directed upstream→downstream story the user wants already exists as the
// causal spine (the Map); this view is purely the coupling layer.

import { useMemo, useState } from "react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export interface SubsystemSpec {
  id: string;
  label: string;
  /** Accent hex (#rrggbb) — identity glow + folder tab. */
  color: string;
}

export interface MechanismSpec {
  id: string;
  name: string;
  subtitle?: string | null;
  /** Which subsystem (SubsystemSpec.id) this mechanism belongs to. */
  subsystem: string;
}

/** Undirected — composes_with and interferes_with are both symmetric. */
export interface CouplingEdge {
  a: string;
  b: string;
  rationale?: string | null;
}

interface Props {
  subsystems: SubsystemSpec[];
  mechanisms: MechanismSpec[];
  composes: CouplingEdge[];
  conflicts: CouplingEdge[];
}

const PAD = 40;
const COL_W = 224;
const CARD_W = 184;
const CARD_H = 68;
const ROW_H = 170;
const STACK_GAP = 18;

function tint(hex: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(71,85,105, ${alpha})`;
}

export function MechanismSubsystemView({
  subsystems,
  mechanisms,
  composes,
  conflicts,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  // ── Layout ──
  // Each subsystem is a horizontal band (row); its members spread left→right
  // within the band. There is NO depth/flow axis — mechanisms are peers.
  const layout = useMemo(() => {
    const subOrder = new Map(subsystems.map((s, i) => [s.id, i]));
    const membersBySub = new Map<string, MechanismSpec[]>();
    for (const m of mechanisms) {
      const arr = membersBySub.get(m.subsystem) ?? [];
      arr.push(m);
      membersBySub.set(m.subsystem, arr);
    }

    const pos = new Map<string, { x: number; y: number }>();
    let maxCols = 1;
    for (const [subId, members] of membersBySub) {
      const row = subOrder.get(subId) ?? 0;
      const bandTop = PAD + row * ROW_H;
      maxCols = Math.max(maxCols, members.length);
      members.forEach((m, i) => {
        pos.set(m.id, {
          x: PAD + i * COL_W,
          y: bandTop + (ROW_H - CARD_H) / 2,
        });
      });
    }

    const width = PAD * 2 + maxCols * CARD_W + (maxCols - 1) * (COL_W - CARD_W);
    const height = PAD + subsystems.length * ROW_H;

    const halos = subsystems.map((s) => {
      const members = membersBySub.get(s.id) ?? [];
      const xs = members.map((m) => pos.get(m.id)?.x ?? PAD);
      const ys = members.map((m) => pos.get(m.id)?.y ?? PAD);
      const minX = (members.length ? Math.min(...xs) : PAD) - 22;
      const minY = (members.length ? Math.min(...ys) : PAD) - 30;
      const maxX = (members.length ? Math.max(...xs) : PAD) + CARD_W + 22;
      const maxY = (members.length ? Math.max(...ys) : PAD) + CARD_H + 22;
      return { ...s, x: minX, y: minY, w: maxX - minX, h: maxY - minY, count: members.length };
    });

    return { pos, width, height, halos };
  }, [subsystems, mechanisms]);

  // ── Hover: light the lever's own subsystem + anything it conflicts with. ──
  const activeSet = useMemo(() => {
    if (!hoverId) return null;
    const sub = mechanisms.find((m) => m.id === hoverId)?.subsystem;
    const set = new Set<string>([hoverId]);
    for (const m of mechanisms) if (m.subsystem === sub) set.add(m.id);
    for (const c of [...composes, ...conflicts]) {
      if (c.a === hoverId) set.add(c.b);
      if (c.b === hoverId) set.add(c.a);
    }
    return set;
  }, [hoverId, mechanisms, composes, conflicts]);

  const subColor = (id: string) =>
    subsystems.find((s) => s.id === id)?.color ?? appleVibe.stage.features;
  const center = (id: string) => {
    const p = layout.pos.get(id);
    return p ? { x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 } : { x: 0, y: 0 };
  };
  const edgeDim = (a: string, b: string) =>
    activeSet ? !(activeSet.has(a) && activeSet.has(b)) : false;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          width: layout.width,
          height: layout.height + PAD,
          maxWidth: "100%",
          background: appleVibe.surface.base,
          border: `1px solid ${appleVibe.stroke.soft}`,
        }}
      >
        {/* ── Subsystem halos (folder-tabbed soft clusters) ── */}
        {layout.halos.map((h) => (
          <div key={h.id} className="absolute" style={{ left: h.x, top: h.y, width: h.w, height: h.h }}>
            <div
              className="absolute inset-0 rounded-[22px]"
              style={{
                background: tint(h.color, 0.05),
                boxShadow: `inset 0 0 0 1px ${tint(h.color, 0.12)}, 0 8px 30px -18px ${tint(h.color, 0.5)}`,
              }}
            />
            <div
              className="absolute -top-[13px] left-5 flex items-center gap-1.5 rounded-t-[10px] px-3 py-1"
              style={{ background: tint(h.color, 0.92), boxShadow: `0 -1px 6px -2px ${tint(h.color, 0.5)}` }}
            >
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.9)" }} />
              <span className="text-[11px] font-semibold tracking-[0.01em]" style={{ color: "#fff" }}>
                {h.label}
              </span>
            </div>
          </div>
        ))}

        {/* ── Coupling links ── */}
        <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
          {/* composes_with — undirected, soft (no arrowhead) */}
          {composes.map((e, i) => {
            const a = center(e.a);
            const b = center(e.b);
            const dim = edgeDim(e.a, e.b);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const bow = a.y === b.y ? 22 : 0; // bow same-row links so they don't sit under the cards
            return (
              <path
                key={`m${i}`}
                d={`M ${a.x} ${a.y} Q ${mx} ${my - bow}, ${b.x} ${b.y}`}
                fill="none"
                stroke={tint("#475569", 0.85)}
                strokeWidth={1.7}
                style={{ opacity: dim ? 0.1 : 0.55, transition: "opacity 160ms ease" }}
              />
            );
          })}
          {/* interferes_with — conflict */}
          {conflicts.map((e, i) => {
            const a = center(e.a);
            const b = center(e.b);
            const dim = edgeDim(e.a, e.b);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={`c${i}`} style={{ opacity: dim ? 0.12 : 0.9, transition: "opacity 160ms ease" }}>
                <path d={`M ${a.x} ${a.y} Q ${mx} ${my - 26}, ${b.x} ${b.y}`} fill="none" stroke="#DC2626" strokeWidth={1.8} strokeDasharray="5 4" />
                <circle cx={mx} cy={my - 13} r={8} fill="#fff" stroke="#DC2626" strokeWidth={1.4} />
                <text x={mx} y={my - 9.5} textAnchor="middle" fontSize="10" fill="#DC2626" fontWeight={700}>!</text>
              </g>
            );
          })}
        </svg>

        {/* ── Mechanism cards ── */}
        {mechanisms.map((m) => {
          const p = layout.pos.get(m.id);
          if (!p) return null;
          const accent = subColor(m.subsystem);
          const faded = activeSet ? !activeSet.has(m.id) : false;
          const focused = hoverId === m.id;
          return (
            <div
              key={m.id}
              onMouseEnter={() => setHoverId(m.id)}
              onMouseLeave={() => setHoverId(null)}
              className="absolute flex flex-col justify-center gap-0.5 rounded-2xl px-3.5 py-2.5"
              style={{
                left: p.x,
                top: p.y,
                width: CARD_W,
                minHeight: CARD_H,
                background: "rgba(255,255,255,0.78)",
                backdropFilter: "blur(14px) saturate(140%)",
                WebkitBackdropFilter: "blur(14px) saturate(140%)",
                border: `1px solid ${focused ? tint(accent, 0.5) : appleVibe.stroke.hairline}`,
                boxShadow: focused
                  ? `0 1px 0 rgba(255,255,255,0.7) inset, 0 14px 34px -14px rgba(11,18,40,0.26), 0 0 22px -6px ${tint(accent, 0.45)}`
                  : `0 1px 0 rgba(255,255,255,0.7) inset, 0 8px 22px -14px rgba(11,18,40,0.22), 0 0 0 1px ${tint(accent, 0.05)}`,
                opacity: faded ? 0.34 : 1,
                transition: "opacity 160ms ease, box-shadow 180ms ease, border-color 180ms ease",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: accent, boxShadow: `0 0 0 3px ${tint(accent, 0.14)}` }} />
                <span className="text-[12px] font-semibold leading-tight" style={{ color: appleVibe.text.primary }}>{m.name}</span>
              </div>
              {m.subtitle ? (
                <span className="pl-[15px] text-[9.5px] leading-snug" style={{ color: appleVibe.text.tertiary }}>{m.subtitle}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ── Legend ── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px]" style={{ color: appleVibe.text.secondary }}>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke={tint("#475569", 0.85)} strokeWidth="1.7" /></svg>
          composes with (shares a principle)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#DC2626" strokeWidth="1.8" strokeDasharray="5 4" /></svg>
          conflicts with
        </span>
        <span style={{ color: appleVibe.text.tertiary }}>Hover a lever to isolate its subsystem.</span>
      </div>

      <SubsystemInsights subsystems={subsystems} mechanisms={mechanisms} composes={composes} conflicts={conflicts} />
    </div>
  );
}

function SubsystemInsights({ subsystems, mechanisms, composes, conflicts }: Props) {
  const rows = useMemo(
    () =>
      subsystems.map((s) => {
        const members = mechanisms.filter((m) => m.subsystem === s.id);
        const memberIds = new Set(members.map((m) => m.id));
        const internalComposes = composes.filter(
          (c) => memberIds.has(c.a) && memberIds.has(c.b),
        ).length;
        return { ...s, count: members.length, internalComposes };
      }),
    [subsystems, mechanisms, composes],
  );

  const conflictPairs = useMemo(
    () =>
      conflicts.map((c) => ({
        a: mechanisms.find((m) => m.id === c.a)?.name ?? c.a,
        b: mechanisms.find((m) => m.id === c.b)?.name ?? c.b,
        rationale: c.rationale ?? "",
      })),
    [conflicts, mechanisms],
  );

  return (
    <div className="mt-5 flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-xl px-3.5 py-2.5" style={{ background: appleVibe.surface.card, boxShadow: appleVibe.shadow.chip }}>
          <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
          <span className="text-[12.5px] font-semibold" style={{ color: appleVibe.text.primary }}>{r.label}</span>
          <span className="text-[11.5px]" style={{ color: appleVibe.text.secondary }}>
            {r.count} mechanism{r.count === 1 ? "" : "s"}
            {r.internalComposes > 0
              ? ` — ${r.internalComposes} internal composition${r.internalComposes === 1 ? "" : "s"}; strong candidate to bundle as one feature`
              : " — independent levers"}
            .
          </span>
        </div>
      ))}
      {conflictPairs.map((c, i) => (
        <div key={`cf${i}`} className="flex items-start gap-3 rounded-xl px-3.5 py-2.5" style={{ background: "rgba(220,38,38,0.06)", boxShadow: appleVibe.shadow.chip }}>
          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#DC2626" }}>!</span>
          <span className="text-[11.5px]" style={{ color: "#991B1B" }}>
            <strong>{c.a}</strong> conflicts with <strong>{c.b}</strong>
            {c.rationale ? ` — ${c.rationale}` : " — resolve the tension before shipping both"}.
          </span>
        </div>
      ))}
    </div>
  );
}
