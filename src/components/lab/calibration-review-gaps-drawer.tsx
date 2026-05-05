"use client";

// ── CalibrationReviewGapsDrawer ─────────────────────────────────────────
//
// Gap B, third surface: when calibration is `uncalibrated` or `partial`,
// the strip's "Review gaps" button opens this drawer. It lists every
// ReproductionAttempt that is NOT `reproduced`, grouped by verdict, with
// the rationale + blocker entity chips per attempt.
//
// This is the user's primary actionable output for Gap B. The strip tells
// them "the KG doesn't match reality"; the drawer tells them *which*
// baselines, *why* the KG disagreed, and *which entities* need more info.
// Clicking a blocker chip focuses that node in the lab — bridging from
// diagnosis back to the KG surface where they can fix it.
//
// Design intent:
//   - Dark slide-over on the right (matches lab chrome, not the dashboard's
//     bright drawer) so the cognitive register stays "lab instrument".
//   - Verdict grouping because rationale reads differently for `off`
//     ("the KG computed 0.45, you stated 0.80 — this edge's polarity is
//     likely wrong") vs. `unverifiable` ("the KG has no edge between X
//     and Y — add one or point to a mechanism").
//   - No primary "run anyway" CTA in the drawer — that stays on the strip
//     as a deliberate second step. This drawer is for *understanding*.
//
// Fetches: /api/lab/calibration?space_id=... — returns the full
// ReproductionAttempt[] plus the computed_at timestamp.

import { useEffect, useState } from "react";
import { X, AlertTriangle, HelpCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullscreenDrawer } from "@/components/canvas/drawers/use-fullscreen-drawer";
import { DrawerFullscreenButton } from "@/components/canvas/drawers/drawer-fullscreen-button";
import type { Entity } from "@/types";
import type { ReproductionAttempt } from "@/types/calibration";

export interface CalibrationReviewGapsDrawerProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Entity lookup (uuid → Entity) for name resolution on blocker chips. */
  entitiesByUuid: Map<string, Entity>;
  /** Called when the user clicks a blocker entity chip — caller wires it
   *  to their node-focus state (LabReagentBay selection, canvas zoom, etc.). */
  onFocusEntity?: (entityId: string) => void;
}

interface CalibrationResponse {
  attempts: ReproductionAttempt[];
  computed_at: string | null;
  aggregate_score?: number;
}

export function CalibrationReviewGapsDrawer({
  open,
  onClose,
  spaceId,
  entitiesByUuid,
  onFocusEntity,
}: CalibrationReviewGapsDrawerProps) {
  const [attempts, setAttempts] = useState<ReproductionAttempt[] | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [aggregateScore, setAggregateScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/lab/calibration?space_id=${encodeURIComponent(spaceId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) {
            setError(`Failed to load calibration (HTTP ${res.status})`);
            setLoading(false);
          }
          return;
        }
        const body = (await res.json()) as CalibrationResponse;
        if (cancelled) return;
        setAttempts(body.attempts ?? []);
        setComputedAt(body.computed_at ?? null);
        setAggregateScore(
          typeof body.aggregate_score === "number" ? body.aggregate_score : null,
        );
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Fullscreen toggle — useFullscreenDrawer manages Esc-to-restore
  // and resets when the drawer closes. Hook MUST run on every render
  // (even when !open) to keep hook order stable across renders.
  const { isFullscreen, toggleFullscreen } = useFullscreenDrawer(open);

  if (!open) return null;

  const gaps = (attempts ?? []).filter((a) => a.verdict !== "reproduced");
  const offAttempts = gaps.filter((a) => a.verdict === "off");
  const unverifiableAttempts = gaps.filter((a) => a.verdict === "unverifiable");

  return (
    <>
      {/* Scrim — click to dismiss. Darker than the dashboard drawer so
          the lab's dark-chrome register holds. */}
      <div
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Review calibration gaps"
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-[var(--lab-border-strong)] bg-[var(--lab-panel-bg)] shadow-2xl transition-[max-width] duration-200 ease-out",
          isFullscreen ? "max-w-none" : "max-w-[440px]",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--lab-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--lab-accent)]/80">
              Gap B — LLM Reality Audit
            </div>
            <div className="mt-0.5 text-[14px] font-semibold text-[var(--lab-text)]">
              Where the KG disagrees with your stated reality
            </div>
            <div className="mt-0.5 text-[10.5px] text-[var(--lab-text-mid)]">
              Verdicts below are produced by an LLM reading the KG subgraph,
              not by numerical reconciliation against the claim ledger.
              Treat as an audit prompt, not a measurement.
            </div>
            {computedAt && (
              <div className="mt-0.5 text-[11px] text-[var(--lab-text-mid)]">
                Checked {new Date(computedAt).toLocaleString()}
                {typeof aggregateScore === "number" && (
                  <>
                    {" · "}
                    <span className="font-mono tabular-nums">
                      {(aggregateScore * 100).toFixed(0)}%
                    </span>{" "}
                    aggregate
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <DrawerFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--lab-border)] bg-transparent text-[var(--lab-text-mid)] hover:bg-[var(--lab-panel-raised)] hover:text-[var(--lab-text)]"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="py-12 text-center text-[12px] text-[var(--lab-text-mid)]">
              Loading attempts…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          )}
          {!loading && !error && gaps.length === 0 && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-[12px] text-emerald-300">
              No calibration gaps — every declared baseline is reproduced by
              the KG within tolerance. The lab is unlocked.
            </div>
          )}

          {offAttempts.length > 0 && (
            <Section
              title="Off-target"
              tagline="The KG reproduces these baselines but outside tolerance. Usually a parameter or polarity problem."
              icon={AlertTriangle}
              tone="off"
            >
              {offAttempts.map((a, i) => (
                <AttemptCard
                  key={`off-${i}`}
                  attempt={a}
                  entitiesByUuid={entitiesByUuid}
                  onFocusEntity={onFocusEntity}
                />
              ))}
            </Section>
          )}

          {unverifiableAttempts.length > 0 && (
            <Section
              title="Unverifiable"
              tagline="The KG lacks enough structure to even attempt these. Add the missing edges or parameters on the flagged entities."
              icon={HelpCircle}
              tone="unverifiable"
            >
              {unverifiableAttempts.map((a, i) => (
                <AttemptCard
                  key={`uv-${i}`}
                  attempt={a}
                  entitiesByUuid={entitiesByUuid}
                  onFocusEntity={onFocusEntity}
                />
              ))}
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--lab-border)] px-4 py-2 text-[11px] leading-relaxed text-[var(--lab-text-mid)]">
          This view is advisory, not punitive. A failing gate means the model
          of the world doesn&apos;t yet match the world — fix the KG, or bypass
          to continue simulating proposals at your own risk.
        </div>
      </aside>
    </>
  );
}

// ── Section header ──────────────────────────────────────────────────────

function Section({
  title,
  tagline,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  tagline: string;
  icon: typeof AlertTriangle;
  tone: "off" | "unverifiable";
  children: React.ReactNode;
}) {
  const accent = tone === "off" ? "#f87171" : "#f59e0b";
  return (
    <section className="mb-5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: accent }}
        >
          {title}
        </span>
      </div>
      <div className="mb-2 text-[11px] text-[var(--lab-text-mid)]">
        {tagline}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// ── Attempt card ────────────────────────────────────────────────────────

function AttemptCard({
  attempt,
  entitiesByUuid,
  onFocusEntity,
}: {
  attempt: ReproductionAttempt;
  entitiesByUuid: Map<string, Entity>;
  onFocusEntity?: (entityId: string) => void;
}) {
  const { baseline, computed_value, relative_error, rationale, blocker_entity_ids, tolerance } =
    attempt;

  // The baseline may carry numeric `value` OR qualitative `value_text`
  // (from MetricBaseline). Show whichever is set.
  const stated =
    typeof baseline.value === "number"
      ? formatNumber(baseline.value)
      : baseline.value_text ?? "(unset)";
  const computed =
    typeof computed_value === "number"
      ? formatNumber(computed_value)
      : attempt.computed_value_text ?? "—";

  // Per-attempt provenance — how was this verdict derived? The numerical
  // path compares to a tracker observation or matched entity parameter;
  // the LLM path is prose judgment. Disclose with a colored chip so
  // users can tell at a glance whether this row is deterministic or a
  // language-model call.
  const prov = attempt.verdict_provenance ?? "llm_audit";
  const isNumerical = prov === "numerical_recompute";

  return (
    <div className="rounded-md border border-[var(--lab-border)] bg-[var(--lab-panel-raised)] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className="inline-flex h-3.5 items-center gap-0.5 rounded px-1 text-[9px] font-bold uppercase tracking-wide"
          style={{
            background: isNumerical
              ? "rgba(37, 99, 235, 0.15)"
              : "rgba(217, 119, 6, 0.15)",
            color: isNumerical ? "#60a5fa" : "#fbbf24",
          }}
          title={
            isNumerical
              ? "Numerical reconciliation — deterministic comparison against tracker observation or matched entity parameter. No LLM."
              : "LLM audit — the calibration agent judged whether the KG reproduces this baseline. Treat as advisory."
          }
        >
          {isNumerical ? "⚡ NUM" : "✎ LLM"}
        </span>
        <span className="text-[12px] font-semibold text-[var(--lab-text)]">
          {baseline.label}
        </span>
      </div>

      {/* Stated vs. computed — two-column mini table */}
      <div className="mb-2 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-mid)]">
            You stated
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[var(--lab-text)]">
            {stated}
            {baseline.unit ? (
              <span className="ml-1 text-[10px] text-[var(--lab-text-mid)]">
                {baseline.unit}
              </span>
            ) : null}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-mid)]">
            KG reproduced
          </div>
          <div className="mt-0.5 font-mono tabular-nums text-[var(--lab-text)]">
            {computed}
            {typeof relative_error === "number" && (
              <span className="ml-1 text-[10px] text-red-300">
                (±{(relative_error * 100).toFixed(0)}%, tol {Math.round(tolerance * 100)}%)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Agent rationale */}
      <div className="mb-2 text-[11px] leading-relaxed text-[var(--lab-text-mid)]">
        {rationale}
      </div>

      {/* Blocker entity chips */}
      {blocker_entity_ids.length > 0 && (
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-[var(--lab-text-mid)]">
            Entities to inspect
          </div>
          <div className="flex flex-wrap gap-1">
            {blocker_entity_ids.map((id) => {
              const ent = entitiesByUuid.get(id);
              const name = ent?.name ?? id.slice(0, 8);
              return (
                <button
                  key={id}
                  onClick={() => onFocusEntity?.(id)}
                  disabled={!onFocusEntity}
                  className="inline-flex items-center gap-0.5 rounded border border-[var(--lab-border)] bg-[var(--lab-bg)] px-1.5 py-0.5 text-[10px] text-[var(--lab-text)] hover:border-[var(--lab-accent)]/60 hover:text-[var(--lab-accent)] disabled:cursor-default disabled:opacity-70 disabled:hover:border-[var(--lab-border)] disabled:hover:text-[var(--lab-text)]"
                  title={ent?.description ?? undefined}
                >
                  {name}
                  {onFocusEntity && <ChevronRight className="h-2.5 w-2.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 10) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(3);
  return n.toExponential(2);
}
