// ── App asset class (Phase A1.2) ──
//
// Apps are rich system objects — declarative dashboards, workflows,
// tools, monitors, integrations — generated from confirmed strategy
// and kept in sync via the apps pipeline. They represent user-
// approved operational surfaces.
//
// Dropping an app on the whiteboard produces an `app-card` shape with
// the most important signals (type, status, health %, stale reason,
// intervention count). Click → opens the full app dashboard.

import { LayoutDashboard } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { App, AppType, AppStatus, AppStaleReason } from "@/types/app";

// Mirrors AppCardShapeView's accent map — single source of truth for
// the color per app_type across library + shape.
const APP_TYPE_ACCENT: Record<AppType, string> = {
  dashboard: "#3B82F6",
  workflow: "#8B5CF6",
  tool: "#10B981",
  monitor: "#F59E0B",
  integration: "#EC4899",
};

function accentFor(type: AppType): string {
  return APP_TYPE_ACCENT[type] ?? "#3B82F6";
}

interface AppsResponse {
  apps: App[];
  strategy_committed_at: string | null;
  strategy_status: string | null;
}

export const appAssetClass: AssetClassDefinition<App> = {
  class: "app",
  label: "Apps",
  pluralLabel: "apps",
  icon: LayoutDashboard,
  accent: "#3B82F6",
  group: "reasoning",
  groupOrder: 2,
  shapeType: "app-card",

  fetchForSpace: async (spaceId): Promise<App[]> => {
    const res = await fetch(
      `/api/apps?spaceId=${encodeURIComponent(spaceId)}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as AppsResponse;
    return json.apps ?? [];
  },

  toLibraryRow: (a, ctx): LibraryRow => {
    const stale = !!a.stale_reason;
    const statText = typeof a.health_score === "number"
      ? `${Math.round(a.health_score)}%`
      : a.status.toUpperCase().slice(0, 4);
    const subtitle =
      a.description ??
      (a.config?.tagline as string | undefined) ??
      `${a.app_type} · ${a.status}`;
    return {
      key: `app:${a.id}`,
      class: "app",
      id: a.id,
      title: a.name,
      subtitle: stale
        ? `⚠ Stale · ${subtitle}`
        : subtitle,
      stat: statText,
      accent: accentFor(a.app_type),
      isPlaced: ctx.isPlaced,
      href: ctx.spaceId ? `/app/space/${ctx.spaceId}/app/${a.id}` : null,
    };
  },

  toDragPayload: (a, ctx): LibraryAssetPayload => ({
    class: "app",
    id: a.id,
    spaceId: ctx.spaceId,
    preview: {
      title: a.name,
      subtitle: a.description ?? (a.config?.tagline as string | undefined) ?? null,
      accent: accentFor(a.app_type),
    },
    extras: {
      app_type: a.app_type,
      status: a.status,
      health_score: a.health_score,
      stale_reason: a.stale_reason,
      intervention_count: a.intervention_count ?? 0,
      simulation_distribution: a.state?.simulation_distribution ?? null,
      card_spec: a.config?.card_spec ?? null,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const appType = (ext.app_type as AppType) ?? "dashboard";
    const status = (ext.status as AppStatus) ?? "proposed";
    const healthScore =
      typeof ext.health_score === "number" ? ext.health_score : null;
    const staleReason = (ext.stale_reason as AppStaleReason | null) ?? null;
    const interventionCount =
      typeof ext.intervention_count === "number"
        ? ext.intervention_count
        : 0;
    const dist = ext.simulation_distribution as
      | { p10: number; p50: number; p90: number }
      | null
      | undefined;
    const p10 = dist && typeof dist.p10 === "number" ? dist.p10 : null;
    const p50 = dist && typeof dist.p50 === "number" ? dist.p50 : null;
    const p90 = dist && typeof dist.p90 === "number" ? dist.p90 : null;
    // CardSpec rides as a JSON string on the shape so it stays
    // tldraw-validatable (only scalars allowed in shape props).
    // The view re-parses + dispatches via <CardSpecRenderer />.
    const cardSpec = ext.card_spec ?? null;
    const cardSpecJson = cardSpec ? JSON.stringify(cardSpec) : null;
    const hasCardSpec = cardSpecJson !== null;

    return {
      type: "app-card",
      props: {
        appId: payload.id,
        spaceId: payload.spaceId,
        name: payload.preview.title,
        appType,
        status,
        healthScore,
        staleReason,
        hasInterventions: interventionCount > 0,
        interventionCount,
        accent: accentFor(appType),
        expanded: false,
        p10,
        p50,
        p90,
        cardSpecJson,
      },
      w: 220,
      // Cards with a card_spec render the full archetype body and
      // need more height; legacy cards keep the prior sizing.
      h: hasCardSpec ? 196 : p10 !== null ? 152 : 132,
    };
  },

  filters: [
    {
      key: "status",
      label: "Status",
      extract: (a) => a.status,
      presets: ["proposed", "approved", "active", "paused", "retired"],
    },
    {
      key: "type",
      label: "Type",
      extract: (a) => a.app_type,
      presets: ["dashboard", "workflow", "tool", "monitor", "integration"],
    },
    {
      key: "staleness",
      label: "Stale",
      extract: (a) => (a.stale_reason ? "stale" : "fresh"),
      presets: ["stale", "fresh"],
    },
  ],

  shapeIdForItem: (id: string) => `app-${id}`,
};
