"use client";

// ── Mechanism detail drawer ────────────────────────────────────────
//
// Right-edge floating panel that opens when the user picks a row in
// the Mechanism grid. Fetches the lightweight per-mechanism summary
// endpoint built in Phase 0 — one DB round-trip, no full bundle
// refresh. Closes on backdrop click or Escape.
//
// Apple-glass aesthetic: opaque-ish frosted card sliding in from the
// right with a soft backdrop. Renders kind + rationale + cycle
// pattern + apps list + agent count. Empty/loading states keep the
// drawer layout stable so the user never sees content jump.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { X, ArrowUpRight } from "lucide-react";
import {
  MechanismIcon,
  InterventionAppIcon,
  PredictionIcon,
} from "@/components/twin/icons/twin-icons";
import { toast } from "@/lib/hooks/use-toast";
import type { MechanismSummary } from "@/app/api/spaces/[id]/mechanisms/[mechId]/summary/route";

interface Props {
  spaceId: string;
  mechanismId: string | null;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  simulation: "Simulation",
  prediction: "Prediction",
  validation: "Validation",
  baseline_tracking: "Baseline tracking",
  deviation_capture: "Deviation capture",
  game: "Game",
  ml_personalization: "ML personalization",
};

export function TwinMechanismDetailDrawer({
  spaceId,
  mechanismId,
  onClose,
}: Props) {
  const [mechanism, setMechanism] = useState<MechanismSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Portal target — wait for client mount so SSR doesn't trip.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape-to-close.
  useEffect(() => {
    if (!mechanismId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mechanismId, onClose]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!mechanismId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mechanismId]);

  // Fetch summary whenever the id changes.
  useEffect(() => {
    if (!mechanismId) {
      setMechanism(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMechanism(null);

    fetch(
      `/api/spaces/${spaceId}/mechanisms/${mechanismId}/summary`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { mechanism: MechanismSummary };
        if (cancelled) return;
        setMechanism(json.mechanism);
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
  }, [spaceId, mechanismId]);

  if (!mounted || !mechanismId) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/15 transition-opacity"
        onClick={onClose}
      />
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto px-7 py-6"
        style={{
          background: "var(--glass-float-bg)",
          boxShadow: "var(--shadow-float)",
          backdropFilter: "blur(var(--blur-float))",
          WebkitBackdropFilter: "blur(var(--blur-float))",
          animation: "twin-drawer-in 240ms var(--ease-out-quart)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/[0.04] hover:text-gray-900"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>

        {loading && <DrawerSkeleton />}
        {error && (
          <div className="mt-12 text-[13px] text-gray-600">
            Couldn&apos;t load this mechanism: {error}.
          </div>
        )}
        {mechanism && (
          <DrawerBody
            mechanism={mechanism}
            spaceId={spaceId}
            onClose={onClose}
          />
        )}
      </aside>

      <style jsx>{`
        @keyframes twin-drawer-in {
          from {
            transform: translateX(16px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}

// ── Body ──────────────────────────────────────────────────────────

function DrawerBody({
  mechanism,
  spaceId,
  onClose,
}: {
  mechanism: MechanismSummary;
  spaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const kindLabel = KIND_LABEL[mechanism.kind] ?? mechanism.kind;

  // Build app from this mechanism: kick the existing generate-apps
  // pipeline (no mechanism scope on the endpoint yet — Phase 4 will
  // scope; for now we trigger a general regen + close the drawer +
  // route to the canvas where the user can watch new apps appear).
  const handleBuildApp = async () => {
    if (building) return;
    setBuilding(true);
    try {
      const res = await fetch(`/api/pipeline/generate-apps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId,
          triggeredBy: `mechanism_drawer:${mechanism.id}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("App generation started", {
        description:
          "Open the canvas to watch new app cards land for this mechanism.",
      });
      onClose();
      router.push(`/app/space/${spaceId}/whiteboard`);
    } catch (err) {
      toast.error("Couldn't start app build", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        <MechanismIcon size={11} />
        {kindLabel} · {mechanism.status}
      </div>
      <h2 className="mt-2 font-display-tight text-[22px] font-semibold leading-tight text-gray-900">
        {mechanism.name}
      </h2>

      {mechanism.cycle_pattern && (
        <Section label="Cycle pattern">
          <p className="text-[13px] leading-relaxed text-gray-700">
            {mechanism.cycle_pattern}
          </p>
        </Section>
      )}

      {mechanism.rationale && (
        <Section label="Why this mechanism">
          <p className="text-[13px] leading-relaxed text-gray-700">
            {mechanism.rationale}
          </p>
        </Section>
      )}

      {/* ── Entities this touches ─────────────────────────────── */}
      {mechanism.entities.length > 0 && (
        <Section label="Entities this touches">
          <div className="flex flex-wrap gap-1.5">
            {mechanism.entities.map((e) => (
              <EntityRefChip
                key={e.id}
                entity={e}
                spaceId={spaceId}
                onNavigate={onClose}
              />
            ))}
          </div>
        </Section>
      )}

      <Section label="Apps materialized from this mechanism">
        {mechanism.apps.length === 0 ? (
          <p className="text-[12.5px] italic text-gray-400">
            No apps yet — this mechanism hasn&apos;t been materialized
            into a runnable artifact.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mechanism.apps.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 text-[12.5px] text-gray-700"
              >
                <InterventionAppIcon size={11} />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto text-[10.5px] uppercase tracking-wide text-gray-400">
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Predictions from this mechanism ──────────────────── */}
      {mechanism.predictions.length > 0 && (
        <Section label={`Predictions from this mechanism · ${mechanism.predictions.length}`}>
          <ul className="space-y-2">
            {mechanism.predictions.map((p) => (
              <MechanismPredictionRow key={p.id} prediction={p} />
            ))}
          </ul>
        </Section>
      )}

      <Section label="Agents assigned">
        <p className="text-[13px] text-gray-700">
          {mechanism.agent_count} agent{mechanism.agent_count === 1 ? "" : "s"}{" "}
          wired in
        </p>
      </Section>

      {/* ── Build app CTA ────────────────────────────────────── */}
      <div className="mt-7 border-t border-black/[0.04] pt-5">
        <button
          onClick={handleBuildApp}
          disabled={building}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-gray-900 px-4 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {building ? "Starting build…" : "Build app from this mechanism"}
          {!building && (
            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
          )}
        </button>
        <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
          Triggers the app-generation pipeline. New apps that land
          under this mechanism will appear on the canvas.
        </p>
      </div>
    </div>
  );
}

// ── Entity chip ────────────────────────────────────────────────────

const CATEGORY_DOT: Record<string, string> = {
  concrete: "var(--accent-500)",
  abstract: "#a78bfa",
  process: "#34d399",
  relational: "#f472b6",
  epistemic: "#fbbf24",
};

function EntityRefChip({
  entity,
  spaceId,
  onNavigate,
}: {
  entity: MechanismSummary["entities"][number];
  spaceId: string;
  /** Close the drawer on click — the route change unmounts the
   *  TwinDetailClient tree anyway, but closing first avoids the
   *  drawer flashing during navigation. */
  onNavigate?: () => void;
}) {
  const dot = CATEGORY_DOT[entity.entity_category] ?? "var(--accent-500)";
  return (
    <Link
      href={`/app/space/${spaceId}/entity/${entity.id}`}
      onClick={onNavigate}
      className="inline-flex max-w-[200px] items-center gap-1.5 truncate rounded-full border border-black/[0.05] bg-white/60 px-2.5 py-1 text-[11.5px] font-medium text-gray-700 transition hover:border-black/[0.15] hover:bg-white hover:text-gray-900"
      title={`${entity.entity_category}${entity.importance ? ` · ${entity.importance}` : ""}`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: dot }}
      />
      <span className="truncate">{entity.name}</span>
    </Link>
  );
}

// ── Prediction row ─────────────────────────────────────────────────

function MechanismPredictionRow({
  prediction,
}: {
  prediction: MechanismSummary["predictions"][number];
}) {
  const resolved = prediction.status === "resolved";
  const value =
    prediction.predicted_value !== null
      ? String(prediction.predicted_value)
      : (prediction.predicted_value_text ?? "—");
  return (
    <li className="flex items-start gap-2.5 rounded-lg bg-black/[0.02] px-2.5 py-2">
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500"
      >
        <PredictionIcon size={11} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-mono text-[11px] text-gray-700">
            {prediction.metric_label}
          </span>
          <span className="text-[10.5px] text-gray-400">·</span>
          <span className="font-mono text-[11px] font-semibold text-gray-900 tabular-nums">
            {value}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[10px] text-gray-500">
          <span>{formatRelative(prediction.predicted_at)}</span>
          {prediction.horizon_at && (
            <>
              <span>·</span>
              <span>horizon {formatDate(prediction.horizon_at)}</span>
            </>
          )}
        </div>
      </div>
      <PredictionStatusChip
        resolved={resolved}
        tag={prediction.deviation_tag}
      />
    </li>
  );
}

function PredictionStatusChip({
  resolved,
  tag,
}: {
  resolved: boolean;
  tag: string | null;
}) {
  if (!resolved) {
    return (
      <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
        Pending
      </span>
    );
  }
  const cls =
    tag === "expected"
      ? "bg-emerald-50 text-emerald-700"
      : tag === "regime_shift"
      ? "bg-amber-50 text-amber-700"
      : tag === "surprise"
      ? "bg-red-50 text-red-700"
      : "bg-gray-100 text-gray-600";
  const label =
    tag === "expected"
      ? "Expected"
      : tag === "regime_shift"
      ? "Shift"
      : tag === "surprise"
      ? "Surprise"
      : "Resolved";
  return (
    <span
      className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Time formatters ───────────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    return `${mo}mo ago`;
  } catch {
    return "—";
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div className="mt-2 animate-pulse space-y-4">
      <div className="h-3 w-32 rounded-full bg-black/[0.06]" />
      <div className="h-6 w-3/4 rounded-full bg-black/[0.06]" />
      <div className="space-y-2 pt-4">
        <div className="h-3 w-20 rounded-full bg-black/[0.06]" />
        <div className="h-3 w-full rounded-full bg-black/[0.06]" />
        <div className="h-3 w-5/6 rounded-full bg-black/[0.06]" />
      </div>
      <div className="space-y-2 pt-4">
        <div className="h-3 w-24 rounded-full bg-black/[0.06]" />
        <div className="h-3 w-full rounded-full bg-black/[0.06]" />
        <div className="h-3 w-4/6 rounded-full bg-black/[0.06]" />
      </div>
    </div>
  );
}
