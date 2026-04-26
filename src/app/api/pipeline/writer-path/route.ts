// POST /api/pipeline/writer-path
//
// Phase 3 (VP Project report) — writer-path orchestration.
//
// Runs the three-agent pipeline that materializes experiment variants:
//   1) variant_factory  → generates 3-5 variant drafts with slot fills
//   2) iv_scorer        → scores each variant's slots + aggregates
//   3) pickChampions    → flips is_active=true on the winner per
//                         situation_key
//
// This stage runs AFTER generate-apps (so each app can optionally own
// its variants) and BEFORE the user opens the app detail page
// (so the carousel is pre-populated when they arrive). The caller
// (generate-apps route) fires this in the background via after()
// so app generation doesn't block on it.
//
// Body: { spaceId: string, appId?: string, inputText?: string,
//         variantCount?: number, triggeredBy?: string }
// Returns: { runId, variantsCreated, variantsScored, championsPicked }
//
// Soft-fail throughout — each agent returns empty on error and the
// run still completes so the pipeline_run timeline closes cleanly.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import type { StructuralEvent } from "@/types/pipeline-events";
import {
  hydrateTaxonomy,
  type ExperimentTaxonomy,
  type ExperimentVariantSlot,
} from "@/types/experiment-taxonomy";
import {
  runVariantFactory,
  persistVariants,
  type PersistedVariant,
} from "@/lib/agents/variant-factory";
import { runIVScorer, persistScoring, pickChampions } from "@/lib/agents/iv-scorer";
import {
  runLatentVariableFinder,
  persistLatentDiscovery,
  type FinderVariantInput,
} from "@/lib/agents/latent-variable-finder";

// Longer than a normal agent stage — three sequential LLM calls per run
// (factory + one scorer per variant) can push past the default 60s.
export const maxDuration = 240;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const {
    spaceId,
    appId,
    inputText: providedInput,
    variantCount,
    triggeredBy,
  } = (body ?? {}) as {
    spaceId?: string;
    appId?: string | null;
    inputText?: string;
    variantCount?: number;
    triggeredBy?: string;
  };

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // Ownership check.
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id, name")
    .eq("id", spaceId)
    .single();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Pull taxonomy. No taxonomy → skip silently (inferrer hasn't run).
  const { data: taxRow } = await db
    .from("experiment_taxonomies")
    .select("*")
    .eq("space_id", spaceId)
    .maybeSingle();
  if (!taxRow) {
    return NextResponse.json({
      skipped: true,
      reason: "no_taxonomy_for_space",
    });
  }
  const taxonomy: ExperimentTaxonomy = hydrateTaxonomy(taxRow);

  // Pull input text. Prefer explicit body; fall back to latest
  // pipeline_run's initial_prompt on this space.
  let inputText = providedInput ?? "";
  if (!inputText) {
    const { data: lastRun } = await db
      .from("pipeline_runs")
      .select("initial_prompt")
      .eq("space_id", spaceId)
      .not("initial_prompt", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    inputText = (lastRun?.initial_prompt as string | undefined) ?? "";
  }
  if (!inputText || inputText.trim().length < 20) {
    return NextResponse.json({
      skipped: true,
      reason: "no_input_text_for_space",
    });
  }

  // Top entity names (up to 6) — grounds the factory in the KG.
  const { data: entRows } = await db
    .from("entities")
    .select("name, importance")
    .eq("space_id", spaceId)
    .order("importance", { ascending: false, nullsFirst: false })
    .limit(6);
  const topEntityNames = ((entRows ?? []) as Array<{ name: string }>).map(
    (e) => e.name,
  );

  // Start the pipeline run.
  let pipelineRunId: string | null = null;
  try {
    pipelineRunId = await startPipelineRun(db, {
      spaceId,
      userId: user.id,
      pipeline: "writer_path",
      initialPrompt: inputText.slice(0, 2000),
    });
    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "enter",
      message: "Generating variants…",
    });

    // ── 1) Variant factory ─────────────────────────────────────────
    const factoryResult = await runVariantFactory({
      taxonomy,
      inputText,
      topEntityNames,
      appId: appId ?? null,
      variantCount,
    });

    if (factoryResult.variants.length === 0) {
      await emitStructuralEvent(db, pipelineRunId, {
        type: "stage_boundary",
        stage: "proposal",
        phase: "exit",
        message: "Variant factory produced nothing — skipping writer path.",
      });
      await completePipelineRun(db, pipelineRunId, "completed");
      return NextResponse.json({
        runId: pipelineRunId,
        variantsCreated: 0,
        variantsScored: 0,
        championsPicked: 0,
        reason: "factory_empty",
      });
    }

    // ── 2) Persist variants + emit variant_proposed per row ───────
    const persisted: PersistedVariant[] = await persistVariants(
      db,
      spaceId,
      appId ?? null,
      factoryResult.variants,
    );

    if (persisted.length > 0) {
      const events: StructuralEvent[] = persisted.map((v) => ({
        type: "variant_proposed",
        variantId: v.variantId,
        spaceId,
        appId: appId ?? null,
        label: v.label,
        accentColor: v.accent,
        status: v.status,
        summary: v.summary,
        shortId: v.shortId,
        situationKey: v.situationKey,
        aggregateQuality: null,
        aggregateLift: null,
      }));
      await emitBatchEvents(db, pipelineRunId, events);
    }

    // ── 3) Score each variant ─────────────────────────────────────
    // Sequential rather than parallel — keeps token spend predictable
    // and avoids the 50/min rate-limit from hammering the model.
    let variantsScored = 0;
    for (const v of persisted) {
      try {
        // Read back the slot rows we just wrote (needed for the
        // scorer's is_active + value_full + spark_points inputs).
        const { data: slotRows } = await db
          .from("experiment_variant_slots")
          .select(
            "slot_id, value_preview, value_full, is_active, spark_points, score",
          )
          .eq("variant_id", v.variantId);
        const slots = (slotRows ?? []) as Array<
          Pick<
            ExperimentVariantSlot,
            | "slot_id"
            | "value_preview"
            | "value_full"
            | "is_active"
            | "spark_points"
            | "score"
          >
        >;
        if (slots.length === 0) continue;

        const scored = await runIVScorer({
          taxonomy,
          variant: {
            id: v.variantId,
            label: v.label,
            summary: v.summary,
            situationKey: v.situationKey,
          },
          slots,
        });
        if (scored.slots.length === 0) continue;

        // Pass spaceId so persistScoring can attempt MC-backed
        // aggregate_lift via simulateVariantLift. When the variant's
        // app doesn't have a mappable lever→target pair, persistScoring
        // keeps the LLM review honestly tagged — no silent fallback to
        // fake mc_lift numbers.
        const ok = await persistScoring(
          db,
          v.variantId,
          scored,
          taxonomy,
          spaceId,
        );
        if (ok) variantsScored++;
      } catch (err) {
        console.warn(
          `[writer-path] scorer failed for variant ${v.variantId}:`,
          err,
        );
      }
    }

    // ── 4) Pick champions (set is_active=true per situation) ──────
    const championsPicked = await pickChampions(db, spaceId);

    // ── 4a) Emit `variant_deck_ready` + `iv_decomposition_ready` ──
    //
    // Sprint B.5 — with champions settled, the carousel and the IV
    // rings both have a stable read. Painter drops the full-deck
    // carousel shape (row: variants band) + the IV decomposition
    // hero card (row: experiment band). Upstream downstream-reality
    // emits after latent discovery below — this gives the painter
    // two fully-populated cards to unfurl before the heatmap lands.
    //
    // Re-read both the variants (so we get fresh aggregate_quality +
    // is_active from the scorer) and the active variant's slots so
    // the IV rings render with real numbers, not placeholders.
    try {
      const { data: allVariantRows } = await db
        .from("experiment_variants")
        .select("*")
        .eq("space_id", spaceId)
        .order("is_active", { ascending: false })
        .order("aggregate_quality", { ascending: false, nullsFirst: false })
        .limit(48);
      const variants = (allVariantRows ?? []) as Array<Record<string, unknown>>;
      const taxonomyJson = JSON.stringify(taxonomy);
      const variantsJson = JSON.stringify(variants);
      const accent =
        taxonomy.slots?.[0]?.color ??
        (variants[0]?.accent_color as string | undefined) ??
        "#1a7aff";

      await emitStructuralEvent(db, pipelineRunId, {
        type: "variant_deck_ready",
        spaceId,
        appId: appId ?? null,
        title: null,
        variantsJson,
        taxonomyJson,
        accent,
        version: Date.now(),
      });

      // Active variant with slots → IV decomposition payload.
      const activeVariant =
        variants.find((v) => (v as { is_active?: boolean }).is_active) ??
        variants[0] ??
        null;
      let variantJson = "null";
      if (activeVariant) {
        const { data: slotRows } = await db
          .from("experiment_variant_slots")
          .select("*")
          .eq("variant_id", (activeVariant as { id: string }).id);
        variantJson = JSON.stringify({
          ...activeVariant,
          slots: slotRows ?? [],
        });
      }
      await emitStructuralEvent(db, pipelineRunId, {
        type: "iv_decomposition_ready",
        spaceId,
        appId: appId ?? null,
        title: null,
        dense: true,
        variantJson,
        taxonomyJson,
        accent,
        version: Date.now(),
      });
    } catch (emitErr) {
      // Soft-fail: writer-path completion is the priority. Missing
      // painter events degrade the canvas animation but don't break
      // downstream widget behavior (app page resolvers read straight
      // from DB).
      console.warn(
        "[writer-path] deck/iv-decomposition emit failed:",
        emitErr,
      );
    }

    // ── 5) Latent variable discovery (downstream reality panel) ──
    //
    // With champions selected we now have a stable variant set. The
    // finder proposes 3-5 hidden dimensions that DIFFERENTIATE those
    // variants and scores each variant along them. Feeds the
    // `downstream_reality` widget on the VP Project report.
    //
    // Soft-fail: a finder failure doesn't block writer-path
    // completion — the widget just renders empty until a re-run
    // (user-triggered) populates it.
    let latentsDiscovered = 0;
    let latentScoresWritten = 0;
    try {
      // Re-fetch the full variant set for this space (writer-path may
      // have been invoked per-app, but latent dimensions are best
      // discovered across the entire space so the heatmap spans
      // everything the user can compare).
      const { data: finderVariantRows } = await db
        .from("experiment_variants")
        .select("id, label, summary, short_id")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: true })
        .limit(24);
      const finderVariants = (finderVariantRows ?? []) as Array<{
        id: string;
        label: string;
        summary: string | null;
        short_id: string | null;
      }>;

      if (finderVariants.length >= 2) {
        // Pull slot previews for all variants in a single query — the
        // finder needs `value_preview` + `is_active` to read what each
        // variant actually contains.
        const { data: finderSlotRows } = await db
          .from("experiment_variant_slots")
          .select("variant_id, slot_id, value_preview, is_active")
          .in("variant_id", finderVariants.map((v) => v.id));
        const slotsByVariant = new Map<
          string,
          Array<{ slot_id: string; value_preview: string | null; is_active: boolean }>
        >();
        for (const row of (finderSlotRows ?? []) as Array<{
          variant_id: string;
          slot_id: string;
          value_preview: string | null;
          is_active: boolean;
        }>) {
          const bucket = slotsByVariant.get(row.variant_id) ?? [];
          bucket.push({
            slot_id: row.slot_id,
            value_preview: row.value_preview,
            is_active: row.is_active,
          });
          slotsByVariant.set(row.variant_id, bucket);
        }

        const finderInputs: FinderVariantInput[] = finderVariants.map((v) => ({
          id: v.id,
          label: v.label,
          summary: v.summary,
          shortId: v.short_id,
          slots: slotsByVariant.get(v.id) ?? [],
        }));

        // Seed re-runs with the existing dimensions so the agent
        // prefers extending rather than wholesale renaming.
        const { data: existingLatents } = await db
          .from("latent_variables")
          .select("key, label, description")
          .eq("space_id", spaceId);

        const finderResult = await runLatentVariableFinder({
          taxonomy,
          variants: finderInputs,
          existingLatents: (existingLatents ?? []) as Array<{
            key: string;
            label: string;
            description: string;
          }>,
        });
        const persisted = await persistLatentDiscovery(
          db,
          spaceId,
          finderResult,
        );
        latentsDiscovered = persisted.latentsWritten;
        latentScoresWritten = persisted.scoresWritten;
      }
    } catch (finderErr) {
      console.warn("[writer-path] latent variable finder failed:", finderErr);
    }

    // ── 5a) Emit `app_result_ready` ───────────────────────────────
    //
    // Sprint B.5 — composed downstream-reality payload for the
    // painter's APP_FORMATION row. Re-reads from DB rather than
    // trusting `persisted.latentsWritten` alone because the finder
    // writes latents + scores in separate statements and the painter
    // needs BOTH to render a complete heatmap (latents define rows,
    // scores fill cells). If either list is empty we skip emission
    // — painter's empty state would be worse than no card.
    try {
      if (latentsDiscovered > 0 || latentScoresWritten > 0) {
        const [{ data: latentRows }, { data: scoreRows }, { data: allVariantRows }] =
          await Promise.all([
            db
              .from("latent_variables")
              .select("*")
              .eq("space_id", spaceId)
              .order("created_at", { ascending: true }),
            db
              .from("variant_outcome_scores")
              .select("*")
              .eq("space_id", spaceId),
            db
              .from("experiment_variants")
              .select("*")
              .eq("space_id", spaceId)
              .order("is_active", { ascending: false })
              .order("aggregate_quality", { ascending: false, nullsFirst: false })
              .limit(48),
          ]);
        const latents = (latentRows ?? []) as Array<{
          id: string;
          space_id: string;
          key: string;
          label: string;
          description: string;
          color: string;
          discovered_by: string;
          confidence: number | null;
          created_at: string;
          updated_at: string;
        }>;
        const scores = (scoreRows ?? []) as Array<{
          id: string;
          variant_id: string;
          space_id: string;
          latent_variable_id: string;
          score: number;
          evidence: string | null;
          scored_at: string;
        }>;
        const variants = (allVariantRows ?? []) as Array<Record<string, unknown>>;

        // Compose the heatmap payload the widget expects.
        const scoresByVariant: Record<
          string,
          Record<string, (typeof scores)[number]>
        > = {};
        for (const s of scores) {
          const bucket = scoresByVariant[s.variant_id] ?? {};
          bucket[s.latent_variable_id] = s;
          scoresByVariant[s.variant_id] = bucket;
        }
        const realityJson = JSON.stringify({
          latent_variables: latents,
          scores_by_variant: scoresByVariant,
        });

        const accent =
          latents[0]?.color ??
          taxonomy.slots?.[0]?.color ??
          "#1a7aff";

        await emitStructuralEvent(db, pipelineRunId, {
          type: "app_result_ready",
          spaceId,
          appId: appId ?? null,
          title: null,
          realityJson,
          variantsJson: JSON.stringify(variants),
          taxonomyJson: JSON.stringify(taxonomy),
          accent,
          version: Date.now(),
        });
      }
    } catch (emitErr) {
      console.warn("[writer-path] app-result emit failed:", emitErr);
    }

    // Non-critical: log to space_changelog so the audit drawer shows
    // the writer-path activity.
    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "variants_generated",
        summary: `Writer path: ${persisted.length} ${taxonomy.variant_noun}s, ${variantsScored} scored, ${championsPicked} champion${championsPicked === 1 ? "" : "s"} picked${
          latentsDiscovered > 0
            ? `, ${latentsDiscovered} latent dimension${latentsDiscovered === 1 ? "" : "s"} discovered`
            : ""
        }.`,
        details: {
          runId: pipelineRunId,
          triggered_by: triggeredBy ?? "pipeline:writer-path",
          app_id: appId ?? null,
          taxonomy_domain: taxonomy.domain_key,
          factory_confidence: factoryResult.confidence,
          latents_discovered: latentsDiscovered,
          latent_scores_written: latentScoresWritten,
        },
      });
    } catch (logErr) {
      console.warn("[writer-path] changelog insert failed:", logErr);
    }

    await emitStructuralEvent(db, pipelineRunId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "exit",
    });
    await completePipelineRun(db, pipelineRunId, "completed");

    return NextResponse.json({
      runId: pipelineRunId,
      variantsCreated: persisted.length,
      variantsScored,
      championsPicked,
      latentsDiscovered,
      latentScoresWritten,
    });
  } catch (err) {
    console.error("[writer-path] Failed:", err);
    if (pipelineRunId) {
      await completePipelineRun(
        db,
        pipelineRunId,
        "failed",
        err instanceof Error ? err.message : String(err),
      ).catch((finalizeErr) => {
        console.warn(
          "[writer-path] completePipelineRun(failed) threw:",
          finalizeErr,
        );
      });
    }
    return NextResponse.json(
      { error: `Writer path failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
