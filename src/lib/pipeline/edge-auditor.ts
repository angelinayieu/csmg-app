// ── Edge-auditor pipeline library ────────────────────────────────────
//
// Wraps the edge-auditor LLM prompt. Given a space's edges + entities,
// issues one LLM call and returns verdicts ready to be folded into the
// `edges.agent_feedback` JSONB column.
//
// Contract:
//   - ALL inputs optional-degrading: no edges → empty result, LLM failure
//     → empty result. This is a soft-fail step slotted into the synthesize
//     handoff chain; if it collapses, downstream stages still work.
//   - Input keys (edge_key) round-trip unchanged. Callers map back to row
//     uuids themselves so this file stays pure.
//   - Batches only — if a space has 400 edges, we chunk to keep individual
//     prompts under the model's realistic reasoning budget. (Consensus
//     quality degrades sharply past ~80 edges per call.)

import { llmJSON } from "@/lib/llm";
import {
  buildEdgeAuditorPrompt,
  validateEdgeAuditorOutput,
  type EdgeAuditorPromptInput,
  type EdgeAuditorOutput,
  type EdgeAuditorVerdict,
} from "@/lib/prompts/edge-auditor";

// ── Tuning knobs ─────────────────────────────────────────────────────
//
// EDGE_BATCH_SIZE: empirically, a well-formed auditor call holds
// coherence for ~80 edges. Past that the model starts issuing
// abstentions out of fatigue rather than genuine uncertainty, which
// poisons the consensus signal. We chunk and parallelize instead of
// increasing per-call size.
//
// MAX_PARALLEL: LLM calls are IO-bound; 3 is a safe ceiling that
// won't trip provider rate limits on shared infra.

const EDGE_BATCH_SIZE = 70;
const MAX_PARALLEL = 3;

export interface AuditEdgesOptions {
  input: EdgeAuditorPromptInput;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AuditEdgesResult {
  verdicts: EdgeAuditorVerdict[];
  summaries: string[];   // one per batch
  stats: {
    edges_audited: number;
    endorsed: number;
    disputed: number;
    abstained: number;
    batches: number;
    llm_called: boolean;
    fallback_used: boolean;
  };
}

/**
 * Run the auditor over all provided edges, batched. Returns aggregated
 * verdicts + per-batch summaries. On total failure, returns an empty
 * result with fallback_used=true — never throws.
 */
export async function auditEdges(
  opts: AuditEdgesOptions,
): Promise<AuditEdgesResult> {
  const { input } = opts;
  const empty: AuditEdgesResult = {
    verdicts: [],
    summaries: [],
    stats: {
      edges_audited: 0,
      endorsed: 0,
      disputed: 0,
      abstained: 0,
      batches: 0,
      llm_called: false,
      fallback_used: false,
    },
  };

  if (!input.edges || input.edges.length === 0) return empty;

  const batches: Array<EdgeAuditorPromptInput["edges"]> = [];
  for (let i = 0; i < input.edges.length; i += EDGE_BATCH_SIZE) {
    batches.push(input.edges.slice(i, i + EDGE_BATCH_SIZE));
  }

  const allVerdicts: EdgeAuditorVerdict[] = [];
  const summaries: string[] = [];
  let llmCalled = false;
  let fallbackUsed = false;

  // Concurrency-limited worker pool.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_PARALLEL, batches.length) }, async () => {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      if (!batch) break;

      const batchInput: EdgeAuditorPromptInput = { ...input, edges: batch };
      const { system, user } = buildEdgeAuditorPrompt(batchInput);

      try {
        llmCalled = true;
        const parsed = await llmJSON<unknown>({
          system,
          user,
          model: opts.model,
          maxTokens: opts.maxTokens ?? 4000,
          temperature: opts.temperature ?? 0.2,
          fallback: {},
        });
        const validated: EdgeAuditorOutput = validateEdgeAuditorOutput(parsed);
        if (validated.verdicts.length === 0) fallbackUsed = true;
        for (const v of validated.verdicts) allVerdicts.push(v);
        if (validated.summary) summaries.push(validated.summary);
      } catch (err) {
        console.warn(`[edge-auditor] batch ${idx} failed:`, err);
        fallbackUsed = true;
      }
    }
  });
  await Promise.all(workers);

  // Count outcomes for the summary.
  let endorsed = 0;
  let disputed = 0;
  let abstained = 0;
  for (const v of allVerdicts) {
    if (v.verdict === "endorse") endorsed += 1;
    else if (v.verdict === "dispute") disputed += 1;
    else abstained += 1;
  }

  return {
    verdicts: allVerdicts,
    summaries,
    stats: {
      edges_audited: allVerdicts.length,
      endorsed,
      disputed,
      abstained,
      batches: batches.length,
      llm_called: llmCalled,
      fallback_used: fallbackUsed,
    },
  };
}

// ── agent_feedback JSONB shape ───────────────────────────────────────
//
// This mirrors the migration default:
//   { "endorsements": [], "disputes": [] }
//
// Each ledger entry carries agent_id + timestamp + confidence +
// rationale so later passes can audit who said what and when. We
// never overwrite existing entries — later auditor passes APPEND
// (dedup-by-agent_id-plus-timestamp is a later concern).

export interface AgentFeedbackLedgerEntry {
  agent_id: string;
  verdict: "endorse" | "dispute";
  confidence: number;
  rationale: string;
  at: string; // ISO
  suggested_correction?: EdgeAuditorVerdict["suggested_correction"];
}

export interface AgentFeedbackLedger {
  endorsements: AgentFeedbackLedgerEntry[];
  disputes: AgentFeedbackLedgerEntry[];
}

/**
 * Merge a new verdict list from one agent into an existing agent_feedback
 * JSONB value. Safe against malformed input — unknown shape collapses to
 * the empty ledger before merging.
 *
 * IMPORTANT: "abstain" verdicts are dropped. They carry no consensus
 * weight and would only bloat the JSONB column.
 */
export function mergeAgentFeedback(
  existing: unknown,
  agent_id: string,
  verdicts: EdgeAuditorVerdict[],
  at: string = new Date().toISOString(),
): AgentFeedbackLedger {
  const base = normalizeLedger(existing);

  for (const v of verdicts) {
    if (v.verdict === "abstain") continue;
    const entry: AgentFeedbackLedgerEntry = {
      agent_id,
      verdict: v.verdict,
      confidence: v.confidence,
      rationale: v.rationale,
      at,
    };
    if (v.suggested_correction) entry.suggested_correction = v.suggested_correction;

    if (v.verdict === "endorse") base.endorsements.push(entry);
    else base.disputes.push(entry);
  }

  return base;
}

function normalizeLedger(raw: unknown): AgentFeedbackLedger {
  const base: AgentFeedbackLedger = { endorsements: [], disputes: [] };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.endorsements)) {
    for (const e of r.endorsements) {
      if (isEntry(e)) base.endorsements.push(e);
    }
  }
  if (Array.isArray(r.disputes)) {
    for (const e of r.disputes) {
      if (isEntry(e)) base.disputes.push(e);
    }
  }
  return base;
}

function isEntry(e: unknown): e is AgentFeedbackLedgerEntry {
  if (!e || typeof e !== "object") return false;
  const ee = e as Record<string, unknown>;
  return (
    typeof ee.agent_id === "string" &&
    (ee.verdict === "endorse" || ee.verdict === "dispute") &&
    typeof ee.confidence === "number" &&
    typeof ee.rationale === "string" &&
    typeof ee.at === "string"
  );
}
