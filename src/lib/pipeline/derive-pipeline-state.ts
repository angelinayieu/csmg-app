// Derive live pipeline state for a space.
//
// Single shared implementation used by both the API endpoint
// (/api/spaces/[id]/pipeline-state) and the server-rendered timeline
// page (/app/space/[id]/timeline). Extracting it avoids the server
// page paying an extra HTTP roundtrip to its own API.
//
// Maps each of the 12 operational phases (matching the PHASES array
// in src/app/preflight/cognition/operational-timeline.tsx) to a
// PhaseStatus by inspecting the table rows the phase is responsible
// for writing. All queries soft-fail to `pending` so a missing table
// row never throws.
//
// Verified against the live Supabase schema (2026-05-15):
//   • pipeline_runs uses columns `pipeline` (text) + `status` (text)
//     — NOT `stage`. Values:
//        pipeline ∈ {intake_bootstrap, decompose, research,
//                    plan_propose, strategy_refresh}
//        status   ∈ {completed, failed, running}
//   • probability_space_runs.status ∈ {merged, pending} (no 'scored')
//   • lab_scaffolds.status ∈ {scaffolded}
//   • prediction_ledger.resolved_at IS NOT NULL gates calibration
//   • pipeline_run_events.event_type = 'stage_boundary' for stage
//     transition markers (not stage_started/stage_completed)

export type PhaseStatus = "completed" | "running" | "pending" | "failed";

export interface PhaseLiveState {
  /** Ordinal of the phase (1-12), matches PHASES[].ordinal in the
   *  OperationalTimeline component. */
  ordinal: number;
  status: PhaseStatus;
  /**
   * What row(s) we looked at to derive the status. Useful for
   * debugging and for telemetry. The UI uses this to show a tiny
   * tooltip on the pill explaining "why is this phase still pending?".
   */
  signal: {
    /** The table/column or JSONB key we inspected. */
    source: string;
    /** The observed value (status string, count, etc.). */
    value: string;
    /** When the most-recent observable transition happened, ISO. */
    timestamp: string | null;
  };
  /** Short human-readable summary for the UI (e.g. "234 entities created"). */
  detail: string;
}

export interface PipelineStateResponse {
  phases: PhaseLiveState[];
  space_id: string;
  fetched_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseSynthesis(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusFromRun(
  run: { status: string; completed_at: string | null } | null,
): PhaseStatus {
  if (!run) return "pending";
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  if (run.status === "running") return "running";
  return "pending";
}

// ── Main entry ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function derivePipelineState(db: any, spaceId: string): Promise<PhaseLiveState[]> {
  // Parallel fetch of every signal we need. Each query is bounded
  // (counts, limit-1, or scoped by status filter) so this fan-out
  // stays cheap even on long-lived spaces.
  const [
    spaceRes,
    runsRes,
    probMergedRes,
    probPendingRes,
    entCountRes,
    twinPropRes,
    appsCountRes,
    labRes,
    subjCountRes,
    predCountRes,
    predResolvedRes,
    pairwiseCountRes,
    mechCountRes,
  ] = await Promise.all([
    db
      .from("spaces")
      .select("created_at, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("pipeline_runs")
      .select("pipeline, status, started_at, completed_at")
      .eq("space_id", spaceId)
      .order("started_at", { ascending: false }),
    db
      .from("probability_space_runs")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .eq("status", "merged"),
    db
      .from("probability_space_runs")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .eq("status", "pending"),
    db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("twin_proposals")
      .select("user_status, created_at, approved_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("apps")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("lab_scaffolds")
      .select("status, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("subjects")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("prediction_ledger")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("prediction_ledger")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .not("resolved_at", "is", null),
    db
      .from("pairwise_connection_checks")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
    db
      .from("mechanisms")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId),
  ]);

  const space = (spaceRes.data ?? null) as {
    created_at: string;
    synthesis_data: unknown;
  } | null;
  const synth = parseSynthesis(space?.synthesis_data ?? null);
  const runs = (runsRes.data ?? []) as Array<{
    pipeline: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }>;
  const probMerged = probMergedRes.count ?? 0;
  const probPending = probPendingRes.count ?? 0;
  const entCount = entCountRes.count ?? 0;
  const twinProp =
    (twinPropRes.data as {
      user_status: string;
      created_at: string;
      approved_at: string | null;
    } | null) ?? null;
  const appsCount = appsCountRes.count ?? 0;
  const lab =
    (labRes.data as { status: string; created_at: string } | null) ?? null;
  const subjCount = subjCountRes.count ?? 0;
  const predCount = predCountRes.count ?? 0;
  const predResolved = predResolvedRes.count ?? 0;
  const pairwiseCount = pairwiseCountRes.count ?? 0;
  const mechCount = mechCountRes.count ?? 0;

  const latestRun = (name: string) =>
    runs.find((r) => r.pipeline === name) ?? null;

  // ── Phase 1: Intake ─────────────────────────────────────────────────
  // The space row existing already implies intake fired. We still
  // prefer the explicit pipeline_runs row when present (gives a real
  // timestamp + lets us surface a failed-intake state if it happens).
  const intakeRun = latestRun("intake_bootstrap");
  const phase1: PhaseLiveState = {
    ordinal: 1,
    status: intakeRun
      ? statusFromRun(intakeRun)
      : space
        ? "completed"
        : "pending",
    signal: {
      source: "pipeline_runs.intake_bootstrap",
      value: intakeRun?.status ?? (space ? "(space exists)" : "(no row)"),
      timestamp: intakeRun?.completed_at ?? space?.created_at ?? null,
    },
    detail: space
      ? `Space materialized · ${relTime(space.created_at)}`
      : "Intake hasn't fired",
  };

  // ── Phase 2: Frame Extraction ───────────────────────────────────────
  // probability_space_runs are inserted as 'pending' by the frame
  // extractor itself, so the existence of any row (merged OR pending)
  // tells us the frame extractor at least started. 'merged' rows
  // mean the per-axis runner has finished scoring that axis.
  const probTotal = probMerged + probPending;
  const phase2: PhaseLiveState = {
    ordinal: 2,
    status:
      probTotal === 0
        ? "pending"
        : probMerged === probTotal
          ? "completed"
          : "completed", // frame extraction itself is done once shells exist
    signal: {
      source: "probability_space_runs (merged|pending)",
      value: `${probMerged} merged / ${probPending} pending`,
      timestamp: null,
    },
    detail:
      probTotal === 0
        ? "No axes selected yet"
        : `${probTotal} axes proposed (${probMerged} scored, ${probPending} in flight)`,
  };

  // ── Phase 3: Per-Axis Generation ────────────────────────────────────
  // Each axis fans out to its own LLM run. Completion = all axes
  // moved to 'merged'. Mixed = still running. Zero = pending.
  const phase3: PhaseLiveState = {
    ordinal: 3,
    status:
      probTotal === 0
        ? "pending"
        : probPending > 0
          ? "running"
          : "completed",
    signal: {
      source: "probability_space_runs.status",
      value:
        probTotal === 0
          ? "(no axes)"
          : `${probMerged} / ${probTotal} merged`,
      timestamp: null,
    },
    detail:
      probTotal === 0
        ? "Waiting on frame extraction"
        : probPending > 0
          ? `${probPending} axes still scoring`
          : `${probMerged} axes scored`,
  };

  // ── Phase 4: Decompose ──────────────────────────────────────────────
  // Two signals: pipeline_runs.decompose AND the actual entity count.
  // Prefer the pipeline_runs row (gives status + timestamp); fall
  // back to entity count when it's missing (some older runs predate
  // the pipeline_runs scaffolding).
  const decomposeRun = latestRun("decompose");
  const phase4: PhaseLiveState = {
    ordinal: 4,
    status: decomposeRun
      ? statusFromRun(decomposeRun)
      : entCount > 0
        ? "completed"
        : "pending",
    signal: {
      source: "pipeline_runs.decompose · entities count",
      value: decomposeRun
        ? `${decomposeRun.status} · ${entCount} entities`
        : `${entCount} entities`,
      timestamp: decomposeRun?.completed_at ?? null,
    },
    detail:
      entCount > 0
        ? `${entCount} entities in graph · ${relTime(decomposeRun?.completed_at)}`
        : "KG hasn't been built yet",
  };

  // ── Phase 5: Synthesize ─────────────────────────────────────────────
  // Synthesis writes its outputs into spaces.synthesis_data JSONB.
  // We check for any of the canonical synthesis keys (bottlenecks,
  // leverage_points, master_bottleneck, risk_points) — if at least
  // one is populated, synthesis ran.
  const synthKeys =
    synth && typeof synth === "object"
      ? [
          "bottlenecks",
          "leverage_points",
          "master_bottleneck",
          "risk_points",
          "feedback_loops",
        ].filter((k) => {
          const v = (synth as Record<string, unknown>)[k];
          if (v == null) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        })
      : [];
  const phase5: PhaseLiveState = {
    ordinal: 5,
    status:
      synthKeys.length > 0
        ? "completed"
        : entCount > 0
          ? "running"
          : "pending",
    signal: {
      source: "spaces.synthesis_data",
      value:
        synthKeys.length > 0
          ? synthKeys.join(", ")
          : entCount > 0
            ? "(awaiting synth)"
            : "(no kg)",
      timestamp: null,
    },
    detail:
      synthKeys.length > 0
        ? `${synthKeys.length} insight pools populated`
        : entCount > 0
          ? "KG built — synthesizing now"
          : "Waiting on decompose",
  };

  // ── Phase 6: Strategy Refresh ───────────────────────────────────────
  // pipeline_runs.strategy_refresh is the canonical signal.
  // twin_proposals existing is the fallback (strategy-refresh writes
  // a twin_proposal row as part of its work).
  const strategyRun = latestRun("strategy_refresh");
  const phase6: PhaseLiveState = {
    ordinal: 6,
    status: strategyRun
      ? statusFromRun(strategyRun)
      : twinProp
        ? "completed"
        : synthKeys.length > 0
          ? "running"
          : "pending",
    signal: {
      source: "pipeline_runs.strategy_refresh · twin_proposals",
      value: strategyRun
        ? `${strategyRun.status}`
        : twinProp
          ? "twin_proposal present"
          : "(no signal)",
      timestamp: strategyRun?.completed_at ?? twinProp?.created_at ?? null,
    },
    detail: twinProp
      ? `Strategy + twin proposal ready · ${relTime(twinProp.created_at)}`
      : "Waiting on synthesis",
  };

  // ── Phase 7: App Materialization ────────────────────────────────────
  // apps.count > 0 = materialized. Apps fire from strategy-refresh's
  // after() chain so they typically appear seconds after the twin
  // proposal lands.
  const phase7: PhaseLiveState = {
    ordinal: 7,
    status:
      appsCount > 0
        ? "completed"
        : twinProp
          ? "running"
          : "pending",
    signal: {
      source: "apps (count)",
      value: `${appsCount}`,
      timestamp: null,
    },
    detail:
      appsCount > 0
        ? `${appsCount} app${appsCount === 1 ? "" : "s"} materialized`
        : twinProp
          ? "Strategy ready — apps spinning up"
          : "Waiting on strategy refresh",
  };

  // ── Phase 8: Approve Twin Proposal ──────────────────────────────────
  // User-gate. Status follows twin_proposals.user_status directly.
  // 'approved' → completed. 'proposed' → pending (waiting for user).
  // 'rejected' → failed.
  const userStatus = twinProp?.user_status ?? null;
  const phase8: PhaseLiveState = {
    ordinal: 8,
    status:
      userStatus === "approved"
        ? "completed"
        : userStatus === "rejected"
          ? "failed"
          : userStatus === "proposed"
            ? "pending"
            : "pending",
    signal: {
      source: "twin_proposals.user_status",
      value: userStatus ?? "(no proposal)",
      timestamp: twinProp?.approved_at ?? null,
    },
    detail:
      userStatus === "approved"
        ? `Approved · ${relTime(twinProp?.approved_at)} · ${mechCount} mechanisms`
        : userStatus === "rejected"
          ? "Proposal was rejected"
          : userStatus === "proposed"
            ? "⏸ Awaiting your review"
            : "No twin proposal yet",
  };

  // ── Phase 9: Lab Scaffold + Subjects ────────────────────────────────
  // lab_scaffolds existing = scaffold proposed. subjects.count > 0
  // = approved (subjects only materialize on scaffold-approve).
  const phase9: PhaseLiveState = {
    ordinal: 9,
    status:
      subjCount > 0
        ? "completed"
        : lab
          ? "pending" // scaffold proposed, awaiting user approval
          : userStatus === "approved"
            ? "pending"
            : "pending",
    signal: {
      source: "lab_scaffolds.status · subjects (count)",
      value: lab
        ? `${lab.status} · ${subjCount} subjects`
        : `(no scaffold) · ${subjCount} subjects`,
      timestamp: lab?.created_at ?? null,
    },
    detail:
      subjCount > 0
        ? `${subjCount} subjects materialized`
        : lab
          ? "⏸ Scaffold proposed — approve to materialize subjects"
          : userStatus === "approved"
            ? "Ready to propose scaffold"
            : "Waiting on twin approval",
  };

  // ── Phase 10: Trajectory + Lab Run ──────────────────────────────────
  // prediction_ledger rows mean either /api/trajectory/project ran
  // or an app fired a prediction. Both count toward "lab activity".
  const phase10: PhaseLiveState = {
    ordinal: 10,
    status:
      predCount > 0
        ? "completed"
        : subjCount > 0
          ? "pending"
          : "pending",
    signal: {
      source: "prediction_ledger (count)",
      value: `${predCount}`,
      timestamp: null,
    },
    detail:
      predCount > 0
        ? `${predCount} prediction${predCount === 1 ? "" : "s"} recorded`
        : subjCount > 0
          ? "Subjects ready — run trajectory or fire apps"
          : "Waiting on lab scaffold",
  };

  // ── Phase 11: Post-Approval Calibration ─────────────────────────────
  // prediction_ledger.resolved_at IS NOT NULL = user submitted an
  // actual outcome and we resolved the prediction.
  const phase11: PhaseLiveState = {
    ordinal: 11,
    status:
      predResolved > 0
        ? "completed"
        : predCount > 0
          ? "pending"
          : "pending",
    signal: {
      source: "prediction_ledger.resolved_at",
      value: `${predResolved} / ${predCount} resolved`,
      timestamp: null,
    },
    detail:
      predResolved > 0
        ? `${predResolved} of ${predCount} predictions resolved`
        : predCount > 0
          ? "⏸ Waiting for actual outcomes"
          : "No predictions to calibrate",
  };

  // ── Phase 12: Reflexive Loop + Auto-Propose ─────────────────────────
  // pairwise_connection_checks rows = the prospector has run at
  // least once. Hard to detect auto-propose specifically; we use
  // prospector activity as a proxy.
  const phase12: PhaseLiveState = {
    ordinal: 12,
    status:
      pairwiseCount > 0
        ? "completed"
        : predResolved > 0
          ? "pending"
          : "pending",
    signal: {
      source: "pairwise_connection_checks (count)",
      value: `${pairwiseCount}`,
      timestamp: null,
    },
    detail:
      pairwiseCount > 0
        ? `${pairwiseCount} pairwise checks logged`
        : predResolved > 0
          ? "Drift signals ready — click Scan in proposal room"
          : "Awaiting calibration data",
  };

  return [
    phase1,
    phase2,
    phase3,
    phase4,
    phase5,
    phase6,
    phase7,
    phase8,
    phase9,
    phase10,
    phase11,
    phase12,
  ];
}
