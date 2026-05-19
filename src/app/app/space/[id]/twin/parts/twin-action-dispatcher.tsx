"use client";

// ── Twin action dispatcher ─────────────────────────────────────────
//
// Single root-level component mounted by TwinDetailClient. Owns:
//
//   - All four dialogs (LogObservation, RunPrediction, ConfirmAction)
//   - Window-event listener for `twin:coach-action`
//   - The imperative API used by TwinActionsMenu (via context)
//
// Phase 2 W1: every Coach action_type + every TwinActionsMenu item
// routes through this dispatcher. The dispatcher decides whether to
// open a dialog, fire an endpoint inline, or route to another page.
//
// Action map (matches CoachActionType + extra page-header items):
//
//   log_observation       → opens LogObservationDialog
//   run_prediction        → opens RunPredictionDialog
//   take_snapshot         → POST snapshots, toast confirmation
//   build_app             → ConfirmActionDialog → POST generate-apps
//   build_viz_app         → routes to canvas with build=viz flag
//   review_proposal       → routes to canvas anchor (twin-proposal-card)
//   regenerate_strategy   → ConfirmActionDialog → POST synthesize, toast
//   do_nothing            → no-op (dispatcher doesn't render anything)
//
// Build_app and review_proposal route to the canvas instead of
// embedding their flows inline because (a) build_app kicks off a
// long-running pipeline whose progress lives on canvas, and (b) the
// proposal review surface already exists as a canvas card with rich
// diff visualization. Phase 3 may inline these.

import { useCallback, useEffect, useState, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/hooks/use-toast";
import { LogObservationDialog } from "./dialogs/log-observation-dialog";
import { RunPredictionDialog } from "./dialogs/run-prediction-dialog";
import { ConfirmActionDialog } from "./dialogs/confirm-action-dialog";
import type { CoachActionType } from "@/lib/twin/agents/coach-agent";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface CoachActionDetail {
  action_type: string;
  target_id: string | null;
}

interface DispatcherProps {
  spaceId: string;
  /** Called whenever an action mutates server state so the page can
   *  refetch the bundle. The dispatcher invokes it after every
   *  successful action. */
  onBundleInvalidated?: () => void;
  children: React.ReactNode;
}

// ── Context — TwinActionsMenu opens dialogs via this ──────────────

interface TwinActionContextValue {
  openLogObservation: () => void;
  openRunPrediction: () => void;
  takeSnapshot: () => Promise<void>;
  buildVizApp: () => void;
  /** Map a Coach action_type to a dispatched action. Used by the
   *  Coach action dispatcher; exposed so the page-header menu can
   *  reuse the same path for the actions that overlap. */
  dispatch: (action: CoachActionDetail) => Promise<void> | void;
}

const TwinActionContext = createContext<TwinActionContextValue | null>(null);

export function useTwinActions(): TwinActionContextValue {
  const ctx = useContext(TwinActionContext);
  if (!ctx) {
    throw new Error("useTwinActions must be used within TwinActionDispatcher");
  }
  return ctx;
}

// ── Dispatcher root ───────────────────────────────────────────────

export function TwinActionDispatcher({
  spaceId,
  onBundleInvalidated,
  children,
}: DispatcherProps) {
  const router = useRouter();
  const [obsOpen, setObsOpen] = useState(false);
  const [predOpen, setPredOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: "regenerate" | "build_app";
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // ── Inline action implementations ────────────────────────────────

  const takeSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "user_request" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        snapshotId?: string;
        entity_count?: number;
        edge_count?: number;
      };
      toast.success("Snapshot captured", {
        description:
          json.entity_count !== undefined
            ? `${json.entity_count} entities · ${json.edge_count ?? 0} edges`
            : "Twin state captured for comparison.",
      });
      // Notify the Outcomes-tab snapshot card so it refreshes its
      // "Last captured" card without a full bundle refetch.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("twin:snapshot-captured"));
      }
      onBundleInvalidated?.();
    } catch (err) {
      console.warn("[dispatcher] snapshot failed:", err);
      toast.error("Couldn't capture snapshot", {
        description:
          err instanceof Error ? err.message : "Try again in a moment.",
      });
    }
  }, [spaceId, onBundleInvalidated]);

  const runBuildApp = useCallback(async () => {
    const res = await fetch(`/api/pipeline/generate-apps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceId,
        triggeredBy: "twin_detail_page",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      apps_created?: number;
      apps_updated?: number;
    };
    toast.success("App generation started", {
      description:
        json.apps_created || json.apps_updated
          ? `${json.apps_created ?? 0} new · ${json.apps_updated ?? 0} updated`
          : "Pipeline run kicked off.",
    });
    onBundleInvalidated?.();
  }, [spaceId, onBundleInvalidated]);

  const runRegenerate = useCallback(async () => {
    const res = await fetch(`/api/pipeline/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spaceIds: [spaceId],
        force: true,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast.success("Strategy regeneration started", {
      description: "Synthesis is running — check back in a minute.",
    });
    onBundleInvalidated?.();
  }, [spaceId, onBundleInvalidated]);

  const openConfirmBuild = useCallback(() => {
    setConfirm({
      kind: "build_app",
      title: "Build apps from this twin?",
      description:
        "Kicks off the app-generation pipeline. Existing apps may be updated and new ones created based on current twin state. This is non-destructive.",
      confirmLabel: "Start build",
      onConfirm: runBuildApp,
    });
  }, [runBuildApp]);

  const openConfirmRegenerate = useCallback(() => {
    setConfirm({
      kind: "regenerate",
      title: "Regenerate strategy?",
      description:
        "Re-runs the full synthesis pipeline. Existing entities and mechanisms stay, but the strategic recommendation will be replaced. Allow ~1–2 min.",
      confirmLabel: "Regenerate",
      onConfirm: runRegenerate,
    });
  }, [runRegenerate]);

  const buildVizApp = useCallback(() => {
    // Visualization apps are scaffolded via the canvas builder UI.
    // Phase 2 routes the user there with a query flag the canvas
    // reads to open the viz-app preset.
    router.push(`/app/space/${spaceId}/whiteboard?build=viz_app`);
  }, [router, spaceId]);

  // ── Master dispatch ──────────────────────────────────────────────

  const dispatch = useCallback(
    async (action: CoachActionDetail) => {
      const t = action.action_type as CoachActionType | "build_viz_app";
      switch (t) {
        case "log_observation":
          setObsOpen(true);
          return;
        case "run_prediction":
          setPredOpen(true);
          return;
        case "take_snapshot":
          await takeSnapshot();
          return;
        case "build_app":
          openConfirmBuild();
          return;
        case "build_viz_app":
          buildVizApp();
          return;
        case "review_proposal":
          // Canvas has the proposal-card with rich diff. Route there
          // with the target_id so the canvas can scroll/select it.
          if (action.target_id) {
            router.push(
              `/app/space/${spaceId}/whiteboard?reveal=twin_proposal&proposalId=${action.target_id}`,
            );
          } else {
            router.push(
              `/app/space/${spaceId}/whiteboard?reveal=twin_proposal`,
            );
          }
          return;
        case "regenerate_strategy":
          openConfirmRegenerate();
          return;
        case "do_nothing":
          // Coach said no action needed. Nothing to dispatch.
          return;
        default:
          console.warn("[dispatcher] unknown action_type:", action.action_type);
      }
    },
    [
      takeSnapshot,
      openConfirmBuild,
      openConfirmRegenerate,
      buildVizApp,
      router,
      spaceId,
    ],
  );

  // ── Window event bridge — TwinCoachCard fires through here ──────

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CoachActionDetail>).detail;
      if (!detail) return;
      void dispatch(detail);
    };
    window.addEventListener("twin:coach-action", handler);
    return () => window.removeEventListener("twin:coach-action", handler);
  }, [dispatch]);

  // ── Context value for TwinActionsMenu ───────────────────────────

  const value: TwinActionContextValue = {
    openLogObservation: () => setObsOpen(true),
    openRunPrediction: () => setPredOpen(true),
    takeSnapshot,
    buildVizApp,
    dispatch,
  };

  return (
    <TwinActionContext.Provider value={value}>
      {children}

      <LogObservationDialog
        spaceId={spaceId}
        open={obsOpen}
        onClose={() => setObsOpen(false)}
        onSubmitted={() => {
          toast.success("Observation logged", {
            description: "The twin's checking it against open predictions.",
          });
          onBundleInvalidated?.();
        }}
      />

      <RunPredictionDialog
        spaceId={spaceId}
        open={predOpen}
        onClose={() => setPredOpen(false)}
        onSubmitted={() => {
          toast.success("Prediction recorded", {
            description: "We'll auto-resolve against your next matching observation.",
          });
          onBundleInvalidated?.();
        }}
      />

      <ConfirmActionDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        loadingLabel="Starting…"
        tone={confirm?.kind === "regenerate" ? "destructive" : "primary"}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await confirm.onConfirm();
          } catch (err) {
            toast.error("Couldn't start", {
              description:
                err instanceof Error ? err.message : "Try again in a moment.",
            });
            throw err;
          }
        }}
      />
    </TwinActionContext.Provider>
  );
}
