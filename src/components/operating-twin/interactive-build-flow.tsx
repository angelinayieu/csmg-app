"use client";

import { useState } from "react";
import { X, Check, SkipForward, ArrowRight } from "lucide-react";
import type { LabCard, OperatingTwinModel } from "@/types/operating-twin";

interface InteractiveBuildFlowProps {
  model: OperatingTwinModel;
  onComplete: (approvedLabIds: string[]) => void;
  onCancel: () => void;
}

export function InteractiveBuildFlow({ model, onComplete, onCancel }: InteractiveBuildFlowProps) {
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);

  const labs = model.labs;
  const current: LabCard | undefined = labs[step];

  if (!current) {
    // Shouldn't happen but guard
    return null;
  }

  const progress = ((step + 1) / labs.length) * 100;

  const handleApprove = () => {
    const next = [...approved, current.id];
    setApproved(next);
    if (step + 1 >= labs.length) {
      onComplete(next);
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    setSkipped([...skipped, current.id]);
    if (step + 1 >= labs.length) {
      onComplete(approved);
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/30 backdrop-blur-sm">
      <div className="relative w-full max-w-[560px] bg-white rounded-2xl shadow-xl border border-black/5 overflow-hidden">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors z-10"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, var(--accent-500) 0%, var(--accent-700) 100%)",
            }}
          />
        </div>

        <div className="p-7">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase"
              style={{ color: "var(--accent-600)" }}
            >
              LAB {step + 1} OF {labs.length}
            </div>
            <span className="font-mono text-[9px] text-gray-400 uppercase tracking-[0.1em]">
              · {approved.length} approved · {skipped.length} skipped
            </span>
          </div>

          <h2
            className="text-[22px] font-bold text-gray-900 mb-1"
            style={{ letterSpacing: "-0.025em" }}
          >
            {current.name}
          </h2>

          <p className="text-[13px] text-gray-500 mb-5 leading-relaxed">
            {current.description ??
              `Proposed ${current.category} lab tracking ${current.metrics[0]?.label ?? "a key metric"}.`}
          </p>

          {/* Proposed metric */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 mb-5">
            <div className="font-mono text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-2">
              PROPOSED METRIC
            </div>
            {current.metrics[0] ? (
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[32px] font-bold text-gray-900"
                  style={{
                    letterSpacing: "-0.04em",
                    fontFeatureSettings: "'tnum'",
                  }}
                >
                  {current.metrics[0].value}
                </span>
                <span className="text-[12px] text-gray-500 font-medium">
                  {current.metrics[0].unit ?? current.metrics[0].label}
                </span>
                {current.metrics[0].target && (
                  <span className="font-mono text-[11px] text-gray-400 ml-auto">
                    → {current.metrics[0].target}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-gray-500">To be defined</div>
            )}
            <div className="mt-3 pt-3 border-t border-black/5 flex items-center justify-between text-[11.5px]">
              <span className="text-gray-500">Health contribution</span>
              <span
                className="font-mono font-bold"
                style={{
                  color:
                    current.contribution_pct > 0
                      ? "#10b981"
                      : current.contribution_pct < 0
                        ? "#ef4444"
                        : "#6e7079",
                }}
              >
                {current.contribution_pct > 0 ? "+" : ""}
                {current.contribution_pct} pts
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkip}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12.5px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>
            <button
              onClick={handleApprove}
              className="ml-auto flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[12.5px] font-semibold text-white transition-all hover:brightness-110"
              style={{ background: "var(--accent-600)" }}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              {step + 1 >= labs.length ? "Approve & finish" : "Approve"}
              {step + 1 < labs.length && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
