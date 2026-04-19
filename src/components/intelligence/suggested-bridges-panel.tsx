"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ArrowRight, Link2, Sparkles } from "lucide-react";
import type { SuggestedBridge } from "@/lib/hooks/use-intelligence-radar";

export function SuggestedBridgesPanel({
  bridges,
  onCreateBridge,
}: {
  bridges: SuggestedBridge[];
  onCreateBridge: (externalEntityId: string, internalEntityId: string) => Promise<void>;
}) {
  const [creating, setCreating] = React.useState<string | null>(null);

  if (bridges.length === 0) return null;

  return (
    <div className="rounded-xl border border-purple-200 bg-white p-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-600">
        <Sparkles className="inline h-3 w-3 mr-1" />
        Suggested Connections ({bridges.length})
      </div>
      <p className="text-[9px] text-gray-500">
        Landscape entities that may connect to your internal model
      </p>
      <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
        {bridges.map((b) => {
          const key = `${b.externalEntity.entity_id}→${b.internalEntity.entity_id}`;
          const isCreating = creating === key;
          return (
            <div key={key} className="rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[9px]">
                    <span className="font-medium text-blue-700 truncate">{b.externalEntity.name}</span>
                    <ArrowRight className="h-2.5 w-2.5 flex-shrink-0 text-gray-400" />
                    <span className="font-medium text-gray-700 truncate">{b.internalEntity.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {b.sharedTerms.slice(0, 4).map((t) => (
                      <span key={t} className="rounded px-1 text-[7px] bg-purple-100 text-purple-600">{t}</span>
                    ))}
                    <span className="text-[7px] text-gray-400 ml-0.5">
                      {Math.round(b.score * 100)}% match
                    </span>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setCreating(key);
                    await onCreateBridge(b.externalEntity.entity_id, b.internalEntity.entity_id);
                    setCreating(null);
                  }}
                  disabled={isCreating}
                  className={cn(
                    "flex items-center gap-0.5 rounded-md px-2 py-1 text-[8px] font-medium border transition-colors flex-shrink-0",
                    isCreating
                      ? "bg-purple-100 text-purple-400 border-purple-200 cursor-wait"
                      : "bg-purple-600 text-white border-purple-600 hover:bg-purple-700"
                  )}
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {isCreating ? "..." : "Bridge"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
