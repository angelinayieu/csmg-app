// ── Sources asset class (Phase 2D) ──
//
// Thirteenth asset class, first in the DATA section — external
// inputs feeding the graph. Unifies three backing data streams
// (evidence_items, external entities, integration placeholders)
// under one folder so the user has a single "inventory of inputs"
// surface.
//
// Integration placeholders render as draggable tiles with
// "coming_soon" status. Dragging one onto canvas drops a source
// card with an integration-placeholder type — useful as a visible
// todo ("I want to connect Slack") until the real OAuth surface
// ships. Once `user_integrations` lands, those placeholders flip
// to "available" / "connected" and gain a real Connect CTA.

import { Link2 } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type {
  SourceCatalogEntry,
  SourcesCatalogResponse,
} from "@/app/api/spaces/[id]/sources/catalog/route";

/**
 * Human-readable provider labels. Used by both the library row
 * subtitle + the filter preset chips.
 */
const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  slack: "Slack",
  drive: "Drive",
  notion: "Notion",
  github: "GitHub",
  apple_notes: "Apple Notes",
  arxiv: "arXiv",
  web: "Web",
  file_upload: "Upload",
};

function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "Unknown";
  return PROVIDER_LABEL[provider] ?? provider;
}

export const sourcesAssetClass: AssetClassDefinition<SourceCatalogEntry> = {
  class: "source",
  label: "Sources",
  pluralLabel: "sources",
  icon: Link2,
  accent: "#64748B",
  group: "data",
  // Position first in the data group — sources are upstream of
  // claims + axioms (which derive from them).
  groupOrder: -1,
  shapeType: "source-card",

  fetchForSpace: async (spaceId): Promise<SourceCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/sources/catalog`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as SourcesCatalogResponse;
    return json.sources ?? [];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    const isIntegration = e.type === "integration_placeholder";
    // Integration placeholders show the item count in their space
    // as the mini-stat, so the user can tell at a glance which
    // providers have content already ingested.
    const stat = isIntegration
      ? e.item_count && e.item_count > 0
        ? String(e.item_count)
        : "—"
      : e.reliability != null
        ? `${Math.round(e.reliability * 100)}%`
        : null;

    const subtitle = isIntegration
      ? e.status === "coming_soon"
        ? `Coming soon · ${e.snippet}`
        : e.snippet
      : e.domain
        ? `${providerLabel(e.provider)} · ${e.domain}`
        : providerLabel(e.provider);

    return {
      key: `source:${e.id}`,
      class: "source",
      id: e.id,
      title: e.title,
      subtitle,
      stat,
      accent: e.accent,
      isPlaced: ctx.isPlaced,
      href: e.url,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "source",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: e.title,
      subtitle: e.snippet,
      accent: e.accent,
    },
    extras: {
      type: e.type,
      url: e.url,
      domain: e.domain,
      provider: e.provider,
      reliability: e.reliability,
      status: e.status,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "source-card",
      props: {
        sourceId: payload.id,
        spaceId: payload.spaceId,
        title: payload.preview.title,
        snippet:
          typeof payload.preview.subtitle === "string"
            ? payload.preview.subtitle
            : "",
        url: (ext.url as string | null | undefined) ?? null,
        domain: (ext.domain as string | null | undefined) ?? null,
        sourceType:
          (ext.type as
            | "evidence"
            | "external_entity"
            | "file"
            | "url"
            | "integration_placeholder"
            | undefined) ?? "url",
        provider: (ext.provider as string | null | undefined) ?? null,
        reliability:
          typeof ext.reliability === "number" ? ext.reliability : null,
        accent: payload.preview.accent ?? "#64748B",
      },
      w: 280,
      h: 120,
    };
  },

  filters: [
    {
      key: "type",
      label: "Kind",
      extract: (e) => e.type,
      presets: [
        "integration_placeholder",
        "evidence",
        "external_entity",
        "file",
        "url",
      ],
    },
    {
      key: "provider",
      label: "Provider",
      extract: (e) => e.provider,
      presets: [
        "gmail",
        "slack",
        "drive",
        "notion",
        "github",
        "apple_notes",
        "arxiv",
        "web",
        "file_upload",
      ],
    },
    {
      key: "status",
      label: "Status",
      extract: (e) => e.status,
      presets: ["connected", "available", "coming_soon"],
    },
  ],

  // Stable shape id — re-dropping the same source replaces on canvas.
  shapeIdForItem: (id: string) => `source-${id}`,
};
