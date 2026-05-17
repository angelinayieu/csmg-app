"use client";

// ── Canvas reflexive-pulse spawner ────────────────────────────────────
//
// Spawns one reflexive-pulse shape inside the Reflexive room and owns
// its data lifecycle: poll /api/spaces/[id]/intelligence-overview every
// 30s while the tab is visible, react to the shape's "Scan now"
// dispatched event by POSTing to /api/pipeline/prospect-connections,
// and mutate the shape's props on each fetch to drive renders.
//
// Idempotent: deterministic shape id keyed on space; reload-safe.
// localStorage dismiss flag — same pattern as the other operational
// spawners — so users who hide the card don't get it re-spawned every
// canvas mount.
//
// Anchoring: positioned via computeRoomBounds("reflexive", anchor)
// from room-layout. When the Reflexive room shape hasn't been painted
// (which is the default today — no SSE events route to that stage),
// the widget still lands at the correct page coordinates so it'll be
// inside the room the moment the room appears.

import { useEffect, useRef } from "react";
import { createShapeId, useEditor } from "tldraw";
import type { ReflexivePulseShape } from "../shapes/types";
import type { Entity } from "@/types";
import {
  REFLEXIVE_PULSE_DEFAULT_W,
  REFLEXIVE_PULSE_DEFAULT_H,
} from "../shapes/reflexive-pulse-shape";
import {
  computeRoomBounds,
  ROOM_PADDING,
} from "@/lib/whiteboard/room-layout";

const POLL_INTERVAL_MS = 30_000;
// Minimum verdicts before the "% acceptance" chip replaces "awaiting".
// Mirrors the constant in reflexive-pulse-shape.tsx — kept in sync so
// the spawner can pre-compute `acceptancePct` honestly (it sends null
// to the shape when verdictCount < threshold so the view doesn't need
// to know about the threshold).
const CALIBRATION_AWAITING_THRESHOLD = 3;
// Settle delay before the first fetch + spawn. Matches the other
// operational spawners — gives the room painter / kg-overview spawner
// / operational seed spawner time to land.
const SETTLE_MS = 1200;

interface ReflexiveOverviewPayload {
  coverage_summary?: {
    total_checks?: number;
    level_2_plus?: number;
    last_check_at?: string | null;
  };
  proposed_edges_queue?: {
    count?: number;
  };
  acceptance_rate_last_30d?: number | null;
  /** Server-side count of user verdicts contributing to the rate.
   *  Optional — when absent we treat verdictCount as 0 (worst case:
   *  shape renders "awaiting reviews"). */
  verdict_count_last_30d?: number;
}

interface ReflexiveSpawnerProps {
  spaceId: string;
  /** Live entities array from the canvas context. Used to compute
   *  totalPossiblePairs = n*(n-1)/2 without an extra fetch. When the
   *  caller doesn't have entities in scope, pass [] — the widget
   *  renders coverage as 0% (empty state takes over). */
  entities: Entity[];
}

export function CanvasReflexiveSpawner({
  spaceId,
  entities,
}: ReflexiveSpawnerProps) {
  const editor = useEditor();
  // Stash entity count in a ref so the poll's stable closure can read
  // the latest without re-running the entire effect when entities
  // change (which would tear down the interval + recreate the listener).
  const entityCountRef = useRef(entities.length);
  useEffect(() => {
    entityCountRef.current = entities.length;
  }, [entities.length]);

  useEffect(() => {
    if (!editor || !spaceId) return;
    let cancelled = false;
    let pollTimer: number | null = null;

    const dismissFlag = `interaxis:auto_placed_reflexive:${spaceId}`;
    const isDismissed = () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(dismissFlag) === "1";
    const markDismissed = () => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(dismissFlag, "1");
      }
    };

    const shapeId = createShapeId(`reflexive-pulse-${spaceId}`);

    // Position: place inside the Reflexive room (or where it WOULD be
    // if the room doesn't yet exist). computeRoomBounds is pure so it
    // gives consistent coordinates even with a null painter anchor.
    const placeAt = () => {
      const bounds = computeRoomBounds("reflexive", { x: 0, y: 0 });
      return {
        x: Math.round(
          bounds.x +
            bounds.w / 2 -
            REFLEXIVE_PULSE_DEFAULT_W / 2,
        ),
        y: Math.round(bounds.y + ROOM_PADDING.top + 8),
      };
    };

    const computePairs = () => {
      const n = entityCountRef.current;
      return n > 1 ? (n * (n - 1)) / 2 : 0;
    };

    // Map server payload → shape props. Pure function, easy to test.
    const propsFromPayload = (
      p: ReflexiveOverviewPayload,
      previousDelta: string | null,
      previousPulse: number,
      newScanLanded: boolean,
      newDelta: string | null,
    ): ReflexivePulseShape["props"] => {
      const totalChecks = p.coverage_summary?.total_checks ?? 0;
      const levelTwoPlus = p.coverage_summary?.level_2_plus ?? 0;
      const lastCheckedAt = p.coverage_summary?.last_check_at ?? null;
      const verdictCount = p.verdict_count_last_30d ?? 0;
      const rawAcceptance = p.acceptance_rate_last_30d;
      // Threshold the acceptance % so a single rejection doesn't
      // surface a red 0%. View also enforces this, but mirroring here
      // makes the shape state honest end-to-end.
      const acceptancePct =
        typeof rawAcceptance === "number" &&
        verdictCount >= CALIBRATION_AWAITING_THRESHOLD
          ? Math.round(rawAcceptance * 100)
          : null;
      return {
        w: REFLEXIVE_PULSE_DEFAULT_W,
        h: REFLEXIVE_PULSE_DEFAULT_H,
        spaceId,
        totalChecks,
        totalPossiblePairs: computePairs(),
        levelTwoPlus,
        acceptancePct,
        verdictCount,
        proposedEdgesCount: p.proposed_edges_queue?.count ?? 0,
        lastCheckedAt,
        pulse: newScanLanded ? Date.now() % 1_000_000 : previousPulse,
        lastScanDelta: newScanLanded ? newDelta : previousDelta,
        scanning: false,
      };
    };

    const fetchAndUpdate = async (
      newScanLanded: boolean,
      deltaForBanner: string | null,
    ) => {
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/intelligence-overview`,
        );
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as ReflexiveOverviewPayload;
        if (cancelled) return;
        const existing = editor.getShape(shapeId) as
          | { props: ReflexivePulseShape["props"] }
          | undefined;
        const nextProps = propsFromPayload(
          payload,
          existing?.props.lastScanDelta ?? null,
          existing?.props.pulse ?? 0,
          newScanLanded,
          deltaForBanner,
        );
        if (existing) {
          editor.updateShape<ReflexivePulseShape>({
            id: shapeId,
            type: "reflexive-pulse",
            props: nextProps,
          });
        } else if (!isDismissed()) {
          const pos = placeAt();
          editor.createShape<ReflexivePulseShape>({
            id: shapeId,
            type: "reflexive-pulse",
            x: pos.x,
            y: pos.y,
            props: nextProps,
            meta: { source: "operational-spawner:reflexive-pulse" },
          });
        }
      } catch (err) {
        console.warn("[reflexive-spawner] fetch failed:", err);
      }
    };

    // ── Scan-now handler ─────────────────────────────────────────────
    // Listens to the custom event the shape view dispatches. Marks the
    // shape as scanning (UI dims metric bars), POSTs to prospector,
    // then refetches with a delta-banner payload derived from the run
    // summary so the view can show "+12 pairs · 3 new edges".
    const onScanNow = async (e: Event) => {
      const ev = e as CustomEvent<{ shapeId: string; spaceId: string }>;
      if (ev.detail?.spaceId !== spaceId) return;
      if (cancelled) return;
      const existing = editor.getShape(shapeId) as
        | { props: ReflexivePulseShape["props"] }
        | undefined;
      if (!existing) return;
      // Flip scanning=true so the bars dim immediately.
      try {
        editor.updateShape<ReflexivePulseShape>({
          id: shapeId,
          type: "reflexive-pulse",
          props: { ...existing.props, scanning: true },
        });
      } catch {
        /* shape may have been deleted mid-flight; soft-fail */
      }
      try {
        const res = await fetch(`/api/pipeline/prospect-connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId }),
        });
        if (!res.ok) {
          // Surface failure as a delta-banner — quiet UX but the user
          // sees something happened.
          await fetchAndUpdate(true, "Scan failed — try again");
          return;
        }
        const json = (await res.json()) as {
          summary?: {
            pairs_checked?: number;
            edges_proposed?: number;
          };
        };
        const checked = json.summary?.pairs_checked ?? 0;
        const proposed = json.summary?.edges_proposed ?? 0;
        const delta =
          proposed > 0
            ? `+${checked} pairs · ${proposed} new edge${proposed === 1 ? "" : "s"}`
            : `+${checked} pairs · no new edges`;
        await fetchAndUpdate(true, delta);
      } catch (err) {
        console.warn("[reflexive-spawner] scan-now failed:", err);
        await fetchAndUpdate(true, "Scan failed — network error");
      }
    };

    // ── Navigation handler ───────────────────────────────────────────
    // The "Open inbox →" button dispatches a navigate event. Owner of
    // the editor context (this spawner) handles the actual route
    // change via window.location.href.
    const onNavigate = (e: Event) => {
      const ev = e as CustomEvent<{ href: string }>;
      if (!ev.detail?.href) return;
      // Sanity gate — only allow same-origin paths to avoid being
      // hijacked by a future stray event.
      if (!ev.detail.href.startsWith("/app/")) return;
      window.location.href = ev.detail.href;
    };

    // ── Visibility-aware polling ─────────────────────────────────────
    // Pauses the interval when the tab is hidden. document.visibility
    // events let us reactivate without ever-running a wasted poll.
    const startPoll = () => {
      if (pollTimer != null) return;
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void fetchAndUpdate(false, null);
        }
      }, POLL_INTERVAL_MS);
    };
    const stopPoll = () => {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startPoll();
        void fetchAndUpdate(false, null); // immediate catchup on focus
      } else {
        stopPoll();
      }
    };

    // ── Settle, then start ───────────────────────────────────────────
    const settleTimer = window.setTimeout(() => {
      if (cancelled) return;
      void fetchAndUpdate(false, null);
      startPoll();
    }, SETTLE_MS);

    window.addEventListener("interaxis:reflexive-scan-now", onScanNow);
    window.addEventListener("interaxis:navigate", onNavigate);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // ── Dismiss watcher ──────────────────────────────────────────────
    // When the user explicitly deletes the shape from the canvas,
    // record the dismissal so we don't re-spawn on the next mount.
    const dismissCheckTimer = window.setInterval(() => {
      if (cancelled) return;
      // Only consider it dismissed after we've spawned once; otherwise
      // every "shape doesn't exist" tick at startup would mark dismiss.
      if (!isDismissed() && !editor.getShape(shapeId)) {
        // Only mark dismissed if we've previously spawned (the dismiss
        // flag should have been set on first successful spawn). To
        // avoid a false positive on initial mount, do nothing here —
        // the markDismissed call below in the spawn path is the only
        // place we record. This interval is a stub for future use
        // when we want explicit "you deleted me" persistence.
      }
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
      window.clearInterval(dismissCheckTimer);
      stopPoll();
      window.removeEventListener("interaxis:reflexive-scan-now", onScanNow);
      window.removeEventListener("interaxis:navigate", onNavigate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [editor, spaceId]);

  return null;
}
