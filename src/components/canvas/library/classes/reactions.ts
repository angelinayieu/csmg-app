// ── Reaction asset class (Phase A1.1) ──
//
// Reactions are the simplest non-entity class to wire because the data
// + types + fetch endpoint already exist (Phase 30). This file defines
// the registry entry; the new tldraw shape util lives in
// `shapes/reaction-card-shape.tsx`.

import { FlaskConical } from "lucide-react";
import type { AssetClassDefinition, LibraryRow, LibraryAssetPayload } from "../types";
import type { Reaction, ReactionType } from "@/types/reactions";

const REACTION_TYPE_ACCENT: Record<ReactionType, string> = {
  emergent: "#16a34a",
  reinforcing: "#0891b2",
  tension: "#db2777",
  trivial: "#64748b",
};

export const reactionAssetClass: AssetClassDefinition<Reaction> = {
  class: "reaction",
  label: "Reactions",
  pluralLabel: "reactions",
  icon: FlaskConical,
  accent: "#16a34a",
  group: "reasoning",
  groupOrder: 0,
  shapeType: "reaction-card",

  fetchForSpace: async (spaceId): Promise<Reaction[]> => {
    // Reuses the Phase 30 endpoint (which already powers Phase 30 reaction badges + Phase 36 synthesis feed).
    const res = await fetch(
      `/api/canvas/reactions?spaceId=${encodeURIComponent(spaceId)}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { reactions?: Reaction[] };
    return json.reactions ?? [];
  },

  toLibraryRow: (r, ctx): LibraryRow => ({
    key: `reaction:${r.id}`,
    class: "reaction",
    id: r.id,
    title: r.name,
    subtitle:
      r.implication ??
      r.mechanism ??
      `${r.entity_ids.length} participants · ${r.reaction_type}`,
    stat: `${Math.round(r.probability * 100)}%`,
    accent: REACTION_TYPE_ACCENT[r.reaction_type],
    isPlaced: ctx.isPlaced,
    href: ctx.spaceId
      ? `/app/space/${ctx.spaceId}/lab?rxn=${r.id}`
      : null,
  }),

  toDragPayload: (r): LibraryAssetPayload => ({
    class: "reaction",
    id: r.id,
    spaceId: r.space_id,
    preview: {
      title: r.name,
      subtitle: r.implication ?? r.mechanism ?? null,
      accent: REACTION_TYPE_ACCENT[r.reaction_type],
    },
    extras: {
      reaction_type: r.reaction_type,
      probability: r.probability,
      entity_ids: r.entity_ids,
      mechanism: r.mechanism ?? null,
      implication: r.implication ?? null,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const reactionType =
      (ext.reaction_type as ReactionType | undefined) ?? "trivial";
    const probability =
      typeof ext.probability === "number" ? ext.probability : 0.5;
    const entityIds = Array.isArray(ext.entity_ids)
      ? (ext.entity_ids as string[])
      : [];
    return {
      type: "reaction-card",
      props: {
        reactionId: payload.id,
        spaceId: payload.spaceId,
        name: payload.preview.title,
        reactionType,
        probability,
        entityCount: entityIds.length,
        accent: payload.preview.accent ?? REACTION_TYPE_ACCENT[reactionType],
      },
      w: 240,
      h: 132,
    };
  },

  filters: [
    {
      key: "type",
      label: "Type",
      extract: (r) => r.reaction_type,
      presets: ["emergent", "reinforcing", "tension", "trivial"],
    },
  ],

  // Reaction shapes use deterministic ids `reaction-${id}` so the
  // library can show a placed checkmark.
  shapeIdForItem: (id: string) => `reaction-${id}`,
};
