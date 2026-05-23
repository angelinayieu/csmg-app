// POST /api/canvas/expansion-recommendations
//
// Given an entity id, returns 2-4 Claude-Opus-4-generated concept
// expansion recommendations, each enforced by the 5 guardrails
// documented in src/lib/prompts/expansion-recommendations.ts.
//
// Triggered from the triple-lab raw-signal panel when the user
// toggles "Expansion" ON. Each recommendation includes a typed
// mechanism connection, a ring-novelty justification, a
// counterfactual unlock statement, and required evidence kind.
//
// The Anti-Generic filter (G4) runs both LLM-side AND in this route
// as a defense-in-depth — even if Claude slips through a generic
// candidate, we strip it server-side before responding.
//
// Body: { entity_id: string }
// Response 200: ExpansionRecommendationsResponse
// Response 4xx: { error: string }
//
// The route NEVER throws — failed LLM calls return an empty
// recommendations array + saturation_signal.is_saturated = true with
// a friendly reason. UI handles both shapes uniformly.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmGenerate } from "@/lib/llm";
import {
  buildExpansionRecommendationsPrompt,
  isAntiGeneric,
  type ExpansionContext,
  type ExpansionRecommendation,
  type ExpansionRecommendationsResponse,
} from "@/lib/prompts/expansion-recommendations";

export const maxDuration = 60;
export const runtime = "nodejs";

interface RequestBody {
  entity_id?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseErr } = await safeJsonParse<RequestBody>(request);
  if (parseErr) return parseErr;

  const entityId = typeof body?.entity_id === "string" ? body.entity_id : "";
  if (!entityId) {
    return NextResponse.json({ error: "entity_id required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load entity + neighborhood + space context in parallel ───────────
  const [entityRes, spaceRes] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, name, description, layer, knowledge_layer, entity_category, importance, space_id, node_signature",
      )
      .eq("id", entityId)
      .maybeSingle(),
    // We need the space for ownership check + meta block. Cheaper to
    // fetch in parallel with the entity than serial — entity tells us
    // the space id, but the where-clause on space matches user_id so
    // an empty result on cross-user access still gives us 403 path.
    null, // placeholder so destructure shape is stable
  ]);

  const entity = entityRes?.data as {
    id: string;
    name: string;
    description: string | null;
    layer: string | null;
    knowledge_layer: string | null;
    entity_category: string | null;
    importance: string | null;
    space_id: string;
    node_signature: Record<string, unknown> | null;
  } | null;
  void spaceRes;

  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  // Ownership check + meta load
  const { data: space } = (await db
    .from("spaces")
    .select("id, title, synthesis_data, layer_ontology_id, user_profile")
    .eq("id", entity.space_id)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: {
      id: string;
      title: string | null;
      synthesis_data: Record<string, unknown> | null;
      layer_ontology_id: string | null;
      user_profile: Record<string, unknown> | null;
    } | null;
  };
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // ── Load neighborhood (1-hop edges, both directions) ─────────────────
  // Keep this lean — 24 max each side, ordered by confidence desc so
  // the strongest mechanisms surface first. The LLM uses neighbor
  // names to satisfy G2 (mechanism requirement); too many neighbors
  // dilutes the prompt without improving recommendation quality.
  const [outEdges, inEdges] = await Promise.all([
    db
      .from("edges")
      .select("id, source_entity_id, target_entity_id, relationship_type, confidence")
      .eq("source_entity_id", entityId)
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(24),
    db
      .from("edges")
      .select("id, source_entity_id, target_entity_id, relationship_type, confidence")
      .eq("target_entity_id", entityId)
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(24),
  ]);

  // Collect neighbor ids; fetch their names in one round-trip.
  const neighborIds = new Set<string>();
  for (const e of (outEdges?.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>) {
    neighborIds.add(e.target_entity_id);
  }
  for (const e of (inEdges?.data ?? []) as Array<{
    source_entity_id: string;
    target_entity_id: string;
  }>) {
    neighborIds.add(e.source_entity_id);
  }
  const neighborRows = neighborIds.size
    ? ((await db
        .from("entities")
        .select("id, name")
        .in("id", Array.from(neighborIds))
        .limit(60)) as { data: Array<{ id: string; name: string }> | null })
    : { data: [] as Array<{ id: string; name: string }> };
  const nameById = new Map<string, string>();
  for (const r of neighborRows.data ?? []) nameById.set(r.id, r.name);

  const neighbors: ExpansionContext["neighbors"] = [
    ...((outEdges?.data ?? []) as Array<{
      target_entity_id: string;
      relationship_type: string | null;
    }>).map((e) => ({
      name: nameById.get(e.target_entity_id) ?? "(unknown)",
      relation: e.relationship_type ?? "relates_to",
      direction: "out" as const,
    })),
    ...((inEdges?.data ?? []) as Array<{
      source_entity_id: string;
      relationship_type: string | null;
    }>).map((e) => ({
      name: nameById.get(e.source_entity_id) ?? "(unknown)",
      relation: e.relationship_type ?? "relates_to",
      direction: "in" as const,
    })),
  ];

  // ── Build space_meta ─────────────────────────────────────────────────
  const userProfile = (space.user_profile ?? {}) as {
    domain?: string;
    primary_goal?: string;
  };
  const synthesis = (space.synthesis_data ?? {}) as Record<string, unknown>;
  const userGoal =
    typeof userProfile.primary_goal === "string"
      ? userProfile.primary_goal
      : typeof synthesis.user_intent === "string"
      ? (synthesis.user_intent as string)
      : null;

  // Layer ontology labels — best-effort; if no ontology is set we
  // pass an empty array and the LLM falls back to neighborhood
  // inference. The labels matter most when the user has approved a
  // kg_plan with custom layer slugs (e.g., "biology", "behavior",
  // "context") so the LLM stays on-domain.
  let layerLabels: string[] = [];
  if (space.layer_ontology_id) {
    const { data: layers } = (await db
      .from("layer_ontology_layers")
      .select("label, depth_order")
      .eq("layer_ontology_id", space.layer_ontology_id)
      .order("depth_order", { ascending: true })) as {
      data: Array<{ label: string; depth_order: number }> | null;
    };
    layerLabels = (layers ?? []).map((l) => l.label).filter(Boolean);
  }

  // Guardrail answers (Phase 3 fills these in; Phase 2 reads even if
  // the column doesn't exist yet — type-cast as Record so a missing
  // column resolves to {} cleanly).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guardrailAnswers = ((space as any).guardrail_answers ?? {}) as Record<
    string,
    string
  >;

  // Rings summary — pulled from node_signature if it's been
  // materialized. When absent, we let the LLM treat all rings as
  // available (which still gates against duplication via the prompt's
  // G3 logic, just less strictly).
  const ringsSummary = summarizeRings(entity.node_signature);
  const ringCount =
    entity.node_signature && typeof entity.node_signature === "object"
      ? Number((entity.node_signature as { rings?: number }).rings ?? 0)
      : 0;

  const ctx: ExpansionContext = {
    entity: {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      layer: entity.layer,
      knowledge_layer: entity.knowledge_layer,
      entity_category: entity.entity_category,
      importance: entity.importance,
      ring_count: ringCount,
      rings_summary: ringsSummary,
    },
    neighbors,
    space_meta: {
      title: space.title,
      domain: typeof userProfile.domain === "string" ? userProfile.domain : null,
      layer_ontology_labels: layerLabels,
      user_goal: userGoal,
    },
    guardrail_answers: guardrailAnswers,
  };

  // ── Call Opus 4 ──────────────────────────────────────────────────────
  const { system, user: userMsg } = buildExpansionRecommendationsPrompt(ctx);

  let raw: string;
  try {
    raw = await llmGenerate({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      system,
      user: userMsg,
      temperature: 0.3,
      maxTokens: 2048,
    });
  } catch (err) {
    // Soft-fail: return an empty payload with saturation reason so UI
    // can show "expansion temporarily unavailable" rather than crashing.
    console.warn(
      "[expansion-recommendations] LLM call failed (non-fatal):",
      sanitizeErrorMessage(err),
    );
    return NextResponse.json<ExpansionRecommendationsResponse>({
      recommendations: [],
      saturation_signal: {
        is_saturated: true,
        reason: "Expansion service temporarily unavailable. Try again in a moment.",
      },
    });
  }

  // Parse + validate
  const parsed = safeParseExpansion(raw);
  if (!parsed) {
    return NextResponse.json<ExpansionRecommendationsResponse>({
      recommendations: [],
      saturation_signal: {
        is_saturated: true,
        reason: "Unable to parse recommendations. The graph may need more context first.",
      },
    });
  }

  // ── Server-side guardrail enforcement ────────────────────────────────
  // Defense in depth. Even though the prompt enforces all 5, the LLM
  // can slip through generics or recommendations that don't actually
  // connect to a known entity. We strip those here before responding.
  const knownNeighborIds = new Set<string>(Array.from(neighborIds));
  // Also accept the entity itself as a self-reference target (used
  // when the recommendation deepens the same card with a new ring).
  knownNeighborIds.add(entity.id);

  const filtered = parsed.recommendations.filter((r) => {
    // G4 (anti-generic) — final pass
    if (isAntiGeneric(r.name)) return false;
    // G2 (mechanism target must exist)
    if (!knownNeighborIds.has(r.mechanism.target_entity_id)) {
      // Allow matching by name if id-lookup failed (Claude sometimes
      // echoes the name as the id when the prompt is loose).
      const matchByName = Array.from(nameById.entries()).find(
        ([_, n]) =>
          n.toLowerCase() === r.mechanism.target_entity_name.toLowerCase(),
      );
      if (matchByName) {
        r.mechanism.target_entity_id = matchByName[0];
      } else if (
        r.mechanism.target_entity_name.toLowerCase() === entity.name.toLowerCase()
      ) {
        r.mechanism.target_entity_id = entity.id;
      } else {
        return false;
      }
    }
    // Confidence floor
    if (typeof r.confidence !== "number" || r.confidence < 0.5) return false;
    // G5 (counterfactual unlock must be substantive — at least 12 chars
    // and contains the words "if" or "becomes" or "lets" or "would")
    if (
      typeof r.counterfactual_unlock !== "string" ||
      r.counterfactual_unlock.trim().length < 12 ||
      !/\b(if|becomes|lets|reveals|surfaces|would|exposes)\b/i.test(
        r.counterfactual_unlock,
      )
    ) {
      return false;
    }
    return true;
  });

  return NextResponse.json<ExpansionRecommendationsResponse>({
    recommendations: filtered.slice(0, 4),
    saturation_signal:
      filtered.length === 0
        ? {
            is_saturated: true,
            reason:
              parsed.saturation_signal?.reason ??
              "No expansions passed the rigor gates for this card. Add more context first.",
          }
        : { is_saturated: false, reason: null },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

function summarizeRings(
  sig: Record<string, unknown> | null,
): string | null {
  if (!sig || typeof sig !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sig as any;
  const rings = typeof s.rings === "number" ? s.rings : null;
  const cc = typeof s.canonical_code === "string" ? s.canonical_code : null;
  const basis = Array.isArray(s.basis) ? s.basis : null;
  if (rings === null && !basis) return null;
  const parts: string[] = [];
  if (rings !== null) parts.push(`rings=${rings}`);
  if (cc) parts.push(`code=${cc}`);
  if (basis && basis.length > 0) {
    const ringKinds = basis
      .map(
        (b: unknown) =>
          (b && typeof b === "object" && (b as { ring_kind?: string }).ring_kind) ||
          null,
      )
      .filter((k: string | null): k is string => !!k);
    if (ringKinds.length > 0) {
      parts.push(`existing_ring_kinds=[${ringKinds.join(", ")}]`);
    }
  }
  return parts.join(" · ");
}

function safeParseExpansion(
  raw: string,
): { recommendations: ExpansionRecommendation[]; saturation_signal: { is_saturated: boolean; reason: string | null } } | null {
  // Claude sometimes wraps JSON in ```json ... ``` despite the prompt
  // saying not to. Strip fences before parse.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const recs = (obj as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(recs)) return null;
    // Soft-validate each rec — drop malformed ones rather than failing
    // the whole response.
    const valid: ExpansionRecommendation[] = [];
    for (const r of recs) {
      if (!r || typeof r !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = r as any;
      if (typeof x.name !== "string" || typeof x.description !== "string") continue;
      if (!x.mechanism || typeof x.mechanism !== "object") continue;
      if (
        typeof x.mechanism.target_entity_id !== "string" ||
        typeof x.mechanism.relation_type !== "string"
      )
        continue;
      valid.push(x as ExpansionRecommendation);
    }
    const sat = (obj as { saturation_signal?: { is_saturated?: boolean; reason?: string | null } })
      .saturation_signal;
    return {
      recommendations: valid,
      saturation_signal: {
        is_saturated: Boolean(sat?.is_saturated),
        reason: typeof sat?.reason === "string" ? sat.reason : null,
      },
    };
  } catch {
    return null;
  }
}
