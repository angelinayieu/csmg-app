"use client";

import { useEffect } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { SynthesisView } from "@/components/synthesis/synthesis-view";

export default function SynthesisPage() {
  const ctx = useSpaceData();
  const { refreshBridges } = ctx;

  // Live bridges feed — refresh on mount, on window focus, and every 60s
  // so new user-confirmed or ambient-promoted bridges flow into
  // "Cross-Area Connections" without a manual page reload.
  useEffect(() => {
    refreshBridges();
    const interval = window.setInterval(() => {
      if (!document.hidden) refreshBridges();
    }, 60_000);
    function onFocus() {
      refreshBridges();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBridges]);

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to view full analysis
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <SynthesisView
        space={ctx.space}
        entities={ctx.entities}
        cycles={ctx.cycles}
        novelConnections={ctx.novelConnections}
        contradictions={ctx.contradictions}
        scenarios={ctx.scenarios}
        actionItems={ctx.actionItems}
        propositions={ctx.propositions}
        bridges={ctx.bridges}
        domainMap={ctx.domainMap}
        onToggleActionDone={(actionId, done) => {
          fetch(`/api/action-items/${actionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: done ? "completed" : "pending" }),
          }).catch(() => {});
        }}
      />
    </div>
  );
}
