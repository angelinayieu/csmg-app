// ── POST /api/brainstorm/item/[entityId]/deliverables ─────────────
//
// Autopilot deliverables fanout — for the top-N highest-scoring
// variations on a feature, generate the four per-variation deep
// artifacts the drawer surfaces as orphan panes when nothing has
// generated them:
//
//   1. mockup_html              (fullscreen)
//   2. export_prompt            (implementation framing)
//   3. description_doc          (PR/FAQ, no critic pass)
//   4. prototype_briefs[]       (one per variation, first open_question)
//
// Sequenced server-side so the four generators never race on the
// expanded_detail read-modify-write — every step reads the latest
// `nextDetail` and the single final UPDATE captures every success.
// A per-generator catch keeps one failure from killing the rest;
// the response carries `successes[]` + `failures[]` for visibility.
//
// Idempotent: each artifact is skipped when already present.
// `topN` is clamped to [1, 10]; default 2. Generators can be
// individually disabled via includeMockup / includeExportPrompt
// / includeDescriptionDoc / includePrototype (all default true).

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import type {
  ExpandedItemDetail,
  ItemVariation,
} from "@/lib/objective-canvas/expand-item-detail";
import { generateVariationMockup } from "@/lib/objective-canvas/generate-mockup";
import { generateVariationExportPrompt } from "@/lib/objective-canvas/generate-export-prompt";
import { generateVariationDescriptionDoc } from "@/lib/objective-canvas/generate-description-doc";
import { generatePrototypeBrief } from "@/lib/objective-canvas/generate-prototype-brief";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import { loadUpstreamContext } from "@/lib/objective-canvas/upstream-context";
import {
  loadRecentLearnings,
  buildLearningsBlock,
} from "@/lib/objective-canvas/load-recent-learnings";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
// 4 generators × topN variations — each generator is a single LLM
// call (~10-30s). Cap at 5 min so a stuck call eventually aborts.
export const maxDuration = 300;

interface Body {
  topN?: number;
  includeMockup?: boolean;
  includeExportPrompt?: boolean;
  includeDescriptionDoc?: boolean;
  includePrototype?: boolean;
}

interface RouteContext {
  params: Promise<{ entityId: string }>;
}

const LAYER_SLUGS = ["pain", "features", "outcomes", "objective"] as const;
type LayerSlug = (typeof LAYER_SLUGS)[number];

interface Outcome {
  subtype: "mockup" | "export_prompt" | "description_doc" | "prototype_brief";
  variation_id: string;
  variation_name: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { entityId } = await ctx.params;
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }

  const { data: body } = await safeJsonParse<Body>(req);
  const topN = Math.max(1, Math.min(10, body?.topN ?? 2));
  const includeMockup = body?.includeMockup !== false;
  const includeExportPrompt = body?.includeExportPrompt !== false;
  const includeDescriptionDoc = body?.includeDescriptionDoc !== false;
  const includePrototype = body?.includePrototype !== false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership ──
  const { data: entity } = await db
    .from("entities")
    .select(
      "id, name, space_id, parent_sub_objective_id, layer_ontology_id, expanded_detail",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, description, input_text, synthesis_data")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (
    !detail ||
    !Array.isArray(detail.variations) ||
    detail.variations.length === 0
  ) {
    return NextResponse.json({
      status: "no_variations",
      message: "entity has no variations — run /expand first",
    });
  }

  // ── Rank top-N variations by effectiveness_score, fallback addresses_pain ──
  const rankKey = (v: ItemVariation): number => {
    if (typeof v.effectiveness_score === "number") return v.effectiveness_score;
    if (typeof v.addresses_pain === "number") return v.addresses_pain;
    return 0;
  };
  const ranked = [...detail.variations]
    .sort((a, b) => rankKey(b) - rankKey(a))
    .slice(0, topN);

  // ── Shared context (loaded once, reused across every generator) ──
  let roomTitle: string | null = null;
  let painText: string | null = null;
  let subObjectiveTitle = "";
  let coreObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "(no objective text)";
  if (entity.parent_sub_objective_id) {
    try {
      const { data: sub } = await db
        .from("improvement_goals")
        .select("title, top_negative_outcome, parent_goal_id")
        .eq("id", entity.parent_sub_objective_id)
        .maybeSingle();
      if (sub) {
        subObjectiveTitle = typeof sub.title === "string" ? sub.title : "";
        roomTitle = subObjectiveTitle || null;
        painText =
          typeof sub.top_negative_outcome === "string"
            ? sub.top_negative_outcome
            : null;
        if (sub.parent_goal_id) {
          const { data: parent } = await db
            .from("improvement_goals")
            .select("title, description")
            .eq("id", sub.parent_goal_id)
            .maybeSingle();
          if (parent?.description) coreObjectiveText = parent.description;
          else if (parent?.title) coreObjectiveText = parent.title;
        }
      }
    } catch {
      // Soft-fail — context lookups are best-effort.
    }
  }

  let layer: LayerSlug = "features";
  if (entity.layer_ontology_id) {
    try {
      const { data: layerRow } = await db
        .from("layer_ontology")
        .select("slug")
        .eq("id", entity.layer_ontology_id)
        .maybeSingle();
      if (layerRow && typeof layerRow.slug === "string") {
        const slug = layerRow.slug as string;
        if ((LAYER_SLUGS as readonly string[]).includes(slug)) {
          layer = slug as LayerSlug;
        }
      }
    } catch {
      // Soft-fail.
    }
  }

  const constraints = readConstraints(space.synthesis_data);
  const mechanismSpec = detail.mechanism_spec ?? null;
  const entityName =
    typeof entity.name === "string" ? entity.name : "(unknown)";

  // Upstream context for prototype briefs — pain layer is the root by
  // graph design, so skip the query there.
  const upstreamContext =
    includePrototype &&
    (layer === "features" ||
      layer === "outcomes" ||
      layer === "objective") &&
    entity.parent_sub_objective_id
      ? await loadUpstreamContext({
          db,
          downstreamEntityId: entity.id,
          parentSubObjectiveId: entity.parent_sub_objective_id,
          limit: 4,
        }).catch(() => undefined)
      : undefined;

  let learningsBlock: string | undefined;
  if (includePrototype) {
    try {
      const learnings = await loadRecentLearnings({
        db,
        userId: auth.user.id,
        spaceId: entity.space_id,
        limit: 8,
      });
      if (learnings.length > 0) {
        learningsBlock = buildLearningsBlock(learnings, { crossSpace: false });
      }
    } catch {
      // Non-fatal — brief generation continues without learnings.
    }
  }

  const composedDesignForCtx = detail.composed_design
    ? {
        description: detail.composed_design.description,
        conflicts_open: detail.composed_design.conflicts_open ?? [],
        conflicts_resolved: detail.composed_design.conflicts_resolved ?? [],
      }
    : null;

  // ── Sequential fanout — accumulate writes into nextDetail, persist once ──
  let nextDetail: ExpandedItemDetail = { ...detail };
  const generatedAt = new Date().toISOString();
  const successes: Outcome[] = [];
  const failures: Array<{ subtype: string; variation_id: string; error: string }> = [];

  const patchVariation = (vid: string, patch: Partial<ItemVariation>) => {
    nextDetail = {
      ...nextDetail,
      variations: nextDetail.variations.map((v) =>
        v.id === vid ? { ...v, ...patch } : v,
      ),
    };
  };

  for (const variation of ranked) {
    // 1. Mockup (fullscreen)
    if (includeMockup) {
      const current = nextDetail.variations.find((v) => v.id === variation.id);
      const alreadyHasMockup =
        current &&
        typeof current.mockup_html === "string" &&
        current.mockup_html.length > 0;
      if (!alreadyHasMockup) {
        try {
          const mockup = await generateVariationMockup({
            variation,
            entityName,
            painText,
            roomTitle,
            constraints,
            format: "fullscreen",
            mechanismSpec,
          });
          patchVariation(variation.id, {
            mockup_html: mockup.html,
            mockup_generated_at: generatedAt,
          });
          successes.push({
            subtype: "mockup",
            variation_id: variation.id,
            variation_name: variation.name,
          });
          void logDecision(db, {
            userId: auth.user.id,
            spaceId: entity.space_id,
            subObjectiveId:
              typeof entity.parent_sub_objective_id === "string"
                ? entity.parent_sub_objective_id
                : null,
            proposalId: entityId,
            action: "deliverable_generated",
            metadata: {
              deliverable_subtype: "mockup",
              entity_id: entityId,
              entity_name: entityName,
              variation_id: variation.id,
              variation_name: variation.name,
              deliverable_size: "fullscreen",
              triggered_by: "autopilot_fanout",
            },
          });
        } catch (err) {
          failures.push({
            subtype: "mockup",
            variation_id: variation.id,
            error: sanitizeErrorMessage(err),
          });
        }
      }
    }

    // 2. Export prompt (implementation framing, no optimize)
    if (includeExportPrompt) {
      const current = nextDetail.variations.find((v) => v.id === variation.id);
      const alreadyHasExport =
        current &&
        typeof current.export_prompt === "string" &&
        current.export_prompt.length > 0;
      if (!alreadyHasExport) {
        try {
          const out = await generateVariationExportPrompt({
            variation,
            entityName,
            objectiveText: coreObjectiveText,
            roomTitle,
            painText,
            constraints,
            framing: "implementation",
            mechanismSpec,
          });
          patchVariation(variation.id, {
            export_prompt: out.prompt,
            export_prompt_generated_at: generatedAt,
          });
          successes.push({
            subtype: "export_prompt",
            variation_id: variation.id,
            variation_name: variation.name,
          });
          void logDecision(db, {
            userId: auth.user.id,
            spaceId: entity.space_id,
            subObjectiveId:
              typeof entity.parent_sub_objective_id === "string"
                ? entity.parent_sub_objective_id
                : null,
            proposalId: entityId,
            action: "deliverable_generated",
            metadata: {
              deliverable_subtype: "export_prompt",
              entity_id: entityId,
              entity_name: entityName,
              variation_id: variation.id,
              variation_name: variation.name,
              framing: "implementation",
              optimized: false,
              triggered_by: "autopilot_fanout",
            },
          });
        } catch (err) {
          failures.push({
            subtype: "export_prompt",
            variation_id: variation.id,
            error: sanitizeErrorMessage(err),
          });
        }
      }
    }

    // 3. Description doc (PR/FAQ, no critic pass)
    if (includeDescriptionDoc) {
      const current = nextDetail.variations.find((v) => v.id === variation.id);
      const alreadyHasDoc =
        current &&
        typeof current.description_doc === "string" &&
        current.description_doc.length > 0;
      if (!alreadyHasDoc) {
        const siblingElections = nextDetail.variations
          .filter(
            (v) => v.id !== variation.id && v.disposition === "elected",
          )
          .slice(0, 4)
          .map((v) => ({ name: v.name, description: v.description }));
        try {
          const out = await generateVariationDescriptionDoc({
            variation,
            entityName,
            objectiveText: coreObjectiveText,
            roomTitle,
            painText,
            constraints,
            siblingElections:
              siblingElections.length > 0 ? siblingElections : undefined,
            mechanismSpec,
            refine: false,
          });
          patchVariation(variation.id, {
            description_doc: out.doc,
            description_doc_generated_at: generatedAt,
          });
          successes.push({
            subtype: "description_doc",
            variation_id: variation.id,
            variation_name: variation.name,
          });
          void logDecision(db, {
            userId: auth.user.id,
            spaceId: entity.space_id,
            subObjectiveId:
              typeof entity.parent_sub_objective_id === "string"
                ? entity.parent_sub_objective_id
                : null,
            proposalId: entityId,
            action: "deliverable_generated",
            metadata: {
              deliverable_subtype: "description_doc",
              entity_id: entityId,
              entity_name: entityName,
              variation_id: variation.id,
              variation_name: variation.name,
              refined: false,
              triggered_by: "autopilot_fanout",
            },
          });
        } catch (err) {
          failures.push({
            subtype: "description_doc",
            variation_id: variation.id,
            error: sanitizeErrorMessage(err),
          });
        }
      }
    }

    // 4. Prototype brief — one per top-N variation, first open_question.
    // Composing multiple open_questions into one brief would collapse the
    // binary-outcome property, so we only fan out the strongest signal.
    if (
      includePrototype &&
      Array.isArray(variation.open_questions) &&
      variation.open_questions.length > 0
    ) {
      const openQuestion = variation.open_questions[0]?.trim() ?? "";
      if (openQuestion.length > 0) {
        const existingBriefs = nextDetail.prototype_briefs ?? [];
        const dup = existingBriefs.find(
          (b) =>
            b.variation_id === variation.id &&
            b.open_question === openQuestion,
        );
        if (!dup) {
          const siblingBriefs = existingBriefs.map((b) => ({
            variation_id: b.variation_id,
            open_question: b.open_question,
            signal_to_watch: b.signal_to_watch,
          }));
          try {
            const brief = await generatePrototypeBrief({
              variation,
              open_question: openQuestion,
              itemName: entityName,
              itemLayer: layer,
              constraints,
              subObjectiveTitle,
              coreObjectiveText,
              composedDesign: composedDesignForCtx,
              siblingBriefs,
              upstreamContext,
              learningsBlock,
              mechanismSpec,
            });
            nextDetail = {
              ...nextDetail,
              prototype_briefs: [
                ...(nextDetail.prototype_briefs ?? []).filter(
                  (b) => b.id !== brief.id,
                ),
                brief,
              ],
            };
            successes.push({
              subtype: "prototype_brief",
              variation_id: variation.id,
              variation_name: variation.name,
            });
            void logDecision(db, {
              userId: auth.user.id,
              spaceId: entity.space_id,
              subObjectiveId:
                typeof entity.parent_sub_objective_id === "string"
                  ? entity.parent_sub_objective_id
                  : null,
              proposalId: entityId,
              action: "deliverable_generated",
              metadata: {
                deliverable_subtype: "prototype_brief",
                entity_id: entityId,
                entity_name: entityName,
                variation_id: variation.id,
                variation_name: variation.name,
                open_question: openQuestion,
                triggered_by: "autopilot_fanout",
              },
            });
          } catch (err) {
            failures.push({
              subtype: "prototype_brief",
              variation_id: variation.id,
              error: sanitizeErrorMessage(err),
            });
          }
        }
      }
    }
  }

  // ── Single persist for every successful artifact ──
  if (successes.length > 0) {
    const writeRes = await db
      .from("entities")
      .update({ expanded_detail: nextDetail })
      .eq("id", entityId);
    if (writeRes.error) {
      return NextResponse.json(
        {
          error: "persist failed",
          detail: writeRes.error.message,
          successes,
          failures,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    status: "ok",
    topN,
    variationsFannedOut: ranked.length,
    generated: successes.length,
    failed: failures.length,
    successes,
    failures,
  });
}
