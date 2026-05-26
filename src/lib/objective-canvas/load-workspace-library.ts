// ── Workspace Library Loader ──────────────────────────────────────
//
// Aggregates everything the recents-list-replacement needs into a
// single batched fetch. The previous recents query was:
//
//   SELECT id, name, updated_at FROM spaces WHERE space_kind='objective_canvas'
//
// which produced flat cards with no semantic content. This loader
// returns rich WorkspaceCardData[] including:
//
//   • detected domain (per-space, heuristic over objective text)
//   • totals (rooms / items / elected / composed / experiments)
//   • active themes (from cached distill_concepts findings)
//   • open conflict count (sum across all composed designs in the space)
//   • stage signal (auto-derived: drafted / active / engaged / archived)
//   • freshness (relative time)
//
// All in 4-5 parallel queries — no migration, no new columns.

import {
  detectDomainSignature,
  type DomainSignature,
} from "./domain-signature";
import { readObjectiveCanvasState } from "./clarifying-state";
import type {
  CrossRoomAnalysisState,
  AnalysisFinding,
} from "./analyses/types";
import type { ExpandedItemDetail } from "./expand-item-detail";

/** A workspace's stage — derived, not stored. The user can override
 *  later via a stage-pill UI; for now it's auto-inferred from data
 *  density so the library cards categorize cleanly out of the box. */
export type WorkspaceStage =
  | "drafted" // space exists but no rooms generated yet
  | "active" // rooms exist, exploration in progress
  | "engaged" // ≥1 composed design — user is converging
  | "shipping"; // ≥1 prototype brief planned — user is testing

/** A single recurring theme distilled across rooms in this space.
 *  Surfaced as a chip on the card so the user remembers what each
 *  space is "about" without re-reading the objective. */
export interface WorkspaceTheme {
  name: string;
  /** When the theme was promoted to a sub-objective, link to that. */
  spawned_sub_objective_id: string | null;
}

export interface WorkspaceCardData {
  id: string;
  /** Display name. Falls back to objective text when name is null. */
  display_title: string;
  /** Full objective text — used for the secondary body line + domain
   *  detection. May exceed display_title when name was set. */
  objective_text: string;
  /** Detected via heuristic over the objective text. Surfaces as the
   *  "PRODUCT / JOURNAL / STARTUP …" eyebrow on the card. */
  domain: DomainSignature;
  /** Auto-derived stage. */
  stage: WorkspaceStage;
  totals: {
    rooms: number;
    items: number;
    elected_variations: number;
    composed_designs: number;
    experiments_planned: number;
    open_conflicts: number;
  };
  /** Top 3 themes from distill_concepts findings — first chips shown. */
  themes: WorkspaceTheme[];
  /** Whether a Strategy Brief polish exists — drives the brief
   *  shortcut button's emphasis. */
  has_polished_brief: boolean;
  /** ISO timestamp of last activity (max of room generations + entity
   *  updates + space.updated_at). Drives freshness label. */
  last_active_at: string;
}

interface LoadWorkspaceLibraryArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  /** Hard ceiling — keep cards scannable. Default 12. */
  limit?: number;
}

export async function loadWorkspaceLibrary(
  args: LoadWorkspaceLibraryArgs,
): Promise<WorkspaceCardData[]> {
  const { db, userId } = args;
  const limit = args.limit ?? 12;

  // ── Pass 1 — spaces ──────────────────────────────────────────
  const { data: spaceRows } = await db
    .from("spaces")
    .select(
      "id, name, description, input_text, updated_at, synthesis_data",
    )
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("space_kind", "objective_canvas")
    .order("updated_at", { ascending: false })
    .limit(limit);
  const spaces = (spaceRows ?? []) as Array<{
    id: string;
    name: string | null;
    description: string | null;
    input_text: string | null;
    updated_at: string;
    synthesis_data: Record<string, unknown> | null;
  }>;
  if (spaces.length === 0) return [];

  const spaceIds = spaces.map((s) => s.id);

  // ── Pass 2 — sub-objective room counts per space ─────────────
  // Single query, group client-side.
  const { data: roomRows } = await db
    .from("improvement_goals")
    .select("id, space_id, room_layers_generated_at")
    .in("space_id", spaceIds)
    .not("parent_goal_id", "is", null);
  const rooms = (roomRows ?? []) as Array<{
    id: string;
    space_id: string;
    room_layers_generated_at: string | null;
  }>;
  const roomsBySpace = new Map<string, typeof rooms>();
  for (const r of rooms) {
    const arr = roomsBySpace.get(r.space_id) ?? [];
    arr.push(r);
    roomsBySpace.set(r.space_id, arr);
  }

  // ── Pass 3 — entities with expanded_detail across all rooms ──
  // We select only what we need: layer + expanded_detail (for elections
  // / compositions / experiments / conflicts).
  const allRoomIds = rooms.map((r) => r.id);
  let entityRows: Array<{
    id: string;
    parent_sub_objective_id: string;
    expanded_detail: ExpandedItemDetail | null;
  }> = [];
  if (allRoomIds.length > 0) {
    const { data: rows } = await db
      .from("entities")
      .select("id, parent_sub_objective_id, expanded_detail")
      .in("parent_sub_objective_id", allRoomIds);
    entityRows = (rows ?? []) as typeof entityRows;
  }
  // Bucket entities by room id, then collapse rooms → space.
  const roomToSpace = new Map<string, string>();
  for (const r of rooms) roomToSpace.set(r.id, r.space_id);
  const entitiesBySpace = new Map<string, typeof entityRows>();
  for (const e of entityRows) {
    const sid = roomToSpace.get(e.parent_sub_objective_id);
    if (!sid) continue;
    const arr = entitiesBySpace.get(sid) ?? [];
    arr.push(e);
    entitiesBySpace.set(sid, arr);
  }

  // ── Compose card data per space ──────────────────────────────
  const cards: WorkspaceCardData[] = spaces.map((s) => {
    const objectiveText =
      (s.description && s.description.trim()) ||
      (s.input_text && s.input_text.trim()) ||
      "";

    // Domain — heuristic, uses clarifying answers when present.
    const state = readObjectiveCanvasState(s.synthesis_data);
    const clarifyingAnswers: Array<{ question: string; answer: string }> = [];
    if (state.clarifying) {
      for (const q of state.clarifying.questions) {
        const a = state.clarifying.answers[q.id];
        if (a?.status === "answered" && a.value) {
          clarifyingAnswers.push({ question: q.question, answer: a.value });
        }
      }
    }
    const domain = detectDomainSignature({
      objectiveText,
      clarifyingAnswers,
    });

    // Totals — count from per-space rooms + entities.
    const myRooms = roomsBySpace.get(s.id) ?? [];
    const myEntities = entitiesBySpace.get(s.id) ?? [];
    let electedCount = 0;
    let composedCount = 0;
    let experimentsCount = 0;
    let openConflictCount = 0;
    for (const e of myEntities) {
      const det = e.expanded_detail;
      if (!det) continue;
      // Elected variations.
      if (Array.isArray(det.variations)) {
        for (const v of det.variations) {
          if (v.disposition === "elected") electedCount += 1;
        }
      }
      // Composed design.
      if (det.composed_design && det.composed_design.description) {
        composedCount += 1;
        if (Array.isArray(det.composed_design.conflicts_open)) {
          openConflictCount += det.composed_design.conflicts_open.length;
        }
      }
      // Prototype briefs.
      if (Array.isArray(det.prototype_briefs)) {
        experimentsCount += det.prototype_briefs.length;
      }
    }

    // Themes — from cached cross_room_analysis.
    const cached =
      (s.synthesis_data?.cross_room_analysis as
        | CrossRoomAnalysisState
        | null
        | undefined) ?? null;
    const themes: WorkspaceTheme[] = [];
    if (cached && Array.isArray(cached.findings)) {
      const themeFindings = cached.findings
        .filter(
          (f: AnalysisFinding) =>
            f.analysis_key === "distill_concepts" &&
            f.disposition !== "dismissed",
        )
        .slice(0, 3);
      for (const f of themeFindings) {
        const body = f.body ?? {};
        themes.push({
          name: typeof body.name === "string" ? body.name : f.title,
          spawned_sub_objective_id:
            typeof body.spawned_sub_objective_id === "string"
              ? body.spawned_sub_objective_id
              : null,
        });
      }
    }

    // Has-polished-brief signal.
    const polish = s.synthesis_data?.strategy_brief_polish as
      | Record<string, unknown>
      | null
      | undefined;
    const hasPolishedBrief = !!(
      polish &&
      typeof polish === "object" &&
      typeof polish.tldr === "string" &&
      (polish.tldr as string).length > 0
    );

    // Stage derivation — clear cascade.
    let stage: WorkspaceStage = "drafted";
    if (myRooms.length > 0) stage = "active";
    if (composedCount > 0) stage = "engaged";
    if (experimentsCount > 0) stage = "shipping";

    // Last-active timestamp — pick the freshest of space.updated_at
    // and any room's generated_at.
    let lastActive = s.updated_at;
    for (const r of myRooms) {
      if (r.room_layers_generated_at && r.room_layers_generated_at > lastActive) {
        lastActive = r.room_layers_generated_at;
      }
    }

    return {
      id: s.id,
      display_title: s.name && s.name.trim().length > 0 ? s.name : objectiveText,
      objective_text: objectiveText,
      domain,
      stage,
      totals: {
        rooms: myRooms.length,
        items: myEntities.length,
        elected_variations: electedCount,
        composed_designs: composedCount,
        experiments_planned: experimentsCount,
        open_conflicts: openConflictCount,
      },
      themes,
      has_polished_brief: hasPolishedBrief,
      last_active_at: lastActive,
    };
  });

  // Sort by last_active desc (mostly preserves the space query order).
  cards.sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
  return cards;
}
