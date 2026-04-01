import { createClient } from "@/lib/supabase/server";
import { checkCredits, deductCredits } from "@/lib/credits";
import { runPipeline } from "@/lib/orchestration/pipeline";
import type { AnalysisTier } from "@/lib/tiers";

export const maxDuration = 120; // 2 minute timeout for Vercel

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
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
  const creditCheck = await checkCredits(db, user.id, tier);
  if (!creditCheck.hasCredits) {
    return new Response(
      JSON.stringify({
        error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.`,
        required: creditCheck.required,
        balance: creditCheck.balance,
      }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: string) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      }

      try {
        // Run the pipeline
        const result = await runPipeline(text, tier, send);

        // Store results in database
        const spaceIds: string[] = [];

        for (const space of result.spaceData) {
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
            console.error("Space creation error:", spaceError);
            continue;
          }

          const spaceId = (spaceRow as { id: string }).id;
          spaceIds.push(spaceId);

          // Insert entities
          const entityMap = new Map<string, string>();
          if (space.structured.entities?.length) {
            const entityInserts = space.structured.entities.map((e) => ({
              space_id: spaceId,
              entity_id: e.entity_id,
              name: e.name,
              description: e.description ?? null,
              source_tag: e.source_tag ?? "explicit",
              entity_type: e.entity_type ?? "unknown",
              entity_category: e.entity_category ?? "concrete",
              layer: e.layer ?? null,
              importance: e.importance ?? null,
              confidence: e.confidence ?? 0.8,
              is_leverage_point: e.is_leverage_point ?? false,
              is_risk_point: e.is_risk_point ?? false,
              is_master_bottleneck: e.is_master_bottleneck ?? false,
              blast_radius: e.blast_radius ?? 0,
              centrality_rank: e.centrality_rank ?? null,
              is_shared_variable: e.is_shared_variable ?? false,
              is_decomposable: e.is_decomposable ?? false,
            }));

            const { data: insertedEntities } = await db
              .from("entities")
              .insert(entityInserts)
              .select("id, entity_id");

            if (insertedEntities) {
              for (const e of insertedEntities as { id: string; entity_id: string }[]) {
                entityMap.set(e.entity_id, e.id);
              }
            }
          }

          // Insert edges
          if (space.structured.edges?.length) {
            const edgeInserts = space.structured.edges
              .filter(
                (e) =>
                  entityMap.has(e.source_entity_id) &&
                  entityMap.has(e.target_entity_id)
              )
              .map((e) => ({
                space_id: spaceId,
                source_entity_id: entityMap.get(e.source_entity_id)!,
                target_entity_id: entityMap.get(e.target_entity_id)!,
                relationship_type: e.relationship_type,
                dimension: e.dimension ?? "functional",
                source_tag: e.source_tag ?? "inferred",
                strength: e.strength ?? 0.5,
                polarity: e.polarity ?? "positive",
                confidence: e.confidence ?? 0.8,
                conditions: e.conditions ?? null,
                is_tradeoff: e.is_tradeoff ?? false,
                resolved_by_entity_id: e.resolved_by_entity_id
                  ? entityMap.get(e.resolved_by_entity_id) ?? null
                  : null,
                is_part_of_cycle: e.is_part_of_cycle ?? false,
                cycle_id: e.cycle_id ?? null,
              }));

            if (edgeInserts.length > 0) {
              await db.from("edges").insert(edgeInserts);
            }
          }

          // Insert cycles
          if (space.structured.cycles?.length) {
            const cycleInserts = space.structured.cycles.map((c) => ({
              space_id: spaceId,
              cycle_id: c.cycle_id,
              name: c.name ?? null,
              classification: c.classification,
              entity_ids: c.entity_ids,
              intervention_point_entity_id: c.intervention_point
                ? entityMap.get(c.intervention_point) ?? null
                : null,
              intervention_description: c.intervention_description ?? null,
              description: c.description ?? null,
            }));
            await db.from("cycles").insert(cycleInserts);
          }

          // Insert action items
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
            await db.from("action_items").insert(actionInserts);
          }

          // Insert propositions, novel_connections, contradictions, scenarios
          if (space.structured.propositions?.length) {
            await db.from("propositions").insert(
              space.structured.propositions.map((p) => ({
                space_id: spaceId,
                proposition_id: p.proposition_id,
                statement: p.statement,
                proposition_type: p.proposition_type ?? "derived",
                confidence: p.confidence ?? 1.0,
                depends_on: p.depends_on ?? [],
                entity_ids: p.entity_ids ?? [],
              }))
            );
          }

          if (space.structured.novel_connections?.length) {
            await db.from("novel_connections").insert(
              space.structured.novel_connections.map((nc) => ({
                space_id: spaceId,
                source_entity_id: nc.source_entity_id,
                target_entity_id: nc.target_entity_id,
                relationship_type: nc.relationship_type,
                strength: nc.strength,
                reasoning: nc.reasoning,
              }))
            );
          }

          if (space.structured.contradictions?.length) {
            await db.from("contradictions").insert(
              space.structured.contradictions.map((c) => ({
                space_a_id: spaceId,
                assumption_text: c.assumption_text,
                conclusion_text: c.conclusion_text,
                severity: c.severity,
                description: c.description ?? null,
              }))
            );
          }

          if (space.structured.scenarios?.length) {
            await db.from("scenarios").insert(
              space.structured.scenarios.map((s, i) => ({
                space_id: spaceId,
                name: s.name,
                conditions: s.conditions,
                outcome_label: s.outcome_label,
                outcome_value: s.outcome_value,
                probability: s.probability ?? null,
                sort_order: i,
              }))
            );
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

        // Deduct credits (charge to root space)
        if (spaceIds.length > 0) {
          await deductCredits(db, user.id, tier, spaceIds[0]);
          await db
            .from("spaces")
            .update({ credits_used: creditCheck.required })
            .eq("id", spaceIds[0]);
        }

        // Store meta-synthesis result if available
        if (result.synthesisResult && spaceIds.length > 0) {
          await db
            .from("spaces")
            .update({ synthesis_data: result.synthesisResult })
            .eq("id", spaceIds[0]);
        }

        send(
          "complete",
          JSON.stringify({
            spaceIds,
            rootSpaceId: spaceIds[0] ?? null,
            tier,
            creditsUsed: creditCheck.required,
          })
        );
      } catch (err) {
        console.error("Orchestration error:", err);
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
