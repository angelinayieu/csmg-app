// ── Mediator Proposal Engine — M5 orchestrator ──────────────────────
//
// Composes M1 → M2 → M3 → M4 into a single fire-and-forget call.
// Loads context, runs the four-stage pipeline, returns summary stats.
//
// Designed to be safe in any caller context: synchronous routes,
// `after()` blocks, manual buttons, future cron jobs. Soft-fails
// throughout — any individual stage failure degrades to a `runStatus`
// of "partial" rather than throwing. Callers can fire and forget.
//
// Cost shape per call:
//   - 1 entity-fetch + 1 edge-fetch + 1 ontology-fetch (cheap DB reads)
//   - up to maxClustersToReturn (default 8) propose-mediator LLM calls
//   - up to the same number of validate-mediator LLM calls
//   - up to the same number of persist-proposal DB inserts (fewer if
//     verdicts reject/duplicate or the idempotency check skips)
//
// Worst case: ~16 LLM calls + ~16 DB writes per run.
// Typical case (most clusters validated cleanly): ~8 LLM calls,
// ~3-5 DB writes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, Edge } from "@/types";
import {
  detectOrphanClusters,
  type OrphanCluster,
  type DetectOrphanClustersOptions,
} from "./detect-orphan-clusters";
import { proposeMediatorsForClusters } from "./propose-mediator";
import { validateMediatorProposals } from "./validate-mediator";
import {
  persistMediatorProposals,
  type PersistResult,
} from "./persist-proposal";

// ── Public types ────────────────────────────────────────────────────

export type RunStatus = "complete" | "partial" | "no_clusters" | "error";

export interface RunMediatorEngineResult {
  status: RunStatus;
  /** ISO timestamp of when the run started. */
  started_at: string;
  /** ISO timestamp of when the run completed (or failed). */
  completed_at: string;
  /** From M1 — clusters surfaced (capped by the detector's
   *  maxClustersToReturn option). */
  clusters_detected: number;
  /** From M2 — proposals where the LLM returned a non-null
   *  proposed_entity. The remainder declined to propose. */
  proposals_made: number;
  /** From M3 — count by validator verdict. */
  validated: number;
  speculative: number;
  rejected: number;
  duplicates: number;
  /** From M4 — count by persist action. */
  inserted: number;
  skipped_idempotent: number;
  errors: number;
  /** Per-cluster results so a caller can log / surface per-row status. */
  per_cluster: PersistResult[];
  /** Top-level error message when status === "error" (e.g. couldn't
   *  load entities). */
  fatal_error: string | null;
}

export interface RunMediatorEngineArgs {
  spaceId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  /** Override M1 detector options (cluster size, density threshold,
   *  etc.). Caller usually leaves unset — defaults are tuned. */
  detectorOptions?: Partial<DetectOrphanClustersOptions>;
  /** Override the LLM model used for M2 + M3. Caller usually leaves
   *  unset. Useful for cost-control tests. */
  llmModel?: string;
}

// ── Public function ─────────────────────────────────────────────────

/**
 * Run the full Mediator Proposal Engine end-to-end on a space. Always
 * returns a result object — never throws. Callers can fire-and-forget
 * via `after(runMediatorProposalEngine(args).then(log))`.
 */
export async function runMediatorProposalEngine(
  args: RunMediatorEngineArgs,
): Promise<RunMediatorEngineResult> {
  const startedAt = new Date().toISOString();

  // ── Load context (entities + edges + space metadata + ontology) ──
  const ctx = await loadContext(args);
  if (!ctx.ok) {
    return finalize(startedAt, {
      status: "error",
      clusters_detected: 0,
      proposals_made: 0,
      validated: 0,
      speculative: 0,
      rejected: 0,
      duplicates: 0,
      inserted: 0,
      skipped_idempotent: 0,
      errors: 0,
      per_cluster: [],
      fatal_error: ctx.error,
    });
  }

  // ── M1 — detect ──────────────────────────────────────────────────
  let clusters: OrphanCluster[];
  try {
    clusters = detectOrphanClusters(
      ctx.entities,
      ctx.edges,
      args.detectorOptions,
    );
  } catch (err) {
    return finalize(startedAt, {
      status: "error",
      clusters_detected: 0,
      proposals_made: 0,
      validated: 0,
      speculative: 0,
      rejected: 0,
      duplicates: 0,
      inserted: 0,
      skipped_idempotent: 0,
      errors: 0,
      per_cluster: [],
      fatal_error: `detector_error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (clusters.length === 0) {
    // Healthy graph — nothing to propose. This is a success state, not
    // an error. M5 callers (template instantiation hook) treat this as
    // a no-op.
    return finalize(startedAt, {
      status: "no_clusters",
      clusters_detected: 0,
      proposals_made: 0,
      validated: 0,
      speculative: 0,
      rejected: 0,
      duplicates: 0,
      inserted: 0,
      skipped_idempotent: 0,
      errors: 0,
      per_cluster: [],
      fatal_error: null,
    });
  }

  // ── M2 — propose ─────────────────────────────────────────────────
  const proposals = await proposeMediatorsForClusters(
    clusters,
    {
      domain_label: ctx.domainLabel,
      user_prompt: ctx.userPrompt,
      existing_layer_slugs: ctx.layerSlugs,
      existing_entity_names: ctx.entityNames,
    },
    { model: args.llmModel },
  );

  const proposalsMade = proposals.filter((p) => p.proposed_entity !== null).length;

  // ── M3 — validate (per-proposal because cluster context varies) ─
  const validated = [];
  for (let i = 0; i < proposals.length; i++) {
    const cluster = clusters[i];
    const v = await validateMediatorProposals(
      [proposals[i]],
      {
        domain_label: ctx.domainLabel,
        existing_entity_names: ctx.entityNames,
        cluster_member_names: cluster.member_entity_names,
        cluster_layer: cluster.shared_signal.layer,
      },
      { model: args.llmModel },
    );
    validated.push(v[0]);
  }

  let validatedCount = 0;
  let speculativeCount = 0;
  let rejectedCount = 0;
  let duplicatesCount = 0;
  for (const v of validated) {
    switch (v.verdict.status) {
      case "validated": validatedCount++; break;
      case "speculative": speculativeCount++; break;
      case "rejected": rejectedCount++; break;
      case "duplicate": duplicatesCount++; break;
    }
  }

  // ── M4 — persist ─────────────────────────────────────────────────
  const persistResults = await persistMediatorProposals(validated, (v) => {
    const matchingCluster = clusters.find(
      (c) => c.cluster_id === v.proposal.cluster_id,
    );
    if (!matchingCluster) {
      // Should be impossible — clusters and proposals were paired by
      // index. Construct a fallback so persist's resolveToId call
      // can still surface "couldn't resolve endpoint" cleanly.
      throw new Error(
        `cluster ${v.proposal.cluster_id} disappeared between propose and persist`,
      );
    }
    return {
      spaceId: args.spaceId,
      userId: args.userId,
      db: args.db,
      cluster: matchingCluster,
    };
  });

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  for (const r of persistResults) {
    if (r.action === "inserted") inserted++;
    else if (r.action === "skipped") skipped++;
    else if (r.action === "error") errors++;
  }

  const status: RunStatus =
    errors > 0
      ? "partial"
      : "complete";

  return finalize(startedAt, {
    status,
    clusters_detected: clusters.length,
    proposals_made: proposalsMade,
    validated: validatedCount,
    speculative: speculativeCount,
    rejected: rejectedCount,
    duplicates: duplicatesCount,
    inserted,
    skipped_idempotent: skipped,
    errors,
    per_cluster: persistResults,
    fatal_error: null,
  });
}

// ── Internal: context loader ────────────────────────────────────────

interface LoadContextResult {
  ok: true;
  entities: Entity[];
  edges: Edge[];
  domainLabel: string;
  userPrompt: string;
  layerSlugs: string[];
  entityNames: string[];
}

interface LoadContextError {
  ok: false;
  error: string;
}

async function loadContext(
  args: RunMediatorEngineArgs,
): Promise<LoadContextResult | LoadContextError> {
  const { spaceId, db } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any;

  try {
    const [
      { data: rawEntities, error: entErr },
      { data: rawEdges, error: edgeErr },
      { data: rawSpace },
      { data: rawLayers },
    ] = await Promise.all([
      dbAny
        .from("entities")
        .select("*")
        .eq("space_id", spaceId)
        // Don't include rejected mediators in the engine's cluster
        // analysis — they were already vetted negative.
        .neq("proposal_status", "rejected_mediator"),
      dbAny.from("edges").select("*").eq("space_id", spaceId),
      dbAny
        .from("spaces")
        .select("input_text, synthesis_data")
        .eq("id", spaceId)
        .maybeSingle(),
      dbAny.from("layer_ontology").select("slug").eq("space_id", spaceId),
    ]);

    if (entErr) {
      return { ok: false, error: `entities load failed: ${entErr.message}` };
    }
    if (edgeErr) {
      return { ok: false, error: `edges load failed: ${edgeErr.message}` };
    }

    const entities = (rawEntities ?? []) as Entity[];
    const edges = (rawEdges ?? []) as Edge[];

    // Domain label — try synthesis_data.strategic_recommendation first,
    // fall back to a generic label. The full kg_generation_plan path
    // would be richer but adds another query; this is good enough for
    // the LLM proposer to disambiguate domain.
    let domainLabel = "";
    const synth = rawSpace?.synthesis_data as Record<string, unknown> | null | undefined;
    if (synth) {
      const stratRec = synth.strategic_recommendation as
        | Record<string, unknown>
        | undefined;
      const titleCandidate =
        stratRec?.title ??
        (stratRec?.recommendation as Record<string, unknown> | undefined)?.title;
      if (typeof titleCandidate === "string") domainLabel = titleCandidate;
    }
    if (!domainLabel) {
      // Fall back to inferring from entity layers.
      const layerHints = entities
        .map((e) => e.layer)
        .filter((l): l is string => typeof l === "string" && l.length > 0)
        .slice(0, 5)
        .join(", ");
      if (layerHints) domainLabel = `Knowledge graph spanning ${layerHints}`;
    }

    const userPrompt =
      typeof rawSpace?.input_text === "string" ? rawSpace.input_text : "";

    const layerSlugs = ((rawLayers ?? []) as Array<{ slug: string }>)
      .map((row) => row.slug)
      .filter((s) => typeof s === "string" && s.length > 0);

    // Fall back to layers extracted from entities if no ontology table row
    // exists for this space.
    const fallbackLayerSlugs =
      layerSlugs.length > 0
        ? layerSlugs
        : Array.from(
            new Set(
              entities
                .map((e) => e.layer)
                .filter((l): l is string => typeof l === "string" && l.length > 0),
            ),
          );

    const entityNames = entities
      .map((e) => e.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    return {
      ok: true,
      entities,
      edges,
      domainLabel,
      userPrompt,
      layerSlugs: fallbackLayerSlugs,
      entityNames,
    };
  } catch (err) {
    return {
      ok: false,
      error: `context load threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function finalize(
  startedAt: string,
  payload: Omit<RunMediatorEngineResult, "started_at" | "completed_at">,
): RunMediatorEngineResult {
  return {
    ...payload,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  };
}
