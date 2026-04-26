// ── Why-chain deepener ───────────────────────────────────────────────
//
// Purpose:  turn ONE thread (a specific intervention-able concept from
// hierarchical decomposition) into a tree of 2–3 levels of upstream
// causal drivers. The backward-BFS root-cause tracer depends on having
// real depth in the causal subgraph; without this, chains terminate
// after 2-3 hops and never reach the fan-in points that distinguish
// root causes from proximate triggers.
//
// Shape produced (raw, PRE-sanitize — matches HierarchicalGraph items):
//   entities: one per driver, layer="claim" (depth=3),
//             entity_category="relational", provenance.source="why_chain"
//   edges:    DRIVER → THREAD with relation_type="causes",
//             dimension="causal"; fan-in edges add extra causes-edges
//             from a shared driver to other drivers it also causes.
//
// One LLM call per thread produces the whole 3-level tree in one pass.
// This keeps reasoning coherent across levels (a level-2 driver sees
// the level-1 commitments) AND caps cost at a predictable number of
// tokens per thread.

import { llmJSON } from "@/lib/llm";
import {
  buildWhyChainPrompt,
  validateWhyChainOutput,
  type WhyChainOutput,
  type WhyChainDriver,
  type WhyChainPromptContext,
} from "@/lib/prompts/why-chain";

// ── Input & output shapes ────────────────────────────────────────────

export interface ThreadInput {
  /** Stable id used in the decomposition output (e.g. "TH3_2_1"). Drivers hang off this. */
  entity_id: string;
  name: string;
  description: string;
  parent_domain_id?: string;
  parent_domain_name?: string;
  parent_system_name?: string;
  importance?: string;
}

export interface DeepenWhyChainOptions {
  thread: ThreadInput;
  /** 1-2 sentence goal summary for grounding (optional but recommended). */
  userGoalSummary?: string;
  /** Override the default reasoning model. */
  model?: string;
  /** Max output tokens. Default 3500. */
  maxTokens?: number;
  temperature?: number;
}

/**
 * Raw entity shape — matches HierarchicalGraph["entities"][number] so the
 * route can shove these through the existing sanitize + insert pipeline
 * alongside the hierarchical graph.
 */
export interface WhyChainEntity {
  entity_id: string;
  name: string;
  description: string;
  layer: "claim";
  importance: string;
  confidence: number;
  entity_category: "relational";
  entity_type: "causal_driver";
  source_tag: "implicit";
  knowledge_layer: "internal";
  provenance: {
    source: "why_chain";
    parent_thread_id: string;
    parent_driver_id: string | null;  // null for level-1 drivers
    cause_level: 1 | 2 | 3;
    stop_reason: WhyChainDriver["stop_reason"];
    why_it_causes: string;
    polarity: WhyChainDriver["polarity"];
  };
}

export interface WhyChainEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: "causes";
  dimension: "causal";
  source_tag: "inferred";
  polarity: "positive" | "negative" | "ambiguous";
  strength: number;
  confidence: number;
  reasoning: string;
  topology?: string;
}

export interface WhyChainResult {
  thread_id: string;
  raw: WhyChainOutput;
  entities: WhyChainEntity[];
  edges: WhyChainEdge[];
  summary: string;
  stats: {
    drivers_total: number;
    drivers_level_1: number;
    drivers_level_2: number;
    drivers_level_3: number;
    user_controllable_count: number;
    external_count: number;
    fan_in_count: number;
    llm_called: boolean;
    fallback_used: boolean;
  };
}

// ── Importance downshift for drivers ─────────────────────────────────
//
// Drivers inherit weaker importance than their parent thread so the
// graph doesn't get dominated by "critical" labels on every driver.
// Level-1 proximate causes can be `important` by default; level-2 and
// level-3 step down to `moderate` unless the model flagged high
// confidence.

function importanceFor(level: 1 | 2 | 3, confidence: number): string {
  if (level === 1) return confidence >= 0.75 ? "critical" : "important";
  if (level === 2) return confidence >= 0.75 ? "important" : "moderate";
  return "moderate";
}

// ── ID namespacing ───────────────────────────────────────────────────
//
// LLM emits local ids D1..Dn. We rewrite them to "<threadId>_wc_<idx>"
// so they're globally unique when multiple threads get deepened in
// the same pass. Rewriting happens once, via a Map, so edge parent
// pointers stay consistent.

function buildIdMap(threadId: string, drivers: WhyChainDriver[]): Map<string, string> {
  const map = new Map<string, string>();
  drivers.forEach((d, idx) => {
    map.set(d.driver_id, `${threadId}_wc_${idx + 1}`);
  });
  return map;
}

// ── Convert LLM output → graph-ready entities + edges ────────────────

function buildGraphArtifacts(
  threadId: string,
  raw: WhyChainOutput,
): { entities: WhyChainEntity[]; edges: WhyChainEdge[] } {
  const idMap = buildIdMap(threadId, raw.drivers);
  const entities: WhyChainEntity[] = [];
  const edges: WhyChainEdge[] = [];

  // Seen-pair dedup so fan-ins can't produce duplicate edges against the
  // primary parent edge.
  const edgeKey = (a: string, b: string) => `${a}->${b}`;
  const edgeSeen = new Set<string>();

  for (const d of raw.drivers) {
    const newId = idMap.get(d.driver_id);
    if (!newId) continue;

    const parentRaw = d.parent_id;
    const parentMapped =
      parentRaw === "THREAD" ? threadId : (idMap.get(parentRaw) ?? null);

    // Drop orphans — a driver whose parent_id resolves to nothing has no
    // home in the tree. The validator already filters most of these;
    // this is a belt-and-suspenders guard.
    if (parentMapped === null) continue;

    entities.push({
      entity_id: newId,
      name: d.name,
      description: d.description,
      layer: "claim",
      importance: importanceFor(d.cause_level, d.confidence),
      confidence: d.confidence,
      entity_category: "relational",
      entity_type: "causal_driver",
      source_tag: "implicit",
      knowledge_layer: "internal",
      provenance: {
        source: "why_chain",
        parent_thread_id: threadId,
        parent_driver_id: parentRaw === "THREAD" ? null : (idMap.get(parentRaw) ?? null),
        cause_level: d.cause_level,
        stop_reason: d.stop_reason,
        why_it_causes: d.why_it_causes,
        polarity: d.polarity,
      },
    });

    const k = edgeKey(newId, parentMapped);
    if (edgeSeen.has(k)) continue;
    edgeSeen.add(k);
    edges.push({
      source_entity_id: newId,
      target_entity_id: parentMapped,
      relationship_type: "causes",
      dimension: "causal",
      source_tag: "inferred",
      polarity: d.polarity,
      strength: 0.5 + 0.4 * d.confidence,   // confidence-weighted strength
      confidence: d.confidence,
      reasoning: d.why_it_causes,
      topology: "direct",
    });
  }

  // Fan-in edges: a single driver that also causes other drivers. These
  // are the critical multi-parent links that make BFS actually converge
  // on root causes — without them, causation looks like a forest of
  // disconnected chains instead of a dag with shared upstream nodes.
  for (const f of raw.fan_ins) {
    const sourceMapped =
      f.driver_id === "THREAD" ? threadId : (idMap.get(f.driver_id) ?? null);
    if (!sourceMapped) continue;
    for (const targetLocal of f.also_causes) {
      const targetMapped =
        targetLocal === "THREAD" ? threadId : (idMap.get(targetLocal) ?? null);
      if (!targetMapped) continue;
      if (sourceMapped === targetMapped) continue;
      const k = edgeKey(sourceMapped, targetMapped);
      if (edgeSeen.has(k)) continue;
      edgeSeen.add(k);
      edges.push({
        source_entity_id: sourceMapped,
        target_entity_id: targetMapped,
        relationship_type: "causes",
        dimension: "causal",
        source_tag: "inferred",
        polarity: "positive",
        strength: 0.55,
        confidence: 0.6,
        reasoning: f.note || "Fan-in: same upstream driver causes both branches.",
        topology: "fan_in",
      });
    }
  }

  return { entities, edges };
}

// ── Main entry ───────────────────────────────────────────────────────

export async function deepenWhyChain(
  opts: DeepenWhyChainOptions,
): Promise<WhyChainResult> {
  const thread = opts.thread;
  const ctx: WhyChainPromptContext = {
    threadName: thread.name,
    threadDescription: thread.description,
    parentDomainName: thread.parent_domain_name,
    parentSystemName: thread.parent_system_name,
    userGoalSummary: opts.userGoalSummary,
  };
  const { system, user } = buildWhyChainPrompt(ctx);

  // Empty fallback — never throw from this library. If the LLM call
  // collapses, downstream just sees an empty why-chain for this thread,
  // which is identical to the pre-deepener behavior (no regression).
  const fallback: WhyChainOutput = { drivers: [], fan_ins: [], summary: "" };
  let raw: WhyChainOutput = fallback;
  let llmCalled = false;
  let fallbackUsed = false;

  try {
    llmCalled = true;
    const parsed = await llmJSON<unknown>({
      system,
      user,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 3500,
      temperature: opts.temperature ?? 0.25,
      fallback: {},
    });
    raw = validateWhyChainOutput(parsed);
    if (raw.drivers.length === 0) fallbackUsed = true;
  } catch (err) {
    console.warn(`[why-chain] LLM call failed for thread ${thread.entity_id}:`, err);
    raw = fallback;
    fallbackUsed = true;
  }

  const { entities, edges } = buildGraphArtifacts(thread.entity_id, raw);

  const level1 = raw.drivers.filter((d) => d.cause_level === 1).length;
  const level2 = raw.drivers.filter((d) => d.cause_level === 2).length;
  const level3 = raw.drivers.filter((d) => d.cause_level === 3).length;
  const uc = raw.drivers.filter((d) => d.stop_reason === "user_controllable").length;
  const ext = raw.drivers.filter((d) => d.stop_reason === "external").length;

  return {
    thread_id: thread.entity_id,
    raw,
    entities,
    edges,
    summary: raw.summary,
    stats: {
      drivers_total: raw.drivers.length,
      drivers_level_1: level1,
      drivers_level_2: level2,
      drivers_level_3: level3,
      user_controllable_count: uc,
      external_count: ext,
      fan_in_count: raw.fan_ins.length,
      llm_called: llmCalled,
      fallback_used: fallbackUsed,
    },
  };
}

// ── Batch helper: deepen a list of threads with concurrency cap ──────
//
// Threads are deepened in parallel with a small concurrency limit (default
// 3) because LLM calls are IO-bound and each individual call is
// independent of the others. Concurrency=3 is a safe middle ground:
// enough to saturate typical provider rate limits, not so high that a
// 12-thread space blows the token budget in a single burst.

export async function deepenWhyChainBatch(
  threads: ThreadInput[],
  shared: Omit<DeepenWhyChainOptions, "thread">,
  concurrency = 3,
): Promise<WhyChainResult[]> {
  const results: WhyChainResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < threads.length) {
      const idx = cursor++;
      const t = threads[idx];
      if (!t) break;
      try {
        const r = await deepenWhyChain({ ...shared, thread: t });
        results.push(r);
      } catch (err) {
        console.warn(`[why-chain-batch] thread ${t.entity_id} failed:`, err);
      }
    }
  });
  await Promise.all(workers);
  return results;
}
