"use client";

// Triple-lab shell — owns the 3-column resizable layout and shares
// state across panels. The actual SSE wiring is handled inside each
// panel through useSpaceData() / useRunEventStoreOptional() so each
// can re-render independently.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { RunEventStoreProvider } from "@/components/canvas/hooks/run-event-store";
import { useExtractionReview } from "@/components/canvas/hooks/use-extraction-review";
import { ExtractionChecklistDrawer } from "@/components/canvas/chrome/extraction-checklist-drawer";
import { useRouter } from "next/navigation";
import type { SynthesisData } from "@/types/synthesis";
import type { Entity, Edge } from "@/types";
import type { LabRoomRow } from "@/app/api/spaces/[id]/lab-rooms/route";
import { ReasoningWhiteboard } from "./reasoning-whiteboard";
import { LibraryDrawer } from "./library-drawer";
import { KgPanel } from "./kg-panel";
import { InsightsPanel } from "./insights-panel";
import { UnifiedEmptyState } from "./unified-empty-state";
import { processFileDrops, type UploadProgress } from "./upload-flow";
import { CardActionHost } from "./card-action-host";
import { UploadProgressToast } from "./upload-progress-toast";
import { backgrounds, colors, tracking } from "./tokens";
import { LiveSynthesisRefresh } from "./use-live-synthesis-refresh";
import { PipelineProgressStrip } from "./pipeline-progress-strip";
import { PipelineErrorBanner } from "./pipeline-error-banner";
import { PipelineModePicker, type PipelineMode } from "./pipeline-mode-picker";
import { CandidateReviewDrawer } from "./candidate-review-drawer";
import { useLabRooms } from "./rooms/use-lab-rooms";
import { UserRoomsStack } from "./rooms/user-rooms-stack";

// Persist split ratios in localStorage so the user's preferred sizing
// is remembered across reloads. Keyed by space so each space can have
// its own preferred allocation (raw-signal-heavy vs. insights-heavy).
function loadSplits(spaceId: string): [number, number, number] {
  if (typeof window === "undefined") return [0.28, 0.42, 0.3];
  try {
    const raw = window.localStorage.getItem(`triple-lab:splits:${spaceId}`);
    if (!raw) return [0.28, 0.42, 0.3];
    const parsed = JSON.parse(raw) as number[];
    if (!Array.isArray(parsed) || parsed.length !== 3) return [0.28, 0.42, 0.3];
    const sum = parsed[0] + parsed[1] + parsed[2];
    if (Math.abs(sum - 1) > 0.05) return [0.28, 0.42, 0.3];
    return parsed as [number, number, number];
  } catch {
    return [0.28, 0.42, 0.3];
  }
}

function saveSplits(spaceId: string, splits: [number, number, number]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `triple-lab:splits:${spaceId}`,
      JSON.stringify(splits),
    );
  } catch {
    // localStorage can throw under private browsing — ignore. The next
    // load just falls back to defaults.
  }
}

// Per-column collapse state persistence. Defaults to all-expanded so a
// first-time visitor sees the full 3-panel layout.
function loadCollapsed(spaceId: string): [boolean, boolean, boolean] {
  if (typeof window === "undefined") return [false, false, false];
  try {
    const raw = window.localStorage.getItem(
      `triple-lab:collapsed:${spaceId}`,
    );
    if (!raw) return [false, false, false];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      return [false, false, false];
    }
    return [Boolean(parsed[0]), Boolean(parsed[1]), Boolean(parsed[2])];
  } catch {
    return [false, false, false];
  }
}

function saveCollapsed(
  spaceId: string,
  collapsed: [boolean, boolean, boolean],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `triple-lab:collapsed:${spaceId}`,
      JSON.stringify(collapsed),
    );
  } catch {
    // ignore
  }
}

interface TripleLabProps {
  spaceId: string;
}

export function TripleLab({ spaceId }: TripleLabProps) {
  const spaceData = useSpaceData();
  const [splits, setSplits] = useState<[number, number, number]>(() =>
    loadSplits(spaceId),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Column collapse state (Phase 5a) ─────────────────────────────────
  // Each column can be independently collapsed to a 48px vertical strip
  // with a rotated label. Click the strip to expand. localStorage-
  // persisted per space so the user's focus preference survives reloads.
  // Guard: at least one column must stay expanded — collapsing the last
  // expanded one is a no-op.
  const [collapsed, setCollapsedRaw] = useState<[boolean, boolean, boolean]>(
    () => loadCollapsed(spaceId),
  );
  const setCollapsed = useCallback(
    (next: [boolean, boolean, boolean]) => {
      // Guard: don't allow all three collapsed.
      if (next[0] && next[1] && next[2]) return;
      setCollapsedRaw(next);
      saveCollapsed(spaceId, next);
    },
    [spaceId],
  );
  const toggleColumn = useCallback(
    (idx: 0 | 1 | 2) => {
      const next = [...collapsed] as [boolean, boolean, boolean];
      next[idx] = !next[idx];
      setCollapsed(next);
    },
    [collapsed, setCollapsed],
  );
  // Focus-mode presets. Wide = all 3 expanded; Split = collapse left;
  // Focus = collapse left + right (middle only). Setting a preset
  // overwrites all 3 collapse flags; user can still fine-tune after.
  const setFocusMode = useCallback(
    (mode: "wide" | "split" | "focus") => {
      const next: [boolean, boolean, boolean] =
        mode === "wide"
          ? [false, false, false]
          : mode === "split"
          ? [true, false, false]
          : [true, false, true];
      setCollapsed(next);
    },
    [setCollapsed],
  );
  // ── Phase 5d: user-added rooms ──────────────────────────────────────
  // Each column may have a stack of user-added rooms (brainstorm,
  // scratch notes, etc.) docked above its default panel. The hook owns
  // fetch + mutations; UserRoomsStack consumes one column slice and
  // dispatches body renderers from ROOM_REGISTRY.
  const {
    rooms: labRoomsByColumn,
    createRoom: createLabRoom,
    deleteRoom: deleteLabRoom,
    patchRoom: patchLabRoom,
  } = useLabRooms(spaceId);

  // Derive width style for each column. Collapsed = fixed 48px;
  // expanded = its fraction of the remaining width (after subtracting
  // collapsed strip widths). Uses CSS calc so the resize transition
  // animates smoothly between states.
  const COLLAPSED_W = 48;
  const widthFor = (idx: 0 | 1 | 2): string => {
    if (collapsed[idx]) return `${COLLAPSED_W}px`;
    // Sum of fractions of EXPANDED columns
    let expandedSum = 0;
    for (let i = 0; i < 3; i++) {
      if (!collapsed[i]) expandedSum += splits[i];
    }
    if (expandedSum === 0) return "0%";
    let collapsedCount = 0;
    for (let i = 0; i < 3; i++) if (collapsed[i]) collapsedCount += 1;
    const collapsedPx = collapsedCount * COLLAPSED_W;
    const fraction = splits[idx] / expandedSum;
    return `calc((100% - ${collapsedPx}px) * ${fraction})`;
  };

  // Cross-panel selection: clicking an entity in any panel highlights
  // the matching node in the middle KG panel and scrolls the right
  // insights panel to whichever insights reference it. One source of
  // truth held here so the panels stay independent.
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(
    null,
  );

  // Concept-expansion toggle — drives whether the raw-signal panel
  // shows Claude-suggested expansion chips beneath each card. Off by
  // default to avoid the LLM cost on first paint; user opts in.
  const [expansionMode, setExpansionMode] = useState<boolean>(false);

  // ── Pipeline mode (Phase 7b) ──────────────────────────────────────
  // Controls how aggressively chain pipelines commit AI outputs:
  //   autopilot    → auto-commit each stage (default)
  //   review_each  → candidate drawer after each stage (Phase 7c)
  //   manual       → no chain pipelines fire
  // Held here so any panel that needs to gate behavior on the mode
  // (e.g. RawSignalPanel skipping auto-extract in manual mode, or
  // KgPanel showing a "manual mode" badge) can read from one place.
  // The picker UI lives in the TopLeftPickerBar and pushes the
  // change to /api/spaces/[id]/pipeline-mode + this local state.
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>("autopilot");

  // ── Candidate review drawer (Phase 7c-3) ───────────────────────────
  // When the space is in review_each mode, chain stages stage their
  // proposed artifacts to pipeline_candidates instead of committing.
  // The drawer reads from there and lets the user pick which to
  // commit. Drawer is mounted at page level (overlays the whole
  // layout, like extraction-review) and triggered by the pending-pill
  // below — itself driven by a light poll of the candidates endpoint.
  //
  // Phase 7c-4 will replace the poll with an SSE event subscription
  // (`candidates_ready` emitted by the gated routes) so the drawer
  // opens within milliseconds of staging, not on the next 30s tick.
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  // When non-null, the drawer fetches just this batch. Set by the
  // room-materialize path (Phase 8) so a freshly-materialized batch
  // opens in focus, not buried under unrelated pending batches.
  // Cleared on drawer close so the next implicit open (via pending
  // pill) shows everything pending across batches.
  const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
  // Single handler the room bodies fire when their Materialize call
  // succeeds. Sets the batch focus + opens the drawer immediately so
  // the user doesn't wait for the 30s pending-pill poll to catch up.
  const handleRoomMaterialized = useCallback((batchId: string) => {
    setReviewBatchId(batchId);
    setReviewDrawerOpen(true);
  }, []);
  // Raw poll value — updated only by the effect below. The displayed
  // count derives this through `displayedPendingCount` so we don't
  // need to setState-to-zero when mode flips (which would trip the
  // react-hooks/set-state-in-effect lint rule).
  const [pendingCandidateCount, setPendingCandidateCount] = useState(0);
  useEffect(() => {
    // Only poll when the user is actually in review mode — autopilot
    // and manual modes never produce pending candidates today. We
    // simply don't start the poll loop in those modes; the displayed
    // value is gated below via `displayedPendingCount`.
    if (pipelineMode !== "review_each") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/candidates?status=pending`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { candidates: unknown[] };
        if (!cancelled) {
          setPendingCandidateCount(body.candidates?.length ?? 0);
        }
      } catch {
        // Soft-fail. Pill just stays at the previous value.
      }
    };
    void tick();
    const interval = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [spaceId, pipelineMode]);
  // Displayed pill count — only when in review mode does the underlying
  // poll value actually mean something to show. Switching away from
  // review_each visually hides the pill but doesn't reset the cached
  // value (so flipping back doesn't blink to 0 before the next poll).
  const displayedPendingCount =
    pipelineMode === "review_each" ? pendingCandidateCount : 0;

  // ── Extraction-review (HITL) drawer ─────────────────────────────────
  // Hoisted to page-level so the drawer overlays the entire layout,
  // not just the left panel. The raw-signal panel calls openDrawer()
  // after a successful drop + parse for research-class assets. Same
  // hook the main canvas uses → same chain ↦ entity inserts ↦ SSE.
  const extractionReview = useExtractionReview();
  const router = useRouter();
  const openDrawer = useCallback(
    async (assetId: string, assetName: string, assetClass: string | null) => {
      await extractionReview.open({ assetId, assetName, assetClass });
    },
    [extractionReview],
  );

  // ── Unified empty state detection ───────────────────────────────────
  // First-time-in-the-lab state: zero entities AND zero synthesis. We
  // show one centered overlay explaining the workflow instead of the
  // three independent "empty" messages each panel would render. The
  // overlay doubles as a drop zone so the user can drop a file
  // anywhere without aiming at the left column.
  //
  // Once the user has ANY entity OR a synthesis_data with content, the
  // overlay disappears and the panels show their normal contents
  // (including the per-panel empty states for partial-data cases).
  const synthesisData = (spaceData.space.synthesis_data as SynthesisData | null) ?? null;
  // Manual dismiss flag — set true when the user submits the empty-
  // state idea entry OR drops a file. Means "the overlay should NOT
  // re-appear even if entities are still 0" so the user can watch
  // the panels populate in real time instead of staring at a loading
  // screen. Resets to false naturally on space change (component
  // remount) but persists across re-renders within the same session.
  const [emptyStateDismissed, setEmptyStateDismissed] = useState<boolean>(false);
  // Total user-added rooms across all 3 columns. ANY room counts as
  // "user has started" — even a scratch note signals intent — so the
  // empty-state overlay dismisses to reveal the room(s). Without this
  // a freshly-promoted brainstorm space (no entities yet) would have
  // the brainstorm room hidden behind the overlay, breaking the whole
  // promote-to-lab handoff.
  const totalUserRooms =
    labRoomsByColumn.left.length +
    labRoomsByColumn.middle.length +
    labRoomsByColumn.right.length;
  const dataIsPresent = useMemo(() => {
    if (spaceData.entities.length > 0) return true;
    if (totalUserRooms > 0) return true;
    if (!synthesisData) return false;
    const hasLeverage = (synthesisData.leverage_points?.length ?? 0) > 0;
    const hasBottleneck = !!synthesisData.master_bottleneck;
    const hasAxioms = (synthesisData.axioms?.length ?? 0) > 0;
    return hasLeverage || hasBottleneck || hasAxioms;
  }, [spaceData.entities.length, totalUserRooms, synthesisData]);
  // Show overlay ONLY when the space has no data AND user hasn't
  // manually dismissed it. The moment they submit, dataIsPresent is
  // still false but emptyStateDismissed flips true → overlay slides
  // out → panels visible → user watches generation happen live.
  const isFullyEmpty = !dataIsPresent && !emptyStateDismissed;

  // ── Upload progress toast wiring ────────────────────────────────────
  // The toast lives at page level and exposes an imperative push
  // handle so any surface that calls processFileDrops can forward
  // progress events into one shared stack. Stored as a ref because
  // it changes identity only on mount/unmount of the toast — never
  // during a drop — so the upload effects don't churn on every tick.
  const toastHandleRef = useRef<{ push: (p: UploadProgress) => void } | null>(
    null,
  );
  const handleProgress = useCallback((progress: UploadProgress) => {
    toastHandleRef.current?.push(progress);
  }, []);
  const registerToastHandle = useCallback(
    (handle: { push: (p: UploadProgress) => void }) => {
      toastHandleRef.current = handle;
    },
    [],
  );

  const onEmptyStateFiles = useCallback(
    async (files: File[]) => {
      await processFileDrops(files, {
        spaceId,
        onAssetReady: openDrawer,
        onRefresh: () => router.refresh(),
        onProgress: handleProgress,
      });
    },
    [spaceId, openDrawer, router, handleProgress],
  );

  // ── Resize handlers ────────────────────────────────────────────────
  // Track which divider is being dragged. Splits are stored as
  // fractions [left, middle, right] summing to ~1 so any future window
  // resize keeps the proportions instead of pixel-locking.
  const dragRef = useRef<{ divider: 0 | 1; startX: number; startSplits: [number, number, number] } | null>(
    null,
  );

  const onDividerMouseDown = useCallback(
    (divider: 0 | 1) => (e: React.MouseEvent) => {
      dragRef.current = { divider, startX: e.clientX, startSplits: splits };
      e.preventDefault();
      // Set cursor + disable text selection globally during drag.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [splits],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const containerW = containerRef.current.clientWidth;
      if (containerW < 100) return;
      const deltaPx = e.clientX - dragRef.current.startX;
      const deltaFrac = deltaPx / containerW;
      const next: [number, number, number] = [
        ...dragRef.current.startSplits,
      ] as [number, number, number];
      // Clamp each pane to ≥15% so a panel can never shrink to nothing.
      const MIN = 0.15;
      if (dragRef.current.divider === 0) {
        // Divider 0 sits between left + middle.
        next[0] = Math.max(MIN, Math.min(1 - 2 * MIN, dragRef.current.startSplits[0] + deltaFrac));
        next[1] = Math.max(MIN, dragRef.current.startSplits[1] - deltaFrac);
      } else {
        // Divider 1 sits between middle + right.
        next[1] = Math.max(MIN, Math.min(1 - 2 * MIN, dragRef.current.startSplits[1] + deltaFrac));
        next[2] = Math.max(MIN, dragRef.current.startSplits[2] - deltaFrac);
      }
      setSplits(next);
    },
    [],
  );

  const onMouseUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    saveSplits(spaceId, splits);
  }, [spaceId, splits]);

  // Mount global drag listeners once at the top level so a drag that
  // starts on the divider continues to track even when the cursor
  // exits the divider strip. Listeners no-op when dragRef.current is
  // null so they're cheap when idle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Active run tracking ────────────────────────────────────────────
  // Poll /api/spaces/[id]/active-run every 4s to learn the run-id of
  // whatever pipeline is currently in flight for this space. Feeds
  // RunEventStoreProvider so the live graph animates while the chain
  // is decomposing / synthesizing. `null` when idle — provider then
  // no-ops cleanly.
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/latest-run`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          run: { id: string; status: string } | null;
        };
        // Subscribe to ANY status. The SSE stream endpoint replays
        // backlog from completed runs and tails new events from
        // running ones. Filtering by status === "running" lost the
        // backlog — which is exactly what the MIDDLE insights panel
        // needs to render cycle/bridge/signal/proposal cards from
        // the most recent finished chain.
        if (!cancelled) {
          setActiveRunId(body.run?.id ?? null);
        }
      } catch {
        // Soft-fail: leave activeRunId as-is. The next tick will retry.
      }
    };
    void tick();
    const interval = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [spaceId]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    // Subscribe the whole lab to the structural event SSE bus when a
    // run is active. Each panel reads from this via
    // useRunEventStoreOptional() and degrades to static data otherwise.
    // CardActionHost wraps the layout so per-card hover actions
    // (Connect / Solve / Probe) can open page-level modals + panels.
    <RunEventStoreProvider runId={activeRunId}>
      {/* Mount the live-synthesis refresher as a sibling so it lives
       *  INSIDE the SSE provider's children tree (it reads the event
       *  store via useRunEventStoreOptional). Renders nothing; it's
       *  a side-effect-only component that calls router.refresh()
       *  on synthesis-emitting events + a 12s fallback poll while a
       *  run is in flight. Closes the gap where the user dropped a
       *  paper, committed, and then watched the empty state sit
       *  unchanged for 60-90s while the chain ran. */}
      <LiveSynthesisRefresh activeRunId={activeRunId} />
      <CardActionHost spaceId={spaceId}>
      {/* Outer flex-col so the PipelineProgressStrip sits ABOVE the
       *  3-column panel layout. The strip auto-renders nothing when
       *  no run is active, so it collapses to zero height — no layout
       *  jiggle on first paint. */}
      <div
        className="flex h-screen w-full flex-col overflow-hidden"
        style={{ background: backgrounds.pageRoot }}
      >
        {/* Top: real pipeline progress (replaces the old fake label loop) */}
        <PipelineProgressStrip hasActiveRun={activeRunId !== null} />

        {/* Pipeline error banner — surfaces fatal/warning pipeline_error
         *  events directly under the progress strip so failures are
         *  visible instead of silently stalling. Renders null when
         *  no error events have arrived. */}
        <PipelineErrorBanner />

        {/* Inner: the 3-column layout. flex-1 lets it consume the
         *  remaining vertical space below the strip.
         *
         *  `data-pipeline-mode` exposes the current mode to the DOM so
         *  future Phase 7c gates can read it via CSS selectors (e.g.
         *  `[data-pipeline-mode="manual"] .auto-only { display: none }`)
         *  AND so devtools can show the active mode at a glance. */}
      <div
        ref={containerRef}
        className="relative flex w-full flex-1 overflow-hidden"
        data-pipeline-mode={pipelineMode}
      >
        {/* ── Top-left picker bar (floating) ────────────────────────
         *
         * Two visually-adjacent but conceptually-distinct toggles:
         *
         *   FocusModePicker     → "how do I see the lab?" (layout)
         *   PipelineModePicker  → "how aggressively does AI commit?" (behavior)
         *
         * Each is a chip-group. They share a row with a tiny visual
         * separator so the user reads them as related-but-different
         * affordances, not one monolithic control. */}
        <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
          <FocusModePicker
            collapsed={collapsed}
            onSetMode={setFocusMode}
          />
          {/* Hair-thin separator so the two pickers visually parse as
           *  two groups, not one wide blob. */}
          <span
            className="h-5 w-px"
            style={{ background: colors.neutral.borderFaint }}
            aria-hidden
          />
          <PipelineModePicker
            spaceId={spaceId}
            onChange={setPipelineMode}
          />
          {/* Pending-review pill — only renders when there are
           *  candidates waiting. Click opens the CandidateReviewDrawer
           *  with all pending grouped by batch. Today this pill is
           *  driven by a 30s poll (Phase 7c-3); Phase 7c-4 replaces
           *  the poll with an SSE `candidates_ready` event so the
           *  pill appears within ms of staging. */}
          {displayedPendingCount > 0 && (
            <button
              type="button"
              onClick={() => setReviewDrawerOpen(true)}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold shadow-sm transition-all hover:scale-105"
              style={{
                background: colors.brand.gradient,
                color: "white",
                boxShadow: `0 4px 12px ${colors.brand.shadowStrong}`,
                letterSpacing: tracking.eyebrowTight,
              }}
              title={`Review ${displayedPendingCount} pending candidate${
                displayedPendingCount === 1 ? "" : "s"
              }`}
            >
              <span className="font-mono text-[11px] leading-none">◐</span>
              {displayedPendingCount} pending
            </button>
          )}
        </div>

        {/* ── LEFT: reasoning whiteboard (Phase 6a) ────────────────────
         *
         * The whiteboard is now the LEFT column's primary surface —
         * spatial mind-map of the LLM's reasoning around the idea seed.
         * The old card list moves into a collapsible Library drawer at
         * the bottom (Phase 6b).
         *
         * A column-level drop zone wraps both surfaces so the user can
         * drop a file ANYWHERE in the left column (over the whiteboard,
         * the library header, etc.) and it lands in the same /api/ingest
         * pipeline. The drop overlay paints over the whole column,
         * not just one sub-surface. */}
        <div
          className="relative h-full overflow-hidden"
          style={{
            width: widthFor(0),
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {collapsed[0] ? (
            <CollapsedStrip
              label="Whiteboard"
              glyph="◉"
              tone="indigo"
              onExpand={() => toggleColumn(0)}
            />
          ) : (
            <LeftColumnSurface
              spaceId={spaceId}
              entities={spaceData.entities}
              edges={spaceData.edges}
              expansionMode={expansionMode}
              setExpansionMode={setExpansionMode}
              selectedEntityId={selectedEntityId}
              setSelectedEntityId={setSelectedEntityId}
              openDrawer={openDrawer}
              handleProgress={handleProgress}
              toggleColumn={toggleColumn}
              roomsLeft={labRoomsByColumn.left}
              createLabRoom={createLabRoom}
              patchLabRoom={patchLabRoom}
              deleteLabRoom={deleteLabRoom}
              onRoomMaterialized={handleRoomMaterialized}
            />
          )}
        </div>

        {/* Divider hidden when either adjacent column is collapsed
         *  (drag has no meaning between an expanded and a collapsed
         *  strip). Strip click handles the expand instead. */}
        {!collapsed[0] && !collapsed[1] && (
          <Divider onMouseDown={onDividerMouseDown(0)} />
        )}

        {/* ── MIDDLE: KG dev ───────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{
            width: widthFor(1),
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {collapsed[1] ? (
            <CollapsedStrip
              label="Insights"
              glyph="✦"
              tone="indigo"
              onExpand={() => toggleColumn(1)}
            />
          ) : (
            <>
              <CollapseButton
                onClick={() => toggleColumn(1)}
                side="left"
              />
              <div className="flex h-full flex-col">
                <div
                  className="shrink-0 overflow-y-auto"
                  style={{ maxHeight: "55%" }}
                >
                  <UserRoomsStack
                    spaceId={spaceId}
                    slot="middle"
                    rooms={labRoomsByColumn.middle}
                    onCreate={createLabRoom}
                    onPatch={patchLabRoom}
                    onDelete={deleteLabRoom}
                    onMaterialized={handleRoomMaterialized}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <KgPanel
                    spaceId={spaceId}
                    entities={spaceData.entities}
                    edges={spaceData.edges}
                    cycles={spaceData.cycles}
                    bridges={spaceData.bridges}
                    selectedEntityId={selectedEntityId}
                    onSelectEntity={setSelectedEntityId}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {!collapsed[1] && !collapsed[2] && (
          <Divider onMouseDown={onDividerMouseDown(1)} />
        )}

        {/* ── RIGHT: insights ──────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{
            width: widthFor(2),
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {collapsed[2] ? (
            <CollapsedStrip
              label="Artifacts"
              glyph="◆"
              tone="indigo"
              onExpand={() => toggleColumn(2)}
            />
          ) : (
            <>
              <CollapseButton
                onClick={() => toggleColumn(2)}
                side="left"
              />
              <div className="flex h-full flex-col">
                <div
                  className="shrink-0 overflow-y-auto"
                  style={{ maxHeight: "55%" }}
                >
                  <UserRoomsStack
                    spaceId={spaceId}
                    slot="right"
                    rooms={labRoomsByColumn.right}
                    onCreate={createLabRoom}
                    onPatch={patchLabRoom}
                    onDelete={deleteLabRoom}
                    onMaterialized={handleRoomMaterialized}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <InsightsPanel
                    spaceId={spaceId}
                    // DB types synthesis_data as Json (free-form), but it always
                    // matches SynthesisData shape in practice. Cast at the
                    // boundary so the panel can navigate the rich shape without
                    // unsafe access everywhere. Null when synthesize hasn't run.
                    synthesisData={synthesisData}
                    entities={spaceData.entities}
                    selectedEntityId={selectedEntityId}
                    onSelectEntity={setSelectedEntityId}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Unified empty state overlay ──────────────────────────
         *
         * Mounted ABOVE the panels but BELOW the drawer (z-30). Shows
         * when the space has zero data AND the user hasn't manually
         * dismissed (via submitting an idea or dropping a file).
         *
         * The moment the user kicks off the pipeline, the overlay
         * dismisses and the user sees the 3-panel layout populating
         * in real time — instead of staring at a loading screen for
         * 2-3 minutes. See `onSubmitStarted` below.
         */}
        {isFullyEmpty && (
          <UnifiedEmptyState
            spaceId={spaceId}
            onFilesDropped={(files) => {
              setEmptyStateDismissed(true);
              onEmptyStateFiles(files);
            }}
            onSubmitStarted={() => setEmptyStateDismissed(true)}
          />
        )}
      </div>
      </div>

      {/* ── HITL extraction-review drawer ────────────────────────────
       *
       * Mounted at the page level so the slide-out overlays the entire
       * 3-panel layout (not just one column). Same hook + same drawer
       * the main canvas uses → identical chain behavior:
       *
       *   commit → Phase 2a after()-decompose →
       *   downstream synthesis / strategy / labs
       *
       * On a successful extract we also kick router.refresh() so the
       * raw-signal panel picks up the newly-committed entities and
       * the middle KG panel paints them via the existing useEffect.
       */}
      {extractionReview.isOpen && extractionReview.preview && (
        <ExtractionChecklistDrawer
          preview={extractionReview.preview}
          assetName={extractionReview.assetName ?? "Asset"}
          assetClass={extractionReview.assetClass}
          open={extractionReview.isOpen}
          onClose={extractionReview.close}
          onExtract={async (selectedIds, focusLevel, fullDecompose) => {
            const result = await extractionReview.extract(
              selectedIds,
              focusLevel,
              fullDecompose,
            );
            if (result) {
              // Pull the new entities into the panels. The middle KG
              // panel + insights panel both subscribe to spaceData, so
              // this single refresh updates everything.
              router.refresh();
            }
          }}
          onSkip={async () => {
            await extractionReview.skip();
            router.refresh();
          }}
        />
      )}

      {/* ── Upload progress toast ───────────────────────────────────
       *
       * Bottom-left stack showing the stage of each in-flight file
       * drop. The previous build had a silent 30-90s dead zone
       * between drop and drawer-open (parse worker runs async); now
       * the user sees "Uploading → Parsing → Opening review" so they
       * know the system is working. Same stack serves both drop
       * paths (raw-signal panel + unified empty state) via the
       * shared handleProgress callback above.
       */}
      <UploadProgressToast registerHandle={registerToastHandle} />

      {/* ── Candidate review drawer (Phase 7c-3) ───────────────────
       *
       * Page-level mount so the right-side overlay covers the whole
       * layout, not just one column. Opens when the user clicks the
       * "N pending" pill in the top-left picker bar. Phase 7c-4 will
       * also wire SSE-driven auto-opening when a chain stage finishes
       * staging in review_each mode. */}
      <CandidateReviewDrawer
        spaceId={spaceId}
        batchId={reviewBatchId}
        open={reviewDrawerOpen}
        onClose={() => {
          setReviewDrawerOpen(false);
          // Clear batch focus so the next implicit open (e.g. via
          // the pending-pill) shows EVERY pending batch, not just the
          // last one we focused on.
          setReviewBatchId(null);
        }}
        onCommitted={() => {
          // Refresh the page state so the newly-committed entities
          // appear on the whiteboard / KG view, and clear the pending
          // count immediately (the next poll tick would also clear it
          // but instant feedback is better UX).
          setPendingCandidateCount(0);
          setReviewBatchId(null);
          router.refresh();
        }}
      />
      </CardActionHost>
    </RunEventStoreProvider>
  );
}

// ── Divider component ───────────────────────────────────────────────
// 8px-wide drag handle. Visually a 1px gray line that thickens on
// hover/drag. Cursor changes to col-resize on hover so the user knows
// it's draggable before they grab it.
function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative h-full shrink-0 cursor-col-resize select-none"
      style={{ width: 8 }}
    >
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all"
        style={{
          width: hover ? 3 : 1,
          background: hover ? "rgba(79, 70, 229, 0.5)" : "rgba(15, 23, 42, 0.08)",
        }}
      />
    </div>
  );
}

// ── LeftColumnSurface (Phase 6a/6b) ──────────────────────────────────
//
// The LEFT column's body: a top user-rooms stack, the reasoning
// whiteboard (primary surface), and the library drawer (collapsible).
// A column-level drag/drop handler wraps all three so the user can
// drop a file ANYWHERE in the column — over the whiteboard background,
// the library header, or even the rooms strip — and the drop routes
// through processFileDrops with the same callbacks the unified empty
// state uses. The drop overlay paints over the whole column for
// crisp feedback, not one sub-surface at a time.
function LeftColumnSurface({
  spaceId,
  entities,
  edges,
  expansionMode,
  setExpansionMode,
  selectedEntityId,
  setSelectedEntityId,
  openDrawer,
  handleProgress,
  toggleColumn,
  roomsLeft,
  createLabRoom,
  patchLabRoom,
  deleteLabRoom,
  onRoomMaterialized,
}: {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  expansionMode: boolean;
  setExpansionMode: (v: boolean) => void;
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;
  openDrawer: (
    assetId: string,
    assetName: string,
    assetClass: string | null,
  ) => Promise<void>;
  handleProgress: (progress: UploadProgress) => void;
  toggleColumn: (idx: 0 | 1 | 2) => void;
  roomsLeft: LabRoomRow[];
   
  createLabRoom: (slot: "left" | "middle" | "right", kind: string, roomConfig?: Record<string, any>) => Promise<LabRoomRow | null>;
  patchLabRoom: (
    roomId: string,
    patch: {
      collapsed?: boolean;
      position?: number;
       
      room_config?: Record<string, any>;
    },
  ) => Promise<LabRoomRow | null>;
  deleteLabRoom: (roomId: string) => Promise<boolean>;
  /** Forwarded to UserRoomsStack so scratch_note's Materialize button
   *  can ask the host to open the CandidateReviewDrawer focused on
   *  the new batch (Phase 8). */
  onRoomMaterialized: (batchId: string) => void;
}) {
  const router = useRouter();
  const [dropActive, setDropActive] = useState(false);
  const dragCount = useRef(0);
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current += 1;
    if (dragCount.current === 1) setDropActive(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDropActive(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragCount.current = 0;
      setDropActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      await processFileDrops(files, {
        spaceId,
        onAssetReady: openDrawer,
        onRefresh: () => router.refresh(),
        onProgress: handleProgress,
      });
    },
    [spaceId, router, openDrawer, handleProgress],
  );

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CollapseButton onClick={() => toggleColumn(0)} side="right" />

      {/* User-added rooms stack — tightened cap from 55% → 30% so the
       *  whiteboard has clear visual priority as the primary surface. */}
      <div
        className="shrink-0 overflow-y-auto"
        style={{ maxHeight: "30%" }}
      >
        <UserRoomsStack
          spaceId={spaceId}
          slot="left"
          rooms={roomsLeft}
          onCreate={createLabRoom}
          onPatch={patchLabRoom}
          onDelete={deleteLabRoom}
          onMaterialized={onRoomMaterialized}
        />
      </div>

      {/* Reasoning whiteboard — flex-1 so it consumes whatever vertical
       *  space remains after the rooms stack + library drawer. min-h-0
       *  is the critical bit that lets flex children with overflow:hidden
       *  actually shrink (otherwise they bottom out at intrinsic size). */}
      <div className="relative min-h-0 flex-1">
        <ReasoningWhiteboard
          spaceId={spaceId}
          entities={entities}
          edges={edges}
          selectedEntityId={selectedEntityId}
          onSelectEntity={setSelectedEntityId}
        />
      </div>

      {/* Library drawer — collapsible bottom strip. Default closed.
       *  Holds the old card list (RawSignalPanel) so the user still has
       *  inventory access without it dominating the column. */}
      <LibraryDrawer
        spaceId={spaceId}
        entities={entities}
        edges={edges}
        expansionMode={expansionMode}
        onExpansionModeChange={setExpansionMode}
        selectedEntityId={selectedEntityId}
        onSelectEntity={setSelectedEntityId}
        onAssetReady={openDrawer}
        onUploadProgress={handleProgress}
      />

      {/* Column-level drop overlay — covers the whole column so the
       *  user gets clear feedback that the drop will land in this lab,
       *  not just one sub-panel. */}
      {dropActive && (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${colors.drop.halo} 0%, ${colors.drop.bgVignetteEnd} 80%)`,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            className="rounded-2xl border-2 border-dashed px-6 py-5 text-center"
            style={{
              borderColor: colors.drop.borderStrong,
              background: "rgba(10, 14, 22, 0.7)",
            }}
          >
            <div
              className="text-[9px] font-bold uppercase"
              style={{
                color: colors.drop.fg,
                letterSpacing: tracking.eyebrow,
              }}
            >
              ◉ Drop to seed
            </div>
            <div className="mt-1 text-sm font-bold text-slate-50">
              Add to the whiteboard
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FocusModePicker (Phase 5a) ───────────────────────────────────────
// Floating top-left chip-group with three presets:
//   Wide  = all 3 columns expanded
//   Split = collapse left, focus on middle + right
//   Focus = collapse left + right, middle only
//
// Each chip lights up when its preset matches the current collapse
// state. Clicking a chip sets all 3 collapse flags atomically. The
// user can still fine-tune via per-column chevrons after picking a
// preset — picker just re-highlights to the matching mode (or none
// if the combo doesn't match any preset).
function FocusModePicker({
  collapsed,
  onSetMode,
}: {
  collapsed: [boolean, boolean, boolean];
  onSetMode: (mode: "wide" | "split" | "focus") => void;
}) {
  const isWide = !collapsed[0] && !collapsed[1] && !collapsed[2];
  const isSplit = collapsed[0] && !collapsed[1] && !collapsed[2];
  const isFocus = collapsed[0] && !collapsed[1] && collapsed[2];

  return (
    // Positioning is now provided by the parent TopLeftPickerBar
    // (Phase 7b) so the FocusModePicker and PipelineModePicker can
    // sit side-by-side without competing absolute coordinates.
    <div
      className="flex items-center gap-0.5 rounded-full p-0.5 shadow-sm"
      style={{
        background: "rgba(255, 255, 255, 0.88)",
        border: `1px solid ${colors.neutral.borderFaint}`,
        backdropFilter: "blur(8px)",
      }}
    >
      <FocusChip
        active={isWide}
        onClick={() => onSetMode("wide")}
        label="Wide"
        glyphs="▤▤▤"
        title="All three columns expanded"
      />
      <FocusChip
        active={isSplit}
        onClick={() => onSetMode("split")}
        label="Split"
        glyphs="▤◧"
        title="Middle + right expanded (focus on reasoning + outputs)"
      />
      <FocusChip
        active={isFocus}
        onClick={() => onSetMode("focus")}
        label="Focus"
        glyphs="◉"
        title="Middle only (focus on reasoning)"
      />
    </div>
  );
}

function FocusChip({
  active,
  onClick,
  label,
  glyphs,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  glyphs: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
      style={{
        background: active ? colors.brand.gradient : "transparent",
        color: active ? "white" : "rgb(71, 85, 105)",
        boxShadow: active ? `0 3px 8px ${colors.brand.shadow}` : "none",
      }}
    >
      <span className="font-mono text-[10px]">{glyphs}</span>
      {label}
    </button>
  );
}

// ── CollapsedStrip ──────────────────────────────────────────────────
// 48px-wide vertical strip that replaces a collapsed column's contents.
// Shows a rotated label + glyph; clicking anywhere on the strip
// expands the column back. Subtle ambient gradient so the strip
// reads as "tucked away" rather than empty.
function CollapsedStrip({
  label,
  glyph,
  tone,
  onExpand,
}: {
  label: string;
  glyph: string;
  tone: "indigo" | "teal" | "amber";
  onExpand: () => void;
}) {
  // tone retained for future per-column accent variants; today all
  // columns share the brand accent for visual consistency.
  void tone;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="group flex h-full w-full flex-col items-center justify-center gap-3 transition-colors"
      style={{
        background: colors.neutral.panelBgFlat,
        borderLeft: `1px solid ${colors.neutral.borderFaint}`,
        borderRight: `1px solid ${colors.neutral.borderFaint}`,
      }}
      title={`Expand ${label}`}
    >
      <span
        className="font-mono text-[14px] font-bold transition-colors group-hover:scale-110"
        style={{
          color: colors.brand.fg,
          transition: "transform 220ms ease, color 220ms ease",
        }}
      >
        {glyph}
      </span>
      <span
        className="text-[10px] font-bold uppercase text-slate-500 group-hover:text-slate-900"
        style={{
          letterSpacing: "0.22em",
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}
      >
        {label}
      </span>
      <span
        className="text-[10px] text-slate-400 group-hover:text-indigo-600"
        style={{ transition: "color 220ms ease" }}
      >
        ›
      </span>
    </button>
  );
}

// ── CollapseButton ─────────────────────────────────────────────────
// Small chevron tucked into the top corner of an expanded column.
// Side = which edge to pin to ('left' for middle/right columns,
// 'right' for the left column). Click → column collapses to a strip.
function CollapseButton({
  onClick,
  side,
}: {
  onClick: () => void;
  side: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Collapse column"
      className="absolute z-20 flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-slate-200"
      style={{
        top: 14,
        [side]: 6,
        background: "rgba(255, 255, 255, 0.85)",
        border: `1px solid ${colors.neutral.borderFaint}`,
        color: colors.neutral.fg500,
        backdropFilter: "blur(4px)",
      }}
    >
      <span className="font-mono text-[12px] leading-none">
        {side === "right" ? "‹" : "›"}
      </span>
    </button>
  );
}
