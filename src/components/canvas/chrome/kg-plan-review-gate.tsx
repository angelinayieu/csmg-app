"use client";

// ── KG Plan Review Gate ──────────────────────────────────────────
//
// Mount wrapper that:
//   1. Queries for the most recent non-final plan (status in
//      'proposed' | 'edited') for this space.
//   2. Renders <KgPlanReviewCard> as a blocking overlay when one
//      exists.
//   3. Handles approve / reject / re-plan actions and reloads.
//
// Listens for an `interaxis:kg-plan-proposed` window event so the
// card pops up immediately when the user fires propose-plan from
// the bootstrap splash or any other surface (no polling round-trip).
// Also polls every 5s while open so an external proposal (e.g.
// CLI-triggered) appears.
//
// Approval: the card itself calls /approve and on success bubbles
// up via onApproved; this component then dispatches an
// `interaxis:kg-plan-approved` window event so downstream
// orchestration (decompose kickoff, etc.) can listen.

import { useCallback, useEffect, useState } from "react";
import { KgPlanReviewCard } from "./kg-plan-review-card";
import type { KgGenerationPlan } from "@/types/kg-generation-plan";

interface KgPlanReviewGateProps {
  spaceId: string;
  /** Optional initial prompt — used when the user clicks "Re-plan"
   *  to send a fresh /api/pipeline/propose-plan call with the same
   *  prompt + the prior plan as supersedes_id. */
  initialPrompt?: string | null;
}

interface ListResponse {
  plans: KgGenerationPlan[];
}

export function KgPlanReviewGate({
  spaceId,
  initialPrompt,
}: KgPlanReviewGateProps) {
  const [plan, setPlan] = useState<KgGenerationPlan | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLatest = useCallback(async () => {
    try {
      // Ask for the most recent plan; pick the first non-final one.
      // Lightweight query — uses the space-scoped index.
      const res = await fetch(`/api/spaces/${spaceId}/kg-plans?status=open`, {
        credentials: "include",
      });
      if (!res.ok) {
        setPlan(null);
        return;
      }
      const j = (await res.json()) as ListResponse;
      const open = (j.plans ?? []).find(
        (p) => p.status === "proposed" || p.status === "edited",
      );
      setPlan(open ?? null);
    } catch {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch + window-event listener + 5s poll while no plan loaded.
  useEffect(() => {
    fetchLatest();

    function onProposed(e: Event) {
      const detail = (e as CustomEvent<{ spaceId?: string }>).detail;
      if (!detail?.spaceId || detail.spaceId === spaceId) {
        fetchLatest();
      }
    }
    window.addEventListener("interaxis:kg-plan-proposed", onProposed);

    // Soft poll while no plan is open — picks up async proposals.
    const interval = setInterval(() => {
      if (!plan) fetchLatest();
    }, 5000);

    return () => {
      window.removeEventListener("interaxis:kg-plan-proposed", onProposed);
      clearInterval(interval);
    };
  }, [spaceId, fetchLatest, plan]);

  const handleApproved = useCallback(
    (approved: KgGenerationPlan) => {
      window.dispatchEvent(
        new CustomEvent("interaxis:kg-plan-approved", {
          detail: { spaceId, planId: approved.id },
        }),
      );
      // Invalidate the per-space layer-ontology cache so KGNodeShape
      // picks up the freshly-materialized layer rows on the next
      // render. Without this, painted nodes stay on the legacy
      // LAYERS[layer].color until the user reloads the page.
      window.dispatchEvent(
        new CustomEvent("interaxis:layer-ontology-materialized", {
          detail: { spaceId, planId: approved.id },
        }),
      );
      setPlan(null);
    },
    [spaceId],
  );

  const handleRejected = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("interaxis:kg-plan-rejected", { detail: { spaceId } }),
    );
    setPlan(null);
  }, [spaceId]);

  const handleReplan = useCallback(async () => {
    if (!plan) return;
    try {
      const res = await fetch(`/api/pipeline/propose-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          space_id: spaceId,
          prompt: initialPrompt ?? plan.scope_and_objectives?.goal_verbatim ?? "",
          mode: plan.mode,
          superseded_plan_id: plan.id,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { plan: KgGenerationPlan };
        setPlan(j.plan);
      }
    } catch (e) {
      console.warn("[kg-plan-gate] re-plan failed:", e);
    }
  }, [plan, spaceId, initialPrompt]);

  if (loading) return null;
  if (!plan) return null;

  return (
    <KgPlanReviewCard
      plan={plan}
      spaceId={spaceId}
      onApproved={handleApproved}
      onRejected={handleRejected}
      onReplan={handleReplan}
    />
  );
}
