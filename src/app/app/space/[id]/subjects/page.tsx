"use client";

// ── Subjects browse page ──
// Route: /app/space/[id]/subjects
//
// Lists every Subject in the space with focus chip + condition
// summary + scope/baseline status + "Open in lab" launch. Mirrors
// the Systems browse page pattern (header + filter chips + per-row
// actions) so users learn one navigational shape across browse
// surfaces.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Search,
  User,
  FileText,
  Package,
  Lightbulb,
  Globe,
  Network,
  Database,
  FlaskConical,
  Hexagon,
  Archive,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUBJECT_FOCUS_LABEL,
  type ListSubjectsResponse,
  type Subject,
  type SubjectFocusKind,
} from "@/types/subject";

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

export default function SubjectsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const spaceId = params.id;

  const [rows, setRows] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusFilter, setFocusFilter] = useState<SubjectFocusKind | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<Set<string>>(new Set());

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/spaces/${spaceId}/subjects${showArchived ? "?status=archived" : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const json = (await r.json()) as ListSubjectsResponse;
      setRows(json.subjects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId, showArchived]);

  useEffect(() => {
    void fetchSubjects();
  }, [fetchSubjects]);

  const focuses = useMemo(() => {
    const set = new Set<SubjectFocusKind>();
    for (const r of rows) set.add(r.focus_kind);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (focusFilter && r.focus_kind !== focusFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.description ?? ""} ${r.focus_label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, focusFilter]);

  const onArchiveToggle = async (subjectId: string, archive: boolean) => {
    setArchiving((s) => new Set(s).add(subjectId));
    try {
      const r = await fetch(`/api/subjects/${subjectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: archive ? "archived" : "active" }),
      });
      if (!r.ok) throw new Error(await r.text());
      await fetchSubjects();
    } catch (err) {
      console.warn("[subjects page] archive toggle failed:", err);
    } finally {
      setArchiving((s) => {
        const next = new Set(s);
        next.delete(subjectId);
        return next;
      });
    }
  };

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-600">
            Subjects
          </div>
          <div className="text-[14px] font-semibold text-slate-900">
            Sandboxes you can experiment against
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name / focus / description…"
              className="w-72 rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[12px] outline-none placeholder:text-slate-400 focus:border-violet-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
              showArchived
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            <Archive className="h-3.5 w-3.5" />
            {showArchived ? "Archived" : "Active"}
          </button>
          <Link
            href={`/app/space/${spaceId}/whiteboard`}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Whiteboard
          </Link>
        </div>
      </div>

      {focuses.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => setFocusFilter(null)}
            className={cn(
              "rounded-full px-2.5 py-1 font-medium transition",
              !focusFilter
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            All ({rows.length})
          </button>
          {focuses.map((k) => {
            const Icon = FOCUS_ICON[k];
            const accent = FOCUS_ACCENT[k];
            const count = rows.filter((r) => r.focus_kind === k).length;
            const selected = focusFilter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFocusFilter(selected ? null : k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition",
                  selected
                    ? "text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
                style={selected ? { background: accent } : undefined}
              >
                <Icon className="h-3 w-3" />
                {SUBJECT_FOCUS_LABEL[k]} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading subjects…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[12px] text-red-600">
            Failed to load: {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
            <Hexagon className="h-8 w-8 text-slate-300" />
            <div className="max-w-md text-[12px] text-slate-500">
              {query || focusFilter
                ? "No subjects match the current filter."
                : "No subjects yet. After strategy-refresh runs, a lab proposal will appear with one or more suggested subjects ready to scaffold."}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((subject) => (
              <SubjectRow
                key={subject.id}
                subject={subject}
                spaceId={spaceId}
                onArchive={() =>
                  onArchiveToggle(
                    subject.id,
                    subject.status !== "archived",
                  )
                }
                isArchiving={archiving.has(subject.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-6 py-2 text-[10px] text-slate-500">
        {filtered.length} of {rows.length}{" "}
        {rows.length === 1 ? "subject" : "subjects"}
        {focusFilter && (
          <span> · filtered to {SUBJECT_FOCUS_LABEL[focusFilter]}</span>
        )}
        {query && <span> · matching &quot;{query}&quot;</span>}
      </div>
    </div>
  );
}

function SubjectRow({
  subject,
  spaceId,
  onArchive,
  isArchiving,
}: {
  subject: Subject;
  spaceId: string;
  onArchive: () => void;
  isArchiving: boolean;
}) {
  const Icon = FOCUS_ICON[subject.focus_kind];
  const accent = FOCUS_ACCENT[subject.focus_kind];
  const conditionCount = Object.keys(subject.conditions ?? {}).length;
  const overrideCount = Object.keys(
    subject.entity_param_overrides ?? {},
  ).length;

  return (
    <li className="px-6 py-3 transition hover:bg-violet-50/30">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
          title={SUBJECT_FOCUS_LABEL[subject.focus_kind]}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-slate-900">
              {subject.name}
            </h3>
            {subject.status === "archived" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                archived
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            <span className="font-medium" style={{ color: accent }}>
              {SUBJECT_FOCUS_LABEL[subject.focus_kind]}
            </span>
            {": "}
            {subject.focus_label}
          </div>
          {subject.description && (
            <p className="mt-0.5 line-clamp-1 text-[10.5px] text-slate-500">
              {subject.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono tabular-nums text-slate-700">
              <Sliders className="h-2.5 w-2.5" />
              {conditionCount} condition{conditionCount === 1 ? "" : "s"}
            </span>
            {overrideCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-mono tabular-nums text-violet-700">
                {overrideCount} override{overrideCount === 1 ? "" : "s"}
              </span>
            )}
            {subject.scope_system_id && (
              <span className="inline-flex items-center gap-1 rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-semibold text-cyan-700">
                <Network className="h-2.5 w-2.5" />
                scoped
              </span>
            )}
            {subject.baseline_snapshot_id && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                baselined
              </span>
            )}
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">
              artifact: {subject.artifact_state.replace("_", " ")}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href={`/app/space/${spaceId}/lab?subjectId=${subject.id}`}
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-violet-700"
            title="Open lab scoped to this subject — sliders edit live conditions, runs log to experiment history."
          >
            <FlaskConical className="h-3 w-3" />
            Lab
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            href={`/app/space/${spaceId}/subjects/${subject.id}`}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Inspect
          </Link>
          <button
            type="button"
            onClick={onArchive}
            disabled={isArchiving}
            className={cn(
              "rounded-md p-1.5 text-slate-400 transition",
              isArchiving
                ? "cursor-wait"
                : "hover:bg-slate-100 hover:text-slate-700",
            )}
            title={
              subject.status === "archived" ? "Restore to active" : "Archive"
            }
          >
            {isArchiving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </li>
  );
}
