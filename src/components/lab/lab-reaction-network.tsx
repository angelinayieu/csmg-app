"use client";

import { useMemo } from "react";
import type { Entity } from "@/types";
import type { Reaction } from "@/types/reactions";
import { ReactionHoverPreview } from "@/components/shared/reaction-preview";

export interface LabReactionNetworkProps {
  focal: Entity;
  reactions: Reaction[];
  entitiesByUuid: Map<string, Entity>;
  focusedReactionId: string | null;
  onFocusReaction: (id: string | null) => void;
}

const NOVELTY_ACCENT: Record<string, string> = {
  emergent: "#10b981",
  reinforcing: "#3b82f6",
  tension: "#ef4444",
  trivial: "#64748b",
};

function participantSymbol(e: Entity | undefined, i: number): string {
  if (!e) return String.fromCharCode(65 + i);
  const words = e.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function LabReactionNetwork({
  focal,
  reactions,
  entitiesByUuid,
  focusedReactionId,
  onFocusReaction,
}: LabReactionNetworkProps) {
  const enriched = useMemo(
    () =>
      reactions.map((r) => ({
        reaction: r,
        participants: r.entity_ids.map((id) => entitiesByUuid.get(id) ?? null),
      })),
    [reactions, entitiesByUuid],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#10161f] px-3.5 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
            ⚗ Reaction Network
          </span>
          <span className="font-mono text-[9px] text-[#475569]">{reactions.length}</span>
        </div>
        <span className="text-[8px] tracking-wide text-[#475569]">
          CLICK TO FOCUS · PROBABILITY · TYPE
        </span>
      </div>

      {enriched.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-[3px] border border-dashed border-[#94a3b8]/[0.08] bg-[#141b26]">
          <div className="text-center">
            <div className="text-[11px] text-[#a8b3c4]">No saved reactions yet.</div>
            <div className="mt-1 text-[9.5px] text-[#475569]">
              Combine this entity with others on the canvas and hit{" "}
              <span className="font-semibold text-[#a8b3c4]">Save as Reaction</span>.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {enriched.map(({ reaction: r, participants }) => {
            const accent = NOVELTY_ACCENT[r.reaction_type] ?? "#64748b";
            const focused = focusedReactionId === r.id;
            const focalPosition = r.entity_ids.indexOf(focal.id);
            return (
              <ReactionHoverPreview
                key={r.id}
                reaction={r}
                participants={participants}
                focalEntityId={focal.id}
              >
              <button
                onClick={() =>
                  onFocusReaction(focusedReactionId === r.id ? null : r.id)
                }
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[2px] border-l-2 border-[#94a3b8]/[0.08] bg-[#141b26] px-3 py-2 text-left transition-colors hover:bg-[#1a222e]"
                style={{
                  borderLeftColor: accent,
                  borderLeftWidth: focused ? 3 : 2,
                  background: focused ? "#1a222e" : "#141b26",
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-tight">
                    {r.entity_ids.map((eid, i) => {
                      const p = participants[i];
                      const isFocal = i === focalPosition;
                      return (
                        <span key={`${r.id}-${eid}`} className="flex items-center">
                          <span
                            className={
                              isFocal
                                ? "rounded-sm bg-[#4ade80]/10 px-1 font-semibold text-[#4ade80]"
                                : "text-[#a8b3c4]"
                            }
                          >
                            {participantSymbol(p ?? undefined, i)}
                          </span>
                          {i < r.entity_ids.length - 1 && (
                            <span className="mx-1 text-[#475569]">+</span>
                          )}
                        </span>
                      );
                    })}
                    <span className="mx-2 text-[#475569]">⟶</span>
                    <span
                      className="truncate text-[11px] font-semibold"
                      style={{ color: "#e8edf4" }}
                    >
                      {r.name}
                    </span>
                  </div>
                  {r.implication && (
                    <div className="mt-0.5 truncate text-[9.5px] text-[#a8b3c4]">
                      {r.implication}
                    </div>
                  )}
                </div>
                <div
                  className="rounded-[1px] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-widest"
                  style={{
                    background: `${accent}15`,
                    color: accent,
                  }}
                >
                  {r.reaction_type}
                </div>
                <div
                  className="min-w-[42px] text-right font-mono text-[12px] font-semibold tabular-nums"
                  style={{
                    color: accent,
                  }}
                >
                  {Math.round(r.probability * 100)}%
                </div>
              </button>
              </ReactionHoverPreview>
            );
          })}
        </div>
      )}
    </div>
  );
}
