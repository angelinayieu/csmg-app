import { llmStream, llmJSON } from "@/lib/llm";
import { getDecompositionPrompt, getStructuringPrompt } from "@/lib/prompts/tier-prompts";
import { getSynthesisPrompt } from "@/lib/prompts/synthesis";
import { buildDecompIntentBlock } from "@/lib/prompts/intent-context";
import type { UserIntent } from "@/types/analysis";
import { checkCredits, deductCredits } from "@/lib/credits";
import { safeAuth } from "@/lib/api-helpers";
import {
  sanitizeEntity,
  sanitizeEdge,
  sanitizeCycle,
  deduplicateEntities,
  resilientInsert,
  filterLowConfidenceEdges,
  extractEvidenceBasis,
} from "@/lib/sanitize";
import type { StructuredDecomposition } from "@/types/analysis";

export const maxDuration = 120; // Allow up to 2 minutes for Vercel

export async function POST(request: Request) {
  // 1. Auth check (safe — returns JSON on failure)
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1b. Credit check (Quick tier = 1 credit)
  try {
    const creditCheck = await checkCredits(db, user.id, "quick");
    if (!creditCheck.hasCredits) {
      return Response.json(
        { error: `Insufficient credits. Need ${creditCheck.required}, have ${creditCheck.balance}.` },
        { status: 402 }
      );
    }
  } catch (err) {
    console.error("[Analyze] Credit check failed:", err);
    return Response.json(
      { error: "Service temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }

  // 2. Validate input
  let text: string;
  let intent: UserIntent | undefined;
  try {
    const body = await request.json();
    text = body.text;
    intent = body.intent;
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

  const { data: spaceData, error: spaceError } = await db
    .from("spaces")
    .insert({
      user_id: user.id,
      name: tempName,
      space_prefix: prefix || "A",
      input_text: text,
      maturity: "theoretical",
      user_role: intent?.user_role ?? null,
      primary_goal: intent?.primary_goal ?? null,
      context_type: intent?.context_type ?? null,
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

  // Agent run tracking — start a decomposer run that spans the SSE stream lifetime
  const { beginRouteAgent } = await import("@/lib/agents/instrument-route");
  const agent = await beginRouteAgent(db, {
    spaceId,
    userId: user.id,
    kind: "decomposer",
    triggerEvent: "analyze.requested",
    triggerData: { tier: "quick" },
  });

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
        // ── Pass 1: Streaming Decomposition (Quick tier prompts) ──
        let rawDecomposition = "";
        const intentPrefix = buildDecompIntentBlock(intent);
        const enrichedText = intentPrefix ? intentPrefix + "\n\n" + text : text;

        for await (const chunk of llmStream({
          system: getDecompositionPrompt("quick"),
          user: enrichedText,
          maxTokens: 16000,
        })) {
          send("delta", chunk);
          rawDecomposition += chunk;
        }

        // ── Signal phase change ──
        send("phase", "structuring");

        // ── Pass 2: Structuring (Quick tier prompts) ──
        let parsed: StructuredDecomposition;
        try {
          parsed = await llmJSON<StructuredDecomposition>({
            system: getStructuringPrompt("quick"),
            user: `Convert this decomposition to JSON:\n\n${rawDecomposition}`,
            maxTokens: 16000,
            temperature: 0.3,
          });
        } catch (parseErr) {
            // Pass 2 failed — save raw decomposition only
            console.error("Structuring failed:", parseErr);
            await db
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

        // ── Filter low-confidence edges + deduplicate entities ──
        const rawEntityCount = (parsed.entities ?? []).length;
        const rawEdgeCount = (parsed.edges ?? []).length;
        const confFilteredEdges = filterLowConfidenceEdges(parsed.edges ?? [], 0.2, (parsed.entities ?? []).length);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { entities: dedupedEntities, edges: dedupedEdges } = deduplicateEntities(
          (parsed.entities ?? []) as any,
          confFilteredEdges as any
        );

        console.log(`[analyze] Pipeline: ${rawEntityCount} raw entities → ${dedupedEntities.length} after dedup, ${rawEdgeCount} raw edges → ${confFilteredEdges.length} after confidence → ${dedupedEdges.length} after dedup`);
        if (dedupedEntities.length === 0) {
          console.error(`[analyze] WARNING: 0 entities after sanitization! Raw entity count was ${rawEntityCount}. Input text length: ${text.length} chars`);
        }

        // ── Database Inserts ──
        try {
          // ── Insert entities (sanitized + resilient) ──
          const entityIdMap = new Map<string, string>();
          const sanitizedEntities = dedupedEntities.map((e) => sanitizeEntity(e, spaceId));

          if (sanitizedEntities.length > 0) {
            const { data: entityData } = await resilientInsert(db, "entities", sanitizedEntities, "id, entity_id");
            for (const row of entityData) {
              entityIdMap.set(row.entity_id, row.id);
            }
          }

          // ── Persist evidence_basis as claims (non-critical) ──
          // Mirrors orchestrate route pattern. Closes the "evidence discard" bug
          // where LLM-generated evidence was extracted but never stored.
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
            for (const rawEntity of dedupedEntities) {
              const entityUuid = entityIdMap.get(rawEntity.entity_id);
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
            console.warn("[analyze] Claim persistence failed (non-critical):", claimErr);
          }

          // ── Insert edges (sanitized, skip invalid refs) ──
          const sanitizedEdges = dedupedEdges
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((e: any) => sanitizeEdge(e, spaceId, entityIdMap))
            .filter((e): e is NonNullable<typeof e> => e !== null);

          let edgesInserted = 0;
          if (sanitizedEdges.length > 0) {
            const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
            edgesInserted = inserted;
          }

          // ── Insert cycles (sanitized) ──
          const sanitizedCycles = (parsed.cycles ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => sanitizeCycle(c, spaceId, entityIdMap))
            .filter((c): c is NonNullable<typeof c> => c !== null);

          let cyclesInserted = 0;
          if (sanitizedCycles.length > 0) {
            const { inserted } = await resilientInsert(db, "cycles", sanitizedCycles, "id");
            cyclesInserted = inserted;
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
              cycle_count: cyclesInserted,
              maturity: meta.maturity ?? "actionable_now",
              updated_at: new Date().toISOString(),
            })
            .eq("id", spaceId);

          // ── Pass 3: Deep Synthesis ──
          send("phase", "synthesizing");

          try {
            // Build compact summary for synthesis agent
            const entitySummary = dedupedEntities.map((e) => ({
              id: e.entity_id,
              name: e.name,
              description: e.description,
            }));

            const edgeSummary = dedupedEdges.map((e) => ({
              from: e.source_entity_id,
              to: e.target_entity_id,
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
              system: getSynthesisPrompt(intent),
              user: synthInput,
              maxTokens: 16384,
              temperature: 0.3,
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
          await db
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
        await agent.complete({
          findingsCount:
            (parsed.metadata?.entity_count ?? 0) +
            (parsed.metadata?.edge_count ?? 0) +
            (parsed.metadata?.cycle_count ?? 0),
          artifacts: ["entities", "edges", "cycles"],
        });
        send("complete", JSON.stringify({ spaceId, creditsUsed: 1, newBalance }));
      } catch (err) {
        console.error("Analysis error:", err);
        await agent.fail(err instanceof Error ? err.message : String(err));
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
