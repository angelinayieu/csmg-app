"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { StreamingOutput } from "./streaming-output";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { usePipeline } from "@/lib/hooks/use-pipeline";
import { TierSelector } from "@/components/analysis/tier-selector";
import { useAppStore } from "@/stores/store-provider";
import { createClient } from "@/lib/supabase/client";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { cn } from "@/lib/utils";
import type { Space } from "@/types";

const MAX_LENGTH = 50000;

// Map tier to pipeline reasoningDepth
const TIER_TO_DEPTH: Record<AnalysisTier, "quick" | "standard" | "deep"> = {
  quick: "quick",
  standard: "standard",
  deep: "deep",
  comprehensive: "deep",
};

export function InputPanel({ creditBalance = 10 }: { creditBalance?: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [tier, setTier] = useState<AnalysisTier>("quick");
  const addSpace = useAppStore((s) => s.addSpace);

  // Quick uses streaming analyze, everything else uses pipeline
  const quickHook = useAnalyze();
  const pipeline = usePipeline();

  const tierConfig = TIERS[tier];
  const isQuick = tier === "quick";
  const usePipelinePath = !isQuick; // Standard, Deep, Comprehensive all use pipeline
  const isMultiSpace = tierConfig.multiSpace; // deep + comprehensive

  const activePhase = isQuick ? quickHook.phase : pipeline.phase;
  const isActive = activePhase !== "idle";
  const isProcessing = !["idle", "complete", "error"].includes(activePhase);
  const activeError = isQuick ? quickHook.error : pipeline.error;

  // Navigate on completion
  useEffect(() => {
    if (activePhase === "complete") {
      const targetId = isQuick
        ? quickHook.spaceId
        : pipeline.rootSpaceId ?? pipeline.spaceIds[0];

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
  }, [activePhase, isQuick, quickHook.spaceId, pipeline.rootSpaceId, pipeline.spaceIds, addSpace, router]);

  // Run analysis based on selected tier
  const handleAnalyze = useCallback(async () => {
    if (text.trim().length < 20) return;

    if (isQuick) {
      // Quick: single-space streaming via /api/analyze
      quickHook.analyze(text);
    } else {
      // Standard / Deep / Comprehensive: use pipeline
      type SpaceConfig = { name: string; prefix: string; description: string; key_concepts: string[]; priority: number };
      let spaces: SpaceConfig[];

      if (isMultiSpace) {
        // Deep/Comprehensive: always scope map to get multi-space analysis
        const scopeData = await pipeline.runScope(text);
        if (!scopeData?.spaces?.length) {
          // runScope sets phase to "error" on failure.
          // If it somehow returned empty spaces without error, reset.
          if (scopeData !== null) pipeline.reset();
          return;
        }
        spaces = scopeData.spaces;
      } else {
        // Standard or short-text Deep: single space, no scope needed
        spaces = [{
          name: "Analysis",
          prefix: "C",
          description: "Complete analysis of the input",
          key_concepts: [],
          priority: 1,
        }];
      }

      pipeline.runPipeline(text, {
        selectedSpaces: spaces,
        reasoningDepth: TIER_TO_DEPTH[tier],
        tier: tier as "standard" | "deep" | "comprehensive",
        crossSpace: {
          weave: spaces.length >= 2,
          synthesis: true, // Always run synthesis — it works for single and multi-space
          externalKnowledge: tier === "deep" || tier === "comprehensive",
        },
      });
    }
  }, [text, tier, isQuick, isMultiSpace, quickHook, pipeline]);

  function handleReset() {
    quickHook.reset();
    pipeline.reset();
    setText("");
    setTier("quick");
  }

  // Phase display config
  const PHASE_DISPLAY: Record<string, { label: string; icon: "spinner" | "check" | "error" }> = {
    scope: { label: "Mapping analytical areas...", icon: "spinner" },
    decomposing: { label: "Building knowledge graphs...", icon: "spinner" },
    researching: { label: "Gathering domain expertise...", icon: "spinner" },
    critiquing: { label: "Validating & finding gaps...", icon: "spinner" },
    weaving: { label: "Discovering cross-area connections...", icon: "spinner" },
    synthesizing: { label: "Generating strategic synthesis...", icon: "spinner" },
    reasoning: { label: "Running deep reasoning passes...", icon: "spinner" },
    complete: { label: "Analysis complete!", icon: "check" },
    error: { label: "Error occurred", icon: "error" },
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">New Analysis</h1>
      <p className="mt-1 text-sm text-gray-600">
        Paste a business situation, research problem, strategic plan, or any complex text to analyze.
      </p>

      {/* Text input */}
      <div className="mt-4">
        <Textarea
          id="analyze-input"
          placeholder="Enter a concept, question, situation, or text to analyze..."
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          rows={isActive ? 4 : 8}
          className="resize-y transition-all"
          disabled={isProcessing}
        />
        <div className="mt-1 text-xs text-gray-400">
          {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()} characters
        </div>
      </div>

      {/* Tier selector + analyze button (hidden during processing) */}
      {!isActive && text.length >= 20 && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Analysis depth
            </div>
            <TierSelector
              selected={tier}
              onSelect={setTier}
              creditBalance={creditBalance}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <span className="font-medium">{tierConfig.credits} credit{tierConfig.credits > 1 ? "s" : ""}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{tierConfig.time}</span>
              {isMultiSpace && (
                <>
                  <span className="mx-1.5 text-gray-300">·</span>
                  <span className="text-interaxis-600">Multi-space</span>
                </>
              )}
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={text.trim().length < 20 || tierConfig.credits > creditBalance}
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Analyze
            </Button>
          </div>

          {tierConfig.credits > creditBalance && (
            <div className="text-xs text-red-500">
              Insufficient credits — you have {creditBalance}, need {tierConfig.credits}.{" "}
              <a href="/app/credits" className="underline hover:text-red-600">Buy more</a>
            </div>
          )}
        </div>
      )}

      {/* Progress: Quick (streaming) */}
      {isActive && isQuick && (
        <StreamingOutput
          phase={quickHook.phase}
          streamedText={quickHook.streamedText}
          error={quickHook.error}
        />
      )}

      {/* Progress: Standard/Deep/Comprehensive (pipeline) */}
      {isActive && usePipelinePath && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          {/* Phase indicator */}
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            {PHASE_DISPLAY[pipeline.phase]?.icon === "spinner" && (
              <Loader2 className="h-4 w-4 text-interaxis-500 animate-spin" />
            )}
            {PHASE_DISPLAY[pipeline.phase]?.icon === "check" && (
              <CheckCircle className="h-4 w-4 text-green-500" />
            )}
            {PHASE_DISPLAY[pipeline.phase]?.icon === "error" && (
              <AlertCircle className="h-4 w-4 text-red-500" />
            )}
            <span>{PHASE_DISPLAY[pipeline.phase]?.label ?? "Processing..."}</span>
          </div>

          {/* Pipeline steps progress bar */}
          <div className="flex gap-1 mb-3">
            {(["scope", "decomposing", "researching", "critiquing", "weaving", "synthesizing", "reasoning"] as const).map((step) => {
              const phases = ["scope", "decomposing", "researching", "critiquing", "weaving", "synthesizing", "reasoning", "complete"];
              const currentIdx = phases.indexOf(pipeline.phase);
              const stepIdx = phases.indexOf(step);
              const isDone = currentIdx > stepIdx;
              const isCurrent = currentIdx === stepIdx;
              // Skip scope bar if not multi-space
              if (step === "scope" && !isMultiSpace) return null;
              // Skip researching bar if not deep/comprehensive
              if (step === "researching" && tier !== "deep" && tier !== "comprehensive") return null;
              // Skip weave bar if single space
              if (step === "weaving" && pipeline.spaces.length < 2) return null;
              // Skip reasoning bar if not comprehensive
              if (step === "reasoning" && tier !== "comprehensive") return null;
              return (
                <div
                  key={step}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-500",
                    isDone ? "bg-green-400" :
                    isCurrent ? "bg-interaxis-400 animate-pulse" :
                    "bg-gray-200"
                  )}
                />
              );
            })}
          </div>

          {/* Per-space progress */}
          {pipeline.spaces.length > 0 && (
            <div className="space-y-1.5">
              {pipeline.spaces.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full flex-shrink-0",
                      s.status === "done"
                        ? "bg-green-500"
                        : s.status === "error"
                          ? "bg-red-500"
                          : s.status === "pending"
                            ? "bg-gray-300"
                            : "bg-interaxis-500 animate-pulse"
                    )}
                  />
                  <span className="text-gray-700 font-medium">{s.name}</span>
                  {s.entityCount !== undefined && (
                    <span className="text-gray-400 ml-auto">
                      {s.entityCount} entities · {s.edgeCount ?? 0} edges
                    </span>
                  )}
                  {s.status === "decomposing" && (
                    <span className="text-interaxis-500 ml-auto text-[10px]">analyzing...</span>
                  )}
                  {s.status === "critiquing" && (
                    <span className="text-amber-500 ml-auto text-[10px]">validating...</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reset button */}
      {isActive && !isProcessing && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" onClick={handleReset} size="sm">
            Start new analysis
          </Button>
        </div>
      )}

      {/* Error display */}
      {activeError && !isProcessing && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {activeError}
        </div>
      )}
    </div>
  );
}
