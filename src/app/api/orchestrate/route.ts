import { checkCredits, reserveCredits, commitReservation, cancelReservation } from "@/lib/credits";
import { runPipeline } from "@/lib/orchestration/pipeline";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { batchInsert } from "@/lib/utils";
import { validatePipelineResult } from "@/lib/validation";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { sanitizeEntity, extractEvidenceBasis, resilientInsert } from "@/lib/sanitize";

export const maxDuration = 600; // 10 minute timeout — web_search research calls are slow

export async function POST(request: Request) {
  const requestStart = Date.now();

  // Safe auth — returns JSON error on Supabase failure
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // ── Phase 3.1: researchOnly mode ──────────────────────────────────
  // Lightweight path that skips decomposition/synthesis and only runs
  // the research pipeline (Agent 7 + bridge discovery).  Called by the
  // Intelligence Radar to refresh external knowledge without burning a
  // full analysis credit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyAny = body as Record<string, any>;
  if (bodyAny.researchOnly === true) {
    const spaceId = bodyAny.spaceId as string | undefined;
    if (!spaceId) {
      return new Response(
        JSON.stringify({ error: "spaceId is required for researchOnly mode" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // Verify ownership + fetch space data
    const { data: space, error: spaceErr } = await db
      .from("spaces")
      .select("id, input_text, user_id, space_prefix")
      .eq("id", spaceId)
      .single();

    if (spaceErr || !space) {
      return new Response(
        JSON.stringify({ error: "Space not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    if ((space as { user_id: string }).user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Not authorized" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build the payload expected by /api/pipeline/research
    const researchBody: Record<string, unknown> = {
      spaceIds: [spaceId],
      inputSummary: (space as { input_text: string }).input_text,
      researchDepth: bodyAny.researchDepth ?? "standard",
    };
    if (Array.isArray(bodyAny.focus_areas)) {
      researchBody.focus_areas = bodyAny.focus_areas;
    }
    if (Array.isArray(bodyAny.skip_categories)) {
      researchBody.skip_categories = bodyAny.skip_categories;
    }

    // Call the research route handler directly — avoids HTTP layer timeout limits
    // (Node's undici fetch has a 300s headersTimeout that can't be overridden)
    const { POST: researchPOST } = await import("@/app/api/pipeline/research/route");
    const cookie = request.headers.get("cookie") ?? "";
    const authorization = request.headers.get("authorization") ?? "";
    const researchUrl = new URL("/api/pipeline/research", request.url);

    try {
      const researchReq = new Request(researchUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(researchBody),
      });

      const researchRes = await researchPOST(researchReq);
      const researchResult = await researchRes.json();

      if (!researchRes.ok) {
        return new Response(
          JSON.stringify({ error: researchResult.error ?? "Research pipeline failed" }),
          { status: researchRes.status, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, researchOnly: true, ...researchResult }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("[Orchestrate] researchOnly error:", err);
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Research failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ── Standard analysis pipeline ────────────────────────────────────
  const { text, tier = "quick" } = bodyAny as {
    text: string;
    tier?: AnalysisTier;
  };

  // Validate input
  if (!text || typeof text !== "string") {
    return new Response(JSON.stringify({ error: "Text is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (text.length < 20 || text.length > 50000) {
    return new Response(
      JSON.stringify({ error: "Text must be between 20 and 50,000 characters" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check credits
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const creditCheck = await checkCredits(db, user.id, tier);
    if (!creditCheck.hasCredits) {
      return new Response(
        JSON.stringify({
          error: `Insufficient credits. Need ${TIERS[tier].credits}, have ${creditCheck.balance}.`,
          required: TIERS[tier].credits,
          balance: creditCheck.balance,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("[Orchestrate] Credit check failed:", err);
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable. Please try again." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: string) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
          );
        } catch {
          // Client disconnected — ignore
        }
      }

      let reservation: { reservationId: string; success: boolean; error?: string } | null = null;

      try {
        // ✅ ATOMIC FLOW: Reserve credits BEFORE any inserts (fixes race condition)
        reservation = await reserveCredits(db, user.id, tier);
        if (!reservation.success) {
          send(
            "error",
            JSON.stringify({
              error: reservation.error || "Failed to reserve credits",
            })
          );
          return;
        }


        // Run the pipeline
        const pipelineStart = Date.now();
        const result = await runPipeline(text, tier, send);

        // ✅ PHASE 2.2: Validate LLM output before database storage (prevents data corruption)
        const validationResult = validatePipelineResult(result);
        if (!validationResult.valid) {
          const errorMsg = `LLM output validation failed: ${(validationResult.errors || []).join("; ")}`;
          console.error("[Orchestrate]", errorMsg);
          send(
            "error",
            JSON.stringify({
              error: errorMsg,
              validationErrors: validationResult.errors,
            })
          );
          if (reservation?.reservationId) {
            await cancelReservation(db, reservation.reservationId);
          }
          return;
        }

        const validatedResult = validationResult.data!;

        // Store results in database
        const spaceIds: string[] = [];
        let insertionError: string | null = null;

        for (const space of validatedResult.spaceData) {
          const meta = space.structured.metadata ?? {};

          // Create space record
          const { data: spaceRow, error: spaceError } = await db
            .from("spaces")
            .insert({
              user_id: user.id,
              name: meta.name || "Untitled Analysis",
              description: meta.description || null,
              space_prefix: meta.space_prefix || space.scope.prefix,
              input_text: text,
              raw_decomposition: space.raw,
              synthesis_text: meta.synthesis_text || null,
              synthesis_data: {
                leverage_points: space.structured.leverage_points ?? [],
                risk_points: space.structured.risk_points ?? [],
                master_bottleneck: space.structured.master_bottleneck ?? null,
                suggested_objectives: validatedResult.earlyObjectives ?? [],
                objectives_pending_review: (validatedResult.earlyObjectives?.length ?? 0) > 0,
              },
              entity_count: space.structured.entities?.length ?? 0,
              edge_count: space.structured.edges?.length ?? 0,
              orphan_count: meta.orphan_count ?? 0,
              cycle_count: space.structured.cycles?.length ?? 0,
              maturity: meta.maturity ?? "actionable_now",
              analysis_tier: tier,
              credits_used: 0, // Will be set on the root space
              agent_count: result.spaceData.length > 1 ? 6 : tier === "standard" ? 4 : 2,
            })
            .select("id")
            .single();

          if (spaceError) {
            insertionError = `Space creation error: ${spaceError.message}`;
            console.error("[Orchestrate]", insertionError);
            send("warning", JSON.stringify({ message: insertionError }));
            continue;
          }

          const spaceId = (spaceRow as { id: string }).id;
          spaceIds.push(spaceId);

          // Insert entities (using shared sanitizeEntity for full field coverage)
          const entityMap = new Map<string, string>();
          if (space.structured.entities?.length) {
            const entityInserts = space.structured.entities.map((e) => sanitizeEntity(e, spaceId));

            const { data: insertedEntities, error: entityErr } = await db
              .from("entities")
              .insert(entityInserts)
              .select("id, entity_id");

            if (entityErr) {
              insertionError = `Entity insertion failed: ${entityErr.message}`;
              console.error("[Orchestrate]", insertionError);
            }

            if (insertedEntities) {
              for (const e of insertedEntities as { id: string; entity_id: string }[]) {
                entityMap.set(e.entity_id, e.id);
              }
            }

            // Persist evidence_basis as claims (non-critical)
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
                const evidence = extractEvidenceBasis(rawEntity);
                for (const ev of evidence) {
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
              }
            } catch (claimErr) {
              console.warn("[Orchestrate] Claim persistence failed (non-critical):", claimErr);
            }
          }

          // Insert edges INDIVIDUALLY (one bad edge won't kill the rest)
          // Insert edges - BATCH APPROACH (1000 edges in 2s vs 50s sequential)
          const VALID_DIMS = ["structural","functional","temporal","causal","correlational","logical","epistemic","comparative","agentive"];
          const VALID_POLARITIES = ["positive","negative","neutral","conditional"];
          const VALID_TAGS = ["stated","inferred","predicted"];

          // Build array of valid edges (filter during construction, not insertion)
          // Drop edges below 0.2 confidence — lowered from 0.4 which was too aggressive
          // and silently removed 25-40% of edges, creating disconnected graphs.
          // Low-confidence edges are still valuable for graph connectivity; they render
          // with dashed lines in the UI to indicate uncertainty.
          const filteredEdges = (space.structured.edges ?? []).filter(
            (e) => (typeof e.confidence === "number" ? e.confidence : 0.8) >= 0.2
          );
          const edgesToInsert = filteredEdges
            .map((e) => {
              const srcId = (e.source_entity_id ?? "").trim();
              const tgtId = (e.target_entity_id ?? "").trim();
              const srcUuid = entityMap.get(srcId);
              const tgtUuid = entityMap.get(tgtId);

              if (!srcUuid || !tgtUuid) {
                return null; // Filtered out below
              }

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
                resolved_by_entity_id: e.resolved_by_entity_id
                  ? entityMap.get(e.resolved_by_entity_id) ?? null
                  : null,
                is_part_of_cycle: e.is_part_of_cycle ?? false,
                cycle_id: e.cycle_id ?? null,
                dynamics: e.dynamics ?? null,
                dynamics_properties: e.dynamics_properties ?? null,
              };
            })
            .filter(Boolean) as any[];

          const edgesSkipped = (space.structured.edges ?? []).length - edgesToInsert.length;

          // Batch insert all valid edges
          if (edgesToInsert.length > 0) {
            const edgeResult = await batchInsert(db, "edges", edgesToInsert, {
              batchSize: 100,
              failureThreshold: 0.1,
              emitWarning: (msg) => send("warning", JSON.stringify({ message: msg })),
            });
          } else {
          }

          // Insert cycles - BATCH
          if (space.structured.cycles?.length) {
            const cycleInserts = space.structured.cycles.map((c) => ({
              space_id: spaceId,
              cycle_id: c.cycle_id,
              name: c.name ?? null,
              classification: c.classification,
              entity_ids: Array.isArray(c.entity_ids) ? c.entity_ids : [],
              intervention_point_entity_id: c.intervention_point
                ? entityMap.get(c.intervention_point) ?? null
                : null,
              intervention_description: c.intervention_description ?? null,
              description: c.description ?? null,
              growth_type: c.growth_type ?? null,
              cycle_time: c.cycle_time ?? null,
              estimated_multiplier: typeof c.estimated_multiplier === "number" ? c.estimated_multiplier : null,
            }));

            await batchInsert(db, "cycles", cycleInserts, { batchSize: 50 });
          }

          // Insert action items - BATCH
          if (space.structured.action_items?.length) {
            const actionInserts = space.structured.action_items.map(
              (a, i) => ({
                space_id: spaceId,
                timeframe: a.timeframe,
                path_label: a.path_label ?? "default",
                action_text: a.action_text,
                why_text: a.why_text ?? null,
                derived_from_entity_id: a.derived_from_entity_id ?? null,
                tags: a.tags ?? [],
                sort_order: i,
              })
            );

            await batchInsert(db, "action_items", actionInserts, { batchSize: 50 });
          }

          // Insert propositions - BATCH
          if (space.structured.propositions?.length) {
            const propInserts = space.structured.propositions.map((p) => ({
              space_id: spaceId,
              proposition_id: p.proposition_id,
              statement: p.statement,
              proposition_type: p.proposition_type ?? "derived",
              confidence: p.confidence ?? 1.0,
              depends_on: p.depends_on ?? [],
              entity_ids: p.entity_ids ?? [],
            }));

            await batchInsert(db, "propositions", propInserts, { batchSize: 50 });
          }

          // Insert novel connections - BATCH
          if (space.structured.novel_connections?.length) {
            const ncInserts = space.structured.novel_connections.map((nc) => ({
              space_id: spaceId,
              source_entity_id: nc.source_entity_id,
              target_entity_id: nc.target_entity_id,
              relationship_type: nc.relationship_type,
              strength: nc.strength,
              reasoning: nc.reasoning,
            }));

            await batchInsert(db, "novel_connections", ncInserts, { batchSize: 50 });
          }

          // Insert contradictions - BATCH
          if (space.structured.contradictions?.length) {
            const contInserts = space.structured.contradictions.map((c) => ({
              space_a_id: spaceId,
              assumption_text: c.assumption_text,
              conclusion_text: c.conclusion_text,
              severity: c.severity,
              description: c.description ?? null,
            }));

            await batchInsert(db, "contradictions", contInserts, { batchSize: 50 });
          }

          // Insert scenarios - BATCH
          if (space.structured.scenarios?.length) {
            const scenInserts = space.structured.scenarios.map((s, i) => ({
              space_id: spaceId,
              name: s.name,
              conditions: s.conditions,
              outcome_label: s.outcome_label,
              outcome_value: s.outcome_value,
              probability: s.probability ?? null,
              sort_order: i,
            }));

            await batchInsert(db, "scenarios", scenInserts, { batchSize: 50 });
          }
        }

        // Set parent-child relationships for multi-space
        if (spaceIds.length > 1) {
          const rootId = spaceIds[0];
          for (let i = 1; i < spaceIds.length; i++) {
            await db
              .from("spaces")
              .update({ parent_space_id: rootId })
              .eq("id", spaceIds[i]);
          }
        }

        // ✅ COMMIT credits (only after all inserts succeed)
        if (spaceIds.length > 0 && !insertionError) {
          const { success, error, newBalance } = await commitReservation(
            db,
            reservation.reservationId,
            spaceIds[0]
          );

          if (!success) {
            console.error(`[Orchestrate] Credit commitment failed: ${error}`);
            send(
              "warning",
              JSON.stringify({
                message: `Analysis complete but credit commitment failed: ${error}`,
              })
            );
          } else {
            await db
              .from("spaces")
              .update({ credits_used: TIERS[tier].credits })
              .eq("id", spaceIds[0]);
          }
        } else if (insertionError) {
          // Cancel reservation on insertion error
          await cancelReservation(db, reservation.reservationId);
        }

        // Store meta-synthesis result if available
        if (result.synthesisResult && spaceIds.length > 0) {
          await db
            .from("spaces")
            .update({ synthesis_data: result.synthesisResult })
            .eq("id", spaceIds[0]);
        }

        // Store external knowledge (Agent 7) in the first space
        if (result.externalKnowledge && spaceIds.length > 0) {
          const rootSpaceId = spaceIds[0];
          const VALID_DIMS = ["structural","functional","temporal","causal","correlational","logical","epistemic","comparative","agentive"];
          const VALID_CATS = ["concrete","abstract","process","relational","epistemic"];

          // Insert external entities with full source metadata
          const extEntityMap = new Map<string, string>();
          const citations = result.externalKnowledge.citations ?? [];
          const isWebMode = result.externalKnowledge.research_mode === "web_search";

          for (const ext of result.externalKnowledge.external_entities ?? []) {
            // Match citations to this entity by keyword overlap
            const entityNameWords = ext.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
            const matchingCitations = citations.filter((c: { url: string; title: string; citedText: string }) =>
              entityNameWords.some(
                (w: string) => c.citedText.toLowerCase().includes(w) || c.title.toLowerCase().includes(w)
              )
            );
            const isWebSourced = (ext as Record<string, unknown>).source_type === "web_search" || matchingCitations.length > 0;
            const sourceUrl = (ext as Record<string, unknown>).source_url as string | undefined ?? matchingCitations[0]?.url ?? null;

            const { data, error } = await db
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
                  : (ext.authority_level === "high" ? "moderate" : ext.authority_level ?? "low"),
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

            if (data && !error) {
              extEntityMap.set(ext.entity_id, (data as { id: string }).id);
            }
          }

          // Insert external edges with provenance
          for (const edge of result.externalKnowledge.external_edges ?? []) {
            const srcUuid = extEntityMap.get(edge.source);
            const tgtUuid = extEntityMap.get(edge.target);
            if (!srcUuid || !tgtUuid) continue;

            await db.from("edges").insert({
              space_id: rootSpaceId,
              source_entity_id: srcUuid,
              target_entity_id: tgtUuid,
              relationship_type: edge.relationship_type,
              dimension: VALID_DIMS.includes(edge.dimension) ? edge.dimension : "comparative",
              source_tag: "predicted",
              strength: 0.5,
              polarity: "positive",
              confidence: 0.6,
              knowledge_layer: "external",
              provenance: {
                source_type: isWebMode ? "web_search_enhanced" : "training_knowledge",
              },
            });
          }


          // Store bridge edges (internal ↔ external connections)
          if (result.bridgeDiscovery?.bridges?.length) {
            // Build a combined entity lookup: entity_id string → UUID
            // Internal entities were stored earlier with their entityMaps
            // We need to find internal UUIDs across all spaces
            const allInternalEntityIds = new Map<string, string>();
            // Re-query all internal entities for this analysis
            for (const sid of spaceIds) {
              const { data: ents } = await db
                .from("entities")
                .select("id, entity_id")
                .eq("space_id", sid);
              for (const e of (ents ?? []) as { id: string; entity_id: string }[]) {
                allInternalEntityIds.set(e.entity_id, e.id);
              }
            }

            let bridgesInserted = 0;
            for (const bridge of result.bridgeDiscovery.bridges) {
              // Internal entity might be prefixed (A:C5) or plain (C5)
              const internalId = bridge.internal_entity_id.includes(":")
                ? bridge.internal_entity_id.split(":")[1]
                : bridge.internal_entity_id;
              const internalUuid = allInternalEntityIds.get(internalId);
              const externalUuid = extEntityMap.get(bridge.external_entity_id);

              if (!internalUuid || !externalUuid) continue;

              const { error } = await db.from("edges").insert({
                space_id: rootSpaceId,
                source_entity_id: internalUuid,
                target_entity_id: externalUuid,
                relationship_type: bridge.connection_type,
                dimension: "comparative",
                source_tag: "predicted",
                strength: bridge.strength === "strong" ? 0.8 : bridge.strength === "moderate" ? 0.6 : 0.4,
                polarity: bridge.connection_type === "challenges" ? "negative" : "positive",
                confidence: bridge.importance === "high" ? 0.8 : 0.6,
                conditions: bridge.reasoning,
              });
              if (!error) bridgesInserted++;
            }
          }
        }

        // Store cross-context insights in synthesis_data
        if (result.bridgeDiscovery?.cross_context_insights?.length && spaceIds.length > 0) {
          const { data: existingSynth } = await db
            .from("spaces")
            .select("synthesis_data")
            .eq("id", spaceIds[0])
            .single();
          const synthData = (existingSynth?.synthesis_data ?? {}) as Record<string, unknown>;
          synthData.cross_context_insights = result.bridgeDiscovery.cross_context_insights;
          await db
            .from("spaces")
            .update({ synthesis_data: synthData })
            .eq("id", spaceIds[0]);
        }

        send(
          "complete",
          JSON.stringify({
            spaceIds,
            rootSpaceId: spaceIds[0] ?? null,
            tier,
            creditsUsed: TIERS[tier].credits,
          })
        );
      } catch (err) {
        console.error("[Orchestrate] Error:", err);

        // Cancel reservation on any exception
        if (reservation?.reservationId) {
          await cancelReservation(db, reservation.reservationId);
        }

        send(
          "error",
          JSON.stringify({
            message: err instanceof Error ? err.message : "Analysis failed",
          })
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
