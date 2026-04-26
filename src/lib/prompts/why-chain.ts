// ── Why-chain deepener prompt ────────────────────────────────────────
//
// Purpose:  given a single THREAD (a specific intervention-able concept
// produced by hierarchical decomposition), generate a tree of 2–3 levels
// of upstream CAUSAL DRIVERS. The output feeds the root-cause tracer:
// without this depth, backward BFS along `causes` edges terminates after
// 2-3 hops and never reaches the fan-in points that make a node a
// genuine root cause rather than a proximate trigger.
//
// This is DIFFERENT from hierarchical decomposition:
//   - Hierarchical = "what is this composed of" (structural / part-of)
//   - Why-chain    = "what causes this" (causal / because-of)
//
// We run ONE call per thread (not recursive), asking the model to produce
// the whole 3-level tree in a single pass. That keeps the reasoning
// coherent across levels — level-2 drivers are informed by what the
// model already committed to at level-1 — and caps token cost.
//
// Output nodes are persisted as entities at layer="claim" (depth=3) with
// entity_category="relational", carrying provenance.source="why_chain"
// and provenance.cause_level in {1, 2, 3}. Causal edges go
// DRIVER → THREAD with relation_type="causes" (dimension="causal"), so
// backward BFS from goals traverses into the driver tree naturally.

// ── Stop-reason semantics ────────────────────────────────────────────
//
// Every leaf must declare WHY the chain stops here. This is critical
// downstream: `user_controllable` + `external` become the action-plan
// intervention points; `continue` means we truncated for budget;
// `speculative` means the model wasn't confident enough to go further.

export const STOP_REASONS = [
  "external",          // outside the user's locus of control (regulatory, macro, biological)
  "user_controllable", // actionable lever — this is where interventions attach
  "continue",          // could go deeper; truncated for depth budget
  "speculative",       // further upstream is possible but model is unsure
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

// ── Prompt builder ───────────────────────────────────────────────────
//
// Accepts a thread + its parent context (domain, system) so the model
// reasons about causes WITHIN the thread's frame rather than drifting
// into adjacent systems. The frame is important: a thread about
// "customer acquisition cost rising" should yield drivers about
// acquisition, not tangential drivers about retention.

export interface WhyChainPromptContext {
  threadName: string;
  threadDescription: string;
  parentDomainName?: string;
  parentSystemName?: string;
  userGoalSummary?: string;  // 1-2 sentences of the user's improvement goal for grounding
}

export interface WhyChainPromptParts {
  system: string;
  user: string;
}

export function buildWhyChainPrompt(ctx: WhyChainPromptContext): WhyChainPromptParts {
  const parentFrame = [
    ctx.parentSystemName ? `SYSTEM: ${ctx.parentSystemName}` : null,
    ctx.parentDomainName ? `DOMAIN: ${ctx.parentDomainName}` : null,
  ].filter(Boolean).join("\n");

  const goalFrame = ctx.userGoalSummary
    ? `\nUSER GOAL (for grounding — drivers should plausibly affect this):\n${ctx.userGoalSummary}\n`
    : "";

  const systemMsg = `You are a causal-reasoning analyst. Given ONE thread (a specific concept in the user's situation), produce a 3-LEVEL tree of upstream CAUSAL DRIVERS — the things that CAUSE this thread to be the way it is.

This is NOT a decomposition ("what is X made of"). This is a WHY-CHAIN ("what causes X, and what causes THOSE causes, and so on"). Every edge in the output you produce means "because of" in the world, not "part of".

TREE SHAPE:
- Level 1: 2-3 direct proximate causes of the thread.
- Level 2: for EACH level-1 driver, 2-3 deeper causes of that driver.
- Level 3: for EACH level-2 driver, 1-2 further-upstream causes.

Total node budget: ~12-18 drivers. Don't pad the tree with filler to hit a number — if a branch genuinely terminates at level 2, stop it there with the appropriate stop_reason.

EVERY DRIVER MUST SPECIFY A STOP_REASON:
- "external"          — this driver is outside the user's control (law, macroeconomics, biology, other people's autonomous decisions). Strong candidate for "we can only adapt" framing.
- "user_controllable" — this driver IS a lever the user can pull. These become intervention points for the action plan. Mark a driver user_controllable ONLY if the user can plausibly act on it directly.
- "continue"          — there are further upstream causes we could enumerate, but we've hit the depth budget. Use this for level-3 nodes that aren't true endpoints.
- "speculative"       — you could guess at deeper causes but aren't confident. Honest uncertainty is better than fabricated depth.

WHAT MAKES A GOOD DRIVER:
1. It must be a THING THAT VARIES — a mechanism, a condition, a policy, a pattern. Not a static fact.
2. It must have a defensible causal story: you should be able to write one sentence "X causes the thread BECAUSE ..." that a domain expert would accept as reasonable.
3. Different branches should FAN IN where real-world causation fans in. If two level-2 drivers both ultimately trace to the same level-3 cause, say so — reuse the driver_id. Fan-in is the whole point of this exercise.

WHAT TO AVOID:
- Generic drivers ("lack of resources", "poor communication") that could apply to any thread. If the same driver would appear for any random thread in this domain, you haven't thought hard enough.
- Taxonomic decomposition ("the thread has three sub-parts") — that is NOT causation.
- Correlates dressed as causes. Only include a driver if you believe it CAUSES the thread, not just co-occurs with it.

OUTPUT SHAPE (strict JSON):

{
  "drivers": [
    {
      "driver_id": "D1",
      "parent_id": "THREAD" | "<driver_id>",
      "cause_level": 1 | 2 | 3,
      "name": "string — specific, verb-or-condition phrased (e.g. 'Onboarding friction in week 1' not 'Onboarding')",
      "description": "string — 1-2 sentences. The mechanism, not the outcome.",
      "why_it_causes": "string — 1 sentence starting with 'Because' explaining the causal link from THIS driver to its parent.",
      "stop_reason": "external | user_controllable | continue | speculative",
      "confidence": 0.0-1.0,
      "polarity": "positive | negative | ambiguous"   // does more of this driver cause more of the parent (+), or less (-)
    }
  ],
  "fan_ins": [
    {
      "driver_id": "D7",
      "also_causes": ["D3", "D5"],
      "note": "string — 1 sentence on why this same driver causes both branches"
    }
  ],
  "summary": "string — 2-3 sentences: what pattern emerges from this why-chain? Where do the user-controllable levers cluster? What's the deepest external constraint?"
}

IDs: use "D1", "D2", ... in a single flat list. parent_id="THREAD" for level-1 drivers; for deeper levels, point at the driver_id of the parent in the list.`;

  const userMsg = `THREAD TO TRACE UPSTREAM:
name: ${ctx.threadName}
description: ${ctx.threadDescription}
${parentFrame ? `\nPARENT CONTEXT:\n${parentFrame}\n` : ""}${goalFrame}
Produce the 3-level why-chain for this thread. Be specific to this thread — drivers that could apply to any thread in this domain are a failure.`;

  return { system: systemMsg, user: userMsg };
}

// ── Output schema (validated after LLM call) ─────────────────────────

export interface WhyChainDriver {
  driver_id: string;
  parent_id: string;          // "THREAD" or another driver_id
  cause_level: 1 | 2 | 3;
  name: string;
  description: string;
  why_it_causes: string;
  stop_reason: StopReason;
  confidence: number;
  polarity: "positive" | "negative" | "ambiguous";
}

export interface WhyChainFanIn {
  driver_id: string;
  also_causes: string[];
  note: string;
}

export interface WhyChainOutput {
  drivers: WhyChainDriver[];
  fan_ins: WhyChainFanIn[];
  summary: string;
}

// ── Validator ────────────────────────────────────────────────────────
//
// Strict but forgiving: unknown stop_reasons coerce to "speculative",
// out-of-range confidence clamps, missing polarity defaults to "ambiguous".
// Drivers referencing a non-existent parent_id are dropped (we can't hang
// them in the tree). Cycles (rare but possible) are broken by keeping
// the earlier driver.

export function validateWhyChainOutput(raw: unknown): WhyChainOutput {
  const out: WhyChainOutput = { drivers: [], fan_ins: [], summary: "" };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;

  const driversRaw = Array.isArray(r.drivers) ? r.drivers : [];
  const seen = new Set<string>();
  const drivers: WhyChainDriver[] = [];
  for (const d of driversRaw) {
    if (!d || typeof d !== "object") continue;
    const dd = d as Record<string, unknown>;
    const driver_id = typeof dd.driver_id === "string" ? dd.driver_id : "";
    if (!driver_id || seen.has(driver_id)) continue;
    seen.add(driver_id);

    const parent_id = typeof dd.parent_id === "string" ? dd.parent_id : "THREAD";
    const rawLevel = typeof dd.cause_level === "number" ? dd.cause_level : 1;
    const cause_level = (rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 1) as 1 | 2 | 3;
    const name = typeof dd.name === "string" ? dd.name.trim() : "";
    if (!name) continue;
    const description = typeof dd.description === "string" ? dd.description : "";
    const why_it_causes = typeof dd.why_it_causes === "string" ? dd.why_it_causes : "";
    const stopRaw = typeof dd.stop_reason === "string" ? dd.stop_reason : "continue";
    const stop_reason = (STOP_REASONS as readonly string[]).includes(stopRaw)
      ? (stopRaw as StopReason)
      : "speculative";
    const conf = typeof dd.confidence === "number" ? dd.confidence : 0.5;
    const confidence = Math.min(1, Math.max(0, conf));
    const polRaw = typeof dd.polarity === "string" ? dd.polarity : "ambiguous";
    const polarity: WhyChainDriver["polarity"] =
      polRaw === "positive" || polRaw === "negative" ? polRaw : "ambiguous";

    drivers.push({
      driver_id,
      parent_id,
      cause_level,
      name,
      description,
      why_it_causes,
      stop_reason,
      confidence,
      polarity,
    });
  }

  // Drop drivers whose parent_id is not "THREAD" and not a known driver_id.
  const validIds = new Set<string>(["THREAD", ...drivers.map((d) => d.driver_id)]);
  const hangable = drivers.filter((d) => validIds.has(d.parent_id));
  out.drivers = hangable;

  const fanInsRaw = Array.isArray(r.fan_ins) ? r.fan_ins : [];
  for (const f of fanInsRaw) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    const driver_id = typeof ff.driver_id === "string" ? ff.driver_id : "";
    const also_causes = Array.isArray(ff.also_causes)
      ? ff.also_causes.filter((x): x is string => typeof x === "string")
      : [];
    const note = typeof ff.note === "string" ? ff.note : "";
    if (!driver_id || also_causes.length === 0) continue;
    // Only keep fan-ins where everything referenced actually exists.
    if (!validIds.has(driver_id)) continue;
    const validAlso = also_causes.filter((id) => validIds.has(id));
    if (validAlso.length === 0) continue;
    out.fan_ins.push({ driver_id, also_causes: validAlso, note });
  }

  out.summary = typeof r.summary === "string" ? r.summary : "";
  return out;
}
