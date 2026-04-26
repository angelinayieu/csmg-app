"use client";

// ── Signature Constellation widget (Batch 8) ───────────────────────────
//
// Renders every NodeSignature in the bound collection as a layered ring.
// Click a ring → slide the detail drawer in. This is the first place
// the user sees the canonical-signature system as a coherent surface
// rather than a single node's rings in isolation.
//
// Sorting: richest signatures (most rings, highest confidence) first.
// A heuristic — no server-side ranking, just keeps the eye drawn to the
// most-resolved nodes. The detail drawer then lets the user drill into
// ambient/low-zoom nodes on demand.
//
// Data source: `node_signatures` resolver returns an array of objects
// `{ signature: NodeSignature, entity_name: string }` — entity names
// aren't on the NodeSignature itself (to keep the payload tight), so
// the resolver joins them in at read time.

import { useMemo, useState } from "react";
import type { WidgetComponentProps } from "@/lib/apps/widget-registry";
import type { NodeSignature } from "@/types/node-signature";
import { NodeSignatureRing } from "@/components/signatures/node-signature-ring";
import { NodeSignatureDetail } from "@/components/signatures/node-signature-detail";
import { Surface, WidgetTitle, WidgetEmpty } from "./shared";

interface SignatureConstellationConfig {
  title?: string;
  /** Cap on rendered rings. Default 24. Larger sets overwhelm the grid. */
  maxRings?: number;
  /** Individual ring diameter in px. Default 92. */
  ringSize?: number;
  /** Hide low-zoom signatures (zoom <= this). Default null = show all. */
  minZoom?: number;
}

export interface ConstellationItem {
  signature: NodeSignature;
  entity_name: string;
}

export function SignatureConstellation({
  instance,
  context,
}: WidgetComponentProps<SignatureConstellationConfig>) {
  const cfg = instance.config ?? {};
  const res = context.resolve<ConstellationItem[]>(instance.bindings?.signatures);
  const items = res.value ?? [];
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const minZoom = typeof cfg.minZoom === "number" ? cfg.minZoom : null;
    const max = typeof cfg.maxRings === "number" ? cfg.maxRings : 24;
    const pool = minZoom !== null
      ? items.filter((it) => it.signature.resolution.zoom > minZoom)
      : items;
    // Rank: more rings first, then higher confidence, then lower
    // residual uncertainty. Deterministic — avoids visual jitter
    // between renders of the same data set.
    const sorted = [...pool].sort((a, b) => {
      if (b.signature.rings !== a.signature.rings) {
        return b.signature.rings - a.signature.rings;
      }
      const confA = avgConfidence(a.signature);
      const confB = avgConfidence(b.signature);
      if (confA !== confB) return confB - confA;
      return a.signature.residual_uncertainty - b.signature.residual_uncertainty;
    });
    return sorted.slice(0, max);
  }, [items, cfg.maxRings, cfg.minZoom]);

  const activeItem = useMemo(
    () => filtered.find((it) => it.signature.entity_id === activeEntityId) ?? null,
    [filtered, activeEntityId],
  );

  if (filtered.length === 0) {
    return (
      <Surface density="comfortable">
        <WidgetTitle
          eyebrow="Signatures"
          title={cfg.title ?? "Node signatures"}
        />
        <WidgetEmpty>
          No signatures materialized yet. Signatures land at the tail of
          the KG stage — this space may be mid-pipeline or the stage ran
          before the materializer was wired.
        </WidgetEmpty>
      </Surface>
    );
  }

  // Summary stats. "Deep" = 4+ rings (signature is well-resolved).
  const deep = filtered.filter((it) => it.signature.rings >= 4).length;
  const avgRes = Math.round(
    (filtered.reduce((s, it) => s + it.signature.residual_uncertainty, 0) /
      filtered.length) *
      100,
  );

  return (
    <Surface density="comfortable">
      <WidgetTitle
        eyebrow="Signatures"
        title={cfg.title ?? "Node signatures"}
        subtitle={`${filtered.length} visible · ${deep} deep · avg residual ${avgRes}%`}
      />
      <div
        className="mt-4 grid justify-items-center gap-x-4 gap-y-5"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${(cfg.ringSize ?? 92) + 32}px, 1fr))`,
        }}
      >
        {filtered.map((it) => (
          <NodeSignatureRing
            key={it.signature.entity_id}
            signature={it.signature}
            size={cfg.ringSize ?? 92}
            showCode
            showLabel
            entityName={it.entity_name}
            onSelect={() => setActiveEntityId(it.signature.entity_id)}
            selected={it.signature.entity_id === activeEntityId}
            // Constellation grids can render dozens of rings at once.
            // Animating every one on mount thrashes the eye and makes
            // scroll-triggered re-mounts look broken. Static here; the
            // canvas-card overlay + detail drawer keep the animated
            // "movie unravel" beat.
            animated={false}
          />
        ))}
      </div>
      <NodeSignatureDetail
        signature={activeItem?.signature ?? null}
        entityName={activeItem?.entity_name}
        onClose={() => setActiveEntityId(null)}
      />
    </Surface>
  );
}

function avgConfidence(sig: NodeSignature): number {
  if (sig.basis.length === 0) return 0;
  return sig.basis.reduce((s, b) => s + b.confidence, 0) / sig.basis.length;
}
