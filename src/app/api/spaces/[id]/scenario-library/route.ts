// GET /api/spaces/[id]/scenario-library
//
// Returns a unified list of preset configurations for the lab's
// scenario library panel. Combines:
//   • twin_snapshots rows (saved baselines + general snapshots)
//   • twin_scenarios rows (saved counterfactual scenarios)
//
// Tagged with kind="snapshot" | "scenario" so the UI can render
// distinct icons. Sorted newest-first; capped at 24 entries to keep
// the panel light.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const runtime = "nodejs";

interface SnapshotRow {
  id: string;
  name: string | null;
  description: string | null;
  is_baseline: boolean | null;
  created_at: string;
}

interface ScenarioRow {
  id: string;
  name: string | null;
  description: string | null;
  created_at: string;
}

interface UnifiedPreset {
  id: string;
  kind: "snapshot" | "scenario";
  name: string;
  description: string | null;
  is_baseline?: boolean;
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const [snapshotsRes, scenariosRes] = await Promise.all([
    db
      .from("twin_snapshots")
      .select("id, name, description, is_baseline, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("twin_scenarios")
      .select("id, name, description, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const presets: UnifiedPreset[] = [];

  for (const r of (snapshotsRes.data ?? []) as SnapshotRow[]) {
    presets.push({
      id: r.id,
      kind: "snapshot",
      name: r.name ?? "Untitled snapshot",
      description: r.description,
      is_baseline: !!r.is_baseline,
      created_at: r.created_at,
    });
  }
  for (const r of (scenariosRes.data ?? []) as ScenarioRow[]) {
    presets.push({
      id: r.id,
      kind: "scenario",
      name: r.name ?? "Untitled scenario",
      description: r.description,
      created_at: r.created_at,
    });
  }

  // Stable interleave: newest first overall, baselines bubble to top
  // within ties.
  presets.sort((a, b) => {
    if ((a.is_baseline ? 1 : 0) !== (b.is_baseline ? 1 : 0)) {
      return (b.is_baseline ? 1 : 0) - (a.is_baseline ? 1 : 0);
    }
    return b.created_at.localeCompare(a.created_at);
  });

  return NextResponse.json({ presets: presets.slice(0, 24) });
}
