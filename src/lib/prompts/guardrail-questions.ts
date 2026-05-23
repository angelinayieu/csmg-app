// ── Guardrail-question generator prompt ───────────────────────────────
//
// Used by GET /api/spaces/[id]/guardrail-questions to turn the
// system's already-computed gap signals into one-line questions the
// user can answer to tighten future LLM behavior.
//
// The deterministic gap-detection layer (see ANSWER below for the
// list) produces dozens of structured violations per space. Most are
// already surfaced as engineer-facing diagnostics. This generator
// translates the highest-impact 2-4 of them into PLAIN-ENGLISH
// questions the USER can answer — and stores the answers as
// constraints on every future LLM call.
//
// Why this works as a guardrail tightener:
//   - The user knows things the LLM can't infer (their definition of
//     "good enough", their domain biases, what evidence they'd accept).
//   - Each answer becomes a permanent constraint on future
//     recommendations, expansions, and syntheses for this space.
//   - The system's own gap detectors decide WHICH questions to ask —
//     so we don't burn user attention on questions whose answers
//     wouldn't change anything.

export interface GapSignal {
  kind:
    | "missing_falsifiable_prediction" // synthesis-quality flag
    | "missing_mechanism" // coherence-check
    | "missing_measurement_spec" // measurement-coverage-gate fail
    | "unsupported_leverage" // coherence-check
    | "unsupported_risk" // coherence-check
    | "bottleneck_mismatch" // coherence-check
    | "missing_loop_entities" // coherence-check
    | "shallow_leverage" // synthesis-quality
    | "missing_hidden_axiom" // synthesis-quality
    | "ambiguous_assumed_entity" // critic
    | "low_evidence_strength" // synthesis-quality
    | "high_orphan_count" // critic
    | "low_density" // critic
    | "stale_synthesis" // recent paper landed, synthesize hasn't re-run
    | "missing_population_scope" // intake gap
    | "missing_user_goal"; // intake gap
  // Optional concrete reference — when the gap is about a specific
  // entity / leverage point / axiom we include the id so the question
  // can name the thing the user is constraining.
  ref_id?: string;
  ref_name?: string;
  details?: string;
  // Severity drives ordering: critical > important > nice_to_have.
  severity: "critical" | "important" | "nice_to_have";
}

export interface GuardrailQuestion {
  id: string; // deterministic: `gq-${kind}-${ref_id ?? "global"}`
  question: string; // <= 140 chars, plain English, ends with "?"
  category:
    | "falsifiability"
    | "mechanism"
    | "domain"
    | "measurement"
    | "evidence"
    | "scope"
    | "axiom_visibility";
  why_it_matters: string; // <= 200 chars, one sentence
  // Answer hint shows the user what kind of answer is useful
  // ("name a metric", "a counterexample", "a specific threshold")
  answer_kind: "metric" | "counterexample" | "threshold" | "definition" | "population" | "free_text";
  ref_id: string | null;
  ref_name: string | null;
  severity: "critical" | "important" | "nice_to_have";
  // Origin signal — useful when debugging "why was this question asked"
  generated_from_signal_kind: GapSignal["kind"];
}

// Deterministic question generator. No LLM — the question text is a
// templated transformation of each gap signal. This keeps the
// guardrail loop cheap, predictable, and replayable. We can swap to
// an LLM-generated layer later if we want richer phrasing, but the
// determinism is a feature: same gap → same question id → same
// answer storage key, even across deploys.

export function generateQuestionsFromSignals(
  signals: GapSignal[],
): GuardrailQuestion[] {
  const out: GuardrailQuestion[] = [];

  for (const s of signals) {
    const q = templateForSignal(s);
    if (q) out.push(q);
  }

  // Order: critical → important → nice_to_have; within each severity,
  // questions touching the leverage / bottleneck path come first
  // because answering them affects the most other recommendations.
  out.sort((a, b) => {
    const sevRank = (x: GuardrailQuestion) =>
      x.severity === "critical" ? 0 : x.severity === "important" ? 1 : 2;
    const sevDiff = sevRank(a) - sevRank(b);
    if (sevDiff !== 0) return sevDiff;
    const catRank = (x: GuardrailQuestion) => {
      switch (x.category) {
        case "falsifiability":
          return 0;
        case "mechanism":
          return 1;
        case "measurement":
          return 2;
        case "domain":
          return 3;
        case "scope":
          return 4;
        case "evidence":
          return 5;
        case "axiom_visibility":
          return 6;
      }
    };
    return catRank(a) - catRank(b);
  });

  return out;
}

function templateForSignal(s: GapSignal): GuardrailQuestion | null {
  const refSuffix = s.ref_id ? `-${s.ref_id}` : "-global";
  const baseId = `gq-${s.kind}${refSuffix}`;

  switch (s.kind) {
    case "missing_falsifiable_prediction":
      return {
        id: baseId,
        question: s.ref_name
          ? `What outcome would prove "${s.ref_name}" wrong if you observed it?`
          : `What observable would make you abandon this leverage point?`,
        category: "falsifiability",
        why_it_matters:
          "Leverage points without a falsifier are unfalsifiable — your synthesis can't be argued with. A named observable lets the system flag contradicting evidence.",
        answer_kind: "counterexample",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "missing_mechanism":
      return {
        id: baseId,
        question: s.ref_name
          ? `What specifically connects "${s.ref_name}" to the rest of your graph? (the mechanism, not the importance)`
          : `What's the named mechanism here — not the importance, the actual cause-and-effect?`,
        category: "mechanism",
        why_it_matters:
          "Without a named mechanism, edges become 'related to' and recommendations get generic. Naming the mechanism unlocks Pearl-level reasoning.",
        answer_kind: "definition",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "missing_measurement_spec":
      return {
        id: baseId,
        question: s.ref_name
          ? `In what unit would you measure "${s.ref_name}", and at what cadence?`
          : `What's the unit and cadence for this concept? (e.g. "weekly active users", "ms latency", "% adherence")`,
        category: "measurement",
        why_it_matters:
          "Folk-vocabulary names ('engagement', 'quality') resist analysis. A unit + cadence converts the concept into a real variable the LLM can reason about.",
        answer_kind: "metric",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "unsupported_leverage":
      return {
        id: baseId,
        question: s.ref_name
          ? `What evidence backs "${s.ref_name}" as a leverage point — paper, observation, or domain pattern?`
          : `What evidence supports this leverage claim?`,
        category: "evidence",
        why_it_matters:
          "Unsupported leverage points are LLM hunches — anchoring them in named evidence lets you defend or revise them later.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "unsupported_risk":
      return {
        id: baseId,
        question: s.ref_name
          ? `What's the failure mode for "${s.ref_name}" — what would actually go wrong?`
          : `What does failure look like, mechanically?`,
        category: "mechanism",
        why_it_matters:
          "Risks without named failure modes are aesthetic warnings. Naming the mode gives you something to monitor and prevent.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "bottleneck_mismatch":
      return {
        id: baseId,
        question: `The graph's structural bottleneck doesn't match the synthesized one. Which is actually load-bearing for you?`,
        category: "mechanism",
        why_it_matters:
          "When centrality and synthesis disagree, your work might be aimed at the wrong constraint. Naming the real one focuses everything downstream.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "shallow_leverage":
      return {
        id: baseId,
        question: s.ref_name
          ? `Why is "${s.ref_name}" load-bearing? Name the cascade or feedback loop, not the symptom.`
          : `What makes this leverage point load-bearing structurally?`,
        category: "mechanism",
        why_it_matters:
          "Shallow leverage points read like horoscopes. Naming the cascade or loop converts them into testable structural claims.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "missing_hidden_axiom":
      return {
        id: baseId,
        question: `Your synthesis surfaced no HIDDEN axioms. What's an unstated assumption your graph rests on?`,
        category: "axiom_visibility",
        why_it_matters:
          "Every non-trivial system has at least one load-bearing unstated assumption. Surfacing it is the highest-value act of synthesis.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "ambiguous_assumed_entity":
      return {
        id: baseId,
        question: s.ref_name
          ? `"${s.ref_name}" was inferred, not stated. Is this ambiguity strategic, premature, or harmful to resolve right now?`
          : `Is this inferred concept's ambiguity strategic, premature, or harmful?`,
        category: "domain",
        why_it_matters:
          "Tagging assumed entities by ambiguity type tells the LLM whether to push for resolution or preserve optionality.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "low_evidence_strength":
      return {
        id: baseId,
        question: `What level of evidence would change your mind here — a single paper, a meta-analysis, a personal observation?`,
        category: "evidence",
        why_it_matters:
          "The evidence bar you set tells the LLM when to call a claim 'established' vs 'speculative'.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "high_orphan_count":
      return {
        id: baseId,
        question: `Several concepts in your graph have no connections. Which ones should the system actively try to link, and which should it leave isolated?`,
        category: "scope",
        why_it_matters:
          "Telling the system which orphans to leave alone prevents it from forcing spurious edges into the graph.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "low_density":
      return {
        id: baseId,
        question: `Your graph is sparse. Should the system pursue more connections aggressively, or are you still adding raw concepts?`,
        category: "scope",
        why_it_matters:
          "Different phases need different pressure. Telling the system where you are in the loop prevents premature over-connection.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "stale_synthesis":
      return {
        id: baseId,
        question: `A new paper landed since the last synthesis. Should the system re-run synthesis now, or wait until you've added more?`,
        category: "scope",
        why_it_matters:
          "Re-synthesizing on every paper is expensive and noisy. Telling the system your cadence prevents both wasted compute and stale insights.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "missing_population_scope":
      return {
        id: baseId,
        question: `What population does this graph cover? (e.g. "adults 25-45", "B2B SaaS startups", "endurance athletes")`,
        category: "scope",
        why_it_matters:
          "Population scope is the single biggest determinant of which findings transfer. Without it the LLM over-generalizes.",
        answer_kind: "population",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    case "missing_user_goal":
      return {
        id: baseId,
        question: `What outcome are you working toward in this space? (specific, measurable if possible)`,
        category: "scope",
        why_it_matters:
          "Without a goal, every recommendation gets equal weight. Naming the goal lets the strategy engine prioritize.",
        answer_kind: "free_text",
        ref_id: s.ref_id ?? null,
        ref_name: s.ref_name ?? null,
        severity: s.severity,
        generated_from_signal_kind: s.kind,
      };

    default:
      // Exhaustive — TS will surface any new GapSignal kind here.
      return null;
  }
}

// ── Convert guardrail answers → a prompt block ───────────────────────
// Called by intent-context.ts so every downstream LLM prompt sees the
// user's tightening constraints. Returns "" when no answers exist so
// callers can interpolate unconditionally.

export interface GuardrailAnswer {
  answer: string;
  answered_at: string;
  question_text: string;
  category: string;
}

export function buildGuardrailBlock(
  answers: Record<string, GuardrailAnswer> | null | undefined,
): string {
  if (!answers) return "";
  const entries = Object.entries(answers);
  if (entries.length === 0) return "";
  // Group by category for readability — the LLM consumes a flat list
  // but humans editing the prompt benefit from the grouping.
  const byCat = new Map<string, Array<[string, GuardrailAnswer]>>();
  for (const [qid, a] of entries) {
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category)!.push([qid, a]);
  }
  const lines: string[] = [
    "",
    "## USER-SET GUARDRAILS",
    "The user has explicitly answered the following clarification questions to constrain how you reason about this space. Treat every answer as a HARD CONSTRAINT — your recommendations, syntheses, and edge proposals must respect these answers. If a candidate output would violate one, drop it; don't soften it.",
    "",
  ];
  const categoryOrder = [
    "falsifiability",
    "mechanism",
    "measurement",
    "evidence",
    "domain",
    "scope",
    "axiom_visibility",
  ];
  for (const cat of categoryOrder) {
    const items = byCat.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`### ${cat.toUpperCase()}`);
    for (const [_, a] of items) {
      lines.push(`- Q: ${a.question_text}`);
      lines.push(`  A: ${a.answer}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
