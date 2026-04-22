// ── Objective asset class (Phase A1.7) ──
//
// First class to land in the "views" section of the library drawer —
// this is the top-level goal hierarchy for a space. Each catalog entry
// is a ROOT objective and its full sub-objective tree, not a single
// goal. Dropping a root materializes the whole tree as one shape users
// can expand in place.
//
// Uses the pre-built tree + progress computation from
// `src/lib/goals/build-goal-tree.ts` (no duplication). The catalog
// endpoint (src/app/api/spaces/[id]/objectives/catalog/route.ts) does
// the tree-building server-side so every library row is instant.

import { Target } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type {
  ObjectiveCatalogEntry,
  ObjectivesCatalogResponse,
} from "@/app/api/spaces/[id]/objectives/catalog/route";

const STATUS_ACCENT: Record<string, string> = {
  proposed: "#d97706",
  active: "#0891b2",
  achieved: "#16a34a",
  paused: "#64748b",
  abandoned: "#94a3b8",
  rejected: "#dc2626",
};

function accentForStatus(status: string): string {
  return STATUS_ACCENT[status] ?? "#0891b2";
}

/**
 * Presets for the status filter. Mirrors the Wave A status enum; order
 * is workflow-based (most actionable → least) not alphabetical.
 */
const STATUS_FILTER_PRESETS = [
  "active",
  "proposed",
  "achieved",
  "paused",
  "abandoned",
  "rejected",
];

export const objectivesAssetClass: AssetClassDefinition<ObjectiveCatalogEntry> = {
  class: "objective",
  label: "Objectives",
  pluralLabel: "objectives",
  icon: Target,
  accent: "#0891b2",
  group: "views",
  groupOrder: 1,
  shapeType: "objective-tree",

  fetchForSpace: async (spaceId): Promise<ObjectiveCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/objectives/catalog`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as ObjectivesCatalogResponse;
    return json.objectives ?? [];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    const accent = accentForStatus(e.status);
    const subBits: string[] = [];
    if (e.nodeCount > 1) subBits.push(`${e.nodeCount - 1} sub`);
    if (e.depth > 1) subBits.push(`depth ${e.depth}`);
    if (e.proposedCount > 0) subBits.push(`${e.proposedCount} proposed`);
    const subtitle = subBits.length > 0 ? subBits.join(" · ") : e.objective_type;

    return {
      key: `objective:${e.id}`,
      class: "objective",
      id: e.id,
      title: e.title,
      subtitle,
      stat: `${e.progress}%`,
      accent,
      isPlaced: ctx.isPlaced,
      href: ctx.spaceId
        ? `/app/space/${ctx.spaceId}/objectives?focus=${encodeURIComponent(e.id)}`
        : null,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "objective",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: e.title,
      subtitle: `${e.progress}% · ${e.nodeCount} node${e.nodeCount === 1 ? "" : "s"}`,
      accent: accentForStatus(e.status),
    },
    extras: {
      status: e.status,
      objective_type: e.objective_type,
      progress: e.progress,
      node_count: e.nodeCount,
      depth: e.depth,
      proposed_count: e.proposedCount,
      // Tree is serialized — the shape's canvas props accept only
      // primitive types in tldraw's validation schema, so the JSON
      // string round-trips cleanly.
      tree_json: JSON.stringify(e.tree),
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "objective-tree",
      props: {
        goalId: payload.id,
        spaceId: payload.spaceId,
        title: payload.preview.title,
        status: (ext.status as string | undefined) ?? "active",
        objectiveType:
          (ext.objective_type as string | undefined) ?? "maximize",
        progress:
          typeof ext.progress === "number" ? ext.progress : 0,
        nodeCount:
          typeof ext.node_count === "number" ? ext.node_count : 1,
        depth: typeof ext.depth === "number" ? ext.depth : 1,
        proposedCount:
          typeof ext.proposed_count === "number" ? ext.proposed_count : 0,
        treeJson:
          typeof ext.tree_json === "string" ? ext.tree_json : "",
        expanded: false,
      },
      w: 320,
      h: 180,
    };
  },

  filters: [
    {
      key: "status",
      label: "Status",
      extract: (e) => e.status,
      presets: STATUS_FILTER_PRESETS,
    },
    {
      key: "has_proposed",
      label: "Pending",
      extract: (e) => (e.proposedCount > 0 ? "has unreviewed" : null),
      presets: ["has unreviewed"],
    },
    {
      key: "has_subs",
      label: "Shape",
      extract: (e) => (e.nodeCount > 1 ? "decomposed" : "atomic"),
      presets: ["decomposed", "atomic"],
    },
  ],

  // Stable id — re-dropping the same objective replaces on canvas.
  shapeIdForItem: (id: string) => `objective-${id}`,
};
