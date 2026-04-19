"use client";

import { useState } from "react";
import { X, Check } from "lucide-react";
import type { LabCard, OperatingTwinModel } from "@/types/operating-twin";

interface SystemProposalModalProps {
  model: OperatingTwinModel;
  onConfirm: (approvedLabIds: string[]) => void;
  onBack: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  leverage: "Leverage",
  perspective: "Strategy",
  objective: "Objective",
  risk: "Risk",
  bottleneck: "Bottleneck",
  process: "Process",
};

const CATEGORY_COLOR_CLASS: Record<string, string> = {
  leverage: "bg-[var(--accent-50)] text-[var(--accent-700)]",
  perspective: "bg-blue-50 text-blue-700",
  objective: "bg-emerald-50 text-emerald-700",
  risk: "bg-red-50 text-red-700",
  bottleneck: "bg-amber-50 text-amber-700",
  process: "bg-emerald-50 text-emerald-700",
};

export function SystemProposalModal({ model, onConfirm, onBack }: SystemProposalModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(model.labs.map((l) => l.id)),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/30 backdrop-blur-sm">
      <div className="relative w-full max-w-[720px] max-h-[85vh] bg-white rounded-2xl shadow-xl border border-black/5 flex flex-col overflow-hidden">
        <button
          onClick={onBack}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors z-10"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-7 pb-5 border-b border-black/5">
          <div
            className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase mb-2"
            style={{ color: "var(--accent-600)" }}
          >
            SYSTEM PROPOSAL
          </div>
          <h2 className="text-[22px] font-bold text-gray-900 mb-1" style={{ letterSpacing: "-0.025em" }}>
            Review & build
          </h2>
          <p className="text-[13px] text-gray-500">
            Select which labs to include. Your twin will track metrics, surface risks, and run scheduled research.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {model.labs.map((lab: LabCard) => {
            const isSelected = selected.has(lab.id);
            return (
              <button
                key={lab.id}
                onClick={() => toggle(lab.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                  isSelected
                    ? "border-[var(--accent-300)] bg-[var(--accent-50)]/40"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                    isSelected ? "bg-[var(--accent-600)]" : "bg-gray-100 border border-gray-300"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`font-mono text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded ${
                        CATEGORY_COLOR_CLASS[lab.category] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {CATEGORY_LABEL[lab.category] ?? lab.category}
                    </span>
                    <span className="font-mono text-[10px] text-gray-400 font-semibold">
                      {lab.contribution_pct > 0 ? "+" : ""}
                      {lab.contribution_pct}% health
                    </span>
                  </div>
                  <div className="text-[13.5px] font-semibold text-gray-900 mb-0.5" style={{ letterSpacing: "-0.015em" }}>
                    {lab.name}
                  </div>
                  {lab.metrics[0] && (
                    <div className="text-[11.5px] text-gray-500">
                      <span className="font-medium">{lab.metrics[0].label}:</span>{" "}
                      {lab.metrics[0].value} {lab.metrics[0].unit ?? ""}
                      {lab.metrics[0].target && <> · target {lab.metrics[0].target}</>}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {model.labs.length === 0 && (
            <div className="text-center py-8 text-[12.5px] text-gray-500">
              No labs available yet. Gather more data first.
            </div>
          )}
        </div>

        <div className="p-5 border-t border-black/5 flex items-center justify-between bg-gray-50">
          <div className="text-[12px] text-gray-600">
            <span className="font-semibold text-gray-900">{selected.size}</span> of {model.labs.length} labs selected
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="px-4 py-2 text-[12.5px] font-medium text-gray-600 hover:text-gray-900 rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => onConfirm(Array.from(selected))}
              disabled={selected.size === 0}
              className="px-5 py-2 text-[12.5px] font-semibold text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--accent-600)" }}
            >
              Confirm & build ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
