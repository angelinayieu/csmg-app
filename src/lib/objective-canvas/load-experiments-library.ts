// ── Experiments Library Loader ────────────────────────────────────
//
// Cross-workspace view of every prototype brief the user has
// produced across every objective canvas. This is the "research
// notebook" surface — the single place to see what experiments are
// planned / running / concluded, regardless of which space they
// belong to.
//
// Data path:
//   user → spaces (objective_canvas) → improvement_goals (rooms) →
//   entities → expanded_detail.prototype_briefs[]
//
// We do 3 parallel-ish queries (spaces, rooms, entities) and project
// the leaf brief rows into ExperimentCardData[].

import {
  detectDomainSignature,
  type DomainSignature,
} from "./domain-signature";
import { readObjectiveCanvasState } from "./clarifying-state";
import type { ExpandedItemDetail } from "./expand-item-detail";

/** User-set lifecycle state for a brief. null = not yet touched
 *  (newly-generated briefs default here). The status mutation route
 *  writes these. */
export type ExperimentStatus =
  | "planned"
  | "running"
  | "concluded"
  | "abandoned"
  | null;

export interface ExperimentCardData {
  /** Stable brief id from the prototype_brief itself. */
  id: string;
  /** Domain detected from the parent workspace. */
  domain: DomainSignature;
  /** Status — present only when the user has set it; null otherwise. */
  status: ExperimentStatus;
  /** The hypothesis is the card's headline — what we're testing. */
  hypothesis: string;
  /** Single-line operational anchor — what to watch. */
  signal_to_watch: string;
  /** When to stop — explicit failure threshold. */
  kill_criteria: string;
  /** Effort estimate, domain-shaped string ("3 days" / "1 week"). */
  build_estimate: string;
  /** Domain-adaptive label for the artifact ("5-screen paper
   *  prototype" / "7-day journaling template" / etc). */
  artifact_type: string;
  /** What the user will learn from this — the binary update. */
  learning_target: string;
  /** The open question this brief addresses — context for the
   *  hypothesis. */
  open_question: string;
  /** Optional user-captured result text. Only set when status =
   *  "concluded". Future enhancement — for now, undefined. */
  result_summary?: string;

  /** Where this brief lives. */
  workspace_id: string;
  workspace_title: string;
  item_id: string;
  item_name: string;
  room_id: string;
  room_title: string;

  /** Freshness for sorting. */
  generated_at: string;
}

interface LoadExperimentsLibraryArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  /** Optional cap — default 200 since briefs are lightweight. */
  limit?: number;
}

export async function loadExperimentsLibrary(
  args: LoadExperimentsLibraryArgs,
): Promise<ExperimentCardData[]> {
  const { db, userId } = args;
  const limit = args.limit ?? 200;

  // ── Pass 1 — user's objective canvas spaces ──
  const { data: spaceRows } = await db
    .from("spaces")
    .select("id, name, description, input_text, synthesis_data")
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("space_kind", "objective_canvas");
  const spaces = (spaceRows ?? []) as Array<{
    id: string;
    name: string | null;
    description: string | null;
    input_text: string | null;
    synthesis_data: Record<string, unknown> | null;
  }>;
  if (spaces.length === 0) return [];

  // Detect domain per workspace once — feeds into every brief card
  // from that workspace.
  const workspaceDomain = new Map<string, DomainSignature>();
  const workspaceTitle = new Map<string, string>();
  for (const s of spaces) {
    const objectiveText =
      (s.description && s.description.trim()) ||
      (s.input_text && s.input_text.trim()) ||
      "";
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
    workspaceDomain.set(
      s.id,
      detectDomainSignature({ objectiveText, clarifyingAnswers }),
    );
    workspaceTitle.set(
      s.id,
      s.name && s.name.trim().length > 0 ? s.name : objectiveText,
    );
  }
  const spaceIds = spaces.map((s) => s.id);

  // ── Pass 2 — rooms across those spaces (for room titles) ──
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
  const roomTitleById = new Map<string, string>();
  const roomSpaceById = new Map<string, string>();
  for (const r of rooms) {
    roomTitleById.set(r.id, r.title);
    roomSpaceById.set(r.id, r.space_id);
  }

  if (rooms.length === 0) return [];

  // ── Pass 3 — entities w/ expanded_detail (where briefs live) ──
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

  // ── Flatten briefs ──
  const cards: ExperimentCardData[] = [];
  for (const e of entities) {
    const det = e.expanded_detail;
    if (!det || !Array.isArray(det.prototype_briefs)) continue;
    const roomId = e.parent_sub_objective_id;
    const spaceId = roomSpaceById.get(roomId);
    if (!spaceId) continue;
    const domain = workspaceDomain.get(spaceId) ?? "software";
    const wsTitle = workspaceTitle.get(spaceId) ?? "";
    const roomTitle = roomTitleById.get(roomId) ?? "";

    for (const b of det.prototype_briefs) {
      const status =
        typeof (b as Record<string, unknown>).status === "string"
          ? ((b as Record<string, unknown>).status as ExperimentStatus)
          : null;
      const result =
        typeof (b as Record<string, unknown>).result_summary === "string"
          ? ((b as Record<string, unknown>).result_summary as string)
          : undefined;
      cards.push({
        id: b.id,
        domain,
        status,
        hypothesis: b.hypothesis,
        signal_to_watch: b.signal_to_watch,
        kill_criteria: b.kill_criteria,
        build_estimate: b.build_estimate,
        artifact_type: b.artifact_type,
        learning_target: b.learning_target,
        open_question: b.open_question,
        result_summary: result,
        workspace_id: spaceId,
        workspace_title: wsTitle,
        item_id: e.id,
        item_name: e.name,
        room_id: roomId,
        room_title: roomTitle,
        generated_at: b.generated_at,
      });
    }
  }

  // Sort by freshness, newest first. Cap at limit.
  cards.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  return cards.slice(0, limit);
}
