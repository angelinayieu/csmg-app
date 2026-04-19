"use client";

import Link from "next/link";
import { MessageCircleQuestion, Clock } from "lucide-react";
import type { EntityQuestion } from "@/types/entity-question";

interface OpenQuestionsBoardProps {
  spaceId: string;
  questions: Array<EntityQuestion & { entity_name: string }>;
}

/**
 * Aggregated open-questions surface for the Intelligence Dashboard.
 *
 * Shows every status=open entity question across the space, grouped implicitly
 * by when-asked. Each row deep-links to the entity's Questions tab so the
 * user can see the full thread + any accumulated answers.
 */
export function OpenQuestionsBoard({ spaceId, questions }: OpenQuestionsBoardProps) {
  if (questions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <MessageCircleQuestion className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        <p className="text-[12px] font-semibold text-gray-600">No open questions</p>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Ask a question on any entity page to route prospector effort.
          Questioned entities jump to the front of the analysis queue.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {questions.map((q) => (
        <li
          key={q.id}
          className="rounded-lg border border-gray-200 bg-white p-3 transition-all hover:border-blue-200 hover:shadow-sm"
        >
          <div className="flex items-start gap-2">
            <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-blue-500 mt-0.5" />
            <div className="min-w-0 flex-1">
              <Link
                href={`/app/space/${spaceId}/entity/${q.entity_id}`}
                className="block"
              >
                <p className="text-[12px] leading-snug text-gray-800 hover:text-interaxis-700 transition-colors">
                  {q.question_text}
                </p>
              </Link>
              <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                <Link
                  href={`/app/space/${spaceId}/entity/${q.entity_id}`}
                  className="rounded-full bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600 hover:bg-gray-200"
                >
                  {q.entity_name}
                </Link>
                <span className="inline-flex items-center gap-0.5 text-gray-400">
                  <Clock className="h-2.5 w-2.5" />
                  {timeAgo(q.created_at)}
                </span>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
