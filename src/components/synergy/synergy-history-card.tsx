// ── History card (right rail) ──
//
// Collapsible card listing every AI suggestion the user has ever
// engaged with (whether they added it to the board or not). Lets
// them re-add a suggestion that disappeared from its bucket because
// it was picked.

"use client";

import { ChevronDown, ChevronRight, History, Plus } from "lucide-react";
import type { HistoryBucket, HistoryItem, NodeKind } from "@/lib/synergy/types";

const BUCKET_LABEL: Record<HistoryBucket, string> = {
  upstream: "Upstream",
  downstream: "Downstream",
  first_principles: "First principles",
  variations: "Variations",
  question: "Question",
  research: "Research",
};

interface Props {
  history: HistoryItem[];
  open: boolean;
  onToggle: () => void;
  onPick: (bucket: HistoryBucket, text: string, kind: NodeKind, meta?: string) => void;
}

export function SynergyHistoryCard({ history, open, onToggle, onPick }: Props) {
  if (history.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-gray-900"
      >
        <span className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-blue-600" />
          History
          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-500">
            {history.length}
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
        )}
      </button>
      {open && (
        <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {[...history]
            .sort((a, b) => b.generatedAt - a.generatedAt)
            .map((h) => (
              <li key={h.id} className="rounded-md border border-gray-200 bg-white p-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-600">
                    {BUCKET_LABEL[h.bucket]}
                  </span>
                  {h.picked ? (
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-emerald-700">
                      on board
                    </span>
                  ) : (
                    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gray-500">
                      available
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-gray-900">
                  {h.text}
                </div>
                <div className="mt-1.5 flex justify-end">
                  <button
                    onClick={() => onPick(h.bucket, h.text, h.kind, h.meta)}
                    title={h.picked ? "Add another copy to the board" : "Add to board"}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 transition hover:border-blue-400 hover:text-gray-900"
                  >
                    <Plus className="h-3 w-3" />
                    {h.picked ? "Re-add" : "Add"}
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
