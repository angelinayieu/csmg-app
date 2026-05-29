// Motion prototype for the visionOS room-stack navigation (Phase 1,
// step 1). Mock data only — proves the "gliding through rooms" feel
// before wiring real routing/data. Public route. SAFE TO DELETE.

"use client";

import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";
import {
  RoomStackProvider,
  useRoomStack,
  type RoomDescriptor,
} from "@/components/rooms/room-stack-context";
import { RoomStackViewport } from "@/components/rooms/room-stack-viewport";

const LANE = {
  pain: "#DC2626",
  feature: "#2563EB",
  outcome: "#16A34A",
};

// The rooms that branch off the prompt card on the (mock) whiteboard.
const ROOMS: RoomDescriptor[] = [
  { id: "r1", kind: "room", title: "Goal-Driven Knowledge Pathways", subtitle: "Sub-objective room · 3 chains" },
  { id: "r2", kind: "room", title: "Distraction & Attention", subtitle: "Sub-objective room · 2 chains" },
  { id: "r3", kind: "room", title: "Privacy & Trust", subtitle: "Sub-objective room · 1 chain" },
];

function GroundFloor() {
  const { push } = useRoomStack();
  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-16">
      <div
        className="mb-8 text-[11px] font-medium uppercase tracking-[0.2em]"
        style={{ color: "rgba(15,23,42,0.45)" }}
      >
        Whiteboard · ground floor
      </div>

      {/* The prompt card — the origin of the branching rooms. */}
      <FloatingCard tier="card" className="mx-auto max-w-xl px-6 py-5">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: "rgba(15,23,42,0.45)" }}>
          Prompt
        </div>
        <div className="mt-1 text-[17px] font-semibold tracking-tight" style={{ color: "rgba(15,23,42,0.92)" }}>
          Strategy for a focused, goal-driven knowledge product
        </div>
        <div className="mt-1 text-[12px]" style={{ color: "rgba(15,23,42,0.55)" }}>
          3 sub-objective rooms branch from here.
        </div>
      </FloatingCard>

      {/* Branching room nodes — click to fly into a room. */}
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {ROOMS.map((room, i) => (
          <button
            key={room.id}
            type="button"
            onClick={() => push(room)}
            className="text-left transition-transform duration-150 ease-out hover:-translate-y-0.5"
          >
            <FloatingCard tier="card" className="h-full px-4 py-4">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: [LANE.pain, LANE.feature, LANE.outcome][i] }}
              />
              <div className="mt-2 text-[13.5px] font-semibold leading-snug" style={{ color: "rgba(15,23,42,0.92)" }}>
                {room.title}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: "rgba(15,23,42,0.5)" }}>
                {room.subtitle}
              </div>
              <div className="mt-3 text-[10.5px] font-medium" style={{ color: "#0A84FF" }}>
                Enter room →
              </div>
            </FloatingCard>
          </button>
        ))}
      </div>

      <p className="mt-10 text-center text-[11px]" style={{ color: "rgba(15,23,42,0.4)" }}>
        Click a room to fly in · then <kbd>⌘↓</kbd> deeper · <kbd>⌘↑</kbd>/<kbd>esc</kbd> back · <kbd>⌘←</kbd>/<kbd>⌘→</kbd> sibling rooms
      </p>
    </div>
  );
}

// Mock content for a pushed pane — a room (chains) or a lab (variations),
// with a live breadcrumb-as-stack + a "go deeper into Lab" affordance.
function RoomContent({ room, isTop }: { room: RoomDescriptor; isTop: boolean }) {
  const { stack, goToDepth, push } = useRoomStack();
  const isLab = room.kind === "lab";

  return (
    <div>
      {/* Breadcrumb-as-stack — each segment pops to that depth. */}
      <div className="border-b px-6 py-3" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>
          <button onClick={() => goToDepth(0)} className="hover:opacity-70" style={{ pointerEvents: isTop ? "auto" : "none" }}>
            Whiteboard
          </button>
          {stack.map((r, i) => (
            <span key={r.id} className="flex items-center gap-2">
              <span style={{ color: "rgba(15,23,42,0.28)" }}>›</span>
              <button
                onClick={() => goToDepth(i + 1)}
                className="hover:opacity-70"
                style={{
                  color: r.id === room.id ? "#0A84FF" : "rgba(15,23,42,0.45)",
                  fontWeight: r.id === room.id ? 600 : 400,
                  pointerEvents: isTop ? "auto" : "none",
                }}
              >
                {r.title.length > 22 ? r.title.slice(0, 22) + "…" : r.title}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: "rgba(15,23,42,0.45)" }}>
          {isLab ? "Lab · mechanism" : "Sub-objective room"}
        </div>
        <h2 className="mt-1 text-[24px] font-semibold tracking-tight" style={{ color: "rgba(15,23,42,0.92)", letterSpacing: "-0.02em" }}>
          {room.title}
        </h2>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(isLab
            ? ["Contextual Relevance Filtering", "Goal-Based Prioritization", "Dynamic Context Awareness", "Feedback-Driven Filtering"]
            : ["Excessive Passive Browsing → Intentional Prompter", "Undefined objectives → Goal Tracker", "Irrelevant content → Relevance Filter"]
          ).map((item) => (
            <FloatingCard key={item} tier="card" className="px-4 py-3">
              <div className="text-[12.5px] font-semibold" style={{ color: "rgba(15,23,42,0.92)" }}>{item}</div>
              <div className="mt-1 text-[11px]" style={{ color: "rgba(15,23,42,0.45)" }}>
                {isLab ? "Awaiting rubric score" : "80% composite"}
              </div>
            </FloatingCard>
          ))}
        </div>

        {/* Descend affordance — only rooms (not labs) can dive into a Lab. */}
        {!isLab && (
          <button
            type="button"
            onClick={() =>
              push({ id: `${room.id}-lab`, kind: "lab", title: "Contextual Content Filter", subtitle: "Lab" })
            }
            className="mt-6 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium"
            style={{ background: "rgba(15,23,42,0.92)", color: "white" }}
          >
            Open Lab ↓
          </button>
        )}
      </div>
    </div>
  );
}

// Mock chrome so the prototype matches the production layout exactly:
// a centered tab-nav pill (HomeTabNav lives at top-3) + a persistent
// notebook rail (420px card + 16px margins = 452px reserved on the
// right). The room panes must clear both.
const RAIL_WIDTH = 452;

function MockTabNav() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
      <div
        className="flex items-center gap-1 rounded-full p-1"
        style={{
          background: "rgba(255,255,255,0.72)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -10px rgba(11,18,40,0.18)",
          backdropFilter: "blur(18px)",
        }}
      >
        {["Objective Canvas", "Synergy", "Strategy Lab"].map((t, i) => (
          <span
            key={t}
            className="rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold"
            style={{
              background: i === 0 ? "rgba(15,23,42,0.92)" : "transparent",
              color: i === 0 ? "white" : "rgba(15,23,42,0.62)",
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function MockNotebookRail() {
  return (
    <div
      className="fixed z-[60]"
      style={{ top: 16, right: 16, bottom: 16, width: RAIL_WIDTH - 32 }}
    >
      <FloatingCard tier="float" className="h-full w-full px-4 py-4">
        <div
          className="text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{ color: "rgba(15,23,42,0.45)" }}
        >
          Lab Notebook
        </div>
        <div className="mt-2 text-[12px]" style={{ color: "rgba(15,23,42,0.5)" }}>
          Persistent rail — stays usable while you&rsquo;re inside a room.
        </div>
      </FloatingCard>
    </div>
  );
}

export default function Page() {
  return (
    <RoomStackProvider>
      <div
        className="min-h-screen"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}
      >
        <AmbientBackdrop />
        <MockTabNav />
        {/* Ground floor sits in the content area, clearing the rail. */}
        <div style={{ paddingRight: RAIL_WIDTH }}>
          <GroundFloor />
        </div>
        <MockNotebookRail />
        <RoomStackViewport
          siblingPool={ROOMS}
          topOffset={88}
          rightInset={RAIL_WIDTH}
          renderRoom={(room, isTop) => <RoomContent room={room} isTop={isTop} />}
        />
      </div>
    </RoomStackProvider>
  );
}
