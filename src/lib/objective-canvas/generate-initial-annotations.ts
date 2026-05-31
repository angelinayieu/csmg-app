// ── generate-initial-annotations ──────────────────────────────────
//
// Shared fire-and-forget helper: extract the concept-annotation lens for
// a space's CORE objective and persist it (+ an "initial" version + a
// notebook event). Called from two intake moments:
//
//   • brainstorm/start      — at prompt submit, so the annotation
//                             underlines + the "extracted N concepts"
//                             notebook trace appear AS the user lands on
//                             the working objective (the live analysis
//                             record), and so the concepts are available
//                             to ground the clarifying questions.
//   • clarify/complete       — idempotent backstop (skips if start
//                             already produced them).
//
// Previously this lived inline in clarify/complete and ran only AFTER
// the clarifying loop — so the working objective showed no analysis at
// intake and the notebook read "0 events". Moving it to start (with the
// clarify/complete call kept as a backstop) closes that gap.
//
// Soft-fail throughout: a failure logs + swallows so the user-facing
// stage transition / space creation is never blocked. Idempotent:
// returns early if the core goal already carries annotations.

import { generateObjectiveAnnotations } from "./generate-annotations";
import {
  appendVersion,
  makeVersion,
  parseVersions,
} from "./annotation-versions";
import { logDecision } from "./decision-log";

export async function generateInitialAnnotationsForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  /** Audit tag for the notebook event ("intake" | "clarify_complete"). */
  triggeredBy: "intake" | "clarify_complete" = "intake",
): Promise<void> {
  try {
    const { data: coreRows } = await db
      .from("improvement_goals")
      .select(
        "id, title, description, user_id, annotations, annotations_versions",
      )
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const core =
      Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0] : null;
    if (!core || core.user_id !== userId) return;

    // Idempotent: skip if annotations already present (start already ran,
    // or the user already generated them via the annotations endpoint).
    if (Array.isArray(core.annotations) && core.annotations.length > 0) {
      return;
    }

    const objectiveText: string =
      (typeof core.description === "string" && core.description.trim()) ||
      (typeof core.title === "string" && core.title.trim()) ||
      "";
    if (objectiveText.length < 4) return;

    // Sub-objectives don't exist yet at intake — pass empty list. The
    // annotation prompt tolerates this and produces objective-only
    // annotations, which is exactly what we want pre-decompose.
    const annotations = await generateObjectiveAnnotations({
      objective: objectiveText,
      subObjectives: [],
    });

    const history = parseVersions(core.annotations_versions);
    const version = makeVersion(annotations, "initial");
    const nextHistory = appendVersion(history, version);

    const writeRes = await db
      .from("improvement_goals")
      .update({
        annotations,
        annotations_versions: nextHistory,
      })
      .eq("id", core.id);
    if (writeRes.error) {
      console.warn(
        "[initial-annotations] persist failed:",
        writeRes.error.message,
      );
      return;
    }

    // Live analysis record — the notebook renders this as
    // "extracted N concepts from your objective". Fires only on a real
    // generation (the idempotent skip above returns before here).
    void logDecision(db, {
      userId,
      spaceId,
      subObjectiveId: null,
      action: "annotations_generated",
      metadata: {
        scope: "objective",
        phrase_count: Array.isArray(annotations) ? annotations.length : 0,
        triggered_by: triggeredBy,
      },
    });
  } catch (err) {
    console.warn(
      "[initial-annotations] background generation failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
