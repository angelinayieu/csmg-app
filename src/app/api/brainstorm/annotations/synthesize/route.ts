// ── POST /api/brainstorm/annotations/synthesize ─────────────────
//
// Arbitrates between two annotation versions, producing a vfinal +
// arbitration_record (per-phrase justification). Persists as a new
// "synthesis" version and sets active.
//
// Body: { spaceId, versionAId, versionBId }
//   Each id must reference an entry in annotations_versions.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateSynthesizedAnnotations } from "@/lib/objective-canvas/generate-synthesis";
import {
  appendVersion,
  makeVersion,
  parseVersions,
} from "@/lib/objective-canvas/annotation-versions";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  versionAId?: string;
  versionBId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const versionAId =
    typeof body?.versionAId === "string" ? body.versionAId : "";
  const versionBId =
    typeof body?.versionBId === "string" ? body.versionBId : "";
  if (!spaceId || !versionAId || !versionBId) {
    return NextResponse.json(
      { error: "spaceId + versionAId + versionBId required" },
      { status: 400 },
    );
  }
  if (versionAId === versionBId) {
    return NextResponse.json(
      { error: "Pass two distinct version ids." },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: coreRows, error: coreErr } = await db
    .from("improvement_goals")
    .select(
      "id, title, description, user_id, annotations, annotations_versions",
    )
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (coreErr) {
    return NextResponse.json(
      { error: "DB error", detail: coreErr.message },
      { status: 500 },
    );
  }
  const core =
    Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
  if (!core || core.user_id !== auth.user.id) {
    return NextResponse.json(
      { error: "No core objective in this space" },
      { status: 404 },
    );
  }

  const history = parseVersions(core.annotations_versions);
  const v1 = history.find((v) => v.id === versionAId);
  const v2 = history.find((v) => v.id === versionBId);
  if (!v1 || !v2) {
    return NextResponse.json(
      { error: "Version ids not found in history." },
      { status: 404 },
    );
  }

  const objectiveText: string =
    (typeof core.description === "string" && core.description.trim()) ||
    (typeof core.title === "string" && core.title.trim()) ||
    "";

  const { data: subRows } = await db
    .from("improvement_goals")
    .select("id, title, description")
    .eq("space_id", spaceId)
    .eq("parent_goal_id", core.id)
    .order("created_at", { ascending: true });
  const subObjectives = ((subRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
  }>).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
  }));

  try {
    const { annotations: vfinal, arbitration_record } =
      await generateSynthesizedAnnotations({
        objective: objectiveText,
        v1: v1.annotations,
        v2: v2.annotations,
        subObjectives,
      });

    const version = makeVersion(
      vfinal,
      "synthesis",
      [v1.id, v2.id],
      arbitration_record,
    );
    const nextHistory = appendVersion(history, version);

    const writeRes = await db
      .from("improvement_goals")
      .update({
        annotations: vfinal,
        annotations_versions: nextHistory,
      })
      .eq("id", core.id);
    if (writeRes.error) {
      console.warn(
        "[annotations/synthesize] persist failed:",
        writeRes.error.message,
      );
    }

    return NextResponse.json({
      annotations: vfinal,
      arbitration_record,
      version_id: version.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `synthesize failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
