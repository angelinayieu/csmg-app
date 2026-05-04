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
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, GitBranch, Camera, Activity, Beaker } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { ConnectPanel } from "@/components/whiteboard/connect-panel";
import { CanvasSnapshotsDrawer } from "@/components/canvas/chrome/canvas-snapshots-drawer";
import { CanvasScenarioPanel } from "@/components/canvas/chrome/canvas-scenario-panel";
import { CanvasSituationDrawer } from "@/components/canvas/chrome/canvas-situation-drawer";
import { CanvasEvidenceDrawer } from "@/components/canvas/chrome/canvas-evidence-drawer";
import { WhiteboardBootstrapSplash } from "@/components/canvas/whiteboard-bootstrap-splash";
// Phase 2 — entity-detail drawer. Listens for `shell-graph:focus`
// and `root-cause-tree:focus` window events; hydrates entity from
// /api/entities/[id]/detail and surfaces the canonical signature
// with a Deepen button.
import { CanvasEntityDetailDrawer } from "@/components/canvas/chrome/canvas-entity-detail-drawer";
// Subject phase — surfaces a chip when a `lab_scaffolds` row with
// status='proposed' exists for this space; chip → wizard → approve
// → subjects materialize → navigate to lab.
import { CanvasLabProposalChip } from "@/components/canvas/chrome/canvas-lab-proposal-chip";
// KG Generation Plan gate — blocking overlay surfaced when a plan
// is in 'proposed' or 'edited' state for this space. User must
// approve (or reject + re-plan) before downstream pipeline stages
// run. See src/components/canvas/chrome/kg-plan-review-gate.tsx
// and supabase/migrations/20260614_kg_generation_plans.sql.
import { KgPlanReviewGate } from "@/components/canvas/chrome/kg-plan-review-gate";
// Phase 4 — manual authoring add buttons (+Subject, +Intervention,
// +Variable, +Paper). Gated by spaces.manual_authoring_enabled so
// the default LLM-driven mode stays uncluttered. Bridges to the
// in-canvas spawner via window events for shape creation.
import { CanvasAddButtons } from "@/components/canvas/chrome/canvas-add-buttons";
import { useLayerOntology } from "@/lib/hooks/use-layer-ontology";

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
  const [situationOpen, setSituationOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
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

  // The situation-card shape inside tldraw can't directly call
  // setSituationOpen (it lives in a different React tree). We bridge
  // via a window CustomEvent the shape's double-click handler
  // dispatches; this useEffect listens and toggles the drawer.
  useEffect(() => {
    function onOpenBaseline(e: Event) {
      const detail = (e as CustomEvent<{ spaceId?: string }>).detail;
      if (!detail?.spaceId || detail.spaceId === space.id) {
        setSituationOpen(true);
      }
    }
    window.addEventListener("interaxis:open-situation", onOpenBaseline);
    return () =>
      window.removeEventListener(
        "interaxis:open-situation",
        onOpenBaseline,
      );
  }, [space.id]);

  const handleRerunSituation = useCallback(async () => {
    // Throw on non-2xx so the drawer can surface the failure instead
    // of spinning silently and re-rendering the same NoDataState.
    const res = await fetch(`/api/pipeline/analyze-situation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ space_id: space.id, force: true }),
    });
    if (!res.ok) {
      let detail = `status ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        // body wasn't JSON — keep the status-code fallback
      }
      throw new Error(detail);
    }
  }, [space.id]);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-white">
      <InteraxisCanvas space={space} entities={entities} edges={edges} />

      {/* Phase 2 — entity-detail drawer. Renders nothing until a
          `shell-graph:focus` or `root-cause-tree:focus` window event
          fires; then slides in from the right. */}
      <CanvasEntityDetailDrawer />

      {/* Subject phase — lab proposal chip + wizard. Polls for a
          status='proposed' lab_scaffolds row; when found, surfaces
          a floating chip that opens the wizard. After approval the
          wizard navigates to the lab pre-loaded with the first
          new subject. */}
      <CanvasLabProposalChip spaceId={space.id} />

      {/* KG Generation Plan gate — blocking overlay when a plan is
          in 'proposed' or 'edited' state for this space. The card
          surfaces every silent decision the pipeline would otherwise
          make (custom axes, layer ontology, methodology, research
          plan) for user review/approval. Renders nothing when no
          open plan exists. Listens for `interaxis:kg-plan-proposed`
          window events so it pops up immediately when the bootstrap
          splash fires propose-plan. */}
      <KgPlanReviewGate
        spaceId={space.id}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialPrompt={((space as any).input_text as string | undefined) ?? null}
      />

      {/* Fresh-run splash — bridges the visual gap from "submit prompt"
          → "first entity paints". Only shows when `?run=` is present
          AND no entities exist yet. Auto-fades after a short window
          regardless, so it never blocks an active canvas. */}
      <WhiteboardBootstrapSplash
        runId={runIdFromQuery}
        existingEntityCount={entities.length}
        spaceId={space.id}
        inputText={
          // SSR'd space row stores the original prompt as input_text;
          // pass it through so the Resume CTA can re-fire decompose
          // with the same input the user originally submitted.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((space as any).input_text as string | undefined) ?? undefined
        }
      />

      {/* Phase 4 — manual authoring add buttons. Renders nothing
          unless spaces.manual_authoring_enabled is true (researcher
          opt-in). Bottom-left anchor so it doesn't crowd the
          existing Connect / Snapshots / Baseline / Evidence stack
          on the bottom-right. */}
      <CanvasAddButtonsMount spaceId={space.id} space={space} />

      {/* Baseline launcher — opens the situation drawer. Stacked above
          Snapshots so all three bottom-right anchors are visible. */}
      <button
        onClick={() => setSituationOpen(true)}
        className="fixed bottom-[8.5rem] right-6 z-50 flex items-center gap-1.5 rounded-full border border-gray-200/70 bg-white/95 px-3.5 py-2 text-[12px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:bg-white hover:shadow-md"
        title="Baseline — view the system's analysis of your current state (inputs, process, outputs, knowns, unknowns)"
      >
        <Activity className="h-3.5 w-3.5 text-cyan-600" />
        Baseline
      </button>

      {/* Evidence launcher — opens the evidence_registries drawer
          (rigorous mode). Stacked above Baseline. Surfaces the L2M-
          style effect-size extractions from research artifacts the
          user has attached, with full LLM × parser provenance and
          approve/reject review actions. */}
      <button
        onClick={() => setEvidenceOpen(true)}
        className="fixed bottom-[11rem] right-6 z-50 flex items-center gap-1.5 rounded-full border border-purple-200/70 bg-white/95 px-3.5 py-2 text-[12px] font-semibold text-gray-700 shadow-sm transition-all hover:-translate-y-px hover:bg-white hover:shadow-md"
        title="Evidence registry — review effect sizes extracted from research artifacts (rigorous mode)"
      >
        <Beaker className="h-3.5 w-3.5 text-purple-600" />
        Evidence
      </button>

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

      <CanvasSituationDrawer
        open={situationOpen}
        onClose={() => setSituationOpen(false)}
        spaceId={space.id}
        onRerun={handleRerunSituation}
      />

      <CanvasEvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        spaceId={space.id}
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

// ── Phase 4 — manual authoring add buttons mount ────────────────
//
// Reads spaces.manual_authoring_enabled (off by default, opt-in via
// per-space toggle) and the per-space layer ontology (so the
// +Variable form can offer a layer dropdown). When the flag is
// false this renders nothing — zero UI cost for the LLM-driven
// default mode.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CanvasAddButtonsMount({ spaceId, space }: { spaceId: string; space: any }) {
  const enabled = Boolean(space?.manual_authoring_enabled);
  const { rows: layerOntology } = useLayerOntology(enabled ? spaceId : null);
  return (
    <CanvasAddButtons
      spaceId={spaceId}
      enabled={enabled}
      layerOntology={layerOntology}
    />
  );
}
