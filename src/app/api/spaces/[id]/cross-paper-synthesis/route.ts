// GET /api/spaces/[id]/cross-paper-synthesis
//
// Initiative 3 — surfaces three findings derived from the user's
// accumulated `evidence_registries` rows for a space:
//   1. recurring claims (same intervention → outcome across ≥2 papers)
//   2. contradictions (same claim with both signs)
//   3. under-supported critical entities (single-paper backings)
//
// Owner-only. Read-only. No caching for v1 — the GROUP BY runs over
// the typical row count (hundreds) in <100ms; premature caching
// invites invalidation bugs.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { computeCrossPaperSynthesis } from "@/lib/synthesis/cross-paper";
import type { CrossPaperSynthesis } from "@/types/cross-paper-synthesis";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";

export const maxDuration = 15;
export const runtime = "nodejs";

interface PaperRow {
  id: string;
  source_name: string;
}

interface EntityRow {
  id: string;
  name: string;
  importance: "fundamental" | "critical" | "important" | "moderate" | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const db = supabase as any;

  // Three reads in parallel — evidence + paper titles + entity importance.
  const [evRes, paperRes, entityRes] = await Promise.all([
    db
      .from("evidence_registries")
      .select("*")
      .eq("space_id", spaceId)
      .in("status", ["extracted", "reviewed"])
      .limit(2000),
    db
      .from("ingested_files")
      .select("id, source_name")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .limit(500),
    db
      .from("entities")
      .select("id, name, importance")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .in("importance", ["fundamental", "critical"])
      .limit(2000),
  ]);

  const evidence = ((evRes.data ?? []) as EvidenceRegistryRow[]) ?? [];
  const papers = ((paperRes.data ?? []) as PaperRow[]) ?? [];
  const entities = ((entityRes.data ?? []) as EntityRow[]) ?? [];

  const paperTitles = new Map<string, string>();
  for (const p of papers) paperTitles.set(p.id, p.source_name);

  const entityMap = new Map<
    string,
    { name: string; importance: "fundamental" | "critical" | "important" | "moderate" }
  >();
  for (const e of entities) {
    if (e.importance === "fundamental" || e.importance === "critical") {
      entityMap.set(e.id, { name: e.name, importance: e.importance });
    }
  }

  const result: CrossPaperSynthesis = computeCrossPaperSynthesis({
    evidence,
    paperTitles,
    entities: entityMap,
  });

  return NextResponse.json(result);
}
