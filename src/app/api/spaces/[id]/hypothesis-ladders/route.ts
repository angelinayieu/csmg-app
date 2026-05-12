// GET /api/spaces/[id]/hypothesis-ladders
//
// Returns hypothesis ladder rows for this space + summary counts the UI
// uses to badge the canvas (e.g., "3 pending claims" / "1 refuted").
//
// Query params:
//   ?status=active|archived|superseded   (default: active)
//   ?verdict=pending|supported|refuted|contested   (optional)
//   ?source=llm|manual                   (optional)
//   ?latest_only=true                    (default true — only the most
//                                          recent strategy version's
//                                          ladders + all manual)

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type {
  HypothesisLadder,
  HypothesisLadderStatus,
  HypothesisLadderVerdict,
  HypothesisLadderSource,
} from "@/types/hypothesis-ladders";

export const dynamic = "force-dynamic";

interface HypothesisLaddersResponse {
  ladders: HypothesisLadder[];
  counts: {
    pending: number;
    supported: number;
    refuted: number;
    contested: number;
    total: number;
  };
  /** Latest source_strategy_version present for LLM ladders; null when
   *  no LLM ladders exist. UI uses this to render "as of strategy v3". */
  latest_strategy_version: number | null;
}

const VALID_STATUS = new Set<HypothesisLadderStatus>([
  "active",
  "archived",
  "superseded",
]);

const VALID_VERDICT = new Set<HypothesisLadderVerdict>([
  "pending",
  "supported",
  "refuted",
  "contested",
]);

const VALID_SOURCE = new Set<HypothesisLadderSource>(["llm", "manual"]);

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
  const verdictParam = url.searchParams.get("verdict");
  const sourceParam = url.searchParams.get("source");
  const latestOnlyRaw = url.searchParams.get("latest_only");
  const latestOnly = latestOnlyRaw === null ? true : latestOnlyRaw !== "false";

  // Default filter: active rows only — archived/superseded ladders are
  // audit-only, not surfaced unless the caller asks. Mirrors the
  // variable-proposals endpoint's pending-default behavior.
  const effectiveStatus =
    statusParam && VALID_STATUS.has(statusParam as HypothesisLadderStatus)
      ? statusParam
      : "active";

  let query = db
    .from("hypothesis_ladders")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("user_status", effectiveStatus)
    .order("generated_at", { ascending: false });

  if (
    verdictParam &&
    VALID_VERDICT.has(verdictParam as HypothesisLadderVerdict)
  ) {
    query = query.eq("verdict", verdictParam);
  }
  if (
    sourceParam &&
    VALID_SOURCE.has(sourceParam as HypothesisLadderSource)
  ) {
    query = query.eq("source", sourceParam);
  }

  const { data, error } = (await query) as {
    data: HypothesisLadder[] | null;
    error: { message: string } | null;
  };

  if (error) {
    return NextResponse.json(
      { error: "Failed to load hypothesis ladders", detail: error.message },
      { status: 500 },
    );
  }

  let ladders = data ?? [];

  // Compute latest_strategy_version BEFORE the optional filter so the
  // payload always reflects canonical version even when caller filtered.
  const llmVersions = ladders
    .filter(
      (l) => l.source === "llm" && l.source_strategy_version !== null,
    )
    .map((l) => l.source_strategy_version as number);
  const latest_strategy_version =
    llmVersions.length > 0 ? Math.max(...llmVersions) : null;

  if (latestOnly && latest_strategy_version !== null) {
    ladders = ladders.filter((l) => {
      // Manual ladders always retained (no strategy version anchor).
      if (l.source === "manual") return true;
      return l.source_strategy_version === latest_strategy_version;
    });
  }

  const counts = {
    pending: 0,
    supported: 0,
    refuted: 0,
    contested: 0,
    total: ladders.length,
  };
  for (const l of ladders) {
    counts[l.verdict]++;
  }

  const payload: HypothesisLaddersResponse = {
    ladders,
    counts,
    latest_strategy_version,
  };
  return NextResponse.json(payload);
}
