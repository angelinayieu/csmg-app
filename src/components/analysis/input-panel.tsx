"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { TierSelector } from "./tier-selector";
import { StreamingOutput } from "./streaming-output";
import { PipelineProgress } from "./pipeline-progress";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { useOrchestrate } from "@/lib/hooks/use-orchestrate";
import { useAppStore } from "@/stores/store-provider";
import { createClient } from "@/lib/supabase/client";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import type { Space } from "@/types";

const MAX_LENGTH = 50000;

export function InputPanel({ creditBalance = 10 }: { creditBalance?: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [tier, setTier] = useState<AnalysisTier>("quick");
  const addSpace = useAppStore((s) => s.addSpace);

  // Quick tier uses the simple analyze hook
  const quickHook = useAnalyze();
  // Standard/Deep/Comprehensive use the orchestrate hook
  const orchestrateHook = useOrchestrate();

  const isQuick = tier === "quick";
  const phase = isQuick ? quickHook.phase : orchestrateHook.phase;
  const error = isQuick ? quickHook.error : orchestrateHook.error;
  const isActive = phase !== "idle";
  const isProcessing = !["idle", "complete", "error"].includes(phase);

  // Navigate on completion
  useEffect(() => {
    if (phase === "complete") {
      const targetId = isQuick
        ? quickHook.spaceId
        : orchestrateHook.rootSpaceId ?? orchestrateHook.spaceIds[0];

      if (targetId) {
        const supabase = createClient();
        supabase
          .from("spaces")
          .select("*")
          .eq("id", targetId)
          .single()
          .then(({ data }) => {
            if (data) addSpace(data as Space);
            router.push(`/app/space/${targetId}`);
          });
      }
    }
  }, [
    phase,
    isQuick,
    quickHook.spaceId,
    orchestrateHook.rootSpaceId,
    orchestrateHook.spaceIds,
    addSpace,
    router,
  ]);

  function handleAnalyze() {
    if (isQuick) {
      quickHook.analyze(text);
    } else {
      orchestrateHook.analyze(text, tier);
    }
  }

  function handleReset() {
    if (isQuick) quickHook.reset();
    else orchestrateHook.reset();
    setText("");
  }

  const tierConfig = TIERS[tier];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">New Analysis</h1>
      <p className="mt-1 text-sm text-gray-600">
        Paste a business situation, research problem, strategic plan, or any
        complex text to analyze.
      </p>

      {/* Tier selector */}
      {!isActive && (
        <div className="mt-4">
          <TierSelector
            selected={tier}
            onSelect={setTier}
            creditBalance={creditBalance}
          />
        </div>
      )}

      <div className="mt-4">
        <Textarea
          id="analyze-input"
          placeholder="Enter a concept, question, situation, or text to analyze..."
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          rows={isActive ? 4 : 10}
          className="resize-y transition-all"
          disabled={isProcessing}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}{" "}
            characters
          </span>
          <div className="flex items-center gap-3">
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
              {isProcessing
                ? "Analyzing..."
                : `${tierConfig.icon} Analyze (${tierConfig.credits} cr)`}
            </Button>
          </div>
        </div>
      </div>

      {/* Progress display */}
      {isActive && isQuick && (
        <StreamingOutput
          phase={quickHook.phase}
          streamedText={quickHook.streamedText}
          error={quickHook.error}
        />
      )}

      {isActive && !isQuick && (
        <PipelineProgress
          phase={orchestrateHook.phase}
          spaces={orchestrateHook.spaces}
          bridgeCount={orchestrateHook.bridgeCount}
          contradictionCount={orchestrateHook.contradictionCount}
          error={orchestrateHook.error}
        />
      )}

      {error && !isProcessing && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
