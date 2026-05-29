// Corrected prototype (Phase 1, v2): the whiteboard is floor 0; nodes
// on it EXPAND into spatial windows and COMPRESS back into the node
// (magic-move) — and the window is the room, not a summary. In the live
// app the window renders the real route via the fullscreen-portal/iframe
// pattern; here the content is mocked (real routes are auth-gated).
// SAFE TO DELETE.

"use client";

import { useRef } from "react";
import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";
import {
  RoomStackProvider,
  useRoomStack,
  type RoomDescriptor,
} from "@/components/rooms/room-stack-context";
import { RoomStackViewport } from "@/components/rooms/room-stack-viewport";

const LANE = { pain: "#DC2626", feature: "#2563EB", outcome: "#16A34A" };

// Whiteboard nodes (the "compressed" form of each room), scattered on
// the canvas like tldraw shapes.
const NODES: Array<{
  id: string;
  title: string;
  subtitle: string;
  color: string;
  left: string;
  top: string;
}> = [
  { id: "obj", title: "Strategy for {{companyName}}", subtitle: "Main objective · 3 rooms", color: "#7C3AED", left: "12%", top: "16%" },
  { id: "r1", title: "Goal-Driven Knowledge Pathways", subtitle: "Sub-objective · 3 chains", color: LANE.pain, left: "46%", top: "30%" },
  { id: "r2", title: "Distraction & Attention", subtitle: "Sub-objective · 2 chains", color: LANE.feature, left: "20%", top: "55%" },
  { id: "r3", title: "Privacy & Trust", subtitle: "Sub-objective · 1 chain", color: LANE.outcome, left: "62%", top: "62%" },
];

const ROOMS: RoomDescriptor[] = NODES.filter((n) => n.id !== "obj").map((n) => ({
  id: n.id,
  kind: "room",
  title: n.title,
}));

// Capture a node's screen-space center + width so the window can grow
// out of / shrink back into exactly that node.
function rectOf(el: HTMLElement | null) {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width };
}

function Whiteboard() {
  const { push, stack, closing } = useRoomStack();
  const openIds = new Set([...stack, ...closing].map((r) => r.id));

  return (
    <div className="absolute inset-0">
      <div
        className="absolute left-6 top-20 text-[11px] font-medium uppercase tracking-[0.2em]"
        style={{ color: "rgba(15,23,42,0.4)" }}
      >
        Whiteboard · floor 0
      </div>
      {NODES.map((n) => (
        <WhiteboardNode
          key={n.id}
          node={n}
          dimmed={openIds.has(n.id)}
          onOpen={(rect) =>
            push({
              id: n.id,
              kind: n.id === "obj" ? "objective" : "room",
              title: n.title,
              subtitle: n.subtitle,
              originRect: rect,
            })
          }
        />
      ))}
      <div
        className="absolute inset-x-0 bottom-8 text-center text-[11px]"
        style={{ color: "rgba(15,23,42,0.4)" }}
      >
        Click a node to expand it into a room · <kbd>⌘↓</kbd> deeper · <kbd>⌘↑</kbd>/<kbd>esc</kbd> compress · <kbd>⌘←/→</kbd> siblings
      </div>
    </div>
  );
}

function WhiteboardNode({
  node,
  dimmed,
  onOpen,
}: {
  node: (typeof NODES)[number];
  dimmed: boolean;
  onOpen: (rect: ReturnType<typeof rectOf>) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(rectOf(ref.current))}
      className="absolute text-left transition-all duration-200 ease-out hover:-translate-y-0.5"
      style={{ left: node.left, top: node.top, width: 232, opacity: dimmed ? 0.35 : 1 }}
    >
      <FloatingCard tier="card" className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: node.color }} />
          <span className="text-[9.5px] font-medium uppercase tracking-[0.14em]" style={{ color: "rgba(15,23,42,0.4)" }}>
            {node.id === "obj" ? "Objective" : "Room"}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] font-semibold leading-snug" style={{ color: "rgba(15,23,42,0.92)" }}>
          {node.title}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "rgba(15,23,42,0.5)" }}>
          {node.subtitle}
        </div>
      </FloatingCard>
    </button>
  );
}

// Mock window content — stands in for the real route the live app will
// iframe in. Carries the breadcrumb-as-stack + a compress control + a
// drill-deeper affordance.
function WindowContent({ room, isTop }: { room: RoomDescriptor; isTop: boolean }) {
  const { stack, goToDepth, push, pop } = useRoomStack();
  const labBtn = useRef<HTMLButtonElement>(null);
  const isLab = room.kind === "lab";
  const ix = { pointerEvents: isTop ? "auto" : "none" } as const;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <button onClick={() => goToDepth(0)} className="hover:opacity-70" style={{ color: "rgba(15,23,42,0.45)", ...ix }}>
            Whiteboard
          </button>
          {stack.map((r, i) => (
            <span key={r.id} className="flex min-w-0 items-center gap-2">
              <span style={{ color: "rgba(15,23,42,0.28)" }}>›</span>
              <button
                onClick={() => goToDepth(i + 1)}
                className="truncate hover:opacity-70"
                style={{ color: r.id === room.id ? "#0A84FF" : "rgba(15,23,42,0.45)", fontWeight: r.id === room.id ? 600 : 400, maxWidth: 220, ...ix }}
              >
                {r.title}
              </button>
            </span>
          ))}
        </div>
        <button onClick={() => pop()} aria-label="Compress" className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] hover:bg-[rgba(15,23,42,0.05)]" style={{ color: "rgba(15,23,42,0.45)", ...ix }}>
          Compress ↧
        </button>
      </div>

      <div className="px-6 py-6">
        <div className="text-[9.5px] font-medium uppercase tracking-[0.18em]" style={{ color: "rgba(15,23,42,0.4)" }}>
          {isLab ? "Lab · mechanism" : room.kind === "objective" ? "Main objective" : "Sub-objective room"}
        </div>
        <h2 className="mt-1 text-[23px] font-semibold tracking-tight" style={{ color: "rgba(15,23,42,0.92)", letterSpacing: "-0.02em" }}>
          {room.title}
        </h2>
        <p className="mt-1.5 text-[12px]" style={{ color: "rgba(15,23,42,0.5)" }}>
          In the live app this window renders the real route ({isLab ? "/lab/[entityId]" : room.kind === "objective" ? "/app/objective/[spaceId]" : "/sub/[subId]"}) via the fullscreen-portal pattern.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(isLab
            ? ["Contextual Relevance Filtering", "Goal-Based Prioritization", "Dynamic Context Awareness", "Feedback-Driven Filtering"]
            : ["Excessive Passive Browsing → Intentional Prompter", "Undefined objectives → Goal Tracker", "Irrelevant content → Relevance Filter"]
          ).map((item) => (
            <FloatingCard key={item} tier="card" className="px-4 py-3">
              <div className="text-[12.5px] font-semibold" style={{ color: "rgba(15,23,42,0.92)" }}>{item}</div>
              <div className="mt-1 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>{isLab ? "Awaiting rubric score" : "80% composite"}</div>
            </FloatingCard>
          ))}
        </div>

        {!isLab && (
          <button
            ref={labBtn}
            type="button"
            onClick={() => {
              const r = labBtn.current?.getBoundingClientRect();
              push({
                id: `${room.id}-lab`,
                kind: "lab",
                title: "Contextual Content Filter",
                originRect: r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width } : undefined,
              });
            }}
            className="mt-6 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium"
            style={{ background: "rgba(15,23,42,0.92)", color: "white", ...ix }}
          >
            Open Lab ↓
          </button>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RoomStackProvider>
      <div className="relative min-h-screen overflow-hidden" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}>
        <AmbientBackdrop />
        <Whiteboard />
        <RoomStackViewport
          siblingPool={ROOMS}
          topOffset={88}
          renderRoom={(room, isTop) => <WindowContent room={room} isTop={isTop} />}
        />
      </div>
    </RoomStackProvider>
  );
}
