"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, ChevronDown, Check, GitBranch, Brain, Search } from "lucide-react";
import { StreamingOutput } from "./streaming-output";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { usePipeline } from "@/lib/hooks/use-pipeline";
import { useAppStore } from "@/stores/store-provider";
import { createClient } from "@/lib/supabase/client";
import {
  calculateCredits,
  getSmartDefaults,
  type AnalysisConfig,
  type ReasoningDepth,
  type SpaceOption,
} from "@/lib/analysis-config";
import { cn } from "@/lib/utils";
import type { Space } from "@/types";

const MAX_LENGTH = 50000;

const DEPTH_OPTIONS: Array<{
  value: ReasoningDepth;
  label: string;
  desc: string;
  perSpace: number;
}> = [
  { value: "quick", label: "Quick", desc: "Fast scan, basic connections", perSpace: 1 },
  { value: "standard", label: "Standard", desc: "Validated, catches gaps", perSpace: 2 },
  { value: "deep", label: "Deep", desc: "Precision + decision nodes", perSpace: 3 },
];

export function InputPanel({ creditBalance = 10 }: { creditBalance?: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [config, setConfig] = useState<AnalysisConfig>(() => getSmartDefaults(0));
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeReady, setScopeReady] = useState(false);
  const addSpace = useAppStore((s) => s.addSpace);

  // Quick uses simple analyze hook, Standard+ uses pipeline
  const quickHook = useAnalyze();
  const pipeline = usePipeline();

  const isQuick = config.reasoningDepth === "quick" && config.spaces.filter((s) => s.selected).length <= 1;
  const activePhase = isQuick ? quickHook.phase : pipeline.phase;
  const isActive = activePhase !== "idle";
  const isProcessing = !["idle", "complete", "error"].includes(activePhase);
  const activeError = isQuick ? quickHook.error : pipeline.error;

  const { breakdown, total, estimatedTime } = calculateCredits(config);

  // Auto-update defaults when text changes
  useEffect(() => {
    if (!scopeReady && !isActive) {
      const defaults = getSmartDefaults(text.length);
      setConfig((prev) => ({
        ...prev,
        reasoningDepth: defaults.reasoningDepth,
        crossSpace: defaults.crossSpace,
      }));
    }
  }, [text.length, scopeReady, isActive]);

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

  // Run scope mapping
  const runScopeMapping = useCallback(async () => {
    if (text.length < 200) {
      // Short text — single space, no scope mapping needed
      setConfig((prev) => ({
        ...prev,
        spaces: [{ name: "Analysis", prefix: "C", description: "Complete analysis", key_concepts: [], priority: 1, selected: true }],
      }));
      setScopeReady(true);
      return;
    }

    setScopeLoading(true);
    const startTime = performance.now();
    
    try {
      const result = await Promise.race([
        pipeline.runScope(text),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error("Scope mapping timeout after 30s")), 30000)
        ),
      ]);
      
      const elapsed = performance.now() - startTime;
      
      if (result?.spaces) {
        const spaceOptions: SpaceOption[] = result.spaces.map((s: SpaceOption, i: number) => ({
          ...s,
          selected: i < 3, // Auto-select top 3 by priority
        }));
        setConfig((prev) => ({ ...prev, spaces: spaceOptions }));
        setScopeReady(true);
      }
    } catch (err) {
      console.error("[Client] Scope mapping failed:", err);
    }
    setScopeLoading(false);
  }, [text, pipeline]);

  function handleAnalyze() {
    if (isQuick && !scopeReady) {
      // Quick single-space — skip scope mapping
      quickHook.analyze(text);
      return;
    }

    const selectedSpaces = config.spaces.filter((s) => s.selected);
    if (selectedSpaces.length === 0) return;

    if (selectedSpaces.length === 1 && config.reasoningDepth === "quick") {
      // Single space quick — use simple hook
      quickHook.analyze(text);
    } else {
      // Multi-space or Standard+ — use pipeline
      pipeline.runPipeline(text, {
        selectedSpaces,
        reasoningDepth: config.reasoningDepth,
        crossSpace: config.crossSpace,
      });
    }
  }

  function handleReset() {
    quickHook.reset();
    pipeline.reset();
    setText("");
    setScopeReady(false);
    setShowAdvanced(false);
    setConfig(getSmartDefaults(0));
  }

  function toggleSpace(index: number) {
    setConfig((prev) => ({
      ...prev,
      spaces: prev.spaces.map((s, i) =>
        i === index ? { ...s, selected: !s.selected } : s
      ),
    }));
  }

  const selectedCount = config.spaces.filter((s) => s.selected).length;

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

      {/* Config section (hidden during processing) */}
      {!isActive && text.length >= 20 && (
        <div className="mt-4 space-y-3">

          {/* Scope mapping — show for longer inputs */}
          {text.length >= 200 && !scopeReady && (
            <Button
              variant="secondary"
              size="sm"
              onClick={runScopeMapping}
              loading={scopeLoading}
              className="w-full"
            >
              <Search className="mr-2 h-3.5 w-3.5" />
              {scopeLoading ? "Identifying areas..." : "Identify analytical areas"}
            </Button>
          )}

          {/* Space selection (after scope mapping) */}
          {scopeReady && config.spaces.length > 1 && (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                Areas to analyze ({selectedCount} selected)
              </div>
              <div className="space-y-1">
                {config.spaces.map((space, i) => (
                  <button
                    key={i}
                    onClick={() => toggleSpace(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      space.selected
                        ? "bg-interaxis-50 text-interaxis-700"
                        : "text-gray-500 hover:bg-gray-50"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                        space.selected
                          ? "border-interaxis-500 bg-interaxis-500"
                          : "border-gray-300"
                      )}
                    >
                      {space.selected && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{space.name}</div>
                      {space.description && (
                        <div className="text-xs text-gray-400 truncate">{space.description}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advanced config toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
            {showAdvanced ? "Hide options" : "Customize analysis"}
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              {/* Depth selector */}
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Analysis depth
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfig((prev) => ({ ...prev, reasoningDepth: opt.value }))}
                      className={cn(
                        "rounded-lg border p-2.5 text-left transition-all text-sm",
                        config.reasoningDepth === opt.value
                          ? "border-interaxis-400 bg-interaxis-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                    >
                      <div className="font-medium">{opt.label}</div>
                      <div className="mt-0.5 text-[10px] text-gray-400">{opt.desc}</div>
                      <div className="mt-1 text-[10px] text-gray-500">{opt.perSpace} cr/area</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cross-space toggles */}
              {selectedCount >= 2 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Connections
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.crossSpace.weave}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            crossSpace: { ...prev.crossSpace, weave: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-interaxis-600"
                      />
                      <GitBranch className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-sm">Discover cross-area connections</span>
                      <span className="ml-auto text-[10px] text-gray-400">2 cr</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.crossSpace.synthesis}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            crossSpace: { ...prev.crossSpace, synthesis: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-interaxis-600"
                      />
                      <Brain className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-sm">Strategic synthesis</span>
                      <span className="ml-auto text-[10px] text-gray-400">2 cr</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Credit summary + Analyze button */}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div>
              {breakdown.length > 0 ? (
                <div className="space-y-0.5">
                  {breakdown.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span>{b.label}</span>
                      <span className="text-gray-400">{b.credits} cr</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-100 pt-1 mt-1 flex items-center gap-2 text-xs font-medium">
                    <span>Total: {total} credits</span>
                    <span className="text-gray-400">~{estimatedTime}s</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400">
                  {total} credits · ~{estimatedTime}s
                </div>
              )}
              {total > creditBalance && (
                <div className="mt-1 text-[10px] text-red-500">
                  Insufficient credits ({creditBalance} available)
                </div>
              )}
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={text.trim().length < 20 || total > creditBalance}
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Analyze ({total} cr)
            </Button>
          </div>
        </div>
      )}

      {/* Simple analyze button for short inputs */}
      {!isActive && text.length >= 20 && text.length < 200 && !showAdvanced && (
        <div className="mt-3 flex justify-end">
          <Button
            onClick={handleAnalyze}
            disabled={text.trim().length < 20}
            size="lg"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Analyze (1 cr)
          </Button>
        </div>
      )}

      {/* Progress display */}
      {isActive && isQuick && (
        <StreamingOutput
          phase={quickHook.phase}
          streamedText={quickHook.streamedText}
          error={quickHook.error}
        />
      )}

      {isActive && !isQuick && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium mb-3">
            {pipeline.phase === "scope" && "Mapping scope..."}
            {pipeline.phase === "decomposing" && "Analyzing areas..."}
            {pipeline.phase === "critiquing" && "Validating connections..."}
            {pipeline.phase === "weaving" && "Discovering cross-area links..."}
            {pipeline.phase === "synthesizing" && "Generating strategy..."}
            {pipeline.phase === "complete" && "Complete!"}
            {pipeline.phase === "error" && "Error occurred"}
          </div>
          {pipeline.spaces.length > 0 && (
            <div className="space-y-1">
              {pipeline.spaces.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    s.status === "done" ? "bg-green-500" :
                    s.status === "error" ? "bg-red-500" :
                    s.status === "pending" ? "bg-gray-300" :
                    "bg-interaxis-500 animate-pulse"
                  )} />
                  <span className="text-gray-600">{s.name}</span>
                  {s.entityCount !== undefined && (
                    <span className="text-gray-400">
                      {s.entityCount} entities · {s.edgeCount} edges
                    </span>
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
