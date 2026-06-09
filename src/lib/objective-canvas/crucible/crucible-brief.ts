// ── Composed objective brief (assembler) ─────────────────────────────
//
// Reads the blocks the Crucible + exploration slice persist and composes them
// into typed slots: intent + first principles + optimization points (leverage)
// + constraints + open decisions (swappable) + variables. Pure read — no LLM,
// no writes. SERVER-ONLY. Soft-fails each slot independently so a partial graph
// still yields a partial brief.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import { listLibraryObjects } from "@/lib/objective-canvas/library-objects";
import type {
  ExplorationBlock,
  ObjectiveBrief,
} from "./crucible-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

function snap(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function assembleBrief(
  db: AnyDb,
  spaceId: string,
): Promise<ObjectiveBrief> {
  // Intent + title.
  let objective = "";
  let title = "";
  try {
    const ctx = await buildSpaceContext(db, spaceId);
    objective = (ctx.objective ?? "").trim();
  } catch {
    /* soft */
  }
  try {
    const { data } = await db
      .from("spaces")
      .select("name, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const sd = snap(data?.synthesis_data);
    const oc = snap(sd.objective_canvas);
    const ps = snap(oc.prompt_sharpening);
    title = str(ps.distilled_title).trim() || str(data?.name).trim() || "Objective";
  } catch {
    title = "Objective";
  }

  // Block-backed slots. Each list call is independent + soft (listLibraryObjects
  // already returns [] on miss, sorted by rank_score desc).
  const [levRows, conRows, fpRows, varRows, decRows, soRows, featRows] =
    await Promise.all([
      listLibraryObjects(db, spaceId, { objectType: "leverage_point" }),
      listLibraryObjects(db, spaceId, { objectType: "constraint" }),
      listLibraryObjects(db, spaceId, { objectType: "first_principle" }),
      listLibraryObjects(db, spaceId, { objectType: "variable" }),
      listLibraryObjects(db, spaceId, { objectType: "decision" }),
      listLibraryObjects(db, spaceId, { objectType: "sub_objective" }),
      listLibraryObjects(db, spaceId, { objectType: "feature" }),
    ]);

  const optimizationPoints = levRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      label: r.title,
      score: typeof r.rank_score === "number" ? r.rank_score : num(cs.score),
      meadowsLevel: str(cs.meadows_level),
      rationale: r.summary ?? str(cs.rationale),
    };
  });

  const constraints = conRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      label: r.title,
      kind: cs.kind === "soft" ? ("soft" as const) : ("hard" as const),
      why: (r.summary ?? str(cs.why)) || undefined,
    };
  });

  const firstPrinciples = fpRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      label: r.title,
      statement: r.summary ?? str(cs.statement),
      score: typeof r.rank_score === "number" ? r.rank_score : num(cs.score),
    };
  });

  const variables = varRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      label: r.title,
      note: (r.summary ?? str(cs.note)) || undefined,
    };
  });

  // Phase 4 — the actionable roadmap slots.
  const subObjectives = soRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      title: r.title,
      rationale: (r.summary ?? str(cs.rationale)) || undefined,
    };
  });

  const features = featRows.map((r) => {
    const cs = snap(r.content_snapshot);
    return {
      objectId: r.id,
      title: r.title,
      description: (r.summary ?? str(cs.description)) || undefined,
      score: typeof r.rank_score === "number" ? r.rank_score : num(cs.confidence) * 100,
    };
  });

  const decisions = decRows
    .map((r) => {
      const block = r.content_snapshot as ExplorationBlock | undefined;
      if (!block || !Array.isArray(block.variations) || block.variations.length === 0) {
        return null;
      }
      return {
        objectId: r.id,
        headline: block.headline || r.title,
        principle: block.principle || "",
        variations: block.variations,
        activeIndex:
          typeof block.activeIndex === "number" ? block.activeIndex : 0,
        decisions: Array.isArray(block.decisions) ? block.decisions : [],
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const hasBlocks =
    optimizationPoints.length > 0 ||
    constraints.length > 0 ||
    firstPrinciples.length > 0 ||
    decisions.length > 0 ||
    variables.length > 0 ||
    subObjectives.length > 0 ||
    features.length > 0;

  return {
    objective,
    title,
    firstPrinciples,
    optimizationPoints,
    subObjectives,
    features,
    constraints,
    decisions,
    variables,
    hasBlocks,
  };
}
