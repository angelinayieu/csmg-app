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
import type {
  ScreenRow,
  ScreensListResponse,
} from "@/app/api/spaces/[id]/screens/route";
import { GuardrailQuestionQueue } from "./guardrail-question-queue";
import {
  GenerateScreenModal,
  type GenerateScreenTarget,
} from "./generate-screen-modal";
import { ScreenLightbox } from "./screen-lightbox";
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

  // ── Screens state (Phase 4) ─────────────────────────────────────────
  // Separate poll because /screens has its own cadence + can refresh
  // on demand right after a generation success. Modal + lightbox state
  // live at the panel root so they overlay everything correctly.
  const [screens, setScreens] = useState<ScreenRow[]>([]);
  const [modalTarget, setModalTarget] = useState<GenerateScreenTarget | null>(
    null,
  );
  const [lightboxScreen, setLightboxScreen] = useState<ScreenRow | null>(null);

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

  const fetchScreens = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/screens?limit=80`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as ScreensListResponse;
      setScreens(body.screens);
    } catch {
      // Non-fatal — section just renders empty until next poll.
    }
  }, [spaceId]);

  // Initial fetch + 12s polling. Polling stops when the panel
  // unmounts. We don't pause when nothing is running because the user
  // may navigate here right as a chain completes — over-fetching by
  // 1-2 cycles is cheap insurance.
  useEffect(() => {
    void fetchArtifacts();
    void fetchScreens();
    const interval = window.setInterval(() => {
      void fetchArtifacts();
      void fetchScreens();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchArtifacts, fetchScreens]);

  // ── Open-screen-modal handler — passed to artifact rows ──
  // We hoist this so VariationRow / AppRow / StrategyRow can all
  // trigger it with their target context without each row needing
  // its own modal instance.
  const openGenerateModal = useCallback(
    (target: GenerateScreenTarget) => {
      setModalTarget(target);
    },
    [],
  );

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
            <StrategyOptionsSection
              options={data.strategy_options}
              onGenerateScreen={openGenerateModal}
            />
            <LabProposalsSection spaceId={spaceId} proposals={data.lab_proposals} />
            <TwinProposalsSection spaceId={spaceId} proposals={data.twin_proposals} />
            <VariationsSection
              variations={data.variations}
              apps={data.apps}
              onGenerateScreen={openGenerateModal}
            />
            <AppsSection
              spaceId={spaceId}
              apps={data.apps}
              interventions={data.interventions}
              onGenerateScreen={openGenerateModal}
            />
            <LabScaffoldsSection scaffolds={data.lab_scaffolds} />
            <ScreensSection
              screens={screens}
              onOpenLightbox={setLightboxScreen}
            />
          </div>
        )}
      </div>

      {/* ── Guardrail queue (unchanged) ───────────────────────────── */}
      <GuardrailQuestionQueue spaceId={spaceId} />

      {/* ── Generate-screen modal ──
       *  Mounted at the panel root so it overlays the entire right
       *  column. modalTarget=null means closed; setting via
       *  openGenerateModal opens with target pre-filled. */}
      <GenerateScreenModal
        target={modalTarget}
        spaceId={spaceId}
        onClose={() => setModalTarget(null)}
        onSuccess={(row) => {
          setModalTarget(null);
          // Optimistically prepend the new screen so the section
          // shows it immediately, then refresh from the server on
          // the next poll cycle to sync remote state.
          setScreens((prev) => [row, ...prev]);
          void fetchScreens();
        }}
      />

      {/* ── Lightbox ──
       *  Same root mount so backdrop click + Esc work without portal
       *  collisions. lightboxScreen=null means closed. */}
      {lightboxScreen && (
        <ScreenLightbox
          screen={lightboxScreen}
          onClose={() => setLightboxScreen(null)}
          onRegenerate={() => {
            // Close the lightbox + open the modal pre-filled with
            // the source target. User can tweak brief/type and submit.
            setLightboxScreen(null);
            setModalTarget({
              kind:
                lightboxScreen.target_kind as GenerateScreenTarget["kind"],
              id: lightboxScreen.target_id ?? null,
              label:
                lightboxScreen.target_label ??
                `${lightboxScreen.target_kind} screen`,
              hints: undefined,
            });
          }}
          onDelete={async () => {
            // Optimistic local removal + best-effort server delete.
            // Failure leaves the row server-side; next poll catches.
            setScreens((prev) =>
              prev.filter((s) => s.id !== lightboxScreen.id),
            );
            setLightboxScreen(null);
            // TODO: wire DELETE /api/spaces/[id]/screens/[id] when
            // we add it. For now this is local-only.
          }}
          targetHref={
            lightboxScreen.target_kind === "app" && lightboxScreen.target_id
              ? `/app/space/${spaceId}/app/${lightboxScreen.target_id}/whiteboard`
              : undefined
          }
        />
      )}
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
  onGenerateScreen,
}: {
  options: FinalArtifactStrategyOption[];
  onGenerateScreen: (target: GenerateScreenTarget) => void;
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
            className="group relative rounded-md px-2 py-1.5"
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
            {/* +Screen CTA — only on hover, primary strategies get
             *  the affordance most often so this is well-positioned
             *  in the top-right gutter of the row. */}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onGenerateScreen({
                  kind: "strategy",
                  id: null,
                  label: opt.title,
                  hints: {
                    target_summary: opt.summary,
                    posture: opt.posture ?? undefined,
                  },
                });
              }}
              className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
              style={{
                background: colors.brand.bgSoft,
                color: colors.brand.fgDark,
              }}
            >
              ⊕ Screen
            </button>
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
  onGenerateScreen,
}: {
  variations: FinalArtifactVariant[];
  apps: FinalArtifactApp[];
  onGenerateScreen: (target: GenerateScreenTarget) => void;
}) {
  // Map app_id → app name for inline display + for the hint context.
  const appsById = useMemo(() => {
    const m = new Map<string, FinalArtifactApp>();
    for (const a of apps) m.set(a.id, a);
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
        {variations.slice(0, 8).map((v) => {
          const parentApp = v.app_id ? appsById.get(v.app_id) : null;
          return (
            <div
              key={v.id}
              className="group rounded-md border bg-white px-2 py-1.5"
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
                {parentApp && (
                  <span className="text-[8.5px] uppercase tracking-wider text-slate-500">
                    · {parentApp.name}
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
              {/* +Screen CTA — only on hover so the row stays calm at rest */}
              <div className="mt-1.5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onGenerateScreen({
                      kind: "variation",
                      id: v.id,
                      label: v.label,
                      hints: {
                        target_summary: v.summary ?? undefined,
                        app_type: parentApp?.app_type ?? undefined,
                      },
                    });
                  }}
                  className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    background: colors.brand.bgSoft,
                    color: colors.brand.fgDark,
                  }}
                >
                  ⊕ Screen
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ArtifactSection>
  );
}

// ── Apps + Interventions ────────────────────────────────────────────
function AppsSection({
  spaceId,
  apps,
  interventions,
  onGenerateScreen,
}: {
  spaceId: string;
  apps: FinalArtifactApp[];
  interventions: FinalArtifactIntervention[];
  onGenerateScreen: (target: GenerateScreenTarget) => void;
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
        {apps.slice(0, 8).map((a) => {
          const ivs = intvByApp.get(a.id) ?? [];
          return (
            <div
              key={a.id}
              className="group relative rounded-md border bg-white px-2 py-1.5 transition-colors hover:bg-slate-50"
              style={{ borderColor: colors.neutral.borderFaint }}
            >
              <a
                href={`/app/space/${spaceId}/app/${a.id}/whiteboard`}
                className="block"
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
                    {ivs.length} iv
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
              {/* +Screen CTA — appears on hover, positioned in the
               *  top-right corner so it doesn't compete with the
               *  status chip. */}
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  ev.preventDefault();
                  onGenerateScreen({
                    kind: "app",
                    id: a.id,
                    label: a.name,
                    hints: {
                      target_summary: a.description ?? undefined,
                      app_type: a.app_type ?? undefined,
                      intervention_titles: ivs.map((iv) => iv.title),
                    },
                  });
                }}
                className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background: colors.brand.bgSoft,
                  color: colors.brand.fgDark,
                }}
              >
                ⊕ Screen
              </button>
            </div>
          );
        })}
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

// ── Screens (Phase 4) ───────────────────────────────────────────────
// Renders generated prototype mockups grouped by target artifact.
// Each group: "Screens for X" header + 2-column thumbnail grid +
// click → lightbox.
//
// Aspect ratios:
//   portrait  → 9:16 (mobile)
//   landscape → 16:10 (web/dashboard)
//   square    → 1:1
// We CSS-clip thumbnails to a uniform tile while preserving the
// underlying aspect via object-cover, so the grid stays regular but
// the image is recognizable.
function ScreensSection({
  screens,
  onOpenLightbox,
}: {
  screens: ScreenRow[];
  onOpenLightbox: (screen: ScreenRow) => void;
}) {
  // Group by target — `${kind}:${id ?? "none"}` as the key. Use a
  // stable display name from the most recent screen in the group
  // (we order newest-first, so it's the first row we see).
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; kind: string; rows: ScreenRow[] }
    >();
    for (const s of screens) {
      const key = `${s.target_kind}:${s.target_id ?? "none"}`;
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(s);
      } else {
        map.set(key, {
          label: s.target_label ?? `${s.target_kind} screen`,
          kind: s.target_kind,
          rows: [s],
        });
      }
    }
    return Array.from(map.values());
  }, [screens]);

  return (
    <ArtifactSection
      title="Screens"
      glyph="▦"
      tone={{
        accent: colors.brand.fg,
        bg: colors.brand.bgSoft,
        fg: colors.brand.fgDark,
      }}
      count={screens.length}
      emptyHint="Hover any app, variation, or strategy → click ⊕ Screen to generate a prototype mockup."
    >
      <div className="flex flex-col gap-3">
        {groups.map((group, gIdx) => (
          <div key={`grp-${gIdx}`} className="flex flex-col gap-1.5">
            {/* Group header */}
            <div className="flex items-baseline justify-between gap-2">
              <div
                className="truncate text-[10px] font-semibold uppercase"
                style={{
                  color: colors.brand.fgDark,
                  letterSpacing: tracking.eyebrowTight,
                }}
                title={group.label}
              >
                {group.label}
              </div>
              <div className="shrink-0 text-[9px] font-mono text-slate-500">
                {group.rows.length} screen{group.rows.length === 1 ? "" : "s"}
              </div>
            </div>

            {/* Thumbnail grid — 2 columns. Aspect-ratio per screen via
             *  inline style. Generating screens render as shimmering
             *  skeletons at the right aspect; errors show a dim card. */}
            <div className="grid grid-cols-2 gap-1.5">
              {group.rows.slice(0, 4).map((s) => (
                <ScreenThumb
                  key={s.id}
                  screen={s}
                  onClick={() => onOpenLightbox(s)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ArtifactSection>
  );
}

// ── Single thumbnail tile ──────────────────────────────────────────
function ScreenThumb({
  screen,
  onClick,
}: {
  screen: ScreenRow;
  onClick: () => void;
}) {
  // Map aspect_ratio enum to CSS aspect-ratio. Tiles share a uniform
  // height target via the parent grid, so we set aspect on the inner
  // image only and let the wrapper take the natural aspect.
  const aspectStyle =
    screen.aspect_ratio === "portrait"
      ? { aspectRatio: "9 / 16" }
      : screen.aspect_ratio === "square"
      ? { aspectRatio: "1 / 1" }
      : { aspectRatio: "16 / 10" };

  if (screen.status === "ready" && screen.image_url) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group relative block overflow-hidden rounded-lg border bg-white transition-all hover:-translate-y-0.5"
        style={{
          ...aspectStyle,
          borderColor: colors.neutral.borderFaint,
          boxShadow: colors.neutral.cardShadow,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screen.image_url}
          alt={screen.target_label ?? "Generated screen"}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
          loading="lazy"
        />
        {/* Type chip in the corner */}
        <span
          className="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider"
          style={{
            background: "rgba(8, 12, 22, 0.7)",
            color: "white",
            backdropFilter: "blur(4px)",
          }}
        >
          {screen.artifact_type}
        </span>
      </button>
    );
  }

  if (screen.status === "generating" || screen.status === "pending") {
    return (
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{
          ...aspectStyle,
          borderColor: colors.brand.haloSoft,
          background: colors.brand.bgSoft,
        }}
      >
        {/* Shimmer effect */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${colors.brand.bgChip} 50%, transparent 100%)`,
            animation: "upload-toast-sweep 1.8s ease-in-out infinite",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{
              color: colors.brand.fgDark,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            Generating…
          </span>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div
      className="flex items-center justify-center rounded-lg border p-3 text-center"
      style={{
        ...aspectStyle,
        borderColor: colors.state.bottleneckSoft,
        background: "white",
      }}
    >
      <div
        className="text-[10px] leading-snug"
        style={{ color: colors.state.bottleneckFg }}
      >
        Failed
        {screen.error_message ? `: ${screen.error_message.slice(0, 40)}…` : ""}
      </div>
    </div>
  );
}
