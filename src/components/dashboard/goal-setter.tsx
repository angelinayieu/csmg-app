"use client";

import { useState, useRef, useEffect } from "react";
import {
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Check,
  Loader2,
  Target,
  Zap,
  Shield,
  AlertTriangle,
  BarChart3,
} from "lucide-react";

import type { SuggestedObjective } from "@/types/goals";

// ─── Types ───

interface GoalSetterProps {
  spaceId: string;
  onCreated: (goal: { id: string; title: string }) => void;
  onClose: () => void;
  /** Pre-fill from a suggested objective */
  prefill?: SuggestedObjective | null;
}

type Mode = "confirm" | "generate" | "idle";

// ─── Objective Type Config ───

const typeConfig: Record<
  string,
  { label: string; icon: typeof Target; color: string; bg: string }
> = {
  maximize: {
    label: "Maximize",
    icon: Zap,
    color: "text-emerald-700",
    bg: "bg-emerald-50",
  },
  minimize: {
    label: "Minimize",
    icon: Shield,
    color: "text-blue-700",
    bg: "bg-blue-50",
  },
  maintain: {
    label: "Maintain",
    icon: Target,
    color: "text-amber-700",
    bg: "bg-amber-50",
  },
  explore: {
    label: "Explore",
    icon: Sparkles,
    color: "text-purple-700",
    bg: "bg-purple-50",
  },
  avoid: {
    label: "Avoid",
    icon: AlertTriangle,
    color: "text-red-700",
    bg: "bg-red-50",
  },
};

const depthLabels: Record<string, { label: string; color: string }> = {
  fundamental: { label: "Fundamental", color: "text-amber-600 bg-amber-50 border-amber-200" },
  structural: { label: "Structural", color: "text-blue-600 bg-blue-50 border-blue-200" },
  surface: { label: "Surface", color: "text-gray-500 bg-gray-50 border-gray-200" },
};

// ─── Component ───

export function GoalSetter({
  spaceId,
  onCreated,
  onClose,
  prefill,
}: GoalSetterProps) {
  const mode: Mode = prefill ? "confirm" : "idle";

  // AI generation state
  const [userInput, setUserInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<SuggestedObjective | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // The objective being confirmed (either prefill or generated)
  const activeObjective = generated ?? prefill ?? null;

  // Advanced edit toggle
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMetricName, setEditMetricName] = useState("");
  const [editMetricUnit, setEditMetricUnit] = useState("");
  const [editBaseline, setEditBaseline] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editDeadline, setEditDeadline] = useState("");

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when in generate mode
  useEffect(() => {
    if (!prefill && inputRef.current) {
      inputRef.current.focus();
    }
  }, [prefill]);

  // Sync advanced edit fields when active objective changes
  useEffect(() => {
    if (activeObjective) {
      setEditTitle(activeObjective.title);
      setEditDescription(activeObjective.description);
      setEditMetricName(activeObjective.metric_name);
      setEditMetricUnit(activeObjective.metric_unit ?? "");
      setEditBaseline(
        activeObjective.baseline_estimate != null
          ? String(activeObjective.baseline_estimate)
          : ""
      );
      setEditTarget(
        activeObjective.target_estimate != null
          ? String(activeObjective.target_estimate)
          : ""
      );
    }
  }, [activeObjective]);

  // ── AI Generate ──

  async function handleGenerate() {
    if (!userInput.trim()) return;
    setGenerating(true);
    setGenError(null);
    setGenerated(null);

    try {
      const res = await fetch("/api/goals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, description: userInput.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate");
      }

      const data = await res.json();
      setGenerated(data.objective);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Failed to generate objective"
      );
    } finally {
      setGenerating(false);
    }
  }

  // ── Create Goal ──

  async function handleCreate() {
    const obj = activeObjective;
    if (!obj) return;

    // Use advanced edits if they were modified
    const title = showAdvanced ? editTitle : obj.title;
    const description = showAdvanced ? editDescription : obj.description;
    const metricName = showAdvanced ? editMetricName : obj.metric_name;
    const metricUnit = showAdvanced
      ? editMetricUnit || null
      : obj.metric_unit;
    const baseline = showAdvanced
      ? Number(editBaseline || 0)
      : Number(obj.baseline_estimate ?? 0);
    const target = showAdvanced
      ? Number(editTarget)
      : Number(obj.target_estimate ?? 100);

    if (!title || !metricName) return;

    setSaving(true);
    setSaveError(null);

    try {
      // Build description with rationale
      let fullDescription = description;
      if (obj.rationale && !showAdvanced) {
        fullDescription = `${description}\n\nRationale: ${obj.rationale}`;
      }
      if (obj.external_evidence && !showAdvanced) {
        const ev = obj.external_evidence;
        const typeLabel =
          ev.type === "validates"
            ? "Validated by"
            : ev.type === "challenges"
              ? "Challenged by"
              : ev.type === "precedent"
                ? "Precedent"
                : "Informed by";
        fullDescription += `\n\nExternal evidence (${typeLabel}): ${ev.source} — ${ev.detail}`;
      }

      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: spaceId,
          title,
          description: fullDescription || null,
          metric_name: metricName,
          metric_unit: metricUnit,
          target_value: target,
          baseline_value: baseline,
          deadline: (showAdvanced ? editDeadline : null) || null,
          parent_goal_id: obj.parent_goal_id ?? null,
          objective_type: obj.objective_type ?? "maximize",
          source: prefill ? "auto_detected" : "ai_assisted",
          benchmark: obj.benchmark ?? null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create goal");
      }

      const data = await res.json();
      if (prefill?.key?.startsWith("intel_decision:")) {
        const decisionId = prefill.key.slice("intel_decision:".length);
        if (decisionId) {
          try {
            const storageKey = `interaxis:intel-goal-links:${spaceId}`;
            const raw = window.localStorage.getItem(storageKey);
            const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            if (data.goal?.id) {
              parsed[String(data.goal.id)] = decisionId;
              window.localStorage.setItem(storageKey, JSON.stringify(parsed));
            }
          } catch {
            // non-blocking local storage write
          }
          window.dispatchEvent(new CustomEvent("interaxis:goal-created-from-intel", {
            detail: { decisionId, goalId: data.goal?.id ?? null },
          }));
        }
      }
      onCreated(data.goal);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to create goal"
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
          style={{
            animation: "goalSetterIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-interaxis-50">
                <Target className="h-3.5 w-3.5 text-interaxis-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {prefill?.parent_goal_id
                    ? "Track Sub-Objective"
                    : activeObjective
                      ? "Confirm Objective"
                      : "New Objective"}
                </h2>
                {!activeObjective && (
                  <p className="text-[10px] text-gray-400">
                    Describe what you want to achieve — AI will structure it
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* ── AI Input (when no prefill and not yet generated) ── */}
            {!activeObjective && (
              <div className="space-y-3">
                <div className="relative">
                  <textarea
                    ref={inputRef}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="e.g., I want to increase my customer retention rate by reducing churn..."
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-12 text-sm focus:border-interaxis-300 focus:ring-2 focus:ring-interaxis-100 outline-none resize-none placeholder:text-gray-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleGenerate();
                      }
                    }}
                  />
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !userInput.trim()}
                    className="absolute right-2.5 bottom-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-interaxis-600 text-white hover:bg-interaxis-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {generating && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Analyzing your graph to structure this objective...
                  </div>
                )}

                {genError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {genError}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Sparkles className="h-3 w-3 text-gray-300" />
                  <p className="text-[10px] text-gray-400">
                    The AI will map your intent to entities in your knowledge
                    graph, identify the right metrics, and estimate realistic
                    targets.
                  </p>
                </div>
              </div>
            )}

            {/* ── Objective Confirmation Card ── */}
            {activeObjective && (
              <ObjectiveConfirmCard
                objective={activeObjective}
                showAdvanced={showAdvanced}
                onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
                // Advanced edit fields
                editTitle={editTitle}
                editDescription={editDescription}
                editMetricName={editMetricName}
                editMetricUnit={editMetricUnit}
                editBaseline={editBaseline}
                editTarget={editTarget}
                editDeadline={editDeadline}
                onEditTitle={setEditTitle}
                onEditDescription={setEditDescription}
                onEditMetricName={setEditMetricName}
                onEditMetricUnit={setEditMetricUnit}
                onEditBaseline={setEditBaseline}
                onEditTarget={setEditTarget}
                onEditDeadline={setEditDeadline}
              />
            )}

            {/* Errors */}
            {saveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {saveError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            {/* Left: regenerate when generated */}
            <div>
              {generated && !prefill && (
                <button
                  onClick={() => {
                    setGenerated(null);
                    setShowAdvanced(false);
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Try different wording
                </button>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              {activeObjective && (
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-interaxis-600 px-4 py-2 text-xs font-semibold text-white hover:bg-interaxis-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  {saving ? "Creating..." : "Confirm & Track"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Animation */}
      <style jsx global>{`
        @keyframes goalSetterIn {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </>
  );
}

// ─── Objective Confirmation Card ───

function ObjectiveConfirmCard({
  objective,
  showAdvanced,
  onToggleAdvanced,
  editTitle,
  editDescription,
  editMetricName,
  editMetricUnit,
  editBaseline,
  editTarget,
  editDeadline,
  onEditTitle,
  onEditDescription,
  onEditMetricName,
  onEditMetricUnit,
  onEditBaseline,
  onEditTarget,
  onEditDeadline,
}: {
  objective: SuggestedObjective;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  editTitle: string;
  editDescription: string;
  editMetricName: string;
  editMetricUnit: string;
  editBaseline: string;
  editTarget: string;
  editDeadline: string;
  onEditTitle: (v: string) => void;
  onEditDescription: (v: string) => void;
  onEditMetricName: (v: string) => void;
  onEditMetricUnit: (v: string) => void;
  onEditBaseline: (v: string) => void;
  onEditTarget: (v: string) => void;
  onEditDeadline: (v: string) => void;
}) {
  const tc = typeConfig[objective.objective_type] ?? typeConfig.explore;
  const depth = objective.depth ? depthLabels[objective.depth] : null;
  const Icon = tc.icon;

  return (
    <div className="space-y-3">
      {/* Main card */}
      <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50/50 to-white overflow-hidden">
        {/* Type + depth badges */}
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-0">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${tc.bg} ${tc.color}`}
          >
            <Icon className="h-2.5 w-2.5" />
            {tc.label}
          </span>
          {depth && (
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${depth.color}`}
            >
              {depth.label}
            </span>
          )}
          {objective.confidence && (
            <span className="text-[10px] text-gray-400 ml-auto">
              {objective.confidence} confidence
            </span>
          )}
        </div>

        {/* Title + description */}
        <div className="px-4 pt-2 pb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            {objective.title}
          </h3>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed">
            {objective.description}
          </p>
        </div>

        {/* Metric preview */}
        <div className="border-t border-gray-100 px-4 py-2.5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">
              Metric
            </p>
            <p className="text-xs font-medium text-gray-700 truncate">
              {objective.metric_name}
              {objective.metric_unit ? ` (${objective.metric_unit})` : ""}
            </p>
          </div>
          {objective.baseline_estimate != null && (
            <div className="text-center">
              <p className="text-[10px] text-gray-400">Now</p>
              <p className="text-xs font-semibold text-gray-600">
                {objective.baseline_estimate}
              </p>
            </div>
          )}
          {(objective.baseline_estimate != null ||
            objective.target_estimate != null) && (
            <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
          )}
          {objective.target_estimate != null && (
            <div className="text-center">
              <p className="text-[10px] text-gray-400">Target</p>
              <p className="text-xs font-semibold text-interaxis-600">
                {objective.target_estimate}
              </p>
            </div>
          )}
        </div>

        {/* Convergence */}
        {objective.convergence_score != null &&
          objective.convergence_score > 0 && (
            <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-2">
              <span className="text-[10px] text-gray-400">Convergence</span>
              <div className="flex gap-0.5">
                {Array.from({
                  length: Math.min(objective.convergence_score, 6),
                }).map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-interaxis-400"
                  />
                ))}
              </div>
              <span className="text-[10px] text-gray-400">
                {objective.convergence_score} causal chains
              </span>
            </div>
          )}

        {/* Rationale */}
        {objective.rationale && (
          <div className="border-t border-gray-100 px-4 py-2.5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">
              Why this matters
            </p>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              {objective.rationale}
            </p>
          </div>
        )}

        {/* Propellant */}
        {objective.propellant && (
          <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-2.5 w-2.5 text-amber-500" />
              <span className="text-[10px] font-medium text-amber-700">
                Propellant: {objective.propellant.entity_name}
              </span>
            </div>
            <p className="text-[10px] text-amber-600/80">
              {objective.propellant.action} — {objective.propellant.why}
            </p>
          </div>
        )}

        {/* Benchmark preview */}
        {objective.benchmark && (
          <div className="border-t border-teal-100 bg-teal-50/30 px-4 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BarChart3 className="h-2.5 w-2.5 text-teal-600" />
              <span className="text-[10px] font-semibold text-teal-700">Evaluation Criteria</span>
              <span className="text-[9px] text-teal-500 ml-auto">
                {objective.benchmark.success_criteria.length} criteria · {objective.benchmark.leading_indicators.length} indicators
              </span>
            </div>
            {objective.benchmark.evaluation_approach && (
              <p className="text-[10px] text-teal-600/80 italic mb-1.5">{objective.benchmark.evaluation_approach}</p>
            )}
            <div className="flex flex-wrap gap-1">
              {objective.benchmark.success_criteria.filter(sc => sc.priority === "must_have").map((sc, i) => (
                <span key={i} className="rounded border border-teal-200 bg-white px-1.5 py-0.5 text-[9px] text-teal-700">
                  {sc.threshold}
                </span>
              ))}
              {objective.benchmark.leading_indicators.slice(0, 2).map((li, i) => (
                <span key={`li-${i}`} className="rounded border border-teal-200 bg-white px-1.5 py-0.5 text-[9px] text-gray-500">
                  <BarChart3 className="inline h-2.5 w-2.5 mr-0.5" />{li.metric}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Advanced edit toggle */}
      <button
        onClick={onToggleAdvanced}
        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        {showAdvanced ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {showAdvanced ? "Hide" : "Edit"} details
      </button>

      {/* Advanced edit form */}
      {showAdvanced && (
        <div
          className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4"
          style={{
            animation: "advancedIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">
              Title
            </label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onEditTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">
              Description
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => onEditDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">
                Metric name
              </label>
              <input
                type="text"
                value={editMetricName}
                onChange={(e) => onEditMetricName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">
                Unit
              </label>
              <input
                type="text"
                value={editMetricUnit}
                onChange={(e) => onEditMetricUnit(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">
                Baseline
              </label>
              <input
                type="number"
                value={editBaseline}
                onChange={(e) => onEditBaseline(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">
                Target
              </label>
              <input
                type="number"
                value={editTarget}
                onChange={(e) => onEditTarget(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-1">
              Deadline
            </label>
            <input
              type="date"
              value={editDeadline}
              onChange={(e) => onEditDeadline(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-interaxis-300 focus:ring-1 focus:ring-interaxis-100 outline-none"
            />
          </div>

          <style jsx global>{`
            @keyframes advancedIn {
              from {
                opacity: 0;
                transform: translateY(-4px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
