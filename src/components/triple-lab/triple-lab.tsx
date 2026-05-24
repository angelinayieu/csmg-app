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
import { backgrounds } from "./tokens";

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

interface TripleLabProps {
  spaceId: string;
}

export function TripleLab({ spaceId }: TripleLabProps) {
  const spaceData = useSpaceData();
  const [splits, setSplits] = useState<[number, number, number]>(() =>
    loadSplits(spaceId),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

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
  const isFullyEmpty = useMemo(() => {
    if (spaceData.entities.length > 0) return false;
    if (!synthesisData) return true;
    // Treat synthesis_data as "has content" only if at least one rich
    // section landed. Empty {} or {generated_at: ...} doesn't count.
    const hasLeverage = (synthesisData.leverage_points?.length ?? 0) > 0;
    const hasBottleneck = !!synthesisData.master_bottleneck;
    const hasAxioms = (synthesisData.axioms?.length ?? 0) > 0;
    return !(hasLeverage || hasBottleneck || hasAxioms);
  }, [spaceData.entities.length, synthesisData]);

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
      <CardActionHost spaceId={spaceId}>
      <div
        ref={containerRef}
        className="relative flex h-screen w-full overflow-hidden bg-slate-50"
        style={{ background: backgrounds.pageRoot }}
      >
        {/* ── LEFT: raw signal ─────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{ width: `${splits[0] * 100}%` }}
        >
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

        <Divider onMouseDown={onDividerMouseDown(0)} />

        {/* ── MIDDLE: KG dev ───────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{ width: `${splits[1] * 100}%` }}
        >
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

        <Divider onMouseDown={onDividerMouseDown(1)} />

        {/* ── RIGHT: insights ──────────────────────────────────────── */}
        <div
          className="relative h-full overflow-hidden"
          style={{ width: `${splits[2] * 100}%` }}
        >
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

        {/* ── Unified empty state overlay ──────────────────────────
         *
         * Mounted ABOVE the panels but BELOW the drawer (z-30). Only
         * renders when the space has zero entities AND no synthesis.
         * Acts as its own drop zone — drop a file anywhere in the
         * viewport and the same processFileDrops helper the raw-signal
         * panel uses fires. Disappears as soon as the first entity
         * lands, revealing the panels underneath.
         */}
        {isFullyEmpty && (
          <UnifiedEmptyState onFilesDropped={onEmptyStateFiles} />
        )}
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
