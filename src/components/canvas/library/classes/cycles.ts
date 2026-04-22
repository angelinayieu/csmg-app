// ── Cycle asset class (Phase A1.3) ──
//
// Feedback loops detected via the synthesis / loops pipeline. Surfaced
// as draggable assets so users can annotate them, compare side-by-
// side, or pull a cycle into context next to its participants.

import { RotateCw } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { Cycle } from "@/types";
import type { CyclesResponse } from "@/app/api/spaces/[id]/cycles/route";

type Classification = Cycle["classification"];

const CLASSIFICATION_ACCENT: Record<Classification, string> = {
  reinforcing_positive: "#16a34a",
  reinforcing_negative: "#db2777",
  balancing: "#0891b2",
};

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  reinforcing_positive: "Reinforcing +",
  reinforcing_negative: "Reinforcing −",
  balancing: "Balancing",
};

/**
 * Local cache for the entity-name map returned alongside cycles —
 * passed through via `toDragPayload` so `toShapeProps` can build the
 * chain preview without an extra round-trip.
 *
 * We stash the map on a module-scoped ref keyed by spaceId so the
 * registry's synchronous `toDragPayload` can read it. A cleaner
 * long-term solution is to push the lookup through the catalog
 * context; for this phase the local cache is tight and correct.
 */
const entityNameCache = new Map<string, Record<string, string>>();

interface CycleWithNames extends Cycle {
  /** Resolved names for entity_ids — populated by fetchForSpace. */
  _entity_names: string[];
  _first_entity_id: string | null;
}

export const cycleAssetClass: AssetClassDefinition<CycleWithNames> = {
  class: "cycle",
  label: "Cycles",
  pluralLabel: "cycles",
  icon: RotateCw,
  accent: "#0891b2",
  group: "graphs",
  groupOrder: 2,
  shapeType: "cycle-loop",

  fetchForSpace: async (spaceId): Promise<CycleWithNames[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/cycles`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as CyclesResponse;
    const cycles = json.cycles ?? [];
    const nameMap = json.entity_name_by_id ?? {};
    entityNameCache.set(spaceId, nameMap);
    return cycles.map((c) => {
      const names = (c.entity_ids ?? [])
        .map((id) => nameMap[id])
        .filter((n): n is string => typeof n === "string");
      return {
        ...c,
        _entity_names: names,
        _first_entity_id: (c.entity_ids ?? [])[0] ?? null,
      };
    });
  },

  toLibraryRow: (c, ctx): LibraryRow => {
    const accent = CLASSIFICATION_ACCENT[c.classification];
    const label = CLASSIFICATION_LABEL[c.classification];
    const title =
      c.name ??
      (c._entity_names.length > 0
        ? c._entity_names.slice(0, 3).join(" → ")
        : `${label} loop`);
    return {
      key: `cycle:${c.id}`,
      class: "cycle",
      id: c.id,
      title,
      subtitle: `${c.entity_ids?.length ?? 0} nodes${
        typeof c.estimated_multiplier === "number"
          ? ` · ~${c.estimated_multiplier.toFixed(1)}×`
          : ""
      }`,
      stat: label,
      accent,
      isPlaced: ctx.isPlaced,
      href: c._first_entity_id
        ? `/app/space/${ctx.spaceId}/entity/${c._first_entity_id}/lab`
        : null,
    };
  },

  toDragPayload: (c, ctx): LibraryAssetPayload => ({
    class: "cycle",
    id: c.id,
    spaceId: ctx.spaceId,
    preview: {
      title: c.name ?? CLASSIFICATION_LABEL[c.classification] + " loop",
      subtitle: `${c.entity_ids?.length ?? 0} nodes`,
      accent: CLASSIFICATION_ACCENT[c.classification],
    },
    extras: {
      classification: c.classification,
      entity_names: c._entity_names,
      node_count: c.entity_ids?.length ?? 0,
      multiplier: c.estimated_multiplier,
      first_entity_id: c._first_entity_id,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const classification =
      (ext.classification as Classification | undefined) ?? "balancing";
    const entityNames = Array.isArray(ext.entity_names)
      ? (ext.entity_names as string[])
      : [];
    const nodeCount =
      typeof ext.node_count === "number" ? ext.node_count : entityNames.length;
    const multiplier =
      typeof ext.multiplier === "number" ? ext.multiplier : null;
    const firstEntityId =
      typeof ext.first_entity_id === "string"
        ? (ext.first_entity_id as string)
        : null;
    return {
      type: "cycle-loop",
      props: {
        cycleId: payload.id,
        spaceId: payload.spaceId,
        name:
          payload.preview.title ?? `${CLASSIFICATION_LABEL[classification]} loop`,
        classification,
        entityNames,
        nodeCount,
        multiplier,
        firstEntityId,
      },
      w: 260,
      h: 140,
    };
  },

  filters: [
    {
      key: "classification",
      label: "Classification",
      extract: (c) => c.classification,
      presets: [
        "reinforcing_positive",
        "reinforcing_negative",
        "balancing",
      ],
    },
  ],

  shapeIdForItem: (id: string) => `cycle-${id}`,
};
