"use client";

// ── Whiteboard page ──
// Route: /app/space/[id]/whiteboard
//
// Consolidation (Phase 47): this route now serves the Miro-grade tldraw
// whiteboard (InteraxisCanvas) — sticky notes, text, shapes, arrows,
// drawing, library, AI wand, probability rings, drop-to-analyze,
// atmospheric lab-entry, AI Receipts, reaction badges, depth glyphs,
// and everything shipped in phases 30–46.
//
// The prior tier-layout overview lives at `/whiteboard/overview` for
// users who want that specific view.
//
// Full-viewport: we bypass the space shell so the whiteboard gets the
// full canvas real estate, matching the lab's immersive treatment and
// giving sticky/draw/etc tools room to breathe.

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, GitBranch, Camera } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { ConnectPanel } from "@/components/whiteboard/connect-panel";
import { CanvasSnapshotsDrawer } from "@/components/canvas/chrome/canvas-snapshots-drawer";
import { CanvasScenarioPanel } from "@/components/canvas/chrome/canvas-scenario-panel";
import { WhiteboardBootstrapSplash } from "@/components/canvas/whiteboard-bootstrap-splash";

// Dynamic-import the canvas so tldraw (~600KB + Three.js neighbours)
// ships only with the whiteboard route, not with the space dashboard.
const InteraxisCanvas = dynamic(
  () => import("@/components/canvas/interaxis-canvas").then((m) => m.InteraxisCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading whiteboard…
        </div>
      </div>
    ),
  },
);

export default function WhiteboardPage() {
  const { space, entities, edges } = useSpaceData();
  const searchParams = useSearchParams();
  // ?run=<uuid> means we're freshly arriving from the intake bootstrap
  // (or a manual deep-link). The splash bridges the dead-looking
  // canvas window before the first SSE event paints.
  const runIdFromQuery = searchParams.get("run");
  const [connectOpen, setConnectOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  // Scenario panel mode — null when closed, { kind: "new" } when
  // composing against a snapshot, { kind: "detail" } when viewing an
  // existing scenario.
  const [scenarioMode, setScenarioMode] = useState<
    | null
    | { kind: "new"; snapshotId: string }
    | { kind: "detail"; scenarioId: string }
  >(null);

  const handleNewScenario = useCallback((snapshotId: string) => {
    setScenarioMode({ kind: "new", snapshotId });
  }, []);
  const handleOpenScenario = useCallback((scenarioId: string) => {
    setScenarioMode({ kind: "detail", scenarioId });
  }, []);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-white">
      <InteraxisCanvas space={space} entities={entities} edges={edges} />

      {/* Fresh-run splash — bridges the visual gap from "submit prompt"
          → "first entity paints". Only shows when `?run=` is present
          AND no entities exist yet. Auto-fades after a short window
          regardless, so it never blocks an active canvas. */}
      <WhiteboardBootstrapSplash
        runId={runIdFromQuery}
        existingEntityCount={entities.length}
      />

      {/* R5 Phase A — Snapshots launcher, stacked above Connect so
          both bottom-right anchors have clear hit targets. */}
      <button
        onClick={() => setSnapshotsOpen(true)}
        className="fixed bottom-20 right-6 z-50 flex items-center gap-1.5 rounded-full border border-gray-200/70 bg-white/95 px-3.5 py-2 text-[12px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:bg-white hover:shadow-md"
        title="Snapshots & scenarios — freeze the KG and test interventions against it"
      >
        <Camera className="h-3.5 w-3.5 text-blue-600" />
        Snapshots
      </button>

      {/* Connect launcher — bottom-right floating button. Opens the
          weave + bridges side panel for this whiteboard. */}
      <button
        onClick={() => setConnectOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 px-4 py-2.5 text-[12px] font-semibold text-white shadow-lg transition-all hover:-translate-y-px hover:shadow-xl"
        title="Connect this whiteboard to others (weave + bridges)"
      >
        <GitBranch className="h-3.5 w-3.5" />
        Connect
      </button>

      <ConnectPanel
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        currentSpaceId={space.id}
        currentSpaceName={space.name ?? "Whiteboard"}
      />

      <CanvasSnapshotsDrawer
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        spaceId={space.id}
        onNewScenario={handleNewScenario}
        onOpenScenario={handleOpenScenario}
      />

      {scenarioMode && (
        <CanvasScenarioPanel
          open
          onClose={() => setScenarioMode(null)}
          spaceId={space.id}
          mode={scenarioMode}
        />
      )}
    </div>
  );
}
