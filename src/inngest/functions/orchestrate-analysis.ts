import { inngest } from "../client";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { runPipeline } from "@/lib/orchestration/pipeline";
import { validatePipelineResult } from "@/lib/validation";
import { commitReservation, cancelReservation } from "@/lib/credits";
import { sanitizeEntity, extractEvidenceBasis, resilientInsert } from "@/lib/sanitize";
import { batchInsert } from "@/lib/utils";
import { TIERS } from "@/lib/tiers";
import {
  buildInngestEmitter,
  emitJobEvent,
  markArtifactReady,
  setJobPhase,
  finalizeJob,
} from "../job-writer";
import type { ArtifactKind } from "../events";
import { runAsAgent } from "@/lib/agents/run-tracker";
import { seedAgentsForSpace } from "@/lib/agents/seeding";

/**
 * Service-role Supabase client — bypasses RLS, writes on behalf of the user.
 * Inngest runs server-side with no user session, so we must use the service key.
 */
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing for Inngest function");
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Orchestrate a full analysis end-to-end.
 *
 * Steps are durable and memoized by Inngest: a retry resumes from the last
 * successful step without re-running prior ones.
 */
export const orchestrateAnalysis = inngest.createFunction(
  {
    id: "orchestrate-analysis",
    name: "Orchestrate Full Analysis",
    retries: 1,
    triggers: [{ event: "analysis/orchestrate.requested" }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFailure: async ({ event, error }: { event: any; error: unknown }) => {
      // Grab the original requested event payload (Inngest nests it under data.event.data)
      const originalData = event.data?.event?.data ?? {};
      const { jobId, reservationId } = originalData as {
        jobId?: string;
        reservationId?: string | null;
      };
      if (!jobId) return;
      const db = svc();
      if (reservationId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await cancelReservation(db as any, reservationId);
        } catch (cancelErr) {
          console.warn("[orchestrate-analysis] cancelReservation failed:", cancelErr);
        }
      }
      await finalizeJob(db, jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { jobId, userId, input, tier, intent, reservationId } = event.data as {
      jobId: string;
      userId: string;
      input: string;
      tier: import("@/lib/tiers").AnalysisTier;
      intent?: import("@/types/analysis").UserIntent;
      reservationId: string | null;
    };
    // Suppress unused warning for intent in Phase 1 — reserved for future tier-specific prompts
    void intent;
    const db = svc();

    // ── Phase A: Mark running ──
    await step.run("mark-running", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from("analysis_jobs")
        .update({
          status: "running",
          current_phase: "running",
          updated_at: new Date().toISOString(),
          inngest_run_id: event.id ?? null,
        })
        .eq("id", jobId);
      await emitJobEvent(db, jobId, "phase_started", { payload: { phase: "running" } });
    });

    // ── Phase B: Run full pipeline (decompose → structure → critique → augment → research → synthesize → strategy → twin → prob) ──
    // The pipeline's internal emit() writes progress to job_events via buildInngestEmitter.
    // This step can take up to ~10min for comprehensive tier; Inngest's per-step timeout supports this.
    const pipelineResult = await step.run("run-pipeline", async () => {
      const emit = buildInngestEmitter(db, jobId);
      const result = await runPipeline(input, tier, emit);
      const validation = validatePipelineResult(result);
      if (!validation.valid) {
        throw new Error(
          `Pipeline validation failed: ${(validation.errors || []).join("; ")}`
        );
      }
      return validation.data!;
    });

    // ── Phase C: Persist spaces + entities + edges + cycles + claims ──
    // Wrapped as synthesizer agent run — this step materializes all core artifacts.
    const persistResult = await step.run("persist-core", async () => {
      await setJobPhase(db, jobId, "committing");
      const ids: string[] = [];
      let totalEntities = 0;
      let totalEdges = 0;
      let totalCycles = 0;
      let totalClaims = 0;

      for (const space of pipelineResult.spaceData) {
        const meta = space.structured.metadata ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: spaceRow, error: spaceError } = await (db as any)
          .from("spaces")
          .insert({
            user_id: userId,
            name: meta.name || "Untitled Analysis",
            description: meta.description || null,
            space_prefix: meta.space_prefix || space.scope.prefix,
            input_text: input,
            raw_decomposition: space.raw,
            synthesis_text: meta.synthesis_text || null,
            synthesis_data: {
              leverage_points: space.structured.leverage_points ?? [],
              risk_points: space.structured.risk_points ?? [],
              master_bottleneck: space.structured.master_bottleneck ?? null,
              suggested_objectives: pipelineResult.earlyObjectives ?? [],
              objectives_pending_review: (pipelineResult.earlyObjectives?.length ?? 0) > 0,
            },
            entity_count: space.structured.entities?.length ?? 0,
            edge_count: space.structured.edges?.length ?? 0,
            orphan_count: meta.orphan_count ?? 0,
            cycle_count: space.structured.cycles?.length ?? 0,
            maturity: meta.maturity ?? "actionable_now",
            analysis_tier: tier,
            credits_used: 0,
            agent_count:
              pipelineResult.spaceData.length > 1 ? 6 : tier === "standard" ? 4 : 2,
          })
          .select("id")
          .single();

        if (spaceError || !spaceRow) {
          await emitJobEvent(db, jobId, "warning", {
            payload: { message: `Space create failed: ${spaceError?.message ?? "unknown"}` },
          });
          continue;
        }
        const spaceId = (spaceRow as { id: string }).id;
        ids.push(spaceId);

        // Entities
        const entityMap = new Map<string, string>();
        if (space.structured.entities?.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const entityInserts = space.structured.entities.map((e: any) => sanitizeEntity(e, spaceId));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: insertedEntities } = await (db as any)
            .from("entities")
            .insert(entityInserts)
            .select("id, entity_id");
          if (insertedEntities) {
            for (const e of insertedEntities as { id: string; entity_id: string }[]) {
              entityMap.set(e.entity_id, e.id);
            }
            totalEntities += insertedEntities.length;
          }

          // Claims (evidence_basis → claims rows)
          try {
            const claimInserts: Array<{
              space_id: string;
              claim_text: string;
              claim_type: string;
              status: string;
              confidence: number;
              source_entity_id: string;
              source_type: string;
              source_quote: string | null;
            }> = [];
            for (const rawEntity of space.structured.entities) {
              const entityUuid = entityMap.get(rawEntity.entity_id);
              if (!entityUuid) continue;
              for (const ev of extractEvidenceBasis(rawEntity)) {
                claimInserts.push({
                  space_id: spaceId,
                  claim_text: ev.claim,
                  claim_type: ev.claim_type,
                  status: "proposed",
                  confidence: ev.confidence,
                  source_entity_id: entityUuid,
                  source_type: "synthesis",
                  source_quote: ev.source_quote,
                });
              }
            }
            if (claimInserts.length > 0) {
              await resilientInsert(db, "claims", claimInserts, "id");
              totalClaims += claimInserts.length;
            }
          } catch (claimErr) {
            console.warn("[orchestrate-analysis] claim persist failed:", claimErr);
          }
        }

        // Edges
        const VALID_DIMS = [
          "structural",
          "functional",
          "temporal",
          "causal",
          "correlational",
          "logical",
          "epistemic",
          "comparative",
          "agentive",
        ];
        const VALID_POLARITIES = ["positive", "negative", "neutral", "conditional"];
        const VALID_TAGS = ["stated", "inferred", "predicted"];
        const filteredEdges = (space.structured.edges ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => (typeof e.confidence === "number" ? e.confidence : 0.8) >= 0.2
        );
        const edgesToInsert = filteredEdges
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((e: any) => {
            const srcUuid = entityMap.get((e.source_entity_id ?? "").trim());
            const tgtUuid = entityMap.get((e.target_entity_id ?? "").trim());
            if (!srcUuid || !tgtUuid) return null;
            return {
              space_id: spaceId,
              source_entity_id: srcUuid,
              target_entity_id: tgtUuid,
              relationship_type: e.relationship_type ?? "relates-to",
              dimension: VALID_DIMS.includes(e.dimension) ? e.dimension : "functional",
              source_tag: VALID_TAGS.includes(e.source_tag) ? e.source_tag : "inferred",
              strength: Math.max(0, Math.min(1, e.strength ?? 0.5)),
              polarity: VALID_POLARITIES.includes(e.polarity) ? e.polarity : "positive",
              confidence: Math.max(0, Math.min(1, e.confidence ?? 0.8)),
              conditions: e.conditions ?? null,
              is_tradeoff: e.is_tradeoff ?? false,
              is_part_of_cycle: e.is_part_of_cycle ?? false,
              cycle_id: e.cycle_id ?? null,
              dynamics: e.dynamics ?? null,
              dynamics_properties: e.dynamics_properties ?? null,
            };
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter(Boolean) as any[];

        if (edgesToInsert.length > 0) {
          await batchInsert(db, "edges", edgesToInsert, {
            batchSize: 100,
            failureThreshold: 0.1,
            emitWarning: (msg) => emitJobEvent(db, jobId, "warning", { payload: { message: msg } }),
          });
          totalEdges += edgesToInsert.length;
        }

        // Cycles
        const cycleInserts = (space.structured.cycles ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => {
            const entity_ids = (c.entity_ids ?? [])
              .map((id: string) => entityMap.get(id))
              .filter(Boolean);
            if (entity_ids.length < 2) return null;
            return {
              space_id: spaceId,
              cycle_id: c.cycle_id ?? null,
              name: c.name ?? "Unnamed Cycle",
              classification: c.classification ?? "reinforcing_positive",
              entity_ids: (c.entity_ids ?? []).filter((id: string) => entityMap.has(id)),
              description: c.description ?? null,
              intervention_point: c.intervention_point ?? null,
              intervention_description: c.intervention_description ?? null,
              growth_type: c.growth_type ?? null,
              cycle_time: c.cycle_time ?? null,
              estimated_multiplier: c.estimated_multiplier ?? null,
            };
          })
          .filter(Boolean);
        if (cycleInserts.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any).from("cycles").insert(cycleInserts);
          totalCycles += cycleInserts.length;
        }
      }

      // Link job to root space + mark core artifacts ready
      if (ids.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from("analysis_jobs")
          .update({ space_id: ids[0], updated_at: new Date().toISOString() })
          .eq("id", jobId);
      }
      for (const kind of ["entities", "edges", "cycles", "synthesis"] as ArtifactKind[]) {
        await markArtifactReady(db, jobId, kind, { rootSpaceId: ids[0] });
      }
      return { spaceIds: ids, totalEntities, totalEdges, totalCycles, totalClaims };
    });

    const { spaceIds } = persistResult;

    // ── Phase C.5: Seed agent fleet + record synthetic coordinator/decomposer runs ──
    // Now that we have a space, seed the full agent registry and backfill a
    // historical "coordinator" run representing the just-completed run-pipeline work.
    if (spaceIds.length > 0) {
      await step.run("seed-agents", async () => {
        const rootSpaceId = spaceIds[0];
        await seedAgentsForSpace(db, rootSpaceId, userId);

        // Post-hoc run for the decomposer (entities/edges/cycles materialized)
        await runAsAgent(
          db,
          {
            spaceId: rootSpaceId,
            userId,
            kind: "decomposer",
            jobId,
            inngestRunId: event.id ?? null,
            stepId: "run-pipeline",
            triggerEvent: "analysis/orchestrate.requested",
            triggerData: { tier },
          },
          async () => ({
            result: {
              findingsCount: persistResult.totalEntities + persistResult.totalEdges + persistResult.totalCycles,
              artifactsProduced: ["entities", "edges", "cycles"],
              costCredits: 0,
            },
            value: undefined,
          })
        );

        // Post-hoc run for the synthesizer (persist-core materializes synthesis data)
        await runAsAgent(
          db,
          {
            spaceId: rootSpaceId,
            userId,
            kind: "synthesizer",
            jobId,
            stepId: "persist-core",
            triggerEvent: "analysis/orchestrate.requested",
          },
          async () => ({
            result: {
              findingsCount: persistResult.totalClaims,
              artifactsProduced: ["synthesis", "claims"],
              costCredits: 0,
            },
            value: undefined,
          })
        );
      });
    }

    // ── Phase D: External knowledge (research + bridges) — wrapped as bridge agent run ──
    if (pipelineResult.externalKnowledge && spaceIds.length > 0) {
      await step.run("persist-external-knowledge", async () => {
        const rootSpaceId = spaceIds[0];
        let externalEntitiesInserted = 0;
        let externalEdgesInserted = 0;
        const VALID_CATS = ["concrete", "abstract", "process", "relational", "epistemic"];
        const citations = pipelineResult.externalKnowledge?.citations ?? [];
        const isWebMode = pipelineResult.externalKnowledge?.research_mode === "web_search";
        const extEntityMap = new Map<string, string>();

        for (const ext of pipelineResult.externalKnowledge?.external_entities ?? []) {
          const entityNameWords = ext.name
            .toLowerCase()
            .split(/\s+/)
            .filter((w: string) => w.length > 3);
          const matchingCitations = citations.filter(
            (c: { url: string; title: string; citedText: string }) =>
              entityNameWords.some(
                (w: string) =>
                  c.citedText.toLowerCase().includes(w) || c.title.toLowerCase().includes(w)
              )
          );
          const isWebSourced =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ext as any).source_type === "web_search" || matchingCitations.length > 0;
          const sourceUrl =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((ext as any).source_url as string | undefined) ?? matchingCitations[0]?.url ?? null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (db as any)
            .from("entities")
            .insert({
              space_id: rootSpaceId,
              entity_id: ext.entity_id,
              name: ext.name,
              description: ext.description ?? null,
              source_tag: "assumed",
              entity_type: ext.entity_type ?? ext.category ?? "concept",
              entity_category: VALID_CATS.includes(ext.entity_category) ? ext.entity_category : "abstract",
              importance: "moderate",
              confidence: ext.confidence ?? 0.5,
              knowledge_layer: "external",
              authority_level: isWebSourced
                ? (["high", "moderate"].includes(ext.authority_level) ? ext.authority_level : "moderate")
                : ext.authority_level === "high"
                ? "moderate"
                : ext.authority_level ?? "low",
              provenance: {
                source_type: isWebSourced ? "web_search" : "training_knowledge",
                source_url: sourceUrl,
                category: ext.category,
                relevance: ext.relevance_to_situation,
                confidence_basis: isWebSourced
                  ? `Web-verified${sourceUrl ? `: ${sourceUrl}` : ""}`
                  : `Agent 7 domain expert, confidence ${ext.confidence}`,
                citation_urls: matchingCitations.map((c: { url: string }) => c.url).slice(0, 3),
                verified_by_user: false,
              },
            })
            .select("id, entity_id")
            .single();

          if (data) {
            extEntityMap.set(ext.entity_id, (data as { id: string }).id);
            externalEntitiesInserted++;
          }
        }

        // External edges
        for (const edge of pipelineResult.externalKnowledge?.external_edges ?? []) {
          const srcUuid = extEntityMap.get(edge.source);
          const tgtUuid = extEntityMap.get(edge.target);
          if (!srcUuid || !tgtUuid) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any).from("edges").insert({
            space_id: rootSpaceId,
            source_entity_id: srcUuid,
            target_entity_id: tgtUuid,
            relationship_type: edge.relationship_type,
            dimension: "comparative",
            source_tag: "predicted",
            strength: 0.5,
            polarity: "positive",
            confidence: 0.6,
            knowledge_layer: "external",
            provenance: {
              source_type: isWebMode ? "web_search_enhanced" : "training_knowledge",
            },
          });
          externalEdgesInserted++;
        }

        await markArtifactReady(db, jobId, "research");

        // Record the bridge agent run (with counts) and the researcher agent run
        await runAsAgent(
          db,
          {
            spaceId: rootSpaceId,
            userId,
            kind: "researcher",
            jobId,
            stepId: "persist-external-knowledge",
            triggerEvent: "analysis/orchestrate.requested",
          },
          async () => ({
            result: {
              findingsCount: externalEntitiesInserted,
              artifactsProduced: ["external_entities"],
              costCredits: 0,
            },
            value: undefined,
          })
        );
        await runAsAgent(
          db,
          {
            spaceId: rootSpaceId,
            userId,
            kind: "bridge",
            jobId,
            stepId: "persist-external-knowledge",
            triggerEvent: "analysis/orchestrate.requested",
          },
          async () => ({
            result: {
              findingsCount: externalEdgesInserted,
              artifactsProduced: ["bridges"],
              costCredits: 0,
            },
            value: undefined,
          })
        );
      });
    }

    // ── Phase E: Commit credits + finalize ──
    await step.run("commit-credits", async () => {
      if (reservationId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const commit = await commitReservation(db as any, reservationId, spaceIds[0]);
          if (commit.success && spaceIds.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (db as any)
              .from("spaces")
              .update({ credits_used: TIERS[tier].credits })
              .eq("id", spaceIds[0]);
          }
        } catch (err) {
          console.warn("[orchestrate-analysis] commit credits failed:", err);
        }
      }
    });

    await step.run("mark-complete", async () => {
      await finalizeJob(db, jobId, { status: "completed", spaceId: spaceIds[0] ?? null });
    });

    return { jobId, spaceIds };
  }
);
