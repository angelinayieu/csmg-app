/**
 * Scoped hierarchical deepen — Sprint 5.
 *
 * Given one entity (typically an ambient-accepted concept), run a single
 * LLM pass that decomposes it into 3-5 sub-concepts + relationships, then
 * persist as child entities (same space) with topology='composes' edges
 * back to the parent.
 *
 * This is NOT the full 3-pass hierarchical pipeline (Systems → Domains →
 * Threads). That's ~240 entities and would blow the keystroke-budget ambient
 * flow. Instead, one pass at "one layer down" from the target — cheap enough
 * to run on accept, deep enough to be useful, stable enough to skip if
 * already done.
 *
 * Writes use the same sanitize + resilientInsert helpers as the intake
 * pipeline, so the resulting rows are indistinguishable from decompose
 * output downstream (synthesis, weave, etc.).
 */

import { llmJSON } from "@/lib/llm";
import { sanitizeEntity, resilientInsert, type SanitizedEntity } from "@/lib/sanitize";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface DeepenInput {
  id: string;           // parent entity UUID
  entity_id: string;    // parent entity_id (C-prefixed)
  name: string;
  description: string | null;
  space_id: string;
  importance: string | null;
  layer: string | null;
}

export interface DeepenResult {
  parent_entity_id: string;
  children: Array<{
    id: string;
    entity_id: string;
    name: string;
    description: string | null;
    importance: string;
  }>;
  edges: number;
}

const DEEPEN_SYSTEM_PROMPT = `You are decomposing a single high-level concept into its immediate sub-concepts.

Given the target concept and its context, produce 3 to 5 child concepts that
together explain / constitute / implement the parent. Each child should be
concrete enough that it would itself be useful to analyze independently, but
not so low-level that it becomes noise.

For each child, also emit any relationships BETWEEN children (not to the
parent — that's handled structurally). Focus on causal, functional, or
tradeoff relationships.

Return strict JSON:
{
  "children": [
    {
      "entity_id": "short-stable-id",
      "name": "...",
      "description": "1-2 sentences, concrete",
      "importance": "fundamental" | "critical" | "important" | "moderate",
      "entity_category": "concrete" | "abstract" | "process" | "relational" | "epistemic",
      "confidence": 0.6-0.95
    }
  ],
  "edges": [
    {
      "source": "<child entity_id>",
      "target": "<child entity_id>",
      "relationship_type": "enables" | "constrains" | "trades_off_against" | ...",
      "dimension": "causal" | "functional" | "structural" | "logical",
      "polarity": "positive" | "negative" | "neutral",
      "strength": 0.4-0.9,
      "confidence": 0.5-0.9,
      "reasoning": "1 sentence"
    }
  ]
}

Rules:
- entity_id must be 3-24 lowercase_snake_case chars, unique among children.
- Never reference the parent in edges (use structural composes edges, added server-side).
- Don't repeat the parent's name or description in a child verbatim.
`;

interface LlmDeepenOutput {
  children: Array<{
    entity_id?: string;
    name?: string;
    description?: string;
    importance?: string;
    entity_category?: string;
    confidence?: number;
  }>;
  edges?: Array<{
    source?: string;
    target?: string;
    relationship_type?: string;
    dimension?: string;
    polarity?: string;
    strength?: number;
    confidence?: number;
    reasoning?: string;
  }>;
}

export async function deepenEntity(
  db: AnyDb,
  target: DeepenInput,
): Promise<DeepenResult> {
  // 1. Fetch a bit of context — the parent's neighbors in the KG so the LLM
  //    doesn't propose children that duplicate adjacent concepts.
  const { data: neighborRows } = (await db
    .from("edges")
    .select("source_entity_id, target_entity_id")
    .eq("space_id", target.space_id)
    .or(
      `source_entity_id.eq.${target.id},target_entity_id.eq.${target.id}`,
    )) as {
    data: Array<{ source_entity_id: string; target_entity_id: string }> | null;
  };
  const neighborIds = Array.from(
    new Set(
      (neighborRows ?? [])
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== target.id),
    ),
  );
  let neighborSummary: Array<{ name: string }> = [];
  if (neighborIds.length > 0) {
    const { data: ents } = (await db
      .from("entities")
      .select("name")
      .in("id", neighborIds.slice(0, 30))) as {
      data: Array<{ name: string }> | null;
    };
    neighborSummary = ents ?? [];
  }

  // 2. Call the LLM
  const context = {
    target: {
      name: target.name,
      description: target.description,
      layer: target.layer,
      importance: target.importance,
    },
    existing_neighbors: neighborSummary.map((n) => n.name),
  };

  const output = await llmJSON<LlmDeepenOutput>({
    system: DEEPEN_SYSTEM_PROMPT,
    user: `Decompose this concept into 3-5 direct children:\n\n${JSON.stringify(context, null, 2)}`,
    maxTokens: 2000,
    temperature: 0.3,
  });

  const rawChildren = Array.isArray(output?.children) ? output.children : [];
  if (rawChildren.length === 0) {
    return { parent_entity_id: target.id, children: [], edges: 0 };
  }

  // 3. Sanitize child entities. Layer = parent_layer + 1 (clamped).
  const parentDepth = depthOfLayer(target.layer);
  const childLayer = LAYER_BY_DEPTH[Math.min(4, parentDepth + 1)];

  const sanitizedChildren: SanitizedEntity[] = rawChildren.map((c) =>
    sanitizeEntity(
      {
        entity_id:
          c.entity_id && /^[a-z0-9_]{3,24}$/.test(c.entity_id)
            ? `${target.entity_id}__${c.entity_id}`
            : undefined,
        name: c.name,
        description: c.description,
        source_tag: "inferred",
        entity_category: c.entity_category,
        layer: childLayer,
        importance: c.importance ?? "important",
        confidence: c.confidence ?? 0.7,
        is_decomposable: true,
        provenance: {
          source: "deepen",
          parent_entity_id: target.id,
          parent_entity_code: target.entity_id,
        },
      },
      target.space_id,
    ),
  );

  // 4. Insert children
  const { data: insertedChildren } = await resilientInsert(
    db,
    "entities",
    sanitizedChildren,
    "id, entity_id, name, description, importance",
  );

  if (insertedChildren.length === 0) {
    return { parent_entity_id: target.id, children: [], edges: 0 };
  }

  type InsertedChild = {
    id: string;
    entity_id: string;
    name: string;
    description: string | null;
    importance: string;
  };
  const insertedChildTyped = insertedChildren as unknown as InsertedChild[];

  // 5. Structural "composes" edges: each child → parent
  const structuralEdges = insertedChildTyped.map((c) => ({
    space_id: target.space_id,
    source_entity_id: c.id,
    target_entity_id: target.id,
    relationship_type: "composes",
    dimension: "structural",
    source_tag: "inferred",
    strength: 0.9,
    polarity: "positive",
    confidence: 0.9,
    is_tradeoff: false,
    is_part_of_cycle: false,
    topology: "composes",
  }));

  // 6. LLM-emitted edges between children (resolve entity_id → UUID)
  const childIdByCode = new Map<string, string>();
  for (const c of insertedChildTyped) {
    childIdByCode.set(c.entity_id, c.id);
    // Also support unprefixed form from the LLM output
    const shortCode = c.entity_id.replace(`${target.entity_id}__`, "");
    childIdByCode.set(shortCode, c.id);
  }

  const rawEdges = Array.isArray(output?.edges) ? output.edges : [];
  const llmEdges = rawEdges
    .map((e) => {
      if (!e.source || !e.target) return null;
      const srcId = childIdByCode.get(e.source);
      const tgtId = childIdByCode.get(e.target);
      if (!srcId || !tgtId || srcId === tgtId) return null;
      return {
        space_id: target.space_id,
        source_entity_id: srcId,
        target_entity_id: tgtId,
        relationship_type: e.relationship_type ?? "relates_to",
        dimension: e.dimension ?? "causal",
        source_tag: "inferred",
        strength:
          typeof e.strength === "number"
            ? Math.max(0, Math.min(1, e.strength))
            : 0.6,
        polarity: e.polarity ?? "neutral",
        confidence:
          typeof e.confidence === "number"
            ? Math.max(0, Math.min(1, e.confidence))
            : 0.7,
        is_tradeoff: e.relationship_type === "trades_off_against",
        is_part_of_cycle: false,
        topology: null,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const { inserted: edgeCount } = await resilientInsert(
    db,
    "edges",
    [...structuralEdges, ...llmEdges],
  );

  // 7. Mark the parent as deepened so UI can show "already expanded"
  await db
    .from("entities")
    .update({ is_decomposable: false })
    .eq("id", target.id);

  return {
    parent_entity_id: target.id,
    children: insertedChildTyped.map((c) => ({
      id: c.id,
      entity_id: c.entity_id,
      name: c.name,
      description: c.description,
      importance: c.importance,
    })),
    edges: edgeCount,
  };
}

// ── helpers ────────────────────────────────────────────────────────

const LAYER_BY_DEPTH = ["system", "domain", "thread", "claim", "atom"];

function depthOfLayer(layer: string | null): number {
  switch (layer) {
    case "system":
      return 0;
    case "domain":
      return 1;
    case "thread":
      return 2;
    case "claim":
      return 3;
    case "atom":
      return 4;
    default:
      return 2; // default to thread-level input
  }
}

/**
 * Check if an entity has already been deepened (has at least one child
 * via a composes edge). Used by the endpoint to return the existing
 * children instead of re-running the LLM.
 */
export async function findExistingChildren(
  db: AnyDb,
  parentEntityId: string,
  spaceId: string,
): Promise<DeepenResult["children"]> {
  const { data: edges } = (await db
    .from("edges")
    .select("source_entity_id")
    .eq("space_id", spaceId)
    .eq("target_entity_id", parentEntityId)
    .eq("relationship_type", "composes")) as {
    data: Array<{ source_entity_id: string }> | null;
  };
  const childIds = (edges ?? []).map((e) => e.source_entity_id);
  if (childIds.length === 0) return [];

  const { data: children } = (await db
    .from("entities")
    .select("id, entity_id, name, description, importance")
    .in("id", childIds)) as {
    data: Array<{
      id: string;
      entity_id: string;
      name: string;
      description: string | null;
      importance: string;
    }> | null;
  };
  return children ?? [];
}
