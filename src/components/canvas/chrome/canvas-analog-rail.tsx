// ── Canvas analog rail (Phase 2H) ──
//
// Left-side overlay that subscribes to the SSE event stream and
// renders one CanvasAnalogCard per `structural_analog_found` event.
// Parallel to CanvasProposalRings (right side, proposal cards) —
// same pattern: subscribe, dedupe, auto-hide after the run
// completes, show top-N ordered by similarity.
//
// De-duplication key: signatureId. A single run can produce one
// structural match AND one blended match against the same target
// signature; we keep the stronger similarity and drop the other.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStructuralEventStream } from "../hooks/use-structural-event-stream";
import { CanvasAnalogCard } from "./canvas-analog-card";
import type { StructuralAnalogFoundEvent } from "@/types/pipeline-events";

export interface CanvasAnalogRailProps {
  runId: string | null;
}

const MAX_VISIBLE = 4;
const HIDE_AFTER_COMPLETE_MS = 60_000;

interface AnalogCard extends StructuralAnalogFoundEvent {
  sequence: number;
}

export function CanvasAnalogRail({ runId }: CanvasAnalogRailProps) {
  const { events, status } = useStructuralEventStream(runId);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hiddenAfterComplete, setHiddenAfterComplete] = useState(false);

  const analogs = useMemo<AnalogCard[]>(() => {
    const bySig = new Map<string, AnalogCard>();
    for (const s of events) {
      if (s.event.type !== "structural_analog_found") continue;
      const existing = bySig.get(s.event.signatureId);
      if (!existing || s.event.similarity > existing.similarity) {
        bySig.set(s.event.signatureId, {
          ...s.event,
          sequence: s.sequence,
        });
      }
    }
    return Array.from(bySig.values())
      .sort((a, b) => b.similarity - a.similarity)
      .filter((a) => !dismissed.has(a.signatureId));
  }, [events, dismissed]);

  useEffect(() => {
    if (status !== "completed" && status !== "failed" && status !== "timeout") {
      setHiddenAfterComplete(false);
      return;
    }
    const timer = setTimeout(
      () => setHiddenAfterComplete(true),
      HIDE_AFTER_COMPLETE_MS,
    );
    return () => clearTimeout(timer);
  }, [status]);

  if (!runId) return null;
  if (analogs.length === 0) return null;
  if (hiddenAfterComplete) return null;

  const visible = analogs.slice(0, MAX_VISIBLE);

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute left-4 top-20 z-30 flex w-[320px] flex-col gap-2",
      )}
      aria-label="Cross-domain structural analogs"
    >
      <header className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 shadow-sm ring-1 ring-violet-200/60 backdrop-blur">
        <Sparkles className="h-3 w-3 text-violet-600" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gray-500">
          Structural analogs
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-400 tabular-nums">
          {visible.length}/{analogs.length}
        </span>
      </header>

      {visible.map((a) => (
        <CanvasAnalogCard
          key={a.signatureId}
          headline={a.headline}
          insight={a.insight}
          confidence={a.confidence}
          similarity={a.similarity}
          isCrossUser={a.isCrossUser}
          mode={a.mode}
          analogSummary={a.analogSummary}
          entityPairings={a.entityPairings}
          onDismiss={() =>
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add(a.signatureId);
              return next;
            })
          }
        />
      ))}
    </aside>
  );
}
