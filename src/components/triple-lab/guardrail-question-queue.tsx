"use client";

// Guardrail question queue — bottom-right of insights panel.
//
// Reads /api/spaces/[id]/guardrail-questions, renders one question
// at a time, lets the user Skip or Answer. Each answer POSTs to the
// same endpoint and immediately becomes a constraint on the next
// LLM call (via buildGuardrailBlock injected into intent-context).
//
// Why one question at a time:
// - A wall of 10 questions feels like a wizard, kills attention.
// - Answering one question reshapes which questions matter next
//   (e.g., answering "what's the population?" eliminates several
//   downstream domain-anchoring asks). Showing only the top of the
//   queue lets us re-prioritize on every cycle.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuardrailQuestion } from "@/lib/prompts/guardrail-questions";

interface GuardrailQueueProps {
  spaceId: string;
}

interface QueueResponse {
  questions: GuardrailQuestion[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: Record<string, any>;
  signal_count: number;
}

export function GuardrailQuestionQueue({ spaceId }: GuardrailQueueProps) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  // Fetch on mount + refetch when the URL params or space changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/spaces/${spaceId}/guardrail-questions`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as QueueResponse;
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // The active question is the first un-skipped one. Skipping is
  // ephemeral (session-local) — the question stays in the queue but
  // doesn't surface this session. Answering removes it permanently
  // from the server-side queue.
  const activeQuestion = data?.questions.find((q) => !skippedIds.has(q.id)) ?? null;

  if (loading) {
    return <Shell>Loading guardrail queue…</Shell>;
  }
  if (!activeQuestion) {
    // Empty state — either no signals at all, or user has answered/
    // skipped everything. Both are good outcomes; surface the count
    // so the user knows what they accomplished.
    const answeredCount = data ? Object.keys(data.answers).length : 0;
    return (
      <Shell>
        <div className="flex items-center gap-2 text-[10.5px]">
          <span style={{ color: "#10B981" }}>●</span>
          <span className="text-slate-700 font-medium">
            {answeredCount > 0
              ? `${answeredCount} guardrail${answeredCount === 1 ? "" : "s"} active`
              : "No guardrail questions right now"}
          </span>
          <span className="ml-auto text-[9.5px] text-slate-500">
            {data?.signal_count ?? 0} signal{data?.signal_count === 1 ? "" : "s"} scanned
          </span>
        </div>
      </Shell>
    );
  }

  const onSkip = () => {
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(activeQuestion.id);
      return next;
    });
    setDraft("");
  };

  const onSubmit = async () => {
    if (draft.trim().length < 2) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/guardrail-questions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question_id: activeQuestion.id,
            question_text: activeQuestion.question,
            category: activeQuestion.category,
            answer: draft.trim(),
          }),
        },
      );
      if (res.ok) {
        // Remove from queue + clear draft + refetch so the next
        // question slides in. router.refresh() ensures any downstream
        // surfaces (insight panels) that depend on guardrail_answers
        // re-render with the new constraints.
        const body = (await res.json()) as { answers: Record<string, unknown> };
        setData((prev) =>
          prev
            ? {
                ...prev,
                questions: prev.questions.filter(
                  (q) => q.id !== activeQuestion.id,
                ),
                answers: body.answers as QueueResponse["answers"],
              }
            : prev,
        );
        setDraft("");
        router.refresh();
      }
    } catch {
      // Soft-fail; let the user retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div className="space-y-2">
        {/* Header: category + severity chip */}
        <div className="flex items-center gap-1.5">
          <CategoryPill category={activeQuestion.category} />
          <SeverityDot severity={activeQuestion.severity} />
          <span className="text-[9px] text-slate-500">
            {data ? data.questions.length : 0} in queue
          </span>
        </div>

        {/* Question */}
        <div className="text-[11.5px] font-semibold leading-snug text-slate-900">
          {activeQuestion.question}
        </div>

        {/* Why */}
        <div
          className="rounded-md px-2 py-1.5 text-[10px] leading-relaxed"
          style={{
            background: "rgba(79, 70, 229, 0.05)",
            color: "rgb(55, 48, 163)",
          }}
        >
          <span className="font-semibold">Why it matters: </span>
          {activeQuestion.why_it_matters}
        </div>

        {/* Answer input */}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={answerKindPlaceholder(activeQuestion.answer_kind)}
          rows={2}
          className="w-full resize-none rounded-md border px-2 py-1.5 text-[11px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          style={{
            background: "white",
            borderColor: "rgba(15, 23, 42, 0.12)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onSubmit();
            }
          }}
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={submitting}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || draft.trim().length < 2}
            className="ml-auto rounded-md px-2.5 py-1 text-[10px] font-bold text-white transition-all disabled:opacity-50"
            style={{
              background:
                draft.trim().length >= 2
                  ? "linear-gradient(135deg, #818CF8 0%, #4F46E5 100%)"
                  : "rgba(15, 23, 42, 0.3)",
              boxShadow:
                draft.trim().length >= 2
                  ? "0 4px 12px rgba(79, 70, 229, 0.22)"
                  : "none",
            }}
          >
            {submitting ? "Saving…" : "Answer →"}
          </button>
        </div>
        <div className="text-[8.5px] text-slate-400">
          ⌘⏎ to submit · answer tightens future recommendations across this space
        </div>
      </div>
    </Shell>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="shrink-0 border-t border-slate-200/60 px-4 py-3"
      style={{
        background:
          "linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(245, 247, 251, 0.95) 100%)",
      }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <div
          className="flex h-5 w-5 items-center justify-center rounded-full"
          style={{ background: "rgba(79, 70, 229, 0.1)" }}
        >
          <span className="text-[11px] font-bold" style={{ color: "#4F46E5" }}>
            ?
          </span>
        </div>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">
          Guardrail queue
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Decoration helpers ───────────────────────────────────────────────
function CategoryPill({ category }: { category: GuardrailQuestion["category"] }) {
  const colors: Record<GuardrailQuestion["category"], { bg: string; fg: string }> = {
    falsifiability: { bg: "rgba(220, 38, 38, 0.1)", fg: "#991B1B" },
    mechanism: { bg: "rgba(79, 70, 229, 0.12)", fg: "#4338CA" },
    measurement: { bg: "rgba(13, 148, 136, 0.12)", fg: "#0F766E" },
    evidence: { bg: "rgba(8, 145, 178, 0.12)", fg: "#0E7490" },
    domain: { bg: "rgba(139, 92, 246, 0.12)", fg: "#6D28D9" },
    scope: { bg: "rgba(245, 158, 11, 0.14)", fg: "#92400E" },
    axiom_visibility: { bg: "rgba(99, 102, 241, 0.14)", fg: "#3730A3" },
  };
  const c = colors[category];
  return (
    <span
      className="rounded px-1.5 text-[8.5px] font-bold uppercase tracking-wider"
      style={{ background: c.bg, color: c.fg }}
    >
      {category.replace(/_/g, " ")}
    </span>
  );
}

function SeverityDot({ severity }: { severity: GuardrailQuestion["severity"] }) {
  const color =
    severity === "critical"
      ? "#DC2626"
      : severity === "important"
      ? "#F59E0B"
      : "#94A3B8";
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: color }}
      title={severity}
    />
  );
}

function answerKindPlaceholder(kind: GuardrailQuestion["answer_kind"]): string {
  switch (kind) {
    case "metric":
      return 'e.g. "weekly active users", "ms latency", "% adherence"';
    case "counterexample":
      return "e.g. 'If I saw X happen, I'd abandon this leverage point'";
    case "threshold":
      return "e.g. 'effect size > 0.3', 'within 8 weeks'";
    case "definition":
      return "one-sentence operational definition";
    case "population":
      return 'e.g. "adults 25-45", "B2B SaaS startups"';
    case "free_text":
    default:
      return "Type your answer (⌘⏎ to submit)";
  }
}
