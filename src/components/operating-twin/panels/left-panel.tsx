"use client";

import { cn } from "@/lib/utils";
import type { OperatingTwinModel, ApprovalItem } from "@/types/operating-twin";

interface LeftPanelProps {
  model: OperatingTwinModel;
  onApprovalClick: (approval: ApprovalItem) => void;
}

export function LeftPanel({ model, onApprovalClick }: LeftPanelProps) {
  const { identity, active_frame, approvals } = model;

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      {/* Identity */}
      <div className="bg-white rounded-[14px] border border-black/5 p-5">
        <div
          className="font-mono text-[9.5px] text-gray-500 font-bold tracking-[0.14em] uppercase mb-3.5"
        >
          OPERATING TWIN
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-white text-[17px] font-bold flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent-500) 0%, var(--accent-700) 100%)",
              letterSpacing: "-0.03em",
            }}
          >
            {identity.avatar_letter}
          </div>
          <div>
            <div className="text-[17px] font-semibold leading-tight mb-0.5" style={{ letterSpacing: "-0.03em" }}>
              {identity.name}
            </div>
            <div className="text-[11.5px] text-gray-500 font-medium">
              Day {identity.day_count} · {identity.label}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-0 border-t border-black/5 pt-4">
          {[
            { val: identity.total_labs, label: "LABS" },
            { val: identity.total_atoms, label: "ATOMS" },
            { val: identity.total_claims, label: "CLAIMS" },
          ].map((m, i) => (
            <div key={m.label} className={cn("text-center px-1 relative", i > 0 && "border-l border-black/5")}>
              <div
                className="text-[20px] font-bold text-gray-900 leading-none"
                style={{ letterSpacing: "-0.035em", fontFeatureSettings: "'tnum'" }}
              >
                {m.val}
              </div>
              <div className="font-mono text-[9px] text-gray-500 uppercase tracking-[0.1em] font-semibold mt-1.5">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Frame */}
      <div className="bg-white rounded-[14px] border border-black/5 p-5">
        <div className="flex items-center gap-[7px] mb-2.5">
          <span
            className="w-[5px] h-[5px] rounded-full"
            style={{
              background: "var(--accent-600)",
              boxShadow: "0 0 0 3px var(--accent-50)",
            }}
          />
          <span
            className="font-mono text-[9.5px] font-bold tracking-[0.14em] uppercase"
            style={{ color: "var(--accent-600)" }}
          >
            ACTIVE FRAME
          </span>
        </div>
        {active_frame ? (
          <>
            <div
              className="text-[14px] font-semibold mb-4"
              style={{ letterSpacing: "-0.022em", lineHeight: 1.32, color: "#0a0b0f" }}
            >
              {active_frame.goal.title}
            </div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex-1 h-[5px] bg-gray-100 rounded-[3px] overflow-hidden">
                <div
                  className="h-full rounded-[3px] transition-[width] duration-700"
                  style={{
                    width: `${active_frame.progress_pct}%`,
                    background: "linear-gradient(90deg, var(--accent-500) 0%, var(--accent-700) 100%)",
                  }}
                />
              </div>
              <span
                className="font-mono text-[12px] font-bold text-gray-900"
                style={{ letterSpacing: "-0.01em" }}
              >
                {active_frame.progress_pct}%
              </span>
            </div>
            <div className="text-[11px] text-gray-500 font-medium">
              {active_frame.contributing_labs_count} of {active_frame.total_labs_count} labs contributing
              {active_frame.trajectory_weeks != null && (
                <> · ~{active_frame.trajectory_weeks}w ETA</>
              )}
            </div>
          </>
        ) : (
          <div className="text-[12px] text-gray-400 italic">No active objective — set one to focus the twin.</div>
        )}
      </div>

      {/* Approvals */}
      <div className="flex-1 min-h-0 bg-white rounded-[14px] border border-black/5 flex flex-col overflow-hidden">
        <div className="px-[18px] py-3.5 pb-3 flex items-center border-b border-black/5">
          <h3 className="text-[13px] font-semibold text-gray-900" style={{ letterSpacing: "-0.015em" }}>
            Pending approvals
          </h3>
          <span className="ml-auto font-mono text-[10px] font-semibold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
            {approvals.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {approvals.length === 0 ? (
            <div className="text-[11px] text-gray-400 text-center py-6 px-3">
              No items pending. New proposals appear here.
            </div>
          ) : (
            approvals.map((a, i) => (
              <button
                key={a.id}
                onClick={() => onApprovalClick(a)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-[9px] cursor-pointer hover:bg-gray-50 transition-colors",
                  i > 0 && "border-t border-black/5 rounded-t-none",
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={cn(
                      "font-mono text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-[3px]",
                      a.type === "objective" && "bg-[var(--accent-50)] text-[var(--accent-600)]",
                      a.type === "strategy" && "bg-amber-50 text-amber-600",
                      a.type === "research_finding" && "bg-emerald-50 text-emerald-600",
                      a.type === "change_proposal" && "bg-purple-50 text-purple-600",
                    )}
                  >
                    {a.tag_label}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-gray-400 font-medium">
                    {a.time_label}
                  </span>
                </div>
                <div
                  className="text-[12.5px] font-semibold text-gray-900 leading-tight mb-1"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  {a.title}
                </div>
                <div className="text-[11px] text-gray-500 leading-[1.4] line-clamp-2">
                  {a.summary}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
