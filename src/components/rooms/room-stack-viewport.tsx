"use client";

// ── RoomStackViewport ──
//
// Renders the open room stack as receding panes over the ground floor,
// plus the dim/blur scrim that signals "you're inside a room." Owns the
// keyboard spatial navigation:
//
//   cmd+↓  descend  — push the next room deeper (from siblingPool)
//   cmd+↑  ascend   — pop one pane toward the ground floor
//   esc    ascend   — same as cmd+↑
//   cmd+←  prev     — swap the top pane for the previous sibling
//   cmd+→  next     — swap the top pane for the next sibling
//
// All shortcuts are inert (enabled:false) on the ground floor.
//
// IMPORTANT: the AnimatePresence children are `motion.div`s DIRECTLY
// (not a custom wrapper component). framer-motion only orchestrates
// exit + unmount for motion elements that are its direct children — a
// custom-component child runs its exit animation but never unmounts.

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { useRoomStack, type RoomDescriptor } from "./room-stack-context";
import { layerTransform, layerFilter } from "./depth-transform";
import { FloatingCard } from "@/components/ui/floating-card";

const EASE = [0.22, 1, 0.36, 1] as const;

export function RoomStackViewport({
  renderRoom,
  siblingPool = [],
  topOffset = 88,
  rightInset = 0,
  bottomPad = 28,
  maxWidth = 1024,
  paneFill = false,
}: {
  /** Render a room's content given its descriptor + whether it's focused. */
  renderRoom: (room: RoomDescriptor, isTop: boolean) => ReactNode;
  /** Ordered pool used for cmd+↓ (descend) + cmd+←/→ (cycle siblings). */
  siblingPool?: RoomDescriptor[];
  /** px from the top — clears the fixed HomeTabNav (top-3 ~52px) + breathing.
   *  Matches the objective canvas's pt-24 rhythm. */
  topOffset?: number;
  /** px reserved on the right for the persistent notebook rail when open
   *  (420 + 2×16 margin = 452). Keeps panes centered in the CONTENT area,
   *  not the full viewport, and leaves the rail usable inside a room. */
  rightInset?: number;
  /** px of breathing room at the bottom so panes never kiss the edge. */
  bottomPad?: number;
  /** Max pane width — matches the canvas's max-w-5xl (1024px). */
  maxWidth?: number;
  /** Fill mode — pane becomes a fixed-height, overflow-hidden surface so
   *  a child that wants to fill it (e.g. an <iframe>) can flex to 100%
   *  height. Default false = scrollable content pane. */
  paneFill?: boolean;
}) {
  const { stack, closing, depth, pop, goToDepth, push, replaceTop } =
    useRoomStack();
  const reduce = useReducedMotion();
  const scrimVisible = depth > 0 || closing.length > 0;

  // Pane sizing: fill mode → fixed height + clip (child iframe flexes to
  // 100%); content mode → cap height + scroll inside.
  const paneSizeStyle = paneFill
    ? { height: `calc(100vh - ${topOffset + bottomPad}px)` }
    : { maxHeight: `calc(100vh - ${topOffset + bottomPad}px)` };
  const paneOverflowClass = paneFill ? "overflow-hidden" : "overflow-y-auto";
  // The pane + ghost share one positioning box (clears chrome + rail).
  const layerBoxStyle = {
    top: topOffset,
    left: 0,
    right: rightInset,
    bottom: bottomPad,
  } as const;

  // Magic-move: the transform that makes a window look like the
  // whiteboard node it expanded from — top-center aligned to the node,
  // scaled down to the node's width. Used as the OPEN `initial` (window
  // grows out of the node) and the COMPRESS target (window shrinks back
  // into it). Returns null when there's no node origin → plain fly-in.
  const magicFromNode = (rect: RoomDescriptor["originRect"]) => {
    if (!rect || typeof window === "undefined") return null;
    const paneWidth = Math.min(maxWidth, window.innerWidth - rightInset - 32);
    const paneCenterX = (window.innerWidth - rightInset) / 2;
    return {
      opacity: 0,
      x: rect.cx - paneCenterX,
      y: rect.cy - topOffset,
      scale: Math.max(0.12, rect.width / Math.max(1, paneWidth)),
    };
  };

  const topId = stack[stack.length - 1]?.id;
  const poolIndex = siblingPool.findIndex((r) => r.id === topId);

  // ── Keyboard spatial navigation ──
  // KeyboardEvent.key for arrows is "ArrowUp"/"ArrowDown"/… — the matcher
  // compares e.key.toLowerCase(), so combos must be "cmd+arrowup" etc.
  useHotkey("cmd+arrowup", () => pop(), { enabled: depth > 0, scope: "room-stack" });
  useHotkey("escape", () => pop(), { enabled: depth > 0, scope: "room-stack" });

  useHotkey(
    "cmd+arrowdown",
    () => {
      const next = siblingPool.find((r) => r.id !== topId) ?? siblingPool[0];
      if (next) push(next);
    },
    { enabled: siblingPool.length > 0, scope: "room-stack" },
  );

  useHotkey(
    "cmd+arrowleft",
    () => {
      if (poolIndex < 0 || siblingPool.length === 0) return;
      const prev =
        siblingPool[(poolIndex - 1 + siblingPool.length) % siblingPool.length];
      if (prev) replaceTop(prev);
    },
    { enabled: depth > 0 && siblingPool.length > 1, scope: "room-stack" },
  );

  useHotkey(
    "cmd+arrowright",
    () => {
      if (poolIndex < 0 || siblingPool.length === 0) return;
      const next = siblingPool[(poolIndex + 1) % siblingPool.length];
      if (next) replaceTop(next);
    },
    { enabled: depth > 0 && siblingPool.length > 1, scope: "room-stack" },
  );

  return (
    <>
      {/* Scrim — dims + blurs the ground floor when a room is open. Click
          to step back out one level. Stays mounted while panes are still
          flying out (closing), fading as depth returns to 0. */}
      {scrimVisible && (
        <motion.button
          type="button"
          aria-label="Step back out"
          className="fixed z-[90] cursor-default"
          // Covers from the very top down, but stops at the rail so the
          // notebook stays usable while you're inside a room.
          style={{
            top: 0,
            left: 0,
            right: rightInset,
            bottom: 0,
            background: "rgba(15,23,42,0.30)",
            backdropFilter: "blur(8px) saturate(0.9)",
            WebkitBackdropFilter: "blur(8px) saturate(0.9)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: depth > 0 ? 1 : 0 }}
          transition={{ duration: 0.32, ease: EASE }}
          onClick={() => goToDepth(depth - 1)}
        />
      )}

      {/* Layer stack — deterministic enter/exit (no AnimatePresence).
          Positioned within the content area (clears top chrome + rail) so
          panes sit centered + proportioned, never under the tab nav or the
          notebook. Live panes animate to their depth transform; closing
          ghosts fly forward + fade, dropped by the provider after exit. */}
      <div
        className="pointer-events-none fixed z-[100] overflow-hidden"
        style={layerBoxStyle}
      >
        {stack.map((room, i) => {
          const d = stack.length - 1 - i; // top pane → depth 0
          const isTop = d === 0;
          const t = layerTransform(d);
          return (
            <motion.div
              key={room.id}
              className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex w-full justify-center px-4"
              style={{
                zIndex: 100 - d,
                transformOrigin: "center top",
                maxWidth: maxWidth + 32,
              }}
              initial={
                reduce
                  ? { opacity: 0 }
                  : magicFromNode(room.originRect) ?? {
                      opacity: 0,
                      scale: 1.04,
                      y: 8,
                      filter: "blur(0px) brightness(1)",
                    }
              }
              animate={
                reduce
                  ? { opacity: t.opacity }
                  : { opacity: t.opacity, scale: t.scale, x: 0, y: t.y, filter: layerFilter(t) }
              }
              transition={{ duration: 0.44, ease: EASE }}
              aria-hidden={!isTop}
            >
              <div
                className="relative w-full"
                style={{ pointerEvents: isTop ? "auto" : "none" }}
              >
                <FloatingCard
                  tier="float"
                  glow
                  className={`w-full ${paneOverflowClass}`}
                  // Near-opaque so the pane reads as a crisp room even if
                  // backdrop-filter is unsupported; the scrim supplies the
                  // dimmed "you left the whiteboard" depth behind it.
                  style={{
                    background: "rgba(255,255,255,0.985)",
                    ...paneSizeStyle,
                  }}
                >
                  {renderRoom(room, isTop)}
                </FloatingCard>

                {/* Peek-to-pop: click a receding pane to return to it. */}
                {!isTop && (
                  <button
                    type="button"
                    onClick={() => goToDepth(i + 1)}
                    aria-label="Return to this room"
                    className="absolute inset-0 cursor-pointer rounded-[24px]"
                    style={{ pointerEvents: "auto" }}
                  />
                )}
              </div>
            </motion.div>
          );
        })}

        {/* Closing ghosts — the just-popped panes, flying toward the
            viewer + fading. Rendered above the live stack. */}
        {closing.map((room) => (
          <motion.div
            key={`closing-${room.id}`}
            className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex w-full justify-center px-4"
            style={{
              zIndex: 200,
              transformOrigin: "center top",
              maxWidth: maxWidth + 32,
            }}
            initial={
              reduce
                ? { opacity: 1 }
                : { opacity: 1, scale: 1, x: 0, y: 0, filter: "blur(0px) brightness(1)" }
            }
            animate={
              reduce
                ? { opacity: 0 }
                : magicFromNode(room.originRect) ?? { opacity: 0, scale: 1.04, y: 8 }
            }
            transition={{ duration: 0.4, ease: EASE }}
            aria-hidden
          >
            <FloatingCard
              tier="float"
              glow
              className={`w-full ${paneOverflowClass}`}
              style={{
                background: "rgba(255,255,255,0.985)",
                ...paneSizeStyle,
              }}
            >
              {renderRoom(room, false)}
            </FloatingCard>
          </motion.div>
        ))}
      </div>
    </>
  );
}
