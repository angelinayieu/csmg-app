"use client";

// ── Layer stack view ────────────────────────────────────────────────
//
// Vertical, top-down render of the layer ontology. Layers sort by
// `ordinal` ascending — surface/closest-to-user at top, deepest /
// structural at bottom, so the reader's eye walks from "what I touch"
// down to "what's actually moving the system."
//
// Each row is a layer band:
//   - left rail: color tab + ordinal + label (ALL CAPS small)
//   - right body: entity chips (clickable), with category-tinted dot
//   - empty layers render an explicit "no entities yet" line so the
//     stack still teaches the user the full ontology shape
//
// Entities missing a layer_ontology_id collect into an "Unmapped"
// trailing row so we never silently drop nodes.

import { useMemo } from "react";
import Link from "next/link";
import type { Entity } from "@/types";
import type { TwinWorkflowData } from "@/app/api/spaces/[id]/twin-workflow-data/route";
import type { TwinPageBundle } from "@/app/api/spaces/[id]/twin-page-bundle/route";
import { LayerIcon } from "@/components/twin/icons/twin-icons";

interface Props {
  spaceId: string;
  workflowData: TwinWorkflowData;
  layerOntology: TwinPageBundle["layer_ontology"];
}

type LayerRow = TwinPageBundle["layer_ontology"][number] & {
  entities: Entity[];
};

export function TwinLayerStackView({
  spaceId,
  workflowData,
  layerOntology,
}: Props) {
  // Group entities by layer_ontology_id, falling back to an "Unmapped"
  // bucket. `layer_ontology_id` is on the row but not in the
  // generated db.types.ts yet — cast through `unknown` to read it.
  const { layered, unmapped } = useMemo(() => {
    const byLayer = new Map<string, Entity[]>();
    const orphans: Entity[] = [];
    for (const e of workflowData.entities) {
      const lid = (e as unknown as { layer_ontology_id: string | null })
        .layer_ontology_id;
      if (lid && layerOntology.some((l) => l.id === lid)) {
        const arr = byLayer.get(lid) ?? [];
        arr.push(e);
        byLayer.set(lid, arr);
      } else {
        orphans.push(e);
      }
    }
    const rows: LayerRow[] = layerOntology.map((l) => ({
      ...l,
      entities: byLayer.get(l.id) ?? [],
    }));
    return { layered: rows, unmapped: orphans };
  }, [workflowData.entities, layerOntology]);

  const totalMapped = layered.reduce((acc, l) => acc + l.entities.length, 0);
  const hasAnyLayers = layerOntology.length > 0;

  if (!hasAnyLayers) {
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
        No layer ontology has been generated for this space yet. The
        intake pipeline produces one during framing — try regenerating
        the strategy.
      </article>
    );
  }

  return (
    <article
      className="rounded-2xl"
      style={{
        background: "var(--glass-card-bg)",
        boxShadow: "var(--shadow-card)",
        backdropFilter: "blur(var(--blur-card))",
        WebkitBackdropFilter: "blur(var(--blur-card))",
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-black/[0.04] px-7 py-4">
        <div className="flex items-center gap-2">
          <LayerIcon size={13} />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            {layerOntology.length} layer{layerOntology.length === 1 ? "" : "s"} ·{" "}
            {totalMapped} entit{totalMapped === 1 ? "y" : "ies"} mapped
          </span>
        </div>
        {unmapped.length > 0 && (
          <span className="text-[10.5px] font-medium text-amber-600">
            {unmapped.length} unmapped
          </span>
        )}
      </header>

      <ol className="divide-y divide-black/[0.04]">
        {layered.map((row) => (
          <LayerBand key={row.id} row={row} spaceId={spaceId} />
        ))}
        {unmapped.length > 0 && (
          <UnmappedBand entities={unmapped} spaceId={spaceId} />
        )}
      </ol>
    </article>
  );
}

// ── Per-layer band ────────────────────────────────────────────────

function LayerBand({ row, spaceId }: { row: LayerRow; spaceId: string }) {
  return (
    <li className="grid grid-cols-[180px_1fr] gap-6 px-7 py-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: row.color }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            L{row.ordinal}
          </span>
        </div>
        <div className="text-[13px] font-semibold leading-tight text-gray-900">
          {row.label}
        </div>
        <div className="text-[10.5px] text-gray-500">
          {row.entities.length} entit{row.entities.length === 1 ? "y" : "ies"}
        </div>
      </div>

      <div className="min-w-0">
        {row.entities.length === 0 ? (
          <div className="text-[12px] italic text-gray-400">
            No entities mapped here yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.entities.map((e) => (
              <EntityChip key={e.id} entity={e} spaceId={spaceId} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Unmapped trailing band ────────────────────────────────────────

function UnmappedBand({
  entities,
  spaceId,
}: {
  entities: Entity[];
  spaceId: string;
}) {
  return (
    <li className="grid grid-cols-[180px_1fr] gap-6 px-7 py-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full bg-amber-400"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-600">
            Unmapped
          </span>
        </div>
        <div className="text-[13px] font-semibold leading-tight text-gray-900">
          Awaiting classification
        </div>
        <div className="text-[10.5px] text-gray-500">
          {entities.length} entit{entities.length === 1 ? "y" : "ies"}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <EntityChip key={e.id} entity={e} spaceId={spaceId} muted />
        ))}
      </div>
    </li>
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

function EntityChip({
  entity,
  spaceId,
  muted,
}: {
  entity: Entity;
  spaceId: string;
  muted?: boolean;
}) {
  const dot = CATEGORY_DOT[entity.entity_category] ?? "var(--accent-500)";
  return (
    <Link
      href={`/app/space/${spaceId}/entity/${entity.id}`}
      className="inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-full border border-black/[0.05] px-2.5 py-1 text-[11.5px] font-medium text-gray-700 transition hover:border-black/[0.15] hover:bg-white hover:text-gray-900"
      style={{
        background: muted ? "transparent" : "rgba(255,255,255,0.6)",
      }}
      title={entity.description ?? entity.name}
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
