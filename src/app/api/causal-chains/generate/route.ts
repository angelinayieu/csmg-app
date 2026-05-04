import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { propagateCausalChains } from "@/lib/causal-chains/propagate";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type { Entity } from "@/types";
import type { CausalChainResponse } from "@/types/causal-chains";

export const maxDuration = 60;

/**
 * POST /api/causal-chains/generate
 *
 * Deterministically generates CausalChain[] from existing synthesis_data +
 * entities + active goal. No LLM call — just structural propagation from
 * L4 convergences through strategy perspectives / micro_tactics.
 *
 * Body: { spaceId: string }
 */
export async function POST(request: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const parsed = await safeJsonParse<{ spaceId?: string }>(request);
  if (parsed.error) return parsed.error;
  const spaceId = parsed.data?.spaceId;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + read space
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .single();

  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    const synthData =
      typeof spaceRow.synthesis_data === "string"
        ? (JSON.parse(spaceRow.synthesis_data) as SynthesisData)
        : (spaceRow.synthesis_data as SynthesisData | null);

    // Load entities
    const { data: entityRows } = await db
      .from("entities")
      .select("*")
      .eq("space_id", spaceId);
    const entities: Entity[] = (entityRows ?? []) as Entity[];

    // Load active goal
    const { data: goalRow } = await db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "active")
      .is("parent_goal_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const activeGoal: ImprovementGoal | null = (goalRow ?? null) as ImprovementGoal | null;

    // Propagate
    const chains = propagateCausalChains({
      synthesisData: synthData,
      entities,
      activeGoal,
    });

    // Re-read and merge
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();
    const freshSynth =
      typeof fresh?.synthesis_data === "string"
        ? JSON.parse(fresh.synthesis_data)
        : (fresh?.synthesis_data ?? {});

    const merged = {
      ...freshSynth,
      causal_chains: chains,
    };

    await db.from("spaces").update({ synthesis_data: merged }).eq("id", spaceId);

    // Source counts read from interaction_metadata.convergences (canonical
    // write path) with top-level `convergences` as a fallback. Counts both
    // L3 + L4 since the propagator now seeds from either tier.
    const synthRecord = synthData as unknown as Record<string, unknown>;
    const im = synthRecord?.interaction_metadata as
      | { convergences?: unknown[] }
      | undefined;
    const convergences = ((im?.convergences as
      | Array<{ depth?: string }>
      | undefined) ??
      (synthRecord?.convergences as Array<{ depth?: string }> | undefined) ??
      []) as Array<{ depth?: string }>;
    const seedCount = convergences.filter((c) => {
      const d = (c.depth ?? "").toString().toUpperCase();
      return d === "L3" || d === "L4";
    }).length;

    const response: CausalChainResponse = {
      chains,
      generated_at: new Date().toISOString(),
      source_counts: {
        l4_convergences: seedCount,
        leverage_points: synthData?.leverage_points?.length ?? 0,
        micro_tactics:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((synthData as any)?.strategic_recommendation?.micro_tactics ?? []).length,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[causal-chains/generate] failed:", err);
    return NextResponse.json(
      { error: `Chain generation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
