// ── Bridge asset class (Phase A1.3) ──
//
// Cross-space shared variables detected by the weave / bridge agents.
// The library shows them as direct-drop assets; dropping creates a
// `bridge-link` shape that anchors the relationship on-canvas for
// annotation + reasoning.

import { Network } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type {
  EnrichedBridge,
  SpaceBridgesResponse,
} from "@/app/api/spaces/[id]/bridges/route";

type CouplingStrength = EnrichedBridge["coupling_strength"];

const STRENGTH_ORDER: Record<CouplingStrength, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

const BRIDGE_ACCENT = "#22d3ee";

export const bridgeAssetClass: AssetClassDefinition<EnrichedBridge> = {
  class: "bridge",
  label: "Bridges",
  pluralLabel: "bridges",
  icon: Network,
  accent: BRIDGE_ACCENT,
  group: "graphs",
  groupOrder: 1,
  shapeType: "bridge-link",

  fetchForSpace: async (spaceId): Promise<EnrichedBridge[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/bridges`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as SpaceBridgesResponse;
    const bridges = json.bridges ?? [];
    // Strongest couplings bubble to the top — users want the
    // highest-signal links visible first.
    return [...bridges].sort(
      (a, b) =>
        (STRENGTH_ORDER[b.coupling_strength] ?? 0) -
        (STRENGTH_ORDER[a.coupling_strength] ?? 0),
    );
  },

  toLibraryRow: (b, ctx): LibraryRow => {
    const partnerName = b.partner_space_name;
    return {
      key: `bridge:${b.id}`,
      class: "bridge",
      id: b.id,
      title: b.shared_variable_name,
      subtitle: `↔ ${partnerName} · ${b.bridge_type}`,
      stat: b.coupling_strength.toUpperCase().slice(0, 4),
      accent: BRIDGE_ACCENT,
      isPlaced: ctx.isPlaced,
      href: b.partner_entity_id
        ? `/app/space/${b.partner_space_id}/entity/${b.partner_entity_id}/lab`
        : null,
    };
  },

  toDragPayload: (b, ctx): LibraryAssetPayload => ({
    class: "bridge",
    id: b.id,
    spaceId: ctx.spaceId,
    preview: {
      title: b.shared_variable_name,
      subtitle: `${b.bridge_type} · ${b.coupling_strength}`,
      accent: BRIDGE_ACCENT,
    },
    extras: {
      shared_variable_name: b.shared_variable_name,
      this_is_source: b.this_is_source,
      partner_space_id: b.partner_space_id,
      partner_space_name: b.partner_space_name,
      partner_entity_id: b.partner_entity_id,
      partner_entity_name: b.partner_entity_name,
      coupling_strength: b.coupling_strength,
      coupling_direction: b.coupling_direction,
      confidence: b.confidence,
      bridge_type: b.bridge_type,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const thisIsSource = ext.this_is_source === true;
    // "This space" on the originating side, partner name on the other.
    // Library drops keep the originating space as the "source" end so
    // users reading the card always know which side they're anchored
    // on relative to their current whiteboard.
    const sourceLabel = thisIsSource
      ? "This space"
      : (ext.partner_space_name as string | undefined) ?? "(cross-space)";
    const targetLabel = thisIsSource
      ? (ext.partner_space_name as string | undefined) ?? "(cross-space)"
      : "This space";
    const couplingStrength =
      (ext.coupling_strength as CouplingStrength | undefined) ?? "moderate";
    const couplingDirection =
      (ext.coupling_direction as
        | "source_to_target"
        | "target_to_source"
        | "bidirectional"
        | undefined) ?? "bidirectional";
    const confidence =
      typeof ext.confidence === "number" ? ext.confidence : 0.7;
    return {
      type: "bridge-link",
      props: {
        bridgeId: payload.id,
        spaceId: payload.spaceId,
        sharedVariable:
          (ext.shared_variable_name as string | undefined) ??
          payload.preview.title,
        sourceLabel,
        targetLabel,
        couplingStrength,
        couplingDirection,
        confidence,
        partnerEntityId:
          (ext.partner_entity_id as string | null | undefined) ?? null,
        partnerSpaceId:
          (ext.partner_space_id as string | null | undefined) ?? null,
      },
      w: 260,
      h: 128,
    };
  },

  filters: [
    {
      key: "coupling",
      label: "Coupling",
      extract: (b) => b.coupling_strength,
      presets: ["strong", "moderate", "weak"],
    },
    {
      key: "type",
      label: "Type",
      extract: (b) => b.bridge_type,
      presets: ["identity", "influence", "structural"],
    },
    {
      key: "status",
      label: "Status",
      extract: (b) => (b as unknown as { status?: string }).status ?? "active",
      presets: ["active", "user_confirmed", "proposed"],
    },
  ],

  shapeIdForItem: (id: string) => `bridge-${id}`,
};
