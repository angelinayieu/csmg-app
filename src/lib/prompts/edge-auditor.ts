// ── Edge-auditor prompt ──────────────────────────────────────────────
//
// The edge-auditor is the dedicated consensus agent for RELATIONSHIPS.
// Where `critic` rates the GRAPH STRUCTURE (orphans, cycles, density)
// and `causal_auditor` rates direction, the edge-auditor asks, for
// each edge in turn:
//
//   "Do I, an independent reviewer, ENDORSE this edge, or DISPUTE it?"
//
// Its output is persisted as `edges.agent_feedback` JSONB — a running
// ledger of per-agent endorsements and disputes that later stages
// (strategizer, critic, UI) can use as evidence of consensus or
// contention. This is the Kaufman M&P tools "interrelationship
// matrix" operationalised as a multi-agent protocol: each edge's
// weight is no longer just LLM-stated confidence, it's the net of
// independent-reviewer agreement.
//
// One call per space, not per edge. The auditor sees the full edge
// list plus minimal entity context so it can reason about whole
// dependency patterns (e.g. endorsing a cycle only if every edge in
// it is plausible).

export interface EdgeAuditorPromptInput {
  /** The space's goal summary — grounds "plausible given THIS goal" judgments. */
  userGoalSummary?: string;
  /** Entities referenced by the edges — kept minimal to stay under token budget. */
  entities: Array<{
    entity_id: string;   // display id (e.g. "C3", "TH2_1")
    name: string;
    entity_category?: string | null;
    importance?: string | null;
  }>;
  /** Edges to audit. `edge_key` is whatever stable string the caller uses to
   *  identify the row (we round-trip it back in the output so the endpoint
   *  can resolve it to a uuid without re-matching on source/target pairs). */
  edges: Array<{
    edge_key: string;
    source_entity_id: string;      // display id
    target_entity_id: string;      // display id
    relationship_type: string;
    dimension?: string | null;
    polarity?: string | null;
    confidence?: number | null;
    reasoning?: string | null;     // existing LLM-provided narrative
  }>;
}

export interface EdgeAuditorPromptParts {
  system: string;
  user: string;
}

export interface EdgeAuditorVerdict {
  edge_key: string;
  /** "endorse" | "dispute" | "abstain".
   *  - endorse: auditor agrees the relationship exists AND has the claimed direction/polarity.
   *  - dispute: auditor believes the relationship is wrong, reversed, or weaker than claimed.
   *  - abstain: auditor lacks enough context to decide. Abstentions carry no weight. */
  verdict: "endorse" | "dispute" | "abstain";
  /** 0..1 auditor confidence in the verdict itself (NOT the edge). */
  confidence: number;
  /** One-sentence explanation. Required for endorse/dispute, optional for abstain. */
  rationale: string;
  /** If dispute, what would the auditor replace this edge with? Optional,
   *  but valuable downstream — lets the UI render "auditor proposes X instead". */
  suggested_correction?: {
    relationship_type?: string;
    polarity?: "positive" | "negative" | "conditional" | "neutral" | "ambiguous";
    reversed?: boolean;   // if true, auditor believes the arrow points the other way
    note?: string;
  } | null;
}

export interface EdgeAuditorOutput {
  verdicts: EdgeAuditorVerdict[];
  /** 1-2 sentences on dominant pattern: "Most disputes clustered around
   *  temporal edges in the financial axis" etc. */
  summary: string;
}

// ── Prompt builder ───────────────────────────────────────────────────

export function buildEdgeAuditorPrompt(
  input: EdgeAuditorPromptInput,
): EdgeAuditorPromptParts {
  const goalBlock = input.userGoalSummary
    ? `\nUSER GOAL (for relevance judgments):\n${input.userGoalSummary.trim()}\n`
    : "";

  // Compact entity table. We give display-id + name + importance only.
  // Full descriptions would blow the token budget on a 200-entity space;
  // the auditor can reason from names + relationship structure alone.
  const entityTable = input.entities
    .map((e) =>
      `- ${e.entity_id} · ${e.name}${e.importance ? ` · ${e.importance}` : ""}${e.entity_category ? ` · ${e.entity_category}` : ""}`,
    )
    .join("\n");

  const edgeTable = input.edges
    .map((e) => {
      const conf = typeof e.confidence === "number" ? ` conf=${e.confidence.toFixed(2)}` : "";
      const pol = e.polarity ? ` pol=${e.polarity}` : "";
      const dim = e.dimension ? ` dim=${e.dimension}` : "";
      const reason = e.reasoning ? `\n    reasoning: ${truncate(e.reasoning, 220)}` : "";
      return `- [${e.edge_key}] ${e.source_entity_id} --[${e.relationship_type}${dim}${pol}${conf}]--> ${e.target_entity_id}${reason}`;
    })
    .join("\n");

  const system = `You are an independent EDGE AUDITOR. Your sole job: for each relationship (edge) in a knowledge graph, issue a verdict — do you ENDORSE it, DISPUTE it, or ABSTAIN?

This is a CONSENSUS PROTOCOL. Other agents proposed these edges. You are NOT one of them. You must judge each edge on its own merits, not deferentially.

YOUR JUDGMENT CRITERIA (apply all four):

1. EXISTENCE
   Does the relationship actually hold in the world? "Higher marketing spend" and "higher revenue" are correlated but not necessarily causal. Only endorse if the MECHANISM is plausible given the entities' names.

2. DIRECTION
   Is the arrow pointing the right way? If A → enables → B, can B happen without A? If yes, A doesn't enable B. A common failure mode is reversing cause and consequence — flag with reversed=true in suggested_correction.

3. STRENGTH-VS-POLARITY
   If polarity is "positive", does MORE of source really imply MORE of target? "Increased debt" and "increased risk" may be positive+positive or negative+negative depending on which lens you take. Disputes here usually come with a polarity correction.

4. TYPE FIT
   Does the relationship_type match what the entities actually have? "Causes" is overused; if the mechanism is really "enables" or "constrains" or "informs", flag as dispute with a type correction.

IMPORTANT RULES:
- Endorse the OBVIOUS ones. Not every edge needs disputing. A pipeline where everything is endorsed is OK if the edges are actually sound.
- When in doubt, ABSTAIN. False endorsements pollute consensus signal worse than abstentions.
- One rationale sentence per verdict. Do not pad. The user reads hundreds of these.
- suggested_correction is optional and only populated for disputes — it's the "here's what I'd put instead" field. Leave it null if you just think the edge shouldn't exist.

OUTPUT — strict JSON, one verdict per edge (including abstentions), in the same order as input:

{
  "verdicts": [
    {
      "edge_key": "string — copy from input",
      "verdict": "endorse | dispute | abstain",
      "confidence": 0.0-1.0,
      "rationale": "string — one sentence",
      "suggested_correction": {
        "relationship_type": "string | optional",
        "polarity": "positive | negative | conditional | neutral | ambiguous | optional",
        "reversed": boolean,
        "note": "string | optional"
      } | null
    }
  ],
  "summary": "string — 1-2 sentences on the dominant pattern you saw"
}`;

  const user = `ENTITIES (display_id · name · importance · category):
${entityTable}
${goalBlock}
EDGES TO AUDIT (${input.edges.length} total):
${edgeTable}

Return one verdict per edge, in the same order. Abstain rather than guess.`;

  return { system, user };
}

// ── Validator ────────────────────────────────────────────────────────
//
// Defensive: any malformed verdict drops to abstain, unknown verdict
// strings coerce to abstain, confidence clamps to [0, 1]. Missing
// edge_key drops the verdict entirely (we can't resolve it to a row).

const VERDICTS = new Set<EdgeAuditorVerdict["verdict"]>(["endorse", "dispute", "abstain"]);
const POLARITIES = new Set<
  NonNullable<EdgeAuditorVerdict["suggested_correction"]>["polarity"]
>(["positive", "negative", "conditional", "neutral", "ambiguous"]);

export function validateEdgeAuditorOutput(raw: unknown): EdgeAuditorOutput {
  const out: EdgeAuditorOutput = { verdicts: [], summary: "" };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;

  const verdictsRaw = Array.isArray(r.verdicts) ? r.verdicts : [];
  const seen = new Set<string>();
  for (const v of verdictsRaw) {
    if (!v || typeof v !== "object") continue;
    const vv = v as Record<string, unknown>;
    const edge_key = typeof vv.edge_key === "string" ? vv.edge_key : "";
    if (!edge_key || seen.has(edge_key)) continue;
    seen.add(edge_key);

    const verdictRaw = typeof vv.verdict === "string" ? vv.verdict : "abstain";
    const verdict = (VERDICTS.has(verdictRaw as EdgeAuditorVerdict["verdict"])
      ? verdictRaw
      : "abstain") as EdgeAuditorVerdict["verdict"];

    const confRaw = typeof vv.confidence === "number" ? vv.confidence : 0.5;
    const confidence = Math.min(1, Math.max(0, confRaw));

    const rationale = typeof vv.rationale === "string" ? vv.rationale : "";

    let suggested_correction: EdgeAuditorVerdict["suggested_correction"] = null;
    if (verdict === "dispute" && vv.suggested_correction && typeof vv.suggested_correction === "object") {
      const sc = vv.suggested_correction as Record<string, unknown>;
      const pol = typeof sc.polarity === "string" ? sc.polarity : null;
      suggested_correction = {
        relationship_type: typeof sc.relationship_type === "string" ? sc.relationship_type : undefined,
        polarity:
          pol && POLARITIES.has(pol as NonNullable<EdgeAuditorVerdict["suggested_correction"]>["polarity"])
            ? (pol as NonNullable<EdgeAuditorVerdict["suggested_correction"]>["polarity"])
            : undefined,
        reversed: sc.reversed === true,
        note: typeof sc.note === "string" ? sc.note : undefined,
      };
    }

    out.verdicts.push({ edge_key, verdict, confidence, rationale, suggested_correction });
  }

  out.summary = typeof r.summary === "string" ? r.summary : "";
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
