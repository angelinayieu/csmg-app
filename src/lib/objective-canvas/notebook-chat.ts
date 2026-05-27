// ── Notebook chat — types + context loader + system prompt ───────
//
// Phase 10c — the agent layer behind the Lab Notebook's chat surface.
// Lives next to decision-log.ts (which records what happened) and
// notebook-events.ts (the wire shape for the timeline). This module
// owns the *talk to the canvas* model:
//
//   - NotebookMessage:   single row in notebook_messages
//   - NotebookThread:    a loaded conversation
//   - AgentToolAction:   tool the agent wants to execute. Two kinds:
//                          server  — light, executed in the chat route
//                          client  — heavy (score/refine/research),
//                                    rendered as a "Run this" button;
//                                    the UI fires the real route on
//                                    confirm
//   - buildSystemPrompt: composes the agent's role + tool catalog +
//                        boundary rules + context snapshot
//   - loadChatContext:   pulls the recent decision-log events and a
//                        compact state snapshot (entities + variations
//                        for room scope, sub-objective list for canvas
//                        scope)
//
// Boundary rules are HARD (per L7 lock-in):
//   ALLOWED — set_variation_disposition, set_constraints,
//             set_finding_disposition, score_feature, refine_feature,
//             research_item
//   DENIED  — approve_bet, compose, room/generate, sub-objective add,
//             confirm, branch-from-concept, regenerate.modes
// The agent's system prompt enforces these in language; the chat
// route validates the tool_name against ALLOWED_TOOLS before
// dispatching. Defence in depth.

import type {
  CrossRoomAnalysisState,
  FindingDisposition,
} from "./analyses/types";

// ── Row + thread shapes ───────────────────────────────────────────

export type NotebookMessageRole = "user" | "assistant" | "tool";

export interface NotebookMessage {
  id: string;
  role: NotebookMessageRole;
  content: string | null;
  tool_call: AgentToolAction | null;
  tool_result: AgentToolResult | null;
  parent_message_id: string | null;
  created_at: string;
}

export interface NotebookThread {
  messages: NotebookMessage[];
}

// ── Tool definitions ──────────────────────────────────────────────

/** Server-executed tools — light, synchronous Supabase writes + a
 *  decision-log row each. Their result lands as a paired tool row
 *  in the same chat turn so the agent can reference it next turn. */
export type ServerToolName =
  | "set_variation_disposition"
  | "set_constraints"
  | "set_finding_disposition";

/** Client-executed tools — heavy LLM work (score/refine/research)
 *  that would block the chat turn. Server emits these as
 *  status="suggested" tool calls; the UI renders a confirmation
 *  button and fires the real route when the user clicks. */
export type ClientToolName = "score_feature" | "refine_feature" | "research_item";

export type AgentToolName = ServerToolName | ClientToolName;

export const SERVER_TOOLS: ReadonlyArray<ServerToolName> = [
  "set_variation_disposition",
  "set_constraints",
  "set_finding_disposition",
];

export const CLIENT_TOOLS: ReadonlyArray<ClientToolName> = [
  "score_feature",
  "refine_feature",
  "research_item",
];

export const ALLOWED_TOOLS: ReadonlyArray<AgentToolName> = [
  ...SERVER_TOOLS,
  ...CLIENT_TOOLS,
];

/** A tool call the agent wants to make. `status` distinguishes
 *  ready-to-execute server tools from buttoned suggestions. */
export interface AgentToolAction {
  tool_name: AgentToolName;
  args: Record<string, unknown>;
  /** Display label for client-side tools — UI shows this on the
   *  button. Server tools can include it too for the post-execution
   *  receipt. */
  label?: string;
  status: "suggested" | "executed";
}

/** Stored result row payload for executed server tools. */
export interface AgentToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ── Agent response shape ──────────────────────────────────────────

/** What the LLM returns in the structured-output schema. */
export interface AgentReply {
  text: string;
  tool_action?: {
    tool_name: AgentToolName;
    args: Record<string, unknown>;
    label?: string;
  } | null;
}

export const AGENT_REPLY_SCHEMA = {
  name: "AgentReply",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
      tool_action: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["tool_name", "args"],
            properties: {
              tool_name: {
                type: "string",
                enum: ALLOWED_TOOLS as readonly string[],
              },
              args: { type: "object", additionalProperties: true },
              label: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
        ],
      },
    },
    required: ["text", "tool_action"],
  },
} as const;

// ── Context loader ────────────────────────────────────────────────

/** Compact decision-log row the agent sees in its context window.
 *  Trimmed to the fields the agent actually needs to reason about
 *  history — full enrichment lives on the timeline GET. */
interface ContextDecision {
  id: string;
  action: string;
  created_at: string;
  sub_objective_id: string | null;
  proposal_id: string | null;
  batch_intent: string | null;
  metadata: Record<string, unknown>;
}

/** Compact entity snapshot for room-scoped chat — gives the agent
 *  enough to refer to mechanisms by name + reason about variations. */
interface ContextEntity {
  id: string;
  name: string;
  layer: "pain" | "features" | "outcomes" | "objective" | "unknown";
  variation_count: number;
  elected_variation_ids: string[];
  has_composed_design: boolean;
  conflicts_open_count: number;
}

/** Compact sub-objective for canvas-scoped chat. */
interface ContextSubObjective {
  id: string;
  title: string;
  top_negative_outcome: string | null;
  room_generated: boolean;
}

export interface ChatContext {
  scope: "room" | "space";
  space_id: string;
  sub_objective_id: string | null;
  /** Title of the sub-objective when scope='room'; null otherwise. */
  sub_objective_title: string | null;
  objective_text: string;
  recent_decisions: ContextDecision[];
  /** Populated when scope='room'. */
  entities: ContextEntity[];
  /** Populated when scope='space'. */
  sub_objectives: ContextSubObjective[];
  open_findings: Array<{
    id: string;
    title: string;
    category: string;
    severity: string;
    disposition: FindingDisposition;
  }>;
  recent_messages: NotebookMessage[];
}

const MAX_DECISIONS = 30;
const MAX_MESSAGES = 10;

/** Load everything the agent needs to ground its next turn. Soft-
 *  fails on any individual fetch — the agent prefers a degraded
 *  reply ("I couldn't see the latest findings, but…") to a 500. */
export async function loadChatContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: {
    userId: string;
    spaceId: string;
    subObjectiveId: string | null;
  },
): Promise<ChatContext> {
  const scope: "room" | "space" = args.subObjectiveId ? "room" : "space";

  // ── Space + objective text ──
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, description, input_text, synthesis_data")
    .eq("id", args.spaceId)
    .maybeSingle();
  const objectiveText: string =
    (typeof spaceRow?.description === "string" && spaceRow.description.trim()) ||
    (typeof spaceRow?.input_text === "string" && spaceRow.input_text.trim()) ||
    "";

  // ── Sub-objective title for room scope ──
  let subObjectiveTitle: string | null = null;
  if (args.subObjectiveId) {
    const { data: sub } = await db
      .from("improvement_goals")
      .select("title")
      .eq("id", args.subObjectiveId)
      .maybeSingle();
    subObjectiveTitle = typeof sub?.title === "string" ? sub.title : null;
  }

  // ── Recent decisions (last 30, scoped) ──
  let decisionsQuery = db
    .from("sub_objective_decisions")
    .select(
      "id, action, created_at, sub_objective_id, proposal_id, batch_intent, metadata",
    )
    .eq("user_id", args.userId)
    .eq("space_id", args.spaceId)
    .order("created_at", { ascending: false })
    .limit(MAX_DECISIONS);
  if (args.subObjectiveId) {
    decisionsQuery = decisionsQuery.eq("sub_objective_id", args.subObjectiveId);
  }
  const { data: decisionRows } = await decisionsQuery;
  const recent_decisions = (
    (decisionRows ?? []) as Array<{
      id: string;
      action: string;
      created_at: string;
      sub_objective_id: string | null;
      proposal_id: string | null;
      batch_intent: string | null;
      metadata: Record<string, unknown> | null;
    }>
  ).map(
    (r): ContextDecision => ({
      id: r.id,
      action: r.action,
      created_at: r.created_at,
      sub_objective_id: r.sub_objective_id,
      proposal_id: r.proposal_id,
      batch_intent: r.batch_intent,
      metadata: r.metadata ?? {},
    }),
  );

  // ── Room entities (room scope) OR sub-objective list (space scope) ──
  let entities: ContextEntity[] = [];
  let sub_objectives: ContextSubObjective[] = [];
  if (scope === "room" && args.subObjectiveId) {
    const { data: entRows } = await db
      .from("entities")
      .select(
        "id, name, layer_ontology_id, expanded_detail",
      )
      .eq("parent_sub_objective_id", args.subObjectiveId);
    // Layer lookup is via layer_ontology id; do one batch resolve.
    const layerIds = new Set<string>();
    for (const r of (entRows ?? []) as Array<{ layer_ontology_id?: string }>) {
      if (r.layer_ontology_id) layerIds.add(r.layer_ontology_id);
    }
    const layerSlugById = new Map<string, ContextEntity["layer"]>();
    if (layerIds.size > 0) {
      const { data: layers } = await db
        .from("layer_ontology")
        .select("id, slug")
        .in("id", Array.from(layerIds));
      for (const l of (layers ?? []) as Array<{ id: string; slug: string }>) {
        const s = l.slug;
        layerSlugById.set(
          l.id,
          s === "pain" || s === "features" || s === "outcomes" || s === "objective"
            ? (s as ContextEntity["layer"])
            : "unknown",
        );
      }
    }
    entities = (entRows ?? []).map(
      (r: {
        id: string;
        name: string;
        layer_ontology_id?: string;
        expanded_detail: {
          variations?: Array<{ id?: string; disposition?: string | null }>;
          composed_design?: unknown;
        } | null;
      }): ContextEntity => {
        const detail = r.expanded_detail;
        const variations = Array.isArray(detail?.variations) ? detail!.variations : [];
        const elected = variations
          .filter((v) => v.disposition === "elected")
          .map((v) => (typeof v.id === "string" ? v.id : ""))
          .filter((s): s is string => s.length > 0);
        const composed = (detail?.composed_design ?? null) as {
          conflicts_open?: unknown;
        } | null;
        return {
          id: r.id,
          name: r.name,
          layer: r.layer_ontology_id
            ? layerSlugById.get(r.layer_ontology_id) ?? "unknown"
            : "unknown",
          variation_count: variations.length,
          elected_variation_ids: elected,
          has_composed_design: !!composed,
          conflicts_open_count: Array.isArray(composed?.conflicts_open)
            ? (composed!.conflicts_open as unknown[]).length
            : 0,
        };
      },
    );
  } else {
    // Space scope — load child sub-objectives.
    const { data: subRows } = await db
      .from("improvement_goals")
      .select("id, title, top_negative_outcome, room_layers_generated_at")
      .eq("space_id", args.spaceId)
      .not("parent_goal_id", "is", null);
    sub_objectives = ((subRows ?? []) as Array<{
      id: string;
      title: string;
      top_negative_outcome: string | null;
      room_layers_generated_at: string | null;
    }>).map(
      (r): ContextSubObjective => ({
        id: r.id,
        title: r.title,
        top_negative_outcome: r.top_negative_outcome,
        room_generated: !!r.room_layers_generated_at,
      }),
    );
  }

  // ── Open + acknowledged findings ──
  const cra =
    (spaceRow?.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;
  const open_findings: ChatContext["open_findings"] = cra?.findings
    ? cra.findings
        .filter(
          (f) =>
            f.disposition === "open" || f.disposition === "acknowledged",
        )
        .slice(0, 8)
        .map((f) => ({
          id: f.id,
          title: f.title,
          category: f.category,
          severity: f.severity,
          disposition: f.disposition,
        }))
    : [];

  // ── Last N messages in this thread ──
  let messagesQuery = db
    .from("notebook_messages")
    .select(
      "id, role, content, tool_call, tool_result, parent_message_id, created_at",
    )
    .eq("user_id", args.userId)
    .eq("space_id", args.spaceId)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  if (args.subObjectiveId) {
    messagesQuery = messagesQuery.eq("sub_objective_id", args.subObjectiveId);
  } else {
    messagesQuery = messagesQuery.is("sub_objective_id", null);
  }
  const { data: msgRows } = await messagesQuery;
  const recent_messages = (
    ((msgRows ?? []) as NotebookMessage[]).slice().reverse()
  );

  return {
    scope,
    space_id: args.spaceId,
    sub_objective_id: args.subObjectiveId,
    sub_objective_title: subObjectiveTitle,
    objective_text: objectiveText,
    recent_decisions,
    entities,
    sub_objectives,
    open_findings,
    recent_messages,
  };
}

// ── System prompt builder ─────────────────────────────────────────

/** Compose the LLM system prompt: agent role + hard boundary rules +
 *  the compact context snapshot. The model is told it can fire any
 *  ALLOWED_TOOLS verbs but MUST NOT attempt the denied ones. The
 *  schema-level enum also stops invalid tool_names at parse time,
 *  but this prompt + post-parse validation give defence in depth. */
export function buildSystemPrompt(ctx: ChatContext): string {
  const decisionsBlock = ctx.recent_decisions
    .slice(0, 20)
    .map((d) => {
      const meta = d.metadata ?? {};
      const fields: string[] = [`action=${d.action}`];
      if (d.proposal_id) fields.push(`proposal=${d.proposal_id.slice(0, 12)}`);
      if (typeof meta.entity_name === "string")
        fields.push(`entity=${meta.entity_name}`);
      if (typeof meta.variation_name === "string")
        fields.push(`variation=${meta.variation_name}`);
      if (typeof meta.lift_pct === "number")
        fields.push(`lift=${(meta.lift_pct * 100).toFixed(0)}%`);
      if (typeof meta.placebo_verdict === "string")
        fields.push(`placebo=${meta.placebo_verdict}`);
      return `  - ${d.created_at} :: ${fields.join(" ")}`;
    })
    .join("\n") || "  (no recent events)";

  const entitiesBlock =
    ctx.scope === "room" && ctx.entities.length > 0
      ? ctx.entities
          .map(
            (e) =>
              `  - ${e.id} (${e.layer}) "${e.name}" :: ${e.variation_count} variations, ${e.elected_variation_ids.length} elected${e.has_composed_design ? `, composed${e.conflicts_open_count > 0 ? ` (${e.conflicts_open_count} conflicts)` : ""}` : ""}`,
          )
          .join("\n")
      : "  (none — room hasn't been generated yet or scope is space)";

  const subsBlock =
    ctx.scope === "space" && ctx.sub_objectives.length > 0
      ? ctx.sub_objectives
          .map(
            (s) =>
              `  - ${s.id} "${s.title}"${s.room_generated ? " [room generated]" : ""}${s.top_negative_outcome ? ` :: counters: ${s.top_negative_outcome}` : ""}`,
          )
          .join("\n")
      : "  (no sub-objectives yet)";

  const findingsBlock =
    ctx.open_findings.length > 0
      ? ctx.open_findings
          .map(
            (f) =>
              `  - ${f.id} [${f.severity} ${f.category}] "${f.title}" (${f.disposition})`,
          )
          .join("\n")
      : "  (no open findings)";

  return `You are the Lab Notebook agent for an Objective Canvas — a workspace where the user explores a goal by decomposing it into sub-objective rooms (each containing pains, mechanisms/features, outcomes, and chains of approved bets).

You are scoped to the ${ctx.scope === "room" ? `ROOM "${ctx.sub_objective_title ?? "(unknown)"}"` : "WHOLE CANVAS (all rooms)"} for the space whose objective is:
"${ctx.objective_text.slice(0, 400)}"

# Your job
Help the user reason about what's happened in this workspace and what to do next. Answer questions about the timeline, current state, and trade-offs. When a clear next move emerges, you may fire a tool — but only the ones listed below. Default to text-only replies; only invoke tools when the user has expressed clear intent.

# Allowed tools
- set_variation_disposition(entityId, variationId, disposition: "elected"|"rejected"|"deferred"|"clear") — change a variation's disposition. Server-executed.
- set_constraints({ time_horizon?, budget_tier?, team_size?, risk_tolerance?, compliance_requirements? }) — overwrite space constraints. Server-executed.
- set_finding_disposition(findingId, disposition: "acknowledged"|"resolved"|"dismissed") — update a cross-room finding's state. Server-executed.
- score_feature(entityId) — kick off the Monte Carlo + placebo scorer on one feature. Suggests-button (user confirms).
- refine_feature(entityId) — kick off the R&D iteration loop on one feature. Suggests-button.
- research_item(entityId) — pull web research for one item. Suggests-button.

# Forbidden
NEVER attempt: approve_bet, compose, room/generate, sub-objectives/confirm, sub-objectives/add, branch-from-concept, regenerate. Those operations need the user's explicit click — you can suggest in text ("Want to approve that bet? Click the approve button on the chain card") but you must not fire them.

# Response shape
Return JSON conforming to AgentReply: { text: string, tool_action?: { tool_name, args, label? } | null }. Set tool_action to null when you're answering in text only.

# Recent decision events (newest first, scoped to ${ctx.scope})
${decisionsBlock}

# ${ctx.scope === "room" ? "Entities in this room" : "Sub-objective rooms"}
${ctx.scope === "room" ? entitiesBlock : subsBlock}

# Open / acknowledged cross-room findings
${findingsBlock}

Keep replies tight and concrete — 2-4 sentences unless the user asked for depth. Refer to entities by their names (not ids) when speaking. When you suggest a tool, use the entity id in args but the name in your text reply.`;
}
