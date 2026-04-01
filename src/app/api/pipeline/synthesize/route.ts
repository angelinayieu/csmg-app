import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import { SYNTHESIS_SYSTEM_PROMPT } from "@/lib/prompts/synthesis";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { spaceIds } = await request.json();

  if (!spaceIds || spaceIds.length === 0) {
    return NextResponse.json({ error: "spaceIds required" }, { status: 400 });
  }

  try {
    // Gather data from all spaces
    const allEntities: Entity[] = [];
    const allEdges: Edge[] = [];
    const allCycles: Cycle[] = [];
    const spaceSummaries: string[] = [];

    for (const spaceId of spaceIds) {
      const [entRes, edgRes, cycRes, spaceRes] = await Promise.all([
        db.from("entities").select("*").eq("space_id", spaceId),
        db.from("edges").select("*").eq("space_id", spaceId),
        db.from("cycles").select("*").eq("space_id", spaceId),
        db.from("spaces").select("name, description").eq("id", spaceId).single(),
      ]);

      const entities = (entRes.data ?? []) as Entity[];
      const edges = (edgRes.data ?? []) as Edge[];
      const cycles = (cycRes.data ?? []) as Cycle[];

      allEntities.push(...entities);
      allEdges.push(...edges);
      allCycles.push(...cycles);

      // Build UUID → entity_id map for this space
      const uuidToId = new Map<string, string>();
      for (const e of entities) uuidToId.set(e.id, e.entity_id);

      const leveragePoints = entities.filter((e) => e.is_leverage_point).slice(0, 3);
      const riskPoints = entities.filter((e) => e.is_risk_point).slice(0, 3);
      const bottleneck = entities.find((e) => e.is_master_bottleneck);

      spaceSummaries.push(
        `Space: ${spaceRes.data?.name ?? "Unknown"}\n` +
        `Entities: ${entities.length}, Edges: ${edges.length}, Cycles: ${cycles.length}\n` +
        `Bottleneck: ${bottleneck ? `${bottleneck.entity_id} ${bottleneck.name}` : "none"}\n` +
        `Leverage: ${leveragePoints.map((e) => `${e.entity_id} ${e.name}`).join(", ") || "none"}\n` +
        `Risks: ${riskPoints.map((e) => `${e.entity_id} ${e.name}`).join(", ") || "none"}\n` +
        `Cycles: ${cycles.map((c) => `${c.name} [${c.classification}]`).join(", ") || "none"}\n` +
        `Edges: ${edges.slice(0, 20).map((e) => `${uuidToId.get(e.source_entity_id) ?? "?"} → ${uuidToId.get(e.target_entity_id) ?? "?"} [${e.relationship_type}]`).join(", ")}`
      );
    }

    const contextInput = spaceSummaries.join("\n\n---\n\n");

    const synthesis = await llmJSON<SynthesisData>({
      system: SYNTHESIS_SYSTEM_PROMPT,
      user: `Generate a strategic synthesis from this analysis:\n\n${contextInput}`,
      maxTokens: 10000,
      temperature: 0.5,
    });

    // Store synthesis on the first (or root) space
    const rootSpaceId = spaceIds[0];
    await db.from("spaces").update({
      synthesis_data: synthesis,
      updated_at: new Date().toISOString(),
    }).eq("id", rootSpaceId);

    // Store action items if present
    if (synthesis.action_plan?.paths) {
      for (const path of synthesis.action_plan.paths) {
        for (const tf of path.timeframes ?? []) {
          for (const action of tf.actions ?? []) {
            await db.from("action_items").insert({
              space_id: rootSpaceId,
              timeframe: tf.label === "Today" ? "today"
                : tf.label === "This week" ? "this_week"
                : tf.label === "This month" ? "this_month"
                : "after_validation",
              path_label: path.label,
              action_text: action.text,
              why_text: action.why ?? null,
              tags: action.tags ?? [],
            }).then(() => {}).catch(() => {}); // Non-critical
          }
        }
      }
    }

    return NextResponse.json({ success: true, rootSpaceId });
  } catch (err) {
    console.error("Synthesis error:", err);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
