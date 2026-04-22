// ── Threads asset class (Phase 2D) ──
//
// 15th asset class. Cross-canvas view of every shape_threads
// conversation in a space. Each catalog entry = one full thread
// (root + all replies aggregated). Dragging a thread onto canvas
// creates a read-only snapshot card pointing back to the source
// shape — a way to pin important discussions to whatever workspace
// a user is currently focused on.

import { MessageSquare } from "lucide-react";
import type {
  AssetClassDefinition,
  LibraryAssetPayload,
  LibraryRow,
} from "../types";
import type {
  ThreadCatalogEntry,
  ThreadsCatalogResponse,
} from "@/app/api/spaces/[id]/threads/catalog/route";

const ACCENT = "#A855F7"; // violet — matches the brainstorm family

export const threadsAssetClass: AssetClassDefinition<ThreadCatalogEntry> = {
  class: "thread",
  label: "Threads",
  pluralLabel: "threads",
  icon: MessageSquare,
  accent: ACCENT,
  group: "data",
  groupOrder: 1, // after Sources + Files, before Claims/Axioms
  shapeType: "thread-snapshot",

  fetchForSpace: async (spaceId): Promise<ThreadCatalogEntry[]> => {
    const res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/threads/catalog`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as ThreadsCatalogResponse;
    return json.threads ?? [];
  },

  toLibraryRow: (e, ctx): LibraryRow => {
    const subtitleBits: string[] = [];
    subtitleBits.push(e.authorDisplay);
    if (e.replyCount > 1) {
      subtitleBits.push(
        `${e.replyCount} message${e.replyCount === 1 ? "" : "s"}`,
      );
    }
    if (e.maxDepth > 0) {
      subtitleBits.push(`depth ${e.maxDepth}`);
    }

    return {
      key: `thread:${e.id}`,
      class: "thread",
      id: e.id,
      title: e.rootContent.slice(0, 80) || "(empty thread)",
      subtitle: subtitleBits.join(" · "),
      stat: String(e.replyCount),
      accent: ACCENT,
      isPlaced: ctx.isPlaced,
      // Click → navigate to the source canvas + highlight the root
      // shape. For now the href points to the whiteboard; future
      // work can add `?focus=shape:<id>` to auto-select on load.
      href: ctx.spaceId ? `/app/space/${ctx.spaceId}/whiteboard` : null,
    };
  },

  toDragPayload: (e): LibraryAssetPayload => ({
    class: "thread",
    id: e.id,
    spaceId: e.space_id,
    preview: {
      title: e.rootContent.slice(0, 120) || "(empty thread)",
      subtitle: e.latestReply ?? e.authorDisplay,
      accent: ACCENT,
    },
    extras: {
      root_shape_id: e.rootShapeId,
      author_display: e.authorDisplay,
      reply_count: e.replyCount,
      latest_reply: e.latestReply,
      latest_at: e.latestAt,
      full_root_content: e.rootContent,
    },
  }),

  toShapeProps: (payload) => {
    const ext = (payload.extras ?? {}) as Record<string, unknown>;
    return {
      type: "thread-snapshot",
      props: {
        threadId: payload.id,
        spaceId: payload.spaceId,
        rootShapeId: (ext.root_shape_id as string | undefined) ?? "",
        rootContent:
          (ext.full_root_content as string | undefined) ??
          payload.preview.title,
        authorDisplay:
          (ext.author_display as string | undefined) ?? "Someone",
        replyCount:
          typeof ext.reply_count === "number" ? ext.reply_count : 1,
        latestReply:
          (ext.latest_reply as string | null | undefined) ?? null,
        latestAt:
          (ext.latest_at as string | undefined) ?? new Date().toISOString(),
        accent: ACCENT,
      },
      w: 280,
      h: 140,
    };
  },

  filters: [
    {
      key: "has_replies",
      label: "Shape",
      extract: (e) => (e.replyCount > 1 ? "conversation" : "single"),
      presets: ["conversation", "single"],
    },
  ],

  shapeIdForItem: (id: string) => `thread-${id}`,
};
