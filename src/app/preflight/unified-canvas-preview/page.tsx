// Unified-canvas prototype (the corrected, full vision):
//   • interactive whiteboard = floor 0 (pearl substrate + draggable
//     sticky-note ideas you can move around)
//   • EVERY screen is a room-window floating on it — including the
//     objective itself (not a flat page)
//   • a left sidebar of circular room icons; ⌘↑/⌘↓ glides between rooms,
//     Esc drops to the bare whiteboard
//
// Verifiable on /preflight (no iframe, no auth). Once the feel is signed
// off, this composition wires into the real whiteboard + objective routes.
// SAFE TO DELETE.

"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Minimize2 } from "lucide-react";
import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";
import { useHotkey } from "@/lib/hooks/use-hotkey";

const EASE = [0.22, 1, 0.36, 1] as const;

type RoomKind = "objective" | "room" | "lab";
interface Room {
  id: string;
  label: string;
  short: string;
  kind: RoomKind;
  color: string;
}

const ROOMS: Room[] = [
  { id: "obj", label: "Strategy for {{companyName}}", short: "OBJ", kind: "objective", color: "#7C3AED" },
  { id: "r1", label: "Goal-Driven Knowledge Pathways", short: "GK", kind: "room", color: "#DC2626" },
  { id: "r2", label: "Distraction & Attention", short: "DA", kind: "room", color: "#2563EB" },
  { id: "r3", label: "Privacy & Trust", short: "PT", kind: "room", color: "#16A34A" },
  { id: "lab", label: "Contextual Content Filter", short: "LAB", kind: "lab", color: "#0891B2" },
];

// ── Floor 0: interactive whiteboard with draggable sticky ideas ──
interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}
const INITIAL_NOTES: Note[] = [
  { id: "n1", x: 80, y: 120, text: "What converts attention → income?", color: "#FEF3C7" },
  { id: "n2", x: 220, y: 560, text: "Proxy indicators for flow state", color: "#DBEAFE" },
  { id: "n3", x: 1180, y: 200, text: "Incentivize sharing search history", color: "#FCE7F3" },
  { id: "n4", x: 1320, y: 620, text: "Differentiate intentional vs passive", color: "#DCFCE7" },
];

function Whiteboard({ dimmed }: { dimmed: boolean }) {
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const onDown = (e: React.PointerEvent, n: Note) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: e.clientX - d.dx, y: e.clientY - d.dy } : n)));
  };
  const onUp = () => (drag.current = null);

  return (
    <div
      className="absolute inset-0 transition-[filter,opacity] duration-500"
      style={{ filter: dimmed ? "blur(2px)" : "none", opacity: dimmed ? 0.5 : 1 }}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <div
        className="absolute left-1/2 top-7 -translate-x-1/2 text-[11px] font-medium uppercase tracking-[0.2em]"
        style={{ color: "rgba(15,23,42,0.4)" }}
      >
        Whiteboard · floor 0 · drag the ideas
      </div>
      {notes.map((n) => (
        <div
          key={n.id}
          onPointerDown={(e) => onDown(e, n)}
          className="absolute w-[180px] cursor-grab rounded-2xl px-3.5 py-3 text-[12px] leading-snug shadow-sm active:cursor-grabbing"
          style={{ left: n.x, top: n.y, background: n.color, color: "rgba(15,23,42,0.8)", touchAction: "none" }}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}

// ── Circular room sidebar (⌘↑/⌘↓ to glide) ──
function Sidebar({
  activeIndex,
  onPick,
}: {
  activeIndex: number | null;
  onPick: (i: number | null) => void;
}) {
  return (
    <div className="fixed left-4 top-1/2 z-[120] -translate-y-1/2">
      <FloatingCard tier="float" glow className="px-2 py-3">
      <div className="flex flex-col items-center gap-2.5">
        {ROOMS.map((room, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onPick(active ? null : i)}
              title={room.label}
              className="relative flex items-center justify-center rounded-full transition-all duration-200 ease-out"
              style={{
                width: active ? 44 : 36,
                height: active ? 44 : 36,
                background: active ? room.color : `${room.color}1A`,
                color: active ? "white" : room.color,
                boxShadow: active ? `0 8px 20px -6px ${room.color}80` : "none",
                fontWeight: 700,
                fontSize: active ? 11 : 10,
                letterSpacing: "0.02em",
              }}
            >
              {room.short}
              {active && (
                <motion.span
                  layoutId="active-ring"
                  className="absolute inset-[-4px] rounded-full"
                  style={{ border: `1.5px solid ${room.color}` }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        className="mt-3 border-t pt-2 text-center text-[8.5px] font-medium uppercase tracking-[0.14em]"
        style={{ borderColor: "rgba(15,23,42,0.06)", color: "rgba(15,23,42,0.35)" }}
      >
        ⌘↑↓
      </div>
      </FloatingCard>
    </div>
  );
}

// ── A room rendered as the active window ──
function RoomWindow({ room, onCollapse }: { room: Room; onCollapse: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: room.color }} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: room.color }}>
            {room.kind === "objective" ? "Main objective" : room.kind === "lab" ? "Lab" : "Sub-objective room"}
          </span>
          <span className="text-[13px] font-medium" style={{ color: "rgba(15,23,42,0.92)" }}>{room.label}</span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse this room into a card on the whiteboard"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[rgba(15,23,42,0.05)]"
          style={{ color: "rgba(15,23,42,0.6)" }}
        >
          <Minimize2 className="h-3 w-3" strokeWidth={2} />
          Collapse to whiteboard
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {room.kind === "objective" ? (
          <p className="text-[14px] leading-relaxed" style={{ color: "rgba(15,23,42,0.8)", maxWidth: 680 }}>
            How does your digital activity correspond to knowledge, and how does that knowledge convert to
            money through a causal chain of indicators? Identify which goals yield the highest value, then
            surface the activities that provide the most direct utility — measuring digital attention
            distribution and how it correlates to income.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(room.kind === "lab"
              ? ["Contextual Relevance Filtering", "Goal-Based Prioritization", "Dynamic Context Awareness", "Feedback-Driven Filtering"]
              : ["Excessive Passive Browsing → Intentional Prompter", "Undefined objectives → Goal Tracker", "Irrelevant content → Relevance Filter"]
            ).map((t) => (
              <FloatingCard key={t} tier="card" className="px-4 py-3">
                <div className="text-[12.5px] font-semibold" style={{ color: "rgba(15,23,42,0.92)" }}>{t}</div>
                <div className="mt-1 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>
                  {room.kind === "lab" ? "Awaiting rubric score" : "80% composite"}
                </div>
              </FloatingCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── A room collapsed into a draggable card on the whiteboard ──
function MinimizedCard({
  room,
  x,
  y,
  onMove,
  onExpand,
}: {
  room: Room;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onExpand: () => void;
}) {
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - x, dy: e.clientY - y, moved: false };
  };
  const onMovePtr = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - x - d.dx) > 3 || Math.abs(e.clientY - y - d.dy) > 3) d.moved = true;
    onMove(e.clientX - d.dx, e.clientY - d.dy);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onExpand();
  };
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      onPointerDown={onDown}
      onPointerMove={onMovePtr}
      onPointerUp={onUp}
      className="absolute z-[60] w-[200px] cursor-grab active:cursor-grabbing"
      style={{ left: x, top: y, touchAction: "none" }}
      title="Drag to move · click to expand"
    >
      <FloatingCard tier="card" glow className="px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: room.color }} />
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: room.color }}>
            {room.kind === "objective" ? "Objective" : room.kind === "lab" ? "Lab" : "Room"}
          </span>
        </div>
        <div className="mt-1 text-[12.5px] font-semibold leading-snug" style={{ color: "rgba(15,23,42,0.92)" }}>
          {room.label}
        </div>
        <div className="mt-1 text-[10px]" style={{ color: "rgba(15,23,42,0.45)" }}>
          drag · click to expand
        </div>
      </FloatingCard>
    </motion.div>
  );
}

export default function Page() {
  // null = bare whiteboard; index = that room is the active window.
  const [active, setActive] = useState<number | null>(0);
  // Rooms collapsed onto the whiteboard as draggable cards.
  const [minimized, setMinimized] = useState<Array<{ index: number; x: number; y: number }>>([]);

  const glide = useCallback((dir: 1 | -1) => {
    setActive((cur) => Math.max(0, Math.min(ROOMS.length - 1, (cur ?? -1) + dir)));
  }, []);

  // Collapse the active room → it becomes a card on the whiteboard.
  const collapse = (i: number) => {
    setMinimized((m) =>
      m.some((c) => c.index === i) ? m : [...m, { index: i, x: 150 + m.length * 56, y: 210 + m.length * 56 }],
    );
    setActive(null);
  };
  // Expand a collapsed card back into the window.
  const expand = (i: number) => {
    setMinimized((m) => m.filter((c) => c.index !== i));
    setActive(i);
  };
  const moveMin = (i: number, x: number, y: number) =>
    setMinimized((m) => m.map((c) => (c.index === i ? { ...c, x, y } : c)));
  // Sidebar pick: null closes; otherwise expand (clears any minimized card).
  const pick = (i: number | null) => (i === null ? setActive(null) : expand(i));

  useHotkey("cmd+arrowdown", () => glide(1), { scope: "unified" });
  useHotkey("cmd+arrowup", () => glide(-1), { scope: "unified" });
  useHotkey("escape", () => setActive(null), { enabled: active !== null, scope: "unified" });

  const room = active !== null ? ROOMS[active] : null;

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}>
      <AmbientBackdrop />
      <Whiteboard dimmed={room !== null} />

      {/* Collapsed room cards living on the whiteboard. */}
      {minimized.map((c) => (
        <MinimizedCard
          key={c.index}
          room={ROOMS[c.index]}
          x={c.x}
          y={c.y}
          onMove={(x, y) => moveMin(c.index, x, y)}
          onExpand={() => expand(c.index)}
        />
      ))}

      {/* Scrim when a room is open — dims the whiteboard behind. No
          AnimatePresence (its exit hangs under React 19 here); fade-in on
          mount, instant removal on close is fine. */}
      {room && (
        <motion.div
          className="fixed inset-0 z-[100]"
          style={{ background: "rgba(15,23,42,0.18)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
          onClick={() => setActive(null)}
        />
      )}

      <Sidebar activeIndex={active} onPick={pick} />

      {/* The active room as a floating window over the whiteboard. Keyed
          by room id (no AnimatePresence) so a ⌘↑/↓ switch REMOUNTS it and
          replays the enter glide — reliable under React 19. */}
      <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center pl-20 pr-6">
        {room && (
          <motion.div
            key={room.id}
            className="pointer-events-auto w-full"
            style={{ maxWidth: 900, transformOrigin: "center" }}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            <FloatingCard tier="float" glow className="w-full overflow-hidden" style={{ background: "rgba(255,255,255,0.985)", height: "78vh" }}>
              <RoomWindow room={room} onCollapse={() => active !== null && collapse(active)} />
            </FloatingCard>
          </motion.div>
        )}
      </div>
    </div>
  );
}
