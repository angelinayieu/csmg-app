"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw, Pause, Play, Archive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchAgent, AgentOverrides, ResearchDepth } from "@/types/intelligence";

interface AgentConfigFormProps {
  agent: ResearchAgent;
  currentOverrides: AgentOverrides | undefined;
  spaceId: string;
  onSaved: (newOverrides: AgentOverrides) => void;
  onReset?: () => void;
}

const DEPTH_OPTIONS: { value: ResearchDepth; label: string; cost: string }[] = [
  { value: "training", label: "Training", cost: "~free" },
  { value: "light",    label: "Light",    cost: "~$0.02" },
  { value: "standard", label: "Standard", cost: "~$0.05" },
  { value: "deep",     label: "Deep",     cost: "~$0.10" },
];

const CADENCE_OPTIONS = [
  { value: "inherit",  label: "Inherit schedule" },
  { value: "manual",   label: "Manual only" },
  { value: "daily",    label: "Daily" },
  { value: "weekly",   label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly",  label: "Monthly" },
] as const;

export function AgentConfigForm({
  agent,
  currentOverrides,
  spaceId,
  onSaved,
  onReset,
}: AgentConfigFormProps) {
  // Form state (initialize from existing overrides or agent defaults)
  const [lifecycle, setLifecycle] = useState<AgentOverrides["lifecycle"]>(
    currentOverrides?.lifecycle ?? "active",
  );
  const [displayName, setDisplayName] = useState(
    currentOverrides?.name ?? agent.name,
  );
  const [specialty, setSpecialty] = useState(
    currentOverrides?.specialty ?? agent.specialty ?? "",
  );
  const [depth, setDepth] = useState<ResearchDepth | "inherit">(
    currentOverrides?.depth ?? "inherit" as ResearchDepth | "inherit",
  );
  const [cadence, setCadence] = useState<NonNullable<AgentOverrides["cadence"]>>(
    currentOverrides?.cadence ?? "inherit",
  );
  const [extraFocus, setExtraFocus] = useState(
    (currentOverrides?.extra_focus_areas ?? []).join(", "),
  );
  const [excludedFocus, setExcludedFocus] = useState(
    (currentOverrides?.excluded_focus_areas ?? []).join(", "),
  );
  const [budgetPerRun, setBudgetPerRun] = useState<string>(
    currentOverrides?.budget_per_run != null ? String(currentOverrides.budget_per_run) : "",
  );
  const [budgetMonthly, setBudgetMonthly] = useState<string>(
    currentOverrides?.budget_monthly != null ? String(currentOverrides.budget_monthly) : "",
  );
  const [promptAddendum, setPromptAddendum] = useState(
    currentOverrides?.prompt_addendum ?? "",
  );
  const [avoidDomains, setAvoidDomains] = useState(
    (currentOverrides?.avoid_domains ?? []).join(", "),
  );

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Mark dirty on any change
  useEffect(() => {
    setDirty(true);
  }, [lifecycle, displayName, specialty, depth, cadence, extraFocus, excludedFocus, budgetPerRun, budgetMonthly, promptAddendum, avoidDomains]);

  // Don't mark dirty on mount
  useEffect(() => {
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        spaceId,
        agentId: agent.id,
        overrides: {
          lifecycle,
          name: displayName !== agent.name ? displayName : undefined,
          specialty: specialty !== (agent.specialty ?? "") ? specialty : undefined,
          depth: depth !== "inherit" ? depth : undefined,
          cadence,
          extra_focus_areas: parseCsv(extraFocus),
          excluded_focus_areas: parseCsv(excludedFocus),
          budget_per_run: budgetPerRun ? parseFloat(budgetPerRun) : undefined,
          budget_monthly: budgetMonthly ? parseFloat(budgetMonthly) : undefined,
          prompt_addendum: promptAddendum || undefined,
          avoid_domains: parseCsv(avoidDomains),
        },
      };

      const res = await fetch("/api/pipeline/agent-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onSaved(data.overrides as AgentOverrides);
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/pipeline/agent-overrides?spaceId=${spaceId}&agentId=${encodeURIComponent(agent.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onReset?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Lifecycle controls */}
      <Section label="Lifecycle">
        <div className="flex gap-1.5">
          <LifecycleButton
            active={lifecycle === "active"}
            onClick={() => setLifecycle("active")}
            icon={<Play className="h-3 w-3" />}
            label="Active"
            tone="green"
          />
          <LifecycleButton
            active={lifecycle === "paused"}
            onClick={() => setLifecycle("paused")}
            icon={<Pause className="h-3 w-3" />}
            label="Paused"
            tone="amber"
          />
          <LifecycleButton
            active={lifecycle === "archived"}
            onClick={() => setLifecycle("archived")}
            icon={<Archive className="h-3 w-3" />}
            label="Archived"
            tone="gray"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Paused agents skip scheduled runs but stay visible. Archived agents are hidden from the fleet strip.
        </p>
      </Section>

      {/* Identity */}
      <Section label="Identity">
        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
          />
        </Field>
        <Field label="Specialty" hint="Short description shown on the fleet card">
          <input
            type="text"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder={agent.specialty ?? "e.g., Regulatory specialist"}
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
          />
        </Field>
      </Section>

      {/* Research config */}
      <Section label="Research configuration">
        <Field label="Depth override" hint="Leave as 'Inherit' to follow the workspace schedule">
          <div className="grid grid-cols-5 gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setDepth("inherit")}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-semibold transition-all",
                depth === "inherit" ? "bg-white text-[#007AFF] shadow-sm" : "text-gray-500",
              )}
            >
              Inherit
            </button>
            {DEPTH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDepth(opt.value)}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-semibold transition-all",
                  depth === opt.value ? "bg-white text-[#007AFF] shadow-sm" : "text-gray-500",
                )}
                title={opt.cost}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Cadence override">
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
          >
            {CADENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Extra focus areas"
          hint="Comma-separated; added to the agent's derived focus areas"
        >
          <input
            type="text"
            value={extraFocus}
            onChange={(e) => setExtraFocus(e.target.value)}
            placeholder="e.g., compliance, EU AI Act"
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
          />
        </Field>

        <Field
          label="Excluded focus areas"
          hint="Comma-separated; blocks these terms even if auto-derived"
        >
          <input
            type="text"
            value={excludedFocus}
            onChange={(e) => setExcludedFocus(e.target.value)}
            placeholder="e.g., generic_marketing"
            className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
          />
        </Field>
      </Section>

      {/* Budget */}
      <Section label="Budget caps" hint="Prevent runaway costs. Leave blank for no cap.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Per-run (USD)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetPerRun}
              onChange={(e) => setBudgetPerRun(e.target.value)}
              placeholder="e.g., 0.15"
              className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
            />
          </Field>
          <Field label="Monthly (USD)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetMonthly}
              onChange={(e) => setBudgetMonthly(e.target.value)}
              placeholder="e.g., 10.00"
              className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
            />
          </Field>
        </div>
      </Section>

      {/* Prompt augmentation */}
      <Section label="Prompt augmentation" hint="Extra context appended to the research LLM call">
        <textarea
          value={promptAddendum}
          onChange={(e) => setPromptAddendum(e.target.value)}
          rows={3}
          placeholder="e.g., Prioritize 2024-2026 publications. Ignore consulting-firm reports."
          className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF] resize-y"
        />
      </Section>

      {/* Avoid domains */}
      <Section label="Avoid domains" hint="Comma-separated domains to deprioritize in search">
        <input
          type="text"
          value={avoidDomains}
          onChange={(e) => setAvoidDomains(e.target.value)}
          placeholder="e.g., wikipedia.org, reddit.com"
          className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#007AFF]"
        />
      </Section>

      {/* Save bar */}
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-gray-200 bg-white/95 backdrop-blur py-3">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-all",
            !dirty
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-[#007AFF] text-white hover:bg-[#0062CC]",
          )}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>

        {currentOverrides && (
          <button
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 hover:border-gray-300"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
        )}

        {saveError && (
          <span className="text-[11px] text-red-600">Error: {saveError}</span>
        )}
        {!saveError && !dirty && currentOverrides && (
          <span className="text-[11px] text-gray-400">
            Updated {formatRel(currentOverrides.updated_at)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {label}
        </h4>
        {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold text-gray-700">
        {label}
        {hint && <span className="ml-1.5 font-normal text-gray-400">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function LifecycleButton({
  active,
  onClick,
  icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "green" | "amber" | "gray";
}) {
  const activeClasses: Record<string, string> = {
    green: "bg-green-50 text-green-700 border-green-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    gray:  "bg-gray-100 text-gray-600 border-gray-300",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all",
        active
          ? activeClasses[tone]
          : "border-gray-200 bg-white text-gray-500 hover:border-gray-300",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Helpers ──

function parseCsv(s: string): string[] | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  return trimmed.split(",").map((x) => x.trim()).filter(Boolean);
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
