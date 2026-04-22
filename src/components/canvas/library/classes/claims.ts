// ── Claim asset class (Phase A1.4a) ──
//
// Statements with an epistemic status (proposed/supported/contested/
// refuted). Surfaced as compact chips users can drop on the whiteboard
// to reason about evidence.

import { BookOpen } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type { Claim } from "@/types";
import type { ClaimsResponse } from "@/app/api/spaces/[id]/claims/route";

type Status = Claim["status"];

const STATUS_ACCENT: Record<Status, string> = {
  proposed: "#64748b",
  supported: "#16a34a",
  contested: "#d97706",
  refuted: "#dc2626",
};

const STATUS_ORDER: Record<Status, number> = {
  contested: 4, // most interesting — unresolved
  proposed: 3,
  refuted: 2,
  supported: 1, // least actionable (already settled)
};

interface ClaimWithName extends Claim {
  _source_entity_name: string | null;
}

export const claimAssetClass: AssetClassDefinition<ClaimWithName> = {
  class: "claim",
  label: "Claims",
  pluralLabel: "claims",
  icon: BookOpen,
  accent: "#16a34a",
  group: "data",
  groupOrder: 0,
  shapeType: "claim-chip",

  fetchForSpace: async (spaceId): Promise<ClaimWithName[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/claims`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as ClaimsResponse;
    const claims = json.claims ?? [];
    const nameMap = json.source_entity_name_by_id ?? {};
    // Sort contested + proposed first (unresolved); supported last.
    return claims
      .map((c) => ({
        ...c,
        _source_entity_name: c.source_entity_id
          ? nameMap[c.source_entity_id] ?? null
          : null,
      }))
      .sort(
        (a, b) =>
          (STATUS_ORDER[b.status] ?? 0) - (STATUS_ORDER[a.status] ?? 0),
      );
  },

  toLibraryRow: (c, ctx): LibraryRow => ({
    key: `claim:${c.id}`,
    class: "claim",
    id: c.id,
    title: c.claim_text,
    subtitle: c._source_entity_name
      ? `${c.claim_type} · from ${c._source_entity_name}`
      : c.claim_type,
    stat: `${Math.round(c.confidence * 100)}%`,
    accent: STATUS_ACCENT[c.status],
    isPlaced: ctx.isPlaced,
    href:
      c.source_entity_id && ctx.spaceId
        ? `/app/space/${ctx.spaceId}/entity/${c.source_entity_id}/lab`
        : null,
  }),

  toDragPayload: (c, ctx): LibraryAssetPayload => ({
    class: "claim",
    id: c.id,
    spaceId: ctx.spaceId,
    preview: {
      title: c.claim_text,
      subtitle: c._source_entity_name ?? c.claim_type,
      accent: STATUS_ACCENT[c.status],
    },
    extras: {
      claim_type: c.claim_type,
      status: c.status,
      confidence: c.confidence,
      source_entity_id: c.source_entity_id,
      source_entity_name: c._source_entity_name,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    const claimType = (ext.claim_type as Claim["claim_type"] | undefined) ?? "assertion";
    const status = (ext.status as Status | undefined) ?? "proposed";
    const confidence =
      typeof ext.confidence === "number" ? ext.confidence : 0.5;
    return {
      type: "claim-chip",
      props: {
        claimId: payload.id,
        spaceId: payload.spaceId,
        claimText: payload.preview.title,
        claimType,
        status,
        confidence,
        sourceEntityId:
          (ext.source_entity_id as string | null | undefined) ?? null,
        sourceEntityName:
          (ext.source_entity_name as string | null | undefined) ?? null,
      },
      w: 240,
      h: 128,
    };
  },

  filters: [
    {
      key: "status",
      label: "Status",
      extract: (c) => c.status,
      presets: ["proposed", "supported", "contested", "refuted"],
    },
    {
      key: "type",
      label: "Type",
      extract: (c) => c.claim_type,
      presets: ["mechanism", "assertion", "prediction", "assumption", "finding"],
    },
  ],

  shapeIdForItem: (id: string) => `claim-${id}`,
};
