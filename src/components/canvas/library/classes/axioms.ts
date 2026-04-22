// ── Axiom asset class (Phase A1.4a) ──
//
// Axioms are reasoning foundations inside `spaces.synthesis_data`.
// They regenerate on every synthesis pass, so the library reads them
// as ephemeral records keyed by semantic id (e.g. "A2"). Dropping one
// on the whiteboard captures a frozen copy so the reading survives
// future re-synthesis.

import { Anchor } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { Axiom } from "@/types/synthesis";
import type { AxiomsResponse } from "@/app/api/spaces/[id]/axioms/route";

type LoadBearing = Axiom["load_bearing"];

const LOAD_ACCENT: Record<LoadBearing, string> = {
  critical: "#d97706",
  important: "#0891b2",
  moderate: "#64748b",
};

const LOAD_ORDER: Record<LoadBearing, number> = {
  critical: 3,
  important: 2,
  moderate: 1,
};

export const axiomAssetClass: AssetClassDefinition<Axiom> = {
  class: "axiom",
  label: "Axioms",
  pluralLabel: "axioms",
  icon: Anchor,
  accent: "#d97706",
  group: "data",
  groupOrder: 1,
  shapeType: "axiom-stone",

  fetchForSpace: async (spaceId): Promise<Axiom[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/axioms`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as AxiomsResponse;
    const axioms = json.axioms ?? [];
    // Critical + HIDDEN first (highest-leverage stress-test candidates).
    return [...axioms].sort((a, b) => {
      const visWeight = (v: Axiom["visibility"]) =>
        v === "HIDDEN" ? 3 : v === "IMPLICIT" ? 2 : 1;
      const aScore = (LOAD_ORDER[a.load_bearing] ?? 0) * 10 + visWeight(a.visibility);
      const bScore = (LOAD_ORDER[b.load_bearing] ?? 0) * 10 + visWeight(b.visibility);
      return bScore - aScore;
    });
  },

  toLibraryRow: (a, ctx): LibraryRow => ({
    key: `axiom:${a.axiom_id}`,
    class: "axiom",
    id: a.axiom_id,
    title: a.claim,
    subtitle: a.if_false
      ? `If false → ${a.if_false}`
      : `${a.load_bearing} · ${a.scope}`,
    stat: a.axiom_id,
    accent: LOAD_ACCENT[a.load_bearing],
    isPlaced: ctx.isPlaced,
    href: null, // no standalone axiom page
  }),

  toDragPayload: (a, ctx): LibraryAssetPayload => ({
    class: "axiom",
    id: a.axiom_id,
    spaceId: ctx.spaceId,
    preview: {
      title: a.claim,
      subtitle: a.if_false,
      accent: LOAD_ACCENT[a.load_bearing],
    },
    extras: {
      if_false: a.if_false,
      visibility: a.visibility,
      load_bearing: a.load_bearing,
      scope: a.scope,
      confidence: a.confidence,
      rests_on: a.rests_on,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "axiom-stone",
      props: {
        axiomId: payload.id,
        spaceId: payload.spaceId,
        claim: payload.preview.title,
        ifFalse:
          (ext.if_false as string | undefined) ??
          (payload.preview.subtitle as string | null) ??
          "",
        visibility:
          (ext.visibility as Axiom["visibility"] | undefined) ?? "EXPLICIT",
        loadBearing:
          (ext.load_bearing as LoadBearing | undefined) ?? "moderate",
        scope: (ext.scope as Axiom["scope"] | undefined) ?? "frame",
        confidence:
          (ext.confidence as Axiom["confidence"] | undefined) ?? "medium",
        restsOn: Array.isArray(ext.rests_on)
          ? (ext.rests_on as string[])
          : [],
      },
      w: 280,
      h: 160,
    };
  },

  filters: [
    {
      key: "load_bearing",
      label: "Load",
      extract: (a) => a.load_bearing,
      presets: ["critical", "important", "moderate"],
    },
    {
      key: "visibility",
      label: "Visibility",
      extract: (a) => a.visibility,
      presets: ["EXPLICIT", "IMPLICIT", "HIDDEN"],
    },
  ],

  // axiom_id is semantic (e.g. "A2"), not a UUID. Shape id preserves it.
  shapeIdForItem: (id: string) => `axiom-${id}`,
};
