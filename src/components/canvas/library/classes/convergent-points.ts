// ── Convergent point asset class (Phase A1.4b) ──
//
// Predicted outcomes at a focal entity given particular interactors +
// conditions. Sorted probability-first so high-signal predictions
// surface at the top of the tab.

import { Focus } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { ConvergentPoint, OutcomePolarity } from "@/types/convergent-point";
import type { ConvergentPointsResponse } from "@/app/api/spaces/[id]/convergent-points/route";

const POLARITY_ACCENT: Record<OutcomePolarity, string> = {
  positive: "#16a34a",
  negative: "#db2777",
  neutral: "#64748b",
  conditional: "#d97706",
};

interface EnrichedPoint extends ConvergentPoint {
  _focal_name: string;
  _interactor_names: string[];
}

export const convergentPointAssetClass: AssetClassDefinition<EnrichedPoint> = {
  class: "convergent-point",
  label: "Convergent",
  pluralLabel: "convergent points",
  icon: Focus,
  accent: "#16a34a",
  group: "data",
  groupOrder: 2,
  shapeType: "convergent-fan",

  fetchForSpace: async (spaceId): Promise<EnrichedPoint[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/convergent-points`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as ConvergentPointsResponse;
    const points = json.points ?? [];
    const nameMap = json.entity_name_by_id ?? {};
    return points.map((p) => ({
      ...p,
      _focal_name: nameMap[p.focal_entity_id] ?? "(unknown focal)",
      _interactor_names: (p.interactor_entity_ids ?? [])
        .map((id) => nameMap[id])
        .filter((n): n is string => typeof n === "string"),
    }));
  },

  toLibraryRow: (p, ctx): LibraryRow => {
    const accent = POLARITY_ACCENT[p.outcome.polarity];
    return {
      key: `convergent-point:${p.id}`,
      class: "convergent-point",
      id: p.id,
      title: `${p._focal_name} → ${p.outcome.description}`,
      subtitle:
        p._interactor_names.length > 0
          ? `with ${p._interactor_names.slice(0, 3).join(", ")}`
          : p.outcome.mechanism,
      stat: `${Math.round(p.probability * 100)}%`,
      accent,
      isPlaced: ctx.isPlaced,
      href: ctx.spaceId && p.focal_entity_id
        ? `/app/space/${ctx.spaceId}/entity/${p.focal_entity_id}/lab`
        : null,
    };
  },

  toDragPayload: (p, ctx): LibraryAssetPayload => ({
    class: "convergent-point",
    id: p.id,
    spaceId: ctx.spaceId,
    preview: {
      title: `${p._focal_name} → ${p.outcome.description}`,
      subtitle: p.outcome.mechanism,
      accent: POLARITY_ACCENT[p.outcome.polarity],
    },
    extras: {
      focal_entity_id: p.focal_entity_id,
      focal_name: p._focal_name,
      interactor_names: p._interactor_names,
      outcome: p.outcome.description,
      polarity: p.outcome.polarity,
      probability: p.probability,
      confidence: p.confidence,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const polarity =
      (ext.polarity as OutcomePolarity | undefined) ?? "neutral";
    const probability =
      typeof ext.probability === "number" ? ext.probability : 0.5;
    const confidence =
      typeof ext.confidence === "number" ? ext.confidence : 0.5;
    const interactorNames = Array.isArray(ext.interactor_names)
      ? (ext.interactor_names as string[])
      : [];
    return {
      type: "convergent-fan",
      props: {
        pointId: payload.id,
        spaceId: payload.spaceId,
        focalEntityId: (ext.focal_entity_id as string | undefined) ?? "",
        focalName:
          (ext.focal_name as string | undefined) ??
          payload.preview.title.split("→")[0]?.trim() ??
          "Focal",
        interactorNames,
        outcome: (ext.outcome as string | undefined) ?? "",
        polarity,
        probability,
        confidence,
      },
      w: 280,
      h: 144,
    };
  },

  filters: [
    {
      key: "polarity",
      label: "Polarity",
      extract: (p) => p.outcome.polarity,
      presets: ["positive", "negative", "neutral", "conditional"],
    },
    {
      key: "method",
      label: "Method",
      extract: (p) => p.generation_method,
      presets: [
        "empirical_edge",
        "structural_derivation",
        "analogical_mapping",
        "domain_inference",
        "adversarial",
      ],
    },
  ],

  shapeIdForItem: (id: string) => `convergent-${id}`,
};
