// ── Intelligence Router (core) ──
//
// One LLM call + deterministic post-processing. No side effects — the router
// returns a RouterResult. Caller decides what to do with it (auto-fire cheap
// actions, persist proposals for user review, etc.).

import { llmJSON } from "@/lib/llm";
import {
  INTELLIGENCE_ROUTER_SYSTEM_PROMPT,
  buildRouterUserPrompt,
  type RouterPromptContext,
} from "@/lib/prompts/intelligence-router";
import { getLensAddendum } from "@/lib/use-cases/lens-resolver";
import type {
  RouterInput,
  RouterResult,
  ContentClassification,
  ObjectiveSignals,
  ProcessingRecommendation,
  ProposedAction,
  ExistingObjectiveMatch,
} from "@/types/intelligence-router";

// ── LLM response shape ──

interface RouterLLMResponse {
  classification: ContentClassification;
  objective_signals: ObjectiveSignals;
  processing: ProcessingRecommendation;
  proposed_actions: Array<{
    kind: ProposedAction["kind"];
    reason: string;
    confidence: number;
    cost_estimate: ProposedAction["cost_estimate"];
  }>;
}

// ── Context the router needs ──

export interface RouterExecutionContext {
  // Existing user objectives for the space (or global if cross-space)
  existingObjectives: Array<{
    id: string;
    title: string;
    objective_type?: string;
    description?: string;
  }>;
  // Space metadata for better routing decisions
  spaceMetadata?: {
    space_name?: string;
    space_description?: string;
    entity_count?: number;
    recent_change_summary?: string;
  };
  // Recent related content (prior journal entries, prior brainstorms, etc.)
  recentContent?: string[];
}

// ── Main entry point ──

export async function runIntelligenceRouter(
  input: RouterInput,
  ctx: RouterExecutionContext,
): Promise<RouterResult> {
  const startedAt = Date.now();
  const traceId = `router-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const promptCtx: RouterPromptContext = {
    userText: input.text,
    source: input.source,
    spaceContext: ctx.spaceMetadata,
    existingObjectives: ctx.existingObjectives,
    recentContent: ctx.recentContent,
  };

  // Fallback — if the LLM call fails, produce a conservative default that
  // still lets the caller proceed (single-pass, no proposals).
  const fallback: RouterLLMResponse = {
    classification: {
      content_type: "other",
      strategic_significance: "low",
      suggested_lens: "none",
      confidence: 0.2,
      positive_signal: false,
      negative_signal: false,
      recurring_theme_signal: false,
    },
    objective_signals: {
      relates_to_existing: [],
      proposes_new_sub_objective: null,
      proposes_new_objective: null,
    },
    processing: {
      recommended_depth: "single_pass",
      reasoning: "Router fallback — LLM call failed; default to safe single-pass.",
    },
    proposed_actions: [],
  };

  let llmResult: RouterLLMResponse;
  try {
    llmResult = await llmJSON<RouterLLMResponse>({
      system: INTELLIGENCE_ROUTER_SYSTEM_PROMPT,
      user: buildRouterUserPrompt(promptCtx),
      model: "gpt-4o-mini",        // router is a lightweight call — use the cheaper model
      maxTokens: 1500,
      temperature: 0.2,
      fallback,
    });
  } catch (err) {
    console.warn("[intelligence-router] LLM call failed, using fallback:", err);
    llmResult = fallback;
  }

  const llmMs = Date.now() - startedAt;

  // ── Sanity-check + clamp LLM output ──

  // Processing depth guard: short content should never auto-recommend full_pipeline
  const wordCount = input.text.trim().split(/\s+/).filter(Boolean).length;
  let depth = llmResult.processing.recommended_depth;
  if (wordCount < 60 && depth === "full_pipeline") {
    depth = "cluster_local";
  }
  if (wordCount < 20 && depth === "cluster_local") {
    depth = "single_pass";
  }

  // If user explicitly set processing_preference, honor it (but clamp to LLM's max)
  if (input.processing_preference === "light") depth = "single_pass";
  if (input.processing_preference === "deep" && depth === "single_pass") {
    depth = "cluster_local";
  }

  // Validate + clamp proposed actions
  const proposedActions: ProposedAction[] = (llmResult.proposed_actions ?? [])
    .filter((a) => a.reason && a.reason.trim().length > 0)
    .map((a) => ({
      kind: a.kind,
      reason: a.reason,
      confidence: Math.max(0, Math.min(1, a.confidence ?? 0.5)),
      cost_estimate: a.cost_estimate ?? "medium",
    }))
    // Hard-cap: never surface more than 3 proposals at once (too noisy)
    .slice(0, 3);

  // Deduplicate objective matches by id (LLM can sometimes double-list)
  const existingMatchesById = new Map<string, ExistingObjectiveMatch>();
  for (const m of llmResult.objective_signals.relates_to_existing ?? []) {
    if (m.objective_id && !existingMatchesById.has(m.objective_id)) {
      existingMatchesById.set(m.objective_id, m);
    }
  }

  // Filter objective matches: only keep those referencing actual existing objectives.
  // The prompt is instructed never to hallucinate ids, but defense in depth.
  const validObjectiveIds = new Set(ctx.existingObjectives.map((o) => o.id));
  const validatedExistingMatches = Array.from(existingMatchesById.values()).filter((m) =>
    validObjectiveIds.has(m.objective_id),
  );

  // ── Phase X2: resolve detected lens to a prompt addendum ──
  // If the router identified a template-specific lens, look up the addendum
  // text so downstream content-intake routes can apply it without re-asking
  // the LLM or doing their own template lookup.
  const lensAddenda = getLensAddendum(llmResult.classification.suggested_lens);

  return {
    classification: llmResult.classification,
    objective_signals: {
      relates_to_existing: validatedExistingMatches,
      proposes_new_sub_objective: llmResult.objective_signals.proposes_new_sub_objective,
      proposes_new_objective: llmResult.objective_signals.proposes_new_objective,
    },
    processing: {
      recommended_depth: depth,
      reasoning: llmResult.processing.reasoning,
      lens_addenda: lensAddenda ?? undefined,
    },
    proposed_actions: proposedActions,
    auto_fired: [], // caller populates after running its own cheap actions
    llm_call_ms: llmMs,
    decided_at: new Date().toISOString(),
    router_trace_id: traceId,
  };
}
