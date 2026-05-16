// ── POST /api/synergy/sessions/[id]/strategy/generate ──
//
// One-shot generation of the strategy doc from the brainstorm session.
// Persists strategy + blocks under a fresh generation_id so prior
// generations remain in the DB for version history.
//
// Inputs: nothing in the body. We pull from
//   - brainstorm_sessions.title + objective fields
//   - brainstorm_nodes (whole board context)
//   - brainstorm_components (already extracted; their rows ARE the
//     upstream/downstream sections of the doc — no duplication)
//
// Body: ignored (POST with empty body is fine; placeholder for
// future "regenerate from a focus subset" calls).
//
// Response: { strategy, blocks }  — same shape as GET /strategy

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  STRATEGY_GENERATE_SCHEMA,
  STRATEGY_GENERATE_SYSTEM,
} from "@/lib/synergy/strategy-prompts";
import { collectAuthoritativePlans } from "@/lib/synergy/plan-meta";
import { inngest } from "@/inngest/client";

export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface GeneratedStrategy {
  statement: string;
  pitch: string;
  // ── Phase 1 LLM-tagged plan-step fields ──
  // Schema in strategy-prompts.ts marks these as required so the LLM
  // always produces them. The type system + UI tolerate missing fields
  // for backward-compat with strategies generated before Phase 1.
  plan_steps: Array<{
    title: string;
    detail: string;
    category:
      | "schedule"
      | "research"
      | "collaborate"
      | "build"
      | "publish"
      | "iterate"
      | "learn"
      | "other";
    duration_estimate: string;
    effort_level: "light" | "medium" | "heavy";
    first_action: string;
    depends_on: number[];
    success_signal: string;
  }>;
  risks: Array<{
    severity: "high" | "medium" | "low";
    title: string;
    detail: string;
    mitigation: string;
  }>;
  hypotheses: Array<{ claim: string; rationale: string }>;
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
}

interface DbComponent {
  id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load session + nodes + components in parallel. The session and
  // components reads are RLS-gated; an unauthorized user gets an empty
  // result here and the not-found check below catches it.
  const [sessionRes, nodesRes, componentsRes] = await Promise.all([
    db
      .from("brainstorm_sessions")
      .select(
        "id, title, objective_statement, objective_constraints, objective_success_criteria",
      )
      .eq("id", sessionId)
      .single(),
    db
      .from("brainstorm_nodes")
      .select("id, parent_id, kind, label, meta")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    db
      .from("brainstorm_components")
      .select("id, kind, subkind, label_public, description_public")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
  ]);

  if (sessionRes.error || !sessionRes.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const session = sessionRes.data as {
    id: string;
    title: string;
    objective_statement: string | null;
    objective_constraints: string[];
    objective_success_criteria: string[];
  };
  const nodes = (nodesRes.data ?? []) as DbNode[];
  const components = (componentsRes.data ?? []) as DbComponent[];

  if (nodes.length === 0 && !session.objective_statement) {
    return NextResponse.json(
      {
        error:
          "Nothing to generate from — add nodes or set an objective first",
      },
      { status: 409 },
    );
  }

  // Build the LLM context. Priority of signals:
  //   1. AUTHORITATIVE PLANS — user-converged "plan" kind nodes whose
  //      meta carries a structured PlanResult. These are the strongest
  //      signal: the user explicitly synthesized N branches into a
  //      single converged plan.
  //   2. Extracted components — already-distilled upstream/downstream
  //      typed rows from Phase 3.
  //   3. Objective — user's stated overarching goal.
  //   4. Raw board prose — fallback when none of the above are present.
  //
  // The system prompt is configured to defer to authoritative plans
  // (mirror their steps, include all their risks, etc.) rather than
  // re-invent the wheel.
  const authoritativePlans = collectAuthoritativePlans(nodes);

  const visible = nodes.filter((n) => n.kind !== "user");
  // Plan-kind nodes are surfaced separately in the AUTHORITATIVE PLANS
  // block, so we skip them in the board summary to avoid double-counting.
  const boardForSummary = visible.filter((n) => n.kind !== "plan");
  const boardSummary = boardForSummary
    .map((n) => {
      const parent = nodes.find((p) => p.id === n.parent_id);
      const parentHint = parent ? ` (under: ${parent.label})` : "";
      const metaHint = n.meta ? ` — ${n.meta.slice(0, 160)}` : "";
      return `[${n.kind}] ${n.label}${parentHint}${metaHint}`;
    })
    .join("\n");

  const authoritativePlanBlock = authoritativePlans.length
    ? "AUTHORITATIVE PLANS (user-converged synthesis artifacts — defer to these):\n" +
      authoritativePlans
        .map(({ source, plan }, idx) => {
          const stepsBlock = plan.steps
            .map((s, i) => `    ${i + 1}. ${s.label} — ${s.rationale}`)
            .join("\n");
          const resourcesBlock = plan.resources.length
            ? `\n  Resources needed:\n    - ${plan.resources.join("\n    - ")}`
            : "";
          const successBlock = plan.success_criteria.length
            ? `\n  Success criteria:\n    - ${plan.success_criteria.join("\n    - ")}`
            : "";
          const risksBlock = plan.risks.length
            ? `\n  User-acknowledged risks:\n    - ${plan.risks
                .map((r) => `${r.risk} (mitigation: ${r.mitigation})`)
                .join("\n    - ")}`
            : "";
          return `Plan #${idx + 1} (from node "${source.label}"):
  Goal: ${plan.goal}
  Steps:
${stepsBlock}${resourcesBlock}${successBlock}${risksBlock}`;
        })
        .join("\n\n")
    : "(no authoritative plans on board — generate freely from prose)";

  const componentBlock = components.length
    ? "EXTRACTED COMPONENTS:\n" +
      components
        .map(
          (c) =>
            `- [${c.kind}${c.subkind ? ":" + c.subkind : ""}] ${c.label_public} — ${c.description_public}`,
        )
        .join("\n")
    : "(no components extracted yet)";

  const objectiveBlock = session.objective_statement
    ? `OBJECTIVE: ${session.objective_statement}\nCONSTRAINTS: ${(session.objective_constraints ?? []).join("; ") || "none"}\nSUCCESS CRITERIA: ${(session.objective_success_criteria ?? []).join("; ") || "none"}`
    : "(no objective set)";

  const userMsg = `Brainstorm title: ${session.title}

${objectiveBlock}

${authoritativePlanBlock}

${componentBlock}

BOARD CONTEXT (other non-plan nodes for context only):
${boardSummary || "(empty)"}`;

  let generated: GeneratedStrategy;
  try {
    generated = await llmJSON<GeneratedStrategy>({
      system: STRATEGY_GENERATE_SYSTEM,
      user: userMsg,
      maxTokens: 4096,
      temperature: 0.4,
      responseSchema: STRATEGY_GENERATE_SCHEMA as {
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
    console.error("[/api/synergy/.../strategy/generate] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Upsert strategy row + bump generation_id.
  // crypto.randomUUID is available in the Node 19+ runtime Next uses.
  const generationId = crypto.randomUUID();

  // Replace-all under (strategy_id, generation_id) — old generations
  // stay in the DB but are filtered out of reads by current_generation_id.
  // 1. Upsert strategy
  const { data: existing } = await db
    .from("synergy_strategies")
    .select("id")
    .eq("session_id", sessionId)
    .single();

  let strategyId: string;
  if (existing?.id) {
    strategyId = existing.id;
    const { error: updateErr } = await db
      .from("synergy_strategies")
      .update({
        statement: generated.statement.trim().slice(0, 400),
        pitch: generated.pitch.trim().slice(0, 600),
        current_generation_id: generationId,
        status: "draft",
      })
      .eq("id", strategyId);
    if (updateErr) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(updateErr) },
        { status: 500 },
      );
    }
  } else {
    const { data: created, error: createErr } = await db
      .from("synergy_strategies")
      .insert({
        session_id: sessionId,
        statement: generated.statement.trim().slice(0, 400),
        pitch: generated.pitch.trim().slice(0, 600),
        current_generation_id: generationId,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(createErr) },
        { status: 500 },
      );
    }
    strategyId = created.id;
  }

  // 2. Build block payload
  interface BlockInsert {
    strategy_id: string;
    generation_id: string;
    block_type: "plan_step" | "risk" | "hypothesis";
    body: string;
    source_node_id?: string;
    sort_order: number;
    meta: Record<string, unknown>;
  }
  const blocks: BlockInsert[] = [];
  let sortOrder = 0;

  // Plan-step provenance attribution: when authoritative plans exist,
  // try to match each generated step back to its source plan node so
  // the doc's "Open on canvas" jumps to the right place. We use a
  // simple fuzzy match on the step title against the source plan's
  // step labels; if multiple plans, the first match wins. Mostly a
  // courtesy — generation faithfully mirrors plans per the prompt.
  const planSources = authoritativePlans.flatMap((p) =>
    p.plan.steps.map((s) => ({
      sourceNodeId: p.source.id,
      label: s.label.toLowerCase(),
    })),
  );
  const attributeStepToPlan = (title: string): string | undefined => {
    const lower = title.toLowerCase();
    // Exact match first
    const exact = planSources.find((s) => s.label === lower);
    if (exact) return exact.sourceNodeId;
    // Then substring fuzz
    const fuzzy = planSources.find(
      (s) => lower.includes(s.label) || s.label.includes(lower),
    );
    return fuzzy?.sourceNodeId;
  };

  for (const step of generated.plan_steps ?? []) {
    const title = step.title.trim().slice(0, 160);
    // ── Phase 1 LLM-tagged fields ──
    // Defensive trims/slices/filters: even with structured output, we
    // don't fully trust string lengths or array contents. We also keep
    // the new fields optional on the type so backward-compat readers
    // (older strategies in the DB) don't crash.
    const dependsOn = Array.isArray(step.depends_on)
      ? step.depends_on.filter(
          (n) => Number.isInteger(n) && n >= 0 && n < generated.plan_steps.length,
        )
      : [];
    blocks.push({
      strategy_id: strategyId,
      generation_id: generationId,
      block_type: "plan_step",
      body: step.detail.trim().slice(0, 1200),
      source_node_id: attributeStepToPlan(title),
      sort_order: sortOrder++,
      meta: {
        title,
        category: step.category,
        duration_estimate: step.duration_estimate?.trim().slice(0, 60),
        effort_level: step.effort_level,
        first_action: step.first_action?.trim().slice(0, 400),
        depends_on: dependsOn,
        success_signal: step.success_signal?.trim().slice(0, 400),
      },
    });
  }
  for (const r of generated.risks ?? []) {
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
  for (const h of generated.hypotheses ?? []) {
    blocks.push({
      strategy_id: strategyId,
      generation_id: generationId,
      block_type: "hypothesis",
      body: h.claim.trim().slice(0, 800),
      sort_order: sortOrder++,
      meta: { rationale: h.rationale.trim().slice(0, 800) },
    });
  }

  if (blocks.length === 0) {
    return NextResponse.json(
      { error: "AI returned no usable blocks" },
      { status: 502 },
    );
  }

  const { data: insertedBlocks, error: blocksErr } = await db
    .from("synergy_strategy_blocks")
    .insert(blocks)
    .select("id, block_type, body, sort_order, meta, created_at");
  if (blocksErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(blocksErr) },
      { status: 500 },
    );
  }

  // 2b. Fire-and-forget: notify the parallel-path matcher.
  //
  // The Inngest function "synergy/strategy.generated" embeds the new
  // strategy and runs the cross-user kNN + LLM rerank. We swallow
  // errors so a transient Inngest outage never blocks a user's
  // strategy publish — the worst case is a delayed parallel-path
  // discovery feed.
  try {
    await inngest.send({
      name: "synergy/strategy.generated",
      data: {
        strategyId,
        sessionId,
        userId: user.id,
      },
    });
  } catch (e) {
    console.warn(
      "[strategy/generate] inngest.send failed; matcher will not run for this strategy:",
      e,
    );
  }

  // 3. Return the freshly built doc
  const { data: strategyRow } = await db
    .from("synergy_strategies")
    .select(
      "id, session_id, statement, pitch, status, current_generation_id, created_at, updated_at",
    )
    .eq("id", strategyId)
    .single();

  return NextResponse.json({
    strategy: strategyRow,
    blocks: insertedBlocks ?? [],
    components,
  });
}
