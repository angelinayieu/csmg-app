"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown, Clipboard, Blocks, AlertTriangle, Link, BookOpen, Zap } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Ring } from "@/components/ui/ring";
import { StatusBadge } from "@/components/ui/status-badge";
import { CalloutBox } from "@/components/ui/callout-box";
import { ExpandableCard } from "@/components/ui/expandable-card";
import { IntensityDot } from "@/components/ui/intensity-dot";
import { TieredList } from "@/components/ui/tiered-list";
import { LeverageCard } from "./leverage-card";
import { RiskCard } from "./risk-card";
import { ConditionalActionPlan } from "./conditional-action-plan";
import { ExternalContextSection } from "./external-context-section";
import { CrossContextSection } from "./cross-context-section";
import { ConvergenceGallery } from "./convergence-gallery";
import { ResearchProvenanceSection } from "./research-provenance-section";
import { PerspectiveDeltaPanel } from "./perspective-delta-panel";
import type {
  Space,
  Entity,
  Cycle,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Proposition,
  Bridge,
} from "@/types";
import type { SynthesisData, SynthesisQualityScore, GoalFitnessResult, RichBottleneck, RichFeedbackLoop, RichOpenQuestion, WorthConsidering, CrossContextInsight, ResearchProvenance, InsightStatus, QualityFlag, AssumptionInversion, SignalToAction, Axiom, InsightConvergence, ConvergenceSignal, HiddenSignalData, StrategyCoverageAudit } from "@/types/synthesis";
import type { AnalysisRun } from "@/types/analysis-runs";
import { humanAge } from "@/lib/pipeline/cache";
import { AnalysisTrailPanel } from "./analysis-trail-panel";
// Phase 4c: UPF — info-gain/friction-based "recommended next question" selector
import { questionToDescriptor } from "@/lib/upf/score-questions";
import { selectNextProxy } from "@/lib/upf/select-next";
// Phase 4c-final: posterior-aware ranking so answered constructs stop re-surfacing
import { makePosteriorLookup, type PosteriorMap } from "@/lib/upf/posterior";
import { KnownnessPill } from "@/components/ui/knownness-pill";

// Human-readable labels + explanations for quality flags (surfaces what the
// synthesis quality scorer detected so the user knows what to re-run or review).
const QUALITY_FLAG_LABELS: Record<QualityFlag, { label: string; description: string }> = {
  shallow_leverage: {
    label: "Shallow leverage",
    description: "Leverage points lack specific mechanisms. Run Deepen for more rigorous reasoning.",
  },
  generic_actions: {
    label: "Generic actions",
    description: "Action items are too abstract — they don't reference specific entities. Re-synthesize for concrete actions.",
  },
  overconfident: {
    label: "Overconfident",
    description: "Synthesis claims high confidence despite sparse evidence. Treat conclusions as directional.",
  },
  ungrounded_risk: {
    label: "Ungrounded risk",
    description: "Risk points don't explain the failure mechanism. Deepen to surface the 'how'.",
  },
  missing_dynamics: {
    label: "Missing dynamics",
    description: "Few feedback loops detected. Hidden system dynamics may not be surfaced yet.",
  },
  stale_evidence: {
    label: "Stale evidence",
    description: "Evidence hasn't been refreshed recently. Run research to update.",
  },
  weak_external_coverage: {
    label: "Weak external coverage",
    description: "Few external references. Deeper research would ground findings in domain knowledge.",
  },
  unexpanded_critical: {
    label: "Unexpanded critical node",
    description: "A critical entity hasn't been decomposed. Expanding it may reveal hidden structure.",
  },
  missing_epistemic_framework: {
    label: "Missing epistemic framework",
    description: "Synthesis didn't classify the claim type (causal / comparative / normative). Reasoning depth is limited.",
  },
  causal_level_mismatch: {
    label: "Causal level mismatch",
    description: "Causal chains mix abstract and concrete levels, reducing actionability.",
  },
};
import type { PerspectiveDelta } from "@/types/execution-brief";

// Layer re-run button — used in the provenance chip to force a specific pipeline
// stage to re-run. Leverages force / cacheMode params we added to synthesize/research.
function ReRunButton({
  label,
  title,
  endpoint,
  body,
  needsInputSummary = false,
}: {
  label: string;
  title: string;
  endpoint: string;
  body: Record<string, unknown>;
  needsInputSummary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setDone(false);
    try {
      let finalBody = body;
      if (needsInputSummary && !("inputSummary" in body)) {
        // /research requires an inputSummary. Use a terse placeholder synthesized
        // from the space name when no original input text is reachable from this
        // context. The route treats this leniently.
        finalBody = { ...body, inputSummary: "Refresh research against current decomposition." };
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalBody),
      });
      if (res.ok) {
        setDone(true);
        // Reload so the UI reflects new synthesis_data. (Follow-up: hot-swap via router.refresh())
        setTimeout(() => window.location.reload(), 400);
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={title}
      className={cn(
        "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
        done
          ? "bg-green-100 text-green-700"
          : busy
            ? "bg-gray-200 text-gray-500 cursor-wait"
            : "bg-white border border-gray-200 text-gray-600 hover:border-interaxis-300 hover:text-interaxis-700",
      )}
    >
      {busy ? "running…" : done ? "✓ queued" : label}
    </button>
  );
}

// Phase 4b: priority metadata for open-question pills + sort order
type OpenQuestionPriority = "critical" | "high" | "medium";
const PRIORITY_META: Record<OpenQuestionPriority, { label: string; pill: string; rank: number }> = {
  critical: {
    label: "Critical",
    pill: "bg-red-100 text-red-700 border-red-200",
    rank: 0,
  },
  high: {
    label: "High",
    pill: "bg-amber-100 text-amber-700 border-amber-200",
    rank: 1,
  },
  medium: {
    label: "Medium",
    pill: "bg-gray-100 text-gray-600 border-gray-200",
    rank: 2,
  },
};

function priorityRank(p?: string): number {
  if (p === "critical") return 0;
  if (p === "high") return 1;
  if (p === "medium") return 2;
  return 3; // unranked sinks below medium but above answered
}

// Phase 4b: inline-answerable open question card.
// Handles POST /api/spaces/[id]/open-questions for submit + DELETE for clear.
// Phase 4c: optional `spotlight` prop — when true, renders a "Recommended next"
// halo + tooltip with the UPF info-gain breakdown.
function OpenQuestionCard({
  question,
  index,
  spaceId,
  onMutated,
  spotlight,
}: {
  question: RichOpenQuestion;
  index: number;
  spaceId: string;
  onMutated: () => void;
  spotlight?: {
    info_bits: number;
    friction: number;
    value_per_friction: number;
    rationale: string;
  } | null;
}) {
  const [draft, setDraft] = useState<string>(question.user_answer ?? "");
  const [editing, setEditing] = useState<boolean>(!question.user_answer);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const priority = (question.priority ?? null) as OpenQuestionPriority | null;
  const priorityMeta = priority ? PRIORITY_META[priority] : null;

  async function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError("Answer cannot be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/open-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, answer: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      onMutated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/open-questions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      setEditing(true);
      onMutated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasAnswer = !!question.user_answer && question.user_answer.trim().length > 0;
  const isSpotlit = !!spotlight && !hasAnswer;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isSpotlit
          ? "border-interaxis-300 bg-interaxis-50/50 ring-2 ring-interaxis-200/50 shadow-sm"
          : hasAnswer
            ? "border-emerald-200 bg-emerald-50/40"
            : "border-gray-200 bg-gray-50/60"
      )}
    >
      {isSpotlit && spotlight && (
        <div
          className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-interaxis-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-interaxis-700"
          title={`Info-gain: ${spotlight.info_bits.toFixed(2)} bits · Friction: ${spotlight.friction.toFixed(2)} · Score: ${spotlight.value_per_friction.toFixed(1)} · ${spotlight.rationale}`}
        >
          <span>🎯</span>
          <span>Recommended next · {spotlight.value_per_friction.toFixed(1)}× value/friction</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-gray-800">{question.question}</p>
        {priorityMeta && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              priorityMeta.pill
            )}
            title={question.ranking_reason ?? undefined}
          >
            {priorityMeta.label}
          </span>
        )}
      </div>

      {question.why_it_matters && (
        <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
          {question.why_it_matters}
        </p>
      )}
      {question.what_changes && (
        <div className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-600">
          If resolved: {question.what_changes}
        </div>
      )}
      {question.ranking_reason && priorityMeta && (
        <p className="mt-1.5 text-[11px] italic text-gray-400">
          Why {priorityMeta.label.toLowerCase()}: {question.ranking_reason}
        </p>
      )}

      {hasAnswer && !editing ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-white px-2.5 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">
            Your answer
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-800">
            {question.user_answer}
          </p>
          {question.answered_at && (
            <p className="mt-1 text-[10px] text-gray-400">
              Answered {new Date(question.answered_at).toLocaleString()}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type your answer — the next strategy refresh will use it as a factual anchor."
            rows={3}
            className="w-full resize-none rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-800 placeholder-gray-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
            disabled={busy}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || draft.trim().length === 0}
              className="rounded-md bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : hasAnswer ? "Save changes" : "Submit answer"}
            </button>
            {hasAnswer && (
              <button
                type="button"
                onClick={() => {
                  setDraft(question.user_answer ?? "");
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p className="mt-1.5 text-[11px] text-red-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface SynthesisViewProps {
  space: Space;
  entities: Entity[];
  cycles: Cycle[];
  novelConnections: NovelConnection[];
  contradictions: Contradiction[];
  scenarios: Scenario[];
  actionItems: ActionItem[];
  propositions: Proposition[];
  bridges?: Bridge[];
  domainMap?: Record<string, { name: string; index: number }>;
  onToggleActionDone?: (actionId: string, done: boolean) => void;
}

export function SynthesisView({
  space,
  entities,
  cycles,
  novelConnections,
  contradictions,
  scenarios,
  actionItems,
  propositions,
  bridges = [],
  domainMap = {},
  onToggleActionDone,
}: SynthesisViewProps) {
  // Phase 4b: used to refresh the page after answering / clearing open questions
  const router = useRouter();
  // Phase 4b: local busy flag for the "Refresh strategy" CTA in the open-questions section
  const [refreshingStrategy, setRefreshingStrategy] = useState<boolean>(false);

  // Parse rich synthesis data from space
  const synthData = useMemo<SynthesisData | null>(() => {
    if (!space.synthesis_data) return null;
    try {
      return (typeof space.synthesis_data === "string"
        ? JSON.parse(space.synthesis_data)
        : space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [space.synthesis_data]);

  const bottleneckEntity = useMemo(
    () => entities.find((e) => e.is_master_bottleneck),
    [entities]
  );

  const richBottleneck: RichBottleneck | null = synthData?.master_bottleneck ?? null;

  const leverageEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_leverage_point)
        .sort((a, b) => (a.centrality_rank ?? 99) - (b.centrality_rank ?? 99)),
    [entities]
  );

  const riskEntities = useMemo(
    () =>
      entities
        .filter((e) => e.is_risk_point)
        .sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0)),
    [entities]
  );

  const openQuestions = useMemo(
    () => propositions.filter((p) => p.proposition_type === "irreducible"),
    [propositions]
  );

  const entityMap = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) {
      map.set(e.entity_id, e);
    }
    return map;
  }, [entities]);

  const externalEntities = useMemo(
    () => entities.filter((e) => e.knowledge_layer === "external"),
    [entities]
  );

  const crossContextInsights = useMemo<CrossContextInsight[]>(() => {
    // Prefer synthesis LLM's cross_context_insights (produced with full graph context)
    if (synthData?.cross_context_insights?.length) return synthData.cross_context_insights;
    // Fall back to Agent 7's research insights if synthesis didn't produce its own
    const sd = synthData as Record<string, unknown> | null;
    if (Array.isArray(sd?.agent7_cross_context_insights) && (sd.agent7_cross_context_insights as unknown[]).length > 0) {
      return (sd.agent7_cross_context_insights as Array<{
        insight: string;
        external_entities_involved?: string[];
        confidence?: string;
        type?: string;
      }>).map((ins) => ({
        insight: ins.insight,
        internal_entities: [],
        external_entities: ins.external_entities_involved ?? [],
        confidence: (ins.confidence as "high" | "moderate" | "low") ?? "moderate",
      }));
    }
    return (sd?.cross_context_insights ?? []) as CrossContextInsight[];
  }, [synthData]);

  // Extract convergence insights from interaction metadata
  const convergenceInsights = useMemo(() => {
    const sd = synthData as Record<string, unknown> | null;
    const meta = sd?.interaction_metadata as Record<string, unknown> | null;
    return (meta?.convergences ?? []) as import("@/types/interactions").ConvergenceInsight[];
  }, [synthData]);

  // Build entity UUID → entity lookup for bridge rendering
  const entityByUuid = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const e of entities) map.set(e.id, e);
    return map;
  }, [entities]);

  // Build space name lookup from domainMap
  const spaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const [spaceId, { name }] of Object.entries(domainMap)) {
      map.set(spaceId, name);
    }
    return map;
  }, [domainMap]);

  const hasContent =
    bottleneckEntity ||
    leverageEntities.length > 0 ||
    riskEntities.length > 0 ||
    cycles.length > 0 ||
    scenarios.length > 0 ||
    novelConnections.length > 0 ||
    contradictions.length > 0 ||
    openQuestions.length > 0 ||
    actionItems.length > 0 ||
    externalEntities.length > 0 ||
    bridges.length > 0 ||
    synthData !== null;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm text-gray-500">
          No synthesis data available for this space yet.
        </p>
        {space.synthesis_text && (
          <p className="mt-2 max-w-md text-xs text-gray-400">
            {space.synthesis_text}
          </p>
        )}
      </div>
    );
  }

  const qualityScore: SynthesisQualityScore | undefined = synthData?.quality_score;
  const goalFitness: GoalFitnessResult | undefined = synthData?.goal_fitness;

  const [qualityExpanded, setQualityExpanded] = useState(false);

  // Insight action statuses (local state — future: persist to synthesis_data JSONB)
  const [leverageStatuses, setLeverageStatuses] = useState<Record<string, InsightStatus>>({});
  const [riskStatuses, setRiskStatuses] = useState<Record<string, InsightStatus>>({});
  const [crossContextStatuses, setCrossContextStatuses] = useState<Record<number, InsightStatus>>({});

  return (
    <div className="space-y-6 pb-8">
      {/* Quality Score & Goal Fitness indicators */}
      {(qualityScore || goalFitness) && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          {/* Collapsed row: badges + expand toggle */}
          <button
            type="button"
            onClick={() => setQualityExpanded((v) => !v)}
            className="flex w-full items-center gap-3"
          >
            {/* Quality badge */}
            {qualityScore && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Quality
                </span>
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white",
                    qualityScore.overall >= 70
                      ? "bg-green-500"
                      : qualityScore.overall >= 40
                        ? "bg-amber-500"
                        : "bg-red-500"
                  )}
                >
                  {qualityScore.overall}
                </span>
              </div>
            )}

            {/* Goal Fitness badge */}
            {goalFitness && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Goal Fit
                </span>
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white",
                    goalFitness.score >= 70
                      ? "bg-green-500"
                      : goalFitness.score >= 40
                        ? "bg-amber-500"
                        : "bg-red-500"
                  )}
                >
                  {goalFitness.score}
                </span>
              </div>
            )}

            {/* Quality flags inline (collapsed preview) */}
            {!qualityExpanded && qualityScore?.flags && qualityScore.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {qualityScore.flags.slice(0, 3).map((flag) => {
                  const meta = QUALITY_FLAG_LABELS[flag];
                  return (
                    <span
                      key={flag}
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                      title={meta?.description ?? flag}
                    >
                      {meta?.label ?? flag.replace(/_/g, " ")}
                    </span>
                  );
                })}
                {qualityScore.flags.length > 3 && (
                  <span className="text-[10px] text-gray-400">
                    +{qualityScore.flags.length - 3}
                  </span>
                )}
              </div>
            )}

            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform",
                qualityExpanded && "rotate-180"
              )}
            />
          </button>

          {/* Expanded details */}
          {qualityExpanded && (
            <div className="mt-4 space-y-4">
              {/* Quality dimension bars */}
              {qualityScore && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold text-gray-500">
                    Quality Dimensions
                  </div>
                  <div className="space-y-1.5">
                    {(
                      Object.entries(qualityScore.dimensions) as [string, number][]
                    ).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-28 text-[11px] text-gray-600 capitalize">
                          {key.replace(/_/g, " ")}
                        </span>
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                          <div
                            className={cn(
                              "h-1.5 rounded-full transition-all",
                              value >= 70
                                ? "bg-green-400"
                                : value >= 40
                                  ? "bg-amber-400"
                                  : "bg-red-400"
                            )}
                            style={{ width: `${value}%` }}
                          />
                        </div>
                        <span className="w-7 text-right text-[11px] font-medium text-gray-500">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Quality flags */}
                  {qualityScore.flags.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[11px] font-semibold text-gray-500">
                        Issues detected
                      </div>
                      <div className="space-y-1.5">
                        {qualityScore.flags.map((flag) => {
                          const meta = QUALITY_FLAG_LABELS[flag];
                          const isSevere = flag === "overconfident" || flag === "ungrounded_risk" || flag === "shallow_leverage";
                          return (
                            <div
                              key={flag}
                              className={cn(
                                "rounded-md border px-2.5 py-1.5 text-[11px]",
                                isSevere
                                  ? "border-red-200 bg-red-50"
                                  : "border-amber-200 bg-amber-50",
                              )}
                            >
                              <div className={cn(
                                "font-semibold",
                                isSevere ? "text-red-700" : "text-amber-700",
                              )}>
                                {meta?.label ?? flag.replace(/_/g, " ")}
                              </div>
                              {meta?.description && (
                                <div className="mt-0.5 text-[11px] leading-snug text-gray-600">
                                  {meta.description}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Goal Fitness details */}
              {goalFitness && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold text-gray-500">
                    Goal Fitness
                  </div>

                  {/* Path counts */}
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-lg border border-green-200 bg-green-50/40 px-3 py-2">
                      <div className="text-lg font-bold text-green-600">
                        {goalFitness.on_critical_path.length}
                      </div>
                      <div className="text-[10px] text-gray-500">on critical path</div>
                    </div>
                    <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50/40 px-3 py-2">
                      <div className="text-lg font-bold text-gray-500">
                        {goalFitness.off_critical_path.length}
                      </div>
                      <div className="text-[10px] text-gray-500">off critical path</div>
                    </div>
                  </div>

                  {/* Status chips */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {goalFitness.bottleneck_blocks_goal && (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-medium text-green-700">
                        Bottleneck blocks goal
                      </span>
                    )}
                    {!goalFitness.bottleneck_blocks_goal && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Bottleneck not on critical path
                      </span>
                    )}
                    {goalFitness.action_plan_addresses_goal && (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-medium text-green-700">
                        Actions address goal
                      </span>
                    )}
                    {!goalFitness.action_plan_addresses_goal && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-medium text-amber-700">
                        No goal-aligned actions
                      </span>
                    )}
                  </div>

                  {/* Issues */}
                  {goalFitness.issues.length > 0 && (
                    <div className="mt-2.5 space-y-1">
                      {goalFitness.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-[11px]",
                            issue.severity === "error"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                          )}
                        >
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Goal Trajectory Estimate + Continuation Signals + Regen Metadata */}
      {(() => {
        const sd = synthData as Record<string, unknown> | null;
        const traj = sd?.goal_trajectory_estimate as { estimated_weeks: number; confidence: string; critical_path: string[] } | undefined;
        const contSignals = sd?.continuation_signals as Array<{ type: string; description: string; priority: string; follow_up_queries?: string[] }> | undefined;
        const regenMeta = sd?.regen_metadata as { attempted: boolean; original_score: number; regen_score: number | null; flags_addressed: string[]; kept: string } | undefined;
        if (!traj && !contSignals?.length && !regenMeta?.attempted) return null;
        return (
          <section className="space-y-3">
            {/* Trajectory */}
            {traj && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
                <SectionHeader label="Goal Trajectory Estimate" color="blue" />
                <div className="mt-3 flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-700">{traj.estimated_weeks}</div>
                    <div className="text-[10px] text-gray-500">weeks</div>
                  </div>
                  <div>
                    <span className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      traj.confidence === "high" ? "bg-green-100 text-green-700" : traj.confidence === "moderate" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    )}>
                      {traj.confidence} confidence
                    </span>
                  </div>
                </div>
                {traj.critical_path?.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-gray-500 mb-1.5">Critical Path</div>
                    <div className="flex flex-wrap items-center gap-1">
                      {traj.critical_path.map((step, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span className="text-blue-300 text-xs">&rarr;</span>}
                          <span className="rounded-lg bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">{step}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Continuation Signals */}
            {contSignals && contSignals.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/20 p-4">
                <SectionHeader label="Research Continuation Signals" color="amber" subtitle="Gaps identified during multi-pass research" />
                <div className="mt-3 space-y-2">
                  {contSignals.map((sig, i) => (
                    <div key={i} className={cn(
                      "rounded-lg border px-3 py-2",
                      sig.priority === "critical" ? "border-red-200 bg-red-50/40" : sig.priority === "high" ? "border-amber-200 bg-amber-50/40" : "border-gray-200 bg-gray-50/40"
                    )}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", sig.priority === "critical" ? "bg-red-100 text-red-700" : sig.priority === "high" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600")}>
                          {sig.priority}
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">{sig.type.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-[12px] text-gray-700">{sig.description}</p>
                      {sig.follow_up_queries && sig.follow_up_queries.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {sig.follow_up_queries.map((q, j) => (
                            <span key={j} className="rounded bg-amber-100/50 px-1.5 py-0.5 text-[9px] text-amber-600 italic">{q}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Regen Metadata */}
            {regenMeta?.attempted && (
              <div className={cn("rounded-xl border p-3 flex items-center gap-3 text-[11px]", regenMeta.kept === "regen" ? "border-green-200 bg-green-50/30" : "border-gray-200 bg-gray-50/30")}>
                <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <div>
                  <span className="font-medium text-gray-700">
                    Auto-regeneration {regenMeta.kept === "regen" ? "improved quality" : "attempted (original kept)"}
                  </span>
                  <span className="ml-2 text-gray-500">
                    {regenMeta.original_score} → {regenMeta.regen_score ?? "—"}
                  </span>
                  {regenMeta.flags_addressed.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {regenMeta.flags_addressed.map((flag) => (
                        <span key={flag} className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-600">{flag.replace(/_/g, " ")}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Perspective Delta: quick vs deep analysis comparison */}
      {synthData?.perspective_delta && (
        <PerspectiveDeltaPanel delta={synthData.perspective_delta as PerspectiveDelta} />
      )}

      {/* Synthesis Hero: single most important takeaway */}
      {bottleneckEntity && (
        <div className="pt-4 pb-2">
          <h2 className="text-[24px] font-bold leading-tight tracking-tight text-gray-900">
            {bottleneckEntity.name} is the primary constraint
          </h2>
          {(richBottleneck?.summary ?? bottleneckEntity.description) && (
            <p className="mt-2 text-[16px] leading-relaxed text-gray-500">
              {richBottleneck?.summary ?? bottleneckEntity.description}
            </p>
          )}
        </div>
      )}
      {!bottleneckEntity && leverageEntities.length > 0 && (
        <div className="pt-4 pb-2">
          <h2 className="text-[24px] font-bold leading-tight tracking-tight text-gray-900">
            {leverageEntities[0].name}
          </h2>
          {leverageEntities[0].description && (
            <p className="mt-2 text-[16px] leading-relaxed text-gray-500">
              {leverageEntities[0].description}
            </p>
          )}
        </div>
      )}

      {/* Section -3: Analysis trail — collapsible, filterable log (Apple-Vision-Pro-style glass surface) */}
      {(() => {
        const runs = (synthData as unknown as { analysis_runs?: AnalysisRun[] } | null)?.analysis_runs;
        if (!runs || runs.length === 0) return null;
        const latestResearchRun = runs.find((r) => r.pipeline === "research" || r.pipeline === "research_deep");
        const cacheAge = latestResearchRun ? humanAge(latestResearchRun.completed_at ?? latestResearchRun.started_at) : null;
        return (
          <div className="flex flex-col gap-2">
            <AnalysisTrailPanel runs={runs} />
            {/* Research freshness + layer re-run affordances */}
            <div className="flex items-center justify-between gap-2 px-1">
              {cacheAge ? (
                <div className="text-[10px] text-gray-400 pl-1">
                  Research cached <span className="text-gray-600 font-medium">{cacheAge}</span> · 7-day TTL
                </div>
              ) : (
                <div />
              )}
              <div className="flex gap-1">
                <ReRunButton
                  label="Re-synthesize"
                  title="Force a fresh synthesis pass, bypassing the lazy-skip fingerprint guard"
                  endpoint="/api/pipeline/synthesize"
                  body={{ spaceIds: [space.id], force: true, useLazyGuard: false }}
                />
                <ReRunButton
                  label="Fresh research"
                  title="Force a fresh /research call, bypassing the 7-day cache"
                  endpoint="/api/pipeline/research"
                  body={{ spaceIds: [space.id], cacheMode: "skip" }}
                  needsInputSummary
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Section -2: Strategy coverage audit — do actions address every critical finding? */}
      {synthData?.strategy_coverage && (synthData.strategy_coverage.gaps.length > 0 || synthData.strategy_coverage.overall_coverage < 100) && (() => {
        const cov = synthData.strategy_coverage as StrategyCoverageAudit;
        const pctColor =
          cov.overall_coverage >= 80 ? "bg-green-500" :
          cov.overall_coverage >= 50 ? "bg-amber-500" : "bg-red-500";
        const gapKindLabel: Record<StrategyCoverageAudit["gaps"][number]["kind"], { label: string; cls: string }> = {
          hidden_axiom: { label: "Hidden axiom", cls: "bg-red-100 text-red-700 border-red-200" },
          critical_axiom: { label: "Critical axiom", cls: "bg-purple-100 text-purple-700 border-purple-200" },
          critical_risk: { label: "Critical risk", cls: "bg-orange-100 text-orange-700 border-orange-200" },
          high_impact_signal: { label: "High-impact signal", cls: "bg-amber-100 text-amber-700 border-amber-200" },
        };
        return (
          <section className="rounded-xl border border-gray-300 bg-white p-5">
            <div className="flex items-center gap-3">
              <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white", pctColor)}>
                {cov.overall_coverage}%
              </span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900">Strategy coverage</div>
                <div className="text-[11px] text-gray-500">
                  {cov.gaps.length === 0
                    ? "All critical findings are addressed by the action plan."
                    : `${cov.gaps.length} finding${cov.gaps.length === 1 ? "" : "s"} not addressed by any action. The strategy is incomplete with respect to the analysis.`}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: "Critical axioms", total: cov.totals.critical_axioms, addr: cov.addressed_counts.critical_axioms },
                { label: "Hidden axioms", total: cov.totals.hidden_axioms, addr: cov.addressed_counts.hidden_axioms },
                { label: "Critical risks", total: cov.totals.critical_risks, addr: cov.addressed_counts.critical_risks },
                { label: "Hidden signals", total: cov.totals.high_impact_signals, addr: cov.addressed_counts.high_impact_signals },
              ].map((t) => {
                const covered = t.total === 0 ? 100 : Math.round((t.addr / t.total) * 100);
                return (
                  <div key={t.label} className="rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-1.5">
                    <div className="text-[18px] font-bold text-gray-900">
                      {t.addr}<span className="text-[11px] font-normal text-gray-400">/{t.total}</span>
                    </div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500">{t.label}</div>
                    <div className="mt-1 h-1 rounded-full bg-gray-200">
                      <div
                        className={cn("h-1 rounded-full", covered >= 80 ? "bg-green-400" : covered >= 50 ? "bg-amber-400" : "bg-red-400")}
                        style={{ width: `${covered}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {cov.gaps.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Uncovered findings ({cov.gaps.length})
                </div>
                {cov.gaps.map((gap) => {
                  const gk = gapKindLabel[gap.kind];
                  return (
                    <div key={gap.id} className={cn("rounded-md border px-2.5 py-1.5", gk.cls)}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-white/70">
                          {gk.label}
                        </span>
                        <span className="font-mono text-[9px] text-gray-500">{gap.id}</span>
                        <span className="text-[12px] font-medium text-gray-900">{gap.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-gray-600">{gap.why_important}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* Section -1: Insight Convergences — cross-mechanism insight fusion
          (distinct from Cross-Category Convergences below, which operate at graph-category level) */}
      {synthData?.insight_convergences && synthData.insight_convergences.length > 0 && (
        <section className="rounded-xl border border-indigo-300 bg-gradient-to-b from-indigo-50/60 to-white p-5 shadow-sm">
          <SectionHeader
            label="Converging insight signals"
            color="purple"
            subtitle="Concerns independently surfaced by multiple pipeline mechanisms — the most trustworthy findings"
          />
          <div className="mt-3 space-y-3">
            {synthData.insight_convergences.map((cluster: InsightConvergence) => {
              const strengthCfg: Record<InsightConvergence["strength"], { label: string; cls: string; ring: string }> = {
                strong: { label: "Strong", cls: "bg-indigo-600 text-white", ring: "ring-2 ring-indigo-400" },
                moderate: { label: "Moderate", cls: "bg-indigo-400 text-white", ring: "" },
                weak: { label: "Weak", cls: "bg-gray-300 text-gray-700", ring: "" },
              };
              const typeCfg: Record<ConvergenceSignal["type"], { label: string; cls: string }> = {
                axiom: { label: "Axiom", cls: "bg-purple-100 text-purple-700" },
                bottleneck: { label: "Bottleneck", cls: "bg-red-100 text-red-700" },
                leverage: { label: "Leverage", cls: "bg-blue-100 text-blue-700" },
                risk: { label: "Risk", cls: "bg-orange-100 text-orange-700" },
                signal: { label: "Hidden signal", cls: "bg-amber-100 text-amber-700" },
                inversion: { label: "Inversion", cls: "bg-pink-100 text-pink-700" },
                blind_spot: { label: "Blind spot", cls: "bg-rose-100 text-rose-700" },
                open_question: { label: "Open Q", cls: "bg-gray-100 text-gray-600" },
              };
              const s = strengthCfg[cluster.strength];
              return (
                <div
                  key={cluster.cluster_id}
                  className={cn(
                    "rounded-lg border border-indigo-200 bg-white p-4",
                    s.ring,
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", s.cls)}>
                          {s.label}
                        </span>
                        <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          {cluster.signal_count} signals · {cluster.distinct_type_count} types
                        </span>
                        {cluster.has_hidden_axiom && (
                          <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                            Hidden axiom involved
                          </span>
                        )}
                      </div>
                      <h3 className="text-[14px] font-semibold text-gray-900">
                        {cluster.concern_label}
                      </h3>
                    </div>
                  </div>

                  {cluster.shared_entity_ids.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] font-semibold text-gray-500">Shared entities:</span>
                      {cluster.shared_entity_ids.slice(0, 6).map((eid) => {
                        const e = entityMap.get(eid);
                        return (
                          <span
                            key={eid}
                            className="rounded-full bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                          >
                            {eid}{e ? `: ${e.name}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-3 space-y-1.5 rounded-md bg-indigo-50/30 p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
                      Independent signals ({cluster.signals.length})
                    </div>
                    {cluster.signals.map((sig) => {
                      const tc = typeCfg[sig.type];
                      return (
                        <div
                          key={sig.id}
                          className="flex items-start gap-2 rounded border border-indigo-100 bg-white px-2 py-1.5"
                        >
                          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", tc.cls)}>
                            {tc.label}
                          </span>
                          <span className="font-mono text-[9px] text-gray-400 pt-0.5">
                            {sig.id}
                          </span>
                          <p className="text-[12px] leading-snug text-gray-700">
                            {sig.summary}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 0: Load-bearing Axioms (Tier 7) */}
      {synthData?.axioms && synthData.axioms.length > 0 && (
        <section className="rounded-xl border border-purple-200 bg-purple-50/30 p-5">
          <SectionHeader
            label="Load-bearing axioms"
            color="purple"
            subtitle="Assumptions the entire analysis rests on — if false, the structure collapses"
          />
          <div className="mt-3 space-y-2">
            {synthData.axioms.map((ax: Axiom) => {
              const visConfig: Record<Axiom["visibility"], { label: string; cls: string }> = {
                HIDDEN: { label: "Hidden", cls: "bg-red-100 text-red-700 border-red-200" },
                IMPLICIT: { label: "Implicit", cls: "bg-amber-100 text-amber-700 border-amber-200" },
                EXPLICIT: { label: "Explicit", cls: "bg-gray-100 text-gray-600 border-gray-200" },
              };
              const scopeConfig: Record<Axiom["scope"], { label: string; cls: string }> = {
                frame: { label: "Frame", cls: "bg-purple-100 text-purple-700" },
                chain: { label: "Chain", cls: "bg-blue-100 text-blue-700" },
                edge: { label: "Edge", cls: "bg-green-100 text-green-700" },
                node: { label: "Node", cls: "bg-gray-100 text-gray-600" },
              };
              const lbConfig: Record<Axiom["load_bearing"], string> = {
                critical: "bg-red-50 text-red-600 border-red-200",
                important: "bg-amber-50 text-amber-600 border-amber-200",
                moderate: "bg-gray-50 text-gray-500 border-gray-200",
              };
              const v = visConfig[ax.visibility];
              const s = scopeConfig[ax.scope];
              return (
                <div
                  key={ax.axiom_id}
                  className="rounded-lg border border-purple-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] font-semibold text-purple-600">
                      {ax.axiom_id}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", v.cls)}>
                      {v.label}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", s.cls)}>
                      {s.label}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", lbConfig[ax.load_bearing])}>
                      {ax.load_bearing}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      confidence: {ax.confidence}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] font-semibold leading-snug text-gray-900">
                    {ax.claim}
                  </p>
                  {ax.if_false && (
                    <div className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                      <span className="font-semibold">If false: </span>
                      {ax.if_false}
                    </div>
                  )}
                  {ax.scope_anchor && (
                    <div className="mt-1.5 text-[11px] text-gray-600">
                      <span className="font-semibold text-gray-500">Attaches to: </span>
                      {ax.scope_anchor}
                    </div>
                  )}
                  {ax.rests_on.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-gray-400">Rests on:</span>
                      {ax.rests_on.map((eid) => {
                        const e = entityMap.get(eid);
                        return (
                          <span
                            key={eid}
                            className="rounded-full bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                          >
                            {eid}{e ? `: ${e.name}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ax.validation_path && (
                    <div className="mt-1.5 text-[11px] italic text-gray-500">
                      Test: {ax.validation_path}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 0b: Expansion axioms — mini-axioms produced by whiteboard /expand calls.
          Grouped by parent entity. Apple-Vision-Pro-style: glass surface, restrained accent, hierarchy via typography. */}
      {(() => {
        const expansionAxioms = (synthData as unknown as { expansion_axioms?: Array<{ claim: string; visibility: "EXPLICIT" | "IMPLICIT" | "HIDDEN"; load_bearing: "critical" | "important" | "moderate"; rests_on_components: string[]; if_false: string; validation_path: string; parent_entity_id: string }> } | null)?.expansion_axioms;
        if (!expansionAxioms || expansionAxioms.length === 0) return null;
        // Group by parent_entity_id
        const byParent = new Map<string, typeof expansionAxioms>();
        for (const ax of expansionAxioms) {
          const list = byParent.get(ax.parent_entity_id) ?? [];
          list.push(ax);
          byParent.set(ax.parent_entity_id, list);
        }
        // Find parent entity names from UUID
        const parentEntityByUuid = new Map<string, { entity_id: string; name: string }>();
        for (const e of entities) parentEntityByUuid.set(e.id, { entity_id: e.entity_id, name: e.name });

        return (
          <section className="rounded-2xl border border-sky-200/60 bg-gradient-to-br from-sky-50/40 to-white backdrop-blur-sm p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <SectionHeader
              label="Expansion axioms"
              color="blue"
              subtitle={`${expansionAxioms.length} assumption${expansionAxioms.length === 1 ? "" : "s"} surfaced across ${byParent.size} decomposed entit${byParent.size === 1 ? "y" : "ies"}`}
            />
            <div className="mt-4 space-y-4">
              {Array.from(byParent.entries()).map(([parentUuid, axs]) => {
                const parentInfo = parentEntityByUuid.get(parentUuid);
                return (
                  <div key={parentUuid} className="rounded-xl border border-gray-200/60 bg-white/70 backdrop-blur-sm px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-gray-100">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-gray-400 tabular-nums">
                          {parentInfo?.entity_id ?? "?"}
                        </span>
                        <span className="text-[13px] font-semibold text-gray-900 truncate">
                          {parentInfo?.name ?? "Unknown entity"}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {axs.length} axiom{axs.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {axs.map((ax, i) => {
                        const visCfg: Record<typeof ax.visibility, { label: string; cls: string }> = {
                          HIDDEN: { label: "Hidden", cls: "bg-red-50 text-red-700 ring-red-200" },
                          IMPLICIT: { label: "Implicit", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
                          EXPLICIT: { label: "Explicit", cls: "bg-gray-50 text-gray-600 ring-gray-200" },
                        };
                        const vis = visCfg[ax.visibility];
                        return (
                          <div key={i} className="rounded-lg bg-white/90 border border-gray-100 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className={cn("rounded-full ring-1 px-1.5 py-[1px] text-[9px] font-medium tracking-wide", vis.cls)}>
                                {vis.label}
                              </span>
                              <span className="rounded-full bg-gray-50 ring-1 ring-gray-200 px-1.5 py-[1px] text-[9px] font-medium text-gray-500">
                                {ax.load_bearing}
                              </span>
                              {ax.rests_on_components.length > 0 && (
                                <span className="ml-auto text-[9px] text-gray-400 tabular-nums">
                                  rests on {ax.rests_on_components.length}
                                </span>
                              )}
                            </div>
                            <p className="text-[12.5px] font-medium leading-snug text-gray-900">
                              {ax.claim}
                            </p>
                            {ax.if_false && (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-red-700/80">
                                <span className="font-semibold text-red-600">If false: </span>
                                {ax.if_false}
                              </p>
                            )}
                            {ax.validation_path && (
                              <p className="mt-1 text-[10.5px] italic text-gray-500 leading-relaxed">
                                {ax.validation_path}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Section 0c: Candidate cycles — orphan compounding/exponential edges that may be untraced feedback loops.
          These are "hidden insights" — the system spotted feedback dynamics that don't belong to any traced cycle.
          Apple-Vision-Pro design: single accent, soft glass, minimal border, actionable affordance per item. */}
      {(() => {
        const candidates = (synthData as unknown as { candidate_cycles?: Array<{ edge: { source: string; target: string; dynamics: string }; reason: string }> } | null)?.candidate_cycles;
        if (!candidates || candidates.length === 0) return null;
        return (
          <section className="rounded-2xl border border-amber-200/60 bg-gradient-to-br from-amber-50/30 to-white backdrop-blur-sm p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <SectionHeader
                  label="Candidate feedback loops"
                  color="amber"
                  subtitle={`${candidates.length} edge${candidates.length === 1 ? "" : "s"} with feedback dynamics not traced as cycles yet — likely hidden insight`}
                />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {candidates.map((c, i) => {
                const src = entityMap.get(c.edge.source);
                const tgt = entityMap.get(c.edge.target);
                return (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-amber-100/80 bg-white/80 px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-[2px] text-[9px] font-semibold uppercase tracking-wide">
                        {c.edge.dynamics}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-[10px] text-gray-500 tabular-nums">{c.edge.source}</span>
                        <span className="text-[12px] font-medium text-gray-800 truncate">
                          {src?.name ?? "Unknown"}
                        </span>
                        <span className="text-amber-500 text-[10px]">→</span>
                        <span className="font-mono text-[10px] text-gray-500 tabular-nums">{c.edge.target}</span>
                        <span className="text-[12px] font-medium text-gray-800 truncate">
                          {tgt?.name ?? "Unknown"}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-gray-600">
                        {c.reason}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Section 1: Master Bottleneck */}
      {bottleneckEntity && (
        <section className="rounded-xl border border-red-200 bg-red-50/40 p-5">
          <SectionHeader
            label="Highest-impact constraint"
            color="red"
            subtitle={`Affects ${bottleneckEntity.blast_radius} downstream elements`}
          />
          <div className="mt-3 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-600">
                  {bottleneckEntity.entity_id}
                </span>
                <h3 className="text-lg font-semibold text-gray-900">
                  {bottleneckEntity.name}
                </h3>
                <KnownnessPill
                  entityId={bottleneckEntity.entity_id}
                  posteriors={synthData?.construct_posteriors as PosteriorMap | undefined}
                />
              </div>
              {(richBottleneck?.summary ?? bottleneckEntity.description) && (
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
                  {richBottleneck?.summary ?? bottleneckEntity.description}
                </p>
              )}
            </div>
            <Ring value={bottleneckEntity.confidence} size={46} showValue />
          </div>

          {/* Rich reasoning */}
          {richBottleneck?.reasoning && richBottleneck.reasoning.length > 0 && (
            <div className="mt-3">
              <CalloutBox type="insight" label="Why this is the critical constraint">
                {richBottleneck.reasoning.map((r, i) => (
                  <p key={i} className={i < richBottleneck.reasoning.length - 1 ? "mb-2" : ""}>
                    {r}
                  </p>
                ))}
              </CalloutBox>
            </div>
          )}

          {/* When this matters */}
          {richBottleneck?.when_matters && richBottleneck.when_matters.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 text-[11px] font-semibold text-gray-500">
                When this matters most
              </div>
              <div className="space-y-1">
                {richBottleneck.when_matters.map((w, i) => (
                  <div
                    key={i}
                    className="flex gap-2 rounded-lg bg-white/60 px-3 py-2"
                  >
                    <IntensityDot level={w.intensity} />
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {w.situation}
                      </div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">
                        {w.impact}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blast metrics */}
          <div className="mt-3 flex gap-3">
            <div className="flex-1 rounded-lg border border-red-200 bg-white p-3">
              <div className="text-xl font-bold text-red-600">
                {bottleneckEntity.blast_radius}
              </div>
              <div className="text-[11px] text-gray-500">
                downstream elements affected
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-red-200 bg-white p-3">
              <div className="text-xl font-bold text-red-600">
                {entities.length > 0
                  ? Math.round(
                      (bottleneckEntity.blast_radius / entities.length) * 100
                    )
                  : 0}
                %
              </div>
              <div className="text-[11px] text-gray-500">of system depends on this</div>
            </div>
          </div>
        </section>
      )}

      {/* Section 2: Leverage Points — Deep Cards */}
      {leverageEntities.length > 0 && (
        <section>
          <SectionHeader
            label="Highest-leverage changes"
            color="blue"
            subtitle="Ranked by downstream impact"
          />
          <div className="mt-3">
            <TieredList
              items={leverageEntities}
              heroCount={3}
              secondaryCount={5}
              label="leverage points"
              heroClassName="space-y-2"
              secondaryClassName="mt-2 space-y-1.5"
              collapsedClassName="mt-1.5 space-y-1"
              renderHero={(entity, i) => {
                const richPoint = synthData?.leverage_points?.find(
                  (lp) => lp.entity_id === entity.entity_id
                );
                if (richPoint) {
                  return (
                    <LeverageCard
                      key={entity.id}
                      point={richPoint}
                      entity={entity}
                      rank={i + 1}
                      delay={i * 60}
                      spaceId={space.id}
                      insightStatus={leverageStatuses[richPoint.entity_id] ?? null}
                      onInsightStatusChange={(status) => setLeverageStatuses((prev) => ({ ...prev, [richPoint.entity_id]: status }))}
                      posteriors={synthData?.construct_posteriors as PosteriorMap | undefined}
                    />
                  );
                }
                return (
                  <ExpandableCard
                    key={entity.id}
                    variant="leverage"
                    rank={i + 1}
                    entityId={entity.entity_id}
                    title={entity.name}
                    score={entity.confidence}
                  >
                    {entity.description && (
                      <p className="text-[13px] leading-relaxed text-gray-600">
                        {entity.description}
                      </p>
                    )}
                  </ExpandableCard>
                );
              }}
              renderSecondary={(entity, i) => {
                const richPoint = synthData?.leverage_points?.find(
                  (lp) => lp.entity_id === entity.entity_id
                );
                return (
                  <div
                    key={entity.id}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-200 text-[11px] font-bold text-gray-500">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800 truncate">
                          {entity.name}
                        </span>
                        <Ring value={entity.confidence} size={28} showValue />
                      </div>
                      {(richPoint?.summary ?? entity.description) && (
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2">
                          {richPoint?.summary ?? entity.description}
                        </p>
                      )}
                      {richPoint?.action?.primary && (
                        <p className="mt-1 text-[11px] leading-snug text-blue-600 line-clamp-1">
                          {richPoint.action.primary}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }}
              renderCompact={(entity, i) => {
                const richPoint = synthData?.leverage_points?.find(
                  (lp) => lp.entity_id === entity.entity_id
                );
                return (
                  <div
                    key={entity.id}
                    className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2"
                  >
                    <span className="text-[11px] font-medium text-gray-400">
                      {i + 1}.
                    </span>
                    <span className="text-xs font-medium text-gray-700">
                      {entity.name}
                    </span>
                    {(richPoint?.summary ?? entity.description) && (
                      <span className="truncate text-[11px] text-gray-400">
                        — {richPoint?.summary ?? entity.description}
                      </span>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </section>
      )}

      {/* Section 3: Critical Risks — Deep Cards */}
      {riskEntities.length > 0 && (
        <section>
          <SectionHeader label="Critical risks" color="red" />
          <div className="mt-3">
            <TieredList
              items={riskEntities}
              heroCount={3}
              secondaryCount={5}
              label="risk points"
              heroClassName="space-y-2"
              secondaryClassName="mt-2 space-y-1.5"
              collapsedClassName="mt-1.5 space-y-1"
              renderHero={(entity, i) => {
                const richPoint = synthData?.risk_points?.find(
                  (rp) => rp.entity_id === entity.entity_id
                );
                if (richPoint) {
                  return (
                    <RiskCard
                      key={entity.id}
                      point={richPoint}
                      entity={entity}
                      rank={i + 1}
                      totalEntities={entities.length}
                      delay={i * 60}
                      spaceId={space.id}
                      insightStatus={riskStatuses[richPoint.entity_id] ?? null}
                      onInsightStatusChange={(status) => setRiskStatuses((prev) => ({ ...prev, [richPoint.entity_id]: status }))}
                      posteriors={synthData?.construct_posteriors as PosteriorMap | undefined}
                    />
                  );
                }
                return (
                  <ExpandableCard
                    key={entity.id}
                    variant="risk"
                    rank={i + 1}
                    entityId={entity.entity_id}
                    title={entity.name}
                    score={entity.confidence}
                  >
                    {entity.description && (
                      <p className="text-[13px] leading-relaxed text-gray-600">
                        {entity.description}
                      </p>
                    )}
                  </ExpandableCard>
                );
              }}
              renderSecondary={(entity, i) => {
                const richPoint = synthData?.risk_points?.find(
                  (rp) => rp.entity_id === entity.entity_id
                );
                return (
                  <div
                    key={entity.id}
                    className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-200 text-[11px] font-bold text-gray-500">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800 truncate">
                          {entity.name}
                        </span>
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                          blast: {richPoint?.blast_radius ?? entity.blast_radius}
                        </span>
                      </div>
                      {(richPoint?.summary ?? entity.description) && (
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2">
                          {richPoint?.summary ?? entity.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }}
              renderCompact={(entity, i) => {
                const richPoint = synthData?.risk_points?.find(
                  (rp) => rp.entity_id === entity.entity_id
                );
                return (
                  <div
                    key={entity.id}
                    className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2"
                  >
                    <span className="text-[11px] font-medium text-gray-400">
                      {i + 1}.
                    </span>
                    <span className="text-xs font-medium text-gray-700">
                      {entity.name}
                    </span>
                    {(richPoint?.summary ?? entity.description) && (
                      <span className="truncate text-[11px] text-gray-400">
                        — {richPoint?.summary ?? entity.description}
                      </span>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </section>
      )}

      {/* Section 4: Feedback Loops — prefer rich synthesis data */}
      {(synthData?.feedback_loops?.length ?? cycles.length) > 0 && (
        <section>
          <SectionHeader label="Feedback loops" color="amber" subtitle="Self-reinforcing dynamics" />
          <div className="mt-3 space-y-2">
            {synthData?.feedback_loops?.length ? (
              // Rich loops from Pass 3
              synthData.feedback_loops.map((loop: RichFeedbackLoop, li: number) => {
                const isPositive = loop.type === "positive";
                return (
                  <ExpandableCard
                    key={li}
                    variant={isPositive ? "cycle-positive" : "cycle-negative"}
                    rank={li + 1}
                    title={loop.name}
                  >
                    {/* Chain */}
                    <div className="mb-3 flex flex-wrap items-center gap-1 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      {loop.steps.map((step, si) => (
                        <span key={si} className="flex items-center gap-1">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-xs font-medium",
                              si === loop.intervention_at
                                ? isPositive
                                  ? "border border-green-300 bg-green-50 text-green-700"
                                  : "border border-red-300 bg-red-50 text-red-700"
                                : "text-gray-600"
                            )}
                          >
                            {step}
                          </span>
                          {si < loop.steps.length - 1 && (
                            <span className="text-[11px] text-gray-400">→</span>
                          )}
                        </span>
                      ))}
                    </div>

                    <CalloutBox type="insight" label="What drives this loop">
                      {loop.explanation}
                    </CalloutBox>

                    <CalloutBox
                      type="intervention"
                      label={isPositive ? "How to strengthen this" : "How to break this"}
                    >
                      {loop.how_to}
                    </CalloutBox>

                    {loop.when_active?.length > 0 && (
                      <div>
                        <div className="mb-2 text-[11px] font-semibold text-gray-500">
                          When this loop is active
                        </div>
                        <div className="space-y-1">
                          {loop.when_active.map((w, wi) => (
                            <div
                              key={wi}
                              className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2"
                            >
                              <IntensityDot level={w.intensity} />
                              <div>
                                <div className="text-xs font-medium text-gray-800">
                                  {w.situation}
                                </div>
                                <div className="mt-0.5 text-xs leading-snug text-gray-500">
                                  {w.impact}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </ExpandableCard>
                );
              })
            ) : (
              // Fallback to DB cycles
              cycles.map((cycle, ci) => {
                const isPositive = cycle.classification === "reinforcing_positive";
                const isNegative = cycle.classification === "reinforcing_negative";
                return (
                  <ExpandableCard
                    key={cycle.id}
                    variant={
                      isPositive
                        ? "cycle-positive"
                        : isNegative
                          ? "cycle-negative"
                          : "cycle-balancing"
                    }
                    rank={ci + 1}
                    title={cycle.name ?? cycle.cycle_id}
                  >
                    <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      <span className="font-mono text-xs text-gray-500">
                        {cycle.entity_ids.join(" → ")} → {cycle.entity_ids[0]}
                      </span>
                    </div>
                    {cycle.description && (
                      <CalloutBox type="insight" label="What drives this loop">
                        {cycle.description}
                      </CalloutBox>
                    )}
                    {cycle.intervention_description && (
                      <CalloutBox
                        type="intervention"
                        label={isNegative ? "How to break this" : "How to strengthen this"}
                      >
                        {cycle.intervention_description}
                      </CalloutBox>
                    )}
                  </ExpandableCard>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* Section 5: Scenarios */}
      {scenarios.length > 0 && (
        <section>
          <SectionHeader label="Scenario modeling" color="blue" />
          <div className="mt-3 flex gap-2">
            {scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-center"
              >
                <div className="text-[10px] font-medium text-gray-500">
                  {scenario.name}
                </div>
                <div
                  className="mt-1 text-lg font-bold"
                  style={{
                    color:
                      scenario.probability === "likely"
                        ? "#34C759"
                        : scenario.probability === "unlikely"
                          ? "#FF3B30"
                          : "#FF9500",
                  }}
                >
                  {scenario.outcome_value}
                </div>
                <div className="text-[10px] text-gray-400">
                  {scenario.outcome_label}
                </div>
                <div className="mt-1 text-[10px] text-gray-400">
                  {scenario.conditions}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 6: Novel Connections */}
      {novelConnections.length > 0 && (
        <section>
          <SectionHeader label="Discovered connections" color="green" />
          <div className="mt-3 space-y-2">
            {novelConnections.map((nc) => (
              <div
                key={nc.id}
                className="rounded-lg border border-green-200 bg-green-50/40 p-3"
              >
                <div className="flex items-center gap-2 text-xs">
                  <StatusBadge variant={nc.strength}>{nc.strength}</StatusBadge>
                  <span className="font-mono font-semibold text-gray-700">
                    {nc.source_entity_id}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono font-semibold text-gray-700">
                    {nc.target_entity_id}
                  </span>
                  <span className="text-gray-500">{nc.relationship_type}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-600">
                  {nc.reasoning}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 7: Contradictions */}
      {contradictions.length > 0 && (
        <section>
          <SectionHeader label="Contradictions" color="amber" />
          <div className="mt-3 space-y-2">
            {contradictions.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-amber-200 bg-amber-50/40 p-3"
              >
                <StatusBadge
                  variant={
                    c.severity === "critical"
                      ? "blocked"
                      : c.severity === "moderate"
                        ? "waiting"
                        : "theory"
                  }
                >
                  {c.severity}
                </StatusBadge>
                <div className="mt-2 space-y-1 text-xs leading-relaxed">
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">Assumes:</span>{" "}
                    {c.assumption_text}
                  </p>
                  <p className="text-gray-700">
                    <span className="font-medium text-gray-900">
                      But concludes:
                    </span>{" "}
                    {c.conclusion_text}
                  </p>
                </div>
                {c.description && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {c.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 8: Open Questions — Phase 4b: interactive, priority-ranked */}
      {(synthData?.open_questions?.length ?? openQuestions.length) > 0 && (
        <section>
          <SectionHeader
            label="Open questions"
            color="gray"
            subtitle={
              synthData?.open_questions?.length
                ? `${synthData.open_questions.filter((q) => typeof q.user_answer === "string" && q.user_answer.trim().length > 0).length} of ${synthData.open_questions.length} answered — answers feed the next strategy refresh`
                : undefined
            }
          />
          {/* Phase 4b: when the user has answered questions AND the strategy is stale,
              offer a one-click refresh so the new anchors flow straight into strategy. */}
          {(() => {
            const answeredCount =
              synthData?.open_questions?.filter(
                (q) =>
                  typeof q.user_answer === "string" &&
                  q.user_answer.trim().length > 0
              ).length ?? 0;
            const hasStrategy =
              !!(synthData?.strategic_recommendation as { recommendation?: unknown } | undefined)?.recommendation;
            const isStale = synthData?.is_stale === true;
            if (answeredCount === 0 || !hasStrategy || !isStale) return null;
            return (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-800">
                <span>
                  <span className="font-semibold">{answeredCount}</span>{" "}
                  answered question{answeredCount === 1 ? "" : "s"} pending —{" "}
                  {synthData?.strategy_stale_reason ??
                    "refresh strategy to lock them in as anchors"}
                  .
                </span>
                <button
                  type="button"
                  disabled={refreshingStrategy}
                  onClick={async () => {
                    setRefreshingStrategy(true);
                    try {
                      const res = await fetch("/api/pipeline/strategy-refresh", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ spaceId: space.id }),
                      });
                      if (!res.ok) {
                        const err = await res
                          .json()
                          .catch(() => ({ error: "Failed" }));
                        throw new Error(err.error ?? `HTTP ${res.status}`);
                      }
                      router.refresh();
                    } catch (e) {
                      console.error("[synthesis-view] refresh failed", e);
                    } finally {
                      setRefreshingStrategy(false);
                    }
                  }}
                  className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {refreshingStrategy ? "Refreshing…" : "Refresh strategy"}
                </button>
              </div>
            );
          })()}
          <div className="mt-3 space-y-2">
            {synthData?.open_questions?.length ? (
              (() => {
                // Phase 4c: ask the UPF selector which unanswered question has
                // the highest info-per-friction ratio. The winning card gets a
                // "🎯 Recommended next" spotlight; everything else stays sorted
                // by answered-state → priority → original-index as in Phase 4b.
                const unanswered = synthData.open_questions
                  .map((q, qi) => ({ q, qi }))
                  .filter(({ q }) => !q.user_answer?.trim());
                // Phase 4c-next: pass entityMap so the scorer can boost
                // questions that touch the master bottleneck / leverage /
                // risk entities, and surface those in the tooltip rationale.
                const scoreCtx = {
                  entityLookup: (eid: string) => entityMap.get(eid),
                };
                const descriptors = unanswered.map(({ q, qi }) =>
                  questionToDescriptor(q, qi, space.id, scoreCtx)
                );
                // Phase 4c-final: feed the synthesis-data posterior map into
                // the selector so constructs the user has already observed
                // (answered elsewhere, recorded a metric against, …) sink in
                // the ranking instead of re-winning the spotlight forever.
                const posteriorMap =
                  (synthData?.construct_posteriors as PosteriorMap | undefined) ??
                  undefined;
                const posteriorLookup = makePosteriorLookup(posteriorMap);
                const { top: topDescriptor, ranked } = selectNextProxy(
                  descriptors,
                  null,
                  posteriorLookup
                );
                const topIndex =
                  topDescriptor &&
                  typeof topDescriptor.metadata?.index === "number"
                    ? (topDescriptor.metadata.index as number)
                    : null;
                const topScore = ranked.find(
                  (r) => r.descriptor.id === topDescriptor?.id
                )?.score;

                // Preserve original indices so the POST endpoint can target the right slot.
                return synthData.open_questions
                  .map((q, qi) => ({ q, qi }))
                  .sort((a, b) => {
                    const aAnswered = !!a.q.user_answer?.trim();
                    const bAnswered = !!b.q.user_answer?.trim();
                    // Un-answered first; within unanswered, the UPF pick floats to top.
                    if (aAnswered !== bAnswered) return aAnswered ? 1 : -1;
                    if (!aAnswered && topIndex !== null) {
                      if (a.qi === topIndex && b.qi !== topIndex) return -1;
                      if (b.qi === topIndex && a.qi !== topIndex) return 1;
                    }
                    const pr = priorityRank(a.q.priority) - priorityRank(b.q.priority);
                    if (pr !== 0) return pr;
                    return a.qi - b.qi;
                  })
                  .map(({ q, qi }) => (
                    <OpenQuestionCard
                      key={qi}
                      question={q}
                      index={qi}
                      spaceId={space.id}
                      onMutated={() => router.refresh()}
                      spotlight={
                        qi === topIndex && topScore
                          ? {
                              info_bits: topScore.expected_info_bits,
                              friction: topScore.friction_cost,
                              value_per_friction: topScore.value_per_friction,
                              rationale: topScore.rationale,
                            }
                          : null
                      }
                    />
                  ));
              })()
            ) : (
              openQuestions.map((q) => (
                <div
                  key={q.id}
                  className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
                >
                  <p className="text-xs font-medium text-gray-700">
                    {q.statement}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Section 8b: Assumption Inversions — contrarian readings */}
      {synthData?.assumption_inversions && synthData.assumption_inversions.length > 0 && (
        <section>
          <SectionHeader
            label="Assumption inversions"
            color="purple"
            subtitle="The strongest case that the opposite is true"
          />
          <div className="mt-3 space-y-2">
            {synthData.assumption_inversions.map((inv: AssumptionInversion, i: number) => {
              const plausColor =
                inv.plausibility === "more_likely_than_stated"
                  ? "bg-red-100 text-red-700"
                  : inv.plausibility === "coin_flip"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600";
              const isAxiomTargeted = inv.target_type === "axiom";
              // For axiom-targeted inversions, resolve against synthData.axioms.
              // For entity-targeted, resolve against entityMap.
              const targetAxiom = isAxiomTargeted
                ? (synthData.axioms ?? []).find((a) => a.axiom_id === inv.target_entity_id)
                : null;
              const targetEntity = isAxiomTargeted ? null : entityMap.get(inv.target_entity_id);
              const targetLabel = isAxiomTargeted
                ? `axiom ${inv.target_entity_id}${targetAxiom?.visibility === "HIDDEN" ? " (HIDDEN)" : ""}`
                : `${inv.target_type.replace(/_/g, " ")}${targetEntity ? `: ${targetEntity.name}` : ""}`;
              return (
                <ExpandableCard
                  key={i}
                  variant="risk"
                  rank={i + 1}
                  entityId={inv.target_entity_id}
                  title={inv.inverted_claim}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", plausColor)}>
                      {inv.plausibility.replace(/_/g, " ")}
                    </span>
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px]",
                      isAxiomTargeted
                        ? "bg-purple-100 text-purple-700 font-semibold"
                        : "bg-gray-100 text-gray-500",
                    )}>
                      inverts {targetLabel}
                    </span>
                    {isAxiomTargeted && targetAxiom?.visibility === "HIDDEN" && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                        highest leverage
                      </span>
                    )}
                    {/* Provenance badge — distinguishes LLM-grounded vs auto-generated stubs */}
                    {inv.source === "auto_from_research" && (
                      <span
                        className="rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700"
                        title="Auto-generated stub from research signal. Re-run synthesis for a domain-grounded version."
                      >
                        auto · from research
                      </span>
                    )}
                    {inv.source === "auto_from_axiom" && (
                      <span
                        className="rounded-full bg-purple-50 ring-1 ring-purple-200 px-1.5 py-0.5 text-[9px] font-medium text-purple-700"
                        title="Auto-generated from load-bearing axiom. Re-run synthesis for a domain-grounded version."
                      >
                        auto · from axiom
                      </span>
                    )}
                    {(!inv.source || inv.source === "llm_synthesis") && (
                      <span
                        className="rounded-full bg-gray-50 ring-1 ring-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-500"
                        title="Produced by full synthesis — domain-grounded."
                      >
                        synthesis
                      </span>
                    )}
                  </div>
                  <CalloutBox type="insight" label="Current assumption">
                    {inv.original_assumption}
                  </CalloutBox>
                  <CalloutBox type="insight" label="Case for the inversion">
                    {inv.case_for_inversion}
                  </CalloutBox>
                  <CalloutBox type="intervention" label="What would change if true">
                    {inv.what_would_change}
                  </CalloutBox>
                  <div className="mt-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-700">
                    <span className="font-semibold">Cheap test: </span>
                    {inv.test}
                  </div>
                </ExpandableCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 8b-prime: Orphan hidden signals — generated by research but not linked to any action or signal_to_action.
          Previously rendered nowhere; now surfaced so the user can see what the analysis flagged but synthesis hasn't woven in. */}
      {(() => {
        const sd = synthData as unknown as { hidden_signals?: HiddenSignalData[] } | null;
        const hidden = sd?.hidden_signals ?? [];
        if (hidden.length === 0) return null;
        const sta = synthData?.signal_to_action ?? [];
        const referencedNames = new Set<string>();
        for (const s of sta) {
          referencedNames.add((s.signal || "").toLowerCase().trim());
        }
        const orphans = hidden.filter((h) => {
          const needle = (h.signal_name || h.description || "").toLowerCase();
          if (!needle) return false;
          for (const ref of referencedNames) {
            if (ref && (ref.includes(needle.slice(0, 30)) || needle.includes(ref.slice(0, 30)))) return false;
          }
          return true;
        });
        if (orphans.length === 0) return null;
        return (
          <section>
            <SectionHeader
              label="Unlinked hidden signals"
              color="amber"
              subtitle="Surfaced by research but not yet woven into any action — inspect and decide whether to address"
            />
            <div className="mt-3 space-y-2">
              {orphans.map((h, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-amber-200 bg-amber-50/30 p-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                      {h.signal_type?.replace(/_/g, " ") ?? "signal"}
                    </span>
                    <span className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-medium text-red-700">
                      orphan
                    </span>
                    {typeof h.trajectory_impact === "number" && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">
                        impact: {h.trajectory_impact.toFixed(2)}
                      </span>
                    )}
                    {h.related_internal_entities?.slice(0, 3).map((eid) => {
                      const e = entityMap.get(eid);
                      return (
                        <span key={eid} className="rounded-full bg-white/80 border border-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">
                          {eid}{e ? `: ${e.name}` : ""}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900">
                    {h.signal_name || "unnamed signal"}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
                    {h.description}
                  </p>
                  {h.analogous_precedent && (
                    <p className="mt-1 text-[11px] italic text-gray-500">
                      Analogous: {h.analogous_precedent}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Section 8c: Signal → Action — hidden signal linkage */}
      {synthData?.signal_to_action && synthData.signal_to_action.length > 0 && (
        <section>
          <SectionHeader
            label="Hidden signals → actions"
            color="amber"
            subtitle="Latent mechanisms that should shape the plan"
          />
          <div className="mt-3 space-y-2">
            {synthData.signal_to_action.map((s: SignalToAction, i: number) => {
              const sourceLabel =
                s.source === "hidden_signal"
                  ? "From research"
                  : s.source === "discovered_connection"
                    ? "Inferred edge"
                    : "Domain inference";
              return (
                <div
                  key={i}
                  className="rounded-lg border border-amber-200 bg-amber-50/40 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                          {sourceLabel}
                        </span>
                        {s.connected_entities.slice(0, 4).map((eid) => {
                          const e = entityMap.get(eid);
                          return (
                            <span
                              key={eid}
                              className="rounded-full bg-white/80 border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                            >
                              {eid}{e ? `: ${e.name}` : ""}
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-[13px] font-semibold text-gray-900">{s.signal}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
                    {s.why_it_matters}
                  </p>
                  <div className="mt-2 rounded-md bg-white/70 px-2.5 py-1.5 text-[11px] text-gray-700">
                    <span className="font-semibold text-green-700">Linked action: </span>
                    {s.linked_action}
                  </div>
                  <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                    <span className="font-semibold">If ignored: </span>
                    {s.if_ignored}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 9: What To Do Next — Conditional Action Plan */}
      {(synthData?.action_plan?.paths?.length ?? actionItems.length) > 0 && (
        <section>
          <SectionHeader
            label="What to do next"
            color="green"
            subtitle="Choose the path that matches your situation"
          />
          <div className="mt-3">
            <ConditionalActionPlan
              actionItems={actionItems}
              richActionPlan={synthData?.action_plan}
              sequencingRationale={synthData?.sequencing_rationale}
              spaceId={space.id}
              onToggleActionDone={onToggleActionDone}
            />
          </div>
        </section>
      )}

      {/* Section 10: Domain Expertise (unified) */}
      {((synthData?.worth_considering && synthData.worth_considering.length > 0) ||
        externalEntities.length > 0 ||
        crossContextInsights.length > 0 ||
        bridges.length > 0) && (
        <section>
          <SectionHeader
            label="Domain Expertise"
            color="purple"
            subtitle="Frameworks, precedents, external context, and cross-domain connections"
          />

          {/* Phase 6 Gap 4: Research provenance summary */}
          {synthData?.research_provenance && (
            <div className="mt-3">
              <ResearchProvenanceSection provenance={synthData.research_provenance as ResearchProvenance} />
            </div>
          )}

          {/* Sub-section: Frameworks & Precedents (worth_considering) */}
          {synthData?.worth_considering && synthData.worth_considering.length > 0 && (
            <div className="mt-3">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-600">
                <span>Frameworks & Precedents</span>
                <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">
                  {synthData.worth_considering.length}
                </span>
              </h4>
              <div className="space-y-2">
                {synthData.worth_considering.map((item: WorthConsidering, i: number) => {
                  const typeConfig: Record<string, { icon: React.ReactNode; label: string; border: string; bg: string }> = {
                    precedent: { icon: <Clipboard className="h-4 w-4" />, label: "Real-world precedent", border: "border-amber-200", bg: "bg-amber-50/40" },
                    framework: { icon: <Blocks className="h-4 w-4" />, label: "Analytical framework", border: "border-purple-200", bg: "bg-purple-50/40" },
                    blind_spot: { icon: <AlertTriangle className="h-4 w-4" />, label: "Blind spot", border: "border-red-200", bg: "bg-red-50/40" },
                    analogy: { icon: <Link className="h-4 w-4" />, label: "Cross-domain analogy", border: "border-blue-200", bg: "bg-blue-50/40" },
                    resource: { icon: <BookOpen className="h-4 w-4" />, label: "Resource", border: "border-teal-200", bg: "bg-teal-50/40" },
                  };
                  const tc = typeConfig[item.type] ?? typeConfig.analogy;

                  return (
                    <div
                      key={i}
                      className={cn("rounded-lg border p-4", tc.border, tc.bg)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {tc.icon}
                          <div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              {tc.label}
                            </span>
                            <h4 className="text-sm font-semibold text-gray-900">{item.title}</h4>
                          </div>
                        </div>
                        <StatusBadge
                          variant={
                            item.confidence === "high"
                              ? "active"
                              : item.confidence === "moderate"
                                ? "waiting"
                                : "theory"
                          }
                        >
                          {item.confidence}
                        </StatusBadge>
                      </div>

                      <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
                        {item.description}
                      </p>

                      {/* Phase 6 Gap 6: Source origin + source note */}
                      <div className="mt-2 flex items-center gap-2">
                        {item.source_origin && (
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[9px] font-medium",
                            item.source_origin === "external_research" ? "bg-green-50 text-green-700" :
                            item.source_origin === "bridge_analysis" ? "bg-amber-50 text-amber-700" :
                            "bg-gray-50 text-gray-500"
                          )}>
                            {item.source_origin === "external_research" ? "From research" :
                             item.source_origin === "bridge_analysis" ? "From bridges" :
                             "LLM synthesis"}
                          </span>
                        )}
                        {item.source_note && (
                          <span className="text-[11px] text-gray-500 italic">
                            Source: {item.source_note}
                          </span>
                        )}
                      </div>

                      {/* Relevance score + ranking reason */}
                      {(item.relevance_score != null || item.ranking_reason) && (
                        <div className="mt-2 flex items-center gap-2">
                          {item.relevance_score != null && (
                            <div className="flex items-center gap-1">
                              <span className="text-[9px] text-gray-400">Relevance</span>
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[9px] font-bold",
                                item.relevance_score >= 8 ? "bg-green-100 text-green-700" :
                                item.relevance_score >= 5 ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-500"
                              )}>
                                {item.relevance_score}/10
                              </span>
                            </div>
                          )}
                          {item.ranking_reason && (
                            <span className="text-[10px] text-gray-500 italic">{item.ranking_reason}</span>
                          )}
                        </div>
                      )}

                      {item.connected_entities?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.connected_entities.map((eid, j) => {
                            const entity = entityMap.get(eid);
                            return (
                              <span
                                key={j}
                                className="rounded-full bg-white/80 border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                              >
                                {eid}{entity ? `: ${entity.name}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sub-section: External Context (Agent 7 entities) */}
          {externalEntities.length > 0 && (
            <div className={synthData?.worth_considering?.length ? "mt-5" : "mt-3"}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-600">
                <span>External Context</span>
                <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-500">
                  {externalEntities.length}
                </span>
              </h4>
              <p className="mb-3 text-[11px] text-gray-500">
                Field context from outside your situation. Toggle in Graph View to see on the graph.
              </p>
              <ExternalContextSection externalEntities={externalEntities} />
            </div>
          )}

          {/* Sub-section: Cross-Context Bridges */}
          {crossContextInsights.length > 0 && (
            <div className={(synthData?.worth_considering?.length || externalEntities.length > 0) ? "mt-5" : "mt-3"}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">
                <span>Cross-Context Bridges</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                  {crossContextInsights.length}
                </span>
              </h4>
              <p className="mb-3 text-[11px] text-gray-500">
                Connections between your analysis and field knowledge.
              </p>
              <CrossContextSection
                insights={crossContextInsights}
                insightStatuses={crossContextStatuses}
                onInsightStatusChange={(idx, status) => setCrossContextStatuses((prev) => ({ ...prev, [idx]: status }))}
              />
            </div>
          )}

          {/* Sub-section: Cross-Space Bridges (from weaving) */}
          {bridges.length > 0 && (
            <div className={(synthData?.worth_considering?.length || externalEntities.length > 0 || crossContextInsights.length > 0) ? "mt-5" : "mt-3"}>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">
                <span>Cross-Area Connections</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                  {bridges.length}
                </span>
              </h4>
              <p className="mb-3 text-[11px] text-gray-500">
                Shared variables and structural connections between analytical areas. Toggle &quot;Show all areas&quot; in Graph View to visualize.
              </p>
              <div className="space-y-2">
                {bridges.map((bridge) => {
                  const sourceEntity = entityByUuid.get(bridge.source_entity_id);
                  const targetEntity = entityByUuid.get(bridge.target_entity_id);
                  const otherSpaceId = bridge.source_space_id === space.id
                    ? bridge.target_space_id
                    : bridge.source_space_id;
                  const otherSpaceName = spaceNames.get(otherSpaceId) ?? "Other area";

                  const typeConfig: Record<string, { label: string; border: string; bg: string; badge: string }> = {
                    identity: { label: "Same concept", border: "border-blue-200", bg: "bg-blue-50/40", badge: "stated" },
                    influence: { label: "Influences", border: "border-amber-200", bg: "bg-amber-50/40", badge: "inferred" },
                    structural: { label: "Structural parallel", border: "border-green-200", bg: "bg-green-50/40", badge: "predicted" },
                  };
                  const tc = typeConfig[bridge.bridge_type] ?? typeConfig.influence;

                  return (
                    <div
                      key={bridge.id}
                      className={cn("rounded-lg border p-3", tc.border, tc.bg)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge variant={tc.badge as "stated" | "inferred" | "predicted"}>
                              {tc.label}
                            </StatusBadge>
                            <StatusBadge
                              variant={
                                bridge.coupling_strength === "strong" ? "fundamental"
                                  : bridge.coupling_strength === "moderate" ? "important"
                                  : "theory"
                              }
                            >
                              {bridge.coupling_strength}
                            </StatusBadge>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-sm">
                            <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600">
                              {sourceEntity?.entity_id ?? "?"}
                            </span>
                            <span className="text-xs text-gray-700 font-medium truncate max-w-[100px]">
                              {sourceEntity?.name ?? "Unknown"}
                            </span>
                            <svg className="h-3 w-4 flex-shrink-0 text-amber-400" viewBox="0 0 16 12" fill="none">
                              {bridge.coupling_direction === "bidirectional" ? (
                                <path d="M1 6h14M4 1L1 6l3 5M12 1l3 5-3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              ) : (
                                <path d="M1 6h14M11 1l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              )}
                            </svg>
                            <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-600">
                              {targetEntity?.entity_id ?? "?"}
                            </span>
                            <span className="text-xs text-gray-700 font-medium truncate max-w-[100px]">
                              {targetEntity?.name ?? "Unknown"}
                            </span>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                          {otherSpaceName}
                        </span>
                      </div>

                      <div className="mt-2 text-[11px] font-medium text-amber-700">
                        Shared: {bridge.shared_variable_name}
                      </div>

                      {bridge.description && (
                        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                          {bridge.description}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ SECTION: Cross-Category Convergences ═══ */}
      {convergenceInsights.length > 0 && (
        <section className="rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/50 to-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-600 text-[9px] font-bold text-white">
              &cap;
            </span>
            <h3 className="text-sm font-bold text-gray-900">
              Cross-Category Convergences
            </h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {convergenceInsights.length}
            </span>
          </div>
          <p className="mb-4 text-[11px] text-gray-500 leading-relaxed">
            Entities from different categories that converge on a shared underlying element.
            Deeper convergences (L4 invariants) reveal first-principle connections with compounding impact across domains.
          </p>
          <ConvergenceGallery convergences={convergenceInsights} />
        </section>
      )}
    </div>
  );
}
