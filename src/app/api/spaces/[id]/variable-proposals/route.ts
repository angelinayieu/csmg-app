// GET /api/spaces/[id]/variable-proposals
//
// Returns all VariableProposal rows for this space with optional filters.
// Drives the +Variable button counter (count where status='proposed') and
// the VariableProposalsPanel review UI (full list, grouped by role).
//
// Query params:
//   ?status=proposed | approved | rejected | superseded   (default: all)
//   ?role=independent | dependent | controlled | confounding |
//         outcome | mediator | modifier | instrument | condition |
//         unclassified                                   (optional)
//   ?source=llm | manual                                  (optional)
//   ?latest_only=true                                     (default: true — only the
//                                                          most recent
//                                                          source_strategy_version's
//                                                          proposals plus all manual)
//
// Always scoped to the authenticated user via RLS + explicit user_id check.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type {
  VariableProposal,
  VariableProposalStatus,
  VariableRole,
  VariableProposalSource,
} from "@/types/variable-proposals";

export const dynamic = "force-dynamic";

interface VariableProposalsResponse {
  proposals: VariableProposal[];
  /** Counts per status — convenient for the +Variable button counter. */
  counts: {
    proposed: number;
    approved: number;
    rejected: number;
    superseded: number;
    total: number;
  };
  /** Counts per role (across non-rejected). Lets the panel render
   *  role-grouped tabs without a second pass. */
  by_role: Partial<Record<VariableRole, number>>;
  /** Latest source_strategy_version present for LLM proposals; null when
   *  no LLM proposals exist. UI uses this to render "as of strategy v3". */
  latest_strategy_version: number | null;
}

const VALID_STATUS = new Set<VariableProposalStatus>([
  "proposed",
  "approved",
  "rejected",
  "superseded",
]);

const VALID_ROLE = new Set<VariableRole>([
  "independent",
  "dependent",
  "controlled",
  "confounding",
  "outcome",
  "mediator",
  "modifier",
  "instrument",
  "condition",
  "unclassified",
]);

const VALID_SOURCE = new Set<VariableProposalSource>(["llm", "manual"]);

export async function GET(
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const roleParam = url.searchParams.get("role");
  const sourceParam = url.searchParams.get("source");
  const latestOnlyRaw = url.searchParams.get("latest_only");
  const latestOnly = latestOnlyRaw === null ? true : latestOnlyRaw !== "false";

  // Build query.
  let query = db
    .from("variable_proposals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false });

  if (statusParam && VALID_STATUS.has(statusParam as VariableProposalStatus)) {
    query = query.eq("user_status", statusParam);
  }
  if (roleParam && VALID_ROLE.has(roleParam as VariableRole)) {
    query = query.eq("variable_role", roleParam);
  }
  if (sourceParam && VALID_SOURCE.has(sourceParam as VariableProposalSource)) {
    query = query.eq("proposed_by", sourceParam);
  }

  const { data, error } = (await query) as {
    data: VariableProposal[] | null;
    error: { message: string } | null;
  };

  if (error) {
    return NextResponse.json(
      { error: "Failed to load variable proposals", detail: error.message },
      { status: 500 },
    );
  }

  let proposals = data ?? [];

  // Determine the latest strategy version among LLM proposals BEFORE the
  // optional latest_only filter — so the response always reflects the
  // canonical version even when filtered.
  const llmVersions = proposals
    .filter((p) => p.proposed_by === "llm" && p.source_strategy_version !== null)
    .map((p) => p.source_strategy_version as number);
  const latest_strategy_version =
    llmVersions.length > 0 ? Math.max(...llmVersions) : null;

  if (latestOnly && latest_strategy_version !== null) {
    proposals = proposals.filter((p) => {
      // Keep manual proposals always — they don't carry a strategy version.
      if (p.proposed_by === "manual") return true;
      return p.source_strategy_version === latest_strategy_version;
    });
  }

  // Build summary counts off the filtered list (so the UI's counter
  // reflects what the user is actually browsing).
  const counts = {
    proposed: 0,
    approved: 0,
    rejected: 0,
    superseded: 0,
    total: proposals.length,
  };
  const by_role: Partial<Record<VariableRole, number>> = {};
  for (const p of proposals) {
    counts[p.user_status]++;
    if (p.user_status !== "rejected") {
      by_role[p.variable_role] = (by_role[p.variable_role] ?? 0) + 1;
    }
  }

  const payload: VariableProposalsResponse = {
    proposals,
    counts,
    by_role,
    latest_strategy_version,
  };
  return NextResponse.json(payload);
}
