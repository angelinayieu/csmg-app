"use client";

// Right panel — Final Artifacts (Phase 3).
//
// Per the locked design vote, the right panel surfaces the PROCESSED
// OUTPUTS of the pipeline:
//
//   • Strategy options (primary + ranked alternatives)
//   • Lab proposals (twin_proposals kind=lab_twin)
//   • Twin proposals (problem framing + strategy twins)
//   • Variations (experiment_variants by app)
//   • Apps + their interventions
//   • Lab scaffolds (materialized labs)
//   • Screens (placeholder — Phase 4)
//
// Synthesis-style insights (bottleneck / leverage / axioms / hidden
// signals) live in the MIDDLE panel only now (Insights mode + Claims
// mode). The right panel is for "what should I DO with this insight"
// — strategies, experiments, prototypes.
//
// Data: polls /api/spaces/[id]/final-artifacts every 12s + on
// router.refresh from the live-synthesis hook. One round-trip per
// poll instead of 5 separate fetches.
//
// The file name stays `insights-panel.tsx` (and the export stays
// `InsightsPanel`) so triple-lab.tsx doesn't need to change. Future
// rename can happen as a follow-up.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type {
  FinalArtifactsResponse,
  FinalArtifactStrategyOption,
  FinalArtifactTwinProposal,
  FinalArtifactVariant,
  FinalArtifactApp,
  FinalArtifactIntervention,
  FinalArtifactLabScaffold,
} from "@/app/api/spaces/[id]/final-artifacts/route";
import { GuardrailQuestionQueue } from "./guardrail-question-queue";
import { colors, backgrounds, tracking } from "./tokens";

interface InsightsPanelProps {
  spaceId: string;
  // synthesisData is still passed in case Phase 3-extended wants to
  // show a small "synthesis last ran 3m ago" stamp. Not used in this
  // build but kept on the prop contract so triple-lab.tsx is stable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  synthesisData: SynthesisData | null;
  // Entities kept for potential future cross-referencing. Not used
  // in this build.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entities: Entity[];
  selectedEntityId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onSelectEntity: (id: string | null) => void;
}

const POLL_INTERVAL_MS = 12_000;

export function InsightsPanel({
  spaceId,
}: InsightsPanelProps) {
  const [data, setData] = useState<FinalArtifactsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/final-artifacts`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as FinalArtifactsResponse;
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // Initial fetch + 12s polling. Polling stops when the panel
  // unmounts. We don't pause when nothing is running because the user
  // may navigate here right as a chain completes — over-fetching by
  // 1-2 cycles is cheap insurance.
  useEffect(() => {
    void fetchArtifacts();
    const interval = window.setInterval(() => {
      void fetchArtifacts();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchArtifacts]);

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: backgrounds.insightsPanel }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4"
        style={{ background: colors.neutral.panelBgFlat }}
      >
        <div>
          <div
            className="text-[9px] font-bold uppercase text-slate-500"
            style={{ letterSpacing: tracking.eyebrow }}
          >
            ◆ Final artifacts
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900">
            {loading && !data
              ? "Loading…"
              : data
              ? data.counts.total > 0
                ? `${data.counts.total} artifact${data.counts.total === 1 ? "" : "s"}`
                : "Awaiting pipeline output"
              : error
              ? "Service unavailable"
              : "—"}
          </div>
        </div>
        {data && data.last_synthesis_at && (
          <FreshnessChip generatedAt={data.last_synthesis_at} />
        )}
      </div>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && !data ? (
          <ErrorState message={error} onRetry={fetchArtifacts} />
        ) : !data || data.counts.total === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            <StrategyOptionsSection options={data.strategy_options} />
            <LabProposalsSection spaceId={spaceId} proposals={data.lab_proposals} />
            <TwinProposalsSection spaceId={spaceId} proposals={data.twin_proposals} />
            <VariationsSection variations={data.variations} apps={data.apps} />
            <AppsSection
              spaceId={spaceId}
              apps={data.apps}
              interventions={data.interventions}
            />
            <LabScaffoldsSection scaffolds={data.lab_scaffolds} />
            <ScreensPlaceholderSection />
          </div>
        )}
      </div>

      {/* ── Guardrail queue (unchanged) ───────────────────────────── */}
      <GuardrailQuestionQueue spaceId={spaceId} />
    </div>
  );
}

// ── Header freshness chip ───────────────────────────────────────────
function FreshnessChip({ generatedAt }: { generatedAt: string }) {
  // "Now" is captured once at mount (useState initializer) + ticks
  // every 30s so the chip updates without putting Date.now() in the
  // render hot path (which the react-hooks/purity rule disallows).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const ms = nowMs - new Date(generatedAt).getTime();
  const label =
    ms < 60_000
      ? `synth ${Math.max(0, Math.floor(ms / 1000))}s ago`
      : ms < 3_600_000
      ? `synth ${Math.floor(ms / 60_000)}m ago`
      : ms < 86_400_000
      ? `synth ${Math.floor(ms / 3_600_000)}h ago`
      : `synth ${Math.floor(ms / 86_400_000)}d ago`;
  return (
    <div
      className="rounded-full px-2 py-0.5 text-[9.5px] font-medium"
      style={{
        background: colors.brand.bgSoft,
        color: colors.brand.fgDark,
      }}
    >
      {label}
    </div>
  );
}

// ── Empty + error states ─────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div
        className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: colors.brand.bgSoft }}
      >
        <span style={{ color: colors.brand.fg, fontSize: 16 }}>◆</span>
      </div>
      <div className="text-sm font-semibold text-slate-700">
        Artifacts will appear here
      </div>
      <div className="mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">
        Once the pipeline runs synthesize → strategy → apps → labs,
        every output lands here as a clickable artifact.
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div
        className="mb-2 text-sm font-semibold"
        style={{ color: colors.state.bottleneckFg }}
      >
        Couldn&apos;t load artifacts
      </div>
      <div className="mb-3 text-xs text-slate-500">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md px-3 py-1.5 text-[11px] font-bold text-white"
        style={{ background: colors.brand.gradient }}
      >
        Retry
      </button>
    </div>
  );
}

// ── Generic section wrapper ─────────────────────────────────────────
function ArtifactSection({
  title,
  count,
  glyph,
  tone,
  emptyHint,
  children,
}: {
  title: string;
  count: number;
  glyph: string;
  tone: { accent: string; bg: string; fg: string };
  emptyHint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(count > 0);
  return (
    <div
      className="overflow-hidden rounded-xl border bg-white"
      style={{ borderColor: colors.neutral.borderFaint }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-slate-50"
        style={{ background: tone.bg }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[11px] font-bold"
            style={{ color: tone.accent }}
          >
            {glyph}
          </span>
          <span
            className="text-[9px] font-bold uppercase"
            style={{ color: tone.fg, letterSpacing: tracking.eyebrow }}
          >
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[10px] font-bold"
            style={{ color: tone.fg }}
          >
            {count}
          </span>
          <span className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open &&
        (count === 0 && emptyHint ? (
          <div className="px-3 py-2.5 text-[10.5px] italic text-slate-500">
            {emptyHint}
          </div>
        ) : (
          <div className="px-3 py-2.5">{children}</div>
        ))}
    </div>
  );
}

// ── Strategy Options ────────────────────────────────────────────────
function StrategyOptionsSection({
  options,
}: {
  options: FinalArtifactStrategyOption[];
}) {
  return (
    <ArtifactSection
      title="Strategy options"
      glyph="◆"
      tone={{
        accent: "#7C3AED",
        bg: "rgba(124, 58, 237, 0.10)",
        fg: "#6D28D9",
      }}
      count={options.length}
      emptyHint="No ranked strategies yet — synthesize + strategy-refresh haven't completed."
    >
      <div className="flex flex-col gap-1.5">
        {options.slice(0, 5).map((opt) => (
          <div
            key={`strat-${opt.rank}`}
            className="rounded-md px-2 py-1.5"
            style={{
              background: opt.is_primary
                ? "rgba(124, 58, 237, 0.06)"
                : "transparent",
              border: opt.is_primary
                ? "1px solid rgba(124, 58, 237, 0.18)"
                : "1px solid transparent",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="rounded-full px-1.5 text-[8.5px] font-bold"
                style={{
                  background: opt.is_primary ? "#7C3AED" : "rgba(124, 58, 237, 0.18)",
                  color: opt.is_primary ? "white" : "#6D28D9",
                }}
              >
                #{opt.rank}
              </span>
              {opt.is_primary && (
                <span
                  className="text-[8.5px] font-bold uppercase tracking-wider"
                  style={{ color: "#6D28D9" }}
                >
                  PRIMARY
                </span>
              )}
              {opt.posture && (
                <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                  · {opt.posture}
                </span>
              )}
              {opt.confidence !== null && (
                <span className="ml-auto text-[9px] font-mono text-slate-500">
                  conf {Math.round(opt.confidence * 100)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-slate-900">
              {opt.title}
            </div>
            {opt.summary && (
              <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                {opt.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Twin Proposals (problem + strategy twins) ───────────────────────
function TwinProposalsSection({
  spaceId,
  proposals,
}: {
  spaceId: string;
  proposals: FinalArtifactTwinProposal[];
}) {
  if (proposals.length === 0) return null;
  return (
    <ArtifactSection
      title="Twin proposals"
      glyph="⊙"
      tone={{
        accent: colors.state.ok,
        bg: colors.state.okSoft,
        fg: colors.state.okFg,
      }}
      count={proposals.length}
    >
      <div className="flex flex-col gap-1.5">
        {proposals.slice(0, 6).map((tp) => (
          <ProposalRow key={tp.id} proposal={tp} spaceId={spaceId} />
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Lab Proposals (twin_proposals kind=lab_twin) ────────────────────
function LabProposalsSection({
  spaceId,
  proposals,
}: {
  spaceId: string;
  proposals: FinalArtifactTwinProposal[];
}) {
  return (
    <ArtifactSection
      title="Lab proposals"
      glyph="⚗"
      tone={{
        accent: "#0F766E",
        bg: "rgba(15, 118, 110, 0.10)",
        fg: "#0F766E",
      }}
      count={proposals.length}
      emptyHint="Lab proposals appear after strategy-refresh completes."
    >
      <div className="flex flex-col gap-1.5">
        {proposals.slice(0, 6).map((tp) => (
          <ProposalRow key={tp.id} proposal={tp} spaceId={spaceId} />
        ))}
      </div>
    </ArtifactSection>
  );
}

// Shared row for twin / lab / strategy proposals
function ProposalRow({
  proposal,
  spaceId,
}: {
  proposal: FinalArtifactTwinProposal;
  spaceId: string;
}) {
  const isLab = proposal.kind === "lab_twin";
  const targetHref = isLab
    ? `/app/space/${spaceId}/lab/pick`
    : `/app/space/${spaceId}/twin`;
  const statusTone =
    proposal.user_status === "approved"
      ? { bg: colors.state.okSoft, color: colors.state.okFg, label: "APPROVED" }
      : proposal.user_status === "rejected"
      ? {
          bg: colors.state.bottleneckSoft,
          color: colors.state.bottleneckFg,
          label: "REJECTED",
        }
      : { bg: colors.brand.bgSoft, color: colors.brand.fgDark, label: "PENDING" };
  return (
    <a
      href={targetHref}
      className="block rounded-md border bg-white px-2 py-1.5 transition-colors hover:bg-slate-50"
      style={{ borderColor: colors.neutral.borderFaint }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
          style={{ background: statusTone.bg, color: statusTone.color }}
        >
          {statusTone.label}
        </span>
        <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
          · {proposal.kind.replace("_", " ")}
        </span>
      </div>
      <div className="mt-0.5 text-[11.5px] font-semibold leading-snug text-slate-900">
        {proposal.label}
      </div>
      {proposal.summary && (
        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
          {proposal.summary}
        </div>
      )}
    </a>
  );
}

// ── Variations ──────────────────────────────────────────────────────
function VariationsSection({
  variations,
  apps,
}: {
  variations: FinalArtifactVariant[];
  apps: FinalArtifactApp[];
}) {
  // Map app_id → app name for inline display.
  const appNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of apps) m.set(a.id, a.name);
    return m;
  }, [apps]);
  return (
    <ArtifactSection
      title="Variations"
      glyph="↹"
      tone={{
        accent: colors.state.leverage,
        bg: colors.state.leverageSoft,
        fg: colors.state.leverageFgDark,
      }}
      count={variations.length}
      emptyHint="Variations appear after writer-path completes (variant factory + IV scorer)."
    >
      <div className="flex flex-col gap-1.5">
        {variations.slice(0, 8).map((v) => (
          <div
            key={v.id}
            className="rounded-md border bg-white px-2 py-1.5"
            style={{
              borderColor: v.is_active
                ? colors.state.leverage
                : colors.neutral.borderFaint,
              borderLeftWidth: 3,
              borderLeftColor: v.accent_color ?? colors.state.leverage,
            }}
          >
            <div className="flex items-center gap-1.5">
              {v.is_active && (
                <span
                  className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                  style={{
                    background: colors.state.leverageChip,
                    color: colors.state.leverageFgDark,
                  }}
                >
                  ACTIVE
                </span>
              )}
              <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                {v.status}
              </span>
              {v.app_id && appNameById.has(v.app_id) && (
                <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                  · {appNameById.get(v.app_id)}
                </span>
              )}
              {v.aggregate_quality !== null && (
                <span className="ml-auto text-[9px] font-mono text-slate-500">
                  q {v.aggregate_quality.toFixed(2)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-slate-900">
              {v.label}
            </div>
            {v.summary && (
              <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                {v.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Apps + Interventions ────────────────────────────────────────────
function AppsSection({
  spaceId,
  apps,
  interventions,
}: {
  spaceId: string;
  apps: FinalArtifactApp[];
  interventions: FinalArtifactIntervention[];
}) {
  // Group interventions by app for inline summary.
  const intvByApp = useMemo(() => {
    const m = new Map<string, FinalArtifactIntervention[]>();
    for (const iv of interventions) {
      if (!iv.app_id) continue;
      const arr = m.get(iv.app_id) ?? [];
      arr.push(iv);
      m.set(iv.app_id, arr);
    }
    return m;
  }, [interventions]);
  return (
    <ArtifactSection
      title="Apps + interventions"
      glyph="□"
      tone={{
        accent: colors.state.info,
        bg: colors.state.infoChip,
        fg: colors.state.infoFg,
      }}
      count={apps.length}
      emptyHint="Apps appear after strategy-refresh + generate-apps complete."
    >
      <div className="flex flex-col gap-1.5">
        {apps.slice(0, 8).map((a) => (
          <a
            key={a.id}
            href={`/app/space/${spaceId}/app/${a.id}/whiteboard`}
            className="block rounded-md border bg-white px-2 py-1.5 transition-colors hover:bg-slate-50"
            style={{ borderColor: colors.neutral.borderFaint }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                style={{
                  background:
                    a.status === "active"
                      ? colors.state.okSoft
                      : colors.neutral.chipBgStrong,
                  color:
                    a.status === "active"
                      ? colors.state.okFg
                      : colors.neutral.fg700,
                }}
              >
                {a.status}
              </span>
              {a.app_type && (
                <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                  · {a.app_type}
                </span>
              )}
              <span className="ml-auto text-[9px] font-mono text-slate-500">
                {intvByApp.get(a.id)?.length ?? a.intervention_count} iv
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-slate-900">
              {a.name}
            </div>
            {a.description && (
              <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-600">
                {a.description}
              </div>
            )}
            {a.stale_reason && (
              <div
                className="mt-1 rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={{
                  background: colors.state.leverageSoft,
                  color: colors.state.leverageFgDark,
                }}
              >
                stale · {a.stale_reason}
              </div>
            )}
          </a>
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Lab Scaffolds ───────────────────────────────────────────────────
function LabScaffoldsSection({
  scaffolds,
}: {
  scaffolds: FinalArtifactLabScaffold[];
}) {
  if (scaffolds.length === 0) return null;
  return (
    <ArtifactSection
      title="Lab scaffolds"
      glyph="⚙"
      tone={{
        accent: "#0E7490",
        bg: "rgba(8, 145, 178, 0.08)",
        fg: "#0E7490",
      }}
      count={scaffolds.length}
    >
      <div className="flex flex-col gap-1.5">
        {scaffolds.slice(0, 6).map((ls) => (
          <div
            key={ls.id}
            className="rounded-md border bg-white px-2 py-1.5"
            style={{ borderColor: colors.neutral.borderFaint }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="rounded px-1 text-[8.5px] font-bold uppercase tracking-wider"
                style={{
                  background: colors.state.infoChip,
                  color: colors.state.infoFg,
                }}
              >
                {ls.status}
              </span>
              <span className="text-[9px] font-mono text-slate-500">
                {ls.subject_count} subjects
              </span>
              {ls.approved_at && (
                <span className="ml-auto text-[9px] font-mono text-slate-500">
                  approved
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Screens (placeholder for Phase 4) ───────────────────────────────
// Future: generated prototype images from /api/canvas/generate-screen.
// For now, a one-row placeholder that hints at what's coming.
function ScreensPlaceholderSection() {
  return (
    <ArtifactSection
      title="Screens"
      glyph="▦"
      tone={{
        accent: colors.brand.fg,
        bg: colors.brand.bgSoft,
        fg: colors.brand.fgDark,
      }}
      count={0}
      emptyHint="Phase 4 — generated prototype images for each variation will land here. Auto-recommendation picks app / website / twin per use case."
    >
      {null}
    </ArtifactSection>
  );
}
