import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeRefinementSignals } from "@/lib/twin/outcome-refinement";
import type { OutcomeRecord } from "@/lib/twin/outcome-tracking";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; recId: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: goalId, recId } = await params;

  // Verify goal ownership
  const { data: goal } = await db
    .from("improvement_goals")
    .select("id")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // Status update
  if (body.status && typeof body.status === "string") {
    const valid = ["pending", "in_progress", "completed", "dismissed"];
    if (!valid.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }

  // Outcome recording
  if (body.outcome && typeof body.outcome === "string") {
    const valid = ["effective", "ineffective", "partial", "not_tested"];
    if (!valid.includes(body.outcome)) {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }
    updates.outcome = body.outcome;
    updates.outcome_recorded_at = new Date().toISOString();
    if (typeof body.outcome_notes === "string") {
      updates.outcome_notes = body.outcome_notes;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await db
    .from("goal_recommendations")
    .update(updates)
    .eq("id", recId)
    .eq("goal_id", goalId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Gap 6: Trigger outcome-based refinement when outcome is recorded ──
  if (body.outcome && (body.outcome === "effective" || body.outcome === "ineffective" || body.outcome === "partial")) {
    try {
      // Fetch all outcomes for this goal
      const { data: allRecs } = await db
        .from("goal_recommendations")
        .select("id, source_entity_id, source_type, outcome, outcome_notes, outcome_recorded_at")
        .eq("goal_id", goalId)
        .not("outcome", "is", null);

      if (allRecs && allRecs.length > 0) {
        const outcomes: OutcomeRecord[] = allRecs.map((r: any) => ({
          recommendation_id: r.id,
          source_entity_id: r.source_entity_id,
          source_type: r.source_type,
          outcome: r.outcome,
          recorded_at: r.outcome_recorded_at ?? new Date().toISOString(),
          notes: r.outcome_notes,
        }));

        // Fetch goal's space_id to get synthesis data and entities
        const { data: goalData } = await db
          .from("improvement_goals")
          .select("space_id")
          .eq("id", goalId)
          .single();

        if (goalData?.space_id) {
          const [{ data: spaceData }, { data: entData }] = await Promise.all([
            db.from("spaces").select("synthesis_data").eq("id", goalData.space_id).single(),
            db.from("entities").select("*").eq("space_id", goalData.space_id),
          ]);

          const synthesisData = (spaceData?.synthesis_data ?? null) as any;
          const entities = (entData ?? []) as any[];

          const signals = computeRefinementSignals(outcomes, synthesisData, entities);

          if (signals.length > 0) {
            // Apply "demote" signals — flag unreliable entities + reduce edge confidence
            for (const signal of signals.filter((s) => s.recommendation === "demote")) {
              await db
                .from("entities")
                .update({ is_low_confidence: true, requires_user_approval: true })
                .eq("entity_id", signal.entity_id)
                .eq("space_id", goalData.space_id);

              // Part C: Edge confidence propagation — reduce edges touching demoted entity
              // Edges reference entities by UUID (entities.id), so look up the UUID first
              const { data: entityRow } = await db
                .from("entities")
                .select("id")
                .eq("entity_id", signal.entity_id)
                .eq("space_id", goalData.space_id)
                .single();

              const entityUuid = entityRow?.id;
              const { data: affectedEdges } = entityUuid
                ? await db
                    .from("edges")
                    .select("id, confidence")
                    .eq("space_id", goalData.space_id)
                    .or(`source_entity_id.eq.${entityUuid},target_entity_id.eq.${entityUuid}`)
                : { data: null };

              if (affectedEdges && affectedEdges.length > 0) {
                for (const edge of affectedEdges) {
                  const currentConf = typeof edge.confidence === "number" ? edge.confidence : 1;
                  await db
                    .from("edges")
                    .update({
                      confidence: Math.round(currentConf * 0.8 * 100) / 100,
                      is_low_confidence: true,
                    })
                    .eq("id", edge.id);
                }
              }
            }

            // Store refinement signals for next synthesis run
            const existingSynth = (spaceData?.synthesis_data ?? {}) as Record<string, unknown>;
            await db.from("spaces").update({
              synthesis_data: { ...existingSynth, refinement_signals: signals },
            }).eq("id", goalData.space_id);

            // Attach signals to response so UI can show demote notifications
            return NextResponse.json({ ...data, refinement_signals: signals });
          }
        }
      }
    } catch (refErr) {
      // Non-critical — outcome was recorded, refinement is bonus
      console.warn("Outcome refinement failed:", refErr);
    }
  }

  return NextResponse.json(data);
}
