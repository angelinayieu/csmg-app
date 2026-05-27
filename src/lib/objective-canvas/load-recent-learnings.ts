// ── Recent Learnings Loader ───────────────────────────────────────
//
// Reads concluded (and optionally abandoned) prototype briefs from
// across the user's spaces and returns RecentLearning[] for prompt
// injection. The single source of "what the user has TESTED" that
// any downstream generation can read — closes the amnesia loop
// where the system used to propose mechanisms the user had already
// tried and discarded.
//
// Two modes:
//   • space-scoped — only this space's learnings (rooms in same
//     workspace). Use for room/item/composition generation where
//     project-local context is what matters.
//   • cross-space — every learning across every objective canvas.
//     Use for the Strategy Brief polish, recommend_next_move, and
//     any "your strategy memory" surfaces.
//
// Sort newest-first by status_updated_at. Cap default 8 to keep
// prompt cost bounded.

import type { ExpandedItemDetail } from "./expand-item-detail";

/** A single learning the user has captured. Compact shape for
 *  prompt injection — only the fields a generation actually needs. */
export interface RecentLearning {
  /** "concluded" or "abandoned" — both are signal. */
  status: "concluded" | "abandoned";
  /** The hypothesis the user tested. */
  hypothesis: string;
  /** What they were going to watch for (the signal definition). */
  signal_to_watch: string;
  /** User's written result. Empty when abandoned without notes. */
  result_summary: string;
  /** ISO timestamp the status was set. Drives sort order + recency. */
  status_updated_at: string;
  /** Workspace title — for cross-space mode, lets the LLM say
   *  "in your X project you found Y." */
  workspace_title: string;
  /** Sub-room title within that workspace. */
  room_title: string;
  /** Item the brief was attached to. */
  item_name: string;
}

export interface LoadRecentLearningsArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  /** Scope filter:
   *   - { spaceId }   — only this workspace's learnings
   *   - { }           — every space owned by this user (cross-space) */
  spaceId?: string;
  /** Hard cap on returned rows. Default 8 — enough signal, not so
   *  much that prompts balloon. */
  limit?: number;
  /** When true, also include "abandoned" briefs. Most callers want
   *  this (abandonment IS a learning) — default true. */
  includeAbandoned?: boolean;
}

export async function loadRecentLearnings(
  args: LoadRecentLearningsArgs,
): Promise<RecentLearning[]> {
  const { db, userId, spaceId } = args;
  const limit = args.limit ?? 8;
  const includeAbandoned = args.includeAbandoned ?? true;

  // ── Pass 1 — locate the space(s) we care about + their names ──
  const spaceQuery = db
    .from("spaces")
    .select("id, name, description, input_text")
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("space_kind", "objective_canvas");
  const { data: spaceRows } = spaceId
    ? await spaceQuery.eq("id", spaceId)
    : await spaceQuery;
  const spaces = (spaceRows ?? []) as Array<{
    id: string;
    name: string | null;
    description: string | null;
    input_text: string | null;
  }>;
  if (spaces.length === 0) return [];
  const spaceTitleById = new Map<string, string>();
  for (const s of spaces) {
    const title =
      (s.name && s.name.trim()) ||
      (s.description && s.description.trim().slice(0, 60)) ||
      (s.input_text && s.input_text.trim().slice(0, 60)) ||
      "Untitled";
    spaceTitleById.set(s.id, title);
  }
  const spaceIds = spaces.map((s) => s.id);

  // ── Pass 2 — rooms across those spaces ──
  const { data: roomRows } = await db
    .from("improvement_goals")
    .select("id, title, space_id")
    .in("space_id", spaceIds)
    .not("parent_goal_id", "is", null);
  const rooms = (roomRows ?? []) as Array<{
    id: string;
    title: string;
    space_id: string;
  }>;
  if (rooms.length === 0) return [];
  const roomTitleById = new Map<string, string>();
  const roomSpaceById = new Map<string, string>();
  for (const r of rooms) {
    roomTitleById.set(r.id, r.title);
    roomSpaceById.set(r.id, r.space_id);
  }

  // ── Pass 3 — entities with expanded_detail (where briefs live) ──
  const roomIds = rooms.map((r) => r.id);
  const { data: entityRows } = await db
    .from("entities")
    .select("id, name, parent_sub_objective_id, expanded_detail")
    .in("parent_sub_objective_id", roomIds);
  const entities = (entityRows ?? []) as Array<{
    id: string;
    name: string;
    parent_sub_objective_id: string;
    expanded_detail: ExpandedItemDetail | null;
  }>;

  // ── Flatten concluded / abandoned briefs ──
  const learnings: RecentLearning[] = [];
  for (const e of entities) {
    const det = e.expanded_detail;
    if (!det || !Array.isArray(det.prototype_briefs)) continue;
    const roomId = e.parent_sub_objective_id;
    const spId = roomSpaceById.get(roomId);
    if (!spId) continue;
    const wsTitle = spaceTitleById.get(spId) ?? "Untitled";
    const roomTitle = roomTitleById.get(roomId) ?? "";

    for (const b of det.prototype_briefs) {
      const status = (b as Record<string, unknown>).status;
      const isConcluded = status === "concluded";
      const isAbandoned = status === "abandoned";
      if (!isConcluded && !(includeAbandoned && isAbandoned)) continue;
      const updatedAt =
        typeof (b as Record<string, unknown>).status_updated_at === "string"
          ? ((b as Record<string, unknown>).status_updated_at as string)
          : b.generated_at;
      const resultSummary =
        typeof (b as Record<string, unknown>).result_summary === "string"
          ? ((b as Record<string, unknown>).result_summary as string)
          : "";
      // A concluded brief with no result_summary tells us LESS than
      // an abandoned one — skip empty-conclusion entries so prompt
      // noise stays low.
      if (isConcluded && resultSummary.trim().length === 0) continue;
      learnings.push({
        status: isConcluded ? "concluded" : "abandoned",
        hypothesis: b.hypothesis,
        signal_to_watch: b.signal_to_watch,
        result_summary: resultSummary,
        status_updated_at: updatedAt,
        workspace_title: wsTitle,
        room_title: roomTitle,
        item_name: e.name,
      });
    }
  }

  learnings.sort((a, b) =>
    b.status_updated_at.localeCompare(a.status_updated_at),
  );
  return learnings.slice(0, limit);
}

/** Render learnings into a compact prompt block. Returns empty
 *  string when none, so callers can template uniformly. Caller
 *  decides whether to inject — typically every generation that
 *  could benefit from "respect what's already been tried." */
export function buildLearningsBlock(
  learnings: RecentLearning[],
  opts: { crossSpace?: boolean } = {},
): string {
  if (learnings.length === 0) return "";
  const header = opts.crossSpace
    ? "LEARNINGS FROM YOUR PRIOR EXPERIMENTS (across your strategy memory — respect these, don't propose mechanisms you've already tested):"
    : "LEARNINGS FROM YOUR EXPERIMENTS IN THIS SPACE (respect these, don't propose mechanisms you've already discarded):";
  const lines = [header];
  for (const L of learnings) {
    const tag = L.status === "concluded" ? "✓ CONCLUDED" : "✕ ABANDONED";
    const where = opts.crossSpace
      ? ` (${L.workspace_title} › ${L.room_title} › ${L.item_name})`
      : ` (${L.room_title} › ${L.item_name})`;
    lines.push(`  ${tag}${where}`);
    lines.push(`    Hypothesis: ${L.hypothesis}`);
    if (L.result_summary) {
      lines.push(`    Result: ${L.result_summary}`);
    } else if (L.status === "abandoned") {
      lines.push(`    Result: abandoned without recorded notes`);
    }
  }
  return `\n\n${lines.join("\n")}\n`;
}
