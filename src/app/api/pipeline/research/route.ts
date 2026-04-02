import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { DOMAIN_EXPERT_PROMPT } from "@/lib/prompts/domain-expert";
// Inline helpers (sanitize.ts doesn't export these)
function coerceEnum<T extends string>(val: unknown, valid: readonly T[], fallback: T): T {
  if (typeof val === "string" && (valid as readonly string[]).includes(val)) return val as T;
  return fallback;
}
function clampConf(val: unknown): number {
  const n = typeof val === "number" ? val : 0.5;
  return Math.max(0, Math.min(1, n));
}

const ENTITY_CATEGORIES = ["concrete", "abstract", "process", "relational", "epistemic"] as const;

export const maxDuration = 90;

interface ExternalEntity {
  entity_id: string;
  name: string;
  description: string;
  entity_type?: string;
  entity_category?: string;
  category: string;
  confidence: number;
  authority_level: string;
  relevance_to_situation: string;
}

interface ExternalEdge {
  source: string;
  target: string;
  relationship_type: string;
  dimension?: string;
}

interface PotentialBridge {
  external_entity_id: string;
  likely_internal_concept: string;
  connection_type: string;
  reasoning: string;
}

interface DomainExpertOutput {
  external_entities: ExternalEntity[];
  external_edges: ExternalEdge[];
  potential_bridges: PotentialBridge[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceIds, inputSummary, scopeSpaces } = body;

  if (!spaceIds?.length || !inputSummary) {
    return NextResponse.json(
      { error: "spaceIds and inputSummary required" },
      { status: 400 }
    );
  }

  try {
    // Build the domain context from scope spaces
    const domainContext = Array.isArray(scopeSpaces)
      ? scopeSpaces
          .map(
            (s: { name: string; key_concepts?: string[] }) =>
              `- ${s.name}: ${s.key_concepts?.join(", ") ?? "general"}`
          )
          .join("\n")
      : "General analysis";

    // Call Agent 7 (Domain Expert)
    const result = await llmJSON<DomainExpertOutput>({
      system: DOMAIN_EXPERT_PROMPT,
      user: `Situation being analyzed:\n${inputSummary}\n\nDomains being analyzed:\n${domainContext}`,
      maxTokens: 6000,
      temperature: 0.4,
    });

    const externalEntities = result.external_entities ?? [];
    const externalEdges = result.external_edges ?? [];
    const potentialBridges = result.potential_bridges ?? [];

    if (externalEntities.length === 0) {
      return NextResponse.json({
        success: true,
        entitiesCreated: 0,
        edgesCreated: 0,
        bridgesStored: 0,
      });
    }

    // Store external entities in the first space (root space)
    const rootSpaceId = spaceIds[0];
    const entityIdMap = new Map<string, string>(); // X1 -> UUID

    for (const entity of externalEntities) {
      const { data: inserted } = await db
        .from("entities")
        .insert({
          space_id: rootSpaceId,
          entity_id: entity.entity_id,
          name: entity.name,
          description: entity.description,
          entity_type: entity.entity_type ?? entity.category,
          entity_category: coerceEnum(
            entity.entity_category ?? "epistemic",
            ENTITY_CATEGORIES as unknown as string[],
            "epistemic"
          ),
          source_tag: "predicted",
          importance: "moderate",
          confidence: clampConf(entity.confidence),
          knowledge_layer: "external",
          authority_level: ["high", "moderate", "low", "unverified"].includes(
            entity.authority_level
          )
            ? entity.authority_level
            : "low",
          provenance: {
            source_type: "training_knowledge",
            category: entity.category,
            relevance: entity.relevance_to_situation,
            confidence_basis: `Agent 7 domain expert, confidence ${entity.confidence}`,
            verified_by_user: false,
          },
        })
        .select("id")
        .single();

      if (inserted) {
        entityIdMap.set(entity.entity_id, inserted.id);
      }
    }

    // Store external edges (between external entities)
    let edgesCreated = 0;
    for (const edge of externalEdges) {
      const sourceUuid = entityIdMap.get(edge.source);
      const targetUuid = entityIdMap.get(edge.target);
      if (!sourceUuid || !targetUuid) continue;

      const { error: edgeErr } = await db.from("edges").insert({
        space_id: rootSpaceId,
        source_entity_id: sourceUuid,
        target_entity_id: targetUuid,
        relationship_type: edge.relationship_type,
        dimension: edge.dimension ?? "epistemic",
        source_tag: "predicted",
        strength: 0.6,
        polarity: "positive",
        confidence: 0.6,
        knowledge_layer: "external",
        provenance: { source_type: "training_knowledge" },
      });

      if (!edgeErr) edgesCreated++;
    }

    // Store potential bridges as metadata on the root space for the weaver to use
    // We store them in synthesis_data.potential_bridges so the weaver can access them
    if (potentialBridges.length > 0) {
      const { data: spaceData } = await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", rootSpaceId)
        .single();

      const existingData =
        (spaceData?.synthesis_data as Record<string, unknown>) ?? {};
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...existingData,
            potential_bridges: potentialBridges,
          },
        })
        .eq("id", rootSpaceId);
    }

    return NextResponse.json({
      success: true,
      entitiesCreated: entityIdMap.size,
      edgesCreated,
      bridgesStored: potentialBridges.length,
    });
  } catch (err) {
    console.error("Research (Agent 7) error:", err);
    return NextResponse.json(
      { error: "Domain research failed" },
      { status: 500 }
    );
  }
}
