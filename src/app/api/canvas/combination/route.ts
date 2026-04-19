// ── Canvas combination interpretation ──
//
// POST /api/canvas/combination
//   body: { spaceId, entityIds: [string, string, ...] }
//   → { implication, novelty, connections, mechanism }
//
// Given a pair (or small set) of entities from the user's canvas, asks
// the LLM to interpret what their intersection/combination implies.
// This is the "novel insight from probability-space intersections"
// primitive the canvas's combination card calls on demand.
//
// Max 4 entities at once to keep the prompt lean. If fewer than 2 are
// provided, returns an empty payload.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";

export const maxDuration = 25;

interface CombinationRequest {
  spaceId: string;
  entityIds: string[];
}

interface CombinationResponse {
  title: string;
  implication: string;
  novelty: "emergent" | "reinforcing" | "tension" | "trivial";
  mechanism: string;
  probes: string[];
}

const SYSTEM_PROMPT = `You are a research partner helping a user identify what the intersection of a small set of concepts implies. Given 2-4 entities from the user's knowledge graph, interpret their combination.

Return strict JSON:
{
  "title": "short headline for the combined insight (<= 10 words)",
  "implication": "1-2 sentences stating what the combination implies in the user's domain. Be concrete.",
  "novelty": "emergent | reinforcing | tension | trivial",
  "mechanism": "1 sentence on the mechanism that links them",
  "probes": ["question the user should probe next (<=12 words)", ...]  // 2-3 questions
}

Rules:
- novelty="emergent" when the combination produces something not in the individual parts.
- "reinforcing" when they mutually strengthen a shared claim.
- "tension" when they conflict.
- "trivial" when one trivially follows from the other — include a short reason in the mechanism.
- Mention entity names by their provided names.
- No preamble. No markdown. Strict JSON only.`;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<CombinationRequest>(request);
  if (parseError) return parseError;

  const { spaceId, entityIds } = body;
  if (typeof spaceId !== "string" || !Array.isArray(entityIds) || entityIds.length < 2) {
    return NextResponse.json(
      { error: "spaceId + entityIds[2..4] required" },
      { status: 400 },
    );
  }
  const ids = entityIds.slice(0, 4);

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    // Fetch entities — allow cross-space (user owns them all via RLS)
    const { data: rawEntities } = await db
      .from("entities")
      .select("id, entity_id, name, description, entity_category, layer, space_id")
      .in("id", ids);

    const entities = (rawEntities ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      entity_category: string | null;
      layer: string | null;
    }>;
    if (entities.length < 2) {
      return NextResponse.json({ error: "Entities not found" }, { status: 404 });
    }

    const entityBlock = entities
      .map(
        (e) =>
          `- ${e.name}${e.entity_category ? ` [${e.entity_category}]` : ""}${e.layer ? ` (${e.layer})` : ""}${e.description ? `: ${e.description.slice(0, 140)}` : ""}`,
      )
      .join("\n");

    const userPrompt = `Entities to combine:\n${entityBlock}\n\nInterpret their combination.`;

    const fallback: CombinationResponse = {
      title: "Combined view",
      implication: entities.map((e) => e.name).join(" × "),
      novelty: "trivial",
      mechanism: "Unable to infer a mechanism from these entities.",
      probes: [],
    };

    const result = await llmJSON<CombinationResponse>({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 500,
      temperature: 0.4,
      fallback,
    });

    return NextResponse.json({
      title: result.title ?? fallback.title,
      implication: result.implication ?? fallback.implication,
      novelty: result.novelty ?? fallback.novelty,
      mechanism: result.mechanism ?? fallback.mechanism,
      probes: Array.isArray(result.probes) ? result.probes.slice(0, 3) : [],
      source_entities: entities.map((e) => ({ id: e.id, name: e.name })),
    });
  } catch (err) {
    console.warn("[canvas/combination]", err);
    return NextResponse.json(
      { error: `Combination failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
