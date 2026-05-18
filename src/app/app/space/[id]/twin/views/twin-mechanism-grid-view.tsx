"use client";

// ── Mechanism grid view ─────────────────────────────────────────────
//
// Compact row list — one mechanism per row, grouped by status
// (active / proposed / archived). Each row shows kind glyph, name,
// agent / app counts, and an inline layer-distribution strip so the
// reader sees at a glance which layers this mechanism touches.
//
// Clicking a row opens TwinMechanismDetailDrawer (Phase 1 — fetches
// the per-mechanism summary endpoint built in Phase 0). The drawer
// owns its own data fetch so this list stays snappy.

import { useMemo, useState } from "react";
import {
  MechanismIcon,
  InterventionAppIcon,
  VisualizationAppIcon,
} from "@/components/twin/icons/twin-icons";
import { TwinMechanismDetailDrawer } from "../parts/twin-mechanism-detail-drawer";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";

type Mechanism = TwinPageBundle["mechanisms"][number];

interface Props {
  spaceId: string;
  mechanisms: Mechanism[];
  layerOntology: TwinPageBundle["layer_ontology"];
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

export function TwinMechanismGridView({
  spaceId,
  mechanisms,
  layerOntology,
}: Props) {
  const [openMechId, setOpenMechId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const buckets: Record<string, Mechanism[]> = {
      active: [],
      proposed: [],
      archived: [],
      other: [],
    };
    for (const m of mechanisms) {
      if (m.status === "active") buckets.active.push(m);
      else if (m.status === "proposed") buckets.proposed.push(m);
      else if (m.status === "archived") buckets.archived.push(m);
      else buckets.other.push(m);
    }
    return buckets;
  }, [mechanisms]);

  if (mechanisms.length === 0) {
    return (
      <article
        className="rounded-2xl px-7 py-8 text-[13px] leading-relaxed text-gray-500"
        style={{
          background: "var(--glass-card-bg)",
          boxShadow: "var(--shadow-card)",
          backdropFilter: "blur(var(--blur-card))",
          WebkitBackdropFilter: "blur(var(--blur-card))",
        }}
      >
        No mechanisms have been materialized yet. The strategy generator
        produces them once the twin has enough coverage — try
        regenerating the strategy or letting more entities land.
      </article>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {grouped.active.length > 0 && (
          <MechanismGroup
            title="Active"
            mechanisms={grouped.active}
            layerOntology={layerOntology}
            onOpen={setOpenMechId}
            tone="active"
          />
        )}
        {grouped.proposed.length > 0 && (
          <MechanismGroup
            title="Proposed"
            mechanisms={grouped.proposed}
            layerOntology={layerOntology}
            onOpen={setOpenMechId}
            tone="proposed"
          />
        )}
        {grouped.archived.length > 0 && (
          <MechanismGroup
            title="Archived"
            mechanisms={grouped.archived}
            layerOntology={layerOntology}
            onOpen={setOpenMechId}
            tone="archived"
          />
        )}
        {grouped.other.length > 0 && (
          <MechanismGroup
            title="Other"
            mechanisms={grouped.other}
            layerOntology={layerOntology}
            onOpen={setOpenMechId}
            tone="archived"
          />
        )}
      </div>

      <TwinMechanismDetailDrawer
        spaceId={spaceId}
        mechanismId={openMechId}
        onClose={() => setOpenMechId(null)}
      />
    </>
  );
}

// ── Status-grouped section ─────────────────────────────────────────

interface GroupProps {
  title: string;
  mechanisms: Mechanism[];
  layerOntology: TwinPageBundle["layer_ontology"];
  onOpen: (id: string) => void;
  tone: "active" | "proposed" | "archived";
}

function MechanismGroup({
  title,
  mechanisms,
  layerOntology,
  onOpen,
  tone,
}: GroupProps) {
  const toneClass =
    tone === "active"
      ? "text-emerald-600"
      : tone === "proposed"
      ? "text-amber-600"
      : "text-gray-400";

  return (
    <section
      className="rounded-2xl"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <header className="flex items-center justify-between border-b border-black/[0.04] px-6 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              tone === "active"
                ? "bg-emerald-500"
                : tone === "proposed"
                ? "bg-amber-500"
                : "bg-gray-300"
            }`}
          />
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.18em] ${toneClass}`}
          >
            {title} · {mechanisms.length}
          </span>
        </div>
      </header>
      <ul className="divide-y divide-black/[0.04]">
        {mechanisms.map((m) => (
          <MechanismRow
            key={m.id}
            mechanism={m}
            layerOntology={layerOntology}
            onOpen={() => onOpen(m.id)}
          />
        ))}
      </ul>
    </section>
  );
}

// ── Individual row ────────────────────────────────────────────────

function MechanismRow({
  mechanism,
  layerOntology,
  onOpen,
}: {
  mechanism: Mechanism;
  layerOntology: TwinPageBundle["layer_ontology"];
  onOpen: () => void;
}) {
  const label = KIND_LABEL[mechanism.kind] ?? mechanism.kind;
  return (
    <li>
      <button
        onClick={onOpen}
        className="group flex w-full items-center gap-4 px-6 py-3.5 text-left transition hover:bg-black/[0.02]"
      >
        <span
          aria-hidden
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "rgba(15,23,42,0.04)",
            color: "var(--accent-500)",
          }}
        >
          <MechanismIcon size={13} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13px] font-semibold text-gray-900">
              {mechanism.name}
            </span>
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-gray-400">
              {label}
            </span>
          </div>
          {mechanism.cycle_pattern && (
            <div className="mt-0.5 line-clamp-1 text-[11.5px] text-gray-500">
              {mechanism.cycle_pattern}
            </div>
          )}
        </div>

        <LayerDistributionStrip
          distribution={mechanism.layer_distribution}
          layerOntology={layerOntology}
        />

        <div className="flex flex-shrink-0 items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <InterventionAppIcon size={11} />
            {mechanism.app_count}
          </span>
          <span className="inline-flex items-center gap-1">
            <VisualizationAppIcon size={11} />
            {mechanism.agent_count}
          </span>
        </div>

        <span className="text-[10.5px] text-gray-300 group-hover:text-gray-500">
          →
        </span>
      </button>
    </li>
  );
}

// ── Inline layer-distribution mini-strip ───────────────────────────
//
// Tiny stacked-bar visualization — each layer gets a colored segment
// proportional to its entity count for this mechanism. Width tops
// out at ~120px so it sits cleanly inline.

function LayerDistributionStrip({
  distribution,
  layerOntology,
}: {
  distribution: Record<string, number>;
  layerOntology: TwinPageBundle["layer_ontology"];
}) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <span className="text-[10px] italic text-gray-400">no layer data</span>
    );
  }
  return (
    <div
      className="flex h-1.5 w-[120px] flex-shrink-0 overflow-hidden rounded-full"
      style={{ background: "rgba(15,23,42,0.06)" }}
      aria-label="Layer distribution"
    >
      {layerOntology.map((l) => {
        const count = distribution[l.slug] ?? 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <span
            key={l.id}
            className="block h-full"
            style={{ width: `${pct}%`, background: l.color }}
            title={`${l.label}: ${count}`}
          />
        );
      })}
    </div>
  );
}
