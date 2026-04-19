"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MessageCircleQuestion,
  Trash2,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntityQuestion, EntityQuestionStatus } from "@/types/entity-question";

interface EntityQuestionsPanelProps {
  spaceId: string;
  entityId: string;
  /** Called externally to programmatically open the "ask" form (e.g. from a toolbar button). */
  forceOpenForm?: boolean;
  onFormClosed?: () => void;
}

const STATUS_META: Record<EntityQuestionStatus, { label: string; color: string; Icon: React.ElementType }> = {
  open: {
    label: "Open",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    Icon: Clock,
  },
  researching: {
    label: "Researching",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    Icon: Loader2,
  },
  answered: {
    label: "Answered",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Icon: CheckCircle2,
  },
  dismissed: {
    label: "Dismissed",
    color: "bg-gray-100 text-gray-500 border-gray-200",
    Icon: XCircle,
  },
};

/**
 * Entity Questions panel — inline form + list.
 *
 * Displays all questions attached to `entityId` and lets the user create new
 * ones via an inline textarea. Questions persist to the `entity_questions`
 * table via POST /api/spaces/[id]/questions. Delete removes a question.
 *
 * Re-fetches on mount + after every successful mutation.
 */
export function EntityQuestionsPanel({
  spaceId,
  entityId,
  forceOpenForm = false,
  onFormClosed,
}: EntityQuestionsPanelProps) {
  const [questions, setQuestions] = useState<EntityQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(forceOpenForm);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync with parent's forceOpenForm so clicking the right-rail button opens the form
  useEffect(() => {
    if (forceOpenForm) setFormOpen(true);
  }, [forceOpenForm]);

  // Fetch questions for this entity
  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/questions?entityId=${entityId}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { questions: EntityQuestion[] };
      setQuestions(data.questions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [spaceId, entityId]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 3) {
      setError("Question must be at least 3 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          question_text: trimmed,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      setFormOpen(false);
      onFormClosed?.();
      await fetchQuestions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [draft, spaceId, entityId, fetchQuestions, onFormClosed]);

  const handleDelete = useCallback(
    async (qId: string) => {
      if (!confirm("Delete this question?")) return;
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/questions?questionId=${qId}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        await fetchQuestions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [spaceId, fetchQuestions],
  );

  return (
    <div className="space-y-3">
      {/* Header + "Ask" toggle */}
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-bold text-gray-800">Questions</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
          {questions.length}
        </span>
        <div className="ml-auto">
          {!formOpen ? (
            <button
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-interaxis-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-interaxis-700"
            >
              Ask
            </button>
          ) : (
            <button
              onClick={() => {
                setFormOpen(false);
                setDraft("");
                onFormClosed?.();
              }}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Inline form */}
      {formOpen && (
        <div className="rounded-lg border border-interaxis-200 bg-interaxis-50/40 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={submitting}
            placeholder="What do you want to know about this entity?  (e.g. 'What evidence would falsify this?' or 'Which domain experts have worked on this?')"
            rows={3}
            maxLength={1000}
            className="w-full rounded-md border border-gray-200 bg-white p-2 text-[12px] text-gray-800 placeholder:text-gray-400 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-300 disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-gray-500">
              {draft.length}/1000 characters
            </span>
            <button
              onClick={handleSubmit}
              disabled={submitting || draft.trim().length < 3}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-3 py-1 text-[11px] font-semibold transition-all",
                submitting || draft.trim().length < 3
                  ? "cursor-not-allowed bg-gray-200 text-gray-400"
                  : "bg-interaxis-600 text-white hover:bg-interaxis-700",
              )}
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {submitting ? "Posting…" : "Post question"}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[11px] text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading questions…
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[11px] text-gray-500">
          No questions yet. Ask something to attach an open thread to this entity.
        </div>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => {
            const meta = STATUS_META[q.status];
            const Icon = meta.Icon;
            return (
              <li
                key={q.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-snug text-gray-800">
                      {q.question_text}
                    </p>
                    {q.answer_text && (
                      <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-[11px] leading-snug text-emerald-800">
                        {q.answer_text}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold",
                          meta.color,
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-2.5 w-2.5",
                            q.status === "researching" && "animate-spin",
                          )}
                        />
                        {meta.label}
                      </span>
                      <span>
                        {new Date(q.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="shrink-0 text-gray-300 hover:text-rose-500"
                    title="Delete question"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
