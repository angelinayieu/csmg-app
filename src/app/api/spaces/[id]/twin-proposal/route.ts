// GET /api/spaces/[id]/twin-proposal
//   Returns the latest twin_proposal for this space, with linked mechanisms.
//   Falls back to extracting one on-the-fly from synthesis_data when no row
//   has been generated yet (lets the UI render against legacy strategies
//   before PR 3b wires the generator to write proposals natively).
//
// POST /api/spaces/[id]/twin-proposal
//   Body: { justification, mechanism_ids?, source_strategy_version? }
//   Creates a new proposal (used by the strategy generator post-gen).
//   Owner-only via RLS.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import { extractTwinProposalFromStrategy } from "@/lib/pipeline/extract-twin-proposal";
import type {
  TwinProposalJustification,
  StrategicRecommendation,
  MechanismRow,
  RankedStrategy,
} from "@/types/strategy";

export const maxDuration = 15;

/**
 * Flattened hero-bar-friendly shape. The full `RankedStrategy` carries
 * the entire StrategicRecommendation; the hero bar only needs five
 * fields to render a 340px card. Extracting here on the server avoids
 * shipping ~10kb of strategy detail to the client per row, and keeps
 * the bar's render logic narrow.
 */
export interface RankedStrategyEntry {
  rank: number;
  title: string;
  summary: string;
  confidence: number | null;
  /** Raw posture value from StrategicRecommendation.strategic_posture.
   *  Hero bar's POSTURE_LABEL/POSTURE_ACCENT maps fall back gracefully
   *  for vocabulary not in their tables. */
  posture: string;
}

interface TwinProposalRow {
  id: string;
  space_id: string;
  user_id: string;
  justification: TwinProposalJustification;
  mechanism_ids: string[];
  source_strategy_version: number | null;
  user_status: "proposed" | "refined" | "approved" | "rejected";
  generated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  refinement_constraint: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface TwinProposalResponse {
  proposal: TwinProposalRow | null;
  /** Set when no row exists yet but we extracted one from synthesis_data. */
  proposal_extracted: TwinProposalJustification | null;
  /** Mechanisms referenced by proposal.mechanism_ids (or all mechanisms for the
   *  space when proposal is null — gives the UI something to show). */
  mechanisms: MechanismRow[];
  /** True when the response is built from extracted (non-persisted) data. */
  is_extracted: boolean;
  /**
   * Top-N ranked strategies, flattened to hero-bar-friendly shape.
   *
   * Read from `space.synthesis_data.strategic_recommendation.ranked_strategies`
   * — the canonical source. The audit
   * (docs/KG_DEPTH_CRITIQUE.md) found that strategy-hero-bar previously
   * read `proposal.justification.ranked`, a field that DOES NOT EXIST
   * in TwinProposalJustification. As a result the bar always fell
   * through to single-strategy mode, breaking the T1.1 "top-N
   * side-by-side" feature. Extracting here at the route level (rather
   * than in extractTwinProposalFromStrategy) keeps the persisted
   * justification shape unchanged while giving the bar a stable read.
   *
   * Empty array when no synthesis_data exists yet OR when the
   * recommendation has no ranked_strategies field (single-strategy
   * runs — the bar's fallback handles those by rendering one card).
   */
  ranked_strategies: RankedStrategyEntry[];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Latest persisted proposal (most-recent generated_at).
  const { data: proposal } = (await db
    .from("twin_proposals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: TwinProposalRow | null };

  // Linked mechanisms — by IDs when proposal exists, else all space mechanisms.
  let mechanisms: MechanismRow[] = [];
  if (proposal && proposal.mechanism_ids.length > 0) {
    const { data: mechs } = (await db
      .from("mechanisms")
      .select("*")
      .in("id", proposal.mechanism_ids)) as { data: MechanismRow[] | null };
    mechanisms = mechs ?? [];
  } else {
    const { data: mechs } = (await db
      .from("mechanisms")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true })) as { data: MechanismRow[] | null };
    mechanisms = mechs ?? [];
  }

  // ALWAYS fetch synthesis_data — needed for both the legacy
  // extraction-when-no-proposal path AND for the new
  // ranked_strategies extraction (which the strategy-hero-bar reads
  // regardless of whether a persisted proposal exists). Single read
  // covers both.
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { synthesis_data: Record<string, unknown> | null } | null;
  };
  const stratWrap = spaceRow?.synthesis_data?.strategic_recommendation as
    | { recommendation?: StrategicRecommendation; ranked_strategies?: RankedStrategy[] }
    | StrategicRecommendation
    | undefined;
  const strategy =
    (stratWrap as { recommendation?: StrategicRecommendation })?.recommendation
    ?? (stratWrap as StrategicRecommendation | undefined);
  const rawRanked =
    (stratWrap as { ranked_strategies?: RankedStrategy[] })?.ranked_strategies
    ?? null;

  // Flatten to hero-bar-friendly entries. Sort by rank ascending so
  // #1 is always first (defensive — strategy-engine sorts already
  // but the data path crosses JSONB serialization which doesn't
  // preserve order guarantees).
  let ranked_strategies: RankedStrategyEntry[] = [];
  if (Array.isArray(rawRanked) && rawRanked.length > 0) {
    ranked_strategies = [...rawRanked]
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((entry) => {
        const rec = entry.recommendation;
        return {
          rank: typeof entry.rank === "number" ? entry.rank : 1,
          title:
            typeof rec?.title === "string" && rec.title.trim().length > 0
              ? rec.title
              : "Untitled strategy",
          summary:
            typeof rec?.summary === "string" && rec.summary.trim().length > 0
              ? rec.summary
              : entry.ranking_rationale ?? "",
          confidence:
            typeof rec?.confidence === "number" ? rec.confidence : null,
          posture:
            typeof rec?.strategic_posture === "string"
              ? rec.strategic_posture
              : "exploratory_discovery",
        };
      });
  } else if (strategy) {
    // Single-strategy fallback: synthesize wrote a recommendation but
    // didn't produce a ranked_strategies array (e.g. strategyCount=1
    // runs). Render as a one-entry batch so the hero bar still shows
    // the strategy in a card.
    ranked_strategies = [
      {
        rank: 1,
        title:
          typeof strategy.title === "string" && strategy.title.trim().length > 0
            ? strategy.title
            : "Recommended strategy",
        summary:
          typeof strategy.summary === "string" && strategy.summary.trim().length > 0
            ? strategy.summary
            : "",
        confidence:
          typeof strategy.confidence === "number" ? strategy.confidence : null,
        posture:
          typeof strategy.strategic_posture === "string"
            ? strategy.strategic_posture
            : "exploratory_discovery",
      },
    ];
  }

  // Fallback extraction when no persisted proposal exists. Reads
  // synthesis_data.strategic_recommendation and produces a structured shape
  // so the UI has something to display today.
  let extracted: TwinProposalJustification | null = null;
  if (!proposal) {
    extracted = extractTwinProposalFromStrategy(strategy ?? null);
  }

  const payload: TwinProposalResponse = {
    proposal,
    proposal_extracted: extracted,
    mechanisms,
    is_extracted: !proposal && extracted !== null,
    ranked_strategies,
  };
  return NextResponse.json(payload);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { justification, mechanism_ids, source_strategy_version } =
    (body ?? {}) as {
      justification?: TwinProposalJustification;
      mechanism_ids?: string[];
      source_strategy_version?: number;
    };

  if (!justification || typeof justification.chosen_approach !== "string") {
    return NextResponse.json(
      { error: "justification.chosen_approach is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: inserted, error } = (await db
    .from("twin_proposals")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      justification,
      mechanism_ids: mechanism_ids ?? [],
      source_strategy_version: source_strategy_version ?? null,
      user_status: "proposed",
    })
    .select("*")
    .single()) as { data: TwinProposalRow | null; error: unknown };

  if (error || !inserted) {
    console.error("[twin-proposal POST] insert failed:", error);
    return NextResponse.json({ error: "Failed to save proposal" }, { status: 500 });
  }
  return NextResponse.json({ proposal: inserted });
}
