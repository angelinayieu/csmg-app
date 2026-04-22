// ── Entity asset class (Phase A1.0 → A1.9 enrichment) ──
//
// A1.0 shipped entity drops as a no-op port of the legacy entity-only
// drawer. A1.9 enriches every row with a 7-class `kind` classifier, a
// compound dominance score with component breakdown, upstream/
// downstream edge counts, chain memberships, and goal linkage — so
// the drawer can surface multiple views (List / Table / Ranked /
// Chains) without additional round-trips.
//
// The page still seeds a lightweight basic-entity set via
// `catalog.seed("entity", ...)` for instant first paint; the enriched
// `EntityCatalogEntry` replaces the seed when the catalog endpoint
// returns. Shape drops + drag payloads work identically for both
// shapes (EntityCatalogEntry extends Entity).

import { CircleDot } from "lucide-react";
import type { AssetClassDefinition, LibraryRow, LibraryAssetPayload } from "../types";
import type { Entity } from "@/types";
import type {
  EntityCatalogEntry,
  EntitiesCatalogResponse,
} from "@/app/api/spaces/[id]/entities/catalog/route";

const CATEGORY_ACCENT: Record<string, string> = {
  process: "#10B981",
  relational: "#F97316",
  epistemic: "#EC4899",
  abstract: "#8B5CF6",
  fault: "#EF4444",
  concrete: "#3B82F6",
};

function accentForEntity(e: Entity): string {
  const cat = (e.entity_category as string | null) ?? "concrete";
  return CATEGORY_ACCENT[cat] ?? "#3B82F6";
}

/**
 * True when the catalog entry is the enriched shape. The page-seeded
 * basic entity lacks `kind` + `dominance`. Runtime guard used so the
 * drawer can render both shapes gracefully.
 */
function isEnriched(e: Entity | EntityCatalogEntry): e is EntityCatalogEntry {
  return (
    typeof (e as EntityCatalogEntry).kind === "string" &&
    typeof (e as EntityCatalogEntry).dominance?.score === "number"
  );
}

/**
 * Short dominance-bar string: "▓▓▓░░" style at 5 characters so it
 * fits in the stat pill. Tops out at 5 dots when score ≥ 1.
 */
function dominanceBar(score: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(score * 5)));
  return "▓".repeat(filled) + "░".repeat(5 - filled);
}

export const entityAssetClass: AssetClassDefinition<Entity | EntityCatalogEntry> = {
  class: "entity",
  label: "Entities",
  pluralLabel: "entities",
  icon: CircleDot,
  accent: "#3B82F6",
  group: "graphs",
  groupOrder: 0,
  shapeType: "kg-node",

  fetchForSpace: async (spaceId): Promise<EntityCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/entities/catalog`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as EntitiesCatalogResponse;
    return json.entities ?? [];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    // Enriched row: richer subtitle with kind + upstream/downstream
    // counts; stat shows dominance bar. Basic row: legacy subtitle
    // with just description; stat = layer.
    if (isEnriched(e)) {
      const subBits: string[] = [];
      if (e.kind) subBits.push(e.kind);
      if (e.upstream_count || e.downstream_count) {
        subBits.push(`↑${e.upstream_count} ↓${e.downstream_count}`);
      }
      if (e.chain_count > 0) subBits.push(`${e.chain_count} chain${e.chain_count === 1 ? "" : "s"}`);
      const subtitle = subBits.length > 0 ? subBits.join(" · ") : (e.description ?? null);
      return {
        key: `entity:${e.id}`,
        class: "entity",
        id: e.id,
        title: e.name,
        subtitle,
        stat: dominanceBar(e.dominance.score),
        accent: accentForEntity(e),
        isPlaced: ctx.isPlaced,
        href: ctx.spaceId
          ? `/app/space/${ctx.spaceId}/entity/${e.id}/lab`
          : null,
      };
    }
    return {
      key: `entity:${e.id}`,
      class: "entity",
      id: e.id,
      title: e.name,
      subtitle: e.description ?? null,
      stat: e.layer ?? null,
      accent: accentForEntity(e),
      isPlaced: ctx.isPlaced,
      href: ctx.spaceId
        ? `/app/space/${ctx.spaceId}/entity/${e.id}/lab`
        : null,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "entity",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: e.name,
      subtitle: e.description ?? null,
      accent: accentForEntity(e),
    },
    extras: {
      entity_category: e.entity_category ?? null,
      layer: e.layer ?? null,
      importance: e.importance ?? null,
      confidence: (e.confidence as number | null) ?? null,
      // Pass enriched fields through so canvas shapes can surface
      // them later without re-fetching. No-op when the source row is
      // a basic entity (fields are undefined).
      kind: isEnriched(e) ? e.kind : null,
      dominance_score: isEnriched(e) ? e.dominance.score : null,
      upstream_count: isEnriched(e) ? e.upstream_count : null,
      downstream_count: isEnriched(e) ? e.downstream_count : null,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "kg-node",
      props: {
        entityId: payload.id,
        name: payload.preview.title,
        description: (payload.preview.subtitle as string | null) ?? "",
        layer:
          (typeof ext.layer === "string" && /^L[0-4]$/.test(ext.layer)
            ? ext.layer
            : "L2") as "L0" | "L1" | "L2" | "L3" | "L4",
        category: (typeof ext.entity_category === "string"
          ? ext.entity_category
          : "concrete") as string,
        tier: "support" as const,
        weight:
          typeof ext.confidence === "number"
            ? Math.round(ext.confidence * 100)
            : 70,
        isLeverage: false,
        isRisk: false,
        isBottleneck: false,
        isConvergence: false,
        isGhost: false,
      },
      w: 220,
      h: 112,
    };
  },

  filters: [
    {
      key: "kind",
      label: "Kind",
      extract: (e) => (isEnriched(e) ? e.kind : null),
      presets: [
        "tool",
        "evidence",
        "metric",
        "observation",
        "concept",
        "actor",
        "artifact",
      ],
    },
    {
      key: "category",
      label: "Category",
      extract: (e) => e.entity_category ?? null,
    },
    {
      key: "layer",
      label: "Layer",
      extract: (e) => e.layer ?? null,
    },
    {
      key: "importance",
      label: "Importance",
      extract: (e) => e.importance ?? null,
    },
    {
      key: "cost",
      label: "Cost",
      extract: (e) => (isEnriched(e) ? e.intervention_cost : null),
      presets: ["low", "mid", "high"],
    },
  ],

  shapeIdForItem: (id: string) => `kg-${id}`,
};
