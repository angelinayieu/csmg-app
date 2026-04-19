"use client";

import { CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

interface ApprovalBarProps {
  isConfirmed: boolean;
  isTopRanked: boolean;
  loading: boolean;
  onApprove: () => void;
  onRegenerate?: () => void;
  onQuestion?: () => void;
  cascadeSummary?: string;
}

export function ApprovalBar({
  isConfirmed,
  isTopRanked,
  loading,
  onApprove,
  onRegenerate,
  onQuestion,
  cascadeSummary,
}: ApprovalBarProps) {
  return (
    <div
      className="mt-3.5 p-3.5 rounded-[10px] flex items-center gap-3 flex-wrap"
      style={{
        background: isConfirmed ? "#ECFDF5" : "rgba(var(--accent-rgb), 0.06)",
        border: isConfirmed
          ? "1px solid #A7F3D0"
          : "1px solid rgba(var(--accent-rgb), 0.2)",
      }}
    >
      <div
        className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0 text-white"
        style={{
          background: isConfirmed ? "#059669" : "var(--accent-600)",
        }}
      >
        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-[200px]">
        <div
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: isConfirmed ? "#047857" : "var(--accent-700)",
            marginBottom: 2,
          }}
        >
          {isConfirmed ? "Confirmed strategy" : "Ready for approval"}
        </div>
        <div
          className="font-bold"
          style={{
            fontSize: 12,
            color: "#0B0D12",
            lineHeight: 1.35,
            marginBottom: 2,
          }}
        >
          {cascadeSummary ?? "All cascades converge · proxies wired · downstream traces verified"}
        </div>
        <div
          style={{
            fontSize: "10.5px",
            color: "rgba(11,13,18,0.74)",
            lineHeight: 1.4,
          }}
        >
          {isConfirmed
            ? "This variant is locked. Regenerate or swap alternatives to edit."
            : isTopRanked
              ? "Approving locks this variant and opens Execution Labs where live tracking begins. Can be unlocked and re-edited at any time."
              : "Select this alternative to promote it — current top-ranked will drop to review."}
        </div>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        {onQuestion && (
          <button
            onClick={onQuestion}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-white transition-colors"
            style={{
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.14)",
              color: "rgba(11,13,18,0.74)",
              letterSpacing: "-0.005em",
            }}
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            Question
          </button>
        )}
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-white transition-colors disabled:opacity-60"
            style={{
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.14)",
              color: "rgba(11,13,18,0.74)",
              letterSpacing: "-0.005em",
            }}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        )}
        <button
          onClick={onApprove}
          disabled={isConfirmed || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold text-white disabled:opacity-60 transition-all"
          style={{
            background: isConfirmed ? "#047857" : "#059669",
            border: `1px solid ${isConfirmed ? "#047857" : "#059669"}`,
            letterSpacing: "-0.005em",
          }}
        >
          <CheckCircle2 className="w-2.5 h-2.5" strokeWidth={2.5} />
          {isConfirmed ? "Confirmed" : isTopRanked ? "Approve & launch" : "Promote & launch"}
        </button>
      </div>
    </div>
  );
}
