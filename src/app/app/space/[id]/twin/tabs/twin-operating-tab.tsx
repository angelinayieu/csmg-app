"use client";

// ── Operating tab ──────────────────────────────────────────────────
//
// The "live state vs baseline" lens — labs running, predictions on
// trial, build state of the operating twin.
//
// Phase 1 scope: render a clean landing card that explains the
// operating-twin concept + shows lab status + offers a CTA to the
// legacy embedded shell (which depends on SpaceDataProvider).
//
// Phase 2 will inline-embed OperatingTwinShell here by either passing
// bundle data as props or wrapping the page in SpaceDataProvider.
// For now we surface the state honestly instead of forcing a context
// that this page's bundle architecture intentionally avoids.

import Link from "next/link";
import { ArrowUpRight, Beaker, Sparkles } from "lucide-react";
import { MechanismIcon, InterventionAppIcon } from "@/components/twin/icons/twin-icons";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

interface Props {
  spaceId: string;
  bundle: TwinPageBundle;
}

export function TwinOperatingTab({ spaceId, bundle }: Props) {
  const hasLabs = bundle.space_metadata.has_active_labs;

  return (
    <div className="space-y-5">
      <section
        className="relative overflow-hidden rounded-2xl px-8 py-7"
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
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Operating twin
            </div>
            <h2 className="mt-1.5 font-display-tight text-[22px] font-semibold leading-tight text-gray-900">
              {hasLabs
                ? "Labs are running"
                : "No active labs yet"}
            </h2>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-gray-600">
              The operating twin is the live, observable side of your system.
              It tracks the state-vs-baseline gap, runs labs, and routes
              approval items as the twin acts in reality.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                href={`/app/space/${spaceId}?tab=operation`}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-700"
              >
                Open operating shell
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
              </Link>
              {!hasLabs && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-gray-500">
                  <Sparkles className="h-3 w-3" strokeWidth={1.75} />
                  Build mode will guide you through standing one up.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Status cards — what the operating shell would surface once mounted */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          label="Active mechanisms"
          value={bundle.mechanisms.filter((m) => m.status === "active").length}
          glyph={<MechanismIcon size={13} />}
          subtitle="Live transforms wired in"
        />
        <StatusCard
          label="Materialized apps"
          value={bundle.mechanisms.reduce((acc, m) => acc + m.app_count, 0)}
          glyph={<InterventionAppIcon size={13} />}
          subtitle="Across all mechanisms"
        />
        <StatusCard
          label="Open predictions"
          value={
            bundle.prediction_history.filter((p) => !p.resolved_at).length
          }
          glyph={<Beaker className="h-3 w-3" strokeWidth={1.75} />}
          subtitle="Awaiting outcome"
        />
      </div>

      <div
        className="rounded-2xl border border-dashed border-gray-300 px-6 py-5 text-[12.5px] leading-relaxed text-gray-500"
        style={{ background: "transparent" }}
      >
        <span className="font-medium text-gray-600">Coming in Phase 2:</span>{" "}
        The full operating shell — build-mode chooser, approval queue, and
        live lab cards — will render inline here.
      </div>
    </div>
  );
}

// ── Status pill card ───────────────────────────────────────────────

function StatusCard({
  label,
  value,
  glyph,
  subtitle,
}: {
  label: string;
  value: number;
  glyph: React.ReactNode;
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
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        <span aria-hidden style={{ color: "var(--accent-500)" }}>
          {glyph}
        </span>
        {label}
      </div>
      <div className="mt-3 font-display-tight text-[36px] font-semibold leading-none text-gray-900">
        {value}
      </div>
      <div className="mt-auto pt-3 text-[11px] text-gray-500">{subtitle}</div>
    </article>
  );
}
