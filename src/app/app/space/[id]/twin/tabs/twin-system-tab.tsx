"use client";

// ── System tab ──────────────────────────────────────────────────────
//
// The "how does this work" lens. Same underlying data, three lenses:
//
//   - Workflow    → user-time order (existing DigitalTwinFlowchart)
//   - Layers      → stack by abstraction level (closest-to-user → root)
//   - Mechanisms  → what's actively transforming the system
//
// Workflow data is lazy — we don't bundle entities/edges/cycles into
// the page cache, so the first time this tab activates we kick a
// fetch. Subsequent view-mode switches are instant.
//
// All three views share the same data envelope; only the projection
// changes.

import { useEffect, useState } from "react";
import { TwinViewModeToggle, type SystemViewMode } from "../parts/twin-view-mode-toggle";
import { TwinWorkflowView } from "../views/twin-workflow-view";
import { TwinLayerStackView } from "../views/twin-layer-stack-view";
import { TwinMechanismGridView } from "../views/twin-mechanism-grid-view";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";
import type { TwinWorkflowData } from "@/app/api/spaces/[id]/twin-workflow-data/route";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
}

export function TwinSystemTab({ spaceId, bundle }: Props) {
  const [mode, setMode] = useState<SystemViewMode>("workflow");
  const [workflowData, setWorkflowData] = useState<TwinWorkflowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load workflow data on first activation. Re-fetches when the
  // space id changes (drilling between spaces from a shared shell).
  useEffect(() => {
    if (workflowData) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/spaces/${spaceId}/twin-workflow-data`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: TwinWorkflowData };
        if (cancelled) return;
        setWorkflowData(json.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spaceId, workflowData]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            System
          </div>
          <h2 className="mt-1 font-display-tight text-[22px] font-semibold leading-tight text-gray-900">
            {viewModeTitle(mode)}
          </h2>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-gray-500">
            {viewModeSubtitle(mode)}
          </p>
        </div>
        <TwinViewModeToggle value={mode} onChange={setMode} />
      </div>

      {loading && !workflowData && <SystemTabSkeleton />}

      {error && !workflowData && (
        <div
          className="rounded-2xl px-6 py-5 text-[13px] text-gray-600"
          style={{
            background: "var(--glass-card-bg)",
            boxShadow: "var(--shadow-card)",
            backdropFilter: "blur(var(--blur-card))",
            WebkitBackdropFilter: "blur(var(--blur-card))",
          }}
        >
          Couldn&apos;t load the system data: {error}. Try refreshing the page.
        </div>
      )}

      {workflowData && mode === "workflow" && (
        <TwinWorkflowView workflowData={workflowData} />
      )}
      {workflowData && mode === "layers" && (
        <TwinLayerStackView
          workflowData={workflowData}
          layerOntology={bundle.layer_ontology}
        />
      )}
      {workflowData && mode === "mechanisms" && (
        <TwinMechanismGridView
          spaceId={spaceId}
          mechanisms={bundle.mechanisms}
          layerOntology={bundle.layer_ontology}
        />
      )}
    </div>
  );
}

// ── Copy helpers ──────────────────────────────────────────────────

function viewModeTitle(mode: SystemViewMode): string {
  switch (mode) {
    case "workflow":
      return "Your workflow, as the twin sees it";
    case "layers":
      return "The stack, from surface to root";
    case "mechanisms":
      return "What's transforming the system";
  }
}

function viewModeSubtitle(mode: SystemViewMode): string {
  switch (mode) {
    case "workflow":
      return "Stages in the order you experience them, with feedback loops and the variables you touch at each step.";
    case "layers":
      return "Same entities, regrouped by abstraction — concrete artifacts on top, deeper structural concepts below.";
    case "mechanisms":
      return "Active mechanisms (simulation, prediction, baseline tracking, …) and the apps materialized from each one.";
  }
}

// ── Skeleton ──────────────────────────────────────────────────────

function SystemTabSkeleton() {
  return (
    <div
      className="h-[420px] animate-pulse rounded-2xl"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    />
  );
}
