// ── RoomCursorsLayer — live remote cursors over the canvas ──
//
// Renders one SVG pointer + identity pill per remote user whose cursor
// is currently being broadcast on the room presence channel.
//
// Coordinate model:
//   - The hook gives us WORLD coordinates (pre pan/zoom).
//   - We compute target VIEWPORT coords as `pan + world * zoom`.
//   - Each cursor lerps from its prior viewport position toward the
//     new target with a critically-damped feel (~0.28 lerp factor).
//     Result: smooth motion even when broadcasts arrive at 30Hz, and
//     the cursor visibly slides if either user pans the canvas.
//
// Per-user hue is derived from the existing FNV-1a `abstractAvatarFor`
// helper — same identity signature used for anonymous match cards, so
// the cursor color matches the avatar bubble in the header.
//
// pointer-events: none on every element so the cursor never blocks
// canvas interactions.

"use client";

import { useEffect, useRef, useState } from "react";
import { abstractAvatarFor } from "@/lib/synergy/abstract-avatar";
import type { RemoteCursor } from "@/hooks/synergy/use-room-presence";

interface Props {
  cursors: Map<string, RemoteCursor>;
  pan: { x: number; y: number };
  zoom: number;
  /** Optional human labels keyed by user_id. Falls back to "Anon". */
  userLabels?: Record<string, string | null>;
}

interface AnimatedCursor {
  userId: string;
  /** Current viewport-px position being animated. */
  vx: number;
  vy: number;
  /** Target viewport-px position derived from world coords + transform. */
  tx: number;
  ty: number;
  /** First frame? — snap instead of lerp so cursors don't fly in from origin. */
  fresh: boolean;
}

export function RoomCursorsLayer({ cursors, pan, zoom, userLabels }: Props) {
  const [animated, setAnimated] = useState<Map<string, AnimatedCursor>>(
    new Map(),
  );
  const rafRef = useRef<number | null>(null);

  // Re-derive targets whenever cursors or the viewport transform change.
  useEffect(() => {
    setAnimated((prev) => {
      const next = new Map<string, AnimatedCursor>();
      for (const [k, c] of cursors) {
        const tx = pan.x + c.x * zoom;
        const ty = pan.y + c.y * zoom;
        const existing = prev.get(k);
        if (existing) {
          next.set(k, { ...existing, tx, ty });
        } else {
          // New cursor — snap to target on first frame.
          next.set(k, { userId: k, vx: tx, vy: ty, tx, ty, fresh: true });
        }
      }
      return next;
    });
  }, [cursors, pan.x, pan.y, zoom]);

  // RAF animation loop — lerp each vx/vy toward tx/ty until close enough.
  useEffect(() => {
    if (animated.size === 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      let needMore = false;
      setAnimated((prev) => {
        const next = new Map(prev);
        for (const [k, c] of prev) {
          if (c.fresh) {
            next.set(k, { ...c, fresh: false });
            continue;
          }
          const dx = c.tx - c.vx;
          const dy = c.ty - c.vy;
          if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
            if (c.vx !== c.tx || c.vy !== c.ty) {
              next.set(k, { ...c, vx: c.tx, vy: c.ty });
            }
            continue;
          }
          next.set(k, { ...c, vx: c.vx + dx * 0.28, vy: c.vy + dy * 0.28 });
          needMore = true;
        }
        return next;
      });
      if (needMore) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [animated]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {[...animated.values()].map((c) => {
        const av = abstractAvatarFor(c.userId);
        const rawLabel = userLabels?.[c.userId];
        const label =
          rawLabel && rawLabel.trim().length > 0 ? rawLabel : "Anon";
        return (
          <RemoteCursorMark
            key={c.userId}
            x={c.vx}
            y={c.vy}
            hue={av.hue}
            label={label}
          />
        );
      })}
    </div>
  );
}

function RemoteCursorMark({
  x,
  y,
  hue,
  label,
}: {
  x: number;
  y: number;
  hue: number;
  label: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        // translate3d nudges this onto the GPU compositor → buttery on
        // every frame even with two or three remote cursors.
        transform: `translate3d(${x}px, ${y}px, 0)`,
        willChange: "transform",
      }}
    >
      {/* Cursor pointer — minimal Apple-style arrow, hued fill + white
          stroke for separation against any canvas background. */}
      <svg
        width="18"
        height="22"
        viewBox="0 0 18 22"
        fill="none"
        style={{
          filter: "drop-shadow(0 1px 2px rgba(15,23,42,0.18))",
          display: "block",
        }}
      >
        <path
          d="M 2 2 L 16 12 L 9 13 L 7 20 Z"
          fill={`hsl(${hue}, 70%, 52%)`}
          stroke="white"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      {/* Identity pill — single line, semibold, hued fill. Sits just
          below-right of the cursor tip so it doesn't obscure the
          pixel-precise position. */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 12,
          padding: "2px 7px",
          borderRadius: 999,
          background: `hsl(${hue}, 70%, 50%)`,
          color: "#fff",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
          boxShadow: "0 1px 2px rgba(15,23,42,0.18)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        }}
      >
        {label}
      </div>
    </div>
  );
}
