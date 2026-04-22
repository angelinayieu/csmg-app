"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { InterventionStatusCard } from "@/components/interventions/intervention-status-card";

/**
 * Wave D L2.1 — client wrapper for the Goal detail page's interventions
 * list. The server component serializes the initial list; this wrapper
 * owns the optimistic-removal state when a user completes or abandons
 * an intervention, so the card animates away cleanly without a full
 * page refresh.
 *
 * visionOS-style motion: AnimatePresence + layout animations on the
 * list container mean cards morph into their resolved state, then
 * exit-animate out, with the list below sliding up to fill. Feels
 * physical without being showy.
 */

interface Intervention {
  id: string;
  app_id: string | null;
  title: string;
  description: string | null;
  status: "proposed" | "active" | "completed" | "superseded" | "abandoned";
  priority: number | null;
  effort: string | null;
  impact: string | null;
  timeframe: string | null;
  metric_name: string | null;
  metric_target: string | null;
}

export function GoalDetailClient({
  interventions,
}: {
  interventions: Intervention[];
}) {
  const [liveInterventions, setLiveInterventions] = useState(interventions);

  function handleResolved({
    id,
    new_status,
  }: {
    id: string;
    new_status: "completed" | "abandoned";
    app_health_after: number | null;
  }) {
    // Keep the resolved card visible briefly (~1s) in its collapsed
    // variant so the user sees the state change, then remove it from
    // the active list. This mimics the visionOS "settle then fade"
    // pattern.
    setLiveInterventions((prev) =>
      prev.map((iv) =>
        iv.id === id ? { ...iv, status: new_status } : iv,
      ),
    );
    setTimeout(() => {
      setLiveInterventions((prev) => prev.filter((iv) => iv.id !== id));
    }, 1200);
  }

  return (
    <div className="mt-3 space-y-2">
      <AnimatePresence mode="popLayout">
        {liveInterventions.map((iv) => (
          <InterventionStatusCard
            key={iv.id}
            intervention={iv}
            onResolved={handleResolved}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
