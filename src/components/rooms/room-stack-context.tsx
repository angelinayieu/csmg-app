"use client";

// ── RoomStack context ──
//
// Holds the stack of open rooms layered over the persistent ground floor
// (the whiteboard). depth 0 = on the ground floor (empty stack); each
// push adds a pane on top. This is the single source of truth the
// viewport + keyboard nav read from.
//
// Step 1 (motion prototype): in-memory state. Step 2 swaps the backing
// store to the URL (?stack=…) via the useDrawerState pattern WITHOUT
// changing this API — push/pop/goToDepth stay identical, so the viewport
// + all consumers are untouched by that migration.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface RoomDescriptor {
  /** Stable id — also the React key for its pane. */
  id: string;
  /** "room" | "lab" | … — drives which view the renderer mounts. */
  kind: string;
  title: string;
  subtitle?: string;
  /** Deep-link to the full route. Lets a pane offer "Open full room →"
   *  and keeps the URL meaningful / shareable. */
  href?: string;
  /** Lightweight summary rendered in the pane — sourced from data the
   *  opener already had in hand (NO extra fetch). */
  summary?: {
    counters?: string | null;
    description?: string | null;
    laneCounts?: { friction: number; mechanism: number; result: number };
    approvedPlays?: number;
  };
  /** Screen-space center + width of the whiteboard node this window
   *  expanded from. Drives the "magic-move": the window grows out of
   *  the node on open and compresses back into it on close. Captured
   *  via getBoundingClientRect at click time. Absent = no node origin
   *  (falls back to the plain fly-in). */
  originRect?: { cx: number; cy: number; width: number };
}

/** How long a popped pane stays mounted to play its fly-forward exit. */
export const ROOM_EXIT_MS = 360;

interface RoomStackApi {
  /** [] = ground floor. Last element is the focused top pane. */
  stack: RoomDescriptor[];
  /** Panes mid-exit — rendered as fly-forward ghosts for ROOM_EXIT_MS,
   *  then dropped. Lets the viewport animate exits deterministically
   *  WITHOUT depending on AnimatePresence's exit lifecycle (which is
   *  unreliable under React 19 + StrictMode in dev). */
  closing: RoomDescriptor[];
  /** stack.length — number of open panes. */
  depth: number;
  /** Push a pane on top (no-op if it's already the top). */
  push: (room: RoomDescriptor) => void;
  /** Pop the top pane (toward the ground floor). */
  pop: () => void;
  /** Truncate the stack to `d` panes (0 = back to ground floor). */
  goToDepth: (d: number) => void;
  /** Swap the focused top pane for another (lateral / sibling nav). */
  replaceTop: (room: RoomDescriptor) => void;
  /** Clear the whole stack. */
  reset: () => void;
}

const RoomStackContext = createContext<RoomStackApi | null>(null);

export function RoomStackProvider({
  children,
  initial = [],
}: {
  children: ReactNode;
  initial?: RoomDescriptor[];
}) {
  const [stack, setStack] = useState<RoomDescriptor[]>(initial);
  const [closing, setClosing] = useState<RoomDescriptor[]>([]);

  // Live mirror of stack so the imperative actions read current truth
  // without being re-created on every change.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Apply a new stack, sending any removed panes through the exit ghost
  // queue so they fly out before unmounting.
  const applyNext = useCallback((next: RoomDescriptor[]) => {
    const prev = stackRef.current;
    const removed = prev.filter((r) => !next.some((n) => n.id === r.id));
    if (removed.length > 0) {
      setClosing((c) => [
        ...c,
        ...removed.filter((r) => !c.some((x) => x.id === r.id)),
      ]);
      for (const r of removed) {
        const t = setTimeout(() => {
          setClosing((c) => c.filter((x) => x.id !== r.id));
          timers.current.delete(r.id);
        }, ROOM_EXIT_MS);
        timers.current.set(r.id, t);
      }
    }
    setStack(next);
  }, []);

  const push = useCallback((room: RoomDescriptor) => {
    const prev = stackRef.current;
    if (prev[prev.length - 1]?.id === room.id) return;
    // Re-entering a pane that's mid-exit: cancel its ghost.
    setClosing((c) => c.filter((x) => x.id !== room.id));
    const t = timers.current.get(room.id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(room.id);
    }
    setStack([...prev, room]);
  }, []);

  const pop = useCallback(
    () => applyNext(stackRef.current.slice(0, -1)),
    [applyNext],
  );

  const goToDepth = useCallback(
    (d: number) =>
      applyNext(
        stackRef.current.slice(0, Math.max(0, Math.min(d, stackRef.current.length))),
      ),
    [applyNext],
  );

  const replaceTop = useCallback((room: RoomDescriptor) => {
    const prev = stackRef.current;
    setStack(prev.length === 0 ? [room] : [...prev.slice(0, -1), room]);
  }, []);

  const reset = useCallback(() => applyNext([]), [applyNext]);

  // Clean up any pending exit timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo<RoomStackApi>(
    () => ({
      stack,
      closing,
      depth: stack.length,
      push,
      pop,
      goToDepth,
      replaceTop,
      reset,
    }),
    [stack, closing, push, pop, goToDepth, replaceTop, reset],
  );

  return (
    <RoomStackContext.Provider value={value}>
      {children}
    </RoomStackContext.Provider>
  );
}

export function useRoomStack(): RoomStackApi {
  const ctx = useContext(RoomStackContext);
  if (!ctx) {
    throw new Error("useRoomStack must be used within a RoomStackProvider");
  }
  return ctx;
}

/** Non-throwing variant — returns null when there's no RoomStackProvider
 *  above. Lets a component (e.g. a sub-objective card that's also used
 *  outside the canvas) opt into stack navigation when available and fall
 *  back to normal routing when not. */
export function useRoomStackOptional(): RoomStackApi | null {
  return useContext(RoomStackContext);
}
