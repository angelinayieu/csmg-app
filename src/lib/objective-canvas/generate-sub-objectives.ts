// ── Objective Canvas — sub-objective proposal generator ──

import { randomUUID } from "crypto";
import { llmJSON } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  RESPONSE_SCHEMA,
} from "./decompose-prompt";
import type { ClarifyingBlock } from "./clarifying-state";
import { normalizeProposals, type SubObjectiveProposal } from "./sub-objective-state";

interface LlmShape {
  proposals?: Array<{
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    recommended?: unknown;
  }>;
}

export interface GenerateSubObjectivesOptions {
  objective: string;
  clarifying: ClarifyingBlock | null;
}

export async function generateSubObjectiveProposals(
  opts: GenerateSubObjectivesOptions,
): Promise<SubObjectiveProposal[]> {
  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt({
      objective: opts.objective,
      clarifying: opts.clarifying,
    }),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.55,
    maxTokens: 2400,
  });

  const items = Array.isArray(raw?.proposals) ? raw.proposals : [];
  // LLM doesn't generate ids — assign client-side.
  const idAssigned = items.map((p) => ({
    ...p,
    id: randomUUID(),
  }));
  return normalizeProposals(idAssigned);
}
