"use client";

// ── ObjectiveCanvasShell ──
//
// The unified surface: the objective canvas as a floating ROOM-WINDOW
// over the pearl whiteboard substrate, with a left circular room sidebar
// (Objective + sub-objectives) driven by ⌘↑/↓.
//
//   • activeIndex drives BOTH the sidebar highlight AND the window's
//     content: index 0 = Objective (the `children` passed in); index ≥1
//     = a sub-objective room, fetched client-side and mounted DIRECTLY
//     (SubObjectiveRoomView — no iframe, so no blank/nested-dev-runtime).
//   • ⌘↑/↓ glides between rooms in place; clicking a circle jumps to it.
//
// Room data comes from GET /api/objective/[spaceId]/sub/[subId]/room.
// Wraps the existing ObjectiveCanvasView untouched (as children).

import { Component, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2, ArrowUpRight, Check, Minimize2 } from "lucide-react";
import {
  WhiteboardBase,
  deployRoomCard,
  removeRoomCard,
  type DeployCardDetail,
} from "@/components/objective/whiteboard-base";
import { OPEN_ROOM_EVENT } from "@/components/objective/shapes/room-card-shape";
import { FloatingCard } from "@/components/ui/floating-card";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { SubObjectiveRoomView } from "@/components/objective/sub-objective-room-view";
import { SubObjectiveRoomHeader } from "@/components/objective/sub-objective-room-header";
import { AnnotatedSubObjectiveCard } from "@/components/objective/annotated-sub-objective-card";
import type { RoomData } from "@/lib/objective-canvas/load-room-data";

const EASE = [0.22, 1, 0.36, 1] as const;
const OBJ_COLOR = appleVibe.stage.objective;
const SUB_COLORS = [
  appleVibe.stage.pain,
  appleVibe.stage.features,
  appleVibe.stage.outcomes,
];

function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "··";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function ObjectiveCanvasShell({
  spaceId,
  subs,
  objectiveTitle,
  children,
}: {
  spaceId: string;
  subs: Array<{
    id: string;
    title: string;
    ready: boolean;
    /** Compact stat strings ("5 mechanisms", "3 chains") rendered as
     *  pills on the room's collapsed board card. */
    chips?: string[];
  }>;
  /** The objective's own text — used as the title on the collapsed
   *  objective card (falls back to "Objective" if absent). */
  objectiveTitle?: string;
  children: React.ReactNode;
}) {
  // rooms = [Objective, ...subs]; index 0 = Objective (children).
  const rooms = [
    { id: "__obj", title: "Objective", ready: true, chips: [] as string[] },
    ...subs,
  ];
  const [activeIndex, setActiveIndex] = useState(0);
  const clamped = Math.min(activeIndex, rooms.length - 1);
  const activeSub = clamped >= 1 ? subs[clamped - 1] : null;

  // Collapsed = the active room's window is hidden and the room lives as
  // a draggable card on the whiteboard base instead. Gliding (⌘↑/↓),
  // clicking a sidebar circle, or a card's Expand button all re-open the
  // window (collapsed → false).
  const [collapsed, setCollapsed] = useState(false);

  useHotkey("cmd+arrowdown", () => { setActiveIndex((i) => Math.min(rooms.length - 1, i + 1)); setCollapsed(false); }, { scope: "objective-shell" });
  useHotkey("cmd+arrowup", () => { setActiveIndex((i) => Math.max(0, i - 1)); setCollapsed(false); }, { scope: "objective-shell" });

  // ── window ⇄ card identity helpers ──
  // roomId is "__obj" for the objective, else the sub-objective id.
  function roomIdFor(index: number): string {
    return index === 0 ? "__obj" : rooms[index].id;
  }
  function cardDetailFor(index: number): DeployCardDetail {
    if (index === 0) {
      // Objective card — leads with the real objective text + a snapshot
      // of how many rooms exist and how many are generated.
      const readyCount = subs.filter((s) => s.ready).length;
      const chips = [
        `${subs.length} room${subs.length === 1 ? "" : "s"}`,
        ...(subs.length > 0 ? [`${readyCount} ready`] : []),
      ];
      return {
        roomId: "__obj",
        title: objectiveTitle?.trim() || "Objective",
        subtitle: "The full objective canvas, collapsed.",
        color: OBJ_COLOR,
        chips,
      };
    }
    // Sub-objective room card — lead with real content chips when the
    // room has them, else fall back to a ready/pending state pill.
    const room = rooms[index];
    return {
      roomId: room.id,
      title: room.title,
      subtitle: "Sub-objective room",
      color: SUB_COLORS[(index - 1) % SUB_COLORS.length],
      chips:
        room.chips && room.chips.length > 0
          ? room.chips
          : [room.ready ? "Ready" : "Not generated"],
    };
  }

  // Collapse the active room out of its window and onto the board.
  function collapseActiveRoom() {
    deployRoomCard(cardDetailFor(clamped));
    setCollapsed(true);
  }

  // Invariant: whenever a room window is showing (not collapsed), that
  // room must NOT also exist as a card on the board. This declaratively
  // clears the card on every path that re-opens a window (sidebar click,
  // ⌘ glide, OR a card's own Expand button — which already self-deletes,
  // so this is a harmless no-op there).
  useEffect(() => {
    if (!collapsed) removeRoomCard(roomIdFor(clamped));
    // roomIdFor closes over `rooms` (stable length); intentionally minimal deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, clamped]);

  // A room-card's Expand button fires OPEN_ROOM_EVENT — re-open that
  // room's window (and un-collapse).
  useEffect(() => {
    function onOpenRoom(e: Event) {
      const roomId = (e as CustomEvent<{ roomId: string }>).detail?.roomId;
      if (!roomId) return;
      const subIdx = subs.findIndex((s) => s.id === roomId);
      const idx = roomId === "__obj" ? 0 : subIdx >= 0 ? subIdx + 1 : -1;
      if (idx >= 0) {
        setActiveIndex(idx);
        setCollapsed(false);
      }
    }
    window.addEventListener(OPEN_ROOM_EVENT, onOpenRoom);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, onOpenRoom);
  }, [subs]);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden">
      {/* showUi only when collapsed — while a room window is open the
          board's toolbar/menus would otherwise peek around the window's
          margins and compete with the room. */}
      <WhiteboardBase spaceId={spaceId} showUi={collapsed} />

      {/* Circular room sidebar */}
      <div className="fixed left-4 top-1/2 z-[55] -translate-y-1/2">
        <FloatingCard tier="float" glow className="px-2 py-3">
          <div className="flex max-h-[70vh] flex-col items-center gap-2.5 overflow-y-auto">
            {rooms.map((room, i) => {
              const isObj = i === 0;
              const color = isObj ? OBJ_COLOR : SUB_COLORS[(i - 1) % SUB_COLORS.length];
              const active = i === clamped;
              return (
                <button
                  key={room.id}
                  type="button"
                  title={room.title}
                  onClick={() => { setActiveIndex(i); setCollapsed(false); }}
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
                  {/* Ready tick — bottom-right badge when the room has
                      been generated (has content to explore). */}
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
            style={{ borderColor: appleVibe.stroke.hairline, color: appleVibe.text.faint }}
          >
            ⌘↑↓
          </div>
        </FloatingCard>
      </div>

      {/* The active room as a floating window over the substrate.
          pt-16 clears the fixed HomeTabNav. Keyed by activeIndex so a
          switch replays the enter glide. Hidden when collapsed — the
          room then lives as a draggable card on the whiteboard behind. */}
      {!collapsed && (
      <div className="pointer-events-none fixed inset-0 z-50 flex justify-center overflow-hidden pb-5 pl-24 pr-5 pt-16">
        <motion.div
          key={clamped}
          className="pointer-events-auto relative w-full"
          style={{ maxWidth: 1480 }}
          initial={{ opacity: 0, y: 10, scale: 0.992 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.38, ease: EASE }}
        >
          {/* Collapse-to-board control — drops this room as a draggable
              card on the whiteboard base and hides the window. */}
          <button
            type="button"
            onClick={collapseActiveRoom}
            title="Collapse this room into a card on the whiteboard"
            aria-label="Collapse to whiteboard"
            className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-105"
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
            Collapse to board
          </button>
          <FloatingCard
            tier="float"
            glow
            className="h-full w-full overflow-y-auto"
            style={{ background: "rgba(255,255,255,0.985)" }}
          >
            {activeSub ? (
              <RoomErrorBoundary
                key={activeSub.id}
                spaceId={spaceId}
                subId={activeSub.id}
              >
                <RoomWindowContent spaceId={spaceId} subId={activeSub.id} />
              </RoomErrorBoundary>
            ) : (
              <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
            )}
          </FloatingCard>
        </motion.div>
      </div>
      )}
    </div>
  );
}

// ── In-place sub-objective room — fetched client-side, mounted direct ──
function RoomWindowContent({ spaceId, subId }: { spaceId: string; subId: string }) {
  const [data, setData] = useState<RoomData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setData(null);
    fetch(`/api/objective/${spaceId}/sub/${subId}/room`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: RoomData) => {
        if (!cancelled) {
          setData(d);
          setStatus("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, subId]);

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 py-24" style={{ color: appleVibe.text.tertiary }}>
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        <span className="text-[12.5px] font-medium">Loading room…</span>
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <RoomFallback
        spaceId={spaceId}
        subId={subId}
        label="Couldn't load this room here."
      />
    );
  }

  return (
    <div className="pb-10">
      <SubObjectiveRoomHeader
        spaceId={spaceId}
        title={data.title}
        titleAnnotations={data.titleAnnotations}
        topNegativeOutcome={data.topNegativeOutcome}
      />
      <div className="mx-auto w-full max-w-[1400px] px-8">
        {(data.description?.trim() || data.descriptionAnnotations.length > 0) && (
          <div className="mt-5 max-w-2xl">
            <AnnotatedSubObjectiveCard
              objectiveText={data.description ?? ""}
              annotations={data.descriptionAnnotations}
            />
          </div>
        )}
      </div>
      <div className="mx-auto mt-10 w-full max-w-[1400px] px-8">
        <SubObjectiveRoomView
          spaceId={spaceId}
          subObjectiveId={subId}
          lanes={data.lanes}
          edges={data.edges}
          generatedAt={data.generatedAt}
          pipelineMode={data.pipelineMode}
          roomCategoriesRaw={data.roomCategoriesRaw}
          annotations={data.annotations}
          crossRoomCoverageByIndex={data.crossRoomCoverageByIndex}
          constraints={data.constraints}
        />
      </div>
    </div>
  );
}

// Shared fallback for both fetch-failure and render-error states.
function RoomFallback({
  spaceId,
  subId,
  label,
}: {
  spaceId: string;
  subId: string;
  label: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
      <span className="text-[13px] font-medium" style={{ color: appleVibe.text.secondary }}>
        {label}
      </span>
      <Link
        href={`/app/objective/${spaceId}/sub/${subId}`}
        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium"
        style={{ background: appleVibe.accent.primary, color: appleVibe.text.onAccent }}
      >
        Open the full room page
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
      </Link>
    </div>
  );
}

// Class error boundary — a render error inside the (client-mounted) room
// falls back to the link instead of white-screening the objective canvas.
class RoomErrorBoundary extends Component<
  { spaceId: string; subId: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[ObjectiveCanvasShell] room render error:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <RoomFallback
          spaceId={this.props.spaceId}
          subId={this.props.subId}
          label="This room hit a snag rendering here."
        />
      );
    }
    return this.props.children;
  }
}
