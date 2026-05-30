"use client";

// ── Operational Timeline ─────────────────────────────────────────────
//
// A clean linear visualization of what actually happens, in what order,
// from "user submits prompt" through "system runs background reflexive
// loops days later". Replaces (sits below) the L0-L5 lens-grid in
// /preflight/cognition because that grid is role-categorical, not
// time-sequential — users were confused about the actual order of
// operations.
//
// Each phase row shows:
//   ① time marker (T+5s, T+60s, etc.)
//   ② phase name + accent color
//   ③ trigger (auto vs user-gate ⏸)
//   ④ what API runs
//   ⑤ what DB writes happen
//   ⑥ what canvas shapes spawn
//   ⑦ KG-growth indicator on the far right
//
// The right-edge KG-growth track is the most important honesty marker:
// it shows that the KG only meaningfully grows in Phase 4 (decompose)
// and Phase 9 (reflexive prospector). Everything between is *derivation*
// of an already-finished graph, not new graph data. Users were missing
// this — it's the source of "why doesn't the entity count change?"

import { useMemo } from "react";
import {
  ArrowRight,
  Pause,
  Sparkles,
  Database,
  Eye,
  Network,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  CircleDashed,
} from "lucide-react";
import type { PhaseLiveState, PhaseStatus } from "@/lib/pipeline/derive-pipeline-state";

/**
 * Status of each preflight card relative to the live codebase. The
 * "covers" badges in each phase are color-coded by this so the user
 * can see at a glance how much of the preflight design is real.
 */
type CardStatus = "live" | "designed" | "no-code";

interface CardCoverage {
  /** id from TEMPLATE_ARCH_CARDS */
  cardId: string;
  /** display label — short, matches the diagram card label */
  label: string;
  status: CardStatus;
  /** preflight L0-L6 layer this card belongs to, for visual grouping */
  layer: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** brief detail — what runs, what writes, or "design only" */
  detail: string;
}

interface TimelinePhase {
  ordinal: number;
  time: string;
  name: string;
  blurb: string;
  trigger: "auto" | "user_gate";
  triggerDetail: string;
  api: string;
  apiUrl?: string;
  writes: string[];
  canvas: string[];
  kgGrowth: "none" | "minor" | "major";
  kgNote: string;
  /**
   * Preflight diagram cards that fire (or would fire, if designed)
   * during this phase. Lets the user trace the L0-L6 lens grid above
   * onto the time-sequential timeline below 1:1.
   */
  covers: CardCoverage[];
  accent: string; // hex
  accentBg: string;
  accentBorder: string;
}

const PHASES: TimelinePhase[] = [
  {
    ordinal: 1,
    time: "T+0",
    name: "Intake",
    blurb: "User submits prompt or template; space + run materialize.",
    trigger: "auto",
    triggerDetail: "User input on ImmersiveHome (or /app/explore template card)",
    api: "POST /api/intake/bootstrap · POST /api/explore/create",
    apiUrl: "/api/intake/bootstrap/route.ts",
    writes: ["spaces row", "pipeline_runs row", "intake:enter event"],
    canvas: ["Empty canvas", "Redirect to /whiteboard?run=…"],
    kgGrowth: "none",
    kgNote: "no entities yet",
    covers: [
      { cardId: "template_select", label: "Template selection", status: "live", layer: 0, detail: "/app/explore gallery → POST /api/explore/create" },
      { cardId: "objective_intake", label: "Objective intake", status: "live", layer: 0, detail: "Form submission → bootstrap" },
      { cardId: "seed_materialize", label: "Seed materialize", status: "live", layer: 0, detail: "Template seed → entities/edges/interventions inserted" },
      { cardId: "edge_augmenter", label: "Edge augmenter (D11)", status: "designed", layer: 0, detail: "Async after() in /api/explore/create — auto-wires isolated entities" },
    ],
    accent: "#475569",
    accentBg: "rgba(71,85,105,0.06)",
    accentBorder: "rgba(71,85,105,0.30)",
  },
  {
    ordinal: 2,
    time: "T+5s",
    name: "Frame Extraction",
    blurb: "LLM picks 3-7 of 8 axes + names them domain-adapted.",
    trigger: "auto",
    triggerDetail: "Bootstrap's after() chain",
    api: "POST /api/pipeline/frame-extractor",
    apiUrl: "/api/pipeline/frame-extractor/route.ts",
    writes: [
      "probability_space_runs (3-7 rows, with display_name + adaptive_rationale)",
      "space_opened SSE events",
    ],
    canvas: [
      "origin-prompt-shape",
      "8 room shapes (intake → results)",
      "7 room-transition arrows",
      "3-7 probability-space-shell shapes (empty)",
    ],
    kgGrowth: "none",
    kgNote: "axes are sandboxes, not the main KG",
    covers: [
      { cardId: "ingestion_pipeline", label: "Evidence pipeline", status: "designed", layer: 0, detail: "Optional 11-stage DOI/CSV ingest via /api/pipeline/evidence-populate (manual trigger)" },
    ],
    accent: "#0891B2",
    accentBg: "rgba(8,145,178,0.06)",
    accentBorder: "rgba(8,145,178,0.30)",
  },
  {
    ordinal: 3,
    time: "T+10s",
    name: "Per-Axis Generation",
    blurb: "Each axis fans out to its own LLM with hand-authored vocab.",
    trigger: "auto",
    triggerDetail: "Frame-extractor's after() fans out",
    api: "POST /api/pipeline/probability-space/[axis] × N · POST /api/pipeline/research",
    writes: [
      "probability_space_runs (entitiesJson, edgesJson, scoreJson updated)",
      "axis_scored events",
    ],
    canvas: [
      "Shells fill with mini-graphs",
      "Score breakdowns appear",
    ],
    kgGrowth: "none",
    kgNote: "still per-axis only",
    covers: [
      { cardId: "research_orchestration", label: "Research orchestration", status: "live", layer: 0, detail: "/api/pipeline/research → domain-expert + pass-kind-dispatcher LLM passes" },
    ],
    accent: "#0891B2",
    accentBg: "rgba(8,145,178,0.04)",
    accentBorder: "rgba(8,145,178,0.20)",
  },
  {
    ordinal: 4,
    time: "T+60s",
    name: "Decompose",
    blurb: "The KG is BORN. Entities, edges, cycles, bridges all materialize.",
    trigger: "auto",
    triggerDetail: "Bootstrap's after() chain (post frame-extractor)",
    api: "POST /api/pipeline/decompose",
    writes: [
      "entities (40-200 rows)",
      "edges (50-300 rows)",
      "cycles (0-10 rows)",
      "bridges rows",
      "entity_added / edge_added / cycle_detected / bridge_formed SSE",
    ],
    canvas: [
      "kg-formation-shape (live counter)",
      "kg-node ghost cards stream in",
      "cycle-loop and bridge-link shapes",
    ],
    kgGrowth: "major",
    kgNote: "0 → ~200 entities · this is the growth event",
    covers: [
      { cardId: "synthesis_decomp", label: "Synthesis decomp", status: "live", layer: 0, detail: "Decompose → entities/edges/reactions" },
      { cardId: "kg_graph", label: "Layered DAG (full)", status: "live", layer: 1, detail: "L0→L6 layered graph; reads from entities/edges" },
      { cardId: "kg_overview", label: "KG overview", status: "live", layer: 1, detail: "/api/spaces/[id]/entities/catalog — counts widget" },
      { cardId: "multi_lenses", label: "Multi-view (4 lenses)", status: "designed", layer: 1, detail: "Layered/sphere/force/matrix views — design only" },
    ],
    accent: "#10B981",
    accentBg: "rgba(16,185,129,0.10)",
    accentBorder: "rgba(16,185,129,0.40)",
  },
  {
    ordinal: 5,
    time: "T+120s",
    name: "Synthesize",
    blurb: "KG topology analyzed. Bottleneck/leverage/risk + insights produced.",
    trigger: "auto",
    triggerDetail: "Decompose completion auto-advances",
    api: "POST /api/pipeline/synthesize",
    writes: [
      "entity flags (is_master_bottleneck, is_leverage_point, is_risk_point)",
      "synthesis_data JSONB (master_bottleneck, leverage_points, risk_points, feedback_loops, findings, axioms, convergence, temporal_patterns, decay_models, recovery_models, variance_components, forest_plot)",
    ],
    canvas: [
      "synthesis-card shapes (bottleneck + leverage + risk)",
      "forest-plot shape (T4a)",
      "layer-stack-shape (T3, left edge of kg room)",
      "root-cause-tree if applicable",
      "hypothesis-ladder cards (T2)",
    ],
    kgGrowth: "none",
    kgNote: "same entities, new flags only",
    covers: [
      { cardId: "master_bottleneck", label: "Master bottleneck", status: "live", layer: 2, detail: "synthesis_data.bottlenecks" },
      { cardId: "hidden_insights", label: "Hidden insights", status: "live", layer: 3, detail: "cycles + bridges + disconnects + temporal patterns" },
      { cardId: "forest_plot", label: "Forest plot", status: "live", layer: 3, detail: "synthesis_data.forest_plot — meta-analysis viz" },
      { cardId: "hypothesis_ladders", label: "Hypothesis ladders", status: "live", layer: 3, detail: "Extracted from pre_mortem on approve (T2 in our build)" },
      { cardId: "intel_radar", label: "Intelligence radar", status: "live", layer: 5, detail: "/lib/intelligence/compute-signals — 6-axis system health" },
      { cardId: "temporal_atlas", label: "Temporal atlas", status: "designed", layer: 2, detail: "REML temporal pools — synthesis output, no dedicated viz yet" },
      { cardId: "decay_kinetics", label: "Decay kinetics", status: "designed", layer: 2, detail: "lin/exp/sus/bi models — synthesis output" },
      { cardId: "recovery_curves", label: "Recovery curves", status: "designed", layer: 2, detail: "Weibull 10c — synthesis output" },
      { cardId: "variance_decomp", label: "Variance decomp", status: "designed", layer: 3, detail: "5-source decomposition — computed but no viz" },
      { cardId: "calib_cascade", label: "Calibration cascade", status: "designed", layer: 3, detail: "7-layer SE — design only" },
      { cardId: "argument_tribunal", label: "Argument tribunal", status: "designed", layer: 3, detail: "Claim vs counter-claim — design only" },
    ],
    accent: "#10B981",
    accentBg: "rgba(16,185,129,0.04)",
    accentBorder: "rgba(16,185,129,0.20)",
  },
  {
    ordinal: 6,
    time: "T+180s",
    name: "Strategy Refresh",
    blurb: "Ranked strategies + intervention DAG + twin proposal generated.",
    trigger: "auto",
    triggerDetail: "Synthesize completion auto-advances",
    api: "POST /api/pipeline/strategy-refresh",
    writes: [
      "synthesis_data.strategic_recommendation (ranked_strategies, perspectives, micro_tactics, learning_loop, pre_mortem, infrastructure_proposals)",
      "synthesis_data.twin_quality (calibration scores)",
      "twin_proposals row (user_status='proposed')",
      "mechanisms (status='proposed')",
    ],
    canvas: [
      "strategy-hero-card (rank 1)",
      "proposal-snapshot shapes (transient)",
    ],
    kgGrowth: "none",
    kgNote: "strategy lives in JSONB; KG unchanged",
    covers: [
      { cardId: "strategy_twin", label: "Strategy + Twin proposal", status: "live", layer: 0, detail: "ranked + justified — writes twin_proposals" },
      { cardId: "twin", label: "Digital twin", status: "live", layer: 4, detail: "Forward-pass model in twin_proposals.justification" },
      { cardId: "interv_dag", label: "Intervention DAG", status: "live", layer: 2, detail: "strategies.intervention_dag — effort × impact" },
      { cardId: "action_plan", label: "Action plan", status: "live", layer: 4, detail: "4-phase plan (now/short/medium/long-term)" },
      { cardId: "dose_response", label: "Dose-response (Hill)", status: "designed", layer: 2, detail: "synthesis_data.dose_response — design only" },
      { cardId: "cycle_break_planner", label: "Cycle break planner", status: "designed", layer: 3, detail: "Lowest-cost break point — design only" },
    ],
    accent: "#D97706",
    accentBg: "rgba(217,119,6,0.06)",
    accentBorder: "rgba(217,119,6,0.30)",
  },
  {
    ordinal: 7,
    time: "T+200s",
    name: "App Materialization",
    blurb: "Strategy infrastructure_proposals → apps + tethers (pre-approval).",
    trigger: "auto",
    triggerDetail: "Strategy-refresh's after() chain",
    api: "POST /api/pipeline/generate-apps",
    apiUrl: "/api/pipeline/generate-apps/route.ts",
    writes: [
      "apps rows (one per InfrastructureProposal cluster)",
      "interventions rows",
      "app_versions rows",
      "apps.complementary_app_ids[] (tether pairs from proposal)",
    ],
    canvas: [
      "app-card shapes (lab room, transient until approved)",
      "apps_portfolio scatter (designed)",
    ],
    kgGrowth: "none",
    kgNote: "apps reference existing entity_ids; no new graph nodes",
    covers: [
      { cardId: "app_materializer", label: "App materializer", status: "live", layer: 1, detail: "1 proposal → N apps · /api/pipeline/generate-apps" },
      { cardId: "apps_portfolio", label: "Apps portfolio", status: "live", layer: 2, detail: "Priority × complexity scatter — reads apps table" },
      { cardId: "app_tether", label: "App tether (pairs)", status: "designed", layer: 2, detail: "complementary_app_ids populated during generate; pair-detection partial" },
    ],
    accent: "#D97706",
    accentBg: "rgba(217,119,6,0.04)",
    accentBorder: "rgba(217,119,6,0.20)",
  },
  {
    ordinal: 8,
    time: "T+10m",
    name: "Approve Twin Proposal",
    blurb: "User clicks Approve. 4 async writes fire via after(). Reality-calibration gate enforced.",
    trigger: "user_gate",
    triggerDetail: "User clicks Approve in strategy review (intake-review wizard)",
    api: "POST /api/spaces/[id]/twin-proposal/approve",
    writes: [
      "mechanisms.status: proposed → approved",
      "twin_proposals.proposed_spec (snapshot for diffing)",
      "variable_proposals (perspectives + tactics + indicators)",
      "hypothesis_ladders (pre_mortem entries)",
      "GATE: reality_calibrations.status checked (blocks if uncalibrated/partial)",
    ],
    canvas: [
      "twin-snapshot-shape (twin room)",
      "mechanism-card-shape × N (T1)",
      "hypothesis-ladder-shape × 4 (T2)",
      "app-card-shape × N (lab room) — promoted from transient → persistent",
      "+Variable badge updates",
    ],
    kgGrowth: "none",
    kgNote: "mechanisms reference existing entities; no new graph nodes",
    covers: [
      { cardId: "intake_review", label: "Intake review wizard", status: "live", layer: 0, detail: "4-step approve/defer; flips twin_proposals.user_status" },
      { cardId: "reality_calib", label: "Reality scoreboard", status: "live", layer: 5, detail: "reality_calibrations gates approve route — blocks if uncalibrated" },
    ],
    accent: "#475569",
    accentBg: "rgba(71,85,105,0.06)",
    accentBorder: "rgba(71,85,105,0.30)",
  },
  {
    ordinal: 9,
    time: "T+12m",
    name: "Lab Scaffold + Subjects",
    blurb: "Multi-app experiment scaffold proposed; user approves → subjects materialize.",
    trigger: "user_gate",
    triggerDetail: "Lab proposal wizard accepts; user approves scaffold",
    api: "POST /api/spaces/[id]/lab-scaffolds · POST /api/lab-scaffolds/[id]/approve",
    writes: [
      "lab_scaffolds rows (status='proposed' → 'approved')",
      "subjects rows (4 personas with conditions JSONB) on approval",
    ],
    canvas: [
      "subject-card shapes (with condition chips, T4b)",
    ],
    kgGrowth: "none",
    kgNote: "subjects reference KG entities for parameter overrides; no new entities",
    covers: [
      { cardId: "lab_scaffold", label: "Lab scaffold (assembly)", status: "designed", layer: 4, detail: "Multi-app experiments — propose live, approve→materialize subjects" },
      { cardId: "subjects", label: "Subjects (4 types)", status: "live", layer: 1, detail: "Patient profiles materialized on lab-scaffold approve" },
    ],
    accent: "#EC4899",
    accentBg: "rgba(236,72,153,0.04)",
    accentBorder: "rgba(236,72,153,0.20)",
  },
  {
    ordinal: 10,
    time: "T+20m",
    name: "Trajectory + Lab Run",
    blurb: "Monte Carlo projections; agent fleet executes apps; subject experiments fire.",
    trigger: "user_gate",
    triggerDetail: "User runs trajectory or apps fire predictions",
    api: "POST /api/trajectory/project",
    writes: [
      "prediction_ledger rows (prediction_kind=trajectory, with quantile_p10/p50/p90)",
      "subject_experiments audit log",
      "(Sprint 3) agent_runs / agent_state",
    ],
    canvas: [
      "trajectory-fan-shape × 3 (T5a)",
      "prediction-fan shape (p10/50/90 distribution)",
    ],
    kgGrowth: "none",
    kgNote: "predictions are projections, not new nodes",
    covers: [
      { cardId: "trajectory", label: "Trajectory · 37mo", status: "live", layer: 4, detail: "/api/trajectory/project — forward Monte Carlo" },
      { cardId: "prediction_fan", label: "Prediction fan", status: "live", layer: 4, detail: "p10/p50/p90 distribution, persisted in predictions" },
      { cardId: "agent_fleet", label: "Agent fleet (Sprint 3)", status: "designed", layer: 2, detail: "Autonomous ops — placeholder card, not live yet" },
      { cardId: "app_outcomes", label: "App outcomes", status: "designed", layer: 4, detail: "What each app delivered — ties to agent_fleet (Sprint 3)" },
      { cardId: "metric_observations", label: "Metric observations", status: "live", layer: 4, detail: "User/sensor outcomes — /api/metric-trackers/[id]/observations" },
    ],
    accent: "#EC4899",
    accentBg: "rgba(236,72,153,0.06)",
    accentBorder: "rgba(236,72,153,0.30)",
  },
  {
    ordinal: 11,
    time: "T+1d-7d",
    name: "Post-Approval Calibration",
    blurb: "User submits actual outcomes. Predictions resolved against reality. Edges drift.",
    trigger: "user_gate",
    triggerDetail: "User submits actual trajectory; calibration cascades",
    api: "POST /api/predictions/[id]/resolve · GET /api/lab/calibration",
    apiUrl: "/api/predictions/[id]/resolve/route.ts",
    writes: [
      "prediction_ledger.resolved_at + actual_value",
      "edge_calibrations rows (drift_direction, drift_magnitude per edge)",
      "reality_calibrations updates (baseline reproduction)",
    ],
    canvas: [
      "calib-scatter shape (designed)",
      "edge-drift heatmap (T6 — pending)",
      "reality-scoreboard widget",
    ],
    kgGrowth: "none",
    kgNote: "edge weights may shift but no new entities",
    covers: [
      { cardId: "prediction_resolver", label: "Prediction resolver", status: "live", layer: 4, detail: "actual vs p50 · path_aware_temporal_v1 algorithm" },
      { cardId: "calib_scatter", label: "Calibration scatter", status: "live", layer: 5, detail: "Predicted vs observed · /api/lab/calibration" },
      { cardId: "edge_drift", label: "Edge calib drift", status: "live", layer: 5, detail: "8 edges × 6 cycles drift heatmap" },
    ],
    accent: "#0891B2",
    accentBg: "rgba(8,145,178,0.06)",
    accentBorder: "rgba(8,145,178,0.30)",
  },
  {
    ordinal: 12,
    time: "T+1d+",
    name: "Reflexive Loop + Auto-Propose",
    blurb: "Prospector discovers edges. Drift triggers auto-proposals. KG GROWS again.",
    trigger: "user_gate",
    triggerDetail: "User clicks 'Scan now' (manual today, should be cron) · drift triggers auto-propose",
    api: "POST /api/pipeline/prospect-connections · POST /api/spaces/[id]/discovery/auto-propose",
    writes: [
      "pairwise_connection_checks (audit trail)",
      "edges (NEW rows when discovery confidence is high)",
      "twin_proposals (with discovery_source='convergent_point')",
      "loop_cycle_records (post-cycle completion)",
      "metric_observations (ongoing user/sensor data)",
    ],
    canvas: [
      "New edges between existing kg-nodes",
      "Discovery proposal cards in proposal room",
      "Loop burndown / baseline delta widgets (designed)",
    ],
    kgGrowth: "minor",
    kgNote: "ONLY OTHER PLACE the KG grows · slow continuous growth",
    covers: [
      { cardId: "discovery_auto_propose", label: "Discovery auto-propose", status: "designed", layer: 6, detail: "Drift → next cycle · /api/spaces/[id]/discovery/auto-propose (partial wiring)" },
      { cardId: "proposal_funnel", label: "Proposal intake", status: "designed", layer: 6, detail: "6-stream funnel — design-only aggregation viz" },
      { cardId: "loop_recorder", label: "Loop cycle recorder", status: "designed", layer: 5, detail: "/lib/pipeline/self-improving-loop — writes loop_cycle_records" },
      { cardId: "loop_burndown", label: "Loop burndown", status: "designed", layer: 5, detail: "Aggregation view of loop_cycle_records" },
      { cardId: "baseline_delta", label: "Baseline T0→Now", status: "designed", layer: 5, detail: "KG diff snapshot — design only" },
      { cardId: "csv_drop", label: "CSV / panel data", status: "live", layer: 0, detail: "Ongoing user data ingest · /api/metric-trackers/[id]/observations" },
      { cardId: "vuln_matrix", label: "Vulnerability matrix", status: "designed", layer: 1, detail: "7c × 8p heatmap — CSV import design only" },
      { cardId: "ref_domains", label: "Reference domains", status: "designed", layer: 1, detail: "z-score CIs — CSV import design only" },
    ],
    accent: "#0EA5E9",
    accentBg: "rgba(14,165,233,0.06)",
    accentBorder: "rgba(14,165,233,0.30)",
  },
];

const USER_GATES = [
  { afterPhase: 7, label: "User reviews strategy + apps", duration: "minutes to hours" },
  { afterPhase: 8, label: "User reviews lab proposals", duration: "session" },
  { afterPhase: 10, label: "User runs lab + waits for outcomes", duration: "days" },
  { afterPhase: 11, label: "User returns later", duration: "days to weeks" },
];

export interface OperationalTimelineProps {
  /**
   * Optional live phase state. When provided, each phase row renders
   * a status pill (done / live / pending / failed) derived from real
   * Supabase rows for a specific space. When omitted (the preflight
   * page case), no status pills render — the timeline is purely
   * informational. Keyed by ordinal (1-12).
   */
  liveState?: PhaseLiveState[];
  /**
   * When the timeline is showing live state for a real space, this
   * swaps the header copy from the generic "what actually runs"
   * pitch to a space-specific "where you are right now" framing.
   */
  variant?: "preflight" | "live";
}

export function OperationalTimeline({
  liveState,
  variant = "preflight",
}: OperationalTimelineProps = {}) {
  const stateByOrdinal = useMemo(() => {
    if (!liveState) return null;
    const m = new Map<number, PhaseLiveState>();
    for (const s of liveState) m.set(s.ordinal, s);
    return m;
  }, [liveState]);

  const isLive = variant === "live";

  return (
    <div
      id="operational-timeline"
      className="my-16 w-full max-w-[1280px] mx-auto px-4 scroll-mt-24"
    >
      {/* Header */}
      <div className="mb-8 text-center">
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-emerald-600">
          {isLive ? "↓ Where you are in the pipeline ↓" : "↓ The real operational timeline ↓"}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          {isLive ? "Live pipeline state for this space" : "What actually runs, when, and how the KG grows"}
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-500 max-w-[680px] mx-auto">
          {isLive ? (
            <>
              Each phase pill below reflects the actual rows in Supabase
              right now. <span className="font-semibold text-slate-700">Green = done</span>,
              <span className="font-semibold text-amber-700"> amber = live</span>,
              gray = pending,
              <span className="font-semibold text-rose-700"> red = failed</span>.
              Refresh the page to re-derive.
            </>
          ) : (
            <>
              The L0–L5 grid above is{" "}
              <span className="font-semibold text-slate-700">role-categorical</span>{" "}
              (where each kind of work lives) — not time-sequential. This timeline
              is the actual order: 12 phases from prompt-submit to reflexive
              background loop, with the right-edge track showing where the
              knowledge graph actually grows vs derives.
            </>
          )}
        </p>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap justify-center gap-4 text-[10.5px]">
        <LegendChip color="#10B981" label="auto-fires (no user input)" Icon={Sparkles} />
        <LegendChip color="#F59E0B" label="user-action gate" Icon={Pause} />
        <LegendChip color="#10B981" label="KG grows" Icon={Network} solid />
        <LegendChip color="#94A3B8" label="KG static (derivation only)" Icon={Eye} />
      </div>

      {/* Coverage status legend — one row, clarifies what live vs designed mean */}
      <div className="mb-8 flex flex-wrap justify-center gap-3 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>card status: <span className="font-semibold text-emerald-700">live</span> (real code path)</span>
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span><span className="font-semibold text-amber-700">designed</span> (UI exists, code partial / TBD)</span>
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
          <span><span className="font-semibold text-slate-600">no-code</span> (preflight design only)</span>
        </span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Central timeline rail */}
        <div
          aria-hidden
          className="absolute left-[88px] top-0 bottom-0 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent"
          style={{ zIndex: 0 }}
        />

        {PHASES.map((phase, i) => {
          const userGate = USER_GATES.find((g) => g.afterPhase === phase.ordinal);
          const live = stateByOrdinal?.get(phase.ordinal) ?? null;
          return (
            <div key={phase.ordinal}>
              <PhaseRow
                phase={phase}
                isLast={i === PHASES.length - 1 && !userGate}
                live={live}
              />
              {userGate && (
                <UserGateRow
                  label={userGate.label}
                  duration={userGate.duration}
                  isLast={i === PHASES.length - 1}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer summary — the "honesty marker" */}
      <div className="mt-12 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6">
        <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-500">
          The KG-growth honesty check
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <KgGrowthCard
            phase="Phase 4 (Decompose)"
            label="THE birth event"
            detail="0 → ~200 entities. This is where the graph is built. Everything downstream interprets this snapshot."
            accent="#10B981"
            heavy
          />
          <KgGrowthCard
            phase="Phase 9 (Reflexive)"
            label="Slow continuous growth"
            detail="The prospector finds new edges between existing entities over time. Today: manual via 'Scan now'. Should be a cron."
            accent="#0EA5E9"
            heavy
          />
          <KgGrowthCard
            phase="Phases 1, 2, 3, 5, 6, 7, 8"
            label="Static — derivation only"
            detail="Every other phase produces *interpretations* of the KG: synthesis flags, strategies, mechanisms, trajectories. None of them add entities or edges."
            accent="#64748B"
          />
        </div>
      </div>
    </div>
  );
}

// ── Phase row ─────────────────────────────────────────────────────────

function PhaseRow({
  phase,
  isLast,
  live,
}: {
  phase: TimelinePhase;
  isLast: boolean;
  live?: PhaseLiveState | null;
}) {
  const triggerIsGate = phase.trigger === "user_gate";
  // Tint the card border slightly more strongly when this phase is
  // running, so the eye finds the "you are here" row at a glance.
  const isRunning = live?.status === "running";
  return (
    <div className="relative grid grid-cols-[88px_minmax(0,1fr)_72px] gap-4 items-start py-5">
      {/* Time marker */}
      <div className="relative flex flex-col items-end pt-1">
        <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-700">
          {phase.time}
        </span>
        <span className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">
          phase {phase.ordinal}
        </span>
      </div>

      {/* Timeline dot — placed on the rail */}
      <div
        aria-hidden
        className="absolute left-[80px] top-7 h-4 w-4 rounded-full border-2 bg-white"
        style={{
          borderColor: phase.accent,
          boxShadow: `0 0 0 4px ${phase.accentBg}`,
          zIndex: 1,
        }}
      />

      {/* Phase card */}
      <div
        className="rounded-xl border bg-white px-5 py-4 shadow-sm"
        style={{
          borderColor: isRunning ? "#F59E0B" : phase.accentBorder,
          boxShadow: isRunning
            ? `0 0 0 2px rgba(245,158,11,0.18), 0 1px 0 white inset, 0 6px 18px -8px rgba(245,158,11,0.30)`
            : `0 1px 0 white inset, 0 4px 12px -8px ${phase.accent}33`,
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3
                className="text-[15px] font-semibold tracking-tight"
                style={{ color: phase.accent }}
              >
                {phase.name}
              </h3>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{
                  background: triggerIsGate
                    ? "rgba(245,158,11,0.10)"
                    : phase.accentBg,
                  color: triggerIsGate ? "#D97706" : phase.accent,
                  border: `1px solid ${
                    triggerIsGate ? "rgba(245,158,11,0.30)" : phase.accentBorder
                  }`,
                }}
              >
                {triggerIsGate ? (
                  <>
                    <Pause className="h-2.5 w-2.5" />
                    user
                  </>
                ) : (
                  <>
                    <Sparkles className="h-2.5 w-2.5" />
                    auto
                  </>
                )}
              </span>
              {live && <StatusPill state={live} />}
            </div>
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              {phase.blurb}
            </p>
            {live && (
              <p className="mt-1.5 text-[11px] font-medium text-slate-700">
                <span className="text-slate-400">live · </span>
                {live.detail}
              </p>
            )}
          </div>
        </div>

        {/* Trigger detail */}
        <p className="text-[10.5px] italic text-slate-400 mb-3">
          ↳ {phase.triggerDetail}
        </p>

        {/* Covers — preflight diagram cards mapped to this phase */}
        {phase.covers.length > 0 && (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
            <p className="mb-1.5 text-[8.5px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Covers preflight cards · {phase.covers.length}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {phase.covers.map((c) => (
                <CoverChip key={c.cardId} cover={c} />
              ))}
            </div>
          </div>
        )}

        {/* API + writes + canvas in three columns */}
        <div className="grid gap-4 md:grid-cols-3">
          <Column
            label="API"
            icon={<Sparkles className="h-2.5 w-2.5" />}
            color={phase.accent}
          >
            <code
              className="text-[10.5px] font-mono text-slate-700 break-all"
              title={phase.apiUrl}
            >
              {phase.api}
            </code>
          </Column>
          <Column
            label="DB writes"
            icon={<Database className="h-2.5 w-2.5" />}
            color={phase.accent}
          >
            <ul className="space-y-1 text-[10.5px] text-slate-600">
              {phase.writes.map((w, idx) => (
                <li key={idx} className="flex gap-1.5">
                  <span className="text-slate-400 flex-shrink-0">·</span>
                  <span className="font-mono">{w}</span>
                </li>
              ))}
            </ul>
          </Column>
          <Column
            label="Canvas spawns"
            icon={<Eye className="h-2.5 w-2.5" />}
            color={phase.accent}
          >
            <ul className="space-y-1 text-[10.5px] text-slate-600">
              {phase.canvas.map((c, idx) => (
                <li key={idx} className="flex gap-1.5">
                  <span className="text-slate-400 flex-shrink-0">·</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Column>
        </div>
      </div>

      {/* KG growth indicator on the right edge */}
      <div className="flex flex-col items-center pt-1">
        <KgGrowthBadge growth={phase.kgGrowth} />
        <span className="mt-1.5 text-[9px] text-slate-400 text-center max-w-[70px] leading-tight">
          {phase.kgNote}
        </span>
      </div>

      {/* Connector down to next phase */}
      {!isLast && (
        <div
          aria-hidden
          className="absolute left-[86px] top-[60px] bottom-[-8px] w-0.5"
          style={{ background: phase.accent, opacity: 0.2, zIndex: 0 }}
        />
      )}
    </div>
  );
}

// ── User gate row (between phases) ────────────────────────────────────

function UserGateRow({
  label,
  duration,
  isLast,
}: {
  label: string;
  duration: string;
  isLast: boolean;
}) {
  return (
    <div className="relative grid grid-cols-[88px_minmax(0,1fr)_72px] gap-4 items-center py-3">
      <div />
      <div className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50/40 px-4 py-2.5 flex items-center gap-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100">
          <Pause className="h-3 w-3 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11.5px] font-semibold text-amber-900">
            ⏸ {label}
          </p>
          <p className="text-[10px] text-amber-700/80">
            timeline pauses · could last {duration}
          </p>
        </div>
        {!isLast && <ArrowRight className="h-3.5 w-3.5 text-amber-400" />}
      </div>
      <div />
    </div>
  );
}

// ── KG growth badge (right-edge indicator) ────────────────────────────

function KgGrowthBadge({ growth }: { growth: TimelinePhase["kgGrowth"] }) {
  if (growth === "major") {
    return (
      <div
        className="flex flex-col items-center gap-0.5 rounded-md bg-emerald-500 px-2 py-1.5 text-white shadow-sm"
        title="Major KG growth"
      >
        <Network className="h-3.5 w-3.5" />
        <span className="text-[8.5px] font-bold uppercase tracking-wider">
          KG ↑↑
        </span>
      </div>
    );
  }
  if (growth === "minor") {
    return (
      <div
        className="flex flex-col items-center gap-0.5 rounded-md bg-sky-500 px-2 py-1.5 text-white shadow-sm"
        title="Minor KG growth"
      >
        <Network className="h-3.5 w-3.5" />
        <span className="text-[8.5px] font-bold uppercase tracking-wider">
          KG ↑
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-400"
      title="No KG growth — derivation only"
    >
      <Eye className="h-3.5 w-3.5" />
      <span className="text-[8.5px] font-bold uppercase tracking-wider">
        derive
      </span>
    </div>
  );
}

// ── KG growth summary card (footer) ───────────────────────────────────

function KgGrowthCard({
  phase,
  label,
  detail,
  accent,
  heavy = false,
}: {
  phase: string;
  label: string;
  detail: string;
  accent: string;
  heavy?: boolean;
}) {
  return (
    <div
      className="rounded-lg border bg-white p-4"
      style={{
        borderColor: heavy ? `${accent}55` : "rgba(203,213,225,0.8)",
        boxShadow: heavy ? `0 4px 12px -8px ${accent}66` : "none",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {heavy ? (
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: accent }} />
        ) : (
          <Clock className="h-3.5 w-3.5 text-slate-400" />
        )}
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider"
          style={{ color: heavy ? accent : "#64748B" }}
        >
          {phase}
        </span>
      </div>
      <p
        className="text-[12.5px] font-semibold mb-1"
        style={{ color: heavy ? "#0F172A" : "#475569" }}
      >
        {label}
      </p>
      <p className="text-[11px] leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function Column({
  label,
  icon,
  color,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-1.5 mb-1.5 text-[9px] font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Preflight-card coverage chip ─────────────────────────────────────
//
// Renders a single TEMPLATE_ARCH_CARD covered by this phase. Click →
// scrolls the L0-L6 grid card with id="arch-card-{cardId}" into view
// and flashes a brief outline so the eye catches it.
//
// Status-colored dot: green=live, amber=designed, gray=no-code.

function flashArchCard(cardId: string): boolean {
  if (typeof document === "undefined") return false;
  const target = document.getElementById(`arch-card-${cardId}`);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  // Flash outline animation — 1200ms then auto-remove. No external
  // dependency; just direct style mutation since this is sparse and
  // doesn't need to be tracked in React state.
  const prevOutline = target.style.outline;
  const prevOffset = target.style.outlineOffset;
  const prevTransition = target.style.transition;
  target.style.transition = "outline-color 600ms ease, outline-offset 600ms ease";
  target.style.outline = "3px solid #10B981";
  target.style.outlineOffset = "4px";
  window.setTimeout(() => {
    target.style.outline = "3px solid rgba(16,185,129,0)";
    target.style.outlineOffset = "8px";
  }, 700);
  window.setTimeout(() => {
    target.style.outline = prevOutline;
    target.style.outlineOffset = prevOffset;
    target.style.transition = prevTransition;
  }, 1300);
  return true;
}

function CoverChip({ cover }: { cover: CardCoverage }) {
  const statusVisual = {
    live: { dot: "#10B981", ring: "rgba(16,185,129,0.30)", bg: "rgba(16,185,129,0.06)", text: "#065F46", hoverBg: "rgba(16,185,129,0.12)" },
    designed: { dot: "#F59E0B", ring: "rgba(245,158,11,0.30)", bg: "rgba(245,158,11,0.06)", text: "#92400E", hoverBg: "rgba(245,158,11,0.12)" },
    "no-code": { dot: "#94A3B8", ring: "rgba(148,163,184,0.30)", bg: "rgba(148,163,184,0.06)", text: "#475569", hoverBg: "rgba(148,163,184,0.14)" },
  }[cover.status];

  const handleClick = () => {
    const found = flashArchCard(cover.cardId);
    if (!found) {
      // Card id not in DOM (e.g., user landed deep-link before the
      // grid mounted). Fall back to scrolling to top of architecture
      // section — still useful, just less precise.
      const arch = document.querySelector("[id^='arch-card-']");
      arch?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-0.5 text-[9.5px] font-medium transition-colors hover:bg-[var(--cover-hover-bg)]"
      style={
        {
          borderColor: statusVisual.ring,
          background: statusVisual.bg,
          color: statusVisual.text,
          // CSS var lets the className-based hover transition use the
          // right tint per status without requiring inline mouse handlers.
          "--cover-hover-bg": statusVisual.hoverBg,
        } as React.CSSProperties & Record<string, string>
      }
      title={`L${cover.layer} · ${cover.label}\n\n${cover.detail}\n\n↑ click to scroll to this card in the L0-L6 grid above`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: statusVisual.dot }}
      />
      <span className="font-mono opacity-60">L{cover.layer}</span>
      <span>{cover.label}</span>
    </button>
  );
}

function LegendChip({
  color,
  label,
  Icon,
  solid = false,
}: {
  color: string;
  label: string;
  Icon: typeof Sparkles;
  solid?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium"
      style={{
        background: solid ? color : "white",
        color: solid ? "white" : color,
        borderColor: solid ? color : `${color}55`,
      }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── Live status pill ──────────────────────────────────────────────────
//
// Rendered next to the auto/user trigger pill in PhaseRow when the
// timeline has `liveState` (i.e. when mounted from
// /app/space/[id]/timeline). The amber "live" variant pulses softly
// so the running row catches the eye.

function StatusPill({ state }: { state: PhaseLiveState }) {
  const visual = STATUS_VISUAL[state.status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
        state.status === "running" ? "animate-pulse" : ""
      }`}
      style={{
        background: visual.bg,
        color: visual.text,
        border: `1px solid ${visual.ring}`,
      }}
      title={`${visual.label} · ${state.signal.source} → ${state.signal.value}`}
    >
      {visual.Icon}
      {visual.label}
    </span>
  );
}

const STATUS_VISUAL: Record<
  PhaseStatus,
  { bg: string; text: string; ring: string; label: string; Icon: React.ReactNode }
> = {
  completed: {
    bg: "rgba(16,185,129,0.12)",
    text: "#065F46",
    ring: "rgba(16,185,129,0.40)",
    label: "done",
    Icon: <CheckCircle2 className="h-2.5 w-2.5" />,
  },
  running: {
    bg: "rgba(245,158,11,0.14)",
    text: "#92400E",
    ring: "rgba(245,158,11,0.45)",
    label: "live",
    Icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
  },
  pending: {
    bg: "rgba(148,163,184,0.12)",
    text: "#475569",
    ring: "rgba(148,163,184,0.35)",
    label: "pending",
    Icon: <CircleDashed className="h-2.5 w-2.5" />,
  },
  failed: {
    bg: "rgba(239,68,68,0.14)",
    text: "#991B1B",
    ring: "rgba(239,68,68,0.45)",
    label: "failed",
    Icon: <XCircle className="h-2.5 w-2.5" />,
  },
};
