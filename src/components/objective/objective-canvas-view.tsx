"use client";

// ── Objective Canvas View ──
//
// Client orchestrator for the /app/objective/[spaceId] route. Drives
// the staged UI based on synthesis_data.objective_canvas.stage:
//
//   clarifying  → <ClarifyingQuestionsCard />
//   picking     → <SubObjectivePickerCard />
//   main        → <MainCanvasView /> (core + sub-fork)
//   done        → archived / read-only summary (future)
//
// The page server-renders the initial state (saves an RTT on first
// paint), then this client component owns transitions.
//
// ── Integration contract (Phase 10) ────────────────────────────────
//
// This component is designed to be embeddable inside the existing
// 3-panel layout's middle panel. To embed:
//
//   1. The PARENT must load the same server-side state shape this
//      component expects (spaceId, objective, initialStage,
//      initialClarifying, initialSubObjectives, initialMainSubs,
//      pipelineMode). See app/app/objective/[spaceId]/page.tsx for a
//      reference implementation.
//
//   2. Set `embedded={true}` to:
//        - drop the persistent Working-objective banner (the parent
//          panel typically renders its own context header)
//        - constrain the inner content width to the host instead of
//          the standalone 2xl max
//
//   3. Provide `onExit?` to handle the user's "Back" gesture when
//      embedded — e.g., closing the panel.
//
//   4. Tab nav + mode pill are NOT rendered by this component; the
//      standalone /app/objective/[spaceId] page mounts them as
//      siblings. When embedded, the host owns those chrome surfaces.
//
//   5. Clicking a sub-objective card on the "main" stage navigates
//      to /app/objective/[spaceId]/sub/[subId] (full-route room).
//      The host must support same-window navigation OR override the
//      sub-card link by extending MainCanvasView in a future pass.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { ClarifyingQuestionsCard } from "./clarifying-questions-card";
import { ResearchIndicator } from "./research-indicator";
import { ResearchSourcesSheet } from "./research-sources-sheet";
import { SubObjectivePickerCard } from "./sub-objective-picker-card";
import { MainCanvasView, type MainCanvasSub } from "./main-canvas-view";
import type { ObjectiveAnnotation } from "./annotated-objective-card";
import type {
  ClarifyingBlock,
  ObjectiveCanvasStage,
} from "@/lib/objective-canvas/clarifying-state";
import type {
  SubObjectiveBlock,
  SubObjectiveIntent,
} from "@/lib/objective-canvas/sub-objective-state";
import type { CrossRoomSignals } from "@/lib/objective-canvas/cross-room-signals";
import type { IntentPreference } from "@/lib/objective-canvas/decision-log";

interface Props {
  spaceId: string;
  objective: string;
  initialStage: ObjectiveCanvasStage;
  initialClarifying: ClarifyingBlock | null;
  initialSubObjectives: SubObjectiveBlock | null;
  initialMainSubs: MainCanvasSub[];
  /** Server-rendered annotations on the core objective text. Empty
   *  array = not yet generated; the annotated card lazy-fetches on
   *  first paint. */
  initialCoreAnnotations: ObjectiveAnnotation[];
  /** Variant Lab — user's revealed top-preferred intent (from the
   *  decision log). Null when the user has no history yet. Passed
   *  through to the picker as the "Suggested" affordance fallback
   *  when no lens gap exists. */
  initialPreferredIntent?: SubObjectiveIntent | null;
  /** Where the suggested intent came from. Drives the picker's
   *  source-label so the user understands WHY the suggestion. */
  initialPreferenceSource?: "user" | "global" | "none";
  /** Per-intent breakdown for the retrospective panel — lets the
   *  user see what the system has learned about their pattern. */
  initialUserPrefs?: IntentPreference[];
  /** Cross-room signals — server-computed from the entities + edges
   *  across the space's rooms. Null when fewer than 2 sub-objectives
   *  exist. The MainCanvasView strip renders nothing when no signals
   *  cross ≥2 rooms. */
  initialCrossRoomSignals?: CrossRoomSignals | null;
  /** Sub-objective theme analysis — server-hydrated when the user
   *  has previously run "Detect themes" on the canvas. Drives the
   *  row-per-theme gallery on MainCanvasView. Type is lazy-imported
   *  to keep this file's deps small. */
  initialSubObjectiveThemes?:
    | import("@/lib/objective-canvas/cluster-proposals").ClusterAnalysis
    | null;
  /** Phase 10 integration contract — host wants to drop this into a
   *  panel. See module header. Defaults to false (standalone). */
  embedded?: boolean;
  /** Optional close handler the host can wire when embedded. The
   *  view never calls this on its own — the host hooks it to chrome
   *  it controls (e.g., a panel close button). */
  onExit?: () => void;
}

export function ObjectiveCanvasView({
  spaceId,
  objective,
  initialStage,
  initialClarifying,
  initialSubObjectives,
  initialMainSubs,
  initialCoreAnnotations,
  initialPreferredIntent = null,
  initialPreferenceSource = "none",
  initialUserPrefs = [],
  initialCrossRoomSignals = null,
  initialSubObjectiveThemes = null,
  embedded = false,
  // onExit is reserved for the host's chrome; not consumed here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onExit,
}: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<ObjectiveCanvasStage>(initialStage);
  // Research sources sheet — opened by clicking the indicator.
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // When the picker confirms, the server inserts the chosen
  // improvement_goals rows and advances the canvas stage. The
  // current page's `initialMainSubs` was server-rendered BEFORE
  // those rows existed, so we trigger a router refresh on the
  // transition. Avoids the brief "no sub-objectives picked yet"
  // flash that would otherwise happen for the immediate hop.
  function handlePickerConfirmed() {
    setStage("main");
    router.refresh();
  }

  // The objective banner is useful while the user is still
  // refining (clarifying / picking) — they need a reminder of
  // what they typed. On "main" the CoreNode IS the visual
  // representation of the objective, so the banner becomes
  // redundant duplication. Hide it there.
  const showBanner =
    !embedded && (stage === "clarifying" || stage === "picking");

  return (
    <div className="relative w-full" style={{ fontFamily: appleVibe.font.stack }}>
      {showBanner && <ObjectiveBanner objective={objective} />}

      {/* Research indicator — visible during clarifying + picking
          stages so the user sees the background work happen. Hidden
          on main + done (the room view has its own indicators).
          Clicking the indicator opens the sources sheet so the user
          can audit what the AI is reading. */}
      {(stage === "clarifying" || stage === "picking") && !embedded && (
        <div className="mt-3 flex justify-center">
          <ResearchIndicator
            spaceId={spaceId}
            showDeep={stage === "picking"}
            onOpenSources={() => setSourcesOpen(true)}
          />
        </div>
      )}

      {/* Sources sheet — slide-in from right. Always mounted so the
          AnimatePresence in/out transitions render correctly. */}
      {!embedded && (
        <ResearchSourcesSheet
          spaceId={spaceId}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        />
      )}

      <div className={showBanner ? "mt-6" : ""}>
        {stage === "clarifying" && (
          <ClarifyingQuestionsCard
            spaceId={spaceId}
            initial={initialClarifying}
            onComplete={() => setStage("picking")}
          />
        )}

        {stage === "picking" && (
          <SubObjectivePickerCard
            spaceId={spaceId}
            initial={initialSubObjectives}
            annotations={initialCoreAnnotations}
            preferredIntent={initialPreferredIntent}
            preferenceSource={initialPreferenceSource}
            userPrefs={initialUserPrefs}
            onConfirmed={handlePickerConfirmed}
          />
        )}
        {stage === "main" && (
          <MainCanvasView
            coreAnnotations={initialCoreAnnotations}
            spaceId={spaceId}
            objective={objective}
            subs={initialMainSubs}
            preferredIntent={initialPreferredIntent}
            crossRoomSignals={initialCrossRoomSignals}
            initialSubObjectiveThemes={initialSubObjectiveThemes}
          />
        )}
        {stage === "done" && <DonePlaceholder />}
      </div>
    </div>
  );
}

function ObjectiveBanner({ objective }: { objective: string }) {
  return (
    <div
      className="mx-auto max-w-2xl rounded-2xl px-5 py-4"
      style={{
        background: appleVibe.surface.cardElevated,
        border: `1px solid ${appleVibe.stroke.hairline}`,
        borderRadius: appleVibe.radius.lg,
      }}
    >
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        Working objective
      </div>
      <p
        className="mt-1.5 text-[14.5px] leading-snug"
        style={{ color: appleVibe.text.primary }}
      >
        {objective}
      </p>
    </div>
  );
}

function DonePlaceholder() {
  return (
    <Placeholder
      title="Done"
      body="The flow has wrapped up. (Read-only summary lives here in a future phase.)"
    />
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="mx-auto max-w-2xl rounded-3xl p-8 text-center"
      style={{
        background: appleVibe.surface.card,
        border: `1px dashed ${appleVibe.stroke.medium}`,
        borderRadius: appleVibe.radius.xl,
      }}
    >
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: appleVibe.text.tertiary }}
      >
        Up next
      </div>
      <h3
        className="mt-1.5 text-[18px] font-semibold tracking-tight"
        style={{ color: appleVibe.text.primary }}
      >
        {title}
      </h3>
      <p
        className="mx-auto mt-2 max-w-md text-[13px] font-light leading-snug"
        style={{ color: appleVibe.text.secondary }}
      >
        {body}
      </p>
    </div>
  );
}
