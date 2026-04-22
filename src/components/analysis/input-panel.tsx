"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, CheckCircle, AlertCircle, Loader2, Check, FileText, Link2, Upload, X } from "lucide-react";
import { StreamingOutput } from "./streaming-output";
import { AnalysisSpecPreview } from "./analysis-spec-preview";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { usePipeline, type PipelineTelemetry } from "@/lib/hooks/use-pipeline";
import { TierSelector } from "@/components/analysis/tier-selector";
import { useAppStore } from "@/stores/store-provider";
import { createClient } from "@/lib/supabase/client";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { cn } from "@/lib/utils";
import type { Space } from "@/types";
import type { UserRole, PrimaryGoal, ContextType, UserIntent } from "@/types/analysis";
import {
  ROLE_OPTIONS,
  GOAL_OPTIONS,
  CONTEXT_OPTIONS,
} from "@/lib/prompts/intent-context";

const MAX_LENGTH = 200000;

/** Metadata about a successful ingest, shown as a chip above the textarea. */
interface IngestedSource {
  source_name: string;
  source_type: "pdf" | "url" | "text" | "docx" | "image";
  num_pages?: number;
  url?: string;
  raw_chars: number;
  normalized_chars: number;
  ocr_confident?: boolean;
}

// Map tier to pipeline reasoningDepth
const TIER_TO_DEPTH: Record<AnalysisTier, "quick" | "standard" | "deep"> = {
  quick: "quick",
  standard: "standard",
  deep: "deep",
  comprehensive: "deep",
};

// ── Stage display names + metric summaries for completed stages ──

const STAGE_LABELS: Record<string, string> = {
  scope: "Scope",
  classifying: "Classification",
  decomposing: "Decomposition",
  researching: "Research",
  critiquing: "Critique",
  weaving: "Weave",
  deep_research: "Deep Research",
  interweaving: "Interweave",
  interweave_1: "Interweave 1",
  interweave_2: "Interweave 2",
  interweave_3: "Interweave 3",
  synthesizing: "Synthesis",
  strategizing: "Strategy",
  reasoning: "Reasoning",
  auto_research: "Targeted Research",
  regen: "Regen",
};

/** Order in which stages appear in the completed timeline */
const STAGE_ORDER = ["scope", "classifying", "decomposing", "researching", "critiquing", "weaving", "deep_research", "interweave_1", "interweave_2", "interweave_3", "synthesizing", "strategizing", "auto_research", "regen", "reasoning"];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function stageSummary(stage: string, t: PipelineTelemetry): string | null {
  switch (stage) {
    case "scope":
      return null;
    case "decomposing":
      return `${t.totalEntities} entities, ${t.totalEdges} edges`;
    case "researching":
      return [
        t.externalEntities > 0 ? `${t.externalEntities} external entities` : null,
        t.researchSearches > 0 ? `${t.researchSearches} searches` : null,
      ].filter(Boolean).join(", ") || null;
    case "critiquing":
      return [
        t.totalCycles > 0 ? `${t.totalCycles} cycles found` : null,
      ].filter(Boolean).join(", ") || "validated";
    case "weaving":
      return t.bridgesDiscovered > 0 ? `${t.bridgesDiscovered} bridges` : null;
    case "deep_research":
      return t.externalEntities > 0 ? `${t.externalEntities} entities verified` : "web research";
    case "interweave_1":
    case "interweave_2":
    case "interweave_3":
      return [
        t.interweaveHypothesesValidated > 0 ? `${t.interweaveHypothesesValidated} connections validated` : null,
        t.interweaveConnectivityScore !== null ? `connectivity: ${t.interweaveConnectivityScore}/100` : null,
      ].filter(Boolean).join(", ") || "analyzing topology";
    case "synthesizing":
      return t.qualityScore !== null ? `Quality: ${t.qualityScore}/100` : null;
    case "auto_research":
      return [
        t.criticalTriggers > 0 ? `${t.criticalTriggers} critical gaps` : null,
        t.highTriggers > 0 ? `${t.highTriggers} high gaps` : null,
      ].filter(Boolean).join(", ") || null;
    case "regen":
      return t.regenImproved && t.qualityScore !== null
        ? `Improved to ${t.qualityScore}/100`
        : t.qualityScore !== null ? `Score: ${t.qualityScore}/100` : null;
    case "reasoning":
      return "deep analysis passes";
    default:
      return null;
  }
}

function PipelineTelemetryPanel({
  phase,
  telemetry,
  spaces,
  isMultiSpace,
  tier,
  elapsedMs,
  phaseDisplay,
  isAutoResearch,
  autoResearchInfo,
}: {
  phase: string;
  telemetry: PipelineTelemetry;
  spaces: Array<{ name: string; status: string; entityCount?: number; edgeCount?: number }>;
  isMultiSpace: boolean;
  tier: string;
  elapsedMs: number;
  phaseDisplay: Record<string, { label: string; icon: "spinner" | "check" | "error" }>;
  isAutoResearch: boolean;
  autoResearchInfo: { critical: number; high: number; summary: string } | null;
}) {
  const isComplete = phase === "complete";
  const isError = phase === "error";

  // Build ordered list of completed stages from telemetry timings
  const completedStages = STAGE_ORDER.filter(
    (s) => telemetry.stageTimings[s]?.completedAt != null
  );

  // Active phase key for telemetry (map pipeline phase to telemetry stage key)
  const activeStageKey = isAutoResearch ? "auto_research" : phase;
  const activeTiming = telemetry.stageTimings[activeStageKey];
  const activeElapsed = activeTiming?.startedAt
    ? Date.now() - activeTiming.startedAt
    : elapsedMs;

  // Live metric cards — only show non-zero values
  const metricCards: Array<{ label: string; value: number; color: string }> = [];
  if (telemetry.totalEntities > 0) metricCards.push({ label: "Entities", value: telemetry.totalEntities, color: "text-green-600" });
  if (telemetry.totalEdges > 0) metricCards.push({ label: "Edges", value: telemetry.totalEdges, color: "text-green-600" });
  if (telemetry.externalEntities > 0) metricCards.push({ label: "External", value: telemetry.externalEntities, color: "text-blue-600" });
  if (telemetry.bridgesDiscovered > 0) metricCards.push({ label: "Bridges", value: telemetry.bridgesDiscovered, color: "text-purple-600" });

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      {/* 1. Active Phase Indicator */}
      {!isComplete && !isError && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 text-interaxis-500 animate-spin" />
            <span>{phaseDisplay[phase]?.label ?? "Processing..."}</span>
          </div>
          <span className="text-xs font-mono text-gray-400 tabular-nums">
            {formatElapsed(activeElapsed)}
          </span>
        </div>
      )}
      {isComplete && (
        <div className="flex items-center gap-2 text-sm font-medium text-green-600">
          <CheckCircle className="h-4 w-4" />
          <span>Analysis complete!</span>
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-2 text-sm font-medium text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span>Error occurred</span>
        </div>
      )}

      {/* Pipeline steps progress bar */}
      <div className="flex gap-1">
        {(["scope", "decomposing", "researching", "critiquing", "weaving", "deep_research", "interweaving", "synthesizing", "strategizing", "reasoning"] as const).map((step) => {
          const phases = ["scope", "decomposing", "researching", "critiquing", "weaving", "deep_research", "interweaving", "synthesizing", "strategizing", "reasoning", "complete"];
          const currentIdx = phases.indexOf(phase);
          const stepIdx = phases.indexOf(step);
          const isDone = currentIdx > stepIdx;
          const isCurrent = currentIdx === stepIdx;
          if (step === "scope" && !isMultiSpace) return null;
          if (step === "researching" && tier !== "deep" && tier !== "comprehensive") return null;
          if (step === "deep_research" && tier !== "deep" && tier !== "comprehensive") return null;
          if (step === "interweaving" && tier !== "deep" && tier !== "comprehensive") return null;
          if (step === "weaving" && spaces.length < 2) return null;
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

      {/* 2. Completed Stages Timeline */}
      {completedStages.length > 0 && (
        <div className="space-y-1">
          {completedStages.map((stage) => {
            const timing = telemetry.stageTimings[stage];
            const duration = timing?.durationMs;
            const summary = stageSummary(stage, telemetry);
            return (
              <div key={stage} className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <CheckCircle className="h-3 w-3 text-green-400 flex-shrink-0" />
                <span className="font-medium text-gray-500">{STAGE_LABELS[stage] ?? stage}</span>
                {duration != null && (
                  <>
                    <span className="text-gray-300">&mdash;</span>
                    <span className="font-mono tabular-nums">{formatDuration(duration)}</span>
                  </>
                )}
                {summary && (
                  <>
                    <span className="text-gray-300">&mdash;</span>
                    <span className="text-gray-400">{summary}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Live Metric Cards */}
      {metricCards.length > 0 && (
        <div className="flex gap-3 pt-1">
          {metricCards.map((card) => (
            <div key={card.label} className="flex items-baseline gap-1">
              <span className={cn("text-sm font-semibold font-mono tabular-nums", card.color)}>
                {card.value}
              </span>
              <span className="text-[10px] text-gray-400">{card.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* 4. Quality + Regen summary (after synthesis) */}
      {telemetry.qualityScore !== null && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cn(
            "font-mono font-semibold tabular-nums",
            telemetry.qualityScore >= 70 ? "text-green-600" :
            telemetry.qualityScore >= 50 ? "text-amber-600" : "text-red-500"
          )}>
            Q:{telemetry.qualityScore}
          </span>
          {telemetry.qualityFlags.length > 0 && (
            <span className="text-amber-500">
              {telemetry.qualityFlags.length} flag{telemetry.qualityFlags.length !== 1 ? "s" : ""}
            </span>
          )}
          {telemetry.regenAttempted && (
            <span className={telemetry.regenImproved ? "text-green-500" : "text-gray-400"}>
              {telemetry.regenImproved ? "regen improved" : "regen attempted"}
            </span>
          )}
        </div>
      )}

      {/* 5. Auto-Research Callout */}
      {isAutoResearch && autoResearchInfo && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          <span className="font-medium">Auto-research triggered:</span>{" "}
          {autoResearchInfo.summary}
        </div>
      )}

      {/* Per-space progress (kept for multi-space visibility) */}
      {spaces.length > 1 && (
        <div className="space-y-1 border-t border-gray-100 pt-2">
          {spaces.map((s, i) => (
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
                <span className="text-gray-400 ml-auto font-mono text-[10px] tabular-nums">
                  {s.entityCount}e · {s.edgeCount ?? 0}r
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
  );
}

export function InputPanel({ creditBalance = 10 }: { creditBalance?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState("");

  // Prefill from Studio dropzone / command palette.
  // `?seed=...` → initial textarea content. `?mode=sketch` → hint to select
  // the cheapest tier by default. Runs once on mount; doesn't overwrite if
  // the user has already typed.
  useEffect(() => {
    const seed = searchParams.get("seed");
    if (seed && text.length === 0) {
      setText(seed.slice(0, MAX_LENGTH));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ingest state (PDF upload + URL extract) ──────────────────────
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestedSource, setIngestedSource] = useState<IngestedSource | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runIngest = useCallback(async (init: RequestInit) => {
    setIngestBusy(true);
    setIngestError(null);
    try {
      const res = await fetch("/api/ingest", init);
      const data = await res.json();
      if (!res.ok) {
        setIngestError(data?.error ?? `Ingest failed (HTTP ${res.status})`);
        return;
      }
      // Populate the textarea; truncate at MAX_LENGTH if needed (with a note).
      const extracted: string = data.text ?? "";
      const truncated = extracted.length > MAX_LENGTH;
      setText(truncated ? extracted.slice(0, MAX_LENGTH) : extracted);
      setIngestedSource({
        source_name: data.source_name ?? "Untitled",
        source_type: data.metadata?.source_type ?? "text",
        num_pages: data.metadata?.num_pages,
        url: data.metadata?.url,
        raw_chars: data.metadata?.raw_chars ?? extracted.length,
        normalized_chars: data.metadata?.normalized_chars ?? extracted.length,
        ocr_confident: data.metadata?.ocr_confident,
      });
      if (truncated) {
        setIngestError(
          `Extracted content was ${extracted.length.toLocaleString()} chars — truncated to ${MAX_LENGTH.toLocaleString()}. You can edit the text before analyzing.`,
        );
      }
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Ingest failed.");
    } finally {
      setIngestBusy(false);
    }
  }, []);

  const handleFilePick = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      await runIngest({ method: "POST", body: form });
    },
    [runIngest],
  );

  const handleUrlExtract = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    await runIngest({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url", url: trimmed }),
    });
  }, [urlInput, runIngest]);

  const handleClearSource = useCallback(() => {
    setIngestedSource(null);
    setIngestError(null);
    setUrlInput("");
  }, []);

  // Drag-and-drop wiring — scoped to the textarea area
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDraggingFile(true);
    }
  }, []);
  const handleDragLeave = useCallback(() => setIsDraggingFile(false), []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFilePick(file);
    },
    [handleFilePick],
  );

  // Paste support — images pasted from clipboard (e.g. screenshot of a
  // whiteboard, slide deck, or handwritten note) flow through the same
  // ingest path as file uploads. Text paste is left to the textarea's
  // default behavior.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFilePick(file);
            return;
          }
        }
      }
    },
    [handleFilePick],
  );

  // Phase 4b: auto-decisions — when on, skip tier selection + space-approval checkpoint
  const [autoDecisions, setAutoDecisions] = usePersistedState<boolean>(
    "interaxis:auto-decisions",
    false
  );

  // Cost-control toggles — persist across sessions so users keep their preference.
  // skipResearch: don't fire web research even if tier would normally include it.
  // useResearchCache: reuse research payload from prior runs on same decomposition (default ON — big cost saver).
  // skipSynthesis: generate graph only, no strategy/recommendations.
  const [skipResearch, setSkipResearch] = usePersistedState<boolean>(
    "interaxis:skip-research",
    false
  );
  const [useResearchCache, setUseResearchCache] = usePersistedState<boolean>(
    "interaxis:use-research-cache",
    true
  );
  const [skipSynthesis, setSkipSynthesis] = usePersistedState<boolean>(
    "interaxis:skip-synthesis",
    false
  );
  const [preferredTier, setPreferredTier] = usePersistedState<AnalysisTier>(
    "interaxis:preferred-tier",
    "standard"
  );
  const [tier, setTierRaw] = useState<AnalysisTier>("quick");

  // When auto-decisions hydrates / flips on, snap tier to the user's preferred tier.
  useEffect(() => {
    if (autoDecisions) setTierRaw(preferredTier);
  }, [autoDecisions, preferredTier]);

  // Tier setter — if auto-decisions is on, also persist the choice as the preference.
  const setTier = useCallback(
    (next: AnalysisTier) => {
      setTierRaw(next);
      if (autoDecisions) setPreferredTier(next);
    },
    [autoDecisions, setPreferredTier]
  );

  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [contextType, setContextType] = useState<ContextType | null>(null);
  const [selectedSpaceIndices, setSelectedSpaceIndices] = useState<Set<number>>(new Set());
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
  const isPendingApproval = activePhase === "pending_approval";
  const isProcessing = !["idle", "complete", "error", "pending_approval"].includes(activePhase);
  const activeError = isQuick ? quickHook.error : pipeline.error;

  // Initialize all spaces as selected when entering approval
  useEffect(() => {
    if (pipeline.phase === "pending_approval" && pipeline.scopeResult?.spaces) {
      setSelectedSpaceIndices(new Set(pipeline.scopeResult.spaces.map((_, i) => i)));
    }
  }, [pipeline.phase, pipeline.scopeResult]);

  // Navigate on completion. When the pipeline's event bus returned a
  // runId, land the user on the whiteboard with ?run=<id> so the
  // CanvasEventHud picks up the live SSE stream and shows the stage +
  // counts. Without a runId, fall back to the space dashboard.
  useEffect(() => {
    if (activePhase === "complete") {
      const targetId = isQuick
        ? quickHook.spaceId
        : pipeline.rootSpaceId ?? pipeline.spaceIds[0];

      if (targetId) {
        const runId = pipeline.latestRunId;
        const destination = runId
          ? `/app/space/${targetId}/whiteboard?run=${runId}`
          : `/app/space/${targetId}`;

        const supabase = createClient();
        supabase
          .from("spaces")
          .select("*")
          .eq("id", targetId)
          .single()
          .then(({ data }) => {
            if (data) addSpace(data as Space);
            router.push(destination);
          });
      }
    }
  }, [activePhase, isQuick, quickHook.spaceId, pipeline.rootSpaceId, pipeline.spaceIds, pipeline.latestRunId, addSpace, router]);

  // Elapsed time counter for active pipeline phase
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isProcessing && usePipelinePath) {
      setElapsedMs(0);
      elapsedRef.current = setInterval(() => setElapsedMs((t) => t + 100), 100);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [pipeline.phase, isProcessing, usePipelinePath]);

  // Build intent object from current selections
  const intent: UserIntent = {
    user_role: userRole,
    primary_goal: primaryGoal,
    context_type: contextType,
  };

  // Run analysis based on selected tier
  const handleAnalyze = useCallback(async () => {
    if (text.trim().length < 20) return;

    const currentIntent: UserIntent = {
      user_role: userRole,
      primary_goal: primaryGoal,
      context_type: contextType,
    };

    if (isQuick) {
      // Quick: single-space streaming via /api/analyze
      quickHook.analyze(text, currentIntent);
    } else {
      // Standard / Deep / Comprehensive: use pipeline
      if (isMultiSpace) {
        // Deep/Comprehensive: scope first, then pause for user approval
        const scopeData = await pipeline.runScope(text, currentIntent);
        if (!scopeData?.spaces?.length) {
          if (scopeData !== null) pipeline.reset();
          return;
        }
        // Stop here — phase is now "pending_approval"
        // Approval UI takes over; handleApprove calls runPipeline
        return;
      }

      // Standard: single space, no scope needed — run immediately
      const spaces = [{
        name: "Analysis",
        prefix: "C",
        description: "Complete analysis of the input",
        key_concepts: [] as string[],
        priority: 1,
      }];

      pipeline.runPipeline(text, {
        selectedSpaces: spaces,
        reasoningDepth: TIER_TO_DEPTH[tier],
        tier: tier as "standard" | "deep" | "comprehensive",
        intent: currentIntent,
        crossSpace: {
          weave: false,
          synthesis: !skipSynthesis,
          externalKnowledge: false,
          researchDepth: "training" as const,
        },
        costControls: {
          skipResearch,
          useResearchCache,
          skipSynthesis,
        },
        comprehensiveMode: tier === "comprehensive",
      });
    }
  }, [text, tier, isQuick, isMultiSpace, userRole, primaryGoal, contextType, quickHook, pipeline, skipResearch, useResearchCache, skipSynthesis]);

  function handleReset() {
    quickHook.reset();
    pipeline.reset();
    setText("");
    setTier("quick");
    setUserRole(null);
    setPrimaryGoal(null);
    setContextType(null);
    setSelectedSpaceIndices(new Set());
  }

  // Approval checkpoint handlers
  const handleApprove = useCallback(() => {
    if (!pipeline.scopeResult?.spaces) return;
    const approvedSpaces = pipeline.scopeResult.spaces.filter((_, i) => selectedSpaceIndices.has(i));
    if (approvedSpaces.length === 0) return;

    // Merge detected context_type from scope if user didn't specify one
    const resolvedIntent: UserIntent = { ...intent };
    if (!resolvedIntent.context_type && pipeline.scopeResult.detected_context) {
      resolvedIntent.context_type = pipeline.scopeResult.detected_context as ContextType;
      // Also update UI state so it persists
      setContextType(resolvedIntent.context_type);
    }

    pipeline.runPipeline(text, {
      selectedSpaces: approvedSpaces,
      reasoningDepth: TIER_TO_DEPTH[tier],
      tier: tier as "standard" | "deep" | "comprehensive",
      intent: resolvedIntent,
      crossSpace: {
        weave: approvedSpaces.length >= 2,
        synthesis: !skipSynthesis,
        // Respect skipResearch override regardless of tier
        externalKnowledge: !skipResearch && (tier === "deep" || tier === "comprehensive"),
        researchDepth: skipResearch
          ? "training"
          : tier === "comprehensive" ? "deep" : tier === "deep" ? "standard" : "training",
      },
      costControls: {
        skipResearch,
        useResearchCache,
        skipSynthesis,
      },
    });
  }, [pipeline, selectedSpaceIndices, text, tier, intent, skipResearch, useResearchCache, skipSynthesis]);

  // Phase 4b: auto-decisions — bypass the approval checkpoint once spaces are populated.
  const autoApprovedRef = useRef(false);
  useEffect(() => {
    if (pipeline.phase !== "pending_approval") {
      autoApprovedRef.current = false;
      return;
    }
    if (!autoDecisions) return;
    if (autoApprovedRef.current) return;
    if (selectedSpaceIndices.size === 0) return;
    autoApprovedRef.current = true;
    handleApprove();
  }, [pipeline.phase, autoDecisions, selectedSpaceIndices.size, handleApprove]);

  const toggleSpace = useCallback((index: number) => {
    setSelectedSpaceIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        if (next.size <= 1) return prev;
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleBackToEdit = useCallback(() => {
    pipeline.reset();
    setSelectedSpaceIndices(new Set());
  }, [pipeline]);

  // Phase display config — dynamic label for auto-research pass
  const autoResearchLabel = pipeline.isAutoResearch && pipeline.autoResearchInfo
    ? `${pipeline.autoResearchInfo.summary} — investigating...`
    : "Gathering domain expertise...";

  const PHASE_DISPLAY: Record<string, { label: string; icon: "spinner" | "check" | "error" }> = {
    scope: { label: "Mapping analytical areas...", icon: "spinner" },
    decomposing: { label: "Building knowledge graphs...", icon: "spinner" },
    researching: { label: autoResearchLabel, icon: "spinner" },
    critiquing: { label: "Validating & finding gaps...", icon: "spinner" },
    weaving: { label: "Discovering cross-area connections...", icon: "spinner" },
    deep_research: { label: "Running deep web research (this may take a few minutes)...", icon: "spinner" },
    interweaving: { label: "Interweaving research connections...", icon: "spinner" },
    synthesizing: { label: "Generating strategic synthesis...", icon: "spinner" },
    strategizing: { label: "Generating strategy recommendations...", icon: "spinner" },
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

      {/* Ingest controls: file upload + URL extract (hidden during processing) */}
      {!isActive && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFilePick(f);
              // reset so the same file can be chosen twice
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={ingestBusy}
            className="h-8 text-xs"
            title="Upload PDF, DOCX, TXT, Markdown, or an image (PNG/JPG/WEBP/GIF). Images are OCR'd."
          >
            {ingestBusy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Upload file
          </Button>

          <div className="flex flex-1 min-w-[220px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1">
            <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            <input
              type="url"
              placeholder="Paste an article URL…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !ingestBusy && urlInput.trim()) {
                  e.preventDefault();
                  handleUrlExtract();
                }
              }}
              disabled={ingestBusy}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleUrlExtract}
              disabled={ingestBusy || !urlInput.trim()}
              className="h-6 px-2 text-[11px]"
            >
              Extract
            </Button>
          </div>
        </div>
      )}

      {/* Source chip — visible when a file/URL was successfully ingested */}
      {ingestedSource && !isActive && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-interaxis-200 bg-interaxis-50/60 px-2.5 py-1.5 text-[11px] text-interaxis-800">
          {ingestedSource.source_type === "url" ? (
            <Link2 className="h-3 w-3 flex-shrink-0" />
          ) : (
            <FileText className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="font-medium truncate">{ingestedSource.source_name}</span>
          <span className="text-interaxis-500">·</span>
          <span>
            {ingestedSource.source_type === "image" ? "OCR · " : ""}
            {ingestedSource.num_pages ? `${ingestedSource.num_pages} pages, ` : ""}
            {ingestedSource.normalized_chars.toLocaleString()} chars
          </span>
          {ingestedSource.source_type === "image" && ingestedSource.ocr_confident === false && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
              scene
            </span>
          )}
          <button
            type="button"
            onClick={handleClearSource}
            className="ml-auto rounded p-0.5 text-interaxis-500 hover:bg-interaxis-100 hover:text-interaxis-800"
            aria-label="Clear ingested source"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Ingest error / notice */}
      {ingestError && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          {ingestError}
        </div>
      )}

      {/* Text input */}
      <div
        className="mt-3 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Textarea
          id="analyze-input"
          placeholder="Enter a concept, question, situation, or text — or drop a PDF / DOCX / image, or paste a screenshot…"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          onPaste={handlePaste}
          rows={isActive ? 4 : 8}
          className="resize-y transition-all"
          disabled={isProcessing || isPendingApproval || ingestBusy}
        />
        {isDraggingFile && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-interaxis-400 bg-interaxis-50/80 text-sm font-medium text-interaxis-700">
            Drop file to extract
          </div>
        )}
        <div className="mt-1 text-xs text-gray-400">
          {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()} characters
        </div>
      </div>

      {/* Intent capture (shown after text is pasted, hidden during processing) */}
      {!isActive && text.length >= 20 && (
        <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Tailor your analysis
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={userRole ?? ""}
              onChange={(e) => setUserRole((e.target.value || null) as UserRole | null)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400"
            >
              <option value="">Who are you?</option>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={primaryGoal ?? ""}
              onChange={(e) => setPrimaryGoal((e.target.value || null) as PrimaryGoal | null)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400"
            >
              <option value="">What do you need?</option>
              {GOAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={contextType ?? ""}
              onChange={(e) => setContextType((e.target.value || null) as ContextType | null)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400"
            >
              <option value="">What kind of situation?</option>
              {CONTEXT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {(userRole || primaryGoal || contextType) && (
            <div className="mt-1.5 text-[10px] text-gray-400">
              Optional — helps personalize insights, action plans, and recommendations.
            </div>
          )}
        </div>
      )}

      {/* Tier selector + analyze button (hidden during processing) */}
      {!isActive && text.length >= 20 && (
        <div className="mt-4 space-y-4">
          {/* Phase 4b: Auto-decisions toggle */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 text-sm text-gray-700 transition-colors hover:border-interaxis-200 hover:bg-interaxis-50/30">
            <input
              type="checkbox"
              checked={autoDecisions}
              onChange={(e) => setAutoDecisions(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-interaxis-500 focus:ring-interaxis-400"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">Auto-decisions</span>
                {autoDecisions && (
                  <span className="rounded-full bg-interaxis-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-interaxis-700">
                    On
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                Uses your preferred tier ({TIERS[preferredTier].label}) and auto-approves multi-space scope — skips the approval checkpoint.
              </p>
            </div>
          </label>

          {/* Cost-control toggles — let power users trade cost for depth when iterating */}
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Cost & depth controls
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-white p-2 text-[12px] text-gray-700 transition-colors hover:border-interaxis-200">
                <input
                  type="checkbox"
                  checked={useResearchCache}
                  onChange={(e) => setUseResearchCache(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-interaxis-500 focus:ring-interaxis-400"
                />
                <div className="flex-1">
                  <div className="font-medium">Use cached research</div>
                  <p className="text-[10px] leading-snug text-gray-500">
                    Reuse research from recent runs on the same decomposition (7-day TTL). Big cost saver when iterating.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-white p-2 text-[12px] text-gray-700 transition-colors hover:border-interaxis-200">
                <input
                  type="checkbox"
                  checked={skipResearch}
                  onChange={(e) => setSkipResearch(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-interaxis-500 focus:ring-interaxis-400"
                />
                <div className="flex-1">
                  <div className="font-medium">Skip web research</div>
                  <p className="text-[10px] leading-snug text-gray-500">
                    Use training knowledge only. Faster, cheaper — no real-time search. Overrides tier.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-gray-100 bg-white p-2 text-[12px] text-gray-700 transition-colors hover:border-interaxis-200">
                <input
                  type="checkbox"
                  checked={skipSynthesis}
                  onChange={(e) => setSkipSynthesis(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-interaxis-500 focus:ring-interaxis-400"
                />
                <div className="flex-1">
                  <div className="font-medium">Graph only</div>
                  <p className="text-[10px] leading-snug text-gray-500">
                    Skip strategy &amp; recommendation synthesis — just build the decomposition graph.
                  </p>
                </div>
              </label>
            </div>
          </div>

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

          {/* Condensed spec preview for standard tier */}
          {tier === "standard" && (
            <AnalysisSpecPreview
              config={{
                selectedSpaces: [{
                  name: "Analysis",
                  prefix: "C",
                  description: "Complete analysis of the input",
                  key_concepts: [],
                  priority: 1,
                }],
                reasoningDepth: TIER_TO_DEPTH[tier],
                tier: "standard",
                intent: {
                  user_role: userRole,
                  primary_goal: primaryGoal,
                  context_type: contextType,
                },
                crossSpace: {
                  weave: false,
                  synthesis: true,
                  externalKnowledge: false,
                  researchDepth: "training",
                },
              }}
              tier="standard"
              compact
            />
          )}

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
              {autoDecisions ? "Auto-run" : "Analyze"}
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

      {/* Approval checkpoint (multi-space tiers: after scope, before pipeline) */}
      {isPendingApproval && pipeline.scopeResult && (
        <div className="mt-4 rounded-lg border border-interaxis-200 bg-white p-4 space-y-4">
          {/* System understanding */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              System understanding
            </div>
            <p className="text-sm text-gray-700">
              {pipeline.scopeResult.summary}
            </p>
            {/* Show detected context if auto-detected and user didn't set one */}
            {!contextType && pipeline.scopeResult.detected_context && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Detected domain:</span>
                <span className="rounded-full bg-interaxis-50 border border-interaxis-200 px-2 py-0.5 text-[11px] font-medium text-interaxis-700">
                  {CONTEXT_OPTIONS.find((o) => o.value === pipeline.scopeResult!.detected_context)?.label ?? pipeline.scopeResult.detected_context}
                </span>
              </div>
            )}
          </div>

          {/* Analytical spaces with toggles */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Analytical spaces ({selectedSpaceIndices.size} of {pipeline.scopeResult.spaces.length} selected)
            </div>
            <div className="space-y-2">
              {pipeline.scopeResult.spaces.map((space, i) => {
                const isSelected = selectedSpaceIndices.has(i);
                const isLastSelected = isSelected && selectedSpaceIndices.size === 1;
                return (
                  <button
                    key={i}
                    onClick={() => toggleSpace(i)}
                    disabled={isLastSelected}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-all",
                      isSelected
                        ? "border-interaxis-300 bg-interaxis-50/40"
                        : "border-gray-200 bg-gray-50 opacity-60"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">
                        {space.prefix}. {space.name}
                      </span>
                      <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                        isSelected ? "bg-interaxis-500 border-interaxis-500" : "border-gray-300"
                      )}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{space.description}</p>
                    {space.key_concepts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {space.key_concepts.map((kc, j) => (
                          <span key={j} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                            {kc}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Analysis spec preview */}
          <AnalysisSpecPreview
            config={{
              selectedSpaces: pipeline.scopeResult.spaces.filter((_, i) => selectedSpaceIndices.has(i)),
              reasoningDepth: TIER_TO_DEPTH[tier],
              tier: tier as "standard" | "deep" | "comprehensive",
              intent: {
                user_role: userRole,
                primary_goal: primaryGoal,
                context_type: contextType ?? (pipeline.scopeResult.detected_context as ContextType | undefined) ?? null,
              },
              crossSpace: {
                weave: selectedSpaceIndices.size >= 2,
                synthesis: true,
                externalKnowledge: tier === "deep" || tier === "comprehensive",
                researchDepth: tier === "comprehensive" ? "deep" : tier === "deep" ? "standard" : "training",
              },
            }}
            tier={tier}
            scopeResult={pipeline.scopeResult}
          />

          {/* Cost + actions */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <div className="text-xs text-gray-500">
              <span className="font-medium">{tierConfig.credits} credits</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{tierConfig.time}</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{selectedSpaceIndices.size} space{selectedSpaceIndices.size !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleBackToEdit}>
                Back to edit
              </Button>
              <Button size="sm" onClick={handleApprove} disabled={selectedSpaceIndices.size === 0}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Proceed with analysis
              </Button>
            </div>
          </div>
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

      {/* Progress: Standard/Deep/Comprehensive (pipeline) — Telemetry Panel */}
      {isActive && usePipelinePath && !isPendingApproval && (
        <PipelineTelemetryPanel
          phase={pipeline.phase}
          telemetry={pipeline.telemetry}
          spaces={pipeline.spaces}
          isMultiSpace={isMultiSpace}
          tier={tier}
          elapsedMs={elapsedMs}
          phaseDisplay={PHASE_DISPLAY}
          isAutoResearch={pipeline.isAutoResearch}
          autoResearchInfo={pipeline.autoResearchInfo}
        />
      )}

      {/* Reset button */}
      {isActive && !isProcessing && !isPendingApproval && (
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
