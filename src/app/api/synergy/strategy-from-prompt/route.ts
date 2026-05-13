// ── POST /api/synergy/strategy-from-prompt ──
//
// 0-to-doc orchestrator. Given a free-form prompt, runs:
//   Stage 1: synthesize a converged brainstorm (one LLM call) →
//            persists as a real brainstorm_sessions row with:
//              - objective_statement + constraints + success_criteria
//              - one core node
//              - 3-6 branch nodes
//              - one plan-kind node with the structured PlanResult in
//                meta using the canonical <<plan-v1>> marker
//   Stage 2: extract components (reuses existing /extract endpoint
//            logic; the plan node makes the extraction plan-aware)
//   Stage 3: generate strategy doc (reuses /strategy/generate logic)
//
// Returns { session_id, strategy_id } so the client can navigate
// directly to /app/synergy/[session_id]/strategy.
//
// Single non-streaming response — the client UI presents the multi-
// stage progress visually via its own scripted timing. Real streaming
// (SSE per-stage updates) is a follow-up — for now the user sees the
// stages cascade with realistic durations.

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { embedTexts } from "@/lib/embeddings";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  SYNTHESIZE_FROM_PROMPT_SCHEMA,
  SYNTHESIZE_FROM_PROMPT_SYSTEM,
} from "@/lib/synergy/strategy-from-prompt-prompts";
import {
  STRATEGY_GENERATE_SCHEMA,
  STRATEGY_GENERATE_SYSTEM,
} from "@/lib/synergy/strategy-prompts";
import {
  EXTRACT_COMPONENTS_SCHEMA,
  EXTRACT_COMPONENTS_SYSTEM,
} from "@/lib/synergy/process-prompts";

export const maxDuration = 120;

interface Body {
  prompt?: unknown;
}

interface SynthesizedBoard {
  objective_statement: string;
  objective_constraints: string[];
  objective_success_criteria: string[];
  core_concept: string;
  branches: Array<{ label: string; rationale: string }>;
  plan_goal: string;
  plan_steps: Array<{ label: string; rationale: string }>;
  plan_resources: string[];
  plan_success_criteria: string[];
  plan_risks: Array<{ risk: string; mitigation: string }>;
}

interface ExtractedComponents {
  core_ideas: Array<{
    label_public: string;
    description_public: string;
    description_private: string;
  }>;
  upstream: Array<{
    label_public: string;
    description_public: string;
    description_private: string;
    subkind: string;
  }>;
  downstream: Array<{
    label_public: string;
    description_public: string;
    description_private: string;
    subkind: string;
  }>;
  polished_products: Array<{
    label_public: string;
    description_public: string;
    description_private: string;
  }>;
}

interface GeneratedStrategy {
  statement: string;
  pitch: string;
  plan_steps: Array<{ title: string; detail: string }>;
  risks: Array<{
    severity: "high" | "medium" | "low";
    title: string;
    detail: string;
    mitigation: string;
  }>;
  hypotheses: Array<{ claim: string; rationale: string }>;
}

const PLAN_META_PREFIX = "<<plan-v1>>";

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 10) {
    return NextResponse.json(
      { error: "Prompt must be at least 10 characters" },
      { status: 400 },
    );
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { error: "Prompt too long (max 2000 chars)" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Stage 1: synthesize the converged brainstorm ──
  let synth: SynthesizedBoard;
  try {
    synth = await llmJSON<SynthesizedBoard>({
      system: SYNTHESIZE_FROM_PROMPT_SYSTEM,
      user: `User prompt:\n${prompt}`,
      maxTokens: 4096,
      temperature: 0.5,
      responseSchema: SYNTHESIZE_FROM_PROMPT_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[strategy-from-prompt] stage 1 error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Persist the synthesized brainstorm as a real session
  const { data: session, error: sessionErr } = await db
    .from("brainstorm_sessions")
    .insert({
      owner_id: user.id,
      title: synth.core_concept.slice(0, 200),
      objective_statement: synth.objective_statement.slice(0, 400),
      objective_constraints: synth.objective_constraints
        .map((c) => c.slice(0, 400))
        .slice(0, 10),
      objective_success_criteria: synth.objective_success_criteria
        .map((c) => c.slice(0, 400))
        .slice(0, 10),
      state: "processed",
    })
    .select("id")
    .single();
  if (sessionErr || !session) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(sessionErr) },
      { status: 500 },
    );
  }
  const sessionId = session.id as string;

  // Insert nodes: 1 core + N branches + 1 plan
  const corePayload = {
    session_id: sessionId,
    kind: "core" as const,
    label: synth.core_concept.slice(0, 1000),
    x: 600,
    y: 360,
  };
  const { data: coreRow, error: coreErr } = await db
    .from("brainstorm_nodes")
    .insert(corePayload)
    .select("id")
    .single();
  if (coreErr || !coreRow) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(coreErr) },
      { status: 500 },
    );
  }
  const coreId = coreRow.id as string;

  // Spiral-place the branches around the core
  const branchPayload = synth.branches.slice(0, 6).map((b, i) => {
    const angle = (i / Math.max(synth.branches.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 220;
    return {
      session_id: sessionId,
      parent_id: coreId,
      kind: "branch" as const,
      label: b.label.slice(0, 200),
      meta: b.rationale.slice(0, 800),
      x: 600 + Math.cos(angle) * r,
      y: 360 + Math.sin(angle) * r,
    };
  });
  if (branchPayload.length > 0) {
    await db.from("brainstorm_nodes").insert(branchPayload);
  }

  // The PLAN node — the canonical converged artifact that downstream
  // extract + strategy-gen treat as authoritative via plan-meta.ts
  const planMeta = {
    goal: synth.plan_goal.slice(0, 400),
    steps: synth.plan_steps.slice(0, 6).map((s) => ({
      label: s.label.slice(0, 200),
      rationale: s.rationale.slice(0, 600),
    })),
    resources: synth.plan_resources.slice(0, 8).map((r) => r.slice(0, 200)),
    success_criteria: synth.plan_success_criteria
      .slice(0, 8)
      .map((c) => c.slice(0, 200)),
    risks: synth.plan_risks.slice(0, 6).map((r) => ({
      risk: r.risk.slice(0, 400),
      mitigation: r.mitigation.slice(0, 400),
    })),
  };
  const planPayload = {
    session_id: sessionId,
    parent_id: coreId,
    kind: "plan" as const,
    label: synth.plan_goal.slice(0, 200),
    meta: `${PLAN_META_PREFIX}${JSON.stringify(planMeta)}`,
    x: 600,
    y: 360 + 320, // below the core
  };
  await db.from("brainstorm_nodes").insert(planPayload);

  // ── Stage 2: extract components ──
  // Builds the same userMsg shape as /extract — and since the plan
  // node is present, the prompt's plan-authoritative directives drive
  // the bucketing automatically.
  const planContextBlock = `\n\nAUTHORITATIVE PLAN (synthesized from prompt — treat as canonical):
Plan #1 (from "${synth.plan_goal.slice(0, 100)}"):
  Goal: ${planMeta.goal}
  Steps:
${planMeta.steps.map((s, i) => `    ${i + 1}. ${s.label}`).join("\n")}
  Resources:
    - ${planMeta.resources.join("\n    - ")}
  Success criteria:
    - ${planMeta.success_criteria.join("\n    - ")}`;

  const boardSummary = [
    `[core] ${synth.core_concept}`,
    ...synth.branches
      .slice(0, 6)
      .map((b) => `[branch] ${b.label} — ${b.rationale}`),
  ].join("\n");

  const extractUserMsg = `Brainstorm title: ${synth.core_concept}

Objective: ${synth.objective_statement}
Constraints: ${synth.objective_constraints.join("; ") || "none"}
Success criteria: ${synth.objective_success_criteria.join("; ") || "none"}${planContextBlock}

Board contents (non-plan nodes):
${boardSummary}`;

  let extracted: ExtractedComponents;
  try {
    extracted = await llmJSON<ExtractedComponents>({
      system: EXTRACT_COMPONENTS_SYSTEM,
      user: extractUserMsg,
      maxTokens: 4096,
      temperature: 0.4,
      responseSchema: EXTRACT_COMPONENTS_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.error("[strategy-from-prompt] stage 2 error:", err);
    return NextResponse.json(
      {
        error: sanitizeErrorMessage(err),
        partial: { session_id: sessionId },
        stage_failed: "extract",
      },
      { status: 500 },
    );
  }

  // Flatten + embed + persist
  interface FlatComponent {
    kind: "core_idea" | "upstream" | "downstream" | "polished_product";
    subkind: string | null;
    label_public: string;
    description_public: string;
    description_private: string;
  }
  const flat: FlatComponent[] = [
    ...(extracted.core_ideas ?? []).map((c) => ({
      kind: "core_idea" as const,
      subkind: null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.upstream ?? []).map((c) => ({
      kind: "upstream" as const,
      subkind: c.subkind ?? null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.downstream ?? []).map((c) => ({
      kind: "downstream" as const,
      subkind: c.subkind ?? null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
    ...(extracted.polished_products ?? []).map((c) => ({
      kind: "polished_product" as const,
      subkind: null,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
    })),
  ]
    .map((c) => ({
      ...c,
      label_public: c.label_public.trim().slice(0, 200),
      description_public: c.description_public.trim().slice(0, 800),
      description_private: c.description_private.trim().slice(0, 2000),
    }))
    .filter((c) => c.label_public.length > 0);

  let embeddings: number[][] = [];
  if (flat.length > 0) {
    try {
      embeddings = await embedTexts(
        flat.map((c) => `${c.label_public}. ${c.description_public}`),
      );
    } catch {
      // Soft-fail; persist without embeddings (matcher backfills later)
    }
  }

  if (flat.length > 0) {
    const componentsPayload = flat.map((c, i) => ({
      owner_id: user.id,
      session_id: sessionId,
      kind: c.kind,
      subkind: c.subkind,
      label_public: c.label_public,
      description_public: c.description_public,
      description_private: c.description_private,
      embedding: embeddings[i] ?? null,
      visibility: "matchable_only",
    }));
    await db.from("brainstorm_components").insert(componentsPayload);
  }

  // ── Stage 3: generate strategy doc ──
  const authoritativePlanBlock = `AUTHORITATIVE PLANS (synthesized — defer to these):
Plan #1 (from node "${synth.core_concept.slice(0, 80)}"):
  Goal: ${planMeta.goal}
  Steps:
${planMeta.steps.map((s, i) => `    ${i + 1}. ${s.label} — ${s.rationale}`).join("\n")}
  Resources needed:
    - ${planMeta.resources.join("\n    - ")}
  Success criteria:
    - ${planMeta.success_criteria.join("\n    - ")}
  User-acknowledged risks:
    - ${planMeta.risks
      .map((r) => `${r.risk} (mitigation: ${r.mitigation})`)
      .join("\n    - ")}`;

  const componentBlock = flat.length
    ? "EXTRACTED COMPONENTS:\n" +
      flat
        .map(
          (c) =>
            `- [${c.kind}${c.subkind ? ":" + c.subkind : ""}] ${c.label_public} — ${c.description_public}`,
        )
        .join("\n")
    : "(no components extracted yet)";

  const strategyUserMsg = `Brainstorm title: ${synth.core_concept}

OBJECTIVE: ${synth.objective_statement}
CONSTRAINTS: ${synth.objective_constraints.join("; ") || "none"}
SUCCESS CRITERIA: ${synth.objective_success_criteria.join("; ") || "none"}

${authoritativePlanBlock}

${componentBlock}

BOARD CONTEXT (other non-plan nodes for context only):
${boardSummary}`;

  let strategyGen: GeneratedStrategy;
  try {
    strategyGen = await llmJSON<GeneratedStrategy>({
      system: STRATEGY_GENERATE_SYSTEM,
      user: strategyUserMsg,
      maxTokens: 4096,
      temperature: 0.4,
      responseSchema: STRATEGY_GENERATE_SCHEMA as {
        name: string;
        schema: Record<string, unknown>;
      },
    });
  } catch (err) {
    console.error("[strategy-from-prompt] stage 3 error:", err);
    return NextResponse.json(
      {
        error: sanitizeErrorMessage(err),
        partial: { session_id: sessionId },
        stage_failed: "strategy",
      },
      { status: 500 },
    );
  }

  // Persist strategy + blocks (mirrors /strategy/generate endpoint)
  const generationId = crypto.randomUUID();
  const { data: strategyRow, error: strategyErr } = await db
    .from("synergy_strategies")
    .insert({
      session_id: sessionId,
      statement: strategyGen.statement.trim().slice(0, 400),
      pitch: strategyGen.pitch.trim().slice(0, 600),
      current_generation_id: generationId,
    })
    .select("id")
    .single();
  if (strategyErr || !strategyRow) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(strategyErr) },
      { status: 500 },
    );
  }
  const strategyId = strategyRow.id as string;

  interface BlockInsert {
    strategy_id: string;
    generation_id: string;
    block_type: "plan_step" | "risk" | "hypothesis";
    body: string;
    sort_order: number;
    meta: Record<string, unknown>;
  }
  const blocks: BlockInsert[] = [];
  let sortOrder = 0;
  for (const step of strategyGen.plan_steps ?? []) {
    blocks.push({
      strategy_id: strategyId,
      generation_id: generationId,
      block_type: "plan_step",
      body: step.detail.trim().slice(0, 1200),
      sort_order: sortOrder++,
      meta: { title: step.title.trim().slice(0, 160) },
    });
  }
  for (const r of strategyGen.risks ?? []) {
    blocks.push({
      strategy_id: strategyId,
      generation_id: generationId,
      block_type: "risk",
      body: r.detail.trim().slice(0, 800),
      sort_order: sortOrder++,
      meta: {
        title: r.title.trim().slice(0, 160),
        severity: r.severity,
        mitigation: r.mitigation.trim().slice(0, 800),
      },
    });
  }
  for (const h of strategyGen.hypotheses ?? []) {
    blocks.push({
      strategy_id: strategyId,
      generation_id: generationId,
      block_type: "hypothesis",
      body: h.claim.trim().slice(0, 800),
      sort_order: sortOrder++,
      meta: { rationale: h.rationale.trim().slice(0, 800) },
    });
  }
  if (blocks.length > 0) {
    await db.from("synergy_strategy_blocks").insert(blocks);
  }

  return NextResponse.json({
    session_id: sessionId,
    strategy_id: strategyId,
    components_count: flat.length,
  });
}
