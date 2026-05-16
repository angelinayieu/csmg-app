"use client";

// ── WhiteboardBootstrapSplash ──
//
// Bridges the visual gap between landing on a fresh `?run=<uuid>`
// whiteboard and the first entity / SSE event painting onto the canvas.
//
// Strategy: mount when `?run=…` is in the URL AND the SSR snapshot
// has zero entities (fresh space). Render a Vision-Pro glass surface
// showing the live pipeline state — animated graph skeleton with real
// entity/edge counts, a stage checklist driven by actual pipeline_run
// events (not a setInterval). Auto-fade once entities arrive in the
// store, or when the internal max-wait elapses. Mode-aware: the mode
// the user picked on the dashboard (precise_rd / brain_probe / …)
// drives the accent color, mode label, and which stages are shown.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Brain,
  Check,
  FastForward,
  FlaskConical,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { ExperienceMode } from "@/types/experience-mode";

// ── Mode meta ─────────────────────────────────────────────────
// Mirrors EXPERIENCE_MODES accent palette so the splash inherits
// the same visual identity the user picked on the dashboard.
interface ModeMeta {
  label: string;
  tagline: string;
  accent: string;
  accentSoft: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}
const MODE_META: Record<ExperienceMode, ModeMeta> = {
  brain_probe: {
    label: "Brain Probe",
    tagline: "Probing your prompt",
    accent: "#06b6d4",
    accentSoft: "rgba(6, 182, 212, 0.18)",
    icon: Brain,
  },
  brainstorm_speed: {
    label: "Brainstorm Speedrun",
    tagline: "Autopiloting expansions",
    accent: "#a855f7",
    accentSoft: "rgba(168, 85, 247, 0.18)",
    icon: FastForward,
  },
  precise_rd: {
    label: "Precise R&D",
    tagline: "Running the deep pipeline",
    accent: "#6366f1",
    accentSoft: "rgba(99, 102, 241, 0.18)",
    icon: FlaskConical,
  },
  digital_twin: {
    label: "Digital Twin",
    tagline: "Curating the causal model",
    accent: "#10b981",
    accentSoft: "rgba(16, 185, 129, 0.18)",
    icon: Layers3,
  },
};
const DEFAULT_META: ModeMeta = {
  label: "Whiteboard",
  tagline: "Preparing your run",
  accent: "#0f172a",
  accentSoft: "rgba(15, 23, 42, 0.16)",
  icon: Sparkles,
};

// ── Stage groups ──────────────────────────────────────────────
// Raw pipeline stages (intake, landscape, kg, proposal, twin, lab,
// reflexive, results) bucketed into 3–4 user-meaningful chunks. The
// checklist renders the chunks; the chunks turn "done" when every
// underlying stage has exited per /api/pipeline/runs/[id]/context.
interface StageGroup {
  id: string;
  label: string;
  stages: string[];
  hints: string[];
}
const GROUPS_PRECISE: StageGroup[] = [
  {
    id: "decompose",
    label: "Decompose prompt",
    stages: ["intake"],
    hints: [
      "Pulling out entities and tensions.",
      "Reading what the prompt asks for.",
      "Naming the moving parts.",
    ],
  },
  {
    id: "kg",
    label: "Knowledge graph",
    stages: ["kg", "landscape"],
    hints: [
      "Wiring relationships across entities.",
      "Surfacing feedback loops and cycles.",
      "Mapping the surrounding landscape.",
    ],
  },
  {
    id: "strategy",
    label: "Strategy + simulation",
    stages: ["proposal", "twin", "reflexive"],
    hints: [
      "Drafting candidate strategies.",
      "Simulating outcomes on the twin.",
      "Critiquing and re-ranking options.",
    ],
  },
  {
    id: "lab",
    label: "Lab synthesis",
    stages: ["lab", "results"],
    hints: [
      "Materializing the top strategies.",
      "Finalizing the board.",
    ],
  },
];
const GROUPS_LIGHT: StageGroup[] = [
  {
    id: "decompose",
    label: "Decompose prompt",
    stages: ["intake"],
    hints: ["Pulling out the moving parts.", "Naming entities."],
  },
  {
    id: "kg",
    label: "Knowledge graph",
    stages: ["kg", "landscape"],
    hints: [
      "Wiring relationships.",
      "Surfacing cycles.",
    ],
  },
  {
    id: "expand",
    label: "Expand",
    stages: ["proposal", "twin", "reflexive", "lab", "results"],
    hints: ["Running expansions and re-frames."],
  },
];
const GROUPS_TWIN: StageGroup[] = [
  {
    id: "decompose",
    label: "Decompose prompt",
    stages: ["intake"],
    hints: ["Pulling out entities and tensions."],
  },
  {
    id: "kg",
    label: "Knowledge graph",
    stages: ["kg", "landscape"],
    hints: [
      "Wiring causal relationships.",
      "Surfacing feedback loops.",
    ],
  },
  {
    id: "twin",
    label: "Causal model",
    stages: ["twin", "proposal", "reflexive"],
    hints: [
      "Calibrating the digital twin.",
      "Tuning prediction parameters.",
    ],
  },
  {
    id: "results",
    label: "Finalize",
    stages: ["lab", "results"],
    hints: ["Locking in the model."],
  },
];
function groupsForMode(mode: ExperienceMode | null | undefined): StageGroup[] {
  if (mode === "precise_rd") return GROUPS_PRECISE;
  if (mode === "digital_twin") return GROUPS_TWIN;
  if (mode === "brain_probe" || mode === "brainstorm_speed") return GROUPS_LIGHT;
  return GROUPS_PRECISE;
}

// ── Timing ───────────────────────────────────────────────────
// HARD_DISMISS is the safety net: even if no entity ever lands and
// no failure ever surfaces, the splash auto-fades at 30s so the user
// isn't trapped. AUTO_REFRESH pulls SSR at 18s to cover the case
// where decompose completed but the SSE "completed" event never
// reached the client (hydration race / dev-mode connection limits).
// STALE_RUN_MS = silence threshold while status is still "running"
// — flips the splash to its Resume CTA. ESCAPE_HATCH_REVEAL_MS hides
// the manual "Load now" button until the wait has actually felt long.
const HARD_DISMISS_MS = 30000;
const AUTO_REFRESH_MS = 18000;
const STALE_RUN_MS = 25000;
const LATE_NOTICE_MS = 14000;
const ESCAPE_HATCH_REVEAL_MS = 12000;
const HINT_ROTATE_MS = 3800;

type RunStatus = "running" | "completed" | "failed" | "unknown";

interface ContextStage {
  stage: string;
  enteredAt: string | null;
  exitedAt: string | null;
}
interface LiveCounts {
  entities: number;
  edges: number;
  cycles: number;
  sources: number;
}

interface Props {
  runId: string | null;
  existingEntityCount: number;
  spaceId?: string;
  inputText?: string;
  /** Experience mode the user picked on the dashboard (URL ?mode=…
   *  → persisted on the space row at bootstrap). Drives accent color,
   *  label, and which stage checklist is shown. */
  mode?: ExperienceMode | null;
}

export function WhiteboardBootstrapSplash({
  runId,
  existingEntityCount,
  spaceId,
  inputText,
  mode,
}: Props) {
  const router = useRouter();
  const shouldShow = runId !== null && existingEntityCount === 0;

  const [now, setNow] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("unknown");
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [planPending, setPlanPending] = useState(false);
  const [contextStages, setContextStages] = useState<ContextStage[]>([]);
  const [liveCounts, setLiveCounts] = useState<LiveCounts>({
    entities: 0,
    edges: 0,
    cycles: 0,
    sources: 0,
  });
  const [hintIdx, setHintIdx] = useState(0);

  const modeMeta = mode ? MODE_META[mode] : DEFAULT_META;
  const groups = useMemo(() => groupsForMode(mode), [mode]);

  // Wall-clock tick + safety-net dismiss + SSR auto-refresh.
  useEffect(() => {
    if (!shouldShow) return;
    const start = Date.now();
    const tick = () => setNow(Date.now() - start);
    tick();
    const interval = window.setInterval(tick, 250);
    const hard = window.setTimeout(() => setDismissed(true), HARD_DISMISS_MS);
    const autoRefresh = window.setTimeout(() => {
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(hard);
      window.clearTimeout(autoRefresh);
    };
  }, [shouldShow, router]);

  // Run-status + stage + count poll. Same /context endpoint as before,
  // we just additionally extract counts + stage[] to drive the live UI.
  useEffect(() => {
    if (!shouldShow || !runId) return;
    let cancelled = false;
    let lastEventEmittedAt: string | null = null;
    let staleSince: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/pipeline/runs/${runId}/context`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const ctx = (await res.json()) as {
          status?: RunStatus;
          lastEventAt?: string | null;
          stages?: ContextStage[];
          counts?: Partial<LiveCounts>;
        };
        if (cancelled) return;

        if (Array.isArray(ctx.stages)) {
          setContextStages(
            ctx.stages.map((s) => ({
              stage: s.stage,
              enteredAt: s.enteredAt ?? null,
              exitedAt: s.exitedAt ?? null,
            })),
          );
        }
        if (ctx.counts) {
          setLiveCounts((prev) => ({
            entities: ctx.counts?.entities ?? prev.entities,
            edges: ctx.counts?.edges ?? prev.edges,
            cycles: ctx.counts?.cycles ?? prev.cycles,
            sources: ctx.counts?.sources ?? prev.sources,
          }));
        }

        if (ctx.status === "completed" || ctx.status === "failed") {
          setRunStatus(ctx.status);
          return;
        }
        if (ctx.status === "running") {
          const cur = ctx.lastEventAt ?? null;
          if (cur && cur === lastEventEmittedAt) {
            staleSince ??= Date.now();
            if (Date.now() - staleSince > STALE_RUN_MS) {
              setRunStatus("failed");
              return;
            }
          } else {
            lastEventEmittedAt = cur;
            staleSince = null;
            setRunStatus("running");
          }
        }
      } catch {
        // network blip — try again next tick
      }
    };

    void poll();
    const interval = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldShow, runId]);

  // Plan-pending gate — step out of the way when the user is being
  // asked to approve a KG plan (the gate card lives above this splash
  // but visual focus is wrong if both render).
  useEffect(() => {
    if (!shouldShow || !spaceId) return;
    let cancelled = false;

    const checkForPlan = async () => {
      try {
        const res = await fetch(
          `/api/spaces/${spaceId}/kg-plans?status=open`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          plans?: Array<{ status?: string }>;
        };
        if (cancelled) return;
        const open = (j.plans ?? []).find(
          (p) => p?.status === "proposed" || p?.status === "edited",
        );
        setPlanPending(!!open);
      } catch {
        // network blip — try again next tick
      }
    };

    const onProposed = () => setPlanPending(true);
    const onApprovedOrRejected = () => setPlanPending(false);

    void checkForPlan();
    const interval = window.setInterval(checkForPlan, 5000);
    window.addEventListener("interaxis:kg-plan-proposed", onProposed);
    window.addEventListener("interaxis:kg-plan-approved", onApprovedOrRejected);
    window.addEventListener("interaxis:kg-plan-rejected", onApprovedOrRejected);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("interaxis:kg-plan-proposed", onProposed);
      window.removeEventListener("interaxis:kg-plan-approved", onApprovedOrRejected);
      window.removeEventListener("interaxis:kg-plan-rejected", onApprovedOrRejected);
    };
  }, [shouldShow, spaceId]);

  // Derive checklist state from the real stage events.
  const groupStates = useMemo(() => {
    return groups.map<"pending" | "active" | "done">((g) => {
      const slices = g.stages
        .map((s) => contextStages.find((cs) => cs.stage === s))
        .filter((x): x is ContextStage => !!x);
      if (slices.length === 0) return "pending";
      if (slices.every((s) => s.exitedAt !== null)) return "done";
      return "active";
    });
  }, [groups, contextStages]);

  // Active group = first non-done; if everything's done we sit on the
  // last one until entities land and the parent unmounts us.
  const activeIdx = useMemo(() => {
    const i = groupStates.findIndex((s) => s !== "done");
    return i === -1 ? groups.length - 1 : i;
  }, [groupStates, groups.length]);

  const activeGroup = groups[activeIdx];

  // Rotate the hint copy within the active group. Tying the timer to
  // (activeIdx, hint count) restarts it whenever the active group
  // advances, so the user sees the first hint of each new group first.
  useEffect(() => {
    if (!shouldShow) return;
    setHintIdx(0);
    const interval = window.setInterval(() => {
      setHintIdx((prev) => (prev + 1) % (activeGroup?.hints.length || 1));
    }, HINT_ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [shouldShow, activeIdx, activeGroup]);

  const handleResume = async () => {
    if (resuming || !spaceId || !runId) return;
    setResuming(true);
    setResumeError(null);
    try {
      const res = await fetch("/api/pipeline/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText ?? "",
          existingSpaceId: spaceId,
          existingRunId: runId,
          autoAdvance: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Resume failed (${res.status})`);
      }
      setRunStatus("running");
      router.refresh();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setResuming(false);
    }
  };

  if (!shouldShow) return null;
  if (planPending) return null;

  const accent = modeMeta.accent;
  const isLate = now > LATE_NOTICE_MS;
  const showEscapeHatch = now > ESCAPE_HATCH_REVEAL_MS;
  const ModeIcon = modeMeta.icon;
  const hint = activeGroup?.hints[hintIdx] ?? activeGroup?.hints[0] ?? "";
  const hasAnyCounts =
    liveCounts.entities + liveCounts.edges + liveCounts.cycles + liveCounts.sources >
    0;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        opacity: dismissed ? 0 : 1,
        transition: "opacity 700ms cubic-bezier(0.25,0.8,0.25,1)",
      }}
      aria-hidden={dismissed}
    >
      {/* Veil — heavier blur than before so canvas chrome (top stage
          rail, communities pill, "Relax layout" button) doesn't bleed
          through as half-rendered noise. The accent-tinted radial in
          the middle gives the surface its mode identity. */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 50% 42%, ${modeMeta.accentSoft} 0%, rgba(255,255,255,0) 70%),
            linear-gradient(180deg, rgba(248,250,252,0.92) 0%, rgba(241,245,249,0.96) 100%)
          `,
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
        }}
      />

      <div
        className="splash-pill pointer-events-auto relative flex w-[min(94vw,460px)] flex-col items-stretch gap-4 px-7 py-6 text-left"
        style={{ ["--accent" as string]: accent }}
      >
        {runStatus === "failed" ? (
          <ResumeBlock
            resuming={resuming}
            resumeError={resumeError}
            inputText={inputText}
            spaceId={spaceId}
            onResume={handleResume}
            onDismiss={() => setDismissed(true)}
            accent={accent}
          />
        ) : (
          <>
            {/* Mode header — anchors the user in the experience they
                picked. Same accent treatment as the canvas mode chip
                so they read as the same surface. */}
            <div className="flex items-center gap-2.5">
              <span
                className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                style={{
                  background: accent,
                  color: "white",
                  boxShadow: `0 4px 12px -4px ${accent}66`,
                }}
              >
                <ModeIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="font-mono text-[9.5px] uppercase tracking-[0.18em]"
                  style={{ color: accent }}
                >
                  {modeMeta.label}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold tracking-tight text-slate-900">
                  {isLate
                    ? "Pipeline taking longer than usual"
                    : modeMeta.tagline}
                </div>
              </div>
            </div>

            {/* Animated graph skeleton — placeholder nodes appear in
                sequence; once real entity/edge counts arrive, nodes
                light up at full accent saturation. The cycle ring at
                the center pulses when counts.cycles > 0. */}
            <GraphSkeleton counts={liveCounts} accent={accent} elapsedMs={now} />

            {/* Live counts — only renders once any have landed, so we
                don't show "0 entities" while the user is still waiting
                for the first event. */}
            {hasAnyCounts && (
              <div className="flex items-center justify-center gap-2 text-[10.5px] font-medium tabular-nums text-slate-500">
                <CountChip n={liveCounts.entities} label="entities" accent={accent} />
                <span className="text-slate-300">·</span>
                <CountChip n={liveCounts.edges} label="edges" accent={accent} />
                {liveCounts.cycles > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <CountChip n={liveCounts.cycles} label="cycles" accent={accent} />
                  </>
                )}
                {liveCounts.sources > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <CountChip n={liveCounts.sources} label="sources" accent={accent} />
                  </>
                )}
              </div>
            )}

            {/* Stage checklist — bound to /context.stages, not a
                setInterval. Group is "done" only when every underlying
                stage has exitedAt; "active" while any has enteredAt
                without exit; "pending" otherwise. */}
            <ul className="flex flex-col gap-1.5">
              {groups.map((g, i) => {
                const state = groupStates[i];
                return (
                  <StageRow
                    key={g.id}
                    label={g.label}
                    state={state}
                    accent={accent}
                  />
                );
              })}
            </ul>

            {/* Active-group hint — rotates every ~4s within the
                active group. Sets the rhythm of "something is alive
                and progressing". */}
            <div className="min-h-[16px] text-center text-[11px] italic leading-snug text-slate-500">
              <span key={`${activeIdx}-${hintIdx}`} className="splash-hint">
                {hint}
              </span>
            </div>

            {/* Escape hatch — appears after 12s only. Wrapped in a
                fade so it doesn't pop in jarringly. */}
            {showEscapeHatch && (
              <div className="splash-fadein flex flex-col items-center gap-1.5">
                <button
                  onClick={() => {
                    setRefreshing(true);
                    router.refresh();
                    window.setTimeout(() => {
                      setRefreshing(false);
                      setDismissed(true);
                    }, 1500);
                  }}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:scale-[1.02] hover:bg-white disabled:opacity-60"
                  style={{ backdropFilter: "blur(8px)" }}
                >
                  <RefreshCw
                    className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                  />
                  {refreshing ? "Loading…" : "Load my whiteboard now"}
                </button>
                {isLate && (
                  <span className="text-[10px] font-medium text-slate-400">
                    Still running — you can wait or load what&apos;s landed.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Keyframes are declared global so the inline `style.animation`
          references in StageRow / GraphSkeleton can resolve their
          keyframe names — styled-jsx scopes keyframes by default,
          which breaks the inline-style path. The class selectors
          below stay scoped via the non-global block. */}
      <style jsx global>{`
        @keyframes splashIn {
          from {
            opacity: 0;
            transform: translateY(6px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes hintIn {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes splashStagePulse {
          0% {
            box-shadow: 0 0 0 0 currentColor;
            opacity: 0.55;
          }
          70% {
            box-shadow: 0 0 0 8px transparent;
            opacity: 0;
          }
          100% {
            box-shadow: 0 0 0 0 transparent;
            opacity: 0;
          }
        }
        @keyframes splashNodePulse {
          0% {
            transform: scale(1);
            opacity: 0.45;
          }
          80% {
            transform: scale(2.4);
            opacity: 0;
          }
          100% {
            transform: scale(2.4);
            opacity: 0;
          }
        }
        @keyframes splashCycleSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <style jsx>{`
        .splash-pill {
          border-radius: 26px;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.82) 0%,
            rgba(255, 255, 255, 0.66) 100%
          );
          backdrop-filter: blur(28px) saturate(160%);
          -webkit-backdrop-filter: blur(28px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.95) inset,
            0 1px 2px rgba(15, 23, 42, 0.04),
            0 24px 60px -24px rgba(15, 23, 42, 0.22),
            0 40px 100px -50px var(--accent, rgba(15, 23, 42, 0.2));
          animation: splashIn 480ms cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .splash-pill::before {
          content: "";
          position: absolute;
          inset: 0 0 auto 0;
          height: 80px;
          border-radius: 26px 26px 0 0;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--accent, #0f172a) 18%, transparent) 0%,
            transparent 100%
          );
          opacity: 0.55;
          pointer-events: none;
        }
        .splash-hint {
          animation: hintIn 360ms cubic-bezier(0.25, 0.8, 0.25, 1);
          display: inline-block;
        }
        .splash-fadein {
          animation: fadeIn 420ms cubic-bezier(0.25, 0.8, 0.25, 1);
        }
      `}</style>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────

function StageRow({
  label,
  state,
  accent,
}: {
  label: string;
  state: "pending" | "active" | "done";
  accent: string;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className="relative inline-flex h-[18px] w-[18px] items-center justify-center rounded-full"
        style={{
          background:
            state === "done"
              ? accent
              : state === "active"
                ? "rgba(255,255,255,0.9)"
                : "rgba(15,23,42,0.05)",
          border:
            state === "active"
              ? `1.5px solid ${accent}`
              : state === "pending"
                ? "1px solid rgba(15,23,42,0.08)"
                : "none",
          boxShadow:
            state === "done" ? `0 2px 8px -2px ${accent}66` : undefined,
        }}
      >
        {state === "done" && (
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
        )}
        {state === "active" && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              animation: "splashStagePulse 1.4s ease-in-out infinite",
              color: accent,
            }}
          />
        )}
        {state === "active" && (
          <span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: accent }}
          />
        )}
      </span>
      <span
        className="text-[12px] font-medium tracking-tight"
        style={{
          color:
            state === "done"
              ? "rgb(71, 85, 105)"
              : state === "active"
                ? "rgb(15, 23, 42)"
                : "rgb(148, 163, 184)",
        }}
      >
        {label}
      </span>
      {state === "active" && (
        <Loader2
          className="ml-auto h-3 w-3 animate-spin"
          style={{ color: accent }}
        />
      )}
    </li>
  );
}

function CountChip({
  n,
  label,
  accent,
}: {
  n: number;
  label: string;
  accent: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className="text-[11.5px] font-bold tabular-nums"
        style={{ color: accent }}
      >
        {n}
      </span>
      <span>{label}</span>
    </span>
  );
}

// Animated SVG graph skeleton. Six positions on a soft hex; nodes
// fade in on a stagger, edges draw with stroke-dashoffset. Once real
// `counts.entities` arrives, the first N nodes saturate to the accent
// color (the others stay as quiet placeholders so the surface keeps
// its visual weight). A cycle ring pulses behind the center when
// counts.cycles > 0.
function GraphSkeleton({
  counts,
  accent,
  elapsedMs,
}: {
  counts: LiveCounts;
  accent: string;
  elapsedMs: number;
}) {
  // Six placeholder positions. Centered around (110, 56) in a 220x112
  // viewBox so the skeleton sits comfortably in the pill.
  const nodes = [
    { x: 36, y: 32 },
    { x: 110, y: 18 },
    { x: 184, y: 32 },
    { x: 184, y: 88 },
    { x: 110, y: 102 },
    { x: 36, y: 88 },
  ];
  const edges: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
    [1, 4], // cross — gives the skeleton some density
    [0, 3],
  ];

  // How many nodes/edges read as "real" so far. Cap to skeleton size;
  // it's intentionally not a 1:1 mapping — the skeleton stays the
  // same visual shape, real activity just lights it up.
  const realNodes = Math.min(counts.entities, nodes.length);
  const realEdges = Math.min(counts.edges, edges.length);
  const showCycle = counts.cycles > 0;

  return (
    <div className="relative flex h-[120px] w-full items-center justify-center">
      <svg
        viewBox="0 0 220 120"
        className="h-full w-auto"
        style={{ overflow: "visible" }}
      >
        {/* Edges first so they sit behind nodes. */}
        {edges.map(([a, b], i) => {
          const isReal = i < realEdges;
          const na = nodes[a];
          const nb = nodes[b];
          const delay = 400 + i * 180;
          return (
            <line
              key={i}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              stroke={isReal ? accent : "rgba(15, 23, 42, 0.12)"}
              strokeWidth={isReal ? 1.6 : 1}
              strokeLinecap="round"
              style={{
                strokeDasharray: 200,
                strokeDashoffset: elapsedMs > delay ? 0 : 200,
                transition: "stroke-dashoffset 700ms ease, stroke 400ms ease",
                opacity: isReal ? 0.9 : 0.6,
              }}
            />
          );
        })}

        {/* Cycle ring — only when a real cycle has landed. Sits behind
            the cluster, slowly rotating + pulsing. */}
        {showCycle && (
          <circle
            cx={110}
            cy={60}
            r={46}
            fill="none"
            stroke={accent}
            strokeWidth={1}
            strokeDasharray="4 6"
            opacity={0.35}
            style={{
              transformOrigin: "110px 60px",
              animation: "splashCycleSpin 6s linear infinite",
            }}
          />
        )}

        {/* Nodes. */}
        {nodes.map((n, i) => {
          const isReal = i < realNodes;
          const delay = 80 + i * 140;
          return (
            <g
              key={i}
              style={{
                opacity: elapsedMs > delay ? 1 : 0,
                transition: "opacity 380ms ease",
              }}
            >
              {/* Halo (subtle) */}
              <circle
                cx={n.x}
                cy={n.y}
                r={isReal ? 8 : 6}
                fill={isReal ? accent : "white"}
                opacity={isReal ? 0.18 : 0}
              />
              <circle
                cx={n.x}
                cy={n.y}
                r={isReal ? 4.2 : 3.4}
                fill={isReal ? accent : "white"}
                stroke={isReal ? accent : "rgba(15, 23, 42, 0.2)"}
                strokeWidth={isReal ? 0 : 1}
                style={{
                  transition: "fill 360ms ease, r 360ms ease",
                  filter: isReal ? `drop-shadow(0 2px 6px ${accent}55)` : "none",
                }}
              />
              {/* Real-node pulse */}
              {isReal && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={4.2}
                  fill="none"
                  stroke={accent}
                  strokeWidth={1}
                  opacity={0.5}
                  style={{
                    transformOrigin: `${n.x}px ${n.y}px`,
                    animation: `splashNodePulse 2.4s ease-out ${i * 0.18}s infinite`,
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>

    </div>
  );
}

function ResumeBlock({
  resuming,
  resumeError,
  inputText,
  spaceId,
  onResume,
  onDismiss,
  accent,
}: {
  resuming: boolean;
  resumeError: string | null;
  inputText: string | undefined;
  spaceId: string | undefined;
  onResume: () => void;
  onDismiss: () => void;
  accent: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="text-[14px] font-semibold text-slate-900">
        Generation paused
      </div>
      <div className="max-w-[340px] text-[12px] font-light leading-relaxed text-slate-500">
        {inputText
          ? "The previous run was interrupted. Resume continues exactly where it stopped — no duplicates, no new credits."
          : "The previous run was interrupted. Resume to continue without creating a duplicate whiteboard."}
      </div>
      {resumeError && (
        <div className="text-[11px] font-medium text-rose-600">{resumeError}</div>
      )}
      <button
        onClick={onResume}
        disabled={resuming || !spaceId}
        className="mt-1 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-60"
        style={{
          background: accent,
          boxShadow: `0 6px 18px -8px ${accent}88`,
        }}
      >
        {resuming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" />
        )}
        {resuming ? "Resuming…" : "Resume generation"}
      </button>
      <button
        onClick={onDismiss}
        className="text-[10.5px] font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
