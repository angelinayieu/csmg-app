// ── POST /api/tools/[id]/run ──
//
// Invoke a registered tool connector and return its normalized result
// set. Auth-gated (tools burn external quota, however small, and we
// want invocations tied to a known user).
//
// Body: { query: string, maxResults?: number, freshnessSince?: string, extras?: object }
// Returns: ToolResult — hits[] + error + durationMs.
//
// This is the integration point where canvas sidecars, research
// pipelines, and future intake-bootstrap flows hit the registry.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { getTool, runTool } from "@/lib/tools/registry";
import type { ToolInput } from "@/lib/tools/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!getTool(id)) {
    return NextResponse.json(
      { error: `Unknown tool: ${id}` },
      { status: 404 },
    );
  }

  let body: Partial<ToolInput>;
  try {
    body = (await req.json()) as Partial<ToolInput>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2) {
    return NextResponse.json(
      { error: "query required (≥2 chars)" },
      { status: 400 },
    );
  }

  const input: ToolInput = {
    query,
    maxResults:
      typeof body.maxResults === "number" && body.maxResults > 0
        ? Math.min(body.maxResults, 50)
        : undefined,
    freshnessSince:
      typeof body.freshnessSince === "string" ? body.freshnessSince : undefined,
    extras:
      body.extras && typeof body.extras === "object" ? body.extras : undefined,
  };

  const result = await runTool(id, input);
  return NextResponse.json(result);
}
