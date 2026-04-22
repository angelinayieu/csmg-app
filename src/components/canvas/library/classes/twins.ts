// ── Twin asset class (Phase A1.4c) ──
//
// Twin is a per-space SINGLETON — unlike reactions/bridges/cycles,
// a space has exactly one "live" twin state at any moment. The
// library tab reflects this: always exactly 1 row ("Current state")
// that renders the computed twin's health/coverage/risk/dynamics.
//
// Each drag produces a NEW frozen snapshot timestamped with drop time.
// The shape id embeds the timestamp so repeated drops don't collide —
// users can drop multiple readings taken seconds apart, hours apart,
// or days apart for trajectory comparison.

import { Activity } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { TwinMacroState } from "@/types/twin";
import type { TwinStateResponse } from "@/app/api/spaces/[id]/twin-state/route";

const HEALTH_ACCENT: Record<TwinMacroState["health_label"], string> = {
  strong: "#16a34a",
  developing: "#0891b2",
  fragile: "#d97706",
  critical: "#dc2626",
};

/**
 * Internal pseudo-row shape we pass through the catalog. Each entry is
 * the singleton current state plus a stable id so the catalog can cache
 * it in its `byId` map. The `id` is always "current" — only one entry
 * per space.
 */
interface TwinCatalogEntry {
  id: "current";
  space_id: string;
  space_name: string;
  computed_at: string;
  twin: TwinMacroState;
}

export const twinAssetClass: AssetClassDefinition<TwinCatalogEntry> = {
  class: "twin",
  label: "Twin",
  pluralLabel: "twin snapshot",
  icon: Activity,
  accent: "#0891b2",
  group: "reasoning",
  groupOrder: 3,
  shapeType: "twin-snapshot",

  fetchForSpace: async (spaceId): Promise<TwinCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/twin-state`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as TwinStateResponse;
    if (!json.twin) return [];
    return [
      {
        id: "current",
        space_id: spaceId,
        space_name: json.space_name,
        computed_at: json.computed_at,
        twin: json.twin,
      },
    ];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    const accent = HEALTH_ACCENT[e.twin.health_label];
    const m = e.twin;
    const subtitle = `${m.coverage.entities_modeled} nodes · ${m.dynamics.total_loops} loops · ${m.risk_exposure.total_risk_points} risks`;
    return {
      key: `twin:${e.space_id}`,
      class: "twin",
      id: e.id,
      title: `Current state · ${Math.round(m.health_score)}/100`,
      subtitle,
      stat: m.health_label.toUpperCase().slice(0, 4),
      accent,
      isPlaced: ctx.isPlaced,
      href: ctx.spaceId ? `/app/space/${ctx.spaceId}/twin` : null,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "twin",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: `Current state · ${Math.round(e.twin.health_score)}/100`,
      subtitle: e.twin.health_label,
      accent: HEALTH_ACCENT[e.twin.health_label],
    },
    extras: {
      space_name: e.space_name,
      computed_at: e.computed_at,
      health_score: e.twin.health_score,
      health_label: e.twin.health_label,
      maturity: e.twin.maturity,
      entities_count: e.twin.coverage.entities_modeled,
      edges_count: e.twin.coverage.edges_mapped,
      cycles_count: e.twin.coverage.cycles_detected,
      leverage_points: e.twin.dynamics.leverage_points,
      risk_points: e.twin.risk_exposure.total_risk_points,
      reinforcing_positive: e.twin.dynamics.reinforcing_positive,
      reinforcing_negative: e.twin.dynamics.reinforcing_negative,
      balancing: e.twin.dynamics.balancing,
      bottleneck_name: e.twin.risk_exposure.bottleneck_name,
      bottleneck_share: e.twin.risk_exposure.bottleneck_system_share,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    // `snappedAt` is the DROP time, not the compute time — two drops
    // seconds apart get different timestamps AND different shape ids,
    // preserving trajectory across multiple readings on the same board.
    const snappedAt = new Date().toISOString();
    return {
      type: "twin-snapshot",
      props: {
        spaceId: payload.spaceId,
        spaceName: (ext.space_name as string | undefined) ?? "Untitled space",
        snappedAt,
        healthScore:
          typeof ext.health_score === "number" ? ext.health_score : 0,
        healthLabel:
          (ext.health_label as TwinMacroState["health_label"] | undefined) ??
          "developing",
        maturity:
          (ext.maturity as TwinMacroState["maturity"] | undefined) ??
          "theoretical",
        entitiesCount:
          typeof ext.entities_count === "number" ? ext.entities_count : 0,
        edgesCount:
          typeof ext.edges_count === "number" ? ext.edges_count : 0,
        cyclesCount:
          typeof ext.cycles_count === "number" ? ext.cycles_count : 0,
        leveragePoints:
          typeof ext.leverage_points === "number" ? ext.leverage_points : 0,
        riskPoints:
          typeof ext.risk_points === "number" ? ext.risk_points : 0,
        reinforcingPositive:
          typeof ext.reinforcing_positive === "number"
            ? ext.reinforcing_positive
            : 0,
        reinforcingNegative:
          typeof ext.reinforcing_negative === "number"
            ? ext.reinforcing_negative
            : 0,
        balancing: typeof ext.balancing === "number" ? ext.balancing : 0,
        bottleneckName:
          (ext.bottleneck_name as string | null | undefined) ?? null,
        bottleneckShare:
          typeof ext.bottleneck_share === "number"
            ? ext.bottleneck_share
            : null,
      },
      w: 340,
      h: 220,
    };
  },

  // Each drag-drop needs a unique shape id so multiple snapshots don't
  // collide. Appending a short timestamp-derived suffix keeps ids
  // readable without needing a UUID. A given user rarely drops twins
  // more than a few times per second; Date.now() + random is enough.
  shapeIdForItem: () =>
    `twin-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
};
