// POST /api/entities/[id]/research-questions
//
// Phase 3 of the per-card (+) menu: "Research this card."
//
// Lightweight LLM call that generates 3-5 specific, evidence-seeking
// research questions targeted at this entity, given its current KG
// neighborhood and any open_questions already on the space's
// synthesis_data.
//
// This endpoint is suggest-only. The client kicks off the actual
// research run by POSTing the user's selections to the existing
// /api/pipeline/research-deep route (action: "start") with
// focusAreas = picked questions. We do NOT reimplement the deep-
// research orchestration here — that's already wired and we'd just
// be duplicating it.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  computeEntityTemporalCoverage,
  describeTemporalCoverage,
  type EntityTemporalCoverage,
} from "@/lib/research/temporal-coverage";

export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Phase 2 — temporal_dimension classifies each question by which
 *  axis of evidence it targets. Drives downstream prioritization
 *  (research-deep can route timing questions to one prompt section,
 *  magnitude questions to another). */
export type ResearchQuestionTemporalDimension =
  | "magnitude"
  | "onset"
  | "peak"
  | "persistence"
  | "dose_time"
  | "heterogeneity"
  | "mechanism"
  | "none";

export interface ResearchQuestionSuggestion {
  question: string;
  rationale: string;
  search_hint: string;
  priority: "high" | "medium" | "low";
  /** Phase 2 — what dimension of evidence this question targets. */
  temporal_dimension: ResearchQuestionTemporalDimension;
}

const SYSTEM_PROMPT = `You are surfacing specific, evidence-seeking research questions for a single concept inside a knowledge graph. Each question should be answerable by literature, data, or empirical investigation — not by armchair reasoning.

Return strict JSON:
{
  "questions": [
    {
      "question": "1 specific question — falsifiable, scoped, ends with '?'",
      "rationale": "1 sentence: why answering this would meaningfully change the KG representation",
      "search_hint": "1 short phrase suitable for a literature search (5-10 words)",
      "priority": "high" | "medium" | "low",
      "temporal_dimension": "magnitude" | "onset" | "peak" | "persistence" | "dose_time" | "heterogeneity" | "mechanism" | "none"
    }
  ]
}

Rules:
  - 3 to 5 questions. Diverse in angle (mechanism, evidence, alternative explanations, scale, contradictions, TIMING).
  - Prioritize questions whose answer would resolve a current uncertainty in the KG (open neighborhood, missing edge, unverified claim).
  - Avoid generic questions ("what is X?"). Be specific to THIS concept and ITS observed neighborhood.
  - Don't repeat questions already in existing_open_questions.
  - "high" priority = would meaningfully change a leverage point or master bottleneck.
  - "low" priority = useful but not load-bearing.

TEMPORAL DIMENSION (NEW — Phase 2 temporal-rigor):
  Every question must classify which axis of evidence it targets. Use:
  - "magnitude"     — effect size, dose-response magnitude, comparative effects
  - "onset"         — when does the effect first become measurable?
  - "peak"          — when does the effect maximize?
  - "persistence"   — how long does the effect last after intervention stops?
  - "dose_time"     — how does dose × time interact (longer/more shifts onset/peak)?
  - "heterogeneity" — between-study variation in timing or magnitude
  - "mechanism"     — pathway, mediator, mode-of-action
  - "none"          — alternative explanations, scale, contradictions not classified above

  When the COVERAGE_SUMMARY (provided in context) flags missing temporal coverage, AT LEAST ONE question should target the suggested_temporal_focus. The user has effect-size data but not timing — that's a gap to fill.`;

interface LlmOut {
  questions: Array<Partial<ResearchQuestionSuggestion>>;
}

export async function POST(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: entityId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load entity + verify ownership
  const { data: entity } = (await db
    .from("entities")
    .select(
      "id, entity_id, space_id, name, description, importance, layer, entity_category",
    )
    .eq("id", entityId)
    .maybeSingle()) as {
    data: {
      id: string;
      entity_id: string;
      space_id: string;
      name: string;
      description: string | null;
      importance: string | null;
      layer: string | null;
      entity_category: string | null;
    } | null;
  };
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const { data: space } = (await db
    .from("spaces")
    .select("id, synthesis_data")
    .eq("id", entity.space_id)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { id: string; synthesis_data: Record<string, unknown> | null } | null;
  };
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Pull neighborhood + existing open questions for context
  const { data: edgeRows } = (await db
    .from("edges")
    .select("source_entity_id, target_entity_id, relationship_type, polarity")
    .eq("space_id", entity.space_id)
    .or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`)
    .limit(40)) as {
    data: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string | null;
      polarity: string | null;
    }> | null;
  };

  const neighborIds = Array.from(
    new Set(
      (edgeRows ?? [])
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== entity.id),
    ),
  ).slice(0, 30);

  const { data: neighborEnts } =
    neighborIds.length > 0
      ? ((await db
          .from("entities")
          .select("id, name")
          .in("id", neighborIds)) as {
          data: Array<{ id: string; name: string }> | null;
        })
      : { data: [] as Array<{ id: string; name: string }> };

  const neighborNameById = new Map(
    (neighborEnts ?? []).map((n) => [n.id, n.name]),
  );
  const relationships = (edgeRows ?? [])
    .map((e) => {
      const otherId =
        e.source_entity_id === entity.id ? e.target_entity_id : e.source_entity_id;
      const otherName = neighborNameById.get(otherId);
      if (!otherName) return null;
      const direction = e.source_entity_id === entity.id ? "→" : "←";
      return `${entity.name} ${direction} ${otherName} (${e.relationship_type ?? "relates_to"}${e.polarity && e.polarity !== "neutral" ? ` · ${e.polarity}` : ""})`;
    })
    .filter((s): s is string => s !== null)
    .slice(0, 24);

  // Existing open questions (scoped to this entity if possible, otherwise
  // a snapshot of the space's open questions to avoid duplicates)
  const synth = (space.synthesis_data ?? {}) as Record<string, unknown>;
  const rawOpen = Array.isArray(synth.open_questions) ? synth.open_questions : [];
  const existingOpenQuestions = rawOpen
    .map((q) => {
      if (typeof q === "string") return q;
      if (q && typeof q === "object") {
        const obj = q as { question?: unknown };
        return typeof obj.question === "string" ? obj.question : null;
      }
      return null;
    })
    .filter((q): q is string => !!q && q.length > 0)
    .slice(0, 12);

  // Phase 2 — temporal coverage radar. Compute the entity's
  // temporal-evidence state from its incident edges (which Phase 3
  // pools onset/peak/persistence into). When coverage is missing or
  // partial, the LLM context flags this so the question generator
  // prioritizes filling the gap.
  let coverage: EntityTemporalCoverage;
  try {
    coverage = await computeEntityTemporalCoverage(db, entity.id);
  } catch (err) {
    console.warn(
      "[research-questions] temporal coverage soft-failed:",
      err,
    );
    coverage = {
      coverage: "missing",
      has_effect_size: false,
      has_onset: false,
      has_peak: false,
      has_persistence: false,
      edge_count: 0,
      incident_edge_count: 0,
      suggested_temporal_focus: "all",
    };
  }

  try {
    const context = {
      target: {
        name: entity.name,
        description: entity.description,
        layer: entity.layer,
        importance: entity.importance,
        category: entity.entity_category,
      },
      observed_relationships: relationships,
      existing_open_questions: existingOpenQuestions,
      // Phase 2 — temporal coverage radar. The prompt's TEMPORAL
      // DIMENSION rule reads suggested_temporal_focus and the
      // coverage label to bias question generation toward filling
      // the gap rather than re-covering well-pooled axes.
      coverage_summary: {
        coverage_label: describeTemporalCoverage(coverage.coverage),
        coverage_bucket: coverage.coverage,
        suggested_temporal_focus: coverage.suggested_temporal_focus,
        has_effect_size: coverage.has_effect_size,
        has_onset: coverage.has_onset,
        has_peak: coverage.has_peak,
        has_persistence: coverage.has_persistence,
        incident_edge_count: coverage.incident_edge_count,
      },
    };

    const output = await llmJSON<LlmOut>({
      system: SYSTEM_PROMPT,
      user: `Generate 3-5 evidence-seeking research questions for this concept:\n\n${JSON.stringify(context, null, 2)}`,
      maxTokens: 1500,
      temperature: 0.4,
    });

    const raw = Array.isArray(output?.questions) ? output.questions : [];
    const TEMPORAL_DIMS: ResearchQuestionTemporalDimension[] = [
      "magnitude",
      "onset",
      "peak",
      "persistence",
      "dose_time",
      "heterogeneity",
      "mechanism",
      "none",
    ];
    let suggestions: ResearchQuestionSuggestion[] = raw
      .map((q): ResearchQuestionSuggestion | null => {
        const question = typeof q.question === "string" ? q.question.trim() : "";
        const rationale =
          typeof q.rationale === "string" ? q.rationale.trim() : "";
        const search_hint =
          typeof q.search_hint === "string" ? q.search_hint.trim() : "";
        if (!question || question.length < 8) return null;
        const priority: ResearchQuestionSuggestion["priority"] =
          q.priority === "high" || q.priority === "low" ? q.priority : "medium";
        const rawDim =
          typeof q.temporal_dimension === "string"
            ? q.temporal_dimension.toLowerCase()
            : "none";
        const temporal_dimension: ResearchQuestionTemporalDimension =
          (TEMPORAL_DIMS as string[]).includes(rawDim)
            ? (rawDim as ResearchQuestionTemporalDimension)
            : "none";
        return {
          question,
          rationale,
          search_hint,
          priority,
          temporal_dimension,
        };
      })
      .filter((s): s is ResearchQuestionSuggestion => s !== null)
      .slice(0, 5);

    // Phase 2 — auto-prepend a temporal question when the coverage
    // gap is real (effect-size evidence exists but timing doesn't)
    // AND the LLM didn't already cover the suggested focus. This
    // guarantees the gap surfaces even when the LLM drifts to other
    // angles.
    const shouldAutoPrepend =
      coverage.suggested_temporal_focus !== null &&
      coverage.has_effect_size &&
      !coverage.has_onset &&
      !coverage.has_peak &&
      !coverage.has_persistence;
    const focus = coverage.suggested_temporal_focus;
    const llmCoveredFocus = suggestions.some(
      (s) =>
        s.temporal_dimension === "onset" ||
        s.temporal_dimension === "peak" ||
        s.temporal_dimension === "persistence" ||
        s.temporal_dimension === "dose_time",
    );
    if (shouldAutoPrepend && !llmCoveredFocus && focus) {
      const focusLabel =
        focus === "all" ? "onset, peak, and persistence" : focus;
      const dim: ResearchQuestionTemporalDimension =
        focus === "onset"
          ? "onset"
          : focus === "peak"
            ? "peak"
            : focus === "persistence"
              ? "persistence"
              : "onset";
      const auto: ResearchQuestionSuggestion = {
        question: `What is the time-to-effect (${focusLabel}) of ${entity.name} in published trials, and how does it vary across populations and doses?`,
        rationale: `${entity.name} has effect-size evidence but no pooled timing — a single trial reporting onset/peak/persistence would close a load-bearing gap for trajectory simulation and time-to-outcome ranking.`,
        search_hint: `${entity.name} time to effect onset peak persistence`,
        priority: "high",
        temporal_dimension: dim,
      };
      suggestions = [auto, ...suggestions].slice(0, 5);
    }

    if (suggestions.length === 0) {
      return NextResponse.json(
        { error: "No research questions could be generated" },
        { status: 500 },
      );
    }

    // Build a scoped prompt the client can use when kicking off
    // /api/pipeline/research-deep — saves the client from
    // re-encoding the entity context. Phase 2 — append the temporal
    // focus when present so the deep-research engine picks it up.
    const focusBlock =
      coverage.suggested_temporal_focus &&
      coverage.suggested_temporal_focus !== null
        ? `\n\nTEMPORAL COVERAGE GAP: ${describeTemporalCoverage(coverage.coverage)}. Prioritize finding evidence that quantifies ${coverage.suggested_temporal_focus === "all" ? "onset / peak / persistence" : coverage.suggested_temporal_focus} for this concept.`
        : "";
    const scopedPrompt =
      `Conduct deep research on the concept "${entity.name}" within ` +
      `the existing knowledge graph context.\n\n` +
      (entity.description ? `Concept: ${entity.description}\n\n` : "") +
      `Find evidence, mechanisms, contradictions, and connections that ` +
      `extend or refine how this concept is represented in the graph. ` +
      `Prioritize the focus areas listed below.` +
      focusBlock;

    return NextResponse.json({
      suggestions,
      scoped_prompt: scopedPrompt,
      space_id: entity.space_id,
      // Phase 2 — surface coverage to the client so the picker UI can
      // show "your effect-size evidence has no timing data yet"
      // without recomputing.
      temporal_coverage: coverage,
    });
  } catch (err) {
    console.error("[research-questions] error:", err);
    return NextResponse.json(
      { error: `Suggest failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
