// GET /api/spaces/[id]/insights-summary
//
// Phase A1.8 (U3) — narrow projection of spaces.synthesis_data shared
// by every asset folder's "Insights" tab. Every tab that wants to show
// insights about its class reads this one endpoint and picks the
// fields it cares about, so the rigor stays unified — there's only
// ONE source of synthesized insights in the system and it's
// `spaces.synthesis_data`, produced by `/api/pipeline/synthesize`.
//
// Returns null-safe fields so callers don't need defensive parsing
// for spaces that haven't been synthesized yet.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Space } from "@/types";
import type {
  SynthesisData,
  RichLeveragePoint,
  RichRiskPoint,
  RichFeedbackLoop,
  RichScenario,
  RichDiscoveredConnection,
  RichOpenQuestion,
  RichContradiction,
  RichBottleneck,
} from "@/types/synthesis";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface InsightsSummaryResponse {
  /** null when the space has never been synthesized. */
  synthesized_at: string | null;
  /** null when the space has never been synthesized. */
  space_name: string;
  leverage_points: RichLeveragePoint[];
  risk_points: RichRiskPoint[];
  master_bottleneck: RichBottleneck | null;
  // All list fields are narrowed to non-undefined arrays — the endpoint
  // coerces absent fields to `[]` so downstream renderers never need to
  // defensively check for `undefined`.
  feedback_loops: RichFeedbackLoop[];
  scenarios: RichScenario[];
  discovered_connections: RichDiscoveredConnection[];
  open_questions: RichOpenQuestion[];
  contradictions: RichContradiction[];
  /** Null when no strategic recommendation has been produced. */
  strategic_recommendation: SynthesisData["strategic_recommendation"] | null;
  /**
   * Fingerprint of the decomposition the synthesis was built from.
   * Clients can compare against the space's current decomp fingerprint
   * to know whether the synthesis is stale. Not currently used by the
   * drawer but costs nothing to expose.
   */
  decomp_fingerprint: string | null;
}

function emptySummary(spaceName: string): InsightsSummaryResponse {
  return {
    synthesized_at: null,
    space_name: spaceName,
    leverage_points: [],
    risk_points: [],
    master_bottleneck: null,
    feedback_loops: [],
    scenarios: [],
    discovered_connections: [],
    open_questions: [],
    contradictions: [],
    strategic_recommendation: null,
    decomp_fingerprint: null,
  };
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, name, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRow as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const spaceName = (spaceRow as Space).name;

  // synthesis_data may be stored as JSON string or parsed object
  // depending on the driver; handle both safely.
  let synthesis: SynthesisData | null = null;
  const raw = (spaceRow as unknown as { synthesis_data?: unknown })
    .synthesis_data ?? null;
  if (raw && typeof raw === "object") {
    synthesis = raw as SynthesisData;
  } else if (typeof raw === "string") {
    try {
      synthesis = JSON.parse(raw) as SynthesisData;
    } catch {
      synthesis = null;
    }
  }

  if (!synthesis) {
    return NextResponse.json(emptySummary(spaceName));
  }

  const payload: InsightsSummaryResponse = {
    synthesized_at:
      (synthesis as unknown as { synthesized_at?: string | null }).synthesized_at ??
      null,
    space_name: spaceName,
    leverage_points: synthesis.leverage_points ?? [],
    risk_points: synthesis.risk_points ?? [],
    master_bottleneck: synthesis.master_bottleneck ?? null,
    feedback_loops: synthesis.feedback_loops ?? [],
    scenarios: synthesis.scenarios ?? [],
    discovered_connections: synthesis.discovered_connections ?? [],
    open_questions: synthesis.open_questions ?? [],
    contradictions: synthesis.contradictions ?? [],
    strategic_recommendation: synthesis.strategic_recommendation ?? null,
    decomp_fingerprint:
      (synthesis as unknown as { decomp_fingerprint?: string | null })
        .decomp_fingerprint ?? null,
  };
  return NextResponse.json(payload);
}
