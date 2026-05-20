"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  useOperatingTwinData,
  type OperatingTwinDataInputs,
} from "./hooks/use-operating-twin-data";
import { LeftPanel } from "./panels/left-panel";
import { CenterStage } from "./panels/center-stage";
import { RightPanel } from "./panels/right-panel";
import { InsufficientDataPanel } from "./insufficient-data-panel";
import { BuildModeChooser } from "./build-mode-chooser";
import { SystemProposalModal } from "./system-proposal-modal";
import { InteractiveBuildFlow } from "./interactive-build-flow";
import type { Entity } from "@/types";
import type { LabCard, TwinBuildMode, ApprovalItem } from "@/types/operating-twin";

// ── Props contract ────────────────────────────────────────────────
//
// W4 — the shell is now props-driven. Mount from either:
//   - Legacy TwinSurface (SpaceDataProvider tree): pass useSpaceData
//     fields through as inputs
//   - New Twin Detail Page Operating tab: pass data lazy-fetched
//     from /api/spaces/[id]/operating-twin-context
//
// Optional callbacks let consumers opt-in to entity selection,
// data refresh, and chat-open behaviors. When undefined those
// features no-op gracefully (e.g. the new Twin Detail Page doesn't
// have a NodeDetail slide-out so onSelectEntity stays absent).

export interface OperatingTwinShellProps {
  inputs: OperatingTwinDataInputs;
  onSelectEntity?: (entity: Entity) => void;
  /** Sync or async — useSpaceData.refresh() is sync (router.refresh)
   *  while the new Twin Detail Page passes an async bundle refetch. */
  onRefresh?: () => void | Promise<void>;
  onOpenChat?: () => void;
}

// localStorage keys (per-space)
const storageKey = (spaceId: string, k: string) => `interaxis:operating-twin:${spaceId}:${k}`;

type Stage =
  | "initial"       // first check: show chooser, insufficient panel, or ready
  | "chooser"
  | "insufficient"
  | "proposal"
  | "interactive"
  | "ready";

export function OperatingTwinShell({
  inputs,
  onSelectEntity,
  onRefresh,
  onOpenChat,
}: OperatingTwinShellProps) {
  const ctx = inputs;
  const router = useRouter();
  const model = useOperatingTwinData(inputs);

  // Stage state — authoritative source: `spaces.digital_twin_state`.
  // localStorage is kept as a fallback for the legacy build flow (pre-Phase 2 spaces).
  const [stage, setStage] = useState<Stage>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const twinState = (ctx.space as any)?.digital_twin_state as string | undefined;
    if (twinState === "ready" || twinState === "active") return "ready";
    if (typeof window === "undefined") return "initial";
    const built = window.localStorage.getItem(storageKey(ctx.space.id, "built"));
    if (built === "true") return "ready";
    return "initial";
  });

  // Decide initial stage once model is ready
  useEffect(() => {
    if (stage !== "initial") return;
    if (!model.sufficiency.sufficient) {
      setStage("insufficient");
    } else {
      setStage("chooser");
    }
  }, [stage, model.sufficiency.sufficient]);

  // Listen for post-objective-confirmation event
  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{ spaceId?: string }>;
      if (custom.detail?.spaceId && custom.detail.spaceId !== ctx.space.id) return;
      // Reset build state — re-prompt user
      window.localStorage.removeItem(storageKey(ctx.space.id, "built"));
      if (model.sufficiency.sufficient) {
        setStage("chooser");
      } else {
        setStage("insufficient");
      }
    };
    window.addEventListener("interaxis:objectives-confirmed", handler as EventListener);
    return () =>
      window.removeEventListener("interaxis:objectives-confirmed", handler as EventListener);
  }, [ctx.space.id, model.sufficiency.sufficient]);

  const handleChooserSelect = useCallback((mode: TwinBuildMode) => {
    if (mode === "interactive") setStage("interactive");
    else if (mode === "auto") setStage("proposal");
  }, []);

  const handleBuildComplete = useCallback(
    (_approvedIds: string[]) => {
      window.localStorage.setItem(storageKey(ctx.space.id, "built"), "true");
      setStage("ready");
    },
    [ctx.space.id],
  );

  const handleLabClick = useCallback(
    (lab: LabCard) => {
      if (!onSelectEntity) return; // No-op when consumer hasn't wired entity selection.
      if (lab.primary_entity_id) {
        const entity = ctx.entities.find((e) => e.id === lab.primary_entity_id);
        if (entity) onSelectEntity(entity);
      }
    },
    [ctx.entities, onSelectEntity],
  );

  const handleApprovalClick = useCallback(
    (approval: ApprovalItem) => {
      if (approval.action_url) {
        router.push(approval.action_url);
      }
    },
    [router],
  );

  // Render insufficient-data panel (takes full height)
  if (stage === "insufficient") {
    return (
      <div className="h-full overflow-hidden">
        <InsufficientDataPanel
          sufficiency={model.sufficiency}
          spaceId={ctx.space.id}
          onRefresh={onRefresh}
          onContinueInChat={onOpenChat}
        />
      </div>
    );
  }

  // Main 3-panel layout (rendered always; modals overlay on top)
  return (
    <div className="h-full overflow-hidden p-3 flex flex-col">
      <div
        className="flex-1 grid gap-2.5 min-h-0"
        style={{ gridTemplateColumns: "280px 1fr 300px" }}
      >
        <LeftPanel model={model} onApprovalClick={handleApprovalClick} />
        <CenterStage model={model} onLabClick={handleLabClick} />
        <RightPanel model={model} spaceId={ctx.space.id} />
      </div>

      {/* Modals */}
      {stage === "chooser" && (
        <BuildModeChooser
          labCount={model.labs.length}
          onSelect={handleChooserSelect}
          onClose={() => setStage("ready")}
        />
      )}
      {stage === "proposal" && (
        <SystemProposalModal
          model={model}
          onConfirm={handleBuildComplete}
          onBack={() => setStage("chooser")}
        />
      )}
      {stage === "interactive" && (
        <InteractiveBuildFlow
          model={model}
          onComplete={handleBuildComplete}
          onCancel={() => setStage("chooser")}
        />
      )}
    </div>
  );
}
