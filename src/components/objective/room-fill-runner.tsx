"use client";

// ── Room Fill Runner ──────────────────────────────────────────────
//
// Fires right after the user APPROVES their sub-objectives (the picker
// → /confirm transition). Each approved sub-objective is a "room" shell
// with NO internal content yet. This runner generates that internal
// content — the 4-stage Pain → Outcomes → Features → Correlations pass
// (POST /api/brainstorm/room/generate, mode:"initial") — for every
// not-yet-generated room, in sequence.
//
// Why client-side: mirrors the existing CanvasAutopilotRunner pattern,
// and room/generate is one heavy LLM pass per room — running them from
// the client streams live progress and lets us open the Lab Notebook so
// the user watches each room's `room_generated` event land as it fills.
//
// Idempotent + safe: room/generate with mode:"initial" is a no-op on a
// room that already has content (the route returns early), and we only
// target rooms whose generatedAt is null — so a re-fire never clobbers
// existing work.
//
// Cancellable: checks a ref each iteration; stops cleanly after the
// in-flight room finishes.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// A hung room/generate (a stuck multi-stage LLM pass) used to freeze the
// whole fill loop — no AbortController, no timeout, so one stalled room
// blocked every remaining room. Wrap it: a stalled room aborts after the
// budget, the existing soft-fail skips it, and the rest continue.
const ROOM_FILL_TIMEOUT_MS = 180_000; // 3 min — room/generate is a 4-stage LLM pass; fatal only to truly-hung rooms.

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = ROOM_FILL_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Status = "idle" | "running" | "done" | "cancelled";

interface RoomFillTarget {
  id: string;
  title: string;
}

interface Props {
  spaceId: string;
  /** Not-yet-generated rooms to fill (the parent passes only subs whose
   *  generatedAt is null). */
  rooms: RoomFillTarget[];
  /** When true, the fill pass auto-starts once on mount — the post-
   *  approval path. The parent sets this ONLY on a fresh confirm so a
   *  later canvas visit doesn't re-trigger generation. */
  autoStart?: boolean;
  /** Bumps after each room finishes so the parent can repaint. */
  onRoomFilled?: (subObjectiveId: string) => void;
  /** Called once when the whole fill pass finishes (or is cancelled).
   *  Parent typically router.refresh()es so the filled rooms render. */
  onAllComplete?: () => void;
}

const FEATURES = appleVibe.stage.features;

export function RoomFillRunner({
  spaceId,
  rooms,
  autoStart = false,
  onRoomFilled,
  onAllComplete,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [roomIdx, setRoomIdx] = useState(0);
  const [filledCount, setFilledCount] = useState(0);
  const cancelRef = useRef(false);
  // Guard so the pass fires at most once per mount even if the effect
  // re-runs (StrictMode double-invoke, prop churn, or the rooms list
  // arriving a tick after autoStart). Without it a second pass could
  // start while the first is mid-flight.
  const startedRef = useRef(false);
  // Snapshot the targets once at fire time. The parent recomputes
  // `rooms` from server props, which empties as rooms fill — we don't
  // want the in-flight loop reading a shrinking array.
  const targetsRef = useRef<RoomFillTarget[]>([]);

  async function runFill() {
    if (startedRef.current) return;
    startedRef.current = true;
    cancelRef.current = false;
    targetsRef.current = rooms;
    setFilledCount(0);
    setRoomIdx(0);

    const targets = targetsRef.current;
    if (targets.length === 0) {
      setStatus("done");
      onAllComplete?.();
      return;
    }
    setStatus("running");

    // Open the Lab Notebook so the user watches each room's
    // `room_generated` event stream in as it fills (the live record).
    try {
      window.dispatchEvent(new CustomEvent("notebook:open"));
    } catch {
      // SSR / no-window — harmless; the notebook just won't auto-open.
    }

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) {
        setStatus("cancelled");
        onAllComplete?.();
        return;
      }
      setRoomIdx(i);
      const room = targets[i];
      try {
        // mode:"initial" → the route no-ops when the room already has
        // content, so this is safe even if generatedAt was stale.
        await fetchWithTimeout("/api/brainstorm/room/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            spaceId,
            subObjectiveId: room.id,
            mode: "initial",
          }),
        });
        setFilledCount((n) => n + 1);
        onRoomFilled?.(room.id);
      } catch {
        // Soft-fail — one room failing to generate doesn't kill the
        // whole pass; the notebook shows partial results and the user
        // can regenerate that room manually.
      }
    }

    setStatus(cancelRef.current ? "cancelled" : "done");
    onAllComplete?.();
  }

  // Auto-start once when the parent flags a fresh confirm AND there are
  // not-started rooms. Depends on rooms.length too, because the confirm
  // path does a router.refresh() — the new rooms can arrive a tick after
  // autoStart flips. startedRef keeps it single-fire.
  useEffect(() => {
    if (autoStart && rooms.length > 0 && !startedRef.current) {
      void runFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, rooms.length]);

  // Auto-dismiss the terminal chip so it doesn't linger after the
  // router.refresh() repaints the now-filled rooms.
  useEffect(() => {
    if (status !== "done" && status !== "cancelled") return;
    const t = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(t);
  }, [status]);

  function cancel() {
    cancelRef.current = true;
  }

  // Nothing in flight and nothing to do → render nothing (no dead chip).
  if (status === "idle") return null;

  const total = targetsRef.current.length || rooms.length;

  if (status === "running") {
    const room = targetsRef.current[roomIdx];
    const progressPct =
      total > 0 ? Math.round(((roomIdx + 1) / total) * 100) : 0;
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex items-center gap-2"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${FEATURES}40`,
          borderRadius: appleVibe.radius.pill,
          padding: "4px 4px 4px 12px",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.02em",
          boxShadow: appleVibe.shadow.chip,
          fontFamily: appleVibe.font.stack,
          color: appleVibe.text.primary,
        }}
      >
        <Loader2
          className="h-3 w-3 flex-shrink-0 animate-spin"
          style={{ color: FEATURES }}
          strokeWidth={2}
        />
        <span>
          Filling room {roomIdx + 1}/{total}
        </span>
        <span
          className="font-light italic"
          style={{ color: appleVibe.text.tertiary }}
          title={room?.title ?? ""}
        >
          · {(room?.title ?? "").slice(0, 22)}
          {(room?.title ?? "").length > 22 ? "…" : ""}
        </span>
        <div
          className="relative h-1 w-14 flex-shrink-0 overflow-hidden"
          style={{
            background: `${FEATURES}22`,
            borderRadius: appleVibe.radius.pill,
          }}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
            style={{
              width: `${progressPct}%`,
              background: FEATURES,
              borderRadius: appleVibe.radius.pill,
            }}
          />
        </div>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
          title="Cancel — stops after the current room finishes filling"
          aria-label="Cancel room fill"
        >
          <X
            className="h-3 w-3"
            strokeWidth={2}
            style={{ color: appleVibe.text.tertiary }}
          />
        </button>
      </motion.div>
    );
  }

  // DONE / CANCELLED — brief summary chip (auto-dismisses).
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="inline-flex items-center gap-2"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        borderRadius: appleVibe.radius.pill,
        padding: "4px 12px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        boxShadow: appleVibe.shadow.chip,
        fontFamily: appleVibe.font.stack,
        color: appleVibe.text.primary,
      }}
    >
      {status === "cancelled" ? (
        <X
          className="h-3 w-3 flex-shrink-0"
          style={{ color: appleVibe.text.tertiary }}
          strokeWidth={2.5}
        />
      ) : (
        <Check
          className="h-3 w-3 flex-shrink-0"
          style={{ color: appleVibe.stage.outcomes }}
          strokeWidth={2.5}
        />
      )}
      <Sparkle
        className="h-3 w-3 flex-shrink-0"
        style={{ color: FEATURES }}
        strokeWidth={2}
      />
      <span>
        {status === "cancelled" ? "Stopped" : "Rooms filled"}
      </span>
      <span className="font-light" style={{ color: appleVibe.text.tertiary }}>
        · {filledCount} {filledCount === 1 ? "room" : "rooms"}
      </span>
    </motion.div>
  );
}
