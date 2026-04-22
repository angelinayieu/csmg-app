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
} from "@/types/strategy";

export const maxDuration = 15;

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

  // Fallback extraction when no persisted proposal exists. Reads
  // synthesis_data.strategic_recommendation and produces a structured shape
  // so the UI has something to display today.
  let extracted: TwinProposalJustification | null = null;
  if (!proposal) {
    const { data: spaceRow } = (await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .eq("user_id", user.id)
      .maybeSingle()) as {
      data: { synthesis_data: Record<string, unknown> | null } | null;
    };
    const stratWrap = spaceRow?.synthesis_data?.strategic_recommendation as
      | { recommendation?: StrategicRecommendation }
      | StrategicRecommendation
      | undefined;
    const strategy =
      (stratWrap as { recommendation?: StrategicRecommendation })?.recommendation
      ?? (stratWrap as StrategicRecommendation | undefined);
    extracted = extractTwinProposalFromStrategy(strategy ?? null);
  }

  const payload: TwinProposalResponse = {
    proposal,
    proposal_extracted: extracted,
    mechanisms,
    is_extracted: !proposal && extracted !== null,
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
