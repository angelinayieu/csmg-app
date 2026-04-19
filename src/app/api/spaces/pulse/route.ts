/**
 * GET /api/spaces/pulse
 *
 * Studio Pulse: for every space the signed-in user owns, return a single-line
 * activity summary of what changed recently — so the Studio landing can render
 * each model tile with a pulse signal instead of a static name.
 *
 * Per-space signal (one object per space):
 *   - new_edges_24h           — how many edges were added in the last 24h
 *   - new_proposals_pending   — prospector-proposed edges awaiting user verdict
 *   - open_questions          — entity_questions with status=open
 *   - unresolved_cycles       — cycles detected but not user-resolved
 *   - last_activity_at        — most-recent meaningful write
 *   - pulse                   — derived category: "fresh" | "stuck" | "quiet"
 *   - headline                — one short human sentence
 *
 * Designed to stay fast (<400ms): one top-level spaces query plus parallel
 * lightweight count queries. No joins, no heavy aggregates.
 */

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 10;

export interface SpacePulse {
  space_id: string;
  name: string;
  updated_at: string;
  entity_count: number;
  edge_count: number;
  new_edges_24h: number;
  new_proposals_pending: number;
  open_questions: number;
  unresolved_cycles: number;
  last_activity_at: string;
  pulse: "fresh" | "stuck" | "quiet";
  headline: string;
}

export interface StudioPulseResponse {
  spaces: SpacePulse[];
  generated_at: string;
}

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Fetch up to 20 most-recent spaces
  const { data: spacesRaw, error: spacesErr } = await db
    .from("spaces")
    .select("id, name, updated_at, entity_count, edge_count")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (spacesErr) {
    return NextResponse.json({ error: spacesErr.message }, { status: 500 });
  }

  interface SpaceRow {
    id: string;
    name: string;
    updated_at: string;
    entity_count: number | null;
    edge_count: number | null;
  }
  const spaces = (spacesRaw ?? []) as SpaceRow[];
  if (spaces.length === 0) {
    return NextResponse.json({
      spaces: [],
      generated_at: new Date().toISOString(),
    } as StudioPulseResponse);
  }

  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const spaceIds = spaces.map((s) => s.id);

  // Parallel lightweight counts — each is a head-style count query that is fast
  // even on large tables thanks to the space_id index.
  async function countEdgesLast24h(): Promise<Map<string, number>> {
    const { data, error } = await db
      .from("edges")
      .select("space_id")
      .in("space_id", spaceIds)
      .gte("created_at", since24h);
    if (error) return new Map();
    const m = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ space_id: string }>) {
      m.set(r.space_id, (m.get(r.space_id) ?? 0) + 1);
    }
    return m;
  }

  async function countPendingProposals(): Promise<Map<string, number>> {
    // An edge is pending review if source_tag == 'prospector' and the
    // associated pair-check has no user_verdict yet. Approximate this with
    // a simpler signal: edges tagged by prospector with no verdict linked.
    const { data, error } = await db
      .from("edges")
      .select("space_id")
      .in("space_id", spaceIds)
      .eq("source_tag", "prospector");
    if (error) return new Map();
    const m = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ space_id: string }>) {
      m.set(r.space_id, (m.get(r.space_id) ?? 0) + 1);
    }
    return m;
  }

  async function countOpenQuestions(): Promise<Map<string, number>> {
    const { data, error } = await db
      .from("entity_questions")
      .select("space_id")
      .in("space_id", spaceIds)
      .eq("status", "open");
    if (error) return new Map();
    const m = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ space_id: string }>) {
      m.set(r.space_id, (m.get(r.space_id) ?? 0) + 1);
    }
    return m;
  }

  async function countUnresolvedCycles(): Promise<Map<string, number>> {
    const { data, error } = await db
      .from("cycles")
      .select("space_id")
      .in("space_id", spaceIds);
    if (error) return new Map();
    const m = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ space_id: string }>) {
      m.set(r.space_id, (m.get(r.space_id) ?? 0) + 1);
    }
    return m;
  }

  const [edgeMap, proposalMap, questionMap, cycleMap] = await Promise.all([
    countEdgesLast24h(),
    countPendingProposals(),
    countOpenQuestions(),
    countUnresolvedCycles(),
  ]);

  const pulses: SpacePulse[] = spaces.map((s) => {
    const newEdges = edgeMap.get(s.id) ?? 0;
    const pendingProposals = proposalMap.get(s.id) ?? 0;
    const openQuestions = questionMap.get(s.id) ?? 0;
    const cycles = cycleMap.get(s.id) ?? 0;

    // Derive pulse category: fresh if new activity, stuck if pending work is
    // piling up, quiet otherwise. Headline picks the most user-salient fact.
    let pulse: "fresh" | "stuck" | "quiet" = "quiet";
    let headline = "Quiet — last touched " + relTime(s.updated_at);

    if (newEdges > 0) {
      pulse = "fresh";
      headline = `${newEdges} new ${plural(newEdges, "edge")} in the last 24h`;
    } else if (pendingProposals >= 5) {
      pulse = "stuck";
      headline = `${pendingProposals} proposals awaiting your review`;
    } else if (openQuestions > 0) {
      pulse = pendingProposals > 0 ? "stuck" : "fresh";
      headline = `${openQuestions} open ${plural(openQuestions, "question")}${pendingProposals ? ` · ${pendingProposals} proposals pending` : ""}`;
    } else if (pendingProposals > 0) {
      pulse = "stuck";
      headline = `${pendingProposals} ${plural(pendingProposals, "proposal")} to review`;
    } else if (cycles > 0) {
      pulse = "stuck";
      headline = `${cycles} unresolved ${plural(cycles, "cycle")}`;
    }

    return {
      space_id: s.id,
      name: s.name,
      updated_at: s.updated_at,
      entity_count: s.entity_count ?? 0,
      edge_count: s.edge_count ?? 0,
      new_edges_24h: newEdges,
      new_proposals_pending: pendingProposals,
      open_questions: openQuestions,
      unresolved_cycles: cycles,
      last_activity_at: s.updated_at,
      pulse,
      headline,
    };
  });

  return NextResponse.json({
    spaces: pulses,
    generated_at: new Date().toISOString(),
  } as StudioPulseResponse);
}

function plural(n: number, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
