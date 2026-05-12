// ── Mediator Proposal Engine — M2 orchestrator ──────────────────────
//
// Glue between detect-orphan-clusters (M1) and the LLM (via llmJSON).
// Takes one OrphanCluster + context, calls the proposer prompt, and
// returns a normalized MediatorProposal.
//
// Cost discipline: one llmJSON call per cluster. M1 caps clusters per
// run at maxClustersToReturn (default 8), so a single proposal pass
// is bounded at ~8 LLM calls per space. Default temperature is low
// (0.2) because we want consistent canonical bridges, not creative
// novelty.
//
// Failure semantics: any individual proposal that throws or returns
// malformed output is degraded to a null-proposal (declined_reason set
// to the error). This keeps the outer batch loop monotonic — one bad
// cluster doesn't kill the rest.

import { llmJSON } from "@/lib/llm";
import type { OrphanCluster } from "./detect-orphan-clusters";
import {
  MEDIATOR_PROPOSAL_SYSTEM,
  MEDIATOR_PROPOSAL_SCHEMA,
  buildMediatorProposalUserPrompt,
  normalizeMediatorProposal,
  type MediatorProposal,
  type MediatorProposalContext,
} from "@/lib/prompts/mediator-proposal";

export interface ProposeMediatorOptions {
  /** Override the default model. Caller usually leaves this unset. */
  model?: string;
  /** 0-1. Default 0.2 — low because canonical bridges should be
   *  consistent across re-runs; we don't want creative novelty here. */
  temperature?: number;
  /** Cap on output tokens. ~600 is generous for one proposal. */
  maxTokens?: number;
}

/**
 * Propose a single bridging entity for one cluster. Always returns a
 * valid MediatorProposal — failure modes degrade to a null-proposal
 * with declined_reason populated, never throws.
 */
export async function proposeMediatorForCluster(
  cluster: OrphanCluster,
  context: MediatorProposalContext,
  options: ProposeMediatorOptions = {},
): Promise<MediatorProposal> {
  try {
    const user = buildMediatorProposalUserPrompt(cluster, context);
    const raw = await llmJSON<unknown>({
      system: MEDIATOR_PROPOSAL_SYSTEM,
      user,
      responseSchema: MEDIATOR_PROPOSAL_SCHEMA,
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 600,
      model: options.model,
      fallback: null,
    });
    return normalizeMediatorProposal(raw, cluster.cluster_id);
  } catch (err) {
    return {
      cluster_id: cluster.cluster_id,
      proposed_entity: null,
      mechanism_explanation: "",
      proposed_edges: [],
      citation_seeds: [],
      declined_reason: `proposer_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Propose mediators for a batch of clusters. Runs sequentially to
 * respect rate limits + leave the door open for incremental progress
 * reporting downstream (M5 will surface "3 of 8 proposed" status).
 *
 * Each cluster's proposal is independent — one failure doesn't block
 * the others. Returns proposals in the same order as the input.
 */
export async function proposeMediatorsForClusters(
  clusters: OrphanCluster[],
  context: MediatorProposalContext,
  options: ProposeMediatorOptions = {},
): Promise<MediatorProposal[]> {
  const proposals: MediatorProposal[] = [];
  for (const cluster of clusters) {
    proposals.push(await proposeMediatorForCluster(cluster, context, options));
  }
  return proposals;
}
