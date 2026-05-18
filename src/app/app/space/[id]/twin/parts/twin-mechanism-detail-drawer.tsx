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
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { MechanismIcon, InterventionAppIcon } from "@/components/twin/icons/twin-icons";
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
        {mechanism && <DrawerBody mechanism={mechanism} />}
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

function DrawerBody({ mechanism }: { mechanism: MechanismSummary }) {
  const kindLabel = KIND_LABEL[mechanism.kind] ?? mechanism.kind;
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

      <Section label="Agents assigned">
        <p className="text-[13px] text-gray-700">
          {mechanism.agent_count} agent{mechanism.agent_count === 1 ? "" : "s"}{" "}
          wired in
        </p>
      </Section>
    </div>
  );
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
