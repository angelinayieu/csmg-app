"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { StreamingOutput } from "@/components/analysis/streaming-output";
import { useAppStore } from "@/stores/store-provider";
import { createClient } from "@/lib/supabase/client";
import type { Space } from "@/types";

const MAX_LENGTH = 50000;

export function InputPanel() {
  const router = useRouter();
  const [text, setText] = useState("");
  const { phase, streamedText, error, spaceId, analyze, reset } =
    useAnalyze();
  const addSpace = useAppStore((s) => s.addSpace);

  // Navigate to space on completion
  useEffect(() => {
    if (phase === "complete" && spaceId) {
      const supabase = createClient();
      supabase
        .from("spaces")
        .select("*")
        .eq("id", spaceId)
        .single()
        .then(({ data }) => {
          if (data) {
            addSpace(data as Space);
          }
          router.push(`/app/space/${spaceId}`);
        });
    }
  }, [phase, spaceId, addSpace, router]);

  function handleAnalyze() {
    analyze(text);
  }

  function handleReset() {
    reset();
    setText("");
  }

  const isActive = phase !== "idle";
  const isProcessing = phase === "streaming" || phase === "structuring";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">New Analysis</h1>
      <p className="mt-1 text-sm text-gray-600">
        Paste a business situation, research problem, strategic plan, or any
        complex text to analyze into a structured knowledge graph.
      </p>

      <div className="mt-6">
        <Textarea
          id="analyze-input"
          placeholder="Enter a concept, question, situation, or text to analyze..."
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          rows={isActive ? 6 : 12}
          className="resize-y transition-all"
          disabled={isProcessing}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}{" "}
            characters
          </span>
          <div className="flex gap-2">
            {isActive && !isProcessing && (
              <Button variant="ghost" onClick={handleReset} size="md">
                New analysis
              </Button>
            )}
            <Button
              onClick={handleAnalyze}
              disabled={text.trim().length < 20 || isProcessing}
              loading={isProcessing}
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {isProcessing ? "Analyzing..." : "Analyze"}
            </Button>
          </div>
        </div>
      </div>

      {/* Streaming output */}
      {isActive && (
        <StreamingOutput
          phase={phase}
          streamedText={streamedText}
          error={error}
        />
      )}
    </div>
  );
}
