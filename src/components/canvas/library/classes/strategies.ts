// ── Strategy asset class (Phase A1.2) ──
//
// Strategies are versioned — a space has multiple snapshots over time.
// The library surfaces every snapshot so users can drag any version
// onto the whiteboard for comparison/annotation (the Arc 4 Phase B
// strategy-card shape already exists and handles the rendering +
// expand/collapse behavior).

import { Target } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { StrategySnapshotSummary, StrategySnapshotsResponse } from "@/app/api/spaces/[id]/strategy-snapshots/route";

type Snapshot = StrategySnapshotSummary;

const STATUS_ACCENT: Record<Snapshot["status"], string> = {
  generated: "#64748b",
  reviewing: "#d97706",
  confirmed: "#16a34a",
  superseded: "#94a3b8",
};

export const strategyAssetClass: AssetClassDefinition<Snapshot> = {
  class: "strategy",
  label: "Strategies",
  pluralLabel: "strategies",
  icon: Target,
  accent: "#16a34a",
  group: "reasoning",
  groupOrder: 1,
  shapeType: "strategy-card",

  fetchForSpace: async (spaceId): Promise<Snapshot[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/strategy-snapshots`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as StrategySnapshotsResponse;
    return json.snapshots ?? [];
  },

  toLibraryRow: (s, ctx): LibraryRow => ({
    key: `strategy:${s.id}`,
    class: "strategy",
    id: s.id,
    title: s.title ?? s.label ?? `v${s.version}`,
    subtitle:
      s.tactic_count !== null
        ? `${s.tactic_count} tactics · ${s.status}`
        : s.status,
    stat: s.label ?? `v${s.version}`,
    accent: STATUS_ACCENT[s.status],
    isPlaced: ctx.isPlaced,
    href: ctx.spaceId
      ? `/app/space/${ctx.spaceId}/strategy?snapshot=${s.id}`
      : null,
  }),

  toDragPayload: (s, ctx): LibraryAssetPayload => ({
    class: "strategy",
    id: s.id,
    spaceId: ctx.spaceId,
    preview: {
      title: s.title ?? s.label ?? `v${s.version}`,
      subtitle: `${s.status} · ${s.tactic_count ?? 0} tactics`,
      accent: STATUS_ACCENT[s.status],
    },
    extras: {
      version: s.version,
      label: s.label,
      status: s.status,
      quality_score: s.quality_score,
      tactic_count: s.tactic_count,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const version =
      typeof ext.version === "number" ? ext.version : 1;
    const label =
      (typeof ext.label === "string" && ext.label) || `v${version}`;
    const status = (typeof ext.status === "string"
      ? ext.status
      : "generated") as
      | "generated"
      | "reviewing"
      | "confirmed"
      | "superseded";
    const qualityScore =
      typeof ext.quality_score === "number" ? ext.quality_score : null;
    const tacticCount =
      typeof ext.tactic_count === "number" ? ext.tactic_count : null;

    // Mirrors placeStrategyShape (interaxis-canvas.tsx) exactly — same
    // shape type, same prop keys, same defaults. Library drop and URL-
    // param drop now produce identical shapes.
    return {
      type: "strategy-card",
      props: {
        snapshotId: payload.id,
        version,
        label,
        title: payload.preview.title ?? "Untitled strategy",
        status,
        readyScore: qualityScore,
        tacticCount,
        // Confidence lives on the full snapshot, not the summary; leave
        // null here and let strategy-shape's hydration fetch fill it.
        confidence: null,
        expanded: false,
      },
      w: 220,
      h: 120,
    };
  },

  filters: [
    {
      key: "status",
      label: "Status",
      extract: (s) => s.status,
      presets: ["generated", "reviewing", "confirmed", "superseded"],
    },
  ],

  // Must match placeStrategyShape's shape id pattern so library drops
  // dedupe against URL-flow drops.
  shapeIdForItem: (id: string) => `strategy-${id}`,
};
