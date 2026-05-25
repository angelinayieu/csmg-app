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
import { SubObjectivePickerCard } from "./sub-objective-picker-card";
import { MainCanvasView, type MainCanvasSub } from "./main-canvas-view";
import type {
  ClarifyingBlock,
  ObjectiveCanvasStage,
} from "@/lib/objective-canvas/clarifying-state";
import type { SubObjectiveBlock } from "@/lib/objective-canvas/sub-objective-state";

interface Props {
  spaceId: string;
  objective: string;
  initialStage: ObjectiveCanvasStage;
  initialClarifying: ClarifyingBlock | null;
  initialSubObjectives: SubObjectiveBlock | null;
  initialMainSubs: MainCanvasSub[];
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
  embedded = false,
  // onExit is reserved for the host's chrome; not consumed here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onExit,
}: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<ObjectiveCanvasStage>(initialStage);

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
            onConfirmed={handlePickerConfirmed}
          />
        )}
        {stage === "main" && (
          <MainCanvasView
            spaceId={spaceId}
            objective={objective}
            subs={initialMainSubs}
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
