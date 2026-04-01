"use client";

import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Check, AlertCircle } from "lucide-react";
import type { AnalysisPhase } from "@/types/analysis";

interface StreamingOutputProps {
  phase: AnalysisPhase;
  streamedText: string;
  error: string | null;
}

const phaseConfig: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string }
> = {
  streaming: {
    label: "Analyzing...",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-interaxis-600",
    bg: "bg-interaxis-50 border-interaxis-200",
  },
  structuring: {
    label: "Structuring results...",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  synthesizing: {
    label: "Generating deep synthesis...",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: "text-purple-600",
    bg: "bg-purple-50 border-purple-200",
  },
  complete: {
    label: "Complete",
    icon: <Check className="h-4 w-4" />,
    color: "text-green-600",
    bg: "bg-green-50 border-green-200",
  },
  error: {
    label: "Error",
    icon: <AlertCircle className="h-4 w-4" />,
    color: "text-red-600",
    bg: "bg-red-50 border-red-200",
  },
};

export function StreamingOutput({
  phase,
  streamedText,
  error,
}: StreamingOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (phase === "streaming" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamedText, phase]);

  const config = phaseConfig[phase];
  if (!config) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Phase indicator */}
      <div className={`flex items-center gap-2 border-b px-4 py-3 ${config.bg}`}>
        <span className={config.color}>{config.icon}</span>
        <span className={`text-sm font-medium ${config.color}`}>
          {config.label}
        </span>
      </div>

      {/* Content area */}
      <div
        ref={scrollRef}
        className="max-h-[500px] overflow-y-auto bg-white px-6 py-4"
      >
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {streamedText ? (
          <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900">
            <Markdown remarkPlugins={[remarkGfm]}>{streamedText}</Markdown>
            {phase === "streaming" && (
              <span className="inline-block h-4 w-1.5 animate-pulse bg-interaxis-500" />
            )}
          </div>
        ) : phase === "structuring" ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-500" />
            Parsing entities, relationships, and cycles...
          </div>
        ) : phase === "synthesizing" ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-purple-500" />
            Generating deep strategic synthesis...
          </div>
        ) : null}
      </div>
    </div>
  );
}
