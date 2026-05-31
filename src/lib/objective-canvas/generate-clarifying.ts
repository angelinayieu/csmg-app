// ── Objective Canvas — clarifying question generator ──
//
// Single LLM call shared by the /generate route's three modes
// (initial, more, regenerate). Returns ready-to-persist questions
// with stable client-generated ids.

import { randomUUID } from "crypto";
import { llmJSON } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  RESPONSE_SCHEMA,
} from "./clarifying-prompt";
import type { ClarifyingQuestion } from "./clarifying-state";

interface LlmShape {
  questions?: Array<{
    question?: unknown;
    rationale?: unknown;
    selection?: unknown;
    options?: Array<{ label?: unknown; detail?: unknown }>;
  }>;
}

export interface GenerateOptions {
  objective: string;
  /** Already-shown questions, used to ask for non-overlapping
   *  additions. Empty for initial / regenerate. */
  existing?: Array<Pick<ClarifyingQuestion, "question">>;
  /** Target count. Defaults: initial=3, more=2. */
  count?: number;
  /** Research grounding (the "researched" mode). When present + non-empty,
   *  questions are grounded in these findings and tagged `grounded: true`. */
  research?: {
    summary?: string;
    concepts?: string[];
    sourceTitles?: string[];
  };
}

export async function generateClarifyingQuestions(
  opts: GenerateOptions,
): Promise<ClarifyingQuestion[]> {
  const count = Math.max(1, Math.min(5, opts.count ?? 3));

  const hasResearch = !!(
    opts.research &&
    (opts.research.summary?.trim() || (opts.research.concepts?.length ?? 0) > 0)
  );

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt({
      objective: opts.objective,
      existing: opts.existing,
      count,
      research: opts.research,
    }),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.45,
    maxTokens: 2000,
  });

  const items = Array.isArray(raw?.questions) ? raw.questions : [];
  return items
    .map((q): ClarifyingQuestion | null => {
      const question = typeof q?.question === "string" ? q.question.trim() : "";
      if (question.length === 0) return null;
      const rationale =
        typeof q?.rationale === "string" ? q.rationale.trim() : "";
      const selection: "single" | "multi" | "weighted" =
        q?.selection === "multi"
          ? "multi"
          : q?.selection === "weighted"
            ? "weighted"
            : "single";
      const options = Array.isArray(q?.options)
        ? q.options
            .map((o) => ({
              label: typeof o?.label === "string" ? o.label.trim() : "",
              detail: typeof o?.detail === "string" ? o.detail.trim() : "",
            }))
            .filter((o) => o.label.length > 0)
            .slice(0, 4)
        : [];
      return {
        id: randomUUID(),
        question,
        rationale,
        selection,
        options: options.length > 0 ? options : undefined,
        ...(hasResearch ? { grounded: true } : {}),
      };
    })
    .filter((q): q is ClarifyingQuestion => q !== null)
    .slice(0, count);
}
