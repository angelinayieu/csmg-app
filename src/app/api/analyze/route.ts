import { createClient } from "@/lib/supabase/server";
import { llmStream, llmJSON } from "@/lib/llm";
import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
import { SYNTHESIS_SYSTEM_PROMPT } from "@/lib/prompts/synthesis";
import { checkCredits, deductCredits } from "@/lib/credits";
import type { StructuredDecomposition } from "@/types/analysis";

export const maxDuration = 120; // Allow up to 2 minutes for Vercel

export async function POST(request: Request) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1b. Credit check (Quick tier = 1 credit)
  const creditCheck = await checkCredits(db, user.id, "quick");
  if (!creditCheck.hasCredits) {
    return Response.json(
      { error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.` },
      { status: 402 }
    );
  }

  // 2. Validate input
  let text: string;
  try {
    const body = await request.json();
    text = body.text;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!text || typeof text !== "string") {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }

  if (text.trim().length < 20) {
    return Response.json(
      { error: "Text must be at least 20 characters" },
      { status: 400 }
    );
  }

  if (text.length > 50000) {
    return Response.json(
      { error: "Text must be under 50,000 characters" },
      { status: 400 }
    );
  }

  // 3. Create initial space record
  const prefix = text
    .trim()
    .split(/\s/)[0]
    .slice(0, 2)
    .toUpperCase()
    .replace(/[^A-Z]/g, "A");
  const tempName =
    text.trim().slice(0, 60) + (text.trim().length > 60 ? "..." : "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spaceData, error: spaceError } = await (supabase as any)
    .from("spaces")
    .insert({
      user_id: user.id,
      name: tempName,
      space_prefix: prefix || "A",
      input_text: text,
      maturity: "theoretical",
    })
    .select()
    .single();

  if (spaceError || !spaceData) {
    return Response.json(
      {
        error:
          "Failed to create space: " +
          (spaceError?.message ?? "Unknown error"),
      },
      { status: 500 }
    );
  }

  const spaceId = spaceData.id as string;

  // 4. Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: string) {
        try {
          // SSE data fields cannot contain raw newlines — encode as JSON for safety
          const encoded = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${encoded}\n\n`)
          );
        } catch {
          // Controller may be closed if client disconnected
        }
      }

      try {
        // ── Pass 1: Streaming Decomposition ──
        let rawDecomposition = "";

        for await (const chunk of llmStream({
          system: DECOMPOSITION_SYSTEM_PROMPT,
          user: text,
          maxTokens: 16000,
        })) {
          send("delta", chunk);
          rawDecomposition += chunk;
        }

        // ── Signal phase change ──
        send("phase", "structuring");

        // ── Pass 2: Structuring ──
        let parsed: StructuredDecomposition;
        try {
          parsed = await llmJSON<StructuredDecomposition>({
            system: STRUCTURING_SYSTEM_PROMPT,
            user: `Convert this decomposition to JSON:\n\n${rawDecomposition}`,
            maxTokens: 16000,
            temperature: 0.3,
          });
        } catch (parseErr) {
            // Pass 2 failed — save raw decomposition only
            console.error("Structuring failed:", parseErr);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("spaces")
              .update({
                raw_decomposition: rawDecomposition,
                maturity: "blocked",
              })
              .eq("id", spaceId);

            send(
              "error",
              JSON.stringify({
                message:
                  "Structuring failed — raw decomposition saved. You can view the raw analysis.",
                spaceId,
              })
            );
            controller.close();
            return;
        }

        // ── Database Inserts ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        try {
          // Insert entities (with v2 fields)
          const VALID_E_CATS = ["concrete", "abstract", "process", "relational", "epistemic"] as const;
          const VALID_E_TAGS = ["explicit", "implicit", "assumed"] as const;
          const VALID_E_IMP = ["fundamental", "critical", "important", "moderate"] as const;
          const coerceVal = <T extends string>(v: unknown, valid: readonly T[], fb: T): T =>
            typeof v === "string" && (valid as readonly string[]).includes(v) ? v as T : fb;

          const entityInserts = (parsed.entities ?? []).map((e) => ({
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

          // ── Insert entities and build ID map ──
          const VALID_DIMS = ["structural","functional","temporal","causal","correlational","logical","epistemic","comparative","agentive"];
          const VALID_POLARITIES = ["positive","negative","neutral","conditional"];
          const VALID_TAGS = ["stated","inferred","predicted"];

          const entityIdMap = new Map<string, string>();

          if (entityInserts.length > 0) {
            const insertResult = await db
              .from("entities")
              .insert(entityInserts)
              .select("id, entity_id");

            if (insertResult.error) {
              console.error("Entity insert error:", insertResult.error);
              // Attempt individual inserts as fallback
              for (const ent of entityInserts) {
                const { data, error } = await db
                  .from("entities")
                  .insert(ent)
                  .select("id, entity_id")
                  .single();
                if (data && !error) {
                  entityIdMap.set(data.entity_id, data.id);
                }
              }
            } else if (insertResult.data) {
              for (const entity of insertResult.data as Array<{
                id: string;
                entity_id: string;
              }>) {
                entityIdMap.set(entity.entity_id, entity.id);
              }
            }
          }


          // ── Insert edges INDIVIDUALLY (one bad edge won't kill the rest) ──
          const rawEdgeCount = (parsed.edges ?? []).length;
          let edgesInserted = 0;
          let edgesSkipped = 0;
          let edgesFailed = 0;

          for (const e of parsed.edges ?? []) {
            // Normalize entity IDs (trim whitespace)
            const srcId = (e.source_entity_id ?? "").trim();
            const tgtId = (e.target_entity_id ?? "").trim();

            const srcUuid = entityIdMap.get(srcId);
            const tgtUuid = entityIdMap.get(tgtId);

            if (!srcUuid || !tgtUuid) {
              edgesSkipped++;
              continue;
            }

            // Core edge fields (always safe to insert)
            const edgeRow: Record<string, unknown> = {
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
                ? entityIdMap.get(e.resolved_by_entity_id) ?? null
                : null,
              is_part_of_cycle: e.is_part_of_cycle ?? false,
              cycle_id: e.cycle_id ?? null,
            };

            // Optional columns (added by migrations — safe to include)
            if (e.dynamics) edgeRow.dynamics = e.dynamics;
            if (e.dynamics_properties) edgeRow.dynamics_properties = e.dynamics_properties;
            edgeRow.is_low_confidence = (e.confidence ?? 0.8) < 0.4;

            // First attempt: full insert
            let { error: edgeError } = await db
              .from("edges")
              .insert(edgeRow);

            // Fallback: if insert fails (e.g. unknown column), retry with core fields only
            if (edgeError) {
              console.warn(`[Analyze] Edge insert failed, retrying core-only: ${srcId}→${tgtId}: ${edgeError.message}`);
              const coreRow = {
                space_id: spaceId,
                source_entity_id: srcUuid,
                target_entity_id: tgtUuid,
                relationship_type: edgeRow.relationship_type,
                dimension: edgeRow.dimension,
                source_tag: edgeRow.source_tag,
                strength: edgeRow.strength,
                polarity: edgeRow.polarity,
                confidence: edgeRow.confidence,
                conditions: edgeRow.conditions,
                is_tradeoff: edgeRow.is_tradeoff,
                is_part_of_cycle: edgeRow.is_part_of_cycle,
                cycle_id: edgeRow.cycle_id,
              };
              const retry = await db.from("edges").insert(coreRow);
              edgeError = retry.error;
            }

            if (edgeError) {
              console.error(`[Analyze] Edge PERMANENTLY failed: ${srcId}→${tgtId} (${e.relationship_type}):`, edgeError.message);
              edgesFailed++;
            } else {
              edgesInserted++;
            }
          }


          // Insert cycles (with v2 intervention_description)
          const cycleInserts = (parsed.cycles ?? []).map((c) => ({
            space_id: spaceId,
            cycle_id: c.cycle_id,
            name: c.name ?? null,
            classification: c.classification,
            entity_ids: c.entity_ids,
            intervention_point_entity_id: c.intervention_point
              ? entityIdMap.get(c.intervention_point) ?? null
              : null,
            intervention_description: c.intervention_description ?? null,
            description: c.description ?? null,
            growth_type: c.growth_type ?? null,
            cycle_time: c.cycle_time ?? null,
            estimated_multiplier: c.estimated_multiplier ?? null,
          }));

          if (cycleInserts.length > 0) {
            const { error: cycleError } = await db
              .from("cycles")
              .insert(cycleInserts);
            if (cycleError) console.error("Cycle insert error:", cycleError);
          }

          // Insert propositions
          const propInserts = (parsed.propositions ?? []).map((p) => ({
            space_id: spaceId,
            proposition_id: p.proposition_id,
            statement: p.statement,
            proposition_type: p.proposition_type ?? "probable",
            confidence: p.confidence ?? 0.8,
            depends_on: p.depends_on ?? null,
            entity_ids: p.entity_ids ?? null,
          }));

          if (propInserts.length > 0) {
            const { error: propError } = await db
              .from("propositions")
              .insert(propInserts);
            if (propError) console.error("Proposition insert error:", propError);
          }

          // Insert novel connections (v2)
          const novelInserts = (parsed.novel_connections ?? []).map((n) => ({
            space_id: spaceId,
            source_entity_id: n.source_entity_id,
            target_entity_id: n.target_entity_id,
            relationship_type: n.relationship_type,
            strength: n.strength ?? "moderate",
            reasoning: n.reasoning,
          }));

          if (novelInserts.length > 0) {
            const { error: novelError } = await db
              .from("novel_connections")
              .insert(novelInserts);
            if (novelError) console.error("Novel connection insert error:", novelError);
          }

          // Insert contradictions (v2)
          const contradictionInserts = (parsed.contradictions ?? []).map((c) => ({
            space_a_id: spaceId,
            assumption_text: c.assumption_text,
            conclusion_text: c.conclusion_text,
            severity: c.severity ?? "moderate",
            description: c.description ?? null,
          }));

          if (contradictionInserts.length > 0) {
            const { error: contradError } = await db
              .from("contradictions")
              .insert(contradictionInserts);
            if (contradError) console.error("Contradiction insert error:", contradError);
          }

          // Insert scenarios (v2)
          const scenarioInserts = (parsed.scenarios ?? []).map((s, i) => ({
            space_id: spaceId,
            name: s.name,
            conditions: s.conditions,
            outcome_label: s.outcome_label,
            outcome_value: s.outcome_value,
            probability: s.probability ?? null,
            sort_order: i,
          }));

          if (scenarioInserts.length > 0) {
            const { error: scenarioError } = await db
              .from("scenarios")
              .insert(scenarioInserts);
            if (scenarioError) console.error("Scenario insert error:", scenarioError);
          }

          // Insert action items (v3 with path_label, why_text, tags)
          const actionInserts = (parsed.action_items ?? []).map((a, i) => ({
            space_id: spaceId,
            timeframe: a.timeframe,
            path_label: a.path_label ?? "default",
            action_text: a.action_text,
            why_text: a.why_text ?? null,
            derived_from_entity_id: a.derived_from_entity_id ?? null,
            tags: a.tags ?? [],
            sort_order: i,
          }));

          if (actionInserts.length > 0) {
            const { error: actionError } = await db
              .from("action_items")
              .insert(actionInserts);
            if (actionError) console.error("Action item insert error:", actionError);
          }

          // Update space with metadata (before synthesis pass)
          const meta = parsed.metadata ?? ({} as Record<string, unknown>);
          await db
            .from("spaces")
            .update({
              name: meta.name || tempName,
              description: meta.description || null,
              space_prefix: meta.space_prefix || prefix,
              raw_decomposition: rawDecomposition,
              synthesis_text: meta.synthesis_text || null,
              entity_count: entityIdMap.size,
              edge_count: edgesInserted,
              orphan_count: meta.orphan_count ?? 0,
              cycle_count: (parsed.cycles ?? []).length,
              maturity: meta.maturity ?? "actionable_now",
              updated_at: new Date().toISOString(),
            })
            .eq("id", spaceId);

          // ── Pass 3: Deep Synthesis ──
          send("phase", "synthesizing");

          try {
            // Build compact summary for synthesis agent
            const entitySummary = (parsed.entities ?? []).map((e) => ({
              id: e.entity_id,
              name: e.name,
              description: e.description,
              category: e.entity_category,
              importance: e.importance,
              confidence: e.confidence,
              is_leverage: e.is_leverage_point,
              is_risk: e.is_risk_point,
              is_bottleneck: e.is_master_bottleneck,
              blast_radius: e.blast_radius,
              centrality_rank: e.centrality_rank,
              layer: e.layer,
              is_shared_variable: e.is_shared_variable,
              is_decomposable: e.is_decomposable,
            }));

            const edgeSummary = (parsed.edges ?? []).map((e) => ({
              from: e.source_entity_id,
              to: e.target_entity_id,
              type: e.relationship_type,
              dimension: e.dimension,
              strength: e.strength,
              polarity: e.polarity,
              is_tradeoff: e.is_tradeoff,
            }));

            const cycleSummary = (parsed.cycles ?? []).map((c) => ({
              name: c.name,
              classification: c.classification,
              chain: c.entity_ids,
              intervention_point: c.intervention_point,
            }));

            const synthInput = `Analyze this structured data and produce a deep strategic synthesis.

ENTITIES (${entitySummary.length}):
${JSON.stringify(entitySummary, null, 1)}

RELATIONSHIPS (${edgeSummary.length}):
${JSON.stringify(edgeSummary, null, 1)}

CYCLES (${cycleSummary.length}):
${JSON.stringify(cycleSummary, null, 1)}

CONTEXT: The user submitted this text for analysis:
"${text.slice(0, 500)}${text.length > 500 ? "..." : ""}"

Produce the full strategic synthesis JSON.`;

            const synthParsed = await llmJSON({
              system: SYNTHESIS_SYSTEM_PROMPT,
              user: synthInput,
              maxTokens: 16000,
              temperature: 0.5,
            });

            // Store rich synthesis data
            await db
              .from("spaces")
              .update({
                synthesis_data: synthParsed,
                updated_at: new Date().toISOString(),
              })
              .eq("id", spaceId);
          } catch (synthError) {
            console.error("Pass 3 synthesis error:", synthError);
            // Fallback: store basic synthesis data from Pass 2
            const fallbackSynthesis = {
              leverage_points: parsed.leverage_points ?? [],
              risk_points: parsed.risk_points ?? [],
              master_bottleneck: parsed.master_bottleneck ?? null,
            };
            await db
              .from("spaces")
              .update({
                synthesis_data: fallbackSynthesis,
                updated_at: new Date().toISOString(),
              })
              .eq("id", spaceId);
          }
        } catch (dbError) {
          console.error("Database insert error:", dbError);
          // Still save raw decomposition even if structured inserts fail
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("spaces")
            .update({
              raw_decomposition: rawDecomposition,
              maturity: "blocked",
            })
            .eq("id", spaceId);
        }

        // ── Deduct credits ──
        const { newBalance } = await deductCredits(db, user.id, "quick", spaceId);

        // ── Log changelog ──
        await db.from("space_changelog").insert({
          space_id: spaceId,
          version: 1,
          change_type: "initial_analysis",
          summary: `Initial analysis: ${parsed.metadata?.entity_count ?? 0} entities, ${parsed.metadata?.edge_count ?? 0} edges, ${parsed.metadata?.cycle_count ?? 0} cycles`,
          details: {
            entity_count: parsed.metadata?.entity_count ?? 0,
            edge_count: parsed.metadata?.edge_count ?? 0,
            cycle_count: parsed.metadata?.cycle_count ?? 0,
            tier: "quick",
          },
        });

        // ── Done ──
        send("complete", JSON.stringify({ spaceId, creditsUsed: 1, newBalance }));
      } catch (err) {
        console.error("Analysis error:", err);
        send(
          "error",
          JSON.stringify({
            message:
              err instanceof Error ? err.message : "Analysis failed",
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
