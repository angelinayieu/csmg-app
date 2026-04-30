// ── POST /api/pipeline/research/boundary ──
//
// Phase 4b — boundary-condition pass. For each top leverage point in
// the space (leverage_point flag + bottleneck flag + high importance),
// ask the LLM to find peer-reviewed failure modes — specific conditions
// under which the leverage point fails to produce its expected effect.
// Each confirmed failure mode lands as:
//   • a new entity (entity_category='process', flagged as failure-mode
//     via provenance + a name prefix), AND
//   • a conditional edge from the leverage point to the failure-mode
//     entity (polarity='conditional', dimension='causal').
//
// Body:
//   {
//     spaceId: string,
//     runId?: string,
//     topN?: number,                     // default 3 leverage points
//     researchDepth?: ResearchDepth,
//   }
//
// Response:
//   {
//     leveragePointsInvestigated: number,
//     failureModesFound: number,
//     entitiesAdded: number,
//     edgesAdded: number,
//     errors: []
//   }
//
// Cost: 1 web_search call per leverage point. Top-N=3 default →
// 3 LLM calls, ~$0.10 worst case.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import { getAnthropicClient } from "@/lib/anthropic";
import { getResearchTools, parseResearchResponse } from "@/lib/web-search";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import {
  BOUNDARY_CONDITION_SYSTEM_PROMPT,
  buildBoundaryConditionUserPrompt,
  type BoundaryConditionLlmOutput,
} from "@/lib/prompts/boundary-condition";
import type { ResearchDepth } from "@/lib/web-search";

export const runtime = "nodejs";
export const maxDuration = 300;

interface LeverageEntityRow {
  id: string;
  name: string;
  description: string | null;
  importance: string | null;
  is_leverage_point: boolean | null;
  is_master_bottleneck: boolean | null;
}

interface RunOutcomeRow {
  target_outcome: { name?: string } | null;
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
      researchDepth: rawDepth,
    } = (body ?? {}) as {
      spaceId?: string;
      runId?: string;
      topN?: number;
      researchDepth?: ResearchDepth;
    };

    if (!spaceId) {
      return NextResponse.json({ error: "spaceId required" }, { status: 400 });
    }
    const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
    if (!isOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const topN = Math.max(1, Math.min(10, rawTopN ?? 3));
    const researchDepth: ResearchDepth = rawDepth ?? "standard";

    // ── Pick target leverage points ─────────────────────────────────
    // Prefer master_bottleneck > leverage_point > high importance.
    // Boundary conditions only matter on entities that drive the
    // analysis — investigating failure modes of moderate-importance
    // entities is wasted budget.
    const { data: leverageRows } = await db
      .from("entities")
      .select(
        "id, name, description, importance, is_leverage_point, is_master_bottleneck",
      )
      .eq("space_id", spaceId)
      .or("is_leverage_point.eq.true,is_master_bottleneck.eq.true");

    const leverages = (leverageRows ?? []) as LeverageEntityRow[];

    // If no flagged leverage points, fall back to top-N by importance —
    // most KGs that haven't run synthesis-refresh yet won't have flags
    // populated.
    let targets: LeverageEntityRow[];
    if (leverages.length === 0) {
      const { data: importanceFallback } = await db
        .from("entities")
        .select(
          "id, name, description, importance, is_leverage_point, is_master_bottleneck",
        )
        .eq("space_id", spaceId)
        .in("importance", ["fundamental", "critical"])
        .limit(topN);
      targets = ((importanceFallback ?? []) as LeverageEntityRow[]).slice(
        0,
        topN,
      );
    } else {
      targets = leverages
        .sort((a, b) => {
          const aBot = a.is_master_bottleneck ? 1 : 0;
          const bBot = b.is_master_bottleneck ? 1 : 0;
          if (aBot !== bBot) return bBot - aBot;
          const impRank: Record<string, number> = {
            fundamental: 0,
            critical: 1,
            important: 2,
            moderate: 3,
          };
          return (
            (impRank[a.importance ?? "moderate"] ?? 4) -
            (impRank[b.importance ?? "moderate"] ?? 4)
          );
        })
        .slice(0, topN);
    }

    if (targets.length === 0) {
      return NextResponse.json({
        leveragePointsInvestigated: 0,
        failureModesFound: 0,
        entitiesAdded: 0,
        edgesAdded: 0,
        errors: [],
        note: "no leverage points to investigate",
      });
    }

    // ── Look up the run's target_outcome (Phase 1) for prompt anchor ─
    let targetOutcomeName: string | undefined;
    if (runId) {
      const { data } = await db
        .from("pipeline_runs")
        .select("target_outcome")
        .eq("id", runId)
        .maybeSingle();
      const outcome = (data as RunOutcomeRow | null)?.target_outcome ?? null;
      if (outcome && typeof outcome.name === "string") {
        targetOutcomeName = outcome.name;
      }
    }

    // ── Investigate each leverage point ─────────────────────────────
    const errors: string[] = [];
    let totalFailureModes = 0;
    let entitiesAdded = 0;
    let edgesAdded = 0;

    for (const leverage of targets) {
      try {
        const userPrompt = buildBoundaryConditionUserPrompt({
          leverageName: leverage.name,
          leverageDescription: leverage.description,
          targetOutcomeName,
        });

        const anthropic = getAnthropicClient();
        const tools = getResearchTools(researchDepth, 3);
        const stream = anthropic.messages.stream(
          {
            model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
            max_tokens: 6000,
            tools,
            system: BOUNDARY_CONDITION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
          },
          { timeout: 5 * 60 * 1000 },
        );
        const response = await stream.finalMessage();
        const parsed = parseResearchResponse(response.content);

        let llmOutput: BoundaryConditionLlmOutput | null = null;
        try {
          const jsonText = parsed.jsonOutput.trim();
          if (jsonText.length > 0) {
            llmOutput = JSON.parse(jsonText) as BoundaryConditionLlmOutput;
          }
        } catch {
          errors.push(
            `boundary for ${leverage.name}: response not valid JSON`,
          );
          continue;
        }

        if (
          !llmOutput ||
          !Array.isArray(llmOutput.failure_modes) ||
          llmOutput.failure_modes.length === 0
        ) {
          continue;
        }

        // ── Persist each failure mode as entity + conditional edge ──
        for (const fm of llmOutput.failure_modes) {
          if (!fm.name || !fm.trigger || !fm.mechanism) continue;
          const confidence = clamp01(fm.confidence ?? 0.5);
          // Skip low-confidence failure modes — boundary conditions
          // need to be defensible. The LLM's threshold for inclusion
          // is supposed to be peer-reviewed evidence, but a confidence
          // floor is a cheap second filter.
          if (confidence < 0.4) continue;

          const fmName = `Failure mode: ${fm.name}`.slice(0, 200);
          const { data: insertedEntity, error: entErr } = await db
            .from("entities")
            .insert({
              space_id: spaceId,
              name: fmName,
              description: `${fm.trigger}. ${fm.mechanism}`.slice(0, 1000),
              entity_category: "process",
              entity_type: "process",
              source_tag: "predicted",
              importance: "important",
              confidence,
              knowledge_layer: "external",
              authority_level: "moderate",
              provenance: {
                source_type: "boundary_condition",
                trigger: fm.trigger,
                mechanism: fm.mechanism,
                observable_indicator: fm.observable_indicator,
                source_url: fm.source_url,
                source_title: fm.source_title,
                quote: fm.quote?.slice(0, 500),
                related_leverage_id: leverage.id,
                related_leverage_name: leverage.name,
              },
            })
            .select("id")
            .single();

          if (entErr || !insertedEntity) {
            errors.push(
              `failure-mode entity insert failed: ${entErr?.message ?? "unknown"}`,
            );
            continue;
          }
          const fmEntityId = (insertedEntity as { id: string }).id;
          entitiesAdded++;

          // Conditional edge: leverage_point → failure_mode (active
          // when the trigger fires). Polarity from the LLM, defaulting
          // to 'conditional' since by definition this only applies in
          // certain regimes.
          const polarity =
            fm.polarity_when_active === "negative" ||
            fm.polarity_when_active === "neutral"
              ? fm.polarity_when_active
              : "conditional";

          const { error: edgeErr } = await db.from("edges").insert({
            space_id: spaceId,
            source_entity_id: leverage.id,
            target_entity_id: fmEntityId,
            relationship_type: "fails_under",
            dimension: "causal",
            source_tag: "predicted",
            polarity,
            confidence,
            knowledge_layer: "external",
            conditions: fm.trigger.slice(0, 500),
            provenance: {
              source_type: "boundary_condition",
              trigger: fm.trigger,
              source_url: fm.source_url,
              quote: fm.quote?.slice(0, 500),
            },
          });
          if (edgeErr) {
            errors.push(
              `failure-mode edge insert failed: ${edgeErr.message}`,
            );
            continue;
          }
          edgesAdded++;
          totalFailureModes++;

          // Emit so the canvas can render the new entity + edge.
          if (runId) {
            try {
              await emitStructuralEvent(db, runId, {
                type: "entity_added",
                entityId: fmEntityId,
                entityCode: null,
                name: fmName,
                entityCategory: "process",
                importance: "important",
                parentEntityId: leverage.id,
              });
            } catch (emitErr) {
              errors.push(
                `entity_added emit failed: ${
                  emitErr instanceof Error ? emitErr.message : String(emitErr)
                }`,
              );
            }
          }
        }
      } catch (err) {
        errors.push(
          `boundary pass for ${leverage.name} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return NextResponse.json({
      leveragePointsInvestigated: targets.length,
      failureModesFound: totalFailureModes,
      entitiesAdded,
      edgesAdded,
      errors: errors.slice(0, 10),
    });
  } catch (outerErr) {
    console.error("[research/boundary] unhandled:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Boundary pass failed unexpectedly",
      },
      { status: 500 },
    );
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
