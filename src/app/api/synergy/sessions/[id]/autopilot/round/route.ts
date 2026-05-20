// ── POST /api/synergy/sessions/[id]/autopilot/round ──
//
// One round of the autopilot loop. Performs one of N round kinds
// against the current board state. Each round is atomic on the
// server; the client (useAutopilot) orchestrates the multi-round
// sequence and handles cancellation by stopping the next call.
//
// Round kinds (Wave 1):
//   "variations" (default, legacy) — picks newest unexpanded leaf,
//      generates 4 variations under it
//   "decompose" (Wave 1 new) — picks newest unexpanded leaf, fires
//      decompose mode, persists 4 category-folder branch nodes
//      (upstream / downstream / first_principles / variations) in
//      a ring around the target. Item labels stored in meta.
//   "rank" (Wave 1 new) — finds a parent with 2+ variation children,
//      fires rank mode, persists a "ranking" summary node with the
//      scores in meta. Does NOT create new variations.
//
// Body: { precision?: 1-5, roundKind?: "variations" | "decompose" | "rank" }
// Response: { expanded: { id, label }, new_nodes: BrainstormNode[] }
//
// Errors:
//   400 if precision / roundKind invalid
//   404 if session not found / not owned
//   409 if no eligible target for the requested kind (signals "loop
//       done" to client; client moves to next sequence step or stops)
//   402 on provider credit exhaustion

import { NextResponse } from "next/server";
import { llmJSON, detectCreditError } from "@/lib/llm";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { schemaForMode, systemForMode } from "@/lib/synergy/prompts";

export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

type RoundKind = "variations" | "decompose" | "rank" | "converge";

interface Body {
  precision?: unknown;
  roundKind?: unknown;
}

interface DbNode {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
}

interface InsertedNode extends DbNode {
  session_id: string;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id: sessionId } = await ctx.params;
  const { supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  const precisionRaw = typeof body.precision === "number" ? body.precision : 3;
  const precision = Math.min(5, Math.max(1, Math.round(precisionRaw)));
  const roundKind: RoundKind =
    body.roundKind === "decompose" ||
    body.roundKind === "rank" ||
    body.roundKind === "converge"
      ? body.roundKind
      : "variations";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // RLS will block reads from a session the user doesn't own; we still
  // check explicitly so we can return 404 instead of an empty array.
  // Also pull clarifier_qa so we can inject the user's MCQ answers
  // as soft constraints into every round's LLM context. One read,
  // no extra LLM call. Null/missing clarifier_qa = no injection
  // (legacy sessions + sessions created without the modal).
  const { data: session } = await db
    .from("brainstorm_sessions")
    .select("id, clarifier_qa")
    .eq("id", sessionId)
    .single();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const clarifierContext = formatClarifierContext(session.clarifier_qa);

  const { data: nodeRows, error: nodesErr } = await db
    .from("brainstorm_nodes")
    .select("id, parent_id, kind, label, meta, x, y, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (nodesErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(nodesErr) },
      { status: 500 },
    );
  }
  const nodes = (nodeRows ?? []) as DbNode[];
  if (nodes.length === 0) {
    return NextResponse.json(
      { error: "Board is empty — add a core seed first" },
      { status: 409 },
    );
  }

  // Children count for eligibility check
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.parent_id) {
      childCount.set(n.parent_id, (childCount.get(n.parent_id) ?? 0) + 1);
    }
  }

  // ── Round dispatch ──
  // RANK runs against a parent that has 2+ variation children
  // (different target-selection than variations/decompose).
  // CONVERGE runs against the seed (kind="core") and reads ALL
  // descendants regardless of leaf-eligibility. The other two share
  // the "newest unexpanded leaf" target. The dispatch is a simple
  // branch — kept inline rather than extracted because each arm has
  // different post-processing + insert shape.

  if (roundKind === "rank") {
    return await runRankRound({
      db,
      sessionId,
      nodes,
      childCount,
      precision,
      clarifierContext,
    });
  }

  if (roundKind === "converge") {
    return await runConvergeRound({
      db,
      sessionId,
      nodes,
      precision,
      clarifierContext,
    });
  }

  // Eligible = leaf nodes that aren't transient speech (`user`) or a
  // ranking summary. Iterate newest-first so we pick the user's freshest
  // unexpanded thread.
  const eligible = nodes
    .slice()
    .reverse()
    .filter(
      (n) =>
        (childCount.get(n.id) ?? 0) === 0 &&
        n.kind !== "user" &&
        n.kind !== "ranking",
    );
  if (eligible.length === 0) {
    return NextResponse.json(
      { error: "Nothing left to expand — every node already has children" },
      { status: 409 },
    );
  }
  const target = eligible[0];

  if (roundKind === "decompose") {
    return await runDecomposeRound({
      db,
      sessionId,
      target,
      nodes,
      precision,
      clarifierContext,
    });
  }

  // ── Default: VARIATIONS (legacy behavior) ──
  // clarifierContext is appended to the user message (not the system
  // prompt) since it's session-specific data, not behavioral
  // instruction. Empty string when no MCQ data exists → no
  // behavior change for legacy sessions.
  const parentNode = target.parent_id
    ? nodes.find((n) => n.id === target.parent_id)
    : undefined;
  const baseUserMsg = parentNode
    ? `Existing context:\nparent: ${parentNode.label}\n\nNew thought:\n${target.label}`
    : target.label;
  const userMsg = clarifierContext
    ? `${baseUserMsg}\n\n${clarifierContext}`
    : baseUserMsg;
  const system = systemForMode("variations", precision);
  const schema = schemaForMode("variations");

  let parsed: { variations: Array<{ label: string; rationale: string }> };
  try {
    parsed = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 1500,
      temperature: 0.7,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/synergy/.../autopilot/round] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const variations = (parsed.variations ?? [])
    .map((v) => ({ label: v.label.trim(), rationale: v.rationale.trim() }))
    .filter((v) => v.label.length > 0)
    .slice(0, 4);
  if (variations.length === 0) {
    return NextResponse.json(
      { error: "AI returned no usable variations" },
      { status: 502 },
    );
  }

  // Lay out around the target using the same spiral math as placeNear
  // (without the ring offsets — a single ring of 4 is the typical case).
  const radius = 160;
  const payload = variations.map((v, i) => {
    const angle = (i / variations.length) * 2 * Math.PI - Math.PI / 2;
    const jitterX = (Math.random() - 0.5) * 30;
    const jitterY = (Math.random() - 0.5) * 30;
    return {
      session_id: sessionId,
      parent_id: target.id,
      kind: "variation" as const,
      label: v.label,
      meta: `[Lv ${precision}] ${v.rationale}` || null,
      x: target.x + Math.cos(angle) * radius + jitterX,
      y: target.y + Math.sin(angle) * radius + jitterY,
    };
  });

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_nodes")
    .insert(payload)
    .select("id, session_id, parent_id, kind, label, meta, x, y, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expanded: { id: target.id, label: target.label },
    new_nodes: (inserted ?? []) as InsertedNode[],
  });
}

// ── Decompose round handler (Wave 1.2) ──
// Fires the decompose augment mode against the target node. The mode
// returns 4 arrays (upstream / downstream / first_principles /
// variations). We persist one branch-kind folder node per non-empty
// category, ringing the target. Item-level children are flattened
// into the folder's meta as a newline-separated list — the user can
// expand each folder later (or the next autopilot round picks it up).
async function runDecomposeRound(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  sessionId: string;
  target: DbNode;
  nodes: DbNode[];
  precision: number;
  /** Pre-formatted user MCQ context to inject as soft constraints
   *  (variation_axis / target_metric / system_boundary / timeframe).
   *  Empty string when no MCQ data exists. */
  clarifierContext: string;
}) {
  const { db, sessionId, target, precision, clarifierContext } = args;
  const system = systemForMode("decompose", precision);
  const schema = schemaForMode("decompose");
  const userMsg = clarifierContext
    ? `${target.label}\n\n${clarifierContext}`
    : target.label;

  let parsed: {
    upstream: string[];
    downstream: string[];
    first_principles: string[];
    variations: string[];
  };
  try {
    parsed = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 1500,
      temperature: 0.6,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[autopilot/round decompose] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const categoryDefs: Array<{ label: string; items: string[] }> = [
    { label: "Upstream needs", items: parsed.upstream ?? [] },
    { label: "Downstream produces", items: parsed.downstream ?? [] },
    { label: "First principles", items: parsed.first_principles ?? [] },
    { label: "Variations", items: parsed.variations ?? [] },
  ].filter((c) => c.items.length > 0);

  if (categoryDefs.length === 0) {
    return NextResponse.json(
      { error: "Decompose returned no usable categories" },
      { status: 502 },
    );
  }

  // Ring layout — same pattern as variations spiral.
  const radius = 220; // slightly wider than variations so the two rings don't collide
  const payload = categoryDefs.map((cat, i) => {
    const angle = (i / categoryDefs.length) * 2 * Math.PI - Math.PI / 2;
    return {
      session_id: sessionId,
      parent_id: target.id,
      kind: "branch" as const,
      label: cat.label,
      meta: `Decomposed from "${target.label.slice(0, 60)}"\n${cat.items.map((it) => `· ${it}`).join("\n")}`,
      x: target.x + Math.cos(angle) * radius,
      y: target.y + Math.sin(angle) * radius,
    };
  });

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_nodes")
    .insert(payload)
    .select("id, session_id, parent_id, kind, label, meta, x, y, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expanded: { id: target.id, label: target.label },
    new_nodes: (inserted ?? []) as InsertedNode[],
  });
}

// ── Rank round handler (Wave 1.2) ──
// Finds a parent node with 2+ variation children, fires the rank
// augment mode, and persists a "ranking" summary node with the
// scored items as JSON in meta. Does NOT create new variation nodes.
// If no eligible parent exists, returns 409 so the client sequencer
// skips to the next round-kind without raising as an error.
async function runRankRound(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  sessionId: string;
  nodes: DbNode[];
  childCount: Map<string, number>;
  precision: number;
  /** Pre-formatted user MCQ context — appended to the variations-to-
   *  rank prompt so the LLM scores against the user's stated
   *  target_metric / variation_axis instead of generic feasibility. */
  clarifierContext: string;
}) {
  const { db, sessionId, nodes, precision, clarifierContext } = args;

  // Group variation nodes by parent
  const variationsByParent = new Map<string, DbNode[]>();
  for (const n of nodes) {
    if (n.kind !== "variation" || !n.parent_id) continue;
    const list = variationsByParent.get(n.parent_id) ?? [];
    list.push(n);
    variationsByParent.set(n.parent_id, list);
  }

  // Pick the parent with the most variation children (and at least 2).
  // If multiple tie, prefer the most-recently-active one.
  let bestParent: DbNode | null = null;
  let bestVariations: DbNode[] = [];
  for (const [parentId, variations] of variationsByParent.entries()) {
    if (variations.length < 2) continue;
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) continue;
    if (
      !bestParent ||
      variations.length > bestVariations.length ||
      (variations.length === bestVariations.length &&
        parent.created_at > bestParent.created_at)
    ) {
      bestParent = parent;
      bestVariations = variations;
    }
  }
  if (!bestParent) {
    return NextResponse.json(
      { error: "No parent with 2+ variations to rank yet" },
      { status: 409 },
    );
  }

  const system = systemForMode("rank", precision);
  const schema = schemaForMode("rank");

  const baseRankMsg = `Parent thread:\n${bestParent.label}\n\nVariations to rank:\n${bestVariations
    .map((v, i) => `${i + 1}. ${v.label}`)
    .join("\n")}`;
  const userMsg = clarifierContext
    ? `${baseRankMsg}\n\n${clarifierContext}`
    : baseRankMsg;

  let parsed: {
    ranked: Array<{ label: string; score: number; why: string }>;
  };
  try {
    parsed = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 1500,
      temperature: 0.4,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[autopilot/round rank] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const ranked = (parsed.ranked ?? []).slice(0, 8);
  if (ranked.length === 0) {
    return NextResponse.json(
      { error: "Rank returned no usable scores" },
      { status: 502 },
    );
  }

  // Persist a single ranking-kind summary node anchored next to the parent.
  // The scored list is JSON-encoded in meta so the client / future rounds
  // can read it without another LLM call. label is a human-readable summary.
  const topLabel = ranked[0]?.label ?? "(top)";
  const summary = {
    session_id: sessionId,
    parent_id: bestParent.id,
    kind: "ranking" as const,
    label: `Top: ${topLabel}`,
    meta: JSON.stringify({
      ranked,
      parentLabel: bestParent.label,
      generatedAt: new Date().toISOString(),
    }).slice(0, 4000),
    x: bestParent.x + 240,
    y: bestParent.y - 80,
  };

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_nodes")
    .insert([summary])
    .select("id, session_id, parent_id, kind, label, meta, x, y, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expanded: { id: bestParent.id, label: bestParent.label },
    new_nodes: (inserted ?? []) as InsertedNode[],
  });
}

// ── Converge round handler (Wave 2) ──
// The final wave of the brainstorm speedrun. Reads the seed
// (kind="core") + ALL its descendants, sends them to the converge
// LLM mode, and persists a single "ranking"-kind summary node with
// the cluster JSON in meta. Member-node tagging (writing
// cluster_id into each member's meta) is deferred to a separate
// batch — keeps Wave 2 atomic.
//
// 409s cleanly if:
//   - no seed exists (kind="core" missing)
//   - too few descendants to converge meaningfully (<4)
// The client sequencer treats 409 as "skip this round, move on."
async function runConvergeRound(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  sessionId: string;
  nodes: DbNode[];
  precision: number;
  /** Pre-formatted user MCQ context — the converge LLM uses this to
   *  tilt cluster naming + scope_cut rationale toward the user's
   *  stated target_metric / variation_axis / system_boundary, and
   *  to favor the cluster that best honors the user's intent as
   *  the recommended pick. */
  clarifierContext: string;
}) {
  const { db, sessionId, nodes, precision, clarifierContext } = args;

  // Find the seed. Prefer kind="core"; fall back to the oldest node
  // (creation order) if no core exists.
  const seed =
    nodes.find((n) => n.kind === "core") ?? nodes[0];
  if (!seed) {
    return NextResponse.json(
      { error: "No seed to converge against" },
      { status: 409 },
    );
  }

  // Collect ALL descendants via BFS on parent_id.
  const childrenByParent = new Map<string, DbNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = childrenByParent.get(n.parent_id) ?? [];
    list.push(n);
    childrenByParent.set(n.parent_id, list);
  }
  const descendants: DbNode[] = [];
  const queue: string[] = [seed.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = childrenByParent.get(id) ?? [];
    for (const c of children) {
      descendants.push(c);
      queue.push(c.id);
    }
  }

  // Exclude transient + summary kinds — those aren't real "ideas" to
  // cluster. Keep variations / branches / insights / actions /
  // questions etc. Excludes ranking summaries (meta-output) and user
  // speech transcripts.
  const meaningful = descendants.filter(
    (n) => n.kind !== "user" && n.kind !== "ranking",
  );
  if (meaningful.length < 4) {
    return NextResponse.json(
      {
        error:
          "Not enough descendants to converge yet (need 4+ ideas on the board)",
      },
      { status: 409 },
    );
  }

  const system = systemForMode("converge", precision);
  const schema = schemaForMode("converge");

  // Build the user message. Cap at ~80 descendants so the prompt
  // stays within sane token bounds for o-models. Prioritize
  // variations (they're the divergent fan) over branches (they're
  // categorical containers).
  const sorted = meaningful
    .slice()
    .sort((a, b) => {
      const ra = a.kind === "variation" ? 0 : 1;
      const rb = b.kind === "variation" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.created_at.localeCompare(b.created_at);
    })
    .slice(0, 80);

  const nodeBlock = sorted
    .map(
      (n) =>
        `id=${n.id} kind=${n.kind} label="${n.label.slice(0, 200).replace(/"/g, "'")}"${n.meta ? ` meta="${n.meta.slice(0, 120).replace(/"/g, "'").replace(/\n/g, " ")}"` : ""}`,
    )
    .join("\n");

  const userMsg = `Seed concept: ${seed.label}

Brainstorm board descendants (${sorted.length} nodes):
${nodeBlock}

Cluster these into 2-3 MVP candidates. Pick one to recommend.${
    clarifierContext ? `\n\n${clarifierContext}` : ""
  }`;

  let parsed: {
    clusters: Array<{
      name: string;
      pitch: string;
      member_node_ids: string[];
      effort: "light" | "medium" | "heavy";
      impact: number;
      novelty: number;
      scope_cut: string;
      recommended: boolean;
    }>;
    recommendation_rationale: string;
  };
  try {
    parsed = await llmJSON({
      system,
      user: userMsg,
      maxTokens: 2400,
      temperature: 0.5,
      responseSchema: schema as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[autopilot/round converge] LLM error:", err);
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const clusters = (parsed.clusters ?? []).slice(0, 3);
  if (clusters.length === 0) {
    return NextResponse.json(
      { error: "Converge returned no clusters" },
      { status: 502 },
    );
  }
  // Defensive: ensure exactly one cluster is recommended. If LLM
  // returned 0 or 2+, fix by picking the highest-impact one,
  // penalizing heavy effort.
  const effortPenalty: Record<"light" | "medium" | "heavy", number> = {
    light: 0,
    medium: 1.5,
    heavy: 3,
  };
  const recommendedCount = clusters.filter((c) => c.recommended).length;
  if (recommendedCount !== 1) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const score = c.impact - effortPenalty[c.effort];
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    clusters.forEach((c, i) => {
      c.recommended = i === bestIdx;
    });
  }

  // Persist a single ranking-kind summary node anchored near the seed.
  // The cluster data is JSON-encoded in meta so the client renderer
  // (forthcoming Wave 3 visual cluster grouping) can read it without
  // another LLM call. label is a human summary: "MVP: <recommended cluster name>".
  const recommended = clusters.find((c) => c.recommended) ?? clusters[0];
  const summaryNode = {
    session_id: sessionId,
    parent_id: seed.id,
    kind: "ranking" as const,
    label: `MVP: ${recommended.name}`,
    meta: JSON.stringify({
      kind: "converge",
      clusters,
      recommendation_rationale: parsed.recommendation_rationale,
      generatedAt: new Date().toISOString(),
    }).slice(0, 6000),
    x: seed.x + 280,
    y: seed.y - 200,
  };

  const { data: inserted, error: insertErr } = await db
    .from("brainstorm_nodes")
    .insert([summaryNode])
    .select("id, session_id, parent_id, kind, label, meta, x, y, created_at");
  if (insertErr) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    expanded: { id: seed.id, label: seed.label },
    new_nodes: (inserted ?? []) as InsertedNode[],
  });
}

// ── Helper: format the user's homepage MCQ answers into a soft-
// constraint block the LLM can read. Returns an empty string when
// the session has no clarifier_qa (legacy sessions, sessions
// without the modal, malformed payload) — empty string lets every
// round handler skip injection with a single truthy check.
//
// Slot labels are humanized so the LLM doesn't have to interpret
// the enum keys. Unslotted answers fall through under "clarification".
//
// Wording matters here: we tell the LLM these are SOFT constraints,
// not hard rules. The user's stated metric/timeframe/axis biases
// generation but doesn't force it — if a fundamentally better answer
// requires breaking the constraint, the LLM should still propose it.
const SLOT_HUMAN_LABEL: Record<string, string> = {
  exploration_angle: "exploration angle",
  variation_axis: "variation axis",
  target_metric: "target metric",
  system_boundary: "system boundary",
  state_variable: "key state variable",
  observation_point: "observation point",
  timeframe: "timeframe",
  constraint: "constraint",
};

function formatClarifierContext(clarifierQa: unknown): string {
  if (!clarifierQa || typeof clarifierQa !== "object") return "";
  const qa = clarifierQa as { pairs?: unknown };
  if (!Array.isArray(qa.pairs) || qa.pairs.length === 0) return "";

  const lines: string[] = [];
  for (const raw of qa.pairs) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const answer = typeof p.answer === "string" ? p.answer.trim() : "";
    if (!answer) continue;
    const slotKey = typeof p.slot === "string" ? p.slot : "constraint";
    const label = SLOT_HUMAN_LABEL[slotKey] ?? "clarification";
    lines.push(`• ${label}: ${answer.slice(0, 300)}`);
  }
  if (lines.length === 0) return "";

  return [
    "User clarifications (treat as soft constraints — they reflect the",
    "user's preferred angles, not hard rules. Use them to steer the",
    "output toward what the user cares about most):",
    ...lines,
  ].join("\n");
}
