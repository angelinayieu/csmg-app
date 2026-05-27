// ── POST /api/brainstorm/item/expansion/spawn ─────────────────────
//
// Spawns the children defined by a catalog entry for a given parent
// surface (variation / open_question / conflict_open / etc.).
//
// Body: {
//   entityId,
//   parentNodeId?,           ← set for L4+; null for L3 (attaches to L2)
//   attachPoint,             ← required for L3 anchoring
//   attachRef,               ← required for L3 anchoring
//   parentTitle,             ← what to render in the breadcrumb at this level
//   parentDescription,       ← what the LLM sees as the parent's "what we're deepening"
//   mode?: "default" | "force"
// }
//
// Idempotent on (entityId, parentNodeId|attachKey). Children are
// dropped + re-spawned in force mode. Cached in
// entities.expanded_detail.expansion_tree[].

import { NextRequest, NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  detectDomainSignature,
  type DomainSignature,
} from "@/lib/objective-canvas/domain-signature";
import {
  lookupCatalogEntry,
} from "@/lib/objective-canvas/expansion-catalog";
import {
  generateExpansionNode,
  asExpansionNodes,
} from "@/lib/objective-canvas/generate-expansion-node";
import {
  appendExpansionNodes,
  buildExpansionNodeId,
  deriveLineage,
  getChildren,
  getSubtree,
  normalizeExpansionTree,
  type ExpansionAttachPoint,
  type ExpansionNode,
} from "@/lib/objective-canvas/expansion-tree";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  entityId?: string;
  parentNodeId?: string | null;
  attachPoint?: ExpansionAttachPoint;
  attachRef?: string;
  parentTitle?: string;
  parentDescription?: string;
  mode?: "default" | "force";
}

const ATTACH_POINTS: ReadonlyArray<ExpansionAttachPoint> = [
  "variation",
  "open_question",
  "conflict_open",
  "planning_risk",
  "integration_point",
  "expansion_node",
];

const LAYER_SLUGS = ["pain", "features", "outcomes", "objective"] as const;
type LayerSlug = (typeof LAYER_SLUGS)[number];

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const parentNodeId =
    typeof body?.parentNodeId === "string" && body.parentNodeId.length > 0
      ? body.parentNodeId
      : null;
  const attachPoint =
    typeof body?.attachPoint === "string" &&
    ATTACH_POINTS.includes(body.attachPoint as ExpansionAttachPoint)
      ? (body.attachPoint as ExpansionAttachPoint)
      : null;
  const attachRef = typeof body?.attachRef === "string" ? body.attachRef : "";
  const parentTitle =
    typeof body?.parentTitle === "string" ? body.parentTitle.trim() : "";
  const parentDescription =
    typeof body?.parentDescription === "string"
      ? body.parentDescription.trim()
      : "";
  const force = body?.mode === "force";

  if (!entityId || !attachPoint || !attachRef || !parentTitle) {
    return NextResponse.json(
      {
        error:
          "entityId, attachPoint, attachRef, parentTitle are required",
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership ──
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

  const { data: space } = await db
    .from("spaces")
    .select(
      "id, user_id, description, input_text, synthesis_data",
    )
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !detail.definition) {
    return NextResponse.json(
      { error: "no expanded_detail — open the drawer first to expand" },
      { status: 409 },
    );
  }

  const tree: ExpansionNode[] = normalizeExpansionTree(
    (detail as { expansion_tree?: unknown }).expansion_tree,
  );

  // ── Resolve layer + sub-objective + parent objective + annotations ──
  let layer: LayerSlug = "features";
  if (entity.layer_ontology_id) {
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
  }

  let subObjectiveTitle = "";
  let coreObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  let parentAnnotationsRaw: unknown = null;
  if (entity.parent_sub_objective_id) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title, parent_goal_id")
      .eq("id", entity.parent_sub_objective_id)
      .maybeSingle();
    if (sub) {
      subObjectiveTitle = typeof sub.title === "string" ? sub.title : "";
      if (sub.parent_goal_id) {
        const { data: parent } = await db
          .from("improvement_goals")
          .select("title, description, annotations")
          .eq("id", sub.parent_goal_id)
          .maybeSingle();
        if (parent?.description) coreObjectiveText = parent.description;
        else if (parent?.title) coreObjectiveText = parent.title;
        parentAnnotationsRaw = parent?.annotations ?? null;
      }
    }
  }
  if (!parentAnnotationsRaw) {
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", entity.space_id)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
  const annotations = normalizeAnnotations(parentAnnotationsRaw);

  // ── Detect domain (heuristic) ──
  const clarifying =
    readObjectiveCanvasState(space.synthesis_data).clarifying?.questions ?? [];
  const answersForDomain = clarifying
    .map((q) => {
      const a = readObjectiveCanvasState(space.synthesis_data).clarifying
        ?.answers[q.id];
      return a?.status === "answered" && a.value
        ? { question: q.question, answer: a.value }
        : null;
    })
    .filter((x): x is { question: string; answer: string } => x !== null);

  const domain: DomainSignature = detectDomainSignature({
    objectiveText: coreObjectiveText,
    clarifyingAnswers: answersForDomain,
  });

  // ── Look up catalog entry ──
  // For L4+ spawns, the parent key is the parent node's node_type
  // (so SOFTWARE × software.data_model resolves to L4 detail). For
  // L3, it's the attach_point.
  let catalogParentKey: string = attachPoint;
  if (parentNodeId) {
    const parentNode = tree.find((n) => n.id === parentNodeId);
    if (parentNode) {
      catalogParentKey = parentNode.node_type;
    }
  }
  // Lane-aware lookup: (domain, parent, lane) triple. The lane key
  // ensures pain variations get pain-shaped children rather than
  // feature-shaped ones (the original bug).
  const entry = lookupCatalogEntry(domain, catalogParentKey, layer);
  if (!entry) {
    // Graceful-degradation 409 — distinct from a 500 LLM failure.
    // The UI can offer a generic-fallback "spawn an outline" path
    // instead of showing the user a red error.
    return NextResponse.json(
      {
        error: "no_catalog_entry",
        detail: `No deepen path defined for ${layer}/${catalogParentKey} in ${domain}.`,
        domain,
        lane: layer,
        parent_key: catalogParentKey,
        fallback_available: true,
      },
      { status: 409 },
    );
  }

  // ── Idempotency: if children already exist for this exact parent
  //    slot, short-circuit unless force. ──
  const existingChildren = getChildren(tree, {
    node_id: parentNodeId,
    attach_point: parentNodeId ? undefined : attachPoint,
    attach_ref: parentNodeId ? undefined : attachRef,
  });
  if (!force && existingChildren.length > 0) {
    return NextResponse.json({
      tree,
      spawned: existingChildren.map((n) => n.id),
      cached: true,
    });
  }

  // ── Generate ──
  //
  // Two-tier retry: llmJSON already retries on transient HTTP errors
  // (429/5xx, 4 attempts). What it can't fix is schema/parse rejections
  // or token-cap truncations — those re-throw immediately. For those
  // we retry ONCE here with a reduced-context payload: no annotations,
  // empty ancestor lineage, truncated parent + core text. Cuts the
  // prompt by ~40-60% which usually lets the strict-JSON pass.
  //
  // If both attempts throw, we surface the second error's detail so
  // the UI can show "expansion failed — {actual cause}".
  let generated: Awaited<ReturnType<typeof generateExpansionNode>>;
  // Build ancestor lineage so the LLM doesn't redundantly cover
  // ground from upstream nodes.
  const lineageTitles = parentNodeId
    ? (() => {
        const parent = tree.find((n) => n.id === parentNodeId);
        return parent ? [...parent.lineage_titles, parent.title] : [];
      })()
    : [];
  const constraints = readConstraints(space.synthesis_data);

  // ── Closed read loop: existing tree summary + distill themes ──
  // ancestorLineage already tells the LLM "you came from here". This
  // adds "you have siblings + cousins on this same item that the
  // user kept — don't redundantly cover their ground". Excludes the
  // direct ancestor chain (already represented in ancestorLineage) so
  // we don't double-render the same nodes.
  const ancestorIdsToExclude = new Set<string>();
  if (parentNodeId) {
    ancestorIdsToExclude.add(parentNodeId);
    // Walk ancestor chain by parent_node_id pointers; stop at L3 root.
    let cursor: ExpansionNode | undefined = tree.find(
      (n) => n.id === parentNodeId,
    );
    while (cursor?.parent_node_id) {
      ancestorIdsToExclude.add(cursor.parent_node_id);
      cursor = tree.find((n) => n.id === cursor!.parent_node_id);
    }
  }
  const existingTreeSummary = tree
    .filter(
      (n) =>
        n.disposition === "kept" && !ancestorIdsToExclude.has(n.id),
    )
    .map((n) => ({
      title: n.title,
      depth: n.depth,
      attach_point: n.attach_point,
    }));

  // Distilled themes — same shape as /item/expand. Reads the cached
  // cross_room_analysis findings and filters to distill_concepts.
  // Soft-fail to undefined when the analysis hasn't been run yet.
  const crossRoomAnalysis = (space.synthesis_data as Record<
    string,
    unknown
  > | null)?.cross_room_analysis as CrossRoomAnalysisState | undefined;
  const distillFindings =
    crossRoomAnalysis?.findings?.filter(
      (f) => f.analysis_key === "distill_concepts",
    ) ?? [];
  const distillThemes =
    distillFindings.length > 0
      ? distillFindings.map((f) => {
          const body = f.body as Record<string, unknown>;
          return {
            name:
              typeof body?.name === "string"
                ? body.name
                : f.title,
            description:
              typeof body?.description === "string"
                ? body.description
                : f.summary,
          };
        })
      : undefined;

  try {
    generated = await generateExpansionNode({
      catalogEntry: entry,
      parent: {
        title: parentTitle,
        description: parentDescription,
        itemLayer: layer,
        itemName: entity.name,
        subObjectiveTitle,
        coreObjectiveText,
        ancestorLineage: lineageTitles,
      },
      constraints,
      annotations: annotations.length > 0 ? annotations : undefined,
      existingTreeSummary:
        existingTreeSummary.length > 0 ? existingTreeSummary : undefined,
      distillThemes,
    });
  } catch (firstErr) {
    const firstDetail = sanitizeErrorMessage(firstErr);
    console.warn(
      "[item/expansion/spawn] first attempt failed — retrying with reduced context:",
      firstDetail,
    );
    try {
      // Reduced-context retry. Drop the bulk that's most likely to
      // bloat the prompt past the model's effective limit:
      //  - no annotations (8-item lens × ~80 chars each = ~640 chars)
      //  - empty lineage (can grow with depth)
      //  - first 80 chars of parent description (lose tradeoff suffix)
      //  - first 200 chars of core objective text
      const shortDesc =
        parentDescription.length > 80
          ? parentDescription.slice(0, 77).trimEnd() + "…"
          : parentDescription;
      const shortCore =
        coreObjectiveText.length > 200
          ? coreObjectiveText.slice(0, 197).trimEnd() + "…"
          : coreObjectiveText;
      generated = await generateExpansionNode({
        catalogEntry: entry,
        parent: {
          title: parentTitle,
          description: shortDesc,
          itemLayer: layer,
          itemName: entity.name,
          subObjectiveTitle,
          coreObjectiveText: shortCore,
          ancestorLineage: [],
        },
        constraints,
        annotations: undefined,
        // Drop the closed-loop signals on the reduced-context retry —
        // same rationale as dropping lineage + annotations: cut prompt
        // size to give strict-JSON the best chance to land.
        existingTreeSummary: undefined,
        distillThemes: undefined,
      });
    } catch (secondErr) {
      const secondDetail = sanitizeErrorMessage(secondErr);
      console.warn(
        "[item/expansion/spawn] reduced-context retry also failed:",
        secondDetail,
      );
      return NextResponse.json(
        {
          error: "expansion failed",
          // Prefer the second error (with-reduced-context) since that's
          // the most informative — if the model still rejected after
          // we cut the prompt in half, the cause is structural, not
          // bloat. The first error is preserved for log diagnostics.
          detail: `${secondDetail} (retry-with-reduced-context also failed; first attempt: ${firstDetail.slice(0, 160)})`,
        },
        { status: 500 },
      );
    }
  }

  // ── Build the ExpansionNode rows + persist ──
  const { depth, lineage_titles } = deriveLineage(
    parentNodeId,
    tree,
    parentTitle,
  );
  const newNodes: ExpansionNode[] = asExpansionNodes(generated, (c, ordinal) => ({
    id: buildExpansionNodeId(parentNodeId, c.node_type, ordinal),
    parent_node_id: parentNodeId,
    depth,
    lineage_titles,
    attach_point: parentNodeId ? "expansion_node" : attachPoint,
    attach_ref: parentNodeId ? parentNodeId : attachRef,
  }));

  // Force mode: drop the existing subtree below this parent first so
  // re-spawn doesn't leave orphaned grandchildren under stale ids.
  let workingTree = tree;
  if (force && existingChildren.length > 0) {
    const dropIds = new Set<string>();
    for (const c of existingChildren) {
      dropIds.add(c.id);
      for (const d of getSubtree(tree, c.id)) dropIds.add(d.id);
    }
    workingTree = tree.filter((n) => !dropIds.has(n.id));
  }
  const nextTree = appendExpansionNodes(workingTree, newNodes);

  // Persist into expanded_detail.expansion_tree[] (same atomic-row
  // jsonb update pattern as prototype_briefs[]).
  const nextDetail = {
    ...(detail as unknown as Record<string, unknown>),
    expansion_tree: nextTree,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/expansion/spawn] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  // Phase 10a — log expansion_spawned for the Lab Notebook.
  // Use the first new node as the canonical "what was spawned" for
  // the headline; metadata carries the full set so the chat agent
  // can later reason about clusters. Only emits if persist succeeded
  // (writeRes.error means the tree isn't on disk).
  if (!writeRes.error && newNodes.length > 0) {
    const headline = newNodes[0];
    void logDecision(db, {
      userId: auth.user.id,
      spaceId: entity.space_id,
      subObjectiveId:
        typeof entity.parent_sub_objective_id === "string"
          ? entity.parent_sub_objective_id
          : null,
      action: "expansion_spawned",
      metadata: {
        entity_type: "expansion_node",
        entity_id: entityId,
        entity_name: typeof entity.name === "string" ? entity.name : null,
        expansion_node_title: headline.title,
        attach_point: headline.attach_point,
        spawned_ids: newNodes.map((n) => n.id),
        spawned_count: newNodes.length,
        depth,
        domain,
      },
    });
  }

  return NextResponse.json({
    tree: nextTree,
    spawned: newNodes.map((n) => n.id),
    domain,
  });
}
