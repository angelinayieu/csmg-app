// GET /api/apps/generation-progress?spaceId=X
//
// Returns the current app-generation progress for a space. The dashboard polls
// this after the user clicks "Approve & launch" to show "Building apps
// (N of M ready)" while the confirm request materializes them.
//
// Response shape:
//   { status: "idle" | "running" | "complete" | "failed",
//     started_at?: string,
//     completed_at?: string,
//     completed_count: number,
//     expected_count: number,
//     apps_created?: number,
//     apps_updated?: number,
//     apps_ready: number  // actual count of apps persisted for the space right now
//   }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership + pull both progress and app count in parallel
  const [spaceRes, appsCountRes] = await Promise.all([
    db.from("spaces").select("user_id, synthesis_data").eq("id", spaceId).single(),
    db.from("apps").select("id", { count: "exact", head: true }).eq("space_id", spaceId),
  ]);

  if (!spaceRes?.data || spaceRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const synthData = (spaceRes.data.synthesis_data as Record<string, unknown>) ?? {};
  const progress = (synthData.app_generation_progress ?? {}) as {
    status?: string;
    started_at?: string;
    completed_at?: string;
    completed_count?: number;
    expected_count?: number;
    apps_created?: number;
    apps_updated?: number;
    last_updated?: string;
  };

  return NextResponse.json({
    status: progress.status ?? "idle",
    started_at: progress.started_at,
    completed_at: progress.completed_at,
    completed_count: progress.completed_count ?? 0,
    expected_count: progress.expected_count ?? 0,
    apps_created: progress.apps_created,
    apps_updated: progress.apps_updated,
    apps_ready: appsCountRes?.count ?? 0,
    last_updated: progress.last_updated,
  });
}
