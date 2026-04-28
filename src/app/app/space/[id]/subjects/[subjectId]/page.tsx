"use client";

// ── Subject detail page ──
// Route: /app/space/[id]/subjects/[subjectId]
//
// Edit a subject's identity / artifact_state / scope_system_id /
// baseline_snapshot_id / conditions (via the slider panel) /
// entity overrides. Plus the experiment history strip showing the
// 20 most-recent runs from `subject_experiments`.
//
// "Open in lab" launches the lab scoped to this subject — the lab
// reads `?subjectId=` and applies conditions + overrides via
// applyModulators() at render time.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Archive,
  Trash2,
  FlaskConical,
  Network,
  Camera,
  AlertCircle,
  Pencil,
  Save,
  Sliders,
  History,
  Sparkles,
  User,
  FileText,
  Package,
  Lightbulb,
  Globe,
  Database,
  Hexagon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUBJECT_FOCUS_LABEL,
  SUBJECT_SOURCE_LABEL,
  type Subject,
  type SubjectArtifactState,
  type SubjectDetailResponse,
  type SubjectExperiment,
  type SubjectFocusKind,
} from "@/types/subject";
import { ConditionModulatorsPanel } from "@/components/canvas/chrome/condition-modulators-panel";
import { defaultConditions, STARTER_MODULATORS } from "@/lib/subjects/modulators";

const FOCUS_ICON: Record<SubjectFocusKind, typeof User> = {
  person: User,
  document: FileText,
  product: Package,
  topic: Lightbulb,
  environment: Globe,
  system: Network,
  data: Database,
  reaction: FlaskConical,
  other: Hexagon,
};
const FOCUS_ACCENT: Record<SubjectFocusKind, string> = {
  person: "#0891b2",
  document: "#7c3aed",
  product: "#ea580c",
  topic: "#ca8a04",
  environment: "#16a34a",
  system: "#0284c7",
  data: "#dc2626",
  reaction: "#a855f7",
  other: "#64748b",
};

const ARTIFACT_STATE_LABEL: Record<SubjectArtifactState, string> = {
  bare_topic: "Bare topic — KG generates freely",
  partial_artifact: "Partial artifact — anchor & find gaps",
  complete_artifact: "Complete artifact — critique only",
};

export default function SubjectDetailPage() {
  const params = useParams<{ id: string; subjectId: string }>();
  const router = useRouter();
  const spaceId = params.id;
  const subjectId = params.subjectId;

  const [data, setData] = useState<SubjectDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Local conditions buffer — debounced PATCH on change so sliding
  // doesn't fire one network call per pixel.
  const [localConditions, setLocalConditions] = useState<Record<
    string,
    number
  > | null>(null);
  const [savingConditions, setSavingConditions] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/subjects/${subjectId}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const json = (await r.json()) as SubjectDetailResponse;
      setData(json);
      setEditedName(json.subject.name);
      setLocalConditions(json.subject.conditions ?? defaultConditions(STARTER_MODULATORS));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Debounced PATCH for conditions — fires 600ms after the last
  // slider change.
  useEffect(() => {
    if (!data || localConditions === null) return;
    const same = JSON.stringify(data.subject.conditions) === JSON.stringify(localConditions);
    if (same) return;
    setSavingConditions(true);
    const t = window.setTimeout(async () => {
      try {
        await fetch(`/api/subjects/${subjectId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conditions: localConditions }),
        });
      } catch (err) {
        console.warn("[subject detail] conditions save failed:", err);
      } finally {
        setSavingConditions(false);
      }
    }, 600);
    return () => {
      window.clearTimeout(t);
      setSavingConditions(false);
    };
  }, [localConditions, data, subjectId]);

  const onSaveName = async () => {
    if (!data || !editedName.trim() || editedName.trim() === data.subject.name)
      return;
    setSavingMeta(true);
    try {
      await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editedName.trim() }),
      });
      await fetchDetail();
      setEditingName(false);
    } finally {
      setSavingMeta(false);
    }
  };

  const onArchive = async () => {
    if (!data) return;
    setArchiving(true);
    try {
      const next = data.subject.status === "archived" ? "active" : "archived";
      await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      await fetchDetail();
    } finally {
      setArchiving(false);
    }
  };

  const onDelete = async () => {
    if (!data) return;
    if (
      !window.confirm(
        `Delete subject "${data.subject.name}"? Experiment history will be removed too.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await fetch(`/api/subjects/${subjectId}`, {
        method: "DELETE",
        credentials: "include",
      });
      router.push(`/app/space/${spaceId}/subjects`);
    } catch {
      setDeleting(false);
    }
  };

  const onChangeArtifactState = async (next: SubjectArtifactState) => {
    if (!data) return;
    await fetch(`/api/subjects/${subjectId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact_state: next }),
    });
    await fetchDetail();
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-[12px] text-slate-500">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading subject…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white">
        <AlertCircle className="h-8 w-8 text-rose-400" />
        <div className="text-[13px] font-medium text-slate-700">
          Couldn&apos;t load subject
        </div>
        <div className="text-[11px] text-slate-500">{error}</div>
        <Link
          href={`/app/space/${spaceId}/subjects`}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to subjects
        </Link>
      </div>
    );
  }

  const { subject, recent_experiments, baseline_snapshot_meta, scope_system_summary } = data;
  const Icon = FOCUS_ICON[subject.focus_kind];
  const accent = FOCUS_ACCENT[subject.focus_kind];

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500">
          <Link
            href={`/app/space/${spaceId}/subjects`}
            className="inline-flex items-center gap-1 hover:text-slate-700"
          >
            <ArrowLeft className="h-3 w-3" /> Subjects
          </Link>
          <span className="text-slate-300">/</span>
          <span className="truncate font-medium text-slate-700">
            {subject.name}
          </span>
          {subject.status === "archived" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
              archived
            </span>
          )}
        </div>
        <div className="flex items-start gap-4">
          <div
            className="mt-0.5 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
              border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
            }}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.14em]"
              style={{ color: accent }}
            >
              {SUBJECT_FOCUS_LABEL[subject.focus_kind]} · Subject
            </div>
            {editingName ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="flex-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-[16px] font-semibold outline-none"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSaveName();
                    if (e.key === "Escape") {
                      setEditedName(subject.name);
                      setEditingName(false);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={onSaveName}
                  disabled={savingMeta}
                  className="rounded-md bg-violet-600 p-1.5 text-white hover:bg-violet-700 disabled:cursor-wait"
                >
                  {savingMeta ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ) : (
              <h1
                className="mt-1 text-[18px] font-semibold leading-tight tracking-tight text-slate-900"
                onDoubleClick={() => setEditingName(true)}
              >
                {subject.name}
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="ml-2 rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Rename"
                >
                  <Pencil className="inline-block h-3 w-3" />
                </button>
              </h1>
            )}
            <div className="mt-1 text-[12px] text-slate-600">
              {subject.focus_label}
            </div>
            {subject.description && (
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-600">
                {subject.description}
              </p>
            )}
          </div>
          {/* Action stack */}
          <div className="flex flex-shrink-0 flex-col gap-2">
            <Link
              href={`/app/space/${spaceId}/lab?subjectId=${subjectId}`}
              className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-violet-700"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Open in lab
              <ArrowRight className="h-3 w-3" />
            </Link>
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={onArchive}
                disabled={archiving}
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10.5px] text-slate-600 hover:bg-slate-50 disabled:cursor-wait"
              >
                {archiving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Archive className="h-3 w-3" />
                )}
                {subject.status === "archived" ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[10.5px] text-rose-700 hover:bg-rose-50 disabled:cursor-wait"
              >
                {deleting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-5">
            {/* Composition card */}
            <section>
              <SectionHeading
                title="Composition"
                subtitle="What this subject is built from"
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CompositionCell
                  icon={Camera}
                  label="Baseline snapshot"
                  value={
                    baseline_snapshot_meta
                      ? `${baseline_snapshot_meta.reason} · ${new Date(baseline_snapshot_meta.captured_at).toLocaleString()}`
                      : "(no snapshot)"
                  }
                  tone={baseline_snapshot_meta ? "emerald" : "slate"}
                />
                <CompositionCell
                  icon={Network}
                  label="Scope system"
                  value={
                    scope_system_summary
                      ? `${scope_system_summary.name} (${scope_system_summary.entity_count} entities)`
                      : "(whole space)"
                  }
                  href={
                    scope_system_summary
                      ? `/app/space/${spaceId}/systems/${scope_system_summary.id}`
                      : undefined
                  }
                  tone={scope_system_summary ? "cyan" : "slate"}
                />
                <CompositionCell
                  icon={Sparkles}
                  label="Source"
                  value={
                    subject.source_kind
                      ? SUBJECT_SOURCE_LABEL[subject.source_kind]
                      : "Manual"
                  }
                  tone="slate"
                />
                <ArtifactStateCell
                  current={subject.artifact_state}
                  onChange={onChangeArtifactState}
                />
              </div>
            </section>

            {/* Conditions / modulators */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionHeading
                  title="Conditions"
                  subtitle="Sliders modulate effective entity parameters in the lab"
                />
                {savingConditions && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    saving…
                  </span>
                )}
              </div>
              {localConditions && (
                <ConditionModulatorsPanel
                  conditions={localConditions}
                  onChange={setLocalConditions}
                />
              )}
            </section>
          </div>

          {/* Right column — experiment history */}
          <div>
            <SectionHeading
              title="Experiment history"
              subtitle={`${recent_experiments.length} most-recent runs`}
            />
            {recent_experiments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[11px] text-slate-500">
                <History className="mx-auto mb-2 h-5 w-5 text-slate-300" />
                No experiments yet. Open this subject in the lab and run a what-if or Monte Carlo.
              </div>
            ) : (
              <ul className="space-y-2">
                {recent_experiments.map((exp) => (
                  <ExperimentRow key={exp.id} exp={exp} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        Saved {new Date(subject.created_at).toLocaleString()} · Updated{" "}
        {new Date(subject.updated_at).toLocaleString()}
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </h2>
      {subtitle && (
        <span className="text-[10px] text-slate-400">{subtitle}</span>
      )}
    </div>
  );
}

function CompositionCell({
  icon: Icon,
  label,
  value,
  href,
  tone,
}: {
  icon: typeof Sliders;
  label: string;
  value: string;
  href?: string;
  tone: "slate" | "emerald" | "cyan";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50/50",
    cyan: "border-cyan-200 bg-cyan-50/50",
  } as const;
  const Wrapper = href ? Link : "div";
  return (
    <Wrapper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(href ? ({ href } as any) : {})}
      className={cn(
        "block rounded-lg border p-2.5 transition",
        tones[tone],
        href && "hover:bg-violet-50/40",
      )}
    >
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <div className="mt-1 truncate text-[11.5px] font-medium text-slate-800">
        {value}
      </div>
    </Wrapper>
  );
}

function ArtifactStateCell({
  current,
  onChange,
}: {
  current: SubjectArtifactState;
  onChange: (next: SubjectArtifactState) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
        <Sparkles className="h-2.5 w-2.5" />
        Artifact state
      </div>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value as SubjectArtifactState)}
        className="mt-1 w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11.5px] text-slate-800 outline-none focus:border-violet-400"
      >
        {(Object.keys(ARTIFACT_STATE_LABEL) as SubjectArtifactState[]).map(
          (key) => (
            <option key={key} value={key}>
              {ARTIFACT_STATE_LABEL[key]}
            </option>
          ),
        )}
      </select>
    </div>
  );
}

function ExperimentRow({ exp }: { exp: SubjectExperiment }) {
  const summary = useMemo(() => {
    const s = exp.outcome_summary as
      | { p10?: number; p50?: number; p90?: number; verdict?: string }
      | null;
    if (!s) return "(no summary)";
    if (typeof s.p50 === "number") {
      return `p50 ${s.p50.toFixed(2)}${
        typeof s.p10 === "number" && typeof s.p90 === "number"
          ? ` (${s.p10.toFixed(2)}–${s.p90.toFixed(2)})`
          : ""
      }`;
    }
    if (typeof s.verdict === "string") return s.verdict;
    return JSON.stringify(s).slice(0, 60);
  }, [exp.outcome_summary]);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-700">
          {exp.run_kind.replace("_", " ")}
        </span>
        <span className="text-[10px] text-slate-400">
          {new Date(exp.ran_at).toLocaleString()}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10.5px] text-slate-700">
        {summary}
      </div>
      {Object.keys(exp.conditions_at_run ?? {}).length > 0 && (
        <div className="mt-1 truncate text-[9.5px] italic text-slate-500">
          conditions: {Object.entries(exp.conditions_at_run)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
        </div>
      )}
    </li>
  );
}
