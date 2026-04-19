import { NextResponse } from "next/server";
import { llmStream, llmJSON } from "@/lib/llm";
import { safeAuth, safeJsonParse, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import type { Entity, Edge, Cycle } from "@/types";
import { buildChatIntentLine, buildShellIntentBlock } from "@/lib/prompts/intent-context";
import type { UserIntent } from "@/types/analysis";
import type { ImprovementGoal, GoalRecommendation, ObjectiveBenchmark } from "@/types/goals";

export const maxDuration = 90;

const VALID_DIMENSIONS = [
  "structural", "functional", "temporal", "causal",
  "correlational", "logical", "epistemic", "comparative", "agentive",
];

// Shell navigation types (mirrored from client)
type ShellLevel =
  | { type: "space"; spaceId: string; label: string }
  | { type: "entity"; entityId: string; name: string }
  | { type: "edge"; sourceId: string; targetId: string; label: string }
  | { type: "insight"; insightType: string; summary: string };

// ── Chat prompt builds a context-aware system message ──

function buildGoalContextBlock(
  goal: ImprovementGoal,
  recommendations: GoalRecommendation[],
  benchmark: ObjectiveBenchmark | null,
  masterBottleneckName: string | null
): string {
  const range = goal.target_value - goal.baseline_value;
  const progress = range !== 0
    ? Math.round(((goal.current_value - goal.baseline_value) / range) * 100)
    : 0;

  // Determine pace-based status
  let paceStatus = "on_track";
  if (goal.deadline) {
    const now = new Date();
    const deadline = new Date(goal.deadline);
    const created = new Date(goal.created_at);
    const totalMs = deadline.getTime() - created.getTime();
    const elapsedMs = now.getTime() - created.getTime();
    const timePercent = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 100;
    if (progress < timePercent * 0.5) paceStatus = "off_track";
    else if (progress < timePercent * 0.8) paceStatus = "at_risk";
  }

  let deadlineStr = "No deadline set";
  if (goal.deadline) {
    const daysLeft = Math.ceil(
      (new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    deadlineStr = `Deadline: ${goal.deadline} (${daysLeft} days left)`;
  }

  let block = `\n\n═══ ACTIVE GOAL ═══
Goal: "${goal.title}" (${goal.objective_type})
Metric: ${goal.metric_name} — Current: ${goal.current_value} / Target: ${goal.target_value} (${progress}%)
${deadlineStr}
Status: ${paceStatus}`;

  if (masterBottleneckName) {
    block += `\n\nTop constraint (crux): ${masterBottleneckName}`;
  }

  if (recommendations.length > 0) {
    block += `\n\nNext actions (ranked by impact):`;
    recommendations.forEach((rec, i) => {
      block += `\n${i + 1}. ${rec.title} — ${rec.reasoning} [${rec.status}]`;
    });
  }

  if (benchmark?.leading_indicators && benchmark.leading_indicators.length > 0) {
    block += `\n\nLeading indicators to check:`;
    for (const ind of benchmark.leading_indicators) {
      block += `\n  ${ind.metric} (check ${ind.check_frequency}) — green: ${ind.on_track}, yellow: ${ind.at_risk}, red: ${ind.off_track}`;
    }
  }

  block += `\n\nWhen the user asks about progress, priorities, or what to do next, reference this goal context. When they report completing an action, acknowledge the progress and suggest the next step.
═══════════════════`;

  return block;
}

function buildSystemPrompt(
  operation: string,
  entities: Entity[],
  edges: Edge[],
  cycles: Cycle[],
  entityContext?: { id: string; name: string },
  synthesisData?: Record<string, unknown> | null,
  intent?: UserIntent | null,
  focusStack?: ShellLevel[],
  goalContextBlock?: string
): string {
  const uuidToId = new Map<string, string>();
  for (const e of entities) uuidToId.set(e.id, e.entity_id);

  const entitySummary = entities
    .slice(0, 50)
    .map((e) => {
      const flags: string[] = [];
      if (e.is_leverage_point) flags.push("LEVERAGE");
      if (e.is_risk_point) flags.push("RISK");
      if (e.is_master_bottleneck) flags.push("BOTTLENECK");
      if (e.knowledge_layer === "external") flags.push("EXTERNAL");
      const f = flags.length ? ` [${flags.join(",")}]` : "";
      const conf = typeof e.confidence === "number" ? `, conf=${e.confidence}` : "";
      return `  ${e.entity_id}: ${e.name} (${e.entity_category}, importance=${e.importance}${conf})${f}`;
    })
    .join("\n");

  const edgeSummary = edges
    .slice(0, 80)
    .map((e) => {
      const src = uuidToId.get(e.source_entity_id) ?? "?";
      const tgt = uuidToId.get(e.target_entity_id) ?? "?";
      const dyn = e.dynamics ? `, dynamics=${e.dynamics}` : "";
      const util = e.utility as Record<string, unknown> | null;
      const utilStr = util?.actionability ? `, actionability=${util.actionability}` : "";
      return `  ${src} -[${e.relationship_type}]-> ${tgt} (${e.dimension}, str=${e.strength}${dyn}${utilStr})`;
    })
    .join("\n");

  const cycleSummary = cycles
    .map((c) => {
      const growth = c.growth_type ? `, growth=${c.growth_type}` : "";
      return `  ${c.name ?? c.cycle_id}: ${c.entity_ids.join(" -> ")} [${c.classification}${growth}]`;
    })
    .join("\n");

  const contextEntity = entityContext
    ? entities.find((e) => e.entity_id === entityContext.id)
    : null;

  let entityFocus = "";
  if (contextEntity) {
    const relatedEdges = edges.filter(
      (e) => e.source_entity_id === contextEntity.id || e.target_entity_id === contextEntity.id
    );
    entityFocus = `\n\nFOCUS ENTITY: ${contextEntity.entity_id} — ${contextEntity.name}
Description: ${contextEntity.description ?? "none"}
Category: ${contextEntity.entity_category}, Importance: ${contextEntity.importance}
Connected edges (${relatedEdges.length}):
${relatedEdges
  .slice(0, 20)
  .map((e) => {
    const src = uuidToId.get(e.source_entity_id) ?? "?";
    const tgt = uuidToId.get(e.target_entity_id) ?? "?";
    const dyn = e.dynamics ? ` [${e.dynamics}]` : "";
    return `  ${src} -[${e.relationship_type}]-> ${tgt}${dyn}`;
  })
  .join("\n")}`;
  }

  // Build shell navigation context — richer context at deeper drill levels
  let shellContext = "";
  if (focusStack && focusStack.length > 0) {
    const shellPath = focusStack.map((level) => {
      if (level.type === "space") return level.label;
      if (level.type === "entity") return `${level.entityId}: ${level.name}`;
      if (level.type === "edge") return `${level.sourceId} → ${level.targetId}: ${level.label}`;
      if (level.type === "insight") return `[${level.insightType}] ${level.summary}`;
      return "unknown";
    }).join(" > ");
    shellContext = `\n\nFOCUS PATH (user has drilled into this context): ${shellPath}`;

    const top = focusStack[focusStack.length - 1];

    // Edge-level focus — show both endpoints + relationship + dynamics
    if (top.type === "edge") {
      const srcEntity = entities.find((e) => e.entity_id === top.sourceId);
      const tgtEntity = entities.find((e) => e.entity_id === top.targetId);
      const relEdges = edges.filter((e) => {
        const srcId = uuidToId.get(e.source_entity_id);
        const tgtId = uuidToId.get(e.target_entity_id);
        return (srcId === top.sourceId && tgtId === top.targetId) ||
               (srcId === top.targetId && tgtId === top.sourceId);
      });

      if (srcEntity && tgtEntity) {
        const edgeDetails = relEdges.map((e) => {
          const dyn = e.dynamics ? `, dynamics=${e.dynamics}` : "";
          const props = e.dynamics_properties ? `, props=${JSON.stringify(e.dynamics_properties)}` : "";
          return `  ${e.relationship_type} (${e.dimension}, str=${e.strength}${dyn}${props})`;
        }).join("\n");

        const srcCycles = cycles.filter((c) => c.entity_ids.includes(top.sourceId));
        const tgtCycles = cycles.filter((c) => c.entity_ids.includes(top.targetId));
        const sharedCycles = srcCycles.filter((c) => c.entity_ids.includes(top.targetId));

        shellContext += `\n\nFOCUS EDGE: ${top.sourceId} (${srcEntity.name}) → ${top.targetId} (${tgtEntity.name})
Source entity: ${srcEntity.description ?? "no description"} (${srcEntity.entity_category}, importance=${srcEntity.importance})
Target entity: ${tgtEntity.description ?? "no description"} (${tgtEntity.entity_category}, importance=${tgtEntity.importance})
Relationships between them:
${edgeDetails || "  (none found)"}${sharedCycles.length > 0 ? `\nShared feedback loops: ${sharedCycles.map((c) => c.name ?? c.cycle_id).join(", ")}` : ""}`;
      }
    }

    // Insight-level focus — show the synthesis finding + referenced entities
    if (top.type === "insight" && synthesisData) {
      shellContext += `\n\nFOCUS INSIGHT [${top.insightType}]: ${top.summary}
The user is drilling into this specific finding. Provide deep analysis of mechanisms, implications, and actionable next steps.`;
    }

    shellContext += `\n\nSHELL NAVIGATION BEHAVIOR:
- The user is ${focusStack.length} level(s) deep. Tailor responses to this specific focus.
- Reference the focus path entities by ID. Be more specific and detailed than you would at the top level.
- If the user asks about something outside the current focus, answer but note the context shift.
- Suggest what the user might want to drill into next from this focus point.`;
  }

  // Build synthesis intelligence section — gives chat access to computed strategic findings
  let synthesisSection = "";
  if (synthesisData && typeof synthesisData === "object") {
    const parts: string[] = [];

    // Master bottleneck
    const mb = synthesisData.master_bottleneck as Record<string, unknown> | undefined;
    if (mb?.entity_id) {
      parts.push(`MASTER BOTTLENECK: ${mb.entity_id} — ${(mb.summary as string)?.slice(0, 200) ?? "highest-impact constraint"}`);
    }

    // Leverage points
    const lps = synthesisData.leverage_points as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(lps) && lps.length > 0) {
      parts.push(`LEVERAGE POINTS (highest-impact changes):\n${lps.slice(0, 3).map((lp) =>
        `  ${lp.entity_id}: ${lp.entity_name} — ${(lp.summary as string)?.slice(0, 150) ?? ""}`
      ).join("\n")}`);
    }

    // Risk points
    const rps = synthesisData.risk_points as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rps) && rps.length > 0) {
      parts.push(`RISK POINTS (biggest dangers):\n${rps.slice(0, 3).map((rp) =>
        `  ${rp.entity_id}: ${rp.entity_name} — ${(rp.summary as string)?.slice(0, 150) ?? ""}`
      ).join("\n")}`);
    }

    // Feedback loops
    const loops = synthesisData.feedback_loops as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(loops) && loops.length > 0) {
      parts.push(`KEY FEEDBACK LOOPS:\n${loops.slice(0, 3).map((fl) =>
        `  ${fl.name} (${fl.type}): ${(fl.steps as string[])?.join(" → ") ?? ""}`
      ).join("\n")}`);
    }

    // Action plan summary
    const ap = synthesisData.action_plan as Record<string, unknown> | undefined;
    if (ap?.paths && Array.isArray(ap.paths)) {
      const paths = ap.paths as Array<Record<string, unknown>>;
      parts.push(`ACTION PATHS (${paths.length}):\n${paths.map((p) =>
        `  ${p.icon ?? "→"} ${p.label}: ${(p.description as string)?.slice(0, 100) ?? ""}`
      ).join("\n")}`);
    }

    // Open questions — Phase 4b: split answered (facts) from unanswered (still open)
    const oq = synthesisData.open_questions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(oq) && oq.length > 0) {
      const answered = oq.filter(
        (q) => typeof q.user_answer === "string" && (q.user_answer as string).trim().length > 0
      );
      const unanswered = oq.filter(
        (q) => !(typeof q.user_answer === "string" && (q.user_answer as string).trim().length > 0)
      );
      if (answered.length > 0) {
        parts.push(`USER-SUPPLIED FACTS (answers the user provided to prior open questions — treat as ground truth):\n${answered.slice(0, 5).map((q) =>
          `  - Q: ${q.question}\n    A: ${q.user_answer}`
        ).join("\n")}`);
      }
      if (unanswered.length > 0) {
        parts.push(`OPEN QUESTIONS (still unresolved):\n${unanswered.slice(0, 3).map((q) =>
          `  - ${q.question}`
        ).join("\n")}`);
      }
    }

    // Cross-context insights
    const cci = (synthesisData.cross_context_insights ?? synthesisData.agent7_cross_context_insights) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(cci) && cci.length > 0) {
      parts.push(`CROSS-CONTEXT INSIGHTS (external knowledge connections):\n${cci.slice(0, 3).map((ins) =>
        `  - ${ins.insight}`
      ).join("\n")}`);
    }

    if (parts.length > 0) {
      synthesisSection = `\n\nSTRATEGIC SYNTHESIS (pre-computed analysis — reference these findings):\n${parts.join("\n\n")}`;
    }
  }

  const operationInstructions: Record<string, string> = {
    question: `The user is ASKING A QUESTION about this analysis. Answer using BOTH the graph data AND the strategic synthesis findings above.
Do NOT propose changes. Explain, interpret, and surface insights.
Reference specific entity IDs (like C1, C5) when relevant.
When the user asks "what should I do" or "what's most important" — draw from the STRATEGIC SYNTHESIS section, not just raw entities. Reference the master bottleneck, leverage points, action paths, and feedback loops.
When the user asks "what am I missing" — surface the open questions, cross-context insights, and any risk points they haven't asked about.
Be specific and grounded in the actual data, not generic advice.`,

    explore: `The user wants to EXPLORE deeper into a concept or entity.
Provide rich context: what this entity connects to, why it matters, what patterns it's part of.
Reference specific entity IDs. Explain mechanisms and dynamics.
Draw from the STRATEGIC SYNTHESIS to explain WHY this entity matters — is it a leverage point? A risk? Part of a feedback loop? Connected to the master bottleneck?
Suggest what the user might want to investigate next based on the entity's strategic role.
Do NOT propose graph changes.`,

    update: `The user wants to UPDATE the existing graph. Based on their request:
1. First explain what you'd change and why in your response text.
2. Then at the END of your response, output a JSON block with proposed changes.

The JSON block must be on its own line, starting with <<<CHANGES>>> and ending with <<<END_CHANGES>>>:
<<<CHANGES>>>
[
  {
    "type": "update_entity",
    "entity_id": "C5",
    "updates": { "description": "new description", "importance": "critical" },
    "reason": "why this change"
  },
  {
    "type": "add_edge",
    "source_entity_id": "C1",
    "target_entity_id": "C8",
    "relationship_type": "enables",
    "dimension": "functional",
    "strength": 0.7,
    "confidence": 0.6,
    "reason": "why this edge should exist"
  },
  {
    "type": "remove_edge",
    "source_entity_id": "C3",
    "target_entity_id": "C7",
    "relationship_type": "causes",
    "reason": "why this edge is wrong"
  }
]
<<<END_CHANGES>>>

Only propose changes the user asked for or that directly follow from their request.
CRITICAL: Only reference entity IDs that EXIST in the graph above. Do NOT invent entity IDs.`,

    extend: `The user wants to EXTEND the graph with new information. Based on their request:
1. First explain what new entities and relationships you'd add and why.
2. Then output a JSON block with proposed additions.

IMPORTANT ORDERING RULES:
- When adding new entities AND edges to those entities, the add_entity MUST come BEFORE any add_edge referencing it.
- For edges, ONLY use entity IDs that exist in the current graph OR that you are creating in the SAME change block (listed above the edge).
- New entity IDs must use the next available number. The highest current ID is C${entities.length}, so start new entities at C${entities.length + 1}.

The JSON block must be on its own line:
<<<CHANGES>>>
[
  {
    "type": "add_entity",
    "entity_id": "C${entities.length + 1}",
    "name": "New Entity Name",
    "description": "what this is",
    "entity_category": "concrete | abstract | process | relational | epistemic",
    "importance": "fundamental | critical | important | moderate",
    "reason": "why add this"
  },
  {
    "type": "add_edge",
    "source_entity_id": "C1",
    "target_entity_id": "C${entities.length + 1}",
    "relationship_type": "enables",
    "dimension": "functional",
    "strength": 0.7,
    "confidence": 0.6,
    "reason": "why this connection"
  }
]
<<<END_CHANGES>>>

Bring domain expertise: add entities the user might not have thought of but that are critical.
CRITICAL: Always list add_entity changes BEFORE any add_edge that references the new entity. Never reference an entity ID that doesn't exist in the graph and isn't being created in an earlier entry of the same change block.`,
  };

  return `You are an expert analyst assistant for an interactive knowledge graph. The user is working with a structured analysis and wants to have a conversation about it. You have access to both the raw graph data AND the strategic synthesis that was computed from it.

CURRENT GRAPH STATE:
Entities (${entities.length}):
${entitySummary}

Relationships (${edges.length}):
${edgeSummary}

Cycles (${cycles.length}):
${cycleSummary}
${entityFocus}
${shellContext}
${synthesisSection}
${goalContextBlock ?? ""}

OPERATION: ${operation.toUpperCase()}
${operationInstructions[operation] ?? operationInstructions.question}

RULES:
- Always reference specific entity IDs (C1, C5, etc.) when discussing the graph.
- Be specific to THIS analysis. No generic advice.
- Keep responses focused and actionable — tell the user what matters and WHY.
- When referencing strategic findings, explain the mechanism, don't just state the conclusion.
- For update/extend: only propose changes that make sense given the current graph structure.
- For valid dimensions: ${VALID_DIMENSIONS.join(", ")}${buildShellIntentBlock(intent, focusStack) || buildChatIntentLine(intent)}`;
}

// ── POST: Send a chat message (streaming response) ──

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceId, message, operation, entityContext, history, focusStack } = body;

  if (!spaceId || !message) {
    return NextResponse.json({ error: "spaceId and message required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Load current graph state + synthesis data
  const [entRes, edgRes, cycRes, spaceRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db.from("cycles").select("*").eq("space_id", spaceId),
    db.from("spaces").select("synthesis_data, user_role, primary_goal, context_type").eq("id", spaceId).single(),
  ]);

  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgRes.data ?? []) as Edge[];
  const cycles = (cycRes.data ?? []) as Cycle[];
  const synthesisData = (spaceRes.data?.synthesis_data as Record<string, unknown>) ?? null;
  const spaceIntent: UserIntent | null = (spaceRes.data?.user_role || spaceRes.data?.primary_goal || spaceRes.data?.context_type)
    ? {
        user_role: spaceRes.data?.user_role ?? undefined,
        primary_goal: spaceRes.data?.primary_goal ?? undefined,
        context_type: spaceRes.data?.context_type ?? undefined,
      }
    : null;

  // ── Fetch active goal + recommendations + benchmark for goal-aware chat ──
  let goalContextBlock: string | undefined;
  const { data: activeGoalRows } = await db
    .from("improvement_goals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  const activeGoal = (activeGoalRows?.[0] as ImprovementGoal | undefined) ?? null;

  if (activeGoal) {
    const { data: recRows } = await db
      .from("goal_recommendations")
      .select("*")
      .eq("goal_id", activeGoal.id)
      .order("rank", { ascending: true })
      .limit(3);

    const recommendations = (recRows ?? []) as GoalRecommendation[];

    // Extract benchmark from synthesis_data.goal_benchmarks[goalId]
    let benchmark: ObjectiveBenchmark | null = null;
    if (synthesisData) {
      const benchmarks = synthesisData.goal_benchmarks as Record<string, ObjectiveBenchmark> | undefined;
      if (benchmarks?.[activeGoal.id]) {
        benchmark = benchmarks[activeGoal.id];
      }
    }

    // Extract master bottleneck name from synthesis_data
    const mb = synthesisData?.master_bottleneck as Record<string, unknown> | undefined;
    const masterBottleneckName = (mb?.entity_name as string) ?? (mb?.name as string) ?? null;

    goalContextBlock = buildGoalContextBlock(activeGoal, recommendations, benchmark, masterBottleneckName);
  }

  const systemPrompt = buildSystemPrompt(
    operation ?? "question",
    entities,
    edges,
    cycles,
    entityContext,
    synthesisData,
    spaceIntent,
    Array.isArray(focusStack) ? focusStack as ShellLevel[] : undefined,
    goalContextBlock
  );

  // Build messages array with history
  const chatHistory = Array.isArray(history)
    ? history.map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      }))
    : [];

  const userPrompt =
    chatHistory.length > 0
      ? chatHistory.map((h: { role: string; content: string }) => `${h.role}: ${h.content}`).join("\n\n") +
        `\n\nuser: ${message}`
      : message;

  // Stream the response as SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        let fullText = "";

        for await (const chunk of llmStream({
          system: systemPrompt,
          user: userPrompt,
          maxTokens: 4096,
          temperature: 0.4,
        })) {
          fullText += chunk;
          send("delta", { text: chunk });
        }

        // Check for proposed changes in the response
        const changesMatch = fullText.match(
          /<<<CHANGES>>>\s*([\s\S]*?)\s*<<<END_CHANGES>>>/
        );

        if (changesMatch?.[1]) {
          try {
            const rawChanges = JSON.parse(changesMatch[1]);
            if (Array.isArray(rawChanges) && rawChanges.length > 0) {
              const changes = rawChanges.map(
                (c: Record<string, unknown>, i: number) => ({
                  id: `change-${Date.now()}-${i}`,
                  type: c.type as string,
                  description: (c.reason as string) ?? "Proposed change",
                  data: c,
                  status: "pending",
                })
              );
              send("proposed_changes", { changes });
            }
          } catch {
            // Invalid JSON in changes block — skip silently
          }
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Chat stream failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── PUT: Apply a proposed change to the graph ──

export async function PUT(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { spaceId, changeType, changeData } = body;

  if (!spaceId || !changeType || !changeData) {
    return NextResponse.json(
      { error: "spaceId, changeType, and changeData required" },
      { status: 400 }
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Build entity_id -> UUID map for this space (mutable — updated on entity adds)
  const { data: existingEntities } = await db
    .from("entities")
    .select("id, entity_id")
    .eq("space_id", spaceId);

  const entityIdToUuid = new Map<string, string>();
  for (const e of existingEntities ?? []) {
    entityIdToUuid.set(e.entity_id, e.id);
  }

  try {
    const data = changeData as Record<string, unknown>;

    switch (changeType) {
      case "add_entity": {
        const { data: inserted, error: insertErr } = await db.from("entities").insert({
          space_id: spaceId,
          entity_id: data.entity_id as string,
          name: data.name as string,
          description: (data.description as string) ?? "",
          entity_category: data.entity_category ?? "abstract",
          entity_type: data.entity_category ?? "abstract",
          source_tag: "implicit",
          importance: data.importance ?? "moderate",
          confidence: 0.7,
          knowledge_layer: "internal",
          authority_level: "moderate",
          provenance: { source_type: "user_update", via: "chat" },
        }).select("id").single();
        if (insertErr) throw new Error(`Failed to add entity: ${insertErr.message}`);

        // CRITICAL: Update the entityIdToUuid map so subsequent edge additions
        // in the same batch can reference this newly-created entity
        if (inserted) {
          entityIdToUuid.set(data.entity_id as string, inserted.id);
        }

        // Update space entity count
        await db.rpc("increment_space_count", {
          p_space_id: spaceId,
          p_column: "entity_count",
        }).then(() => {}, () => {
          // Fallback: manual count update
          db.from("spaces")
            .update({ entity_count: (existingEntities?.length ?? 0) + 1, updated_at: new Date().toISOString() })
            .eq("id", spaceId);
        });
        break;
      }

      case "add_edge": {
        let sourceUuid = entityIdToUuid.get(data.source_entity_id as string);
        let targetUuid = entityIdToUuid.get(data.target_entity_id as string);

        // If entity not in initial map, re-fetch — it may have been added moments ago
        if (!sourceUuid || !targetUuid) {
          const { data: freshEntities } = await db
            .from("entities")
            .select("id, entity_id")
            .eq("space_id", spaceId);
          for (const e of freshEntities ?? []) {
            entityIdToUuid.set(e.entity_id, e.id);
          }
          sourceUuid = entityIdToUuid.get(data.source_entity_id as string);
          targetUuid = entityIdToUuid.get(data.target_entity_id as string);
        }

        if (!sourceUuid || !targetUuid) {
          const missing = [];
          if (!sourceUuid) missing.push(data.source_entity_id as string);
          if (!targetUuid) missing.push(data.target_entity_id as string);
          return NextResponse.json(
            { error: `Entity not found: ${missing.join(", ")}. Accept the entity addition first, then accept this edge.` },
            { status: 400 }
          );
        }

        const dim = VALID_DIMENSIONS.includes(data.dimension as string)
          ? data.dimension
          : "functional";

        const { error: insertErr } = await db.from("edges").insert({
          space_id: spaceId,
          source_entity_id: sourceUuid,
          target_entity_id: targetUuid,
          relationship_type: data.relationship_type as string,
          dimension: dim,
          source_tag: "predicted",
          strength: typeof data.strength === "number" ? data.strength : 0.6,
          polarity: "positive",
          confidence: typeof data.confidence === "number" ? data.confidence : 0.6,
          conditions: (data.reason as string) ?? null,
          knowledge_layer: "internal",
          provenance: { source_type: "user_update", via: "chat" },
        });
        if (insertErr) throw new Error(`Failed to add edge: ${insertErr.message}`);
        break;
      }

      case "update_entity": {
        const uuid = entityIdToUuid.get(data.entity_id as string);
        if (!uuid) {
          return NextResponse.json(
            { error: `Entity not found: ${data.entity_id}` },
            { status: 400 }
          );
        }

        const updates = (data.updates ?? {}) as Record<string, unknown>;
        // Only allow safe fields to be updated
        const safeFields: Record<string, unknown> = {};
        if (typeof updates.description === "string") safeFields.description = updates.description;
        if (typeof updates.importance === "string") safeFields.importance = updates.importance;
        if (typeof updates.name === "string") safeFields.name = updates.name;

        if (Object.keys(safeFields).length > 0) {
          const { error: updateErr } = await db
            .from("entities")
            .update(safeFields)
            .eq("id", uuid);
          if (updateErr) throw new Error(`Failed to update entity: ${updateErr.message}`);
        }
        break;
      }

      case "remove_edge": {
        const srcUuid = entityIdToUuid.get(data.source_entity_id as string);
        const tgtUuid = entityIdToUuid.get(data.target_entity_id as string);
        if (!srcUuid || !tgtUuid) {
          return NextResponse.json(
            { error: "Edge entities not found" },
            { status: 400 }
          );
        }

        const { error: deleteErr } = await db
          .from("edges")
          .delete()
          .eq("space_id", spaceId)
          .eq("source_entity_id", srcUuid)
          .eq("target_entity_id", tgtUuid)
          .eq("relationship_type", data.relationship_type as string);
        if (deleteErr) throw new Error(`Failed to remove edge: ${deleteErr.message}`);
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown change type: ${changeType}` },
          { status: 400 }
        );
    }

    // Log to changelog
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "manual_edit",
      summary: `Chat ${changeType}: ${(data.reason as string) ?? (data.name as string) ?? "change applied"}`,
      details: { operation: changeType, data },
    }).then(() => {}, () => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Chat change apply error:", err);
    return NextResponse.json(
      { error: `Failed to apply change: ${sanitizeErrorMessage(err)}` },
      { status: 500 }
    );
  }
}
