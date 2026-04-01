import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { DECOMPOSITION_SYSTEM_PROMPT } from "@/lib/prompts/decomposition";
import { STRUCTURING_SYSTEM_PROMPT } from "@/lib/prompts/structuring";
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
        const anthropic = getAnthropicClient();
        let rawDecomposition = "";

        const messageStream = anthropic.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: DECOMPOSITION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send("delta", event.delta.text);
            rawDecomposition += event.delta.text;
          }
        }

        // ── Signal phase change ──
        send("phase", "structuring");

        // ── Pass 2: Structuring ──
        const structureResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: STRUCTURING_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Convert this decomposition to JSON:\n\n${rawDecomposition}`,
            },
          ],
        });

        const rawJson =
          structureResponse.content[0].type === "text"
            ? structureResponse.content[0].text
            : "";

        // Try to parse JSON, handling potential markdown fencing
        let parsed: StructuredDecomposition;
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          // Try stripping markdown code fences
          const stripped = rawJson
            .replace(/^```(?:json)?\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();
          try {
            parsed = JSON.parse(stripped);
          } catch {
            // Pass 2 failed — save raw decomposition only
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
        }

        // ── Database Inserts ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        try {
          // Insert entities (with v2 fields)
          const entityInserts = (parsed.entities ?? []).map((e) => ({
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

          const entityIdMap = new Map<string, string>();

          if (entityInserts.length > 0) {
            const insertResult = await db
              .from("entities")
              .insert(entityInserts)
              .select("id, entity_id");

            if (insertResult.error) {
              console.error("Entity insert error:", insertResult.error);
            } else if (insertResult.data) {
              for (const entity of insertResult.data as Array<{
                id: string;
                entity_id: string;
              }>) {
                entityIdMap.set(entity.entity_id, entity.id);
              }
            }
          }

          // Insert edges (with v2 tradeoff fields, requires UUID mapping)
          const edgeInserts = (parsed.edges ?? [])
            .filter(
              (e) =>
                entityIdMap.has(e.source_entity_id) &&
                entityIdMap.has(e.target_entity_id)
            )
            .map((e) => ({
              space_id: spaceId,
              source_entity_id: entityIdMap.get(e.source_entity_id)!,
              target_entity_id: entityIdMap.get(e.target_entity_id)!,
              relationship_type: e.relationship_type,
              dimension: e.dimension ?? "functional",
              source_tag: e.source_tag ?? "inferred",
              strength: e.strength ?? 0.5,
              polarity: e.polarity ?? "positive",
              confidence: e.confidence ?? 0.8,
              conditions: e.conditions ?? null,
              is_tradeoff: e.is_tradeoff ?? false,
              resolved_by_entity_id: e.resolved_by_entity_id
                ? entityIdMap.get(e.resolved_by_entity_id) ?? null
                : null,
              is_part_of_cycle: e.is_part_of_cycle ?? false,
              cycle_id: e.cycle_id ?? null,
            }));

          if (edgeInserts.length > 0) {
            const { error: edgeError } = await db
              .from("edges")
              .insert(edgeInserts);
            if (edgeError) console.error("Edge insert error:", edgeError);
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

          // Update space with metadata + rich synthesis data
          const meta = parsed.metadata ?? ({} as Record<string, unknown>);
          const synthesisData = {
            leverage_points: parsed.leverage_points ?? [],
            risk_points: parsed.risk_points ?? [],
            master_bottleneck: parsed.master_bottleneck ?? null,
          };
          await db
            .from("spaces")
            .update({
              name: meta.name || tempName,
              description: meta.description || null,
              space_prefix: meta.space_prefix || prefix,
              raw_decomposition: rawDecomposition,
              synthesis_text: meta.synthesis_text || null,
              synthesis_data: synthesisData,
              entity_count: entityInserts.length,
              edge_count: edgeInserts.length,
              orphan_count: meta.orphan_count ?? 0,
              cycle_count: cycleInserts.length,
              maturity: meta.maturity ?? "actionable_now",
              updated_at: new Date().toISOString(),
            })
            .eq("id", spaceId);
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

        // ── Done ──
        send("complete", JSON.stringify({ spaceId }));
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
