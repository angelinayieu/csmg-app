// ── PATCH /api/brainstorm/space/analysis/disposition ──────────────
//
// Sets a finding's user disposition (open / acknowledged / resolved
// / dismissed). Persists into spaces.synthesis_data.cross_room_analysis.
//
// Body: { spaceId, findingId, disposition }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type {
  CrossRoomAnalysisState,
  FindingDisposition,
} from "@/lib/objective-canvas/analyses/types";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  findingId?: string;
  disposition?: FindingDisposition;
}

const ALLOWED: ReadonlyArray<FindingDisposition> = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
];

export async function PATCH(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  const disposition: FindingDisposition | undefined = ALLOWED.includes(
    body?.disposition ?? ("open" as FindingDisposition),
  )
    ? (body?.disposition as FindingDisposition)
    : undefined;
  if (!spaceId || !findingId || !disposition) {
    return NextResponse.json(
      { error: "spaceId + findingId + disposition required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const cached: CrossRoomAnalysisState | null =
    (space.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  if (!cached || !Array.isArray(cached.findings)) {
    return NextResponse.json(
      { error: "no analysis to update" },
      { status: 409 },
    );
  }

  const idx = cached.findings.findIndex((f) => f.id === findingId);
  if (idx < 0) {
    return NextResponse.json({ error: "finding not found" }, { status: 404 });
  }

  const next: CrossRoomAnalysisState = {
    ...cached,
    findings: cached.findings.map((f, i) =>
      i === idx ? { ...f, disposition } : f,
    ),
  };

  const nextSynth = {
    ...((space.synthesis_data as Record<string, unknown>) ?? {}),
    cross_room_analysis: next,
  };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ analysis: next });
}
