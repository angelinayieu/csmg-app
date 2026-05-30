// Verifies the REAL evolved CanvasWorkspaceRoomFullscreen (the VR window
// stack) by mounting it + dispatching the actual canvas-workspace:open-
// fullscreen event from mock whiteboard nodes. The window iframes a real
// public route to prove the "window IS the route" decoupling. The shell
// under test is production code; only the nodes + iframe target are mock.
// SAFE TO DELETE.

"use client";

import { useRef } from "react";
import { AmbientBackdrop } from "@/components/layout/ambient-backdrop";
import { FloatingCard } from "@/components/ui/floating-card";
import { CanvasWorkspaceRoomFullscreen } from "@/components/canvas/chrome/canvas-workspace-room-fullscreen";

const NODES = [
  { id: "obj", kind: "objective", title: "Strategy for {{companyName}}", subtitle: "Main objective", color: "#475569", left: "12%", top: "20%", href: "/preflight/mock-room" },
  { id: "r1", kind: "room", title: "Goal-Driven Knowledge Pathways", subtitle: "Sub-objective room", color: "#DC2626", left: "44%", top: "34%", href: "/preflight/mock-room" },
  { id: "r2", kind: "lab", title: "Contextual Content Filter", subtitle: "Lab", color: "#2563EB", left: "24%", top: "58%", href: "/preflight/mock-room" },
];

function dispatchOpen(node: (typeof NODES)[number], el: HTMLElement | null) {
  const r = el?.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent("canvas-workspace:open-fullscreen", {
      detail: {
        kind: node.kind,
        artifactId: node.id,
        title: node.title,
        href: node.href,
        originRect: r
          ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width }
          : undefined,
      },
    }),
  );
}

function NodeButton({ node }: { node: (typeof NODES)[number] }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => dispatchOpen(node, ref.current)}
      className="absolute text-left transition-transform duration-200 ease-out hover:-translate-y-0.5"
      style={{ left: node.left, top: node.top, width: 236 }}
    >
      <FloatingCard tier="card" className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: node.color }} />
          <span className="text-[9.5px] font-medium uppercase tracking-[0.14em]" style={{ color: "rgba(15,23,42,0.4)" }}>
            {node.kind}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] font-semibold leading-snug" style={{ color: "rgba(15,23,42,0.92)" }}>
          {node.title}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "rgba(15,23,42,0.5)" }}>
          {node.subtitle} · click to open as window
        </div>
      </FloatingCard>
    </button>
  );
}

export default function Page() {
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif' }}
    >
      <AmbientBackdrop />
      <div className="absolute left-6 top-6 text-[11px] font-medium uppercase tracking-[0.2em]" style={{ color: "rgba(15,23,42,0.4)" }}>
        Whiteboard · floor 0 — real CanvasWorkspaceRoomFullscreen under test
      </div>
      {NODES.map((n) => (
        <NodeButton key={n.id} node={n} />
      ))}
      {/* The production window shell. It listens for the open event,
          magic-moves a window out of the node, and iframes the route. */}
      <CanvasWorkspaceRoomFullscreen />
    </div>
  );
}
