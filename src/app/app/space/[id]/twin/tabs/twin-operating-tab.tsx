"use client";

// ── Operating tab ──────────────────────────────────────────────────
//
// The "live state vs baseline" lens — labs running, predictions on
// trial, build state of the operating twin.
//
// W4 (Phase 3): inline-embeds OperatingTwinShell using the
// /operating-twin-context endpoint. The shell was refactored to
// accept props instead of useSpaceData, so we can mount it without
// wrapping the entire Twin Detail Page in SpaceDataProvider.
//
// Loading + error states keep layout stable so users never see a
// content jump when switching to this tab.

import { useEffect, useState } from "react";
import { Beaker } from "lucide-react";
import { OperatingTwinShell } from "@/components/operating-twin/operating-twin-shell";
import type { OperatingTwinContextPayload } from "@/app/api/spaces/[id]/operating-twin-context/route";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
  /** Most recent realtime event timestamp from the page-level
   *  subscription. When it ticks, we re-fetch the operating context
   *  so the inline shell stays as alive as the bundle-driven tabs. */
  lastEventAt: number | null;
}

export function TwinOperatingTab({ spaceId, bundle, lastEventAt }: Props) {
  const [ctxData, setCtxData] = useState<OperatingTwinContextPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/spaces/${spaceId}/operating-twin-context`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OperatingTwinContextPayload;
        if (!cancelled) setCtxData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Realtime sync — when the page-level subscription fires, refetch
  // the operating context (silently, no skeleton flash) so the inline
  // shell stays in sync with mechanism/prediction/observation events.
  // Skip the initial mount where lastEventAt is still null.
  useEffect(() => {
    if (lastEventAt === null) return;
    let cancelled = false;
    fetch(`/api/spaces/${spaceId}/operating-twin-context`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as OperatingTwinContextPayload;
        if (!cancelled) setCtxData(json);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [lastEventAt, spaceId]);

  // The shell renders inside a fixed-height container — the parent
  // tab has natural flow, so we give the shell enough vertical room
  // (~70vh) to lay out its 3-panel grid without scrolling the page.
  return (
    <div className="space-y-5">
      {loading && <OperatingShellSkeleton />}

      {error && !ctxData && (
        <ErrorCard message={error} />
      )}

      {ctxData && (
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            background: "var(--glass-card-bg)",
            boxShadow: "var(--shadow-card)",
            backdropFilter: "blur(var(--blur-card))",
            WebkitBackdropFilter: "blur(var(--blur-card))",
            height: "min(72vh, 820px)",
          }}
        >
          <OperatingTwinShell
            inputs={{
              space: ctxData.space,
              entities: ctxData.entities,
              edges: ctxData.edges,
              cycles: ctxData.cycles,
              claims: ctxData.claims,
              propositions: ctxData.propositions,
              activeGoal: ctxData.activeGoal,
              childGoals: ctxData.childGoals,
              pendingObjectives: ctxData.pendingObjectives,
            }}
            // entity selection / chat aren't wired on this page yet —
            // those slide-outs live on the canvas. Omitting the
            // callbacks makes the buttons no-op gracefully (per the
            // shell's prop contract).
            onRefresh={async () => {
              // Soft refresh: re-fetch our own context payload.
              try {
                const res = await fetch(
                  `/api/spaces/${spaceId}/operating-twin-context`,
                  { cache: "no-store" },
                );
                if (!res.ok) return;
                setCtxData(
                  (await res.json()) as OperatingTwinContextPayload,
                );
              } catch {
                /* non-fatal */
              }
            }}
          />
        </div>
      )}

      {/* Quick status row — reads from the bundle (already loaded)
          so the user gets a glance even while the shell hydrates. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          label="Active mechanisms"
          value={bundle.mechanisms.filter((m) => m.status === "active").length}
          subtitle="Live transforms wired in"
        />
        <StatusCard
          label="Materialized apps"
          value={bundle.mechanisms.reduce((acc, m) => acc + m.app_count, 0)}
          subtitle="Across all mechanisms"
        />
        <StatusCard
          label="Open predictions"
          value={
            bundle.prediction_history.filter((p) => !p.resolved_at).length
          }
          subtitle="Awaiting outcome"
        />
      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────

function OperatingShellSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
        height: "min(72vh, 820px)",
      }}
    >
      <div className="h-full animate-pulse p-3">
        <div
          className="h-full grid gap-2.5"
          style={{ gridTemplateColumns: "280px 1fr 300px" }}
        >
          <div className="rounded-[14px] bg-black/[0.04]" />
          <div className="rounded-[14px] bg-black/[0.04]" />
          <div className="rounded-[14px] bg-black/[0.04]" />
        </div>
      </div>
    </div>
  );
}

// ── Error card ─────────────────────────────────────────────────────

function ErrorCard({ message }: { message: string }) {
  return (
    <article
      className="relative rounded-2xl px-8 py-7"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "rgba(15,23,42,0.04)",
            color: "var(--accent-500)",
          }}
        >
          <Beaker className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            Operating twin
          </div>
          <h2 className="mt-1.5 font-display-tight text-[20px] font-semibold leading-tight text-gray-900">
            Couldn&apos;t load the operating context
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
            {message}
          </p>
        </div>
      </div>
    </article>
  );
}

// ── Status card ────────────────────────────────────────────────────

function StatusCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: number;
  subtitle: string;
}) {
  return (
    <article
      className="flex flex-col rounded-2xl px-6 py-5"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      <div className="mt-3 font-display-tight text-[36px] font-semibold leading-none text-gray-900 tabular-nums">
        {value}
      </div>
      <div className="mt-auto pt-3 text-[11px] text-gray-500">{subtitle}</div>
    </article>
  );
}
