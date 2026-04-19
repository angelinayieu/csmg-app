"use client";

import { useState } from "react";
import { AlertCircle, Search, Database, MessageCircle, Check } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import type { DataSufficiencyReport } from "@/types/operating-twin";

interface InsufficientDataPanelProps {
  sufficiency: DataSufficiencyReport;
  onRunDeepResearch?: () => Promise<void> | void;
  onEnrichKG?: () => Promise<void> | void;
  onContinueInChat?: () => void;
}

export function InsufficientDataPanel({
  sufficiency,
  onRunDeepResearch,
  onEnrichKG,
  onContinueInChat,
}: InsufficientDataPanelProps) {
  const ctx = useSpaceData();
  const [running, setRunning] = useState<string | null>(null);

  const handleDeepResearch = async () => {
    if (running) return;
    setRunning("research");
    try {
      if (onRunDeepResearch) {
        await onRunDeepResearch();
      } else {
        // Fallback: call the existing research API
        await fetch(`/api/pipeline/research-deep`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId: ctx.space.id }),
        });
        ctx.refresh();
      }
    } finally {
      setRunning(null);
    }
  };

  const handleEnrichKG = async () => {
    if (running) return;
    setRunning("enrich");
    try {
      if (onEnrichKG) {
        await onEnrichKG();
      } else {
        // Fallback: suggest the user run Deepen on the graph page
        window.location.href = `/app/space/${ctx.space.id}/graph`;
      }
    } finally {
      setRunning(null);
    }
  };

  const handleChat = () => {
    if (onContinueInChat) {
      onContinueInChat();
    } else {
      ctx.setChatOpen(true);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-[560px] w-full bg-white rounded-[14px] border border-black/5 p-7 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent-50)" }}
          >
            <AlertCircle className="h-5 w-5" style={{ color: "var(--accent-600)" }} />
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-gray-900" style={{ letterSpacing: "-0.02em" }}>
              Complete your Operating Twin
            </h2>
            <p className="text-[12.5px] text-gray-500 mt-0.5">
              A few more data points will unlock the full twin — pick a path below.
            </p>
          </div>
        </div>

        {/* Missing checklist */}
        {sufficiency.missing.length > 0 && (
          <div className="mb-5">
            <div className="font-mono text-[10px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-2">
              What's missing
            </div>
            <ul className="space-y-2">
              {sufficiency.missing.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <div className="w-4 h-4 rounded-full border-[1.5px] border-gray-300 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">{m.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          {sufficiency.actions_available.includes("deep_research") && (
            <button
              onClick={handleDeepResearch}
              disabled={running !== null}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)] transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--accent-50)" }}
              >
                {running === "research" ? (
                  <Check className="h-4 w-4 animate-pulse" style={{ color: "var(--accent-600)" }} />
                ) : (
                  <Search className="h-4 w-4" style={{ color: "var(--accent-600)" }} />
                )}
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-gray-900">
                  {running === "research" ? "Running deep research…" : "Run Deep Research"}
                </div>
                <div className="text-[11.5px] text-gray-500 mt-0.5">
                  Pull in external context & benchmarks to build more labs
                </div>
              </div>
            </button>
          )}

          {sufficiency.actions_available.includes("enrich_kg") && (
            <button
              onClick={handleEnrichKG}
              disabled={running !== null}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)] transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-50">
                <Database className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-gray-900">Enrich Knowledge Graph</div>
                <div className="text-[11.5px] text-gray-500 mt-0.5">
                  Expand entities & uncover more leverage points via LLM reasoning
                </div>
              </div>
            </button>
          )}

          {sufficiency.actions_available.includes("continue_chat") && (
            <button
              onClick={handleChat}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)] transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-50">
                <MessageCircle className="h-4 w-4 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-gray-900">Continue in Chat</div>
                <div className="text-[11.5px] text-gray-500 mt-0.5">
                  Refine your analysis with questions — I'll surface gaps for you
                </div>
              </div>
            </button>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-black/5">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Your twin will partially render while you gather more data. Labs and metrics
            will fill in automatically as the graph grows.
          </p>
        </div>
      </div>
    </div>
  );
}
