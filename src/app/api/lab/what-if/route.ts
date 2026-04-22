// POST /api/lab/what-if
//
// LLM-grounded scenario simulator for the Universal Lab. Takes a target
// entity + direction + magnitude, builds a neighborhood subgraph from
// the KG (edges, cycles, contradictions, and — when include_cross_space
// is true — bridges reaching other spaces), and runs an LLM pass that
// returns:
//
//   { narrative, affected_entities[], propagation_paths[],
//     derived_distribution{p10,p50,p90}, cautions[] }
//
// The response is also persisted as a row in the existing `scenarios`
// table so the chamber can render the overlay on subsequent loads and
// the user can revisit past What-Ifs.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { WhatIfRequestSchema } from "@/lib/schemas/what-if";
import {
  WHAT_IF_SYSTEM_PROMPT,
  type WhatIfResponse,
} from "@/lib/prompts/what-if";

export const maxDuration = 90;

interface EntityRow {
  id: string;
  entity_id: string;
  space_id: string;
  name: string;
  description: string | null;
  entity_category: string | null;
  importance: string | null;
}

interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension: string;
  polarity: string | null;
  strength: number | null;
  confidence: number | null;
  is_tradeoff: boolean | null;
  is_part_of_cycle: boolean | null;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = WhatIfRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { target_entity_id, direction, magnitude, include_cross_space } =
    parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Load target + verify ownership via its space.
  const { data: target } = (await db
    .from("entities")
    .select(
      "id, entity_id, space_id, name, description, entity_category, importance",
    )
    .eq("id", target_entity_id)
    .maybeSingle()) as { data: EntityRow | null };
  if (!target) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const { data: space } = (await db
    .from("spaces")
    .select("id")
    .eq("id", target.space_id)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: { id: string } | null };
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // 2. Build neighborhood subgraph.
    const { data: edges } = (await db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, dimension, polarity, strength, confidence, is_tradeoff, is_part_of_cycle",
      )
      .eq("space_id", target.space_id)
      .or(
        `source_entity_id.eq.${target_entity_id},target_entity_id.eq.${target_entity_id}`,
      )) as { data: EdgeRow[] | null };

    const directEdges = edges ?? [];
    const neighborIds = Array.from(
      new Set(
        directEdges
          .flatMap((e) => [e.source_entity_id, e.target_entity_id])
          .filter((id) => id !== target_entity_id),
      ),
    );

    // Pull second-hop for high-magnitude calls so the model can trace
    // propagation past the immediate neighbors.
    let secondHopEdges: EdgeRow[] = [];
    if (magnitude >= 0.7 && neighborIds.length > 0) {
      const { data } = (await db
        .from("edges")
        .select(
          "id, source_entity_id, target_entity_id, relationship_type, dimension, polarity, strength, confidence, is_tradeoff, is_part_of_cycle",
        )
        .eq("space_id", target.space_id)
        .or(
          `source_entity_id.in.(${neighborIds.join(",")}),target_entity_id.in.(${neighborIds.join(",")})`,
        )) as { data: EdgeRow[] | null };
      secondHopEdges = data ?? [];
    }

    const allEdges = Array.from(
      new Map(
        [...directEdges, ...secondHopEdges].map((e) => [e.id, e]),
      ).values(),
    );

    const entityIds = Array.from(
      new Set([
        target_entity_id,
        ...allEdges.flatMap((e) => [
          e.source_entity_id,
          e.target_entity_id,
        ]),
      ]),
    );

    const { data: entityRows } = (await db
      .from("entities")
      .select(
        "id, entity_id, space_id, name, description, entity_category, importance",
      )
      .in("id", entityIds)) as { data: EntityRow[] | null };
    const entities = entityRows ?? [];

    // Cycles containing the target
    const { data: cycleRows } = (await db
      .from("cycles")
      .select("cycle_id, name, classification, entity_ids, description")
      .eq("space_id", target.space_id)) as {
      data: Array<{
        cycle_id: string;
        name: string | null;
        classification: string;
        entity_ids: string[];
        description: string | null;
      }> | null;
    };
    const relevantCycles = (cycleRows ?? []).filter((c) =>
      // entity_ids on cycles stores entity_id (C-prefix) or UUIDs depending on era.
      // Match on both the target's UUID and code, to be safe.
      c.entity_ids?.includes(target_entity_id) ||
      c.entity_ids?.includes(target.entity_id),
    );

    // Contradictions touching this space
    const { data: contradictions } = (await db
      .from("contradictions")
      .select(
        "assumption_text, conclusion_text, severity, description, space_a_id, space_b_id",
      )
      .or(
        `space_a_id.eq.${target.space_id},space_b_id.eq.${target.space_id}`,
      )) as {
      data: Array<{
        assumption_text: string;
        conclusion_text: string;
        severity: string;
        description: string | null;
      }> | null;
    };

    // Cross-space bridges reaching from / into this entity
    let crossBridges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      bridge_type: string;
      coupling_strength: string;
      shared_variable_name: string;
      description: string | null;
    }> = [];
    const wantBridges = include_cross_space ?? true;
    if (wantBridges) {
      const { data } = (await db
        .from("bridges")
        .select(
          "source_entity_id, target_entity_id, bridge_type, coupling_strength, shared_variable_name, description, status",
        )
        .or(
          `source_entity_id.eq.${target_entity_id},target_entity_id.eq.${target_entity_id}`,
        )
        .neq("status", "user_rejected")) as { data: typeof crossBridges | null };
      crossBridges = data ?? [];
    }

    // 3. Build the prompt payload.
    const promptContext = {
      target: {
        entity_id: target.id,
        name: target.name,
        description: target.description,
        importance: target.importance,
        category: target.entity_category,
      },
      direction,
      magnitude,
      entities: entities.map((e) => ({
        entity_id: e.id,
        name: e.name,
        description: e.description,
        importance: e.importance,
        category: e.entity_category,
      })),
      edges: allEdges.map((e) => ({
        source: e.source_entity_id,
        target: e.target_entity_id,
        type: e.relationship_type,
        dimension: e.dimension,
        polarity: e.polarity,
        strength: e.strength,
        tradeoff: e.is_tradeoff,
        part_of_cycle: e.is_part_of_cycle,
      })),
      cycles: relevantCycles,
      contradictions,
      cross_space_bridges: crossBridges,
    };

    // 4. Load the user baseline so persona_tags + lean shape the simulation.
    const { loadUserBaselineForPrompt, formatBaselineForPrompt } =
      await import("@/lib/user-baseline/prompt-context");
    const baseline = await loadUserBaselineForPrompt(db, user.id);
    const baselineBlock = formatBaselineForPrompt(baseline);

    // 5. Call the LLM.
    const result = await llmJSON<WhatIfResponse>({
      system: WHAT_IF_SYSTEM_PROMPT,
      user: `${baselineBlock}Simulate this intervention:\n\n${JSON.stringify(promptContext, null, 2)}`,
      maxTokens: 2500,
      temperature: 0.4,
    });

    // Validate + clamp the LLM output defensively.
    const affected = Array.isArray(result?.affected_entities)
      ? result.affected_entities.filter(
          (a) =>
            typeof a?.entity_id === "string" &&
            entityIds.includes(a.entity_id),
        )
      : [];
    const paths = Array.isArray(result?.propagation_paths)
      ? result.propagation_paths.filter(
          (p) =>
            Array.isArray(p?.path) &&
            p.path.every(
              (id) => typeof id === "string" && entityIds.includes(id),
            ),
        )
      : [];
    const distro = result?.derived_distribution ?? {
      p10: 0,
      p50: 50,
      p90: 100,
      rationale: "No distribution returned.",
    };

    const clean: WhatIfResponse = {
      narrative: typeof result?.narrative === "string" ? result.narrative : "",
      affected_entities: affected,
      propagation_paths: paths,
      derived_distribution: {
        p10: clamp100(distro.p10),
        p50: clamp100(distro.p50),
        p90: clamp100(distro.p90),
        rationale:
          typeof distro.rationale === "string" ? distro.rationale : "",
      },
      cautions: Array.isArray(result?.cautions)
        ? result.cautions.filter((c): c is string => typeof c === "string")
        : [],
    };

    // 5. Persist to scenarios so the chamber can resurrect this overlay later.
    try {
      await db.from("scenarios").insert({
        space_id: target.space_id,
        name: `What-if: ${direction} ${target.name}`,
        conditions: JSON.stringify({
          target_entity_id,
          direction,
          magnitude,
        }),
        outcome_label: "Predicted impact",
        outcome_value: `${Math.round(clean.derived_distribution.p50)}%`,
        probability:
          clean.derived_distribution.p50 >= 70
            ? "likely"
            : clean.derived_distribution.p50 >= 40
              ? "possible"
              : "unlikely",
      });
    } catch (persistErr) {
      console.warn("[what-if] scenario persist failed (non-fatal):", persistErr);
    }

    // Wave C — log user event for digest agent (cadence + preferred domains).
    try {
      const { recordUserEvent } = await import("@/lib/user-events/record");
      await recordUserEvent(db, {
        user_id: user.id,
        event_type: "lab.what_if_run",
        source: `user:what_if:${user.id}`,
        ref_kind: "entity",
        ref_id: target_entity_id,
        space_id: target.space_id,
        payload: {
          direction,
          magnitude,
          affected_entities_count: clean.affected_entities.length,
          predicted_p50: clean.derived_distribution.p50,
        },
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ result: clean });
  } catch (err) {
    console.error("[what-if] error:", err);
    return NextResponse.json(
      { error: `What-if failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

function clamp100(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}
