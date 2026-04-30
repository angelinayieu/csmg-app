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
      // Phase C demo bake — when the template ships with pre-baked
      // synthesis_data, write it directly so all 6 side panels
      // (Convergence, Intelligence, Radar, Agents, Reflexive, multi-
      // layer view) populate the moment the space loads. Real
      // research+synthesize chain in `after()` overwrites this with
      // LLM-generated content within 30-90s.
      ...(template.seed_synthesis_data
        ? { synthesis_data: template.seed_synthesis_data }
        : {}),
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
      if (errText.includes("synthesis_data")) {
        // Older schema without synthesis_data column on spaces — strip
        // and let the after() research/synthesize chain populate it.
        delete spaceInsert.synthesis_data;
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

    // ── Step 5b — paired downstream apps (F3 / D14) ─────────────
    //
    // Templates can ship with seed_apps — paired downstream
    // applications the twin feeds into. Cognition template ships
    // with cognitive-game ↔ cognitive-measurement.
    //
    // Two-pass insert because complementary_app_ids[] needs the
    // OTHER app's UUID:
    //   pass 1: insert all seed_apps, capture seed_id → uuid map
    //   pass 2: for each app, resolve its complementary_seed_ids
    //           to UUIDs and update its complementary_app_ids[]
    //
    // Soft-fail: any insert/update error is non-fatal; the template
    // still ships with subjects + KG. Apps are additive value.
    let appsInserted = 0;
    const seedAppIdToAppUuid = new Map<string, string>();

    if (Array.isArray(template.seed_apps) && template.seed_apps.length > 0) {
      // Map seed_id → row for pass 2 resolution.
      const appRows = template.seed_apps.map((seed) => ({
        space_id: spaceId,
        user_id: user.id,
        name: seed.name,
        description: seed.description,
        app_type: seed.app_type,
        application_type: seed.application_type,
        // Resolve dominant_entity_codes to entity UUIDs via the
        // template's entity-id-to-UUID map. Codes that didn't seed
        // are silently dropped.
        dominant_entity_codes: seed.dominant_entity_codes ?? [],
        dominant_entity_ids: (seed.dominant_entity_codes ?? [])
          .map((code) => seedIdToEntityUuid.get(code))
          .filter((id): id is string => typeof id === "string"),
        // Pass 1: complementary_app_ids stays empty; pass 2 fills it.
        complementary_app_ids: [],
        config: {
          tagline: seed.tagline ?? null,
          rationale: seed.rationale ?? null,
          template_slug: template.slug,
          seed_id: seed.seed_id,
        },
        state: {},
        status: "proposed",
        priority: 0,
      }));

      const { data: appData, error: appErr } = await db
        .from("apps")
        .insert(appRows)
        .select("id, config");

      if (appErr) {
        const msg = `apps insert: ${appErr.message ?? "unknown"}`;
        console.warn("[explore/create]", msg);
        warnings.push(msg);
      } else if (Array.isArray(appData)) {
        appsInserted = appData.length;
        // Map seed_id → real UUID via the config.seed_id we stamped.
        for (const row of appData as Array<{
          id: string;
          config: { seed_id?: string } | null;
        }>) {
          const sid = row.config?.seed_id;
          if (typeof sid === "string") seedAppIdToAppUuid.set(sid, row.id);
        }

        // Pass 2: bidirectional complementary_app_ids resolution.
        // Run all updates in parallel; soft-fail per row.
        await Promise.allSettled(
          template.seed_apps.map(async (seed) => {
            const appUuid = seedAppIdToAppUuid.get(seed.seed_id);
            if (!appUuid) return;
            const compUuids = seed.complementary_seed_ids
              .map((sid) => seedAppIdToAppUuid.get(sid))
              .filter((u): u is string => typeof u === "string");
            if (compUuids.length === 0) return;
            const { error: updErr } = await db
              .from("apps")
              .update({ complementary_app_ids: compUuids })
              .eq("id", appUuid);
            if (updErr) {
              warnings.push(
                `apps complementary update for ${seed.seed_id}: ${updErr.message ?? "unknown"}`,
              );
            }
          }),
        );
      }
    }

    // ── Step 5c — Phase 7: pre-baked flights ────────────────────
    //
    // Templates may ship pre-baked named pathways through the seed
    // graph. Each flight references seed_ids; we resolve to entity
    // UUIDs via the seedIdToEntityUuid map, then insert a flights row
    // with origin='template_seeded'. Soft-fail per flight: a flight
    // citing a seed_id that didn't materialize (entity drop during
    // sanitize) is skipped with a warning. Score breakdown is left
    // null at insert time — the next strategizer run computes the
    // real breakdown from the freshly-pooled edges' Phase 3+5
    // columns.
    let flightsInserted = 0;
    if (Array.isArray(template.seed_flights) && template.seed_flights.length > 0) {
      const flightRows: Array<Record<string, unknown>> = [];
      for (const seedFlight of template.seed_flights) {
        const stepEntityIds: string[] = [];
        let unresolved = false;
        for (const seedId of seedFlight.step_seed_ids) {
          const uuid = seedIdToEntityUuid.get(seedId);
          if (!uuid) {
            unresolved = true;
            break;
          }
          stepEntityIds.push(uuid);
        }
        if (unresolved || stepEntityIds.length < 2) {
          warnings.push(
            `flights: skipping ${seedFlight.seed_id} (≥1 step unresolved or <2 steps after entity sanitize)`,
          );
          continue;
        }
        // Resolve phase step_seed_ids → entity UUIDs (best-effort;
        // a phase that loses a step still ships, with the surviving
        // entities).
        const phases = (seedFlight.phases ?? []).map((phase) => ({
          phase: phase.phase,
          name: phase.name,
          duration_weeks: phase.duration_weeks,
          entry_criteria: phase.entry_criteria ?? null,
          exit_criteria: phase.exit_criteria,
          step_entity_ids: phase.step_seed_ids
            .map((sid) => seedIdToEntityUuid.get(sid))
            .filter((id): id is string => typeof id === "string"),
        }));
        flightRows.push({
          space_id: spaceId,
          user_id: user.id,
          name: seedFlight.name,
          description: seedFlight.description,
          category: seedFlight.category,
          steps_entity_ids: stepEntityIds,
          // steps_edge_ids is populated lazily by a follow-up resolver
          // that walks edges between consecutive step entities; we
          // leave it empty at template-install time so flights ship
          // even when an edge dropped during sanitize.
          steps_edge_ids: [],
          origin: "template_seeded",
          template_seed_id: seedFlight.seed_id,
          status: "active",
          phases: phases.length > 0 ? phases : null,
          score_breakdown: seedFlight.expected_score_breakdown ?? null,
        });
      }
      if (flightRows.length > 0) {
        const { inserted } = await resilientInsert(
          db,
          "flights",
          flightRows,
          "id",
        );
        flightsInserted = inserted;
        if (inserted < flightRows.length) {
          warnings.push(
            `flights insert: ${inserted}/${flightRows.length} succeeded`,
          );
        }
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
        summary: `Created from research template: ${template.title} (${seedIdToEntityUuid.size} entities, ${edgesInserted} edges, ${evidenceInserted} evidence, ${subjectsInserted} twins, ${appsInserted} downstream apps)`,
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
            apps: appsInserted,
          },
        },
      })
      .then(
        () => {},
        () => {},
      );

    // ── Post-template tail · augment + backfill + synthesize ────────
    //
    // Templates ship with curated entities + curated edges, but the
    // path historically stopped after seeding — synthesis never ran,
    // so leverage_points / risk_points / mechanism_grounding (D7) /
    // chain insights stayed empty, and the layer-view popup blocked
    // on `space.synthesis_data IS NULL`. This single after() block
    // chains the three substrate fills the user-text decompose path
    // already runs:
    //
    //   1. D11 · template-edge-augmenter — wires isolated entities
    //      (interventions, instruments) to the seed graph
    //   2. D13a · consequence_surface backfill — populates the
    //      dormant signature field for template entities (no-op today
    //      because seeded entities lack node_signature; harmless when
    //      that's the case, ready for future signature seeding on
    //      template entities)
    //   3. /api/pipeline/synthesize — produces leverage_points,
    //      risk_points, master_bottleneck, mechanism_grounding,
    //      feedback_loops. Bypasses both layer-coverage and
    //      measurement-coverage gates because templates lack the
    //      situation_frame + measurement specs those gates check;
    //      explicit user-initiated synthesizes still see the gates.
    //
    // Sequential within ONE after() block so synthesize sees augment's
    // edges, not pre-augment state. Each step soft-fails independently.
    // See docs/KG_DEPTH_CRITIQUE.md §9 D11 + D13a + the explore/create
    // synthesis-gap diagnosis.
    after(async () => {
      // 1. Augment isolated entities with predicted edges
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

      // 2. Backfill consequence_surface (D13a) on entities that have
      //    signatures. No-op for fresh template spaces (no signatures
      //    seeded yet) but cheap and idempotent.
      try {
        const { backfillConsequenceSurfaces } = await import(
          "@/lib/pipeline/consequence-surface-tail"
        );
        const csResult = await backfillConsequenceSurfaces({ db, spaceId });
        if (csResult && csResult.updated > 0) {
          console.log(
            `[explore/create] consequence_surface: scanned=${csResult.scanned} updated=${csResult.updated} (${csResult.duration_ms}ms)`,
          );
        }
      } catch (csErr) {
        console.warn(
          "[explore/create] consequence_surface backfill failed (non-fatal):",
          csErr,
        );
      }

      // 3. Fire RESEARCH with autoAdvance=true. Research's own after()
      //    block then fires synthesize (it already bypasses both gates
      //    for the autoAdvance path — see decompose→research handoff
      //    pattern). One trigger here populates ALL of:
      //      - synthesis_data.intelligence_radar.signals (Radar tab)
      //      - synthesis_data.leverage_points / risk_points / master_bottleneck (Convergence + side-panel sections)
      //      - synthesis_data.mechanism_grounding (D7 phenomenology vs mechanism)
      //      - synthesis_data.suggested_objectives (Agents fallback fleet)
      //      - synthesis_data.feedback_loops, action_plan, etc.
      //    Without research firing, Radar/Agents/Reflexive stay empty
      //    even after synthesize succeeds. With it, all 6 side-panel
      //    sections populate within ~30-90s of template create.
      //
      //    Same internal-fetch + cookie pass-through + 10s abort pattern
      //    as the decompose→research handoff in
      //    /api/pipeline/decompose/route.ts. Soft-fail wrapper.
      try {
        const cookieHeader = request.headers.get("cookie") ?? "";
        const origin = new URL(request.url).origin;
        // Build a research input summary from the template's metadata
        // so research has something concrete to focus on (it normally
        // takes user-text input).
        const inputSummary = [
          template.title,
          template.tagline,
          template.description,
        ]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 2000);

        const ctrl = new AbortController();
        const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
        try {
          await fetch(`${origin}/api/pipeline/research`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              spaceIds: [spaceId],
              inputSummary,
              researchDepth: "standard",
              triggeredBy: "explore_template_create",
              // autoAdvance=true tells research's own after() block to
              // fire synthesize when research completes. Research's
              // synthesize-handoff already bypasses both layer + measurement
              // gates for templates (see research/route.ts). One trigger
              // here = both research AND synthesize populate.
              autoAdvance: true,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(handoffTimeout);
        } catch (researchErr) {
          clearTimeout(handoffTimeout);
          const name = (researchErr as { name?: string })?.name;
          // AbortError is expected — we hang up once research's Lambda
          // has the request so this Lambda can terminate without holding
          // for research's full 30-60s run.
          if (name !== "AbortError") {
            console.warn(
              "[explore/create] research handoff threw (non-fatal):",
              researchErr,
            );
          }
        }
      } catch (researchOuterErr) {
        console.warn(
          "[explore/create] research trigger setup failed (non-fatal):",
          researchOuterErr,
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
        flights: flightsInserted,
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
  const row: RawRow = {
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

  // Phase 7 — when the template ships pre-baked temporal data,
  // populate the Phase 3 pooled columns directly so edges have
  // onset/peak/persistence the moment the space is created. The
  // companion evidence_registries row (buildEvidenceRow) carries
  // the citation chain so the audit trail matches.
  const t = seedEdge.temporal_seed;
  if (t) {
    if (typeof t.onset_days === "number") {
      row.onset_days_p50 = t.onset_days;
    }
    if (typeof t.peak_days === "number") {
      row.peak_days_p50 = t.peak_days;
    }
    if (typeof t.persistence_days === "number") {
      row.persistence_days_p50 = t.persistence_days;
    }
    if (t.decay_kinetics) {
      row.decay_kinetics_modal = t.decay_kinetics;
    }
    if (typeof t.heterogeneity_i2 === "number") {
      row.temporal_heterogeneity_i2 = t.heterogeneity_i2;
    }
    if (typeof t.evidence_count === "number") {
      row.temporal_evidence_count = t.evidence_count;
    }
    row.temporal_pooled_at = new Date().toISOString();
  }
  return row;
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

  const flags = seedEdge.status === "sparse" ? ["low_evidence"] : [];

  const row: RawRow = {
    space_id: spaceId,
    user_id: userId,
    attached_entity_id: targetEntityUuid,
    // Phase 7 — template-shipped evidence is curator-vetted; flip
    // to 'reviewed' so it participates in strict-mode pooling
    // (require_reviewed=true) without further user action. The
    // existing 'extracted' default stays for templates without
    // pre-baked citations.
    status: seedEdge.temporal_seed?.citations?.length ? "reviewed" : "extracted",
    reviewed_at: seedEdge.temporal_seed?.citations?.length
      ? new Date().toISOString()
      : null,
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
    flags,
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

  // Phase 7 — temporal half. When the template ships pre-baked
  // timing + citations, materialize the temporal columns + a
  // separate L2M provenance for the temporal half so the edge-detail
  // drawer's "supporting timing claims" surface (P6) can render
  // them with full attribution.
  const t = seedEdge.temporal_seed;
  if (t) {
    if (typeof t.onset_days === "number") row.onset_days = t.onset_days;
    if (typeof t.peak_days === "number") row.peak_days = t.peak_days;
    if (typeof t.persistence_days === "number")
      row.persistence_days = t.persistence_days;
    if (t.decay_kinetics) row.decay_kinetics = t.decay_kinetics;
    row.temporal_extraction_method = "stated_explicitly";
    row.temporal_extraction_confidence = conf;
    row.temporal_evidence_quote = (t.citations ?? [])
      .map((c) => `${c.authors} (${c.year}): ${c.claim}`)
      .join("\n\n")
      .slice(0, 2000);
    row.temporal_parser_provenance = {
      module: "research_template_seed_temporal",
      version: "v1",
      rule_fired: "manual_curation",
      seed_edge_id: seedEdge.seed_id,
      heterogeneity_i2: t.heterogeneity_i2 ?? null,
      evidence_count: t.evidence_count ?? null,
      flags: ["template_seeded"],
    };
    row.temporal_llm_provenance = {
      model: "n/a",
      prompt_hash: "template_seed",
      span_id: seedEdge.seed_id,
      raw_label: "temporal",
      llm_confidence: conf,
      reasoning: "Template-curated temporal pool from published literature.",
      citations: t.citations ?? [],
    };
    row.temporal_flags = ["template_seeded"];
  }
  return row;
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
