// ── Files asset class (Phase 2D) ──
//
// 14th asset class. Surfaces every `ingested_files` row scoped to
// a space — the normalized output of file uploads, URL drops, and
// pasted text. Closes the UX gap where /api/ingest used to parse
// files + immediately forget them.

import { FileText } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type {
  FileCatalogEntry,
  FilesCatalogResponse,
} from "@/app/api/spaces/[id]/files/catalog/route";

const SOURCE_TYPE_ACCENT: Record<FileCatalogEntry["source_type"], string> = {
  file: "#3B82F6",
  url: "#0891B2",
  text: "#64748B",
};

function typeLabel(entry: FileCatalogEntry): string {
  if (entry.source_type === "url") return "URL";
  if (entry.source_type === "text") return "Text";
  if (entry.mime_type?.includes("pdf")) return "PDF";
  if (
    entry.mime_type?.includes("docx") ||
    entry.mime_type?.includes("wordprocessingml")
  )
    return "DOCX";
  if (entry.mime_type?.startsWith("image/")) return "Image";
  return "File";
}

function formatCharCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const filesAssetClass: AssetClassDefinition<FileCatalogEntry> = {
  class: "file",
  label: "Files",
  pluralLabel: "files",
  icon: FileText,
  accent: "#3B82F6",
  group: "data",
  groupOrder: 0, // after Sources (-1), before Claims (0)
  shapeType: "file-card",

  fetchForSpace: async (spaceId): Promise<FileCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/files/catalog`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as FilesCatalogResponse;
    return json.files ?? [];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    const accent = SOURCE_TYPE_ACCENT[e.source_type];
    const subtitle = [
      typeLabel(e),
      e.extraction_method ?? null,
      `${formatCharCount(e.normalized_chars)} chars`,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      key: `file:${e.id}`,
      class: "file",
      id: e.id,
      title: e.source_name,
      subtitle,
      stat: e.analyzed ? "DONE" : null,
      accent,
      isPlaced: ctx.isPlaced,
      href: e.source_url,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "file",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: e.source_name,
      subtitle: e.preview,
      accent: SOURCE_TYPE_ACCENT[e.source_type],
    },
    extras: {
      source_type: e.source_type,
      mime_type: e.mime_type,
      source_url: e.source_url,
      preview: e.preview,
      char_count: e.normalized_chars,
      analyzed: e.analyzed,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "file-card",
      props: {
        fileId: payload.id,
        spaceId: payload.spaceId,
        sourceName: payload.preview.title,
        sourceType:
          (ext.source_type as "file" | "url" | "text" | undefined) ?? "file",
        mimeType: (ext.mime_type as string | null | undefined) ?? null,
        sourceUrl: (ext.source_url as string | null | undefined) ?? null,
        preview: (ext.preview as string | undefined) ?? "",
        charCount: typeof ext.char_count === "number" ? ext.char_count : 0,
        analyzed: Boolean(ext.analyzed),
        accent: payload.preview.accent ?? "#3B82F6",
      },
      w: 280,
      h: 140,
    };
  },

  filters: [
    {
      key: "source_type",
      label: "Type",
      extract: (e) => e.source_type,
      presets: ["file", "url", "text"],
    },
    {
      key: "analyzed",
      label: "Status",
      extract: (e) => (e.analyzed ? "analyzed" : "pending"),
      presets: ["analyzed", "pending"],
    },
  ],

  shapeIdForItem: (id: string) => `file-${id}`,
};
