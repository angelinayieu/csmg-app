// ── /api/explore/create ────────────────────────────────────────────
//
// POST /api/explore/create
//   body: { template_slug: "mind_body_cognition" }
//
// Materializes a `ResearchTemplate` (richer than the consumer-grade
// UseCaseTemplate handled by /api/use-cases/create) into a fully
// populated space:
//
//   1. spaces row (manual_authoring_enabled = true so add buttons surface)
//   2. layer_ontology rows (one per template ontology layer)
//   3. entities rows for every seed_node (layer_ontology_id resolved)
//   4. entities rows for every seed_intervention (intervention_kernel kind)
//   5. entities rows for every seed_instrument (instrument kind)
//   6. edges rows for every seed_edge (strength = |effect_size|, polarity from sign)
//   7. evidence_registries rows for every seed_edge (full L2M provenance)
//   8. subjects rows for every seed_subject (conditions populated)
//   9. lab_scaffolds rows (status='scaffolded' so labs open clean)
//
// The whole thing is best-effort: each step soft-fails so a partial
// schema still produces a usable space rather than blocking creation.

import { NextResponse, after } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import {
  getResearchTemplate,
  confidenceFromEvidence,
} from "@/lib/templates/mind-body-cognition/seed";
import type {
  ResearchTemplate,
  ResearchSeedNode,
  ResearchSeedEdge,
  ResearchSeedSubject,
  ResearchSeedIntervention,
  ResearchSeedInstrument,
  ExploreCreateResponse,
} from "@/types/research-template";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let templateSlug: string;
  try {
    const body = await request.json();
    if (typeof body.template_slug !== "string" || !body.template_slug.trim()) {
      return NextResponse.json(
        { error: "template_slug required" },
        { status: 400 },
      );
    }
    templateSlug = body.template_slug.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const template = getResearchTemplate(templateSlug);
  if (!template) {
    return NextResponse.json(
      { error: `Unknown research template: ${templateSlug}` },
      { status: 400 },
    );
  }

  // Per-step warnings collected so the response surfaces what
  // actually failed instead of silently zeroing counts.
  const warnings: string[] = [];

  try {
    // ── Step 1 — create space ────────────────────────────────────
    const spaceName = template.default_space_name.replace(
      /\{\{date\}\}/g,
      new Date().toISOString().slice(0, 10),
    );
    const prefix = template.slug.slice(0, 2).toUpperCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spaceInsert: Record<string, any> = {
      user_id: user.id,
      name: spaceName,
      description: template.default_description,
      space_prefix: prefix,
      input_text: `Research template: ${template.title}`,
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      // Critical for explore-flow: surface add buttons on the canvas.
      manual_authoring_enabled: true,
      // Stamps the template slug so the lab page knows to render the
      // ContextualLab (Subject × State × Task) instead of the legacy
      // whole-space SpaceLab.
      use_case_template_id: template.slug,
    };

    let { data: spaceRow, error: spaceErr } = await db
      .from("spaces")
      .insert(spaceInsert)
      .select("id")
      .single();

    // Tolerate either of the two newer columns being absent (older
    // schema). Strip the offending one and retry. We do this in two
    // passes because we don't know which column was the problem
    // without re-parsing the error.
    if (spaceErr) {
      const errText = (spaceErr.message ?? "").toLowerCase();
      let stripped = false;
      if (errText.includes("manual_authoring_enabled")) {
        delete spaceInsert.manual_authoring_enabled;
        stripped = true;
      }
      if (errText.includes("use_case_template_id")) {
        delete spaceInsert.use_case_template_id;
        stripped = true;
      }
      if (stripped) {
        const retry = await db
          .from("spaces")
          .insert(spaceInsert)
          .select("id")
          .single();
        spaceRow = retry.data;
        spaceErr = retry.error;
      }
    }

    if (spaceErr || !spaceRow) {
      console.error("[explore/create] Space creation failed:", spaceErr);
      return NextResponse.json(
        {
          error: "Space creation failed",
          db_error: spaceErr?.message ?? "unknown",
        },
        { status: 500 },
      );
    }

    const spaceId = spaceRow.id as string;

    // ── Step 2 — layer ontology rows ─────────────────────────────
    const layerSlugToOntologyId = new Map<string, string>();
    const layerSlugToOrdinal = new Map<string, number>();

    if (template.ontology_layers.length > 0) {
      const layerInserts = template.ontology_layers.map((layer) => ({
        space_id: spaceId,
        user_id: user.id,
        ordinal: layer.ordinal,
        label: layer.label,
        slug: layer.slug,
        description: layer.description,
        color: layer.color,
        typical_node_kinds: layer.typical_node_kinds,
        ontology_source: "starter",
      }));

      const { data: insertedLayers, error: layerErr } = await db
        .from("layer_ontology")
        .insert(layerInserts)
        .select("id, slug, ordinal");

      if (layerErr) {
        // Non-fatal — we'll still insert entities; they just won't have
        // layer_ontology_id set (knowledge_layer enum acts as fallback).
        const msg = `layer_ontology insert failed: ${layerErr.message ?? "unknown"}`;
        console.warn("[explore/create]", msg);
        warnings.push(msg);
      } else if (Array.isArray(insertedLayers)) {
        for (const row of insertedLayers as Array<{
          id: string;
          slug: string;
          ordinal: number;
        }>) {
          layerSlugToOntologyId.set(row.slug, row.id);
          layerSlugToOrdinal.set(row.slug, row.ordinal);
        }
      }
    }

    // ── Step 3 — seed entities ───────────────────────────────────
    const seedIdToEntityUuid = new Map<string, string>();

    const allSeedEntities = [
      ...buildNodeEntityRows(template, template.seed_nodes, layerSlugToOntologyId),
      ...buildInterventionEntityRows(
        template,
        template.seed_interventions,
        layerSlugToOntologyId,
      ),
      ...buildInstrumentEntityRows(
        template,
        template.seed_instruments,
        layerSlugToOntologyId,
      ),
    ];

    if (allSeedEntities.length > 0) {
      const sanitized = allSeedEntities.map((e) =>
        sanitizeEntity(e, spaceId),
      );

      const { data: insertedEntities } = await resilientInsert(
        db,
        "entities",
        sanitized,
        "id, entity_id",
      );

      for (const row of insertedEntities) {
        seedIdToEntityUuid.set(row.entity_id, row.id);
      }

      if (insertedEntities.length < allSeedEntities.length) {
        warnings.push(
          `entities insert: ${insertedEntities.length}/${allSeedEntities.length} succeeded — ${
            allSeedEntities.length - insertedEntities.length
          } rows dropped (likely schema mismatch)`,
        );
      }
    }

    // ── Step 4 — seed edges ──────────────────────────────────────
    let edgesInserted = 0;
    let evidenceInserted = 0;

    if (template.seed_edges.length > 0) {
      // Build a parallel array tracking which seed_edge each
      // sanitized row came from, so we can match evidence rows back
      // to their seed by aligned index after the filter step.
      const edgePairs: Array<{
        seed: ResearchSeedEdge;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sanitized: any;
      }> = [];
      for (const seed of template.seed_edges) {
        const sanitized = sanitizeEdge(
          buildEdgeRaw(seed),
          spaceId,
          seedIdToEntityUuid,
        );
        if (sanitized) edgePairs.push({ seed, sanitized });
      }

      if (edgePairs.length > 0) {
        const { inserted } = await resilientInsert(
          db,
          "edges",
          edgePairs.map((p) => p.sanitized),
          "id",
        );
        edgesInserted = inserted;
        if (inserted < edgePairs.length) {
          warnings.push(
            `edges insert: ${inserted}/${edgePairs.length} succeeded`,
          );
        }
      }
      if (edgePairs.length < template.seed_edges.length) {
        warnings.push(
          `edges sanitize: ${edgePairs.length}/${template.seed_edges.length} survived sanitize (entity-ref filter)`,
        );
      }
      if (edgePairs.length > 0) {

        // Build evidence rows from the surviving seed→sanitized pairs.
        // Edge UUIDs are not threaded through (they're only useful for
        // back-reference and not load-bearing); we use seed_id as the
        // stable link instead.
        const evidenceRows = edgePairs
          .map((pair) => {
            const targetUuid = seedIdToEntityUuid.get(
              pair.seed.target_seed_id,
            );
            if (!targetUuid) return null;
            return buildEvidenceRow(
              pair.seed,
              spaceId,
              user.id,
              targetUuid,
            );
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (evidenceRows.length > 0) {
          // Use a probing insert first so we capture the underlying
          // DB error (resilientInsert retries silently on schema-cache
          // misses but won't surface other failures).
          const probe = await db
            .from("evidence_registries")
            .insert(evidenceRows[0])
            .select("id");
          if (probe.error) {
            warnings.push(
              `evidence_registries insert: ${probe.error.message ?? "unknown"}`,
            );
          } else {
            evidenceInserted += 1;
            if (evidenceRows.length > 1) {
              const { inserted: evi } = await resilientInsert(
                db,
                "evidence_registries",
                evidenceRows.slice(1),
                "id",
              );
              evidenceInserted += evi;
              if (evi < evidenceRows.length - 1) {
                warnings.push(
                  `evidence_registries: ${evi + 1}/${evidenceRows.length} inserted`,
                );
              }
            }
          }
        }
      }
    }

    // ── Step 5 — subjects ────────────────────────────────────────
    let subjectsInserted = 0;
    let firstSubjectId: string | null = null;
    const materializedSubjectIds: string[] = [];

    if (template.seed_subjects.length > 0) {
      const subjectRows = template.seed_subjects.map((s) =>
        buildSubjectRow(s, spaceId, user.id, template.slug),
      );

      const { data: subjData, error: subjErr } = await db
        .from("subjects")
        .insert(subjectRows)
        .select("id");

      if (subjErr) {
        const msg = `subjects insert: ${subjErr.message ?? "unknown"}`;
        console.warn("[explore/create]", msg);
        warnings.push(msg);
      } else if (Array.isArray(subjData)) {
        subjectsInserted = subjData.length;
        for (const row of subjData as Array<{ id: string }>) {
          materializedSubjectIds.push(row.id);
        }
        firstSubjectId = materializedSubjectIds[0] ?? null;
      }
    }

    // ── Step 6 — lab scaffolds ───────────────────────────────────
    // One scaffold row carrying the proposed_subjects + features +
    // status='scaffolded'. This satisfies the lab proposal wizard
    // gate so subjects' "Open Lab" buttons land cleanly.
    let scaffoldsInserted = 0;

    if (materializedSubjectIds.length > 0) {
      const proposed_subjects = template.seed_subjects.map((s) => ({
        focus_kind: s.focus_kind,
        focus_label: s.focus_label,
        name: s.name,
        description: s.description,
        artifact_state: s.artifact_state ?? "bare_topic",
        suggested_conditions: s.conditions,
        rationale: `Pre-populated by ${template.title} template.`,
      }));

      const proposed_features = (
        ["monte_carlo", "what_if", "ab_compare", "deepen_kg"] as const
      ).map((id) => ({
        id,
        default_on:
          id === "monte_carlo" ||
          id === "what_if" ||
          template.seed_subjects.some((s) =>
            (s.default_lab_features ?? []).includes(id),
          ),
        rationale: undefined,
      }));

      const scaffoldInsert = {
        space_id: spaceId,
        user_id: user.id,
        proposed_subjects,
        proposed_features,
        proposed_parameters: {
          template_slug: template.slug,
        },
        status: "scaffolded",
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        materialized_subject_ids: materializedSubjectIds,
      };

      const { error: scaffErr } = await db
        .from("lab_scaffolds")
        .insert(scaffoldInsert);

      if (scaffErr) {
        const msg = `lab_scaffolds insert: ${scaffErr.message ?? "unknown"}`;
        console.warn("[explore/create]", msg);
        warnings.push(msg);
      } else {
        scaffoldsInserted = 1;
      }
    }

    // ── Step 7 — update space counts ─────────────────────────────
    await db
      .from("spaces")
      .update({
        entity_count: seedIdToEntityUuid.size,
        edge_count: edgesInserted,
      })
      .eq("id", spaceId);

    // ── Step 8 — changelog ───────────────────────────────────────
    await db
      .from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "research_template_seed",
        summary: `Created from research template: ${template.title} (${seedIdToEntityUuid.size} entities, ${edgesInserted} edges, ${evidenceInserted} evidence, ${subjectsInserted} subjects)`,
        details: {
          template_slug: template.slug,
          counts: {
            entities: seedIdToEntityUuid.size,
            edges: edgesInserted,
            evidence: evidenceInserted,
            subjects: subjectsInserted,
            interventions: template.seed_interventions.length,
            instruments: template.seed_instruments.length,
            lab_scaffolds: scaffoldsInserted,
          },
        },
      })
      .then(
        () => {},
        () => {},
      );

    // ── D11 · Template edge augmentation ─────────────────────────────
    //
    // Templates ship with curated entities + curated edges; heterogeneous
    // additions (interventions, instruments) often land isolated because
    // the seed graph wasn't designed for them. The user-text decompose
    // pipeline enforces orphan-detection in its prompt; this template
    // path bypasses that. The augmenter is the catch-up pass — it loads
    // the just-persisted graph, identifies isolated entities, and asks
    // an LLM to wire them to the most-related anchors. Soft-fail; runs
    // in `after()` so the response ships first. See
    // src/lib/templates/template-edge-augmenter.ts and
    // docs/KG_DEPTH_CRITIQUE.md §9 D11.
    after(async () => {
      try {
        const { runTemplateEdgeAugmenter } = await import(
          "@/lib/templates/template-edge-augmenter"
        );
        const augmentResult = await runTemplateEdgeAugmenter({
          db,
          spaceId,
          templateSlug: template.slug,
        });
        console.log(
          `[explore/create] augment: status=${augmentResult.status} isolated=${augmentResult.isolated_count} proposed=${augmentResult.edges_proposed} persisted=${augmentResult.edges_persisted} declined=${augmentResult.declined_count} (${augmentResult.duration_ms}ms)`,
        );
      } catch (augmentErr) {
        console.warn(
          "[explore/create] template-edge-augmenter failed (non-fatal):",
          augmentErr,
        );
      }
    });

    const response: ExploreCreateResponse = {
      space: {
        id: spaceId,
        name: spaceName,
        template_slug: template.slug,
      },
      counts: {
        layers: layerSlugToOntologyId.size,
        entities: seedIdToEntityUuid.size,
        edges: edgesInserted,
        evidence: evidenceInserted,
        subjects: subjectsInserted,
        interventions: template.seed_interventions.length,
        instruments: template.seed_instruments.length,
        lab_scaffolds: scaffoldsInserted,
      },
      primary_subject_id: firstSubjectId,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[explore/create] Error:", err);
    return NextResponse.json(
      {
        error: `Research template creation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }
}

// ── Helpers — build raw row payloads from seed objects ────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRow = Record<string, any>;

function buildNodeEntityRows(
  template: ResearchTemplate,
  nodes: ResearchSeedNode[],
  layerSlugToId: Map<string, string>,
): RawRow[] {
  return nodes.map((n) => ({
    entity_id: n.seed_id,
    name: n.name,
    description: n.description,
    entity_category: n.entity_category,
    entity_type: n.entity_type,
    importance: n.importance,
    confidence: 0.85,
    source_tag: "implicit",
    layer_ontology_id: layerSlugToId.get(n.layer_slug) ?? null,
    provenance: {
      source_type: "research_template_seed",
      template_slug: template.slug,
      seed_id: n.seed_id,
      short_label: n.short_label,
      observable: n.observable,
      mechanism_note: n.mechanism_note ?? null,
    },
  }));
}

function buildInterventionEntityRows(
  template: ResearchTemplate,
  interventions: ResearchSeedIntervention[],
  layerSlugToId: Map<string, string>,
): RawRow[] {
  return interventions.map((iv) => ({
    entity_id: iv.seed_id,
    name: iv.name,
    description: iv.description,
    entity_category: "process",
    entity_type: "intervention_kernel",
    importance: "important",
    confidence: 0.85,
    source_tag: "implicit",
    layer_ontology_id: layerSlugToId.get(iv.layer_slug) ?? null,
    provenance: {
      source_type: "research_template_seed_intervention",
      template_slug: template.slug,
      seed_id: iv.seed_id,
      recommended_dose: iv.recommended_dose,
      mechanism: iv.mechanism,
      effect_size: iv.effect_size,
      ci_lower: iv.ci_lower,
      ci_upper: iv.ci_upper,
      color: iv.color,
    },
  }));
}

function buildInstrumentEntityRows(
  template: ResearchTemplate,
  instruments: ResearchSeedInstrument[],
  layerSlugToId: Map<string, string>,
): RawRow[] {
  return instruments.map((inst) => ({
    entity_id: inst.seed_id,
    name: inst.name,
    description: inst.description,
    entity_category: "abstract",
    entity_type: "instrument",
    importance: "moderate",
    confidence: 0.9,
    source_tag: "implicit",
    layer_ontology_id: layerSlugToId.get(inst.layer_slug) ?? null,
    provenance: {
      source_type: "research_template_seed_instrument",
      template_slug: template.slug,
      seed_id: inst.seed_id,
      measures: inst.measures,
      modality: inst.modality ?? null,
    },
  }));
}

function buildEdgeRaw(seedEdge: ResearchSeedEdge): RawRow {
  const polarity = seedEdge.effect_size >= 0 ? "positive" : "negative";
  const strength = Math.min(1, Math.abs(seedEdge.effect_size));
  const confidence = confidenceFromEvidence(
    seedEdge.num_studies,
    seedEdge.status,
  );
  return {
    source_entity_id: seedEdge.source_seed_id,
    target_entity_id: seedEdge.target_seed_id,
    relationship_type: seedEdge.relationship_type,
    dimension: "causal",
    source_tag: "stated",
    strength,
    polarity,
    confidence,
    dynamics: "linear",
    dynamics_properties: {
      effect_size: seedEdge.effect_size,
      effect_metric: seedEdge.effect_metric ?? "beta",
      standard_error: seedEdge.standard_error,
      num_studies: seedEdge.num_studies,
      heterogeneity_i2: seedEdge.heterogeneity_i2 ?? null,
      evidence_status: seedEdge.status,
    },
  };
}

function buildEvidenceRow(
  seedEdge: ResearchSeedEdge,
  spaceId: string,
  userId: string,
  targetEntityUuid: string,
): RawRow {
  const beta = seedEdge.effect_size;
  const se = seedEdge.standard_error;
  // 95% CI from β ± 1.96·SE — standard normal approximation.
  const ci_lower = beta - 1.96 * se;
  const ci_upper = beta + 1.96 * se;
  const conf = confidenceFromEvidence(seedEdge.num_studies, seedEdge.status);

  return {
    space_id: spaceId,
    user_id: userId,
    attached_entity_id: targetEntityUuid,
    status: "extracted",
    outcome_label: seedEdge.target_seed_id,
    intervention_label: seedEdge.source_seed_id,
    effect_size: beta,
    effect_metric: seedEdge.effect_metric ?? "beta",
    ci_lower,
    ci_upper,
    ci_level: 0.95,
    standard_error: se,
    study_design: "meta_analysis",
    blinding: null,
    extraction_confidence: conf,
    flags: seedEdge.status === "sparse" ? ["low_evidence"] : [],
    parser_provenance: {
      module: "research_template_seed",
      version: "v1",
      rule_fired: "manual_curation",
      seed_edge_id: seedEdge.seed_id,
      heterogeneity_i2: seedEdge.heterogeneity_i2 ?? null,
      num_studies: seedEdge.num_studies,
      evidence_status: seedEdge.status,
    },
    llm_label_provenance: null,
  };
}

function buildSubjectRow(
  s: ResearchSeedSubject,
  spaceId: string,
  userId: string,
  templateSlug: string,
): RawRow {
  return {
    space_id: spaceId,
    user_id: userId,
    name: s.name,
    description: s.description,
    focus_kind: s.focus_kind,
    focus_label: s.focus_label,
    artifact_state: s.artifact_state ?? "bare_topic",
    conditions: s.conditions,
    entity_param_overrides: {},
    source_kind: "pipeline_proposed",
    source_ref: {
      template_slug: templateSlug,
      seed_id: s.seed_id,
    },
    status: "active",
  };
}
