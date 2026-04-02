import { NextResponse } from "next/server";
import { llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifyMultiSpaceOwnership } from "@/lib/api-helpers";
import { SYNTHESIS_SYSTEM_PROMPT } from "@/lib/prompts/synthesis";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";

export const maxDuration = 120; // Comprehensive tier needs more time

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceIds } = body;

  if (!spaceIds || spaceIds.length === 0) {
    return NextResponse.json({ error: "spaceIds required" }, { status: 400 });
  }

  const isOwner = await verifyMultiSpaceOwnership(supabase, spaceIds, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Gather FULL data from all spaces — synthesis quality depends on input richness
    const spaceSummaries: string[] = [];

    for (const spaceId of spaceIds) {
      const [entRes, edgRes, cycRes, spaceRes] = await Promise.all([
        db.from("entities").select("*").eq("space_id", spaceId),
        db.from("edges").select("*").eq("space_id", spaceId),
        db.from("cycles").select("*").eq("space_id", spaceId),
        db.from("spaces").select("name, description, synthesis_data").eq("id", spaceId).single(),
      ]);

      const entities = (entRes.data ?? []) as Entity[];
      const edges = (edgRes.data ?? []) as Edge[];
      const cycles = (cycRes.data ?? []) as Cycle[];

      // Build UUID → entity_id map for this space
      const uuidToId = new Map<string, string>();
      for (const e of entities) uuidToId.set(e.id, e.entity_id);

      // ── FULL entity data (not just names) ──
      const entityLines = entities.map((e) => {
        const flags: string[] = [];
        if (e.is_leverage_point) flags.push("LEVERAGE");
        if (e.is_risk_point) flags.push("RISK");
        if (e.is_master_bottleneck) flags.push("MASTER_BOTTLENECK");
        if (e.is_shared_variable) flags.push("SHARED_VAR");
        const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        return `  ${e.entity_id}: ${e.name} (${e.entity_category}, ${e.importance ?? "moderate"}, conf=${e.confidence})${flagStr}\n    ${e.description ?? "no description"}`;
      });

      // ── ALL edges with full attributes ──
      const edgeLines = edges.map((e) => {
        const src = uuidToId.get(e.source_entity_id) ?? "?";
        const tgt = uuidToId.get(e.target_entity_id) ?? "?";
        const dyn = e.dynamics ? `, dynamics=${e.dynamics}` : "";
        const cond = e.conditions ? `, when: "${e.conditions}"` : "";
        const trade = e.is_tradeoff ? ", TRADEOFF" : "";
        return `  ${src} →[${e.relationship_type}]→ ${tgt} (${e.dimension}, str=${e.strength}, pol=${e.polarity}${dyn}${trade}${cond})`;
      });

      // ── Full cycle data ──
      const cycleLines = cycles.map((c) => {
        const eids = c.entity_ids?.join(" → ") ?? "?";
        const growth = c.growth_type ? `, growth=${c.growth_type}` : "";
        const time = c.cycle_time ? `, cycle_time=${c.cycle_time}` : "";
        const mult = c.estimated_multiplier ? `, multiplier=${c.estimated_multiplier}` : "";
        return `  ${c.name ?? c.cycle_id} [${c.classification}]: ${eids}${growth}${time}${mult}\n    ${c.description ?? ""}`;
      });

      // ── Structuring metadata (leverage, risk, open questions) from decompose step ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = (spaceRes.data as any)?.synthesis_data as Record<string, unknown> | null;
      let metaSection = "";
      if (meta && typeof meta === "object") {
        const parts: string[] = [];
        if (Array.isArray(meta.leverage_points) && meta.leverage_points.length > 0) {
          parts.push(`LEVERAGE POINTS:\n${JSON.stringify(meta.leverage_points, null, 1)}`);
        }
        if (Array.isArray(meta.risk_points) && meta.risk_points.length > 0) {
          parts.push(`RISK POINTS:\n${JSON.stringify(meta.risk_points, null, 1)}`);
        }
        if (meta.master_bottleneck) {
          parts.push(`MASTER BOTTLENECK:\n${JSON.stringify(meta.master_bottleneck, null, 1)}`);
        }
        if (Array.isArray(meta.open_questions) && meta.open_questions.length > 0) {
          parts.push(`OPEN QUESTIONS:\n${JSON.stringify(meta.open_questions, null, 1)}`);
        }
        if (Array.isArray(meta.contradictions) && meta.contradictions.length > 0) {
          parts.push(`CONTRADICTIONS:\n${JSON.stringify(meta.contradictions, null, 1)}`);
        }
        if (parts.length > 0) metaSection = "\n\n" + parts.join("\n\n");
      }

      spaceSummaries.push(
        `=== SPACE: ${spaceRes.data?.name ?? "Unknown"} ===\n` +
        `${spaceRes.data?.description ?? ""}\n` +
        `Stats: ${entities.length} entities, ${edges.length} edges, ${cycles.length} cycles\n\n` +
        `ENTITIES (${entities.length}):\n${entityLines.join("\n")}\n\n` +
        `RELATIONSHIPS (${edges.length}):\n${edgeLines.join("\n")}\n\n` +
        `FEEDBACK CYCLES (${cycles.length}):\n${cycleLines.join("\n")}` +
        metaSection
      );
    }

    const contextInput = spaceSummaries.join("\n\n" + "─".repeat(60) + "\n\n");

    const synthesis = await llmJSON<SynthesisData>({
      system: SYNTHESIS_SYSTEM_PROMPT,
      user: `Generate a strategic synthesis from this complete analysis data. Bring your full domain expertise — reference real frameworks, name real precedents, identify non-obvious risks that only an expert would catch. Every insight must be specific to THIS situation.\n\n${contextInput}`,
      maxTokens: 12000,
      temperature: 0.5,
    });

    // Store synthesis on the first (or root) space
    const rootSpaceId = spaceIds[0];
    await db.from("spaces").update({
      synthesis_data: synthesis,
      updated_at: new Date().toISOString(),
    }).eq("id", rootSpaceId);

    // Store action items if present (batch for speed)
    if (synthesis.action_plan?.paths) {
      const actionRows: Array<Record<string, unknown>> = [];
      let sortOrder = 0;
      for (const path of synthesis.action_plan.paths) {
        for (const tf of path.timeframes ?? []) {
          for (const action of tf.actions ?? []) {
            actionRows.push({
              space_id: rootSpaceId,
              timeframe: tf.label === "Today" ? "today"
                : tf.label === "This week" ? "this_week"
                : tf.label === "This month" ? "this_month"
                : "after_validation",
              path_label: path.label,
              action_text: action.text,
              why_text: action.why ?? null,
              tags: action.tags ?? [],
              sort_order: sortOrder++,
            });
          }
        }
      }
      if (actionRows.length > 0) {
        await db.from("action_items").insert(actionRows).then(() => {}, () => {});
      }
    }

    return NextResponse.json({ success: true, rootSpaceId });
  } catch (err) {
    console.error("Synthesis error:", err);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
