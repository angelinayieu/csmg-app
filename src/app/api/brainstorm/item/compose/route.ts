// ── POST /api/brainstorm/item/compose ──────────────────────────────
//
// Synthesizes the elected variations of an item into a single
// composed design. Idempotent — returns the cached composed_design
// when source_variation_ids still match the current election set.
//
// Body: { entityId, mode?: "default" | "force" }
//
// Requires ≥2 elected variations. Returns 409 otherwise.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import type {
  ExpandedItemDetail,
  ComposedDesign,
} from "@/lib/objective-canvas/expand-item-detail";
import { composeVariations } from "@/lib/objective-canvas/compose-variations";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  resolveParentObjectiveContext,
  resolveEntityLayer,
  type LayerSlug,
} from "@/lib/objective-canvas/context-helpers";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { computeCompositionStaleness } from "@/lib/objective-canvas/upstream-staleness";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  entityId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, space_id, layer_ontology_id, parent_sub_objective_id, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const entityName: string =
    typeof entity.name === "string" ? entity.name : "this item";
  const parentSubObjectiveId: string | null =
    typeof entity.parent_sub_objective_id === "string"
      ? entity.parent_sub_objective_id
      : null;

  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = entity.expanded_detail as ExpandedItemDetail | null;
  if (!detail || !Array.isArray(detail.variations)) {
    return NextResponse.json(
      { error: "no expanded_detail — open the drawer first to expand" },
      { status: 409 },
    );
  }

  const elected = detail.variations.filter((v) => v.disposition === "elected");
  if (elected.length < 2) {
    return NextResponse.json(
      {
        error: "≥2 elected variations required for composition",
        elected_count: elected.length,
      },
      { status: 409 },
    );
  }

  // Idempotent short-circuit: same elected ids → return cached.
  // On the cache hit, ALSO compute composition_staleness so the
  // drawer can surface a "Refresh from upstream" banner when the
  // composition is older than the variations it was built from
  // (LOCAL) or older than upstream-item changes (UPSTREAM). Same
  // pattern the expand route uses for expanded_detail staleness.
  if (!force && detail.composed_design) {
    const cachedIds = new Set(detail.composed_design.source_variation_ids);
    const electedIds = new Set(elected.map((v) => v.id));
    const sameSet =
      cachedIds.size === electedIds.size &&
      [...cachedIds].every((id) => electedIds.has(id));
    if (sameSet) {
      const composition_staleness = parentSubObjectiveId
        ? await computeCompositionStaleness({
            db,
            downstreamEntityId: entity.id,
            downstreamEntityName: entityName,
            parentSubObjectiveId,
            compositionGeneratedAt: detail.composed_design.generated_at,
            expandedDetailGeneratedAt: detail.generated_at ?? null,
          })
        : null;
      return NextResponse.json({
        composed_design: detail.composed_design,
        cached: true,
        composition_staleness,
      });
    }
  }

  // Phase-1 helpers — was ~50 lines of inline layer + parent + annotations
  // resolution; now two helper calls. Same behavior, same query count.
  const layer: LayerSlug = await resolveEntityLayer(
    db,
    entity.layer_ontology_id,
  );
  const {
    subObjectiveTitle,
    coreObjectiveText,
    annotations,
  } = await resolveParentObjectiveContext(db, entity, space);

  // ── Closed read loop: cross-room findings + dispositions ──
  // Without this, the composition is blind to the Analysis Workbench's
  // structural signals. With it: when the workbench has flagged a
  // contradiction touching this item's elected variations, the
  // composition must address it (resolve via integration_points OR
  // escalate to conflicts_open). When the user has DISMISSED a
  // duplicate_variation involving these variations, the composition
  // must NOT re-raise it — the user already declared the duplicate
  // intentional.
  //
  // Filter mirrors /item/expand's filter, with one critical difference:
  // we KEEP `dismissed` findings (their disposition is the load-bearing
  // signal that "user chose this") — only `resolved` (user closed)
  // gets dropped.
  const crossRoomAnalysis = (space.synthesis_data as Record<
    string,
    unknown
  > | null)?.cross_room_analysis as CrossRoomAnalysisState | undefined;
  type CrossRoomFinding = NonNullable<
    Parameters<typeof composeVariations>[0]["crossRoomFindings"]
  >[number];
  const crossRoomFindings: CrossRoomFinding[] = (() => {
    const allFindings = crossRoomAnalysis?.findings ?? [];
    if (allFindings.length === 0) return [];
    const itemId = entity.id;
    const roomId = parentSubObjectiveId;
    const out: CrossRoomFinding[] = [];
    for (const f of allFindings) {
      if (f.disposition === "resolved") continue;
      if (f.analysis_key === "distill_concepts") continue;
      if (
        f.analysis_key === "orphan_annotations" ||
        f.analysis_key === "recommend_next_move"
      ) {
        continue;
      }

      const itemMatches = f.references.item_ids.includes(itemId);
      const roomMatches = !!roomId && f.references.room_ids.includes(roomId);

      if (f.analysis_key === "pain_coverage") {
        if (!itemMatches) continue;
      } else {
        if (!itemMatches && !roomMatches) continue;
      }

      // Normalize finding disposition to the 3-state enum the generator
      // reads. Default to "open" for anything unexpected.
      const disposition: CrossRoomFinding["disposition"] =
        f.disposition === "acknowledged" || f.disposition === "dismissed"
          ? f.disposition
          : "open";

      const body = (f.body ?? {}) as Record<string, unknown>;
      if (f.analysis_key === "shared_mechanisms") {
        const mech = typeof body.mechanism === "string" ? body.mechanism : "";
        out.push({
          kind: "shared_mechanism",
          title: f.title,
          summary: f.summary,
          hint: mech ? `lever name: "${mech}"` : undefined,
          disposition,
        });
      } else if (f.analysis_key === "annotation_overlap") {
        const phrase = typeof body.phrase === "string" ? body.phrase : "";
        out.push({
          kind: "annotation_overlap",
          title: f.title,
          summary: f.summary,
          hint: phrase ? `lens phrase: "${phrase}"` : undefined,
          disposition,
        });
      } else if (f.analysis_key === "pain_coverage") {
        const kindStr = typeof body.kind === "string" ? body.kind : "";
        if (kindStr === "uncovered") {
          out.push({
            kind: "pain_uncovered",
            title: f.title,
            summary: f.summary,
            hint: "no feature in any room currently addresses this — the composition shouldn't perpetuate the gap",
            disposition,
          });
        } else if (kindStr === "cross_addressed") {
          const count =
            typeof body.addresser_count === "number"
              ? body.addresser_count
              : 0;
          out.push({
            kind: "pain_cross_addressed",
            title: f.title,
            summary: f.summary,
            hint:
              count > 0
                ? `addressed by ${count} feature(s) in OTHER rooms — coordinate or differentiate`
                : undefined,
            disposition,
          });
        }
      } else if (f.analysis_key === "duplicate_variations") {
        const vname =
          typeof body.variation_name === "string" ? body.variation_name : "";
        const electedCount =
          typeof body.elected_room_count === "number"
            ? body.elected_room_count
            : 0;
        // Strongest signal for composition — if one of the elected
        // variations IS the duplicate, mark explicitly.
        const isElectedHere = elected.some(
          (v) => v.name.toLowerCase().trim() === vname.toLowerCase().trim(),
        );
        const baseHint = vname
          ? `duplicate "${vname}"${
              electedCount >= 1
                ? ` (ELECTED in ${electedCount} other room${electedCount === 1 ? "" : "s"})`
                : ""
            }`
          : undefined;
        out.push({
          kind: "duplicate_variation",
          title: f.title,
          summary: f.summary,
          hint: isElectedHere
            ? `${baseHint ?? "duplicate"} — composing this elected variation here too`
            : baseHint,
          disposition,
        });
      } else if (f.analysis_key === "cross_room_contradictions") {
        const pair = Array.isArray(body.pair)
          ? (body.pair as Array<Record<string, unknown>>)
          : [];
        const other = pair.find((p) => p?.item_id !== itemId) ?? pair[1];
        const otherVar =
          other && typeof other.variation_name === "string"
            ? other.variation_name
            : "";
        const otherRoom =
          other && typeof other.room_title === "string"
            ? other.room_title
            : "";
        out.push({
          kind: "contradiction",
          title: f.title,
          summary: f.summary,
          hint:
            otherVar && otherRoom
              ? `contradicts "${otherVar}" in "${otherRoom}"`
              : otherVar
                ? `contradicts "${otherVar}"`
                : undefined,
          disposition,
        });
      }
    }
    return out;
  })();

  // Telemetry-wrapped composition call. artifact_kind 'composed_design'
  // + entity.id lets the feedback endpoint find the most-recent compose
  // log row when the user thumbs-rates the composition banner.
  let composed: ComposedDesign;
  try {
    composed = await instrumentedLLMCall(
      {
        db,
        userId: auth.user.id,
        spaceId: entity.space_id,
        callSite: "compose_variations",
        modelHint: "gpt-4o",
        artifactKind: "composed_design",
        artifactId: entity.id,
        metadata: {
          itemLayer: layer,
          elected_count: elected.length,
          had_lens: annotations.length > 0,
          had_constraints: !!readConstraints(space.synthesis_data),
          cross_room_finding_count: crossRoomFindings.length,
          cross_room_finding_kinds: Array.from(
            new Set(crossRoomFindings.map((f) => f.kind)),
          ),
          // Useful to see whether dismissed findings are commonly
          // entering composition (= user is actively curating signal).
          dismissed_finding_count: crossRoomFindings.filter(
            (f) => f.disposition === "dismissed",
          ).length,
        },
      },
      () =>
        composeVariations({
          itemName: entity.name,
          itemLayer: layer,
          electedVariations: elected,
          subObjectiveTitle,
          coreObjectiveText,
          annotations: annotations.length > 0 ? annotations : undefined,
          constraints: readConstraints(space.synthesis_data),
          crossRoomFindings:
            crossRoomFindings.length > 0 ? crossRoomFindings : undefined,
        }),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "composition failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  const nextDetail: ExpandedItemDetail = {
    ...detail,
    composed_design: composed,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/compose] failed to persist composed_design:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({ composed_design: composed });
}
