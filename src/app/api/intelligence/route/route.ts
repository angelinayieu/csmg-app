// ── Intelligence Router endpoint ──
//
// POST /api/intelligence/route
//   body: RouterInput (from @/types/intelligence-router)
//
// Runs the meta-classifier, persists any proposed actions + proposed objectives
// so they can appear in the UI as actionable buttons. Returns the full
// RouterResult so the caller can react inline.
//
// Cost: 1 LLM call (cheap model — gpt-4o-mini). Does NOT auto-fire heavy
// pipelines; surfaces them as proposals instead.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { runIntelligenceRouter } from "@/lib/intelligence/router";
import type { RouterInput, RouterResult } from "@/types/intelligence-router";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let input: RouterInput;
  try {
    input = (await request.json()) as RouterInput;
    if (typeof input.text !== "string" || input.text.trim().length < 10) {
      return NextResponse.json({ error: "text must be >= 10 chars" }, { status: 400 });
    }
    if (!input.source) {
      return NextResponse.json({ error: "source required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Space ownership check (if space_id provided)
  if (input.space_id) {
    const isOwner = await verifySpaceOwnership(supabase, input.space_id, user.id);
    if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Assemble router context
    let spaceMetadata = undefined;
    let existingObjectives: Array<{ id: string; title: string; objective_type?: string; description?: string }> = [];
    let recentContent: string[] | undefined;

    if (input.space_id) {
      const [spaceRes, goalsRes] = await Promise.all([
        db.from("spaces").select("name, description, entity_count").eq("id", input.space_id).single(),
        db.from("improvement_goals")
          .select("id, title, objective_type, description")
          .eq("space_id", input.space_id)
          .limit(12),
      ]);
      if (spaceRes.data) {
        spaceMetadata = {
          space_name: spaceRes.data.name,
          space_description: spaceRes.data.description,
          entity_count: spaceRes.data.entity_count,
        };
      }
      existingObjectives = (goalsRes.data ?? []) as typeof existingObjectives;
    } else {
      // Cross-space: fetch user's global objectives
      const { data: globalGoals } = await db
        .from("improvement_goals")
        .select("id, title, objective_type, description, space_id")
        .limit(20);
      existingObjectives = (globalGoals ?? []) as typeof existingObjectives;
    }

    if (input.context?.recent_context) {
      recentContent = input.context.recent_context;
    }

    // Run the router
    const result: RouterResult = await runIntelligenceRouter(input, {
      existingObjectives,
      spaceMetadata,
      recentContent,
    });

    // ── Persist proposed actions as router_proposals rows ──
    if (result.proposed_actions.length > 0 && input.space_id) {
      const rows = result.proposed_actions.map((action) => ({
        space_id: input.space_id,
        kind: action.kind,
        reason: action.reason,
        confidence: action.confidence,
        cost_estimate: action.cost_estimate,
        payload: action.payload ?? null,
        router_trace_id: result.router_trace_id,
        triggered_by_content: input.text.slice(0, 200),
        status: "pending",
      }));
      const { error: insertError } = await db.from("router_proposals").insert(rows);
      if (insertError) {
        console.warn("[intelligence/route] Failed to persist proposals:", insertError);
      }
    }

    // ── Persist proposed NEW objective ──
    if (result.objective_signals.proposes_new_objective && input.space_id) {
      const p = result.objective_signals.proposes_new_objective;
      await db.from("proposed_objectives").insert({
        space_id: input.space_id,
        suggested_title: p.suggested_title,
        objective_type: p.objective_type,
        rationale: p.rationale,
        triggering_excerpt: p.triggering_excerpt,
        confidence: p.confidence,
        router_trace_id: result.router_trace_id,
        source: input.source,
        status: "pending",
      });
    }

    // ── Persist proposed sub-objective ──
    if (result.objective_signals.proposes_new_sub_objective && input.space_id) {
      const p = result.objective_signals.proposes_new_sub_objective;
      await db.from("proposed_objectives").insert({
        space_id: input.space_id,
        suggested_title: p.suggested_title,
        objective_type: "maximize",
        rationale: p.rationale,
        triggering_excerpt: input.text.slice(0, 200),
        confidence: p.confidence,
        parent_objective_id: p.parent_objective_id,
        router_trace_id: result.router_trace_id,
        source: input.source,
        status: "pending",
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[intelligence/route] Error:", err);
    return NextResponse.json(
      { error: `Router failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
