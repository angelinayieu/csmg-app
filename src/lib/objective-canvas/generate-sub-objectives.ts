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
  category?: unknown;
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
  /** Optional RESEARCH CONTEXT block pre-built by
   *  research-service.buildRagBlock(). When present, prepended to
   *  the user prompt so the LLM grounds proposals in real sources. */
  ragBlock?: string;
}

export interface GeneratedSubObjectives {
  proposals: SubObjectiveProposal[];
  /** LLM-named bucket: "Features", "Lessons", "Bets" — shown above
   *  the picker as "5 {category} proposed". Empty string when the
   *  model didn't supply or the value is too long to surface cleanly. */
  category: string;
}

const VERB_PREFIX_PATTERN =
  /^(develop|develop a|develop the|implement|implement a|implement the|create|create a|create the|design|design a|design the|build|build a|build the|enhance|enhance the|establish|establish a|establish the|drive|deliver|provide|enable|generate|produce|conduct|conduct a)\s+/i;

/** Strip a leading action verb from a title and capitalize the
 *  result so we get the noun phrase the prompt was asking for even
 *  if the LLM slipped. Idempotent. */
function stripVerbPrefix(title: string): string {
  const stripped = title.replace(VERB_PREFIX_PATTERN, "").trim();
  if (stripped.length === 0) return title.trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export async function generateSubObjectiveProposals(
  opts: GenerateSubObjectivesOptions,
): Promise<GeneratedSubObjectives> {
  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt({
      objective: opts.objective,
      clarifying: opts.clarifying,
      ragBlock: opts.ragBlock,
    }),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.55,
    maxTokens: 2400,
  });

  const items = Array.isArray(raw?.proposals) ? raw.proposals : [];
  // LLM doesn't generate ids — assign client-side.
  // Also enforce the noun-phrase rule client-side as a safety net
  // even though the prompt forbids verb prefixes.
  const idAssigned = items.map((p) => ({
    ...p,
    id: randomUUID(),
    title:
      typeof p?.title === "string" ? stripVerbPrefix(p.title) : p?.title,
  }));
  const proposals = normalizeProposals(idAssigned);

  // Category: trim, drop trailing punctuation, cap at ~24 chars.
  let category =
    typeof raw?.category === "string" ? raw.category.trim() : "";
  category = category.replace(/[.!?,]+$/g, "").slice(0, 24).trim();

  return { proposals, category };
}
