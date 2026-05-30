// Layer-2 interaction prototype — the whiteboard "mixing" loop:
//   • nodes = your ideas (stickies) + artifacts plucked from rooms
//   • click / shift-click to select; drag to move
//   • a contextual floating toolbar keys off selection count
//       1 → Expand · Query     2 → Connect · Compare     N → Synthesize
//   • drag one node onto another → quick connect
//   • every AI output is a GHOST (dashed edge / faint card) you ✓ accept
//     or ✗ reject — nothing auto-commits
//
// Mock AI responses; once the feel is signed off these actions wire to
// the real /pipeline/prospect-connections, /room/correlations, deepen
// endpoints. SAFE TO DELETE.

"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Sparkles, Plus, GitMerge, Search, Maximize2 } from "lucide-react";
import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";

const EASE = [0.22, 1, 0.36, 1] as const;

type Kind = "idea" | "artifact";
interface GNode {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  color: string;
  ghost?: boolean;
}
interface GEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  ghost?: boolean;
}

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

const SEED_NODES: GNode[] = [
  { id: "a1", kind: "artifact", x: 360, y: 180, w: 220, h: 84, title: "Intentional Browsing Prompter", sub: "mechanism · from Goal-Driven room", color: "#2563EB" },
  { id: "a2", kind: "artifact", x: 760, y: 300, w: 220, h: 84, title: "Reduced Passive Browsing Time", sub: "outcome · 80% composite", color: "#16A34A" },
  { id: "i1", kind: "idea", x: 380, y: 460, w: 190, h: 72, title: "tie to dopamine feed", color: "#FEF3C7" },
  { id: "i2", kind: "idea", x: 820, y: 540, w: 190, h: 72, title: "reward intentional searches", color: "#FCE7F3" },
];

const center = (n: GNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

export default function Page() {
  const [nodes, setNodes] = useState<GNode[]>(SEED_NODES);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const byId = (id: string) => nodes.find((n) => n.id === id);

  // ── selection ──
  const toggleSelect = (id: string, additive: boolean) => {
    setSelected((cur) => {
      if (additive) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return cur.length === 1 && cur[0] === id ? [] : [id];
    });
  };

  // ── drag (with click-vs-drag threshold + drop-to-connect) ──
  const onNodeDown = (e: React.PointerEvent, n: GNode) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - (byId(d.id)!.x + d.dx)) > 3 || Math.abs(e.clientY - (byId(d.id)!.y + d.dy)) > 3) d.moved = true;
    setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: e.clientX - d.dx, y: e.clientY - d.dy } : n)));
  };
  const onUp = (e: React.PointerEvent, shift: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      toggleSelect(d.id, shift);
      return;
    }
    // drop-to-connect: dragged node released over another node?
    const dragged = byId(d.id)!;
    const c = center(dragged);
    const target = nodes.find((n) => n.id !== d.id && c.x > n.x && c.x < n.x + n.w && c.y > n.y && c.y < n.y + n.h);
    if (target) proposeConnect(d.id, target.id);
  };

  // ── AI actions → ghost proposals (mock) ──
  const proposeConnect = useCallback((from: string, to: string) => {
    const a = byId(from), b = byId(to);
    if (!a || !b) return;
    setEdges((es) => [
      ...es,
      { id: uid("e"), from, to, ghost: true, label: mockRationale(a, b) },
    ]);
  }, [nodes]);

  const expand = (id: string) => {
    const n = byId(id);
    if (!n) return;
    const kids = mockExpand(n);
    const newNodes: GNode[] = kids.map((k, i) => ({
      id: uid("g"), kind: "artifact", ghost: true,
      x: n.x + 260, y: n.y - 40 + i * 96, w: 200, h: 72, title: k, color: n.color,
    }));
    setNodes((ns) => [...ns, ...newNodes]);
    setEdges((es) => [...es, ...newNodes.map((k) => ({ id: uid("e"), from: id, to: k.id, ghost: true, label: "expands to" }))]);
    setSelected([]);
  };

  const query = (id: string) => {
    const n = byId(id);
    if (!n) return;
    const ans: GNode = { id: uid("g"), kind: "artifact", ghost: true, x: n.x + 260, y: n.y, w: 230, h: 90, title: mockAnswer(n), sub: "AI answer", color: "#475569" };
    setNodes((ns) => [...ns, ans]);
    setEdges((es) => [...es, { id: uid("e"), from: id, to: ans.id, ghost: true, label: "answers" }]);
    setSelected([]);
  };

  const synthesize = () => {
    if (selected.length < 2) return;
    const sel = selected.map(byId).filter(Boolean) as GNode[];
    const cx = sel.reduce((s, n) => s + center(n).x, 0) / sel.length;
    const cy = Math.min(...sel.map((n) => n.y)) - 120;
    const syn: GNode = { id: uid("g"), kind: "artifact", ghost: true, x: cx - 120, y: Math.max(40, cy), w: 240, h: 84, title: "Synthesis: a goal-aligned attention loop", sub: "AI-proposed chain", color: "#0891B2" };
    setNodes((ns) => [...ns, syn]);
    setEdges((es) => [...es, ...selected.map((s) => ({ id: uid("e"), from: syn.id, to: s, ghost: true, label: "synthesizes" }))]);
    setSelected([]);
  };

  // ── accept / reject ghosts ──
  const acceptNode = (id: string) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ghost: false } : n)));
    setEdges((es) => es.map((e) => (e.from === id || e.to === id ? { ...e, ghost: false } : e)));
  };
  const rejectNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
  };
  const acceptEdge = (id: string) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ghost: false } : e)));
  const rejectEdge = (id: string) => setEdges((es) => es.filter((e) => e.id !== id));

  // toolbar position = above the selection bounding box
  const selNodes = selected.map(byId).filter(Boolean) as GNode[];
  const bbox = selNodes.length
    ? {
        x: Math.min(...selNodes.map((n) => n.x)),
        y: Math.min(...selNodes.map((n) => n.y)),
        r: Math.max(...selNodes.map((n) => n.x + n.w)),
      }
    : null;

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}
      onPointerMove={onMove}
      onPointerUp={(e) => onUp(e, e.shiftKey)}
      onPointerDown={() => setSelected([])}
    >
      <AmbientBackdrop />
      <div className="absolute left-6 top-6 text-[11px] font-medium uppercase tracking-[0.2em]" style={{ color: "rgba(15,23,42,0.4)" }}>
        Whiteboard · select → act · drag one onto another to connect
      </div>

      {/* edges */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 5 }}>
        {edges.map((e) => {
          const a = byId(e.from), b = byId(e.to);
          if (!a || !b) return null;
          const p1 = center(a), p2 = center(b);
          return (
            <line
              key={e.id}
              x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={e.ghost ? "rgba(71,85,105,0.55)" : "rgba(15,23,42,0.35)"}
              strokeWidth={e.ghost ? 1.5 : 2}
              strokeDasharray={e.ghost ? "5 4" : undefined}
            />
          );
        })}
      </svg>

      {/* ghost-edge accept/reject chips at midpoints */}
      {edges.filter((e) => e.ghost).map((e) => {
        const a = byId(e.from), b = byId(e.to);
        if (!a || !b) return null;
        const mx = (center(a).x + center(b).x) / 2, my = (center(a).y + center(b).y) / 2;
        return (
          <div key={`chip-${e.id}`} className="absolute z-[15] flex items-center gap-1 rounded-full px-2 py-1" style={{ left: mx - 60, top: my - 14, background: "white", boxShadow: "0 6px 18px -8px rgba(15,23,42,0.25)", border: "1px solid rgba(71,85,105,0.25)" }}>
            <span className="text-[9.5px] font-medium" style={{ color: "#475569" }}>{e.label}</span>
            <button onClick={() => acceptEdge(e.id)} className="grid h-4 w-4 place-items-center rounded-full" style={{ background: "#16A34A", color: "white" }}><Check className="h-2.5 w-2.5" strokeWidth={3} /></button>
            <button onClick={() => rejectEdge(e.id)} className="grid h-4 w-4 place-items-center rounded-full" style={{ background: "rgba(15,23,42,0.06)", color: "rgba(15,23,42,0.5)" }}><X className="h-2.5 w-2.5" strokeWidth={2.5} /></button>
          </div>
        );
      })}

      {/* nodes */}
      {nodes.map((n) => {
        const isSel = selected.includes(n.id);
        return (
          <motion.div
            key={n.id}
            initial={n.ghost ? { opacity: 0, scale: 0.96 } : false}
            animate={{ opacity: n.ghost ? 0.92 : 1, scale: 1 }}
            transition={{ duration: 0.28, ease: EASE }}
            onPointerDown={(e) => onNodeDown(e, n)}
            className="absolute cursor-grab active:cursor-grabbing"
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, zIndex: 10, touchAction: "none" }}
          >
            <div
              className="relative flex h-full flex-col justify-center rounded-2xl px-3.5 py-2.5"
              style={{
                background: n.kind === "idea" ? n.color : "white",
                border: n.ghost ? `1.5px dashed ${n.color}` : isSel ? `2px solid ${n.color}` : "1px solid rgba(15,23,42,0.08)",
                boxShadow: n.ghost ? "none" : "0 1px 2px rgba(15,23,42,0.04), 0 10px 24px -14px rgba(15,23,42,0.18)",
              }}
            >
              {n.kind === "artifact" && (
                <span className="absolute left-3 top-2 h-1.5 w-1.5 rounded-full" style={{ background: n.color }} />
              )}
              <div className="text-[12.5px] font-semibold leading-snug" style={{ color: "rgba(15,23,42,0.92)", marginTop: n.kind === "artifact" ? 8 : 0 }}>
                {n.title}
              </div>
              {n.sub && <div className="mt-0.5 text-[10px]" style={{ color: "rgba(15,23,42,0.45)" }}>{n.sub}</div>}
              {n.ghost && (
                <div className="absolute -right-2 -top-2 flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); acceptNode(n.id); }} className="grid h-5 w-5 place-items-center rounded-full" style={{ background: "#16A34A", color: "white", boxShadow: "0 4px 10px -3px rgba(22,163,74,0.6)" }}><Check className="h-3 w-3" strokeWidth={3} /></button>
                  <button onClick={(e) => { e.stopPropagation(); rejectNode(n.id); }} className="grid h-5 w-5 place-items-center rounded-full" style={{ background: "white", color: "rgba(15,23,42,0.5)", boxShadow: "0 4px 10px -3px rgba(15,23,42,0.25)" }}><X className="h-3 w-3" strokeWidth={2.5} /></button>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}

      {/* contextual floating toolbar */}
      {bbox && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="absolute z-[30]"
          style={{ left: (bbox.x + bbox.r) / 2 - 130, top: bbox.y - 52, width: 260 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <FloatingCard tier="float" glow className="flex items-center justify-center gap-1 px-2 py-1.5">
            {selected.length === 1 && (
              <>
                <ToolBtn icon={Sparkles} label="Expand" onClick={() => expand(selected[0])} />
                <ToolBtn icon={Search} label="Query" onClick={() => query(selected[0])} />
                <ToolBtn icon={Maximize2} label="Open room" onClick={() => {}} muted />
              </>
            )}
            {selected.length === 2 && (
              <>
                <ToolBtn icon={GitMerge} label="Connect" onClick={() => proposeConnect(selected[0], selected[1])} />
                <ToolBtn icon={Plus} label="Compare" onClick={() => {}} muted />
              </>
            )}
            {selected.length >= 3 && (
              <ToolBtn icon={Sparkles} label="Synthesize" onClick={synthesize} />
            )}
          </FloatingCard>
        </motion.div>
      )}
    </div>
  );
}

function ToolBtn({ icon: Icon, label, onClick, muted }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: string; onClick: () => void; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[rgba(15,23,42,0.05)]"
      style={{ color: muted ? "rgba(15,23,42,0.4)" : "rgba(15,23,42,0.85)" }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </button>
  );
}

// ── mock AI ──
function mockRationale(a: GNode, b: GNode) {
  return "could regulate";
}
function mockExpand(n: GNode) {
  return ["Surface intent before search", "Nudge on passive drift", "Weekly intentionality score"];
}
function mockAnswer(n: GNode) {
  return "Strongest when paired with a goal-tracking signal.";
}
