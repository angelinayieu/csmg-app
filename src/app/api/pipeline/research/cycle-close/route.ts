// ── POST /api/pipeline/research/cycle-close ──
//
// Phase 4a — cycle-closing pass. Detects 3-edge near-cycles in the
// space's KG, runs a targeted web search per near-cycle to determine
// whether the closing edge is supported by literature, and persists
// any confirmed edges directly into the `edges` table. Confirmed
// closures also auto-promote the existing path into the `cycles`
// table so the canvas's feedback-loop panel reflects them.
//
// Body:
//   {
//     spaceId: string,
//     runId?: string,                     // for event emission
//     topN?: number,                      // default 5; cap on near-cycles to investigate
//     maxCandidates?: number,             // default 10; passed to detector
//     researchDepth?: ResearchDepth,      // default "standard"
//   }
//
// Response:
//   {
//     candidatesDetected: number,         // total near-cycles detected
//     candidatesInvestigated: number,
//     edgesAdded: number,
//     cyclesPromoted: number,
//     findings: NearCycleFinding[],       // per-candidate result
//     errors: []
//   }
//
// Cost: ~1 web_search call per near-cycle investigated. Top-N cap
// keeps cost bounded — adversarial-pass-class budget.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { getAnthropicClient } from "@/lib/anthropic";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import {
  detectNearCycles,
  type NearCycleEdge,
  type NearCycleEntity,
  type NearCycle,
} from "@/lib/pipeline/near-cycle-detector";
import {
  CYCLE_CLOSE_SYSTEM_PROMPT,
  buildCycleCloseUserPrompt,
  type CycleCloseLlmOutput,
} from "@/lib/prompts/cycle-close";
import type { ResearchDepth } from "@/lib/web-search";

export const runtime = "nodejs";
export const maxDuration = 300;

interface EntityRow {
  id: string;
  name: string;
  description: string | null;
  importance: string | null;
  is_leverage_point: boolean | null;
  is_risk_point: boolean | null;
  is_master_bottleneck: boolean | null;
}

interface EdgeRow {
  source_entity_id: string;
  target_entity_id: string;
  confidence: number | null;
}

interface NearCycleFinding {
  nearCycle: NearCycle;
  foundEvidence: boolean;
  edgeId?: string;
  cycleId?: string;
  confidence?: number;
  rationale?: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const {
      spaceId,
      runId,
      topN: rawTopN,
      maxCandidates: rawMaxCandidates,
      researchDepth: rawDepth,
    } = (body ?? {}) as {
      spaceId?: string;
      runId?: string;
      topN?: number;
      maxCandidates?: number;
      researchDepth?: ResearchDepth;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }
    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const topN = Math.max(1, Math.min(10, rawTopN ?? 5));
    const maxCandidates = Math.max(topN, Math.min(50, rawMaxCandidates ?? 10));
    const researchDepth: ResearchDepth = rawDepth ?? "standard";

    // ── Load entities + edges ───────────────────────────────────────
    const [entitiesRes, edgesRes] = await Promise.all([
      db
        .from("entities")
        .select(
          "id, name, description, importance, is_leverage_point, is_risk_point, is_master_bottleneck",
        )
        .eq("space_id", spaceId),
      db
        .from("edges")
        .select("source_entity_id, target_entity_id, confidence")
        .eq("space_id", spaceId),
    ]);

    const entities = (entitiesRes.data ?? []) as EntityRow[];
    const edges = (edgesRes.data ?? []) as EdgeRow[];

    if (entities.length === 0 || edges.length === 0) {
      return NextResponse.json({
        candidatesDetected: 0,
        candidatesInvestigated: 0,
        edgesAdded: 0,
        cyclesPromoted: 0,
        findings: [],
        errors: [],
        note: "space has no entities or no edges — nothing to close",
      });
    }

    // ── Detect near-cycles ──────────────────────────────────────────
    const detectorEntities: NearCycleEntity[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      importance: e.importance ?? undefined,
      is_leverage_point: !!e.is_leverage_point,
      is_risk_point: !!e.is_risk_point,
      is_master_bottleneck: !!e.is_master_bottleneck,
    }));
    const detectorEdges: NearCycleEdge[] = edges.map((e) => ({
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      confidence: e.confidence ?? 0.5,
    }));
    const allCandidates = detectNearCycles({
      edges: detectorEdges,
      entities: detectorEntities,
      maxResults: maxCandidates,
    });
    const targets = allCandidates.slice(0, topN);

    if (targets.length === 0) {
      return NextResponse.json({
        candidatesDetected: 0,
        candidatesInvestigated: 0,
        edgesAdded: 0,
        cyclesPromoted: 0,
        findings: [],
        errors: [],
        note: "no near-cycles detected",
      });
    }

    // Index entity descriptions by id for prompt enrichment.
    const descById = new Map<string, string | null>();
    for (const e of entities) descById.set(e.id, e.description);

    // ── Investigate each near-cycle sequentially ────────────────────
    // Each LLM call uses web_search; sequential keeps rate limits in
    // check and bounds total latency.
    const findings: NearCycleFinding[] = [];
    const errors: string[] = [];
    let edgesAdded = 0;
    let cyclesPromoted = 0;

    for (const nc of targets) {
      try {
        const userPrompt = buildCycleCloseUserPrompt({
          pathNames: nc.entityNames,
          missingEdgeFromName: nc.entityNames[2],
          missingEdgeToName: nc.entityNames[0],
          pathDescriptions: [
            descById.get(nc.entityIds[0]) ?? null,
            descById.get(nc.entityIds[1]) ?? null,
            descById.get(nc.entityIds[2]) ?? null,
          ],
        });

        // Run with web_search enabled — this is a literature-search
        // pass, not a parametric-memory pass.
        const anthropic = getAnthropicClient();
        const tools = getResearchTools(researchDepth, 3);
        const stream = anthropic.messages.stream(
          {
            model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
            max_tokens: 4096,
            tools,
            system: CYCLE_CLOSE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
          },
          { timeout: 5 * 60 * 1000 },
        );
        const response = await stream.finalMessage();
        const parsed = parseResearchResponse(response.content);

        // The schema-enforced response: the model returns JSON in its
        // text body (after it does its searches). Use llmJSON's
        // parser indirectly by extracting JSON from the text.
        let llmOutput: CycleCloseLlmOutput | null = null;
        try {
          const jsonText = parsed.jsonOutput.trim();
          if (jsonText.length > 0) {
            llmOutput = JSON.parse(jsonText) as CycleCloseLlmOutput;
          }
        } catch {
          // Soft-fail per cycle — skip, record as failure, continue.
          errors.push(
            `near-cycle ${nc.entityNames.join("→")}: response was not valid JSON`,
          );
          findings.push({ nearCycle: nc, foundEvidence: false });
          continue;
        }

        if (!llmOutput || !llmOutput.found_evidence) {
          findings.push({
            nearCycle: nc,
            foundEvidence: false,
            rationale: llmOutput?.no_evidence_reason ?? "no LLM output",
          });
          continue;
        }

        // ── Persist the closing edge ────────────────────────────────
        // dimension default to 'causal' (cycle-closing is causal-by-design);
        // polarity default 'positive'; source_tag = 'predicted' (this
        // edge was inferred via research, not stated by the user).
        const polarity =
          llmOutput.polarity === "positive" ||
          llmOutput.polarity === "negative" ||
          llmOutput.polarity === "conditional"
            ? llmOutput.polarity
            : "positive";
        const dimension = llmOutput.dimension ?? "causal";
        const confidence = clamp01(llmOutput.confidence ?? 0.6);

        const { data: insertedEdge, error: edgeErr } = await db
          .from("edges")
          .insert({
            space_id: spaceId,
            source_entity_id: nc.missingEdge.source_entity_id,
            target_entity_id: nc.missingEdge.target_entity_id,
            relationship_type: "feeds_back_to",
            dimension,
            source_tag: "predicted",
            polarity,
            confidence,
            knowledge_layer: "external",
            conditions: llmOutput.relationship?.slice(0, 500) ?? null,
            provenance: {
              source_type: "cycle_close",
              source_url: llmOutput.source_urls?.[0] ?? null,
              source_title: llmOutput.source_titles?.[0] ?? null,
              quote: llmOutput.primary_quote?.slice(0, 500) ?? null,
              near_cycle_path: nc.entityNames,
            },
            is_part_of_cycle: true,
          })
          .select("id")
          .single();

        if (edgeErr || !insertedEdge) {
          errors.push(
            `edge insert failed for ${nc.entityNames.join("→")}: ${edgeErr?.message ?? "unknown"}`,
          );
          findings.push({ nearCycle: nc, foundEvidence: true });
          continue;
        }
        const newEdgeId = (insertedEdge as { id: string }).id;
        edgesAdded++;

        // ── Promote into the cycles table ───────────────────────────
        // The 3-edge cycle is now complete: (a→b, b→c, c→a). Insert a
        // cycles row so the synthesis layer's feedback-loop panel
        // picks it up. Classification heuristic: positive polarity →
        // reinforcing_positive; negative → balancing; conditional →
        // balancing (conservative).
        const classification =
          polarity === "negative" || polarity === "conditional"
            ? "balancing"
            : "reinforcing_positive";

        const { data: insertedCycle, error: cycleErr } = await db
          .from("cycles")
          .insert({
            space_id: spaceId,
            cycle_id: `near_cycle_${nc.entityIds[0].slice(0, 8)}_${nc.entityIds[2].slice(0, 8)}`,
            name: `${nc.entityNames[0]} → ${nc.entityNames[1]} → ${nc.entityNames[2]} → back`,
            classification,
            entity_ids: [
              nc.entityIds[0],
              nc.entityIds[1],
              nc.entityIds[2],
            ],
            edge_ids: [newEdgeId],
            description: llmOutput.relationship?.slice(0, 500) ?? null,
          })
          .select("id")
          .single();

        if (!cycleErr && insertedCycle) {
          cyclesPromoted++;
        } else if (cycleErr) {
          errors.push(`cycle insert failed: ${cycleErr.message}`);
        }

        findings.push({
          nearCycle: nc,
          foundEvidence: true,
          edgeId: newEdgeId,
          cycleId: insertedCycle
            ? (insertedCycle as { id: string }).id
            : undefined,
          confidence,
          rationale: llmOutput.relationship,
        });

        // Emit a structural event so the canvas can paint the new
        // edge + cycle in real time.
        if (runId) {
          try {
            await emitStructuralEvent(db, runId, {
              type: "edge_added",
              edgeId: newEdgeId,
              sourceEntityId: nc.missingEdge.source_entity_id,
              targetEntityId: nc.missingEdge.target_entity_id,
              relationshipType: "feeds_back_to",
              dimension,
              polarity,
              confidence,
            });
          } catch (emitErr) {
            errors.push(
              `edge_added emit failed: ${
                emitErr instanceof Error ? emitErr.message : String(emitErr)
              }`,
            );
          }
        }
      } catch (err) {
        errors.push(
          `near-cycle ${nc.entityNames.join("→")} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return NextResponse.json({
      candidatesDetected: allCandidates.length,
      candidatesInvestigated: targets.length,
      edgesAdded,
      cyclesPromoted,
      findings,
      errors: errors.slice(0, 10),
    });
  } catch (outerErr) {
    console.error("[research/cycle-close] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Cycle-close pass failed unexpectedly",
      },
      { status: 500 },
    );
  }
}

// llmJSON is imported above to keep the import surface small for any
// future caller that wants the strict JSON path; current implementation
// uses parseResearchResponse for web_search output.
void llmJSON;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
