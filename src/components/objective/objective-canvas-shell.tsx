"use client";

// ── ObjectiveCanvasShell (layout-level) ──
//
// ONE persistent interactive whiteboard floor + a floating room-window,
// mounted once in [spaceId]/layout.tsx so EVERY route under the objective
// renders as an overlay over the SAME board:
//
//   • /app/objective/[id]            → the objective canvas (children)
//   • /app/objective/[id]/sub/[id]   → a sub-objective room (children)
//   • /app/objective/[id]/sub/[id]/lab/[id] → the lab (children)
//
// The active surface is always the route's `children`; the circular room
// sidebar reflects the URL and NAVIGATES (router.push) between rooms. Since
// Next.js does NOT remount a layout on child navigation, the tldraw board
// stays mounted and persistent as you move objective ↔ room ↔ lab — no
// flicker, no reset, collapsed cards + AI insights stay put.
//
// The shell self-loads its room list (GET …/board-subs) so it needs no
// props from the page — which is what makes the mount survive page.tsx
// rewrites (the durability fix) and makes every entry route consistent.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Minimize2, Network } from "lucide-react";
import {
  WhiteboardBase,
  deployRoomCard,
  removeRoomCard,
  type DeployCardDetail,
} from "@/components/objective/whiteboard-base";
import { OPEN_ROOM_EVENT } from "@/components/objective/shapes/room-card-shape";
import { openUnfurl } from "@/components/objective/board-bus";
import { anchorFromPath } from "@/components/objective/unfurl/anchor-from-path";
import { FloatingCard } from "@/components/ui/floating-card";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { appleVibe } from "@/lib/apple-vibe-tokens";

const EASE = [0.22, 1, 0.36, 1] as const;
const OBJ_COLOR = appleVibe.stage.objective;
const SUB_COLORS = [
  appleVibe.stage.pain,
  appleVibe.stage.features,
  appleVibe.stage.outcomes,
];

interface SubLite {
  id: string;
  title: string;
  ready: boolean;
}

function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function ObjectiveCanvasShell({
  spaceId,
  rightInset = 20,
  children,
}: {
  spaceId: string;
  /** Right padding for the room-window so it never slides under the
   *  layout's Lab Notebook rail. The layout passes the live rail width. */
  rightInset?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Self-load the room list + objective title (no props → the shell can
  // live at the layout level and survive page.tsx rewrites).
  const [subs, setSubs] = useState<SubLite[]>([]);
  const [objectiveTitle, setObjectiveTitle] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/objective/${spaceId}/board-subs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { objectiveTitle?: string; subs?: SubLite[] } | null) => {
        if (cancelled || !d) return;
        setSubs(Array.isArray(d.subs) ? d.subs : []);
        setObjectiveTitle(d.objectiveTitle ?? "");
      })
      .catch(() => {
        /* soft-fail — sidebar just shows the objective */
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // rooms = [Objective, ...subs]; active room derived from the URL.
  const rooms: SubLite[] = [
    { id: "__obj", title: "Objective", ready: true },
    ...subs,
  ];
  const subMatch = pathname?.match(/\/sub\/([^/]+)/);
  const activeSubId = subMatch ? subMatch[1] : null;
  const activeIndex = activeSubId
    ? Math.max(0, rooms.findIndex((r) => r.id === activeSubId))
    : 0;

  // collapsed = the window is hidden and the current room lives as a
  // draggable card on the board. Reset whenever the route changes so a new
  // room always opens as a window.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(false);
  }, [pathname]);

  function roomIdFor(index: number): string {
    return index === 0 ? "__obj" : rooms[index].id;
  }
  function routeFor(index: number): string {
    return index === 0
      ? `/app/objective/${spaceId}`
      : `/app/objective/${spaceId}/sub/${rooms[index].id}`;
  }
  function navTo(index: number) {
    setCollapsed(false);
    const target = routeFor(index);
    if (pathname !== target) router.push(target);
  }

  // ⌘↑/↓ glide between rooms (by route).
  useHotkey(
    "cmd+arrowdown",
    () => navTo(Math.min(rooms.length - 1, activeIndex + 1)),
    { scope: "objective-shell" },
  );
  useHotkey("cmd+arrowup", () => navTo(Math.max(0, activeIndex - 1)), {
    scope: "objective-shell",
  });

  function cardDetailFor(index: number): DeployCardDetail {
    if (index === 0) {
      const readyCount = subs.filter((s) => s.ready).length;
      return {
        roomId: "__obj",
        title: objectiveTitle.trim() || "Objective",
        subtitle: "The full objective canvas, collapsed.",
        color: OBJ_COLOR,
        chips: [
          `${subs.length} room${subs.length === 1 ? "" : "s"}`,
          ...(subs.length > 0 ? [`${readyCount} ready`] : []),
        ],
      };
    }
    const room = rooms[index];
    return {
      roomId: room.id,
      title: room.title,
      subtitle: "Sub-objective room",
      color: SUB_COLORS[(index - 1) % SUB_COLORS.length],
      chips: [room.ready ? "Ready" : "Not generated"],
    };
  }

  function collapseActiveRoom() {
    deployRoomCard(cardDetailFor(activeIndex));
    setCollapsed(true);
  }

  // Invariant: a room window showing ⇒ that room is NOT also a board card.
  useEffect(() => {
    if (!collapsed) removeRoomCard(roomIdFor(activeIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, activeIndex]);

  // A board card's Expand button fires OPEN_ROOM_EVENT → navigate to it.
  useEffect(() => {
    function onOpenRoom(e: Event) {
      const roomId = (e as CustomEvent<{ roomId: string }>).detail?.roomId;
      if (!roomId) return;
      const idx =
        roomId === "__obj" ? 0 : rooms.findIndex((r) => r.id === roomId);
      if (idx >= 0) navTo(idx);
    }
    window.addEventListener(OPEN_ROOM_EVENT, onOpenRoom);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, onOpenRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms.length, pathname]);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden">
      {/* Persistent whiteboard floor. showUi only when collapsed — while a
          room window is open the board chrome would peek around the margins
          and compete with the room. */}
      <WhiteboardBase spaceId={spaceId} showUi={collapsed} />

      {/* Circular room sidebar — reflects the URL, navigates by route. */}
      <div className="fixed left-4 top-1/2 z-[55] -translate-y-1/2">
        <FloatingCard tier="float" glow className="px-2 py-3">
          <div className="flex max-h-[70vh] flex-col items-center gap-2.5 overflow-y-auto">
            {rooms.map((room, i) => {
              const isObj = i === 0;
              const color = isObj
                ? OBJ_COLOR
                : SUB_COLORS[(i - 1) % SUB_COLORS.length];
              const active = i === activeIndex;
              return (
                <button
                  key={room.id}
                  type="button"
                  title={room.title}
                  onClick={() => navTo(i)}
                  className="relative flex flex-shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out"
                  style={{
                    width: active ? 44 : 36,
                    height: active ? 44 : 36,
                    background: active ? color : `${color}1A`,
                    color: active ? "white" : color,
                    boxShadow: active ? `0 8px 20px -6px ${color}80` : "none",
                    fontWeight: 700,
                    fontSize: isObj ? (active ? 10 : 9) : active ? 11 : 10,
                    letterSpacing: "0.02em",
                  }}
                >
                  {isObj ? "OBJ" : initialsOf(room.title)}
                  {!isObj && room.ready && (
                    <span
                      className="absolute grid place-items-center rounded-full"
                      style={{
                        bottom: -2,
                        right: -2,
                        width: 15,
                        height: 15,
                        background: appleVibe.stage.outcomes,
                        color: "white",
                        border: "2px solid white",
                      }}
                      aria-label="Room ready"
                      title="Ready — room has been generated"
                    >
                      <Check className="h-2 w-2" strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="mt-3 border-t pt-2 text-center text-[8.5px] font-medium uppercase tracking-[0.14em]"
            style={{
              borderColor: appleVibe.stroke.hairline,
              color: appleVibe.text.faint,
            }}
          >
            ⌘↑↓
          </div>
        </FloatingCard>
      </div>

      {/* The active route's content as a floating window over the board.
          pt-16 clears the fixed HomeTabNav. Keyed by pathname so each room
          replays the enter glide. Hidden when collapsed. */}
      {!collapsed && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex justify-center overflow-hidden pb-5 pl-24 pt-16 transition-[padding] duration-300 ease-out"
          style={{ paddingRight: rightInset }}
        >
          {/* Opacity-only crossfade (no transform): a transformed ancestor
              would make any position:fixed chrome inside the page
              (HomeTabNav / ModePill) anchor to this box instead of the
              viewport. Keying on pathname replays the fade per room. */}
          <motion.div
            key={pathname}
            className="pointer-events-auto relative w-full"
            style={{ maxWidth: 1480 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {/* Window actions — unfurl this surface onto the board, or
                collapse the room into a card. */}
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCollapsed(true);
                  openUnfurl(anchorFromPath(pathname ?? ""));
                }}
                title="Open on whiteboard — unfurl the chain up to here"
                aria-label="Open on whiteboard"
                className="inline-flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
                style={{
                  background: appleVibe.accent.primary,
                  border: `1px solid ${appleVibe.accent.primary}`,
                  color: appleVibe.text.onAccent,
                  padding: "7px 13px",
                  fontSize: 11.5,
                  fontWeight: 650,
                  letterSpacing: "0.01em",
                  boxShadow: "0 10px 26px -8px rgba(124,58,237,0.45)",
                  fontFamily: appleVibe.font.stack,
                }}
              >
                <Network className="h-3.5 w-3.5" strokeWidth={2.2} />
                Open on whiteboard
              </button>
              <button
                type="button"
                onClick={collapseActiveRoom}
                title="Collapse this room into a card on the whiteboard"
                aria-label="Collapse to whiteboard"
                className="inline-flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
                style={{
                  background: "rgba(255,255,255,0.92)",
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                  color: appleVibe.text.secondary,
                  padding: "7px 12px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  boxShadow: "0 8px 22px -8px rgba(11,18,40,0.22)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  fontFamily: appleVibe.font.stack,
                }}
              >
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                Collapse
              </button>
            </div>
            <FloatingCard
              tier="float"
              glow
              className="h-full w-full overflow-y-auto"
              style={{ background: "rgba(255,255,255,0.985)" }}
            >
              {children}
            </FloatingCard>
          </motion.div>
        </div>
      )}
    </div>
  );
}
