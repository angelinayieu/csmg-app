"use client";

// ── Lab proposal wizard ──────────────────────────────────────────
//
// Modal that surfaces a `lab_scaffolds` row with status='proposed'
// for user review. Lets the user:
//   - rename / re-classify proposed subjects
//   - toggle which features (monte_carlo / what_if / ab_compare /
//     deepen_kg) start enabled
//   - approve → POST /api/lab-scaffolds/[id]/approve →
//     materialized subjects come back → modal closes →
//     navigate to lab pre-loaded with the first new subject
//
// Mounted at the whiteboard page level + on the subjects browse
// page. The owner controls open/close + supplies the scaffold id;
// fetching + approving are this component's responsibility.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Loader2,
  FlaskConical,
  Check,
  Sparkles,
  Hexagon,
  User,
  FileText,
  Package,
  Lightbulb,
  Globe,
  Network,
  Database,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SUBJECT_FOCUS_LABEL,
  type LabScaffold,
  type ProposedFeature,
  type ProposedSubject,
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

const FEATURE_LABEL: Record<string, string> = {
  monte_carlo: "Monte Carlo simulation",
  what_if: "What-if scenarios",
  ab_compare: "A/B compare strategies",
  deepen_kg: "Continuous KG deepening",
};

const FEATURE_DESCRIPTION: Record<string, string> = {
  monte_carlo:
    "Numeric distributions over outcome variables (~400 iterations per run).",
  what_if:
    "LLM-grounded scenarios — strengthen / weaken / remove a target entity.",
  ab_compare:
    "Side-by-side compare two systems running the same scenario.",
  deepen_kg:
    "Auto-fire research-deep on subject neighborhood. Higher LLM cost — opt in.",
};

interface Props {
  spaceId: string;
  scaffoldId: string;
  open: boolean;
  onClose: () => void;
  /** Optional callback fired after successful scaffolding so the
   *  owner can refresh subject lists / navigate. */
  onScaffolded?: (subjects: Subject[]) => void;
}

export function LabProposalWizard({
  spaceId,
  scaffoldId,
  open,
  onClose,
  onScaffolded,
}: Props) {
  const router = useRouter();
  const [scaffold, setScaffold] = useState<LabScaffold | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local edit buffers — user toggles are committed to these, then
  // POSTed on Approve.
  const [draftSubjects, setDraftSubjects] = useState<ProposedSubject[]>([]);
  const [keptIndices, setKeptIndices] = useState<Set<number>>(new Set());
  const [draftFeatures, setDraftFeatures] = useState<ProposedFeature[]>([]);
  const [approving, setApproving] = useState(false);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch the scaffold when modal opens.
  useEffect(() => {
    if (!open || !scaffoldId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // The list endpoint filters by status; we just want this one
    // row, so query by id via the list with a client-side find.
    // (No /api/lab-scaffolds/[id] GET endpoint exists yet — we
    // could add one but the list call is cheap at scale of a few
    // proposals.)
    fetch(`/api/spaces/${spaceId}/lab-scaffolds`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
        return r.json();
      })
      .then((json: { scaffolds: LabScaffold[] }) => {
        if (cancelled) return;
        const found = (json.scaffolds ?? []).find((s) => s.id === scaffoldId);
        if (!found) {
          setError("Scaffold not found.");
          return;
        }
        setScaffold(found);
        setDraftSubjects(found.proposed_subjects);
        setKeptIndices(
          new Set(found.proposed_subjects.map((_, i) => i)),
        );
        setDraftFeatures(found.proposed_features);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scaffoldId, spaceId]);

  const updateSubject = useCallback(
    (i: number, patch: Partial<ProposedSubject>) => {
      setDraftSubjects((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      });
    },
    [],
  );
  const toggleKept = useCallback((i: number) => {
    setKeptIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const toggleFeature = useCallback((id: string, on: boolean) => {
    setDraftFeatures((prev) =>
      prev.map((f) => (f.id === id ? { ...f, default_on: on } : f)),
    );
  }, []);

  const acceptedSubjects = useMemo(
    () => draftSubjects.filter((_, i) => keptIndices.has(i)),
    [draftSubjects, keptIndices],
  );
  const canApprove = acceptedSubjects.length > 0 && !approving;

  const onApprove = async () => {
    if (!canApprove) return;
    setApproving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/lab-scaffolds/${scaffoldId}/approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjects: acceptedSubjects,
            features: draftFeatures,
            parameters: scaffold?.proposed_parameters ?? {},
          }),
        },
      );
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`approve failed: ${r.status} ${txt.slice(0, 120)}`);
      }
      const json = (await r.json()) as { subjects: Subject[] };
      const newSubjects = json.subjects ?? [];
      onScaffolded?.(newSubjects);
      onClose();
      // Open the lab on the first new subject by default.
      if (newSubjects.length > 0) {
        router.push(
          `/app/space/${spaceId}/lab?subjectId=${newSubjects[0].id}`,
        );
      } else {
        router.push(`/app/space/${spaceId}/subjects`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-slate-900/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Lab proposal wizard"
        className="fixed left-1/2 top-1/2 z-[90] w-[640px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_-16px_rgba(15,23,42,0.25)]"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-b from-violet-50 to-white px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-700">
              Lab proposal
            </div>
            <h2 className="mt-1 text-[15px] font-semibold text-slate-900">
              Review subjects + features before scaffolding
            </h2>
            <p className="mt-1 text-[11.5px] text-slate-600">
              The pipeline proposed these subjects + lab features based on the
              current strategy and KG. Adjust then approve to materialize.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading proposal…
            </div>
          ) : error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
              {error}
            </div>
          ) : !scaffold ? null : (
            <>
              {/* Subjects */}
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Proposed subjects ({draftSubjects.length})
                </h3>
                <ul className="space-y-2">
                  {draftSubjects.map((s, i) => {
                    const Icon = FOCUS_ICON[s.focus_kind];
                    const kept = keptIndices.has(i);
                    return (
                      <li
                        key={i}
                        className={cn(
                          "rounded-lg border p-3 transition",
                          kept
                            ? "border-violet-200 bg-violet-50/40"
                            : "border-slate-200 bg-white opacity-60",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={kept}
                            onChange={() => toggleKept(i)}
                            className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-400"
                          />
                          <div
                            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                            style={{
                              background: "rgba(124,58,237,0.10)",
                              color: "#7c3aed",
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                              {SUBJECT_FOCUS_LABEL[s.focus_kind]}
                            </div>
                            <input
                              value={s.focus_label}
                              onChange={(e) =>
                                updateSubject(i, { focus_label: e.target.value })
                              }
                              disabled={!kept}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[12.5px] font-semibold outline-none focus:border-violet-400 disabled:cursor-not-allowed"
                              placeholder="What's the center of focus?"
                            />
                            {s.rationale && (
                              <p className="text-[10.5px] italic text-slate-500">
                                {s.rationale}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Features */}
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Lab features
                </h3>
                <ul className="space-y-1.5">
                  {draftFeatures.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2.5"
                    >
                      <input
                        type="checkbox"
                        checked={f.default_on}
                        onChange={(e) =>
                          toggleFeature(f.id, e.target.checked)
                        }
                        className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-slate-800">
                          {FEATURE_LABEL[f.id] ?? f.id}
                        </div>
                        <div className="text-[10.5px] text-slate-500">
                          {FEATURE_DESCRIPTION[f.id] ?? ""}
                        </div>
                        {f.rationale && (
                          <div className="mt-0.5 text-[10px] italic text-slate-400">
                            {f.rationale}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <span className="text-[10.5px] text-slate-500">
            <Sparkles className="mr-1 inline-block h-3 w-3 text-violet-500" />
            Approving creates {acceptedSubjects.length} subject
            {acceptedSubjects.length === 1 ? "" : "s"} + opens the lab.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={!canApprove}
              className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve & scaffold
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
