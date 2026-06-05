// ── GET/POST /api/objective/[spaceId]/artifacts ───────────────────────
//
// The shared access layer for the Artifacts "final products" model
// (ARTIFACTS_DOCK_PLAN.md). The Artifact Dock + the Artifacts Library go
// through THIS route so they share one model. Thin wrapper over
// lib/objective-canvas/artifacts.ts; all helpers soft-fail.
//
// GET  → list the space's artifacts (optional ?type / ?status).
// POST → { action: "upsert" | "run_notebook" | "mark_stale" | "version", … }.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import {
  upsertArtifact,
  appendArtifactVersion,
  markArtifactStale,
  listArtifacts,
  type ArtifactType,
  type ArtifactStatus,
  type ArtifactStaleReason,
  type ListArtifactsFilter,
} from "@/lib/objective-canvas/artifacts";
import {
  synthesizeNotebookForSpace,
  type NotebookQuote,
} from "@/lib/objective-canvas/generate-notebook";
import { blocksToSections } from "@/lib/objective-canvas/notebook-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

/** Auth + ownership. Returns the scoped db + userId, or a NextResponse error. */
async function authorize(spaceId: string) {
  const auth = await safeAuth();
  if (auth.error) return { error: auth.error as NextResponse };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { db, userId: auth.user.id as string };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const a = await authorize(spaceId);
  if ("error" in a) return a.error;

  const sp = req.nextUrl.searchParams;
  const filter: ListArtifactsFilter = {};
  const type = sp.get("type");
  if (type) filter.artifactType = type as ArtifactType;
  const status = sp.get("status");
  if (status) filter.status = status as ArtifactStatus;

  const artifacts = await listArtifacts(a.db, spaceId, filter);
  return NextResponse.json({ artifacts });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const a = await authorize(spaceId);
  if ("error" in a) return a.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  switch (action) {
    case "upsert": {
      const id = await upsertArtifact(a.db, {
        spaceId,
        userId: a.userId,
        artifactType: (body.artifactType as ArtifactType) ?? "custom",
        engineKey: typeof body.engineKey === "string" ? body.engineKey : "custom",
        title: typeof body.title === "string" ? body.title : undefined,
        status: (body.status as ArtifactStatus) ?? undefined,
        config: body.config ?? undefined,
        content: body.content ?? undefined,
        sourceObjectIds: Array.isArray(body.sourceObjectIds)
          ? (body.sourceObjectIds as string[])
          : undefined,
        sourceShapeIds: Array.isArray(body.sourceShapeIds)
          ? (body.sourceShapeIds as string[])
          : undefined,
        boardShapeId:
          typeof body.boardShapeId === "string" ? body.boardShapeId : null,
        lastUpdatedBy:
          typeof body.lastUpdatedBy === "string" ? body.lastUpdatedBy : undefined,
      });
      if (id && body.appendVersion) {
        await appendArtifactVersion(a.db, id, {
          content: body.content ?? undefined,
          config: body.config ?? undefined,
          changeType:
            (body.changeType as
              | "generated"
              | "user_edit"
              | "agent_update"
              | "refresh") ?? "generated",
          changedBy: a.userId,
        });
      }
      return NextResponse.json({ id });
    }

    // Weave the Notebook on demand (ARTIFACTS_DOCK_PLAN.md §5). Append-only:
    // incorporates NEW voice notes + any `quotes` (cards added from the
    // whiteboard) as fresh blocks; never rewrites existing user/quote blocks.
    // Persists the artifact (+ version) and returns block content + a sections
    // projection so the dock can deploy the journal-card handle.
    case "run_notebook": {
      const quotes: NotebookQuote[] = Array.isArray(body.quotes)
        ? (body.quotes as unknown[])
            .map((q) => {
              const o = (q ?? {}) as Record<string, unknown>;
              return {
                text: typeof o.text === "string" ? o.text : "",
                sourceObjectId:
                  typeof o.sourceObjectId === "string" ? o.sourceObjectId : null,
              };
            })
            .filter((q) => q.text.trim())
        : [];
      const boardShapeId =
        typeof body.boardShapeId === "string" ? body.boardShapeId : null;
      const result = await synthesizeNotebookForSpace(a.db, spaceId, a.userId, {
        quotes,
        boardShapeId,
      });
      if (!result) {
        return NextResponse.json(
          { error: "Nothing to weave yet — record a note or add a card first." },
          { status: 400 },
        );
      }
      const { content, artifactId } = result;
      return NextResponse.json({
        id: artifactId,
        title: content.title,
        blocks: content.blocks,
        wovenCount: content.wovenCount,
        sections: blocksToSections(content.blocks),
        pageCount: Math.max(1, Math.ceil(content.blocks.length / 2)),
      });
    }

    case "mark_stale": {
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : "";
      if (!artifactId)
        return NextResponse.json({ error: "artifactId required" }, { status: 400 });
      await markArtifactStale(
        a.db,
        artifactId,
        (body.reason as ArtifactStaleReason) ?? "source_changed",
      );
      return NextResponse.json({ ok: true });
    }

    case "version": {
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : "";
      if (!artifactId)
        return NextResponse.json({ error: "artifactId required" }, { status: 400 });
      await appendArtifactVersion(a.db, artifactId, {
        content: body.content ?? undefined,
        config: body.config ?? undefined,
        changeType:
          (body.changeType as
            | "generated"
            | "user_edit"
            | "agent_update"
            | "refresh") ?? "user_edit",
        changeSummary:
          typeof body.changeSummary === "string" ? body.changeSummary : null,
        changedBy: a.userId,
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
}
