import { checkCredits, reserveCredits, commitReservation, cancelReservation } from "@/lib/credits";
import { runPipeline } from "@/lib/orchestration/pipeline";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { batchInsert } from "@/lib/utils";
import { validatePipelineResult } from "@/lib/validation";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const maxDuration = 120; // 2 minute timeout for Vercel

export async function POST(request: Request) {
  const requestStart = Date.now();

  // Safe auth — returns JSON error on Supabase failure
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const { text, tier = "quick" } = body as {
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

          // Insert entities
          const entityMap = new Map<string, string>();
          if (space.structured.entities?.length) {
            const VALID_E_CATS = ["concrete", "abstract", "process", "relational", "epistemic"];
            const VALID_E_TAGS = ["explicit", "implicit", "assumed"];
            const VALID_E_IMP = ["fundamental", "critical", "important", "moderate"];
            const coerceVal = (v: unknown, valid: string[], fb: string): string =>
              typeof v === "string" && valid.includes(v) ? v : fb;

            const entityInserts = space.structured.entities.map((e) => ({
              space_id: spaceId,
              entity_id: e.entity_id,
              name: e.name,
              description: e.description ?? null,
              source_tag: coerceVal(e.source_tag, VALID_E_TAGS, "implicit"),
              entity_type: e.entity_type ?? "unknown",
              entity_category: coerceVal(e.entity_category, VALID_E_CATS, "abstract"),
              layer: e.layer ?? null,
              importance: coerceVal(e.importance, VALID_E_IMP, "moderate"),
              confidence: Math.max(0, Math.min(1, typeof e.confidence === "number" ? e.confidence : 0.8)),
              is_leverage_point: e.is_leverage_point ?? false,
              is_risk_point: e.is_risk_point ?? false,
              is_master_bottleneck: e.is_master_bottleneck ?? false,
              blast_radius: e.blast_radius ?? 0,
              centrality_rank: e.centrality_rank ?? null,
              is_shared_variable: e.is_shared_variable ?? false,
              is_decomposable: e.is_decomposable ?? false,
            }));

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
          }

          // Insert edges INDIVIDUALLY (one bad edge won't kill the rest)
          // Insert edges - BATCH APPROACH (1000 edges in 2s vs 50s sequential)
          const VALID_DIMS = ["structural","functional","temporal","causal","correlational","logical","epistemic","comparative","agentive"];
          const VALID_POLARITIES = ["positive","negative","neutral","conditional"];
          const VALID_TAGS = ["stated","inferred","predicted"];

          // Build array of valid edges (filter during construction, not insertion)
          // Drop edges below 0.4 confidence — a false edge corrupts analysis more than a missing edge
          const filteredEdges = (space.structured.edges ?? []).filter(
            (e) => (typeof e.confidence === "number" ? e.confidence : 0.8) >= 0.4
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

          // Insert external entities
          const extEntityMap = new Map<string, string>();
          for (const ext of result.externalKnowledge.external_entities ?? []) {
            const { data, error } = await db
              .from("entities")
              .insert({
                space_id: rootSpaceId,
                entity_id: ext.entity_id,
                name: ext.name,
                description: ext.description ?? null,
                source_tag: "predicted",
                entity_type: ext.entity_type ?? ext.category ?? "concept",
                entity_category: VALID_CATS.includes(ext.entity_category) ? ext.entity_category : "abstract",
                layer: ext.category ?? "external",
                importance: "moderate",
                confidence: ext.confidence ?? 0.5,
              })
              .select("id, entity_id")
              .single();

            if (data && !error) {
              extEntityMap.set(ext.entity_id, (data as { id: string }).id);
            }
          }

          // Insert external edges
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
