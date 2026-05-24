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
import { RawSignalPanel } from "./raw-signal-panel";
import { KgPanel } from "./kg-panel";
import { InsightsPanel } from "./insights-panel";
import { UnifiedEmptyState } from "./unified-empty-state";
import { processFileDrops, type UploadProgress } from "./upload-flow";
import { CardActionHost } from "./card-action-host";
import { UploadProgressToast } from "./upload-progress-toast";
import { backgrounds, colors } from "./tokens";
import { LiveSynthesisRefresh } from "./use-live-synthesis-refresh";
import { PipelineProgressStrip } from "./pipeline-progress-strip";
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
  const dataIsPresent = useMemo(() => {
    if (spaceData.entities.length > 0) return true;
    if (!synthesisData) return false;
    const hasLeverage = (synthesisData.leverage_points?.length ?? 0) > 0;
    const hasBottleneck = !!synthesisData.master_bottleneck;
    const hasAxioms = (synthesisData.axioms?.length ?? 0) > 0;
    return hasLeverage || hasBottleneck || hasAxioms;
  }, [spaceData.entities.length, synthesisData]);
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
        // Only subscribe to running runs — completed ones don't emit
        // new events. The provider handles backlog replay so we still
        // get a snapshot of the latest completed run on first paint.
        if (!cancelled) {
          if (body.run && body.run.status === "running") {
            setActiveRunId(body.run.id);
          } else {
            setActiveRunId(null);
          }
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

        {/* Inner: the 3-column layout. flex-1 lets it consume the
         *  remaining vertical space below the strip. */}
      <div
        ref={containerRef}
        className="relative flex w-full flex-1 overflow-hidden"
      >
        {/* ── Focus-mode picker (top-left floating) ───────────────────
         *
         * Three preset chips: Wide (3 cols), Split (middle+right),
         * Focus (middle only). Plus the user can toggle individual
         * columns via the chevron in each panel header. localStorage-
         * persisted per space so the user's chosen focus survives
         * reload. Floating in the top-left corner so it doesn't
         * compete with panel chrome. */}
        <FocusModePicker
          collapsed={collapsed}
          onSetMode={setFocusMode}
        />

        {/* ── LEFT: raw signal ─────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{
            width: widthFor(0),
            transition: "width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {collapsed[0] ? (
            <CollapsedStrip
              label="Raw signal"
              glyph="◉"
              tone="indigo"
              onExpand={() => toggleColumn(0)}
            />
          ) : (
            <>
              <CollapseButton
                onClick={() => toggleColumn(0)}
                side="right"
              />
              <div className="flex h-full flex-col">
                {/* User-added rooms stack (Phase 5d) — capped at ~55%
                 *  of column height so the default panel always has
                 *  room to breathe. The stack itself scrolls when the
                 *  user has many expanded rooms. */}
                <div
                  className="shrink-0 overflow-y-auto"
                  style={{ maxHeight: "55%" }}
                >
                  <UserRoomsStack
                    spaceId={spaceId}
                    slot="left"
                    rooms={labRoomsByColumn.left}
                    onCreate={createLabRoom}
                    onPatch={patchLabRoom}
                    onDelete={deleteLabRoom}
                  />
                </div>
                <div className="min-h-0 flex-1">
                  <RawSignalPanel
                    spaceId={spaceId}
                    entities={spaceData.entities}
                    edges={spaceData.edges}
                    expansionMode={expansionMode}
                    onExpansionModeChange={setExpansionMode}
                    selectedEntityId={selectedEntityId}
                    onSelectEntity={setSelectedEntityId}
                    onAssetReady={openDrawer}
                    onUploadProgress={handleProgress}
                  />
                </div>
              </div>
            </>
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
    <div
      className="absolute left-3 top-3 z-30 flex items-center gap-0.5 rounded-full p-0.5 shadow-sm"
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
