// ── GET /api/strategy-lab/status?runId=… ──────────────────────────────
//
// Polling endpoint for the Strategy Lab live view. Reconstructs the
// 4-stage timeline from the run's persisted events (deterministic,
// idempotent) and returns the run status + latest twin proposal.
//
// We poll this instead of holding a long-lived SSE connection — the
// SSE/EventSource path proved fragile under React StrictMode double-
// mounts + dev HMR (connections aborted before the backlog finished
// replaying, leaving every stage stuck on "queued"). A short JSON poll
// every couple seconds is immune to remounts: each request rebuilds the
// full state from scratch.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { extractTwinProposalFromStrategy } from "@/lib/pipeline/extract-twin-proposal";
import type { StrategicRecommendation } from "@/types/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StageId = "setup" | "kg" | "refine" | "evidence" | "proposal" | "twin";
type StageStatus = "queued" | "running" | "ok" | "failed" | "skipped";

interface StageView {
  id: StageId;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  detailLines: string[];
}

const STAGE_ORDER: StageId[] = [
  "setup",
  "kg",
  "refine",
  "evidence",
  "proposal",
  "twin",
];

function mapStage(stage: unknown): StageId | null {
  if (stage === "intake") return "setup";
  if (stage === "kg") return "kg";
  if (stage === "landscape") return "refine";
  if (stage === "lab") return "evidence";
  if (stage === "proposal") return "proposal";
  if (stage === "twin") return "twin";
  return null;
}

export async function GET(request: NextRequest) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  // Run row (ownership + status)
  const { data: run } = (await db
    .from("pipeline_runs")
    .select("id, space_id, status, created_by, started_at, error_message")
    .eq("id", runId)
    .maybeSingle()) as {
    data: {
      id: string;
      space_id: string;
      status: string;
      created_by: string;
      started_at: string;
      error_message: string | null;
    } | null;
  };

  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.created_by !== user.id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Events — full ordered list; we rebuild stage state from scratch.
  const { data: eventRows } = (await db
    .from("pipeline_run_events")
    .select("sequence, emitted_at, payload")
    .eq("run_id", runId)
    .order("sequence", { ascending: true })) as {
    data: Array<{
      sequence: number;
      emitted_at: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: any;
    }> | null;
  };

  // Initialize stages
  const stages: Record<StageId, StageView> = {
    setup: { id: "setup", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
    kg: { id: "kg", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
    refine: { id: "refine", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
    evidence: { id: "evidence", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
    proposal: { id: "proposal", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
    twin: { id: "twin", status: "queued", startedAt: null, finishedAt: null, summary: null, detailLines: [] },
  };

  for (const row of eventRows ?? []) {
    const ev = row.payload;
    if (!ev || typeof ev !== "object") continue;

    if (ev.type === "stage_boundary") {
      const sid = mapStage(ev.stage);
      if (!sid) continue;
      const message: string = typeof ev.message === "string" ? ev.message : "";
      if (ev.phase === "enter") {
        stages[sid].status = "running";
        stages[sid].startedAt = row.emitted_at;
        if (message) stages[sid].detailLines.push(`▶ ${message}`);
      } else if (ev.phase === "exit") {
        const failed = /FAILED/i.test(message);
        const skipped = /Skipped/i.test(message);
        stages[sid].status = skipped ? "skipped" : failed ? "failed" : "ok";
        stages[sid].finishedAt = row.emitted_at;
        stages[sid].summary = message;
        stages[sid].detailLines.push(
          `${skipped ? "⊘" : failed ? "✕" : "✓"} ${message}`,
        );
      }
    } else if (ev.type === "reasoning_chunk" && ev.phase === "complete") {
      const sid = mapStage(ev.stage);
      const text: string = typeof ev.textSoFar === "string" ? ev.textSoFar : "";
      if (sid && text) {
        stages[sid].summary = stages[sid].summary ?? text;
        stages[sid].detailLines.push(text);
      }
    } else if (ev.type === "asset_added") {
      stages.setup.detailLines.push(
        `📄 ${ev.sourceName ?? "asset"} (${ev.assetClass ?? "?"}, ${ev.charCount ?? 0} chars)`,
      );
    }
  }

  // Sequential invariant: orchestrator runs stages strictly in order, so
  // if a later stage has started/finished, any earlier stage still
  // showing "running" must have completed (covers a dropped exit event).
  for (let i = STAGE_ORDER.length - 1; i >= 1; i--) {
    const later = stages[STAGE_ORDER[i]];
    if (later.status !== "queued") {
      for (let j = 0; j < i; j++) {
        const earlier = stages[STAGE_ORDER[j]];
        if (earlier.status === "running") {
          earlier.status = "ok";
          earlier.finishedAt = earlier.finishedAt ?? later.startedAt;
        }
      }
    }
  }

  // If the run is terminal but some stages never started, mark trailing
  // queued stages as skipped (chain stopped before reaching them).
  if (run.status === "completed" || run.status === "failed") {
    for (const sid of STAGE_ORDER) {
      if (stages[sid].status === "running") {
        stages[sid].status = run.status === "completed" ? "ok" : "failed";
      }
    }
  }

  // ── Twin proposal / strategy resolution ──────────────────────────
  // Prefer a persisted twin_proposals row. When none exists (strategy-
  // refresh with deferApps=true generates the strategy into
  // synthesis_data but does NOT always write a twin_proposals row), fall
  // back to extracting a TwinProposalJustification from
  // synthesis_data.strategic_recommendation — exactly what the canonical
  // GET /api/spaces/[id]/twin-proposal endpoint does. This is why an
  // earlier version wrongly reported "no strategy" when a perfectly good
  // strategy had in fact been generated.
  const { data: tp } = (await db
    .from("twin_proposals")
    .select("id, justification, user_status, generated_at, mechanism_ids")
    .eq("space_id", run.space_id)
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: {
      id: string;
      justification: unknown;
      user_status: string;
      generated_at: string;
      mechanism_ids: string[] | null;
    } | null;
  };

  let twinProposal: {
    id: string;
    justification: unknown;
    user_status: string;
    generated_at: string;
    source: "row" | "extracted";
  } | null = tp
    ? {
        id: tp.id,
        justification: tp.justification,
        user_status: tp.user_status,
        generated_at: tp.generated_at,
        source: "row",
      }
    : null;

  let strategyGenerated = !!tp;

  if (!twinProposal) {
    const { data: spaceRow } = (await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", run.space_id)
      .maybeSingle()) as {
      data: { synthesis_data: Record<string, unknown> | null } | null;
    };
    const stratWrap = spaceRow?.synthesis_data?.strategic_recommendation as
      | { recommendation?: StrategicRecommendation }
      | StrategicRecommendation
      | undefined;
    const strategy =
      (stratWrap as { recommendation?: StrategicRecommendation })
        ?.recommendation ?? (stratWrap as StrategicRecommendation | undefined);
    if (strategy) {
      strategyGenerated = true;
      const extracted = extractTwinProposalFromStrategy(strategy);
      if (extracted) {
        twinProposal = {
          id: `extracted:${run.space_id}`,
          justification: extracted,
          user_status: "proposed",
          generated_at: run.started_at,
          source: "extracted",
        };
      }
    }
  }

  // Timestamp of the most recent event — the live view uses this to
  // detect a stalled run (status still "running" but no new events for
  // a while, e.g. the orchestrator's serverless function was killed at
  // its maxDuration). Events are ordered by sequence asc, so the last
  // row is the newest.
  const rows = eventRows ?? [];
  const lastEventAt =
    rows.length > 0 ? rows[rows.length - 1].emitted_at : run.started_at;

  return NextResponse.json({
    runStatus: run.status,
    spaceId: run.space_id,
    startedAt: run.started_at,
    lastEventAt,
    errorMessage: run.error_message,
    strategyGenerated,
    stages: STAGE_ORDER.map((id) => stages[id]),
    twinProposal,
  });
}
