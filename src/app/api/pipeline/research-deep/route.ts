/**
 * Deep Research API Route
 *
 * POST /api/pipeline/research-deep
 *
 * Two modes:
 *   1. Start:  { action: "start", spaceId, prompt?, model?, maxToolCalls?, focusAreas? }
 *              → Creates background deep research request, returns runId + responseId
 *
 *   2. Poll:   { action: "poll", responseId, runId }
 *              → Checks status, parses output on completion, persists to DB
 *
 * Uses OpenAI o4-mini-deep-research (default) or o3-deep-research.
 * Background mode — runs can take 2-10 minutes.
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, refreshSpaceCounts, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  startDeepResearch,
  pollDeepResearch,
  parseDeepResearchOutput,
  buildEnrichedPrompt,
} from "@/lib/pipeline/deep-research-engine";
import type { DeepResearchModel } from "@/types/deep-research";
import type { Entity, Edge } from "@/types";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";

export const maxDuration = 60; // Polling is fast; start returns immediately

const VALID_MODELS: DeepResearchModel[] = ["o4-mini-deep-research", "o3-deep-research"];

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action as string;
  if (!action || !["start", "poll"].includes(action)) {
    return NextResponse.json(
      { error: 'action must be "start" or "poll"' },
      { status: 400 }
    );
  }

  // ── START ──
  if (action === "start") {
    const spaceId = body.spaceId as string;
    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Validate model
    const model = VALID_MODELS.includes(body.model as DeepResearchModel)
      ? (body.model as DeepResearchModel)
      : "o4-mini-deep-research";

    const maxToolCalls = typeof body.maxToolCalls === "number"
      ? Math.min(Math.max(body.maxToolCalls, 5), 100)
      : 25;

    const focusAreas = Array.isArray(body.focusAreas)
      ? (body.focusAreas as string[]).filter((a) => typeof a === "string").slice(0, 10)
      : undefined;

    try {
      // Build KG context for prompt enrichment
      const [entitiesRes, edgesRes, spaceRes] = await Promise.all([
        db.from("entities")
          .select("id, entity_id, name, description, knowledge_layer, importance, entity_type")
          .eq("space_id", spaceId)
          .limit(40),
        db.from("edges")
          .select("source_entity_id, target_entity_id, relationship_type, dimension, knowledge_layer")
          .eq("space_id", spaceId)
          .limit(60),
        db.from("spaces")
          .select("input_text, synthesis_data")
          .eq("id", spaceId)
          .single(),
      ]);

      const entities = (entitiesRes.data ?? []) as Entity[];
      const edges = (edgesRes.data ?? []) as Edge[];
      const spaceData = spaceRes.data as { input_text?: string; synthesis_data?: Record<string, unknown> } | null;

      // Build entity context summary for the prompt
      const entityNameMap = new Map(entities.map((e) => [e.id, e.name]));
      const internalEntities = entities.filter((e) => e.knowledge_layer === "internal" || e.knowledge_layer === "conceptual");
      const externalEntities = entities.filter((e) => e.knowledge_layer === "external");

      const entityContext = [
        `Internal entities (${internalEntities.length}):`,
        ...internalEntities.slice(0, 20).map(
          (e) => `  - ${e.name}: ${(e.description ?? "").slice(0, 100)}`
        ),
        `\nExternal entities (${externalEntities.length}):`,
        ...externalEntities.slice(0, 10).map(
          (e) => `  - ${e.name}: ${(e.description ?? "").slice(0, 100)}`
        ),
        `\nKey relationships:`,
        ...edges.slice(0, 20).map((e) => {
          const src = entityNameMap.get(e.source_entity_id) ?? e.source_entity_id;
          const tgt = entityNameMap.get(e.target_entity_id) ?? e.target_entity_id;
          return `  - ${src} → ${tgt} (${e.relationship_type})`;
        }),
      ].join("\n");

      // Build existing findings summary
      const synthData = spaceData?.synthesis_data ?? {};
      const hiddenSignals = Array.isArray(synthData.hidden_signals) ? synthData.hidden_signals : [];
      const existingFindings = hiddenSignals.length > 0
        ? `Previously discovered hidden signals:\n` +
          hiddenSignals.slice(0, 10).map((s: Record<string, unknown>) =>
            `  - ${s.name ?? "Signal"}: ${s.description ?? ""}`
          ).join("\n")
        : undefined;

      // Build the research prompt
      const userPrompt = typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : `Conduct deep research on the following topic to find mechanisms, evidence, contradictions, ` +
          `and deeper connections that extend the existing knowledge graph.\n\n` +
          `Topic: ${spaceData?.input_text ?? "General analysis"}`;

      const config = {
        spaceId,
        prompt: userPrompt,
        model,
        maxToolCalls,
        focusAreas,
        entityContext,
        existingFindings,
      };

      // Start the deep research request
      const { responseId, status } = await startDeepResearch(config);

      // Structural event bus — start a run and stash its id alongside
      // the OpenAI response_id so the poll handler can fetch it back
      // without threading through the client.
      const pipelineRunId = await startPipelineRun(db, {
        spaceId,
        userId: user.id,
        pipeline: "research_deep",
        initialPrompt: userPrompt.slice(0, 2000),
      });
      await emitStructuralEvent(db, pipelineRunId, {
        type: "stage_boundary",
        stage: "landscape",
        phase: "enter",
        message: "Deep research running…",
      });

      // Store run metadata in synthesis_data (lightweight — no new table needed for v1)
      const currentSynthData = (spaceData?.synthesis_data ?? {}) as Record<string, unknown>;
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...currentSynthData,
            deep_research_run: {
              response_id: responseId,
              pipeline_run_id: pipelineRunId,
              status,
              model,
              max_tool_calls: maxToolCalls,
              started_at: new Date().toISOString(),
              prompt_preview: userPrompt.slice(0, 200),
            },
          },
        })
        .eq("id", spaceId);

      return NextResponse.json({
        success: true,
        responseId,
        runId: pipelineRunId,
        status,
        model,
        maxToolCalls,
        promptLength: buildEnrichedPrompt(config).length,
      });
    } catch (err) {
      console.error("[deep-research] Start failed:", err);
      const { detectCreditError } = await import("@/lib/llm");
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json(
          {
            error: "credits_exhausted",
            provider: credit.provider,
            message: credit.message,
          },
          { status: 402 },
        );
      }
      return NextResponse.json(
        { error: `Failed to start deep research: ${sanitizeErrorMessage(err)}` },
        { status: 500 }
      );
    }
  }

  // ── POLL ──
  if (action === "poll") {
    const responseId = body.responseId as string;
    const spaceId = body.spaceId as string;
    if (!responseId) {
      return NextResponse.json({ error: "responseId required" }, { status: 400 });
    }
    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }

    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    try {
      const { status, output } = await pollDeepResearch(responseId);

      // Still in progress
      if (status !== "completed" || !output) {
        // Update status in synthesis_data
        const { data: spaceData } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .single();

        const currentSynthData = ((spaceData as Record<string, unknown>)?.synthesis_data ?? {}) as Record<string, unknown>;
        const runData = (currentSynthData.deep_research_run ?? {}) as Record<string, unknown>;

        await db
          .from("spaces")
          .update({
            synthesis_data: {
              ...currentSynthData,
              deep_research_run: { ...runData, status },
            },
          })
          .eq("id", spaceId);

        return NextResponse.json({ status, completed: false });
      }

      // ── Completed — parse and persist ──
      const startedAt = Date.now(); // For duration tracking in parser
      const parsed = parseDeepResearchOutput(output, startedAt);

      // Fetch existing entities for bridge edge creation
      const [entitiesRes, existingEdgesRes] = await Promise.all([
        db.from("entities").select("id, entity_id, name, knowledge_layer").eq("space_id", spaceId),
        db.from("edges").select("source_entity_id, target_entity_id").eq("space_id", spaceId),
      ]);

      const entities = (entitiesRes.data ?? []) as Array<{ id: string; entity_id: string; name: string; knowledge_layer: string }>;
      const existingEdges = (existingEdgesRes.data ?? []) as Array<{ source_entity_id: string; target_entity_id: string }>;

      const entityByName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
      const existingEdgePairs = new Set(existingEdges.map((e) => `${e.source_entity_id}→${e.target_entity_id}`));

      // Create entities from evidence domains (new external entities)
      let entitiesCreated = 0;
      let edgesCreated = 0;

      // Create external entities from unique high-quality evidence sources
      const highQualityEvidence = parsed.evidence.filter((ev) => ev.reliabilityPrior >= 0.6);
      const domainEntities = new Map<string, string>(); // domain → entity UUID

      for (const ev of highQualityEvidence) {
        try {
          const domain = new URL(ev.url).hostname.replace("www.", "");
          if (domainEntities.has(domain)) continue;

          // Check if entity already exists
          const existing = entityByName.get(domain.toLowerCase());
          if (existing) {
            domainEntities.set(domain, existing.id);
            continue;
          }

          const entityId = `DR_${domain.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}`;
          const { data: inserted } = await db
            .from("entities")
            .insert({
              space_id: spaceId,
              entity_id: entityId,
              name: ev.title || domain,
              description: `Source discovered via deep research: ${domain} (${ev.sourceType})`,
              entity_type: "source",
              entity_category: "epistemic",
              source_tag: "predicted",
              importance: "moderate",
              confidence: ev.reliabilityPrior,
              knowledge_layer: "external",
              authority_level: ev.reliabilityPrior >= 0.7 ? "moderate" : "low",
              provenance: {
                source_type: "deep_research",
                source_url: ev.url,
                citation_urls: [ev.url],
                source_detail: ev.sourceType,
                confidence_basis: `Deep research verified: ${ev.sourceType} source`,
                verified_by_user: false,
              },
            })
            .select("id")
            .single();

          if (inserted) {
            domainEntities.set(domain, inserted.id);
            entityByName.set(domain.toLowerCase(), {
              id: inserted.id,
              entity_id: entityId,
              name: ev.title || domain,
              knowledge_layer: "external",
            });
            entitiesCreated++;
          }
        } catch {
          // Skip individual entity creation failures
        }
      }

      // Create bridge edges: deep research sources → internal/conceptual entities
      // Use claim-entity matching to create targeted bridges
      const internalEntities = entities.filter((e) => e.knowledge_layer === "internal" || e.knowledge_layer === "conceptual");

      for (const claim of parsed.claims) {
        if (claim.supportingCitationIndices.length === 0) continue;

        // Find which internal entities this claim relates to (keyword matching)
        const claimWords = claim.claimText.toLowerCase().split(/\s+/).filter((w) => w.length > 4);

        for (const ie of internalEntities) {
          const entityWords = ie.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const overlap = claimWords.filter((cw) =>
            entityWords.some((ew) => cw.includes(ew) || ew.includes(cw))
          ).length;

          if (overlap < 1) continue;

          // Create bridge from each supporting citation's entity to this internal entity
          for (const citIdx of claim.supportingCitationIndices) {
            const citation = parsed.citations[citIdx];
            if (!citation) continue;

            try {
              const domain = new URL(citation.url).hostname.replace("www.", "");
              const sourceEntityId = domainEntities.get(domain);
              if (!sourceEntityId) continue;

              const pairKey = `${sourceEntityId}→${ie.id}`;
              if (existingEdgePairs.has(pairKey)) continue;
              existingEdgePairs.add(pairKey);

              const { error: edgeErr } = await db.from("edges").insert({
                space_id: spaceId,
                source_entity_id: sourceEntityId,
                target_entity_id: ie.id,
                relationship_type: claim.claimType === "mechanism" ? "mechanism_bridge"
                  : claim.claimType === "prediction" ? "prediction_bridge"
                  : "evidence_bridge",
                dimension: "epistemic",
                source_tag: "predicted",
                strength: claim.confidence,
                polarity: "positive",
                confidence: claim.confidence,
                knowledge_layer: "bridge",
                conditions: claim.claimText.slice(0, 300),
                provenance: {
                  source_type: "deep_research",
                  bridge_type: "evidence",
                  citation_url: citation.url,
                  citation_title: citation.title,
                  claim_type: claim.claimType,
                },
              });

              if (!edgeErr) edgesCreated++;
            } catch {
              // Skip individual edge creation failures
            }
          }
        }
      }

      // ── Persist claims + evidence to dedicated tables ──
      let claimsPersisted = 0;
      let evidencePersisted = 0;

      try {
        // Persist evidence items (deduplicated)
        const evidenceIdMap = new Map<number, string>(); // citation index → evidence UUID
        for (let i = 0; i < parsed.evidence.length; i++) {
          const ev = parsed.evidence[i];
          const { data: evInserted } = await db
            .from("evidence_items")
            .insert({
              space_id: spaceId,
              url: ev.url,
              title: ev.title,
              source_type: ev.sourceType,
              quote: ev.quote?.slice(0, 2000),
              span_start: ev.spanStart,
              span_end: ev.spanEnd,
              reliability_prior: ev.reliabilityPrior,
              recency_score: ev.recencyScore,
            })
            .select("id")
            .single();

          if (evInserted) {
            evidenceIdMap.set(i, evInserted.id);
            evidencePersisted++;
          }
        }

        // Persist claims and link to evidence
        for (const claim of parsed.claims) {
          const { data: claimInserted } = await db
            .from("claims")
            .insert({
              space_id: spaceId,
              claim_text: claim.claimText.slice(0, 2000),
              claim_type: claim.claimType,
              status: claim.supportingCitationIndices.length > 0 ? "supported" : "proposed",
              confidence: claim.confidence,
              source_type: "deep_research",
            })
            .select("id")
            .single();

          if (claimInserted) {
            claimsPersisted++;

            // Link claim to supporting evidence
            for (const citIdx of claim.supportingCitationIndices) {
              // Map citation index to evidence item
              const citation = parsed.citations[citIdx];
              if (!citation) continue;
              // Find the evidence item for this citation's URL
              const evIdx = parsed.evidence.findIndex((ev) => ev.url === citation.url);
              const evidenceId = evidenceIdMap.get(evIdx);
              if (!evidenceId) continue;

              await db.from("claim_evidence_links").insert({
                claim_id: claimInserted.id,
                evidence_id: evidenceId,
                support_type: "supports",
              });
            }
          }
        }
      } catch (persistErr) {
        // Non-critical — synthesis_data storage is the fallback
        console.warn("[deep-research] Claim/evidence persistence failed (non-critical):", persistErr);
      }

      // Update synthesis_data with deep research results
      const { data: freshSpace } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", spaceId)
        .single();

      const freshSynthData = ((freshSpace as Record<string, unknown>)?.synthesis_data ?? {}) as Record<string, unknown>;

      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...freshSynthData,
            deep_research_run: {
              response_id: responseId,
              status: "completed",
              completed_at: new Date().toISOString(),
              report_preview: parsed.reportText.slice(0, 500),
              stats: parsed.stats,
              claims_count: parsed.claims.length,
              evidence_count: parsed.evidence.length,
              entities_created: entitiesCreated,
              edges_created: edgesCreated,
            },
            // Store evidence items for downstream use
            deep_research_evidence: parsed.evidence.slice(0, 50).map((ev) => ({
              url: ev.url,
              title: ev.title,
              source_type: ev.sourceType,
              reliability: ev.reliabilityPrior,
              quote: ev.quote?.slice(0, 300),
            })),
            // Store claims for downstream use
            deep_research_claims: parsed.claims.slice(0, 30).map((c) => ({
              text: c.claimText.slice(0, 300),
              type: c.claimType,
              confidence: c.confidence,
              citation_count: c.supportingCitationIndices.length,
            })),
            // Update research mode
            research_mode: "web_verified",
          },
        })
        .eq("id", spaceId);

      // Refresh space counts
      await refreshSpaceCounts(db, [spaceId]);

      // Structural event bus — emit everything the poll just persisted.
      // runId was stashed in deep_research_run at "start" time.
      const deepRunMeta = ((freshSynthData.deep_research_run ?? {}) as Record<string, unknown>);
      const pipelineRunId = (deepRunMeta.pipeline_run_id as string | undefined) ?? null;

      if (pipelineRunId) {
        // Per-domain entity_added events.
        const entityEvents: StructuralEvent[] = [];
        for (const [domain, uuid] of domainEntities) {
          entityEvents.push({
            type: "entity_added",
            entityId: uuid,
            entityCode: null,
            name: domain,
            entityCategory: "epistemic",
            importance: "moderate",
            parentEntityId: null,
          });
        }
        await emitBatchEvents(db, pipelineRunId, entityEvents);

        // Source_cited per high-quality evidence item (cap 30).
        const sourceEvents: StructuralEvent[] = parsed.evidence
          .slice(0, 30)
          .map((ev) => ({
            type: "source_cited",
            sourceUrl: ev.url,
            title: ev.title ?? null,
            authority: typeof ev.reliabilityPrior === "number" ? ev.reliabilityPrior : 0.5,
            publishedAt: null,
            boundToEntityId: null,
          }));
        await emitBatchEvents(db, pipelineRunId, sourceEvents);

        await emitStructuralEvent(db, pipelineRunId, {
          type: "stage_boundary",
          stage: "landscape",
          phase: "exit",
        });
        await completePipelineRun(db, pipelineRunId, "completed");
      }

      return NextResponse.json({
        status: "completed",
        completed: true,
        runId: pipelineRunId,
        stats: parsed.stats,
        claimsExtracted: parsed.claims.length,
        claimsPersisted,
        evidenceItems: parsed.evidence.length,
        evidencePersisted,
        entitiesCreated,
        edgesCreated,
        reportPreview: parsed.reportText.slice(0, 500),
        topDomains: parsed.stats.uniqueDomains.slice(0, 10),
      });
    } catch (err) {
      console.error("[deep-research] Poll failed:", err);
      // Mark the associated pipeline run as failed so the canvas HUD
      // flips from Running→Failed instead of spinning forever.
      try {
        const { data: rowAfterErr } = await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .single();
        const meta = ((rowAfterErr?.synthesis_data as Record<string, unknown> | null)
          ?.deep_research_run ?? {}) as Record<string, unknown>;
        const failedRunId = (meta.pipeline_run_id as string | undefined) ?? null;
        if (failedRunId) {
          await completePipelineRun(
            db,
            failedRunId,
            "failed",
            err instanceof Error ? err.message : String(err),
          );
        }
      } catch { /* non-critical */ }

      const { detectCreditError } = await import("@/lib/llm");
      const credit = detectCreditError(err);
      if (credit.isCredit) {
        return NextResponse.json(
          {
            error: "credits_exhausted",
            provider: credit.provider,
            message: credit.message,
          },
          { status: 402 },
        );
      }
      return NextResponse.json(
        { error: `Failed to poll deep research: ${sanitizeErrorMessage(err)}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
