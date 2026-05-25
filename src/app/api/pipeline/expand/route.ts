import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { embedTexts, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_VERSION } from "@/lib/embeddings";
import { buildExpansionPrompt } from "@/lib/prompts/expansion";
import type { SubComponent, InternalPathway, InternalDynamic } from "@/types/expansion";
import type { Entity, Edge } from "@/types";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";
import { scoreDecompositionQuality } from "@/lib/decomposition-quality";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // 1. Auth
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 2. Parse body
  const { entity_id, space_id, parent_expansion_id, depth_level = 1, context_hint } = await req.json();
  if (!entity_id || !space_id) return NextResponse.json({ error: "entity_id and space_id required" }, { status: 400 });
  if (depth_level < 1 || depth_level > 5) return NextResponse.json({ error: "depth_level must be 1-5" }, { status: 400 });

  // Audit-trail timestamps
  const expandRunId = makeRunId();
  const expandStartedAt = new Date().toISOString();

  // 3. Cache check — return existing expansion if not stale
  const { data: existing } = await db
    .from("expansions")
    .select("*")
    .eq("entity_id", entity_id)
    .eq("stale", false)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ expansion: existing, cached: true, credit_cost: 0 });
  }

  // 4. Depth budget check — count existing expansions for this space
  const { count: expansionCount } = await db
    .from("expansions")
    .select("id", { count: "exact", head: true })
    .eq("space_id", space_id);

  const MAX_EXPANSIONS = 150;
  if ((expansionCount ?? 0) >= MAX_EXPANSIONS) {
    return NextResponse.json({ error: `Expansion limit reached (${MAX_EXPANSIONS} per space)` }, { status: 403 });
  }

  // 5. Fetch entity
  const { data: entity } = await db
    .from("entities")
    .select("*")
    .eq("id", entity_id)
    .single();

  if (!entity) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  // 6. Fetch space (for context)
  // Phase D: also pull synthesis_data so we can derive the
  // userContextHint from typed clarifier assertions when the caller
  // didn't supply an explicit context_hint.
  const { data: space } = await db
    .from("spaces")
    .select("id, name, description, input_text, user_id, synthesis_data")
    .eq("id", space_id)
    .eq("user_id", user.id)
    .single();

  if (!space) return NextResponse.json({ error: "Space not found or unauthorized" }, { status: 404 });

  // 7. Fetch connected edges + entity names
  const { data: edges } = await db
    .from("edges")
    .select("*")
    .eq("space_id", space_id)
    .or(`source_entity_id.eq.${entity_id},target_entity_id.eq.${entity_id}`)
    .limit(30);

  const connectedEntityIds = new Set<string>();
  for (const edge of (edges ?? [])) {
    if (edge.source_entity_id !== entity_id) connectedEntityIds.add(edge.source_entity_id);
    if (edge.target_entity_id !== entity_id) connectedEntityIds.add(edge.target_entity_id);
  }

  const { data: connectedEntities } = await db
    .from("entities")
    .select("id, name")
    .in("id", Array.from(connectedEntityIds));

  const connectedEntityNames = new Map<string, string>();
  for (const e of (connectedEntities ?? [])) {
    connectedEntityNames.set(e.id, e.name);
  }

  // 8. If depth > 1, fetch parent expansion context
  let parentContext = undefined;
  if (parent_expansion_id) {
    const { data: parentExpansion } = await db
      .from("expansions")
      .select("*")
      .eq("id", parent_expansion_id)
      .single();

    if (parentExpansion) {
      const parentEntity = await db
        .from("entities")
        .select("name")
        .eq("id", parentExpansion.entity_id)
        .single();

      const parentSCs = (parentExpansion.sub_components as SubComponent[]) ?? [];
      // Find which sub-component we're drilling into by matching entity name
      const drillingInto = parentSCs.find((sc) => sc.name.toLowerCase() === entity.name.toLowerCase()) ?? parentSCs[0];

      if (drillingInto) {
        parentContext = {
          parentEntityName: parentEntity?.data?.name ?? "Parent",
          parentSubComponents: parentSCs,
          drillingIntoComponent: drillingInto,
        };
      }
    }
  }

  // 8a. Resolve userContextHint (Phase D — typed-clarifier steering)
  // Priority:
  //   (a) explicit context_hint on the request body — caller knows best
  //   (b) entity.manifold.expand_hint — set by promote-seed for
  //       user-asserted seed entities, so subsequent expand calls
  //       inherit the slot value automatically
  //   (c) aggregated synthesis_data.user_assertions slot values for
  //       the space — broad-strokes steering when the entity isn't
  //       itself user-asserted but the user set assertions at intake
  // Soft-fail: any parse error degrades to no hint (current behavior).
  let userContextHint: string | undefined =
    typeof context_hint === "string" && context_hint.trim().length > 0
      ? context_hint.trim()
      : undefined;
  if (!userContextHint) {
    try {
      const m = (entity as { manifold?: Record<string, unknown> }).manifold;
      const hint = m && typeof m.expand_hint === "string" ? m.expand_hint.trim() : "";
      if (hint) userContextHint = hint;
    } catch {
      /* non-fatal */
    }
  }
  if (!userContextHint) {
    try {
      const sd = (space as { synthesis_data?: unknown }).synthesis_data;
      const root =
        sd && typeof sd === "object"
          ? (sd as Record<string, unknown>)
          : typeof sd === "string"
            ? (JSON.parse(sd) as Record<string, unknown>)
            : {};
      const ua = root.user_assertions as
        | Record<string, Array<{ value?: unknown }>>
        | undefined;
      if (ua && typeof ua === "object") {
        const segments: string[] = [];
        for (const [slot, entries] of Object.entries(ua)) {
          if (!Array.isArray(entries) || entries.length === 0) continue;
          const values = entries
            .map((e) => (typeof e?.value === "string" ? e.value.trim() : ""))
            .filter((s) => s.length > 0);
          if (values.length === 0) continue;
          // Render slot name in a readable form (e.g. "target metric").
          const label = slot.replace(/_/g, " ");
          segments.push(`${label}: ${values.join("; ")}`);
        }
        if (segments.length > 0) {
          userContextHint = segments.join(" | ");
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  // 9. Build prompt
  const { systemPrompt, userPrompt } = buildExpansionPrompt({
    entity: entity as Entity,
    connectedEdges: (edges ?? []) as Edge[],
    connectedEntityNames,
    spaceName: space.name ?? "",
    spaceDescription: space.description ?? "",
    userInputText: (space as Record<string, unknown>).input_text as string | undefined,
    depthLevel: depth_level,
    parentContext,
    userContextHint,
  });

  // 10. LLM call
  try {
    const result = await llmJSON({
      system: systemPrompt,
      user: userPrompt,
      model: "gpt-4o-mini",
      temperature: 0.4,
    });

    // 11. Validate and sanitize
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llmResult = result as any;
    let subComponents = validateSubComponents(llmResult.sub_components ?? []);

    // Optional semantic embeddings for sub-components (non-fatal on failure)
    try {
      const embeddingInputs = subComponents.map((sc) =>
        `${sc.name}\n${sc.description}\nType: ${sc.component_type}`
      );
      const vectors = await embedTexts(embeddingInputs);
      if (vectors.length === subComponents.length) {
        subComponents = subComponents.map((sc, idx) => ({
          ...sc,
          embedding: vectors[idx],
          embedding_model: DEFAULT_EMBEDDING_MODEL,
          embedding_version: DEFAULT_EMBEDDING_VERSION,
        }));
      }
    } catch (embedErr) {
      console.warn("[expand] sub-component embedding generation failed (non-critical):", embedErr);
    }

    const internalPathways = validatePathways(llmResult.internal_pathways ?? [], subComponents);
    const internalDynamics = validateDynamics(llmResult.internal_dynamics ?? [], subComponents);
    const miniAxioms = validateMiniAxioms(llmResult.mini_axioms ?? [], subComponents, entity_id);

    if (subComponents.length < 2) {
      return NextResponse.json({
        error: "Expansion produced insufficient structure — entity may not have meaningful internal complexity",
      }, { status: 422 });
    }

    // 12. Upsert expansion (delete stale + insert fresh)
    await db.from("expansions").delete().eq("entity_id", entity_id);

    const { data: expansion, error: insertErr } = await db
      .from("expansions")
      .insert({
        space_id,
        entity_id,
        parent_expansion_id: parent_expansion_id ?? null,
        depth_level,
        summary: llmResult.summary ?? `Internal structure of ${entity.name}`,
        sub_components: subComponents,
        internal_pathways: internalPathways,
        internal_dynamics: internalDynamics,
        llm_model: "gpt-4o-mini",
        token_cost: 0, // TODO: track actual tokens
      })
      .select()
      .single();

    if (insertErr || !expansion) {
      console.error("Expansion insert failed:", insertErr);
      return NextResponse.json({ error: "Failed to store expansion. Please try again." }, { status: 500 });
    }

    // 13. Mark entity as expanded
    await db.from("entities").update({ is_expanded: true, expansion_id: expansion.id }).eq("id", entity_id);

    // 14. Auto-materialize expansion into graph entities + edges
    let materialization = null;
    try {
      const { computeExpansionMaterializations, buildExpansionEntityRecords, buildExpansionEdgeRecords } = await import("@/lib/pipeline/expansion-materializer");
      const { resilientInsert: resInsert } = await import("@/lib/sanitize");
      const { refreshSpaceCounts: refreshCounts } = await import("@/lib/api-helpers");

      const [existEntRes, existEdgeRes] = await Promise.all([
        db.from("entities").select("*").eq("space_id", space_id),
        db.from("edges").select("*").eq("space_id", space_id),
      ]);
      const existingEntities = (existEntRes.data ?? []) as Entity[];
      const existingEdges = (existEdgeRes.data ?? []) as Edge[];

      const expansionRow = {
        id: expansion.id,
        entity_id: expansion.entity_id,
        space_id,
        depth_level,
        sub_components: subComponents,
        internal_pathways: internalPathways,
        internal_dynamics: internalDynamics,
      };

      const matResult = computeExpansionMaterializations(
        [expansionRow],
        [entity as Entity],
        existingEntities,
        existingEdges,
      );

      if (matResult.entities.length > 0) {
        const entityRecords = buildExpansionEntityRecords(space_id, matResult.entities);
        const { inserted: entIns, data: entData } = await resInsert(db, "entities", entityRecords, "id, entity_id");

        // Build UUID map
        const idMap = new Map<string, string>();
        for (const e of existingEntities) idMap.set(e.entity_id, e.id);
        for (const row of entData) {
          if (row.entity_id && row.id) idMap.set(row.entity_id, row.id);
        }

        // Insert all edges
        const allMatEdges = [...matResult.parent_component_edges, ...matResult.edges];
        const edgeRecords = buildExpansionEdgeRecords(space_id, allMatEdges, idMap);
        let edgIns = 0;
        if (edgeRecords.length > 0) {
          const { inserted } = await resInsert(db, "edges", edgeRecords, "id");
          edgIns = inserted;
        }

        // ── Cross-entity bridges (closes the "breakdown shows pathways but
        // KG doesn't" gap). Fresh SCs are compared against all existing SCs
        // from OTHER parents; similar pairs become real graph edges at the
        // "bridge" knowledge_layer. We re-fetch entities here so newly
        // inserted rows have stable UUIDs in the idMap.
        let bridgeIns = 0;
        try {
          const { computeCrossEntityBridges, extractScLikesFromEntities } = await import(
            "@/lib/pipeline/expansion-materializer"
          );
          const { data: afterInsertEntities } = await db
            .from("entities")
            .select("*")
            .eq("space_id", space_id);
          const fullEntityList = (afterInsertEntities ?? []) as Entity[];
          // Keep idMap in sync with any rows resInsert left unmapped.
          for (const e of fullEntityList) idMap.set(e.entity_id, e.id);

          const allScs = extractScLikesFromEntities(fullEntityList);
          const newScIds = new Set(matResult.entities.map((m) => m.entity_id));
          const newScs = allScs.filter((s) => newScIds.has(s.entity_id));
          const existingScs = allScs.filter((s) => !newScIds.has(s.entity_id));

          // Re-fetch edges too — they now include the ones we just inserted
          // above, which lets the dedupe check skip pairs with a pre-existing
          // has_component/internal_pathway/inherited_connection edge.
          const { data: afterInsertEdges } = await db
            .from("edges")
            .select("*")
            .eq("space_id", space_id);
          const currentEdges = (afterInsertEdges ?? []) as Edge[];

          const bridges = computeCrossEntityBridges(newScs, existingScs, currentEdges);
          if (bridges.length > 0) {
            const bridgeRecords = buildExpansionEdgeRecords(space_id, bridges, idMap);
            if (bridgeRecords.length > 0) {
              const { inserted } = await resInsert(db, "edges", bridgeRecords, "id");
              bridgeIns = inserted;
              console.log(`[expand] Materialized ${inserted} cross-entity bridge edges`);
            }
          }
        } catch (bridgeErr) {
          console.warn("[expand] Cross-entity bridge materialization failed (non-critical):", bridgeErr);
        }

        // Mark materialized
        await db.from("expansions")
          .update({ materialized_at: new Date().toISOString() })
          .eq("id", expansion.id)
          .then(() => {}, () => {});

        await refreshCounts(db, [space_id]);

        // Phase 1 Step 6 — newly materialized sub-components may open
        // indirect paths between previously-checked pairs. Flag them
        // for prospector revisit. Uses entData UUIDs from the insert
        // above + the parent entity (its meaning has shifted).
        try {
          const newEntityUuids: string[] = [entity_id];
          for (const row of entData) {
            if (row.id) newEntityUuids.push(row.id);
          }
          const invalidation = await invalidateCoverageForNewEntities(db, {
            spaceId: space_id,
            newEntityIds: newEntityUuids,
            reason: "neighbor_added",
          });
          if (invalidation.flagged > 0) {
            console.log(
              `[expand] invalidated ${invalidation.flagged} pair checks for ${invalidation.neighborCount} neighbors`,
            );
          }
        } catch (invErr) {
          console.warn("[expand] coverage invalidation failed (non-fatal):", invErr);
        }

        materialization = {
          entities_created: entIns,
          edges_created: edgIns + bridgeIns,
          bridges_created: bridgeIns,
        };
      }
    } catch (matErr) {
      console.warn("Auto-materialization failed (non-critical):", matErr);
    }

    // ── Canonical-pipeline observability: fingerprint + quality + audit trail ──
    // The whiteboard now writes the same telemetry format as /decompose and
    // /synthesize, so the synthesis-view provenance chip and the lazy-guard
    // infrastructure correctly see that the graph changed.
    //
    // We also recompute probability-space intersections inline here so
    // freshly materialized sub-components + cross-entity bridges become
    // visible insights the next time the user looks at the panel —
    // without waiting for a full strategy refresh.
    let intersectionsRecomputed = 0;
    try {
      const [fullEntRes, fullEdgeRes, allExpRes, spaceRes] = await Promise.all([
        db.from("entities").select("*").eq("space_id", space_id),
        db.from("edges").select("*").eq("space_id", space_id),
        db
          .from("expansions")
          .select("entity_id, sub_components, internal_pathways, internal_dynamics")
          .eq("space_id", space_id),
        db.from("spaces").select("synthesis_data").eq("id", space_id).single(),
      ]);
      const fullEntities = (fullEntRes.data ?? []) as Entity[];
      const fullEdges = (fullEdgeRes.data ?? []) as Edge[];

      // Slim shapes for the fingerprint + quality helpers. Helpers expect
      // optional string fields (undefined, not null), so we coerce here.
      const updatedEntities = fullEntities.map((e) => ({
        entity_id: e.entity_id,
        name: e.name,
        importance: (e.importance ?? undefined) as string | undefined,
        description: (e.description ?? undefined) as string | undefined,
        source_tag: (e.source_tag ?? undefined) as string | undefined,
        manifold: (e as unknown as { manifold?: unknown }).manifold,
      }));
      const updatedEdges = fullEdges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        relationship_type: (e.relationship_type ?? undefined) as string | undefined,
        topology: ((e as unknown as { topology?: string | null }).topology ?? null) as string | null,
        dynamics: ((e as unknown as { dynamics?: string | null }).dynamics ?? null) as string | null,
        confidence: (e.confidence ?? undefined) as number | undefined,
      }));
      const existingData = ((spaceRes?.data as { synthesis_data?: Record<string, unknown> } | null)?.synthesis_data) ?? {};

      const newFingerprint = computeDecompFingerprint(updatedEntities, updatedEdges);
      const quality = scoreDecompositionQuality(updatedEntities, updatedEdges, "quick");

      // Merge new mini-axioms into synthesis_data.expansion_axioms, keyed by
      // parent entity. Older entries for the same parent are replaced (this is a
      // fresh expansion). Cap total at 50 to prevent JSONB bloat on large graphs.
      const priorExpansionAxioms = Array.isArray(existingData.expansion_axioms)
        ? (existingData.expansion_axioms as MiniAxiom[])
        : [];
      const filteredPrior = priorExpansionAxioms.filter((a) => a.parent_entity_id !== entity_id);
      const mergedExpansionAxioms = [...miniAxioms, ...filteredPrior].slice(0, 50);

      // Recompute probability spaces + intersections (both pure, fast).
      // Non-critical: if this fails, we still write the fingerprint/audit.
      let spaceIntersections: unknown[] = [];
      let computedIntersections = false;
      try {
        const { buildProbabilitySpacesForGraph } = await import(
          "@/lib/pipeline/probability-space-engine"
        );
        const { detectIntersections } = await import(
          "@/lib/pipeline/intersection-detector"
        );
        const expansionsMap = new Map<
          string,
          { sub_components: unknown; internal_pathways: unknown; internal_dynamics: unknown }
        >();
        for (const row of (allExpRes.data ?? []) as Array<{
          entity_id: string;
          sub_components: unknown;
          internal_pathways: unknown;
          internal_dynamics: unknown;
        }>) {
          expansionsMap.set(row.entity_id, {
            sub_components: row.sub_components,
            internal_pathways: row.internal_pathways,
            internal_dynamics: row.internal_dynamics,
          });
        }
        const spaces = buildProbabilitySpacesForGraph(fullEdges, fullEntities, expansionsMap);
        const intersections = detectIntersections(spaces, fullEntities, fullEdges, 20);
        spaceIntersections = intersections;
        intersectionsRecomputed = intersections.length;
        computedIntersections = true;
        console.log(
          `[expand] Recomputed ${spaces.length} probability spaces, ${intersections.length} intersections`,
        );
      } catch (intersectErr) {
        console.warn(
          "[expand] Intersection recompute failed (non-critical):",
          intersectErr,
        );
      }

      const expandRun: AnalysisRun = {
        run_id: expandRunId,
        pipeline: "expand",
        started_at: expandStartedAt,
        completed_at: new Date().toISOString(),
        status: "completed",
        depth: "quick",
        stages_run: [
          "llm_expand",
          ...(subComponents.some((sc) => sc.embedding) ? ["embeddings"] : []),
          ...(miniAxioms.length > 0 ? ["mini_axiom_generation"] : []),
          ...(materialization ? ["materialization", "quality_rescore", "fingerprint_update"] : ["quality_rescore", "fingerprint_update"]),
          ...(computedIntersections ? ["intersection_recompute"] : []),
        ],
        stages_skipped: [],
        cache_hits: [],
        fingerprint: newFingerprint,
        quality_score: Math.round(quality.overall * 100),
        note: `Expanded ${entity.name}: ${subComponents.length} sub-components, ${internalPathways.length} pathways` + (materialization ? `, ${materialization.entities_created} entities + ${materialization.edges_created} edges materialized` : "") + (materialization?.bridges_created ? ` (incl. ${materialization.bridges_created} bridges)` : "") + (computedIntersections ? `, ${intersectionsRecomputed} intersections` : "") + (miniAxioms.length > 0 ? ` · ${miniAxioms.length} mini-axiom${miniAxioms.length === 1 ? "" : "s"} (${miniAxioms.filter(a => a.visibility === "HIDDEN").length} hidden)` : ""),
      };
      const priorRuns = (existingData.analysis_runs as AnalysisRun[] | undefined) ?? [];
      await db.from("spaces").update({
        synthesis_data: {
          ...existingData,
          analysis_runs: appendRun(priorRuns, expandRun),
          decomp_fingerprint: newFingerprint,
          ...(mergedExpansionAxioms.length > 0 ? { expansion_axioms: mergedExpansionAxioms } : {}),
          ...(computedIntersections
            ? {
                space_intersections: spaceIntersections,
                space_intersections_computed_at: new Date().toISOString(),
              }
            : {}),
        },
      }).eq("id", space_id);
      console.log(`[expand] Audit: ${entity.name} expanded, fingerprint=${newFingerprint}, quality=${Math.round(quality.overall * 100)}, mini-axioms=${miniAxioms.length}`);
    } catch (auditErr) {
      console.warn("[expand] Audit-trail update failed (non-critical):", auditErr);
    }

    return NextResponse.json({
      expansion,
      cached: false,
      credit_cost: 1,
      ...(materialization ? { materialization } : {}),
      ...(intersectionsRecomputed > 0 ? { intersections_recomputed: intersectionsRecomputed } : {}),
    });

  } catch (llmErr: unknown) {
    const raw = llmErr instanceof Error ? llmErr.message : "Unknown LLM error";
    console.error("Expansion LLM error:", raw);
    const { sanitizeErrorMessage: sanitize } = await import("@/lib/api-helpers");
    return NextResponse.json({ error: `Expansion failed: ${sanitize(llmErr)}` }, { status: 500 });
  }
}

// ── Validators ──

function validateSubComponents(raw: unknown[]): SubComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((sc): sc is Record<string, unknown> => sc !== null && typeof sc === "object")
    .map((sc, i) => ({
      id: String(sc.id ?? `SC${i + 1}`),
      name: String(sc.name ?? `Component ${i + 1}`),
      description: String(sc.description ?? ""),
      component_type: String(sc.component_type ?? "variable"),
      probability: Math.max(0, Math.min(1, Number(sc.probability ?? 0.5))),
      importance: (["critical", "important", "moderate", "minor"].includes(String(sc.importance)) ? String(sc.importance) : "moderate") as SubComponent["importance"],
      is_expandable: Boolean(sc.is_expandable ?? false),
      ...(sc.manifold && typeof sc.manifold === "object" ? { manifold: sc.manifold as SubComponent["manifold"] } : {}),
    })); // No output cap — keep every sub-component the LLM produces
}

function validatePathways(raw: unknown[], validSCs: SubComponent[]): InternalPathway[] {
  if (!Array.isArray(raw)) return [];
  const validIds = new Set(validSCs.map((sc) => sc.id));
  return raw
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
    .filter((p) => validIds.has(String(p.source_id)) && validIds.has(String(p.target_id)))
    .map((p) => ({
      source_id: String(p.source_id),
      target_id: String(p.target_id),
      mechanism: String(p.mechanism ?? ""),
      probability: Math.max(0, Math.min(1, Number(p.probability ?? 0.5))),
      conditions: p.conditions ? String(p.conditions) : null,
      dynamics: (["sequential", "parallel", "conditional", "probabilistic"].includes(String(p.dynamics)) ? String(p.dynamics) : "sequential") as InternalPathway["dynamics"],
      strength: Math.max(0, Math.min(1, Number(p.strength ?? 0.5))),
      failure_mode: p.failure_mode ? String(p.failure_mode) : null,
    })); // No output cap — keep every pathway the LLM produces
}

function validateDynamics(raw: unknown[], validSCs: SubComponent[]): InternalDynamic[] {
  if (!Array.isArray(raw)) return [];
  const validIds = new Set(validSCs.map((sc) => sc.id));
  return raw
    .filter((d): d is Record<string, unknown> => d !== null && typeof d === "object")
    .map((d) => ({
      type: (["bottleneck", "feedback_loop", "gate", "amplifier", "decay"].includes(String(d.type)) ? String(d.type) : "bottleneck") as InternalDynamic["type"],
      component_ids: Array.isArray(d.component_ids) ? (d.component_ids as string[]).filter((id) => validIds.has(String(id))).map(String) : [],
      description: String(d.description ?? ""),
      impact: String(d.impact ?? ""),
    })); // No output cap — keep every dynamic the LLM produces
}

/**
 * Mini-axiom shape produced by /expand. Shares the spirit of Tier 7 axioms from
 * the canonical decompose pipeline but scoped to the internal structure of a single
 * entity expansion (not the whole graph).
 */
export interface MiniAxiom {
  claim: string;
  visibility: "EXPLICIT" | "IMPLICIT" | "HIDDEN";
  load_bearing: "critical" | "important" | "moderate";
  rests_on_components: string[];
  if_false: string;
  validation_path: string;
  parent_entity_id: string;
}

function validateMiniAxioms(raw: unknown[], validSCs: SubComponent[], parentEntityId: string): MiniAxiom[] {
  if (!Array.isArray(raw)) return [];
  const validIds = new Set(validSCs.map((sc) => sc.id));
  const VALID_VIS = ["EXPLICIT", "IMPLICIT", "HIDDEN"] as const;
  const VALID_LB = ["critical", "important", "moderate"] as const;
  return raw
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === "object")
    .filter((a) => typeof a.claim === "string" && (a.claim as string).trim().length > 0)
    .slice(0, 3) // cap at 3 — any more dilutes load-bearing meaning
    .map((a) => {
      const visRaw = String(a.visibility ?? "IMPLICIT").toUpperCase();
      const vis = (VALID_VIS as readonly string[]).includes(visRaw)
        ? (visRaw as MiniAxiom["visibility"])
        : "IMPLICIT";
      const lbRaw = String(a.load_bearing ?? "important").toLowerCase();
      const lb = (VALID_LB as readonly string[]).includes(lbRaw)
        ? (lbRaw as MiniAxiom["load_bearing"])
        : "important";
      const rests = Array.isArray(a.rests_on_components)
        ? (a.rests_on_components as string[]).filter((id) => validIds.has(String(id))).map(String)
        : [];
      return {
        claim: String(a.claim).trim(),
        visibility: vis,
        load_bearing: lb,
        rests_on_components: rests,
        if_false: typeof a.if_false === "string" ? a.if_false.trim() : "",
        validation_path: typeof a.validation_path === "string" ? a.validation_path.trim() : "",
        parent_entity_id: parentEntityId,
      };
    });
}
