// GET /api/spaces/[id]/threads/catalog
//
// Phase 2D — aggregates `shape_threads` rows into one catalog
// entry per ROOT thread (a conversation). Each entry surfaces the
// root's content + reply count + latest activity so the Library's
// Threads folder reads like an inbox of discussions across the
// space. The existing `/api/spaces/[id]/threads` endpoint returns
// raw rows for the in-canvas comment rail; this one is the
// library-oriented projection.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface ThreadCatalogEntry {
  /** Stable id for the library row — the root_shape_id (one thread
   *  per shape, so the tuple is unique). */
  id: string;
  space_id: string;
  /** The tldraw shape id the conversation is anchored to. */
  rootShapeId: string;
  /** Root thread content (first message). */
  rootContent: string;
  /** Snapshotted display name from the root row. */
  authorDisplay: string;
  /** Total messages in this thread (including the root). */
  replyCount: number;
  /** First 160 chars of the most recent reply's content, if any. */
  latestReply: string | null;
  /** Most recent updated_at across the whole thread. */
  latestAt: string;
  /** Deepest reply level observed. */
  maxDepth: number;
}

export interface ThreadsCatalogResponse {
  threads: ThreadCatalogEntry[];
  computed_at: string;
  space_name: string;
}

interface ThreadRow {
  id: string;
  shape_id: string;
  parent_shape_id: string | null;
  root_shape_id: string;
  thread_depth: number;
  content: string;
  author_display: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, threadsRes] = await Promise.all([
    db
      .from("spaces")
      .select("id, name, user_id")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("shape_threads")
      .select(
        "id, shape_id, parent_shape_id, root_shape_id, thread_depth, content, author_display, created_at, updated_at, deleted_at",
      )
      .eq("space_id", spaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const spaceName = (spaceRes.data as Space).name;
  const rows = (threadsRes.data ?? []) as ThreadRow[];

  // Group rows by root_shape_id so each library entry represents a
  // full conversation. Compute summary stats as we walk.
  interface ThreadAggregate {
    rootRow: ThreadRow | null;
    rows: ThreadRow[];
    maxDepth: number;
    latestAt: string;
  }
  const byRoot = new Map<string, ThreadAggregate>();
  for (const row of rows) {
    const key = row.root_shape_id;
    const agg: ThreadAggregate = byRoot.get(key) ?? {
      rootRow: null,
      rows: [],
      maxDepth: 0,
      latestAt: row.updated_at,
    };
    agg.rows.push(row);
    if (row.thread_depth === 0) {
      agg.rootRow = row;
    }
    if (row.thread_depth > agg.maxDepth) agg.maxDepth = row.thread_depth;
    if (new Date(row.updated_at).getTime() > new Date(agg.latestAt).getTime()) {
      agg.latestAt = row.updated_at;
    }
    byRoot.set(key, agg);
  }

  const threads: ThreadCatalogEntry[] = [];
  for (const [rootKey, agg] of byRoot) {
    // Fall back to the first row when no explicit root is in the set
    // (happens if the root was soft-deleted but children remain).
    const rootRow =
      agg.rootRow ?? [...agg.rows].sort((a, b) => a.thread_depth - b.thread_depth)[0];
    if (!rootRow) continue;

    const nonRoot = agg.rows
      .filter((r) => r.thread_depth > 0)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    const latestReplyRow = nonRoot[0] ?? null;

    threads.push({
      id: rootKey,
      space_id: spaceId,
      rootShapeId: rootKey,
      rootContent: (rootRow.content ?? "").slice(0, 320),
      authorDisplay: rootRow.author_display ?? "Someone",
      replyCount: agg.rows.length,
      latestReply: latestReplyRow ? latestReplyRow.content.slice(0, 160) : null,
      latestAt: agg.latestAt,
      maxDepth: agg.maxDepth,
    });
  }

  // Most-recently-touched first — matches inbox intuition.
  threads.sort(
    (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
  );

  const payload: ThreadsCatalogResponse = {
    threads,
    computed_at: new Date().toISOString(),
    space_name: spaceName,
  };
  return NextResponse.json(payload);
}
