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
import { Check, Loader2, Orbit, Play, X } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

// A hung stage fetch (a slow/stuck LLM call) used to freeze the ENTIRE
// sequential autopilot run indefinitely — no AbortController, no timeout,
// so one stalled request blocked every remaining room forever. Wrap every
// stage call: a request that exceeds the budget aborts, the existing
// per-stage catch marks the room errored, and the loop CONTINUES instead
// of hanging. Bounds total run time + makes "it just stopped" recoverable.
const STAGE_TIMEOUT_MS = 120_000; // 2 min — generous for slow LLM stages, fatal only to truly-hung calls.

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = STAGE_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Status =
  | "idle"
  | "running"
  | "enriching"
  | "speccing"
  | "done"
  | "cancelled";

interface AutopilotTarget {
  subObjectiveId: string;
  subObjectiveTitle: string;
  featureIds: string[];
}

interface RoomOption {
  id: string;
  title: string;
}

interface Props {
  spaceId: string;
  /** The generated rooms the user can choose to run autopilot on.
   *  When provided, the confirmation dropdown shows a checklist so the
   *  user can target a subset; the selected ids are passed to /start.
   *  When omitted/empty, the run covers every generated room (the
   *  route's default). */
  rooms?: RoomOption[];
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
  rooms,
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
  // Inverted selection — track the rooms the user has UNCHECKED. Empty
  // set ⇒ every room selected (the default). Tracking the negation
  // keeps newly-generated rooms selected by default without a sync
  // effect: a room is selected iff it's not in this set.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const roomOptions = rooms ?? [];
  const selectedIds = roomOptions
    .filter((r) => !deselected.has(r.id))
    .map((r) => r.id);
  const isSubset =
    roomOptions.length > 0 && selectedIds.length < roomOptions.length;

  async function runCanvasAutopilot(withSpecs: boolean) {
    setOpen(false);
    cancelRef.current = false;
    setError(null);
    setRoomResults(new Map());
    setRoomIdx(0);
    setFeatureIdx(0);
    setStatus("running");

    // Surface the live run in the Lab Notebook — the layout listens for
    // this and opens the rail so the user watches each room's events
    // stream in as they're generated (the "see it as it happens" path).
    try {
      window.dispatchEvent(new CustomEvent("notebook:open"));
    } catch {
      // SSR / no-window — harmless; the notebook just won't auto-open.
    }

    // ── Step 1: fetch the work list + log the canvas autopilot_run header ──
    let workList: AutopilotTarget[];
    try {
      const startRes = await fetchWithTimeout(
        `/api/brainstorm/space/${spaceId}/autopilot/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Only send the filter when it's a strict subset — omitting
          // it preserves the route's "all generated rooms" default.
          body: JSON.stringify(
            isSubset ? { subObjectiveIds: selectedIds } : {},
          ),
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
          const scoreRes = await fetchWithTimeout(
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
            await fetchWithTimeout("/api/brainstorm/item/variation/refine", {
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

    // ── Step 2: enrich every chain in every room (Phase 11.4) ──
    // After scoring + refining, run the enrichment pass per room.
    // This turns shallow (Pain × Feature × Outcome) labels into
    // sophisticated narratives + closes orphan gaps via complementary
    // chain proposals. Per lock-in M3+M4, this is the "make chains
    // actually causal" step the user explicitly asked for.
    setStatus("enriching");
    for (let i = 0; i < workList.length; i++) {
      if (cancelRef.current) {
        setStatus("cancelled");
        onAllComplete?.();
        return;
      }
      setRoomIdx(i);
      const room = workList[i];
      try {
        await fetchWithTimeout(
          `/api/brainstorm/room/${room.subObjectiveId}/enrich-chains`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        );
      } catch {
        // Soft-fail — one room's enrichment failing doesn't kill the
        // whole canvas run. The notebook will show partial results.
      }
    }

    // ── Step 2.5 (opt-in): pre-generate v2 mechanism specs ──
    // When the user opted in, generate the engineering-grade technical
    // spec for every feature across every room so the full operation
    // (mechanism of action → active ingredients → runtime flow → ADR →
    // validation, with the quality gate) is visible without manual
    // clicking — the "see the operations from the start" path. Skipped
    // by default because each spec is a heavy LLM call (15-field +
    // possible one regeneration). Soft-fail per feature.
    if (withSpecs) {
      setStatus("speccing");
      for (let i = 0; i < workList.length; i++) {
        if (cancelRef.current) {
          setStatus("cancelled");
          onAllComplete?.();
          return;
        }
        setRoomIdx(i);
        const room = workList[i];
        for (let j = 0; j < room.featureIds.length; j++) {
          if (cancelRef.current) {
            setStatus("cancelled");
            onAllComplete?.();
            return;
          }
          setFeatureIdx(j);
          try {
            await fetchWithTimeout(
              `/api/brainstorm/item/${room.featureIds[j]}/mechanism-spec`,
              { method: "POST" },
            );
          } catch {
            // Soft-fail — one feature's spec failing doesn't kill the run.
          }
        }
      }
    }

    // ── Step 3: refresh cross-room findings so chat has fresh data ──
    // Soft-fail — if the scan errors out, the autopilot run itself
    // still counts as complete.
    try {
      await fetchWithTimeout("/api/brainstorm/space/analysis/scan", {
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
          <Orbit
            className="h-3.5 w-3.5"
            strokeWidth={1.9}
            style={{ color: FEATURES }}
          />
          {isSubset
            ? `Autopilot · ${selectedIds.length} ${
                selectedIds.length === 1 ? "room" : "rooms"
              }`
            : "Autopilot · all rooms"}
        </motion.button>
        {open && (
          <CanvasAutopilotDropdown
            rooms={roomOptions}
            selectedIds={selectedIds}
            onToggleRoom={(id) =>
              setDeselected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={() => setDeselected(new Set())}
            onSelectNone={() =>
              setDeselected(new Set(roomOptions.map((r) => r.id)))
            }
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

  // ── ENRICHING — progress chip during chain enrichment pass ──
  if (status === "enriching") {
    const room = targets[roomIdx];
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
          Enriching {roomIdx + 1}/{targets.length}
        </span>
        <span
          className="font-light italic"
          style={{ color: appleVibe.text.tertiary }}
          title={room?.subObjectiveTitle ?? ""}
        >
          · causal chains
        </span>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
          title="Cancel — stops after the current room finishes enriching"
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

  // ── SPECCING — progress chip during mechanism-spec pre-gen pass ──
  if (status === "speccing") {
    const room = targets[roomIdx];
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
          Speccing {roomIdx + 1}/{targets.length}
        </span>
        <span
          className="font-light italic"
          style={{ color: appleVibe.text.tertiary }}
          title={room?.subObjectiveTitle ?? ""}
        >
          · mechanism specs
        </span>
        <button
          type="button"
          onClick={cancel}
          className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(15,23,42,0.06)]"
          title="Cancel — stops after the current spec finishes"
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
  rooms,
  selectedIds,
  onToggleRoom,
  onSelectAll,
  onSelectNone,
  onRun,
  onClose,
}: {
  rooms: RoomOption[];
  selectedIds: string[];
  onToggleRoom: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onRun: (withSpecs: boolean) => void;
  onClose: () => void;
}) {
  // Estimated time displayed before user commits — same heuristic as
  // per-room runner (~30s per feature) but applied at the canvas
  // altitude. Caps display at "X min" for legibility.
  // We can't know totalFeatures without calling /start, so show a
  // rough "~3-10 min" placeholder. Refined once the run kicks off.

  // Opt-in: also pre-generate the v2 technical mechanism spec for every
  // feature. Default off — it's a heavy extra LLM pass per feature.
  const [withSpecs, setWithSpecs] = useState(false);

  const selectedSet = new Set(selectedIds);
  const allSelected = rooms.length > 0 && selectedIds.length === rooms.length;
  const noneSelected = selectedIds.length === 0;

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
            <Orbit
              className="h-3.5 w-3.5 flex-shrink-0"
              strokeWidth={1.9}
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
            Scores each mechanism + proposes fresh IV candidates per
            chain across every room. Then enriches each chain with
            mechanism narratives + closes orphan gaps. Finally
            refreshes cross-room findings. You still curate elections
            — autopilot proposes, never auto-elects.
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
              estimated ~5-15 min
            </span>
          </div>
          {/* Room picker — choose which rooms the run covers. Defaults
              to all selected; deselecting narrows the run to a subset. */}
          {rooms.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span
                  className="text-[9.5px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.secondary }}
                >
                  Rooms · {selectedIds.length} of {rooms.length}
                </span>
                <button
                  type="button"
                  onClick={allSelected ? onSelectNone : onSelectAll}
                  className="text-[10px] font-medium underline-offset-2 hover:underline"
                  style={{ color: appleVibe.accent.primary }}
                >
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              </div>
              <div
                className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto rounded-lg p-1"
                style={{
                  background: appleVibe.surface.chip,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                {rooms.map((room) => {
                  const checked = selectedSet.has(room.id);
                  return (
                    <label
                      key={room.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[rgba(15,23,42,0.04)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleRoom(room.id)}
                        className="h-3 w-3 flex-shrink-0"
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-[11.5px] leading-snug"
                        style={{
                          color: checked
                            ? appleVibe.text.primary
                            : appleVibe.text.tertiary,
                        }}
                        title={room.title}
                      >
                        {room.title}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {/* Opt-in — pre-generate the v2 technical mechanism specs. */}
          <label className="mt-2.5 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={withSpecs}
              onChange={(e) => setWithSpecs(e.target.checked)}
              className="mt-0.5 h-3 w-3 flex-shrink-0"
            />
            <span
              className="text-[11px] font-light leading-snug"
              style={{ color: appleVibe.text.secondary }}
            >
              Also generate technical mechanism specs (mechanism of action,
              runtime flow, build methods, ADR, validation). Slower — a deep
              LLM pass per feature.
            </span>
          </label>
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
            disabled={noneSelected}
            onClick={() => onRun(withSpecs)}
            whileHover={noneSelected ? undefined : { y: -1 }}
            whileTap={noneSelected ? undefined : { y: 0.5 }}
            className="inline-flex items-center gap-1.5 transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40"
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
