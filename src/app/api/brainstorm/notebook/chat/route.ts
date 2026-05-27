// ── POST /api/brainstorm/notebook/chat ────────────────────────────
//
// Phase 10c — the chat agent endpoint. Takes one user turn, loads
// context + thread history, asks the LLM, optionally executes a
// server-side tool, persists the assistant (and possibly tool) row,
// and returns the new messages to the client.
//
// Body: { spaceId, subObjectiveId?, content }
//   spaceId        — required. Scope of the chat thread.
//   subObjectiveId — optional. null → canvas-level thread for the space.
//   content        — required. The user's message text.
//
// Returns: { messages: NotebookMessage[] } — the rows newly inserted
// during this turn (1 user + 1 assistant + optionally 1 tool result).
//
// Tool execution per lock-in L7:
//   server-executed: set_variation_disposition, set_constraints,
//                    set_finding_disposition
//   client-executed (returned as suggested): score_feature,
//                    refine_feature, research_item
//
// Hard wall — agent CANNOT fire: approve_bet, compose, room/generate,
// sub-objectives/confirm, sub-objectives/add, branch-from-concept,
// regenerate. The structured-output schema's enum + the post-parse
// validation both block these.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  AGENT_REPLY_SCHEMA,
  ALLOWED_TOOLS,
  CLIENT_TOOLS,
  SERVER_TOOLS,
  buildSystemPrompt,
  loadChatContext,
  type AgentReply,
  type AgentToolAction,
  type AgentToolResult,
  type NotebookMessage,
  type ServerToolName,
} from "@/lib/objective-canvas/notebook-chat";
import {
  logDecision,
  type DecisionAction,
} from "@/lib/objective-canvas/decision-log";
import type {
  CrossRoomAnalysisState,
  FindingDisposition,
} from "@/lib/objective-canvas/analyses/types";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import {
  readConstraints,
  type OperationalConstraints,
  type TimeHorizon,
  type BudgetTier,
  type TeamSize,
  type RiskTolerance,
} from "@/lib/objective-canvas/constraints";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  spaceId?: string;
  subObjectiveId?: string | null;
  content?: string;
}

const MAX_CONTENT = 4000;

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const subObjectiveId =
    typeof body?.subObjectiveId === "string" && body.subObjectiveId.length > 0
      ? body.subObjectiveId
      : null;
  const content =
    typeof body?.content === "string" ? body.content.trim().slice(0, MAX_CONTENT) : "";

  if (!spaceId || !content) {
    return NextResponse.json(
      { error: "spaceId + content required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership: ensure the space belongs to the user.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── 1. Load context ──
  const ctx = await loadChatContext(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
  });

  // ── 2. Insert the user message ──
  const userInsertRes = await db
    .from("notebook_messages")
    .insert({
      user_id: auth.user.id,
      space_id: spaceId,
      sub_objective_id: subObjectiveId,
      role: "user",
      content,
    })
    .select("id, role, content, tool_call, tool_result, parent_message_id, created_at")
    .single();
  if (userInsertRes.error || !userInsertRes.data) {
    return NextResponse.json(
      {
        error: "failed to persist user message",
        detail: userInsertRes.error?.message ?? "no data",
      },
      { status: 500 },
    );
  }
  const userMessage = userInsertRes.data as NotebookMessage;

  // ── 3. Build the LLM call ──
  const systemPrompt = buildSystemPrompt(ctx);
  // Format the thread history so the agent can see WHAT it called +
  // WHAT came back, not just a generic "ok/failed" line. Without the
  // args + result data the agent forgets what it just changed and
  // can't say "I marked variation X as elected" on the next turn.
  const historyBlock = ctx.recent_messages
    .map((m) => {
      if (m.role === "user") return `User: ${m.content ?? ""}`;
      if (m.role === "assistant") {
        if (m.tool_call) {
          // Stringify args compactly so the LLM can see exactly what
          // entityId / variationId / disposition the previous turn
          // requested. Clip to keep history token cost bounded.
          const argsStr = JSON.stringify(m.tool_call.args ?? {}).slice(0, 240);
          const statusTag =
            m.tool_call.status === "suggested" ? "suggested" : "executed";
          return `Assistant: ${m.content ?? ""}\n  [tool ${statusTag}: ${m.tool_call.tool_name}(${argsStr})]`;
        }
        return `Assistant: ${m.content ?? ""}`;
      }
      // role === "tool" — include the data payload so the agent can
      // reference what concretely changed (variation_name, disposition,
      // constraints summary, etc.). Bounded at 240 chars per row.
      const r = m.tool_result;
      if (!r) return "Tool result: (empty)";
      if (!r.ok) {
        return `Tool result: failed${r.error ? ` — ${r.error}` : ""}`;
      }
      const dataStr = r.data
        ? JSON.stringify(r.data).slice(0, 240)
        : "(no data)";
      return `Tool result: ok — ${dataStr}`;
    })
    .join("\n");
  const userPrompt = `${historyBlock ? historyBlock + "\n\n" : ""}User: ${content}`;

  let reply: AgentReply;
  try {
    reply = await llmJSON<AgentReply>({
      system: systemPrompt,
      user: userPrompt,
      responseSchema: AGENT_REPLY_SCHEMA,
      temperature: 0.4,
      maxTokens: 1500,
    });
  } catch (err) {
    // Soft-fail: the user message is already persisted; insert an
    // assistant turn that reports the error so the thread stays
    // coherent on the next reload.
    const errMsg = err instanceof Error ? err.message : "LLM call failed";
    const assistantRes = await db
      .from("notebook_messages")
      .insert({
        user_id: auth.user.id,
        space_id: spaceId,
        sub_objective_id: subObjectiveId,
        role: "assistant",
        content: `Sorry — I couldn't respond just now. (${errMsg.slice(0, 200)})`,
        parent_message_id: userMessage.id,
      })
      .select(
        "id, role, content, tool_call, tool_result, parent_message_id, created_at",
      )
      .single();
    return NextResponse.json({
      messages: [
        userMessage,
        ...(assistantRes.data ? [assistantRes.data as NotebookMessage] : []),
      ],
    });
  }

  // ── 4. Validate + dispatch tool action ──
  let toolAction: AgentToolAction | null = null;
  let toolResult: AgentToolResult | null = null;
  if (reply.tool_action && reply.tool_action.tool_name) {
    const name = reply.tool_action.tool_name;
    if (!(ALLOWED_TOOLS as readonly string[]).includes(name)) {
      // Hard wall — the agent tried to fire a denied tool. Drop it
      // silently and tack a note onto the text reply.
      reply = {
        ...reply,
        text:
          reply.text +
          `\n\n(Internal: I tried to call ${name}, but that's not in my allowed toolset.)`,
        tool_action: null,
      };
    } else if ((SERVER_TOOLS as readonly string[]).includes(name)) {
      // Execute server-side.
      const exec = await executeServerTool({
        db,
        userId: auth.user.id,
        spaceId,
        subObjectiveId,
        toolName: name as ServerToolName,
        args: reply.tool_action.args ?? {},
      });
      toolResult = exec.result;
      toolAction = {
        tool_name: name,
        args: reply.tool_action.args ?? {},
        label: reply.tool_action.label ?? undefined,
        status: "executed",
      };
    } else if ((CLIENT_TOOLS as readonly string[]).includes(name)) {
      // Suggested — client fires the actual route.
      toolAction = {
        tool_name: name,
        args: reply.tool_action.args ?? {},
        label: reply.tool_action.label ?? undefined,
        status: "suggested",
      };
    }
  }

  // ── 5. Persist assistant turn + optional tool result row ──
  const assistantRes = await db
    .from("notebook_messages")
    .insert({
      user_id: auth.user.id,
      space_id: spaceId,
      sub_objective_id: subObjectiveId,
      role: "assistant",
      content: reply.text,
      tool_call: toolAction,
      parent_message_id: userMessage.id,
    })
    .select(
      "id, role, content, tool_call, tool_result, parent_message_id, created_at",
    )
    .single();
  if (assistantRes.error || !assistantRes.data) {
    return NextResponse.json(
      {
        error: "failed to persist assistant message",
        detail: assistantRes.error?.message ?? "no data",
      },
      { status: 500 },
    );
  }
  const assistantMessage = assistantRes.data as NotebookMessage;

  const newMessages: NotebookMessage[] = [userMessage, assistantMessage];

  if (toolResult) {
    const toolRowRes = await db
      .from("notebook_messages")
      .insert({
        user_id: auth.user.id,
        space_id: spaceId,
        sub_objective_id: subObjectiveId,
        role: "tool",
        content: null,
        tool_result: toolResult,
        parent_message_id: assistantMessage.id,
      })
      .select(
        "id, role, content, tool_call, tool_result, parent_message_id, created_at",
      )
      .single();
    if (toolRowRes.data) {
      newMessages.push(toolRowRes.data as NotebookMessage);
    }
  }

  return NextResponse.json({ messages: newMessages });
}

// ── Server-side tool dispatch ─────────────────────────────────────

interface ExecArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  spaceId: string;
  subObjectiveId: string | null;
  toolName: ServerToolName;
  args: Record<string, unknown>;
}

async function executeServerTool(
  ex: ExecArgs,
): Promise<{ result: AgentToolResult }> {
  try {
    switch (ex.toolName) {
      case "set_variation_disposition":
        return { result: await execSetVariationDisposition(ex) };
      case "set_constraints":
        return { result: await execSetConstraints(ex) };
      case "set_finding_disposition":
        return { result: await execSetFindingDisposition(ex) };
      default:
        return {
          result: { ok: false, error: `unknown tool: ${ex.toolName}` },
        };
    }
  } catch (err) {
    return {
      result: {
        ok: false,
        error: err instanceof Error ? err.message : "tool execution failed",
      },
    };
  }
}

// ── set_variation_disposition ────────────────────────────────────

const VALID_DISPOSITIONS = new Set([
  "elected",
  "rejected",
  "deferred",
  "clear",
]);

async function execSetVariationDisposition(ex: ExecArgs): Promise<AgentToolResult> {
  const entityId =
    typeof ex.args.entityId === "string" ? ex.args.entityId : "";
  const variationId =
    typeof ex.args.variationId === "string" ? ex.args.variationId : "";
  const dispositionRaw =
    typeof ex.args.disposition === "string" ? ex.args.disposition : "";
  if (!entityId || !variationId || !VALID_DISPOSITIONS.has(dispositionRaw)) {
    return {
      ok: false,
      error: "entityId, variationId, and valid disposition required",
    };
  }
  const newDisposition =
    dispositionRaw === "clear" ? null : (dispositionRaw as "elected" | "rejected" | "deferred");

  const { data: entity } = await ex.db
    .from("entities")
    .select("id, space_id, parent_sub_objective_id, name, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity || entity.space_id !== ex.spaceId) {
    return { ok: false, error: "entity not found in this space" };
  }
  const detail = (entity.expanded_detail as ExpandedItemDetail | null) ?? null;
  if (!detail || !Array.isArray(detail.variations)) {
    return { ok: false, error: "entity has no variations to dispose" };
  }
  let priorDisposition: string | null = null;
  let variationName: string | null = null;
  let found = false;
  const nextVariations = detail.variations.map((v) => {
    if (v.id !== variationId) return v;
    found = true;
    priorDisposition = (v.disposition ?? null) as string | null;
    variationName = typeof v.name === "string" ? v.name : null;
    return { ...v, disposition: newDisposition };
  });
  if (!found) {
    return { ok: false, error: "variation not found on this entity" };
  }
  const nextDetail = {
    ...detail,
    variations: nextVariations,
    // Invalidate composed_design when election set may have changed —
    // mirrors the disposition route's behavior.
    ...(priorDisposition === "elected" || newDisposition === "elected"
      ? { composed_design: null }
      : {}),
  };
  const writeRes = await ex.db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return { ok: false, error: writeRes.error.message };
  }

  // Log per dispositional action.
  const action: DecisionAction =
    newDisposition === null
      ? "clear"
      : newDisposition === "elected"
        ? "elect"
        : newDisposition === "rejected"
          ? "reject"
          : "defer";
  void logDecision(ex.db, {
    userId: ex.userId,
    spaceId: ex.spaceId,
    subObjectiveId:
      typeof entity.parent_sub_objective_id === "string"
        ? entity.parent_sub_objective_id
        : ex.subObjectiveId,
    proposalId: variationId,
    action,
    metadata: {
      entity_type: "variation",
      entity_id: entityId,
      entity_name: typeof entity.name === "string" ? entity.name : null,
      variation_name: variationName,
      prior_disposition: priorDisposition,
      via: "chat_agent",
    },
  });

  return {
    ok: true,
    data: {
      entity_id: entityId,
      variation_id: variationId,
      variation_name: variationName,
      disposition: newDisposition,
    },
  };
}

// ── set_constraints ──────────────────────────────────────────────

const TIME_HORIZONS = new Set<TimeHorizon>([
  "days",
  "weeks",
  "months",
  "quarter",
  "year_plus",
]);
const BUDGET_TIERS = new Set<BudgetTier>([
  "zero",
  "low",
  "moderate",
  "substantial",
]);
const TEAM_SIZES = new Set<TeamSize>(["solo", "small", "medium", "large"]);
const RISK_TOLERANCES = new Set<RiskTolerance>([
  "experimental",
  "calibrated",
  "conservative",
]);

async function execSetConstraints(ex: ExecArgs): Promise<AgentToolResult> {
  const args = ex.args as {
    time_horizon?: string;
    budget_tier?: string;
    team_size?: string;
    risk_tolerance?: string;
    compliance_requirements?: unknown;
  };

  const { data: spaceRow } = await ex.db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", ex.spaceId)
    .maybeSingle();
  const existing = readConstraints(spaceRow?.synthesis_data) ?? {
    time_horizon: "months" as TimeHorizon,
    budget_tier: "low" as BudgetTier,
    team_size: "solo" as TeamSize,
    risk_tolerance: "calibrated" as RiskTolerance,
    compliance_requirements: [],
    source: "inferred" as const,
    generated_at: new Date().toISOString(),
  };

  const next: OperationalConstraints = {
    ...existing,
    ...(args.time_horizon && TIME_HORIZONS.has(args.time_horizon as TimeHorizon)
      ? { time_horizon: args.time_horizon as TimeHorizon }
      : {}),
    ...(args.budget_tier && BUDGET_TIERS.has(args.budget_tier as BudgetTier)
      ? { budget_tier: args.budget_tier as BudgetTier }
      : {}),
    ...(args.team_size && TEAM_SIZES.has(args.team_size as TeamSize)
      ? { team_size: args.team_size as TeamSize }
      : {}),
    ...(args.risk_tolerance && RISK_TOLERANCES.has(args.risk_tolerance as RiskTolerance)
      ? { risk_tolerance: args.risk_tolerance as RiskTolerance }
      : {}),
    ...(Array.isArray(args.compliance_requirements)
      ? {
          compliance_requirements: args.compliance_requirements
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, 80))
            .slice(0, 6),
        }
      : {}),
    source: "user",
    generated_at: new Date().toISOString(),
  };

  const nextSynth = {
    ...((spaceRow?.synthesis_data as Record<string, unknown>) ?? {}),
    constraints: next,
  };
  const writeRes = await ex.db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", ex.spaceId);
  if (writeRes.error) {
    return { ok: false, error: writeRes.error.message };
  }

  const summaryParts: string[] = [];
  if (next.time_horizon) summaryParts.push(`time=${next.time_horizon}`);
  if (next.budget_tier) summaryParts.push(`budget=${next.budget_tier}`);
  if (next.team_size) summaryParts.push(`team=${next.team_size}`);
  if (next.risk_tolerance) summaryParts.push(`risk=${next.risk_tolerance}`);
  void logDecision(ex.db, {
    userId: ex.userId,
    spaceId: ex.spaceId,
    subObjectiveId: null,
    action: "constraints_set",
    metadata: {
      constraints_summary: summaryParts.join(", "),
      time_horizon: next.time_horizon,
      budget_tier: next.budget_tier,
      team_size: next.team_size,
      risk_tolerance: next.risk_tolerance,
      compliance_count: next.compliance_requirements?.length ?? 0,
      via: "chat_agent",
    },
  });

  return { ok: true, data: { constraints: next } };
}

// ── set_finding_disposition ──────────────────────────────────────

const FINDING_DISPOSITIONS = new Set<FindingDisposition>([
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
]);

async function execSetFindingDisposition(ex: ExecArgs): Promise<AgentToolResult> {
  const findingId =
    typeof ex.args.findingId === "string" ? ex.args.findingId : "";
  const dispositionRaw =
    typeof ex.args.disposition === "string" ? ex.args.disposition : "";
  if (!findingId || !FINDING_DISPOSITIONS.has(dispositionRaw as FindingDisposition)) {
    return {
      ok: false,
      error: "findingId and valid disposition required",
    };
  }
  const disposition = dispositionRaw as FindingDisposition;

  const { data: spaceRow } = await ex.db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", ex.spaceId)
    .maybeSingle();
  const cached: CrossRoomAnalysisState | null =
    (spaceRow?.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  if (!cached || !Array.isArray(cached.findings)) {
    return { ok: false, error: "no cross-room analysis on this space yet" };
  }
  const idx = cached.findings.findIndex((f) => f.id === findingId);
  if (idx < 0) {
    return { ok: false, error: "finding not found" };
  }
  const finding = cached.findings[idx];
  const next: CrossRoomAnalysisState = {
    ...cached,
    findings: cached.findings.map((f, i) =>
      i === idx ? { ...f, disposition } : f,
    ),
  };
  const nextSynth = {
    ...((spaceRow?.synthesis_data as Record<string, unknown>) ?? {}),
    cross_room_analysis: next,
  };
  const writeRes = await ex.db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", ex.spaceId);
  if (writeRes.error) {
    return { ok: false, error: writeRes.error.message };
  }

  if (disposition !== "open") {
    const actionByDisposition: Record<FindingDisposition, DecisionAction | null> = {
      open: null,
      acknowledged: "finding_acknowledged",
      resolved: "finding_resolved",
      dismissed: "finding_dismissed",
    };
    const action = actionByDisposition[disposition];
    if (action) {
      void logDecision(ex.db, {
        userId: ex.userId,
        spaceId: ex.spaceId,
        subObjectiveId: null,
        action,
        metadata: {
          finding_id: finding.id,
          finding_title: finding.title,
          finding_category: finding.category,
          finding_severity: finding.severity,
          analysis_key: finding.analysis_key,
          via: "chat_agent",
        },
      });
    }
  }

  return {
    ok: true,
    data: {
      finding_id: finding.id,
      finding_title: finding.title,
      disposition,
    },
  };
}
