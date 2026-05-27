"use client";

// ── Canvas Autopilot Runner ───────────────────────────────────────
//
// Phase 11.0a — runs autopilot across EVERY room in the space, not
// just one. One button, one progress chip, one notebook event header.
//
// Architecture mirrors the per-room AutopilotRunner (autopilot-runner.tsx)
// but iterates two levels: outer loop over rooms, inner loop over each
// room's mechanism entities. Each inner iteration calls the same
// /score + /refine endpoints the per-room runner uses, so the same
// per-chain score / rd_iterate events get logged to the notebook.
//
// On completion: fires /api/brainstorm/space/analysis/scan so cross-
// room findings refresh — the user can then ask the chat agent cross-
// room questions with fresh data immediately.
//
// User-curated by design (same as per-room): autopilot proposes, does
// NOT auto-elect. Every candidate still requires a click.
//
// Cancellable: checks a ref each iteration, stops cleanly after the
// in-flight feature finishes.

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Play, Sparkles, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

type Status = "idle" | "running" | "done" | "cancelled";

interface AutopilotTarget {
  subObjectiveId: string;
  subObjectiveTitle: string;
  featureIds: string[];
}

interface Props {
  spaceId: string;
  /** Bumps a refresh signal each time a room completes so the parent
   *  page can re-fetch + repaint room cards with new candidates. */
  onRoomComplete?: (subObjectiveId: string) => void;
  /** Called once when the whole canvas run finishes (or is cancelled).
   *  Useful for triggering a router.refresh() on the main canvas. */
  onAllComplete?: () => void;
}

const FEATURES = appleVibe.stage.features;

export function CanvasAutopilotRunner({
  spaceId,
  onRoomComplete,
  onAllComplete,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [targets, setTargets] = useState<AutopilotTarget[]>([]);
  const [roomIdx, setRoomIdx] = useState(0);
  const [featureIdx, setFeatureIdx] = useState(0);
  const [roomResults, setRoomResults] = useState<Map<string, "ok" | "error">>(
    new Map(),
  );
  const cancelRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCanvasAutopilot() {
    setOpen(false);
    cancelRef.current = false;
    setError(null);
    setRoomResults(new Map());
    setRoomIdx(0);
    setFeatureIdx(0);
    setStatus("running");

    // ── Step 1: fetch the work list + log the canvas autopilot_run header ──
    let workList: AutopilotTarget[];
    try {
      const startRes = await fetch(
        `/api/brainstorm/space/${spaceId}/autopilot/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const startJson = (await startRes.json().catch(() => ({}))) as {
        targets?: AutopilotTarget[];
        message?: string;
      };
      if (!startRes.ok) {
        setError(startJson.message ?? "Couldn't start autopilot.");
        setStatus("idle");
        return;
      }
      workList = startJson.targets ?? [];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setStatus("idle");
      return;
    }

    if (workList.length === 0) {
      setError("No rooms with mechanisms to run autopilot on yet.");
      setStatus("idle");
      return;
    }
    setTargets(workList);

    // ── Step 2: outer loop over rooms, inner loop over features ──
    for (let i = 0; i < workList.length; i++) {
      if (cancelRef.current) {
        setStatus("cancelled");
        onAllComplete?.();
        return;
      }
      setRoomIdx(i);
      const room = workList[i];
      let roomOk = true;
      for (let j = 0; j < room.featureIds.length; j++) {
        if (cancelRef.current) {
          setStatus("cancelled");
          onAllComplete?.();
          return;
        }
        setFeatureIdx(j);
        const entityId = room.featureIds[j];
        try {
          // Score is cache-aware — if the feature has an existing
          // envelope, it cheaply re-confirms. Refine ONLY fires if
          // score resolved an actual target (status=ok).
          const scoreRes = await fetch(
            "/api/brainstorm/item/variation/score",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ entityId }),
            },
          );
          const scoreJson = (await scoreRes.json().catch(() => ({}))) as {
            status?: string;
          };
          if (
            scoreRes.ok &&
            scoreJson.status === "ok" &&
            !cancelRef.current
          ) {
            await fetch("/api/brainstorm/item/variation/refine", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ entityId }),
            }).catch(() => undefined);
          }
        } catch {
          roomOk = false;
        }
      }
      setRoomResults((prev) => {
        const next = new Map(prev);
        next.set(room.subObjectiveId, roomOk ? "ok" : "error");
        return next;
      });
      onRoomComplete?.(room.subObjectiveId);
    }

    // ── Step 3: refresh cross-room findings so chat has fresh data ──
    // Soft-fail — if the scan errors out, the autopilot run itself
    // still counts as complete.
    try {
      await fetch("/api/brainstorm/space/analysis/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, mode: "force" }),
      });
    } catch {
      // Soft-fail — analysis refresh is a nice-to-have, not a blocker.
    }

    setStatus("done");
    onAllComplete?.();
  }

  function cancel() {
    cancelRef.current = true;
  }

  function reset() {
    setStatus("idle");
    setRoomResults(new Map());
    setRoomIdx(0);
    setFeatureIdx(0);
    setTargets([]);
    setError(null);
  }

  // ── IDLE — pill button + confirmation dropdown ──
  if (status === "idle") {
    return (
      <div className="relative">
        <motion.button
          type="button"
          onClick={() => setOpen((v) => !v)}
          whileHover={{ y: -1 }}
          whileTap={{ y: 0.5 }}
          className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out"
          style={{
            background: appleVibe.surface.card,
            color: appleVibe.text.primary,
            border: `1px solid ${appleVibe.stroke.medium}`,
            borderRadius: appleVibe.radius.pill,
            padding: "5px 12px",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.02em",
            boxShadow: appleVibe.shadow.chip,
            fontFamily: appleVibe.font.stack,
          }}
          title="Run experiments across every room in this canvas"
        >
          <Sparkles
            className="h-3 w-3"
            strokeWidth={2}
            style={{ color: FEATURES }}
          />
          Autopilot · all rooms
        </motion.button>
        {open && (
          <CanvasAutopilotDropdown
            spaceId={spaceId}
            onRun={runCanvasAutopilot}
            onClose={() => setOpen(false)}
          />
        )}
        {error && (
          <p
            className="absolute right-0 mt-2 max-w-[300px] text-[10.5px] font-light italic"
            style={{ color: "rgba(127,29,29,0.95)" }}
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  // ── RUNNING — progress chip showing room X of N · feature Y of M ──
  if (status === "running") {
    const room = targets[roomIdx];
    const totalFeatures = targets.reduce(
      (sum, t) => sum + t.featureIds.length,
      0,
    );
    const featuresDone =
      targets
        .slice(0, roomIdx)
        .reduce((sum, t) => sum + t.featureIds.length, 0) + featureIdx;
    const progressPct =
      totalFeatures > 0
        ? Math.round(((featuresDone + 1) / totalFeatures) * 100)
        : 0;
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
          Room {roomIdx + 1}/{targets.length}
        </span>
        <span
          className="font-light italic"
          style={{ color: appleVibe.text.tertiary }}
          title={room?.subObjectiveTitle ?? ""}
        >
          · {(room?.subObjectiveTitle ?? "").slice(0, 22)}
          {(room?.subObjectiveTitle ?? "").length > 22 ? "…" : ""}
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
          title="Cancel — stops cleanly after the current feature finishes"
          aria-label="Cancel canvas autopilot"
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

  // ── DONE / CANCELLED — summary chip ──
  const okRooms = Array.from(roomResults.values()).filter(
    (r) => r === "ok",
  ).length;
  const errorRooms = Array.from(roomResults.values()).filter(
    (r) => r === "error",
  ).length;
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
        padding: "4px 4px 4px 12px",
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
      <span>{status === "cancelled" ? "Cancelled" : "Canvas done"}</span>
      <span className="font-light" style={{ color: appleVibe.text.tertiary }}>
        · {okRooms} {okRooms === 1 ? "room" : "rooms"} refined
        {errorRooms > 0 ? ` · ${errorRooms} failed` : ""}
      </span>
      <button
        type="button"
        onClick={reset}
        className="ml-1 inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold transition-colors hover:bg-[rgba(15,23,42,0.06)]"
        style={{ color: appleVibe.text.tertiary }}
      >
        reset
      </button>
    </motion.div>
  );
}

// ── Confirmation dropdown ─────────────────────────────────────────

function CanvasAutopilotDropdown({
  spaceId,
  onRun,
  onClose,
}: {
  spaceId: string;
  onRun: () => void;
  onClose: () => void;
}) {
  // Estimated time displayed before user commits — same heuristic as
  // per-room runner (~30s per feature) but applied at the canvas
  // altitude. Caps display at "X min" for legibility.
  // We can't know totalFeatures without calling /start, so show a
  // rough "~3-10 min" placeholder. Refined once the run kicks off.

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="absolute right-0 z-40 mt-2 w-80"
        style={{
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: appleVibe.radius.md,
          boxShadow: appleVibe.shadow.card,
          fontFamily: appleVibe.font.stack,
        }}
      >
        <div className="px-3.5 py-3">
          <div className="flex items-center gap-1.5">
            <Sparkles
              className="h-3 w-3 flex-shrink-0"
              strokeWidth={2}
              style={{ color: appleVibe.stage.features }}
            />
            <span
              className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: appleVibe.text.secondary }}
            >
              Canvas Autopilot
            </span>
          </div>
          <h3
            className="mt-1 text-[13.5px] font-semibold leading-tight tracking-tight"
            style={{
              color: appleVibe.text.primary,
              letterSpacing: "-0.01em",
            }}
          >
            Run experiments across every room
          </h3>
          <p
            className="mt-1.5 text-[11.5px] leading-snug"
            style={{ color: appleVibe.text.secondary }}
          >
            Scores each mechanism + proposes 3 fresh IV candidates per
            chain across every room. After, refreshes cross-room
            findings so chat has fresh data. You still curate
            elections — autopilot proposes, never auto-elects.
          </p>
          <div
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
            style={{
              background: appleVibe.surface.chip,
              border: `1px solid ${appleVibe.stroke.hairline}`,
            }}
          >
            <span
              className="text-[10px] font-light italic"
              style={{ color: appleVibe.text.tertiary }}
            >
              estimated ~3-10 min
            </span>
          </div>
        </div>
        <div
          className="flex items-center justify-end gap-2 px-3.5 py-2"
          style={{ borderTop: `1px solid ${appleVibe.stroke.hairline}` }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-[10.5px] font-medium underline-offset-2 hover:underline"
            style={{ color: appleVibe.text.tertiary }}
          >
            cancel
          </button>
          <motion.button
            type="button"
            onClick={onRun}
            whileHover={{ y: -1 }}
            whileTap={{ y: 0.5 }}
            className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out"
            style={{
              background: appleVibe.accent.primary,
              color: appleVibe.text.onAccent,
              borderRadius: appleVibe.radius.pill,
              padding: "4px 12px",
              fontSize: "10.5px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              boxShadow: appleVibe.shadow.chip,
            }}
          >
            <Play className="h-2.5 w-2.5" strokeWidth={2.5} />
            Run
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
