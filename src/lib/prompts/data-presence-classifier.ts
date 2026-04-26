// ── Data-Presence Classifier prompt ──────────────────────────────────
//
// Orthogonal to rigor-intake (which scores analysis QUALITY) and
// epistemic-classifier (which classifies analytical FRAMEWORK). This
// classifier answers a single question:
//
//   "What RAW MATERIALS did the user bring to this intake?"
//
// Its output tags drive two downstream decisions:
//   1. frame-extractor axis gating — Financial axis is padding if the
//      user has no financial data; Evidence axis is padding if they
//      can't cite anything measurable.
//   2. `spaces.twin_mode` — derived deterministically from the tags:
//        telemetry present                → "simulation"
//        historical data OR baseline      → "observational"
//        only spec OR only an idea        → "structural"
//
// One LLM call, ~200-token prompt. Soft-fails to a neutral fallback
// (all tags false, mode=null) so the downstream pipeline stays happy.

export type TwinMode = "structural" | "observational" | "simulation";

export interface DataPresenceTags {
  /** Live-stream metrics, sensor readings, event logs, CSV exports,
   *  telemetry dumps. "I have pump vibration data every 5 minutes." */
  has_telemetry: boolean;
  /** Past outcomes, results, finished-case records — not live, but
   *  measured. "Last quarter's revenue by segment." */
  has_historical_output: boolean;
  /** A baseline / reference point the user wants to beat or match.
   *  "Current close rate is 12% and I want 18%." */
  has_baseline: boolean;
  /** A specification, requirements doc, process description, SOP, or
   *  architectural design. "Here's our onboarding flow." */
  has_spec: boolean;
  /** Nothing but a hypothesis, idea, or open question. "I'm thinking
   *  about improving our sales process." Set when all others are false. */
  has_just_idea: boolean;
  /** 0..1 composite: how data-rich the intake is. Higher = more raw
   *  material for downstream inference. Computed here rather than in
   *  consumers to keep a single authoritative score. */
  data_presence_score: number;
  /**
   * Short quotes/paraphrases from the input that justified each true
   * tag. Max 4 entries, each ≤120 chars. The UI surfaces these as
   * "we detected these data sources in your input" so the user can
   * correct misclassification.
   */
  evidence_excerpts: string[];
}

export interface DataPresencePromptInput {
  /** Raw intake text — the user's own words. Classifier must not
   *  hallucinate evidence that isn't here. */
  inputText: string;
  /** Optional rigor-intake summary so the classifier can see what
   *  rigor-intake already parsed (numbers, citations, etc). Kept
   *  small — classifier doesn't need full KG context. */
  rigorSummary?: string;
}

export interface DataPresencePromptParts {
  system: string;
  user: string;
}

export function buildDataPresencePrompt(
  input: DataPresencePromptInput,
): DataPresencePromptParts {
  const rigorBlock = input.rigorSummary
    ? `\nRIGOR-INTAKE SIGNALS (already parsed by an earlier stage — use for cross-checking, do not re-derive):\n${input.rigorSummary.slice(0, 400)}\n`
    : "";

  const system = `You are a DATA-PRESENCE CLASSIFIER. Given a user's raw intake text, tag what RAW MATERIALS they have brought to the problem.

You are NOT rating the quality of their reasoning, the clarity of their writing, or the feasibility of their goal. You are asking one question per tag: is THIS kind of data/material present in their input?

TAGS (all independent booleans; more than one can be true):

1. has_telemetry
   Live or streaming measurements. Sensor feeds, event logs, continuous metrics, real-time dashboards, exported CSV/JSON of measured values. Signals: explicit numbers over time ("pressure 230°C at 14:32"), references to sensors / monitors / logs / dashboards / pipelines.

2. has_historical_output
   Past measured outcomes. Results, case records, finished-cycle data. Not live, but concrete and measured. Signals: specific past numbers ("Q3 revenue was $2.4M"), case studies with outcomes, historical trends.

3. has_baseline
   A known starting reference to improve from or match. Signals: "current X is Y and I want Z", "we're at 12% close rate", "today the system takes 45 seconds".

4. has_spec
   A written description of the process, system, architecture, SOP, or requirements. Signals: step-by-step flows, named components, process diagrams referenced, "our system works like this:".

5. has_just_idea
   The input is a theory, hypothesis, curiosity, or open-ended exploration with NONE of the above. Set true ONLY if all of 1-4 are false. Signals: "I'm thinking about...", "I want to explore...", no concrete numbers, no specific past outcomes, no process descriptions.

NOT a tag — judgment calls that fail:
- Do NOT set has_telemetry just because the user mentions having "data". They must imply live/streaming/sensor nature. Historical data → has_historical_output instead.
- Do NOT set has_spec for a one-sentence description of their field. Specs are concrete process / system / requirement documents.
- Do NOT double-count. A baseline IS historical data, but you tag both true only if the user mentions BOTH a current state AND broader history.

SCORE:
data_presence_score is a 0..1 composite. Rough recipe (but judge, don't compute mechanically):
  - 0.00 = only has_just_idea
  - 0.25 = has_spec only
  - 0.45 = has_spec + has_baseline
  - 0.65 = has_historical_output + has_spec (+ baseline)
  - 0.85+ = has_telemetry (+ anything else)

EVIDENCE:
For each true tag, quote ≤120 chars from the input that justifies it. Max 4 total excerpts. The user sees these back — if you can't find a quote, the tag is probably wrong.

OUTPUT — strict JSON:

{
  "has_telemetry": boolean,
  "has_historical_output": boolean,
  "has_baseline": boolean,
  "has_spec": boolean,
  "has_just_idea": boolean,
  "data_presence_score": 0.0-1.0,
  "evidence_excerpts": ["string", ...]  // max 4
}`;

  const user = `INTAKE INPUT:
"""
${input.inputText.slice(0, 3500)}
"""
${rigorBlock}
Classify. Return strict JSON.`;

  return { system, user };
}

// ── Validator ────────────────────────────────────────────────────────
//
// Coerces to neutral defaults on any malformation. Never throws;
// upstream callers route the empty bundle into a null twin_mode.

export function validateDataPresence(raw: unknown): DataPresenceTags {
  const empty: DataPresenceTags = {
    has_telemetry: false,
    has_historical_output: false,
    has_baseline: false,
    has_spec: false,
    has_just_idea: false,
    data_presence_score: 0,
    evidence_excerpts: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  const bool = (k: string): boolean => r[k] === true;
  const has_telemetry = bool("has_telemetry");
  const has_historical_output = bool("has_historical_output");
  const has_baseline = bool("has_baseline");
  const has_spec = bool("has_spec");

  // has_just_idea must be TRUE only if every other tag is false.
  // If the model contradicts itself, we override to the consistent value.
  const anyPresent = has_telemetry || has_historical_output || has_baseline || has_spec;
  const has_just_idea = anyPresent ? false : bool("has_just_idea") || !anyPresent;

  const scoreRaw = typeof r.data_presence_score === "number" ? r.data_presence_score : 0;
  const data_presence_score = Math.min(1, Math.max(0, scoreRaw));

  const excerptsRaw = Array.isArray(r.evidence_excerpts) ? r.evidence_excerpts : [];
  const evidence_excerpts = excerptsRaw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.slice(0, 120))
    .slice(0, 4);

  return {
    has_telemetry,
    has_historical_output,
    has_baseline,
    has_spec,
    has_just_idea,
    data_presence_score,
    evidence_excerpts,
  };
}

// ── Twin-mode derivation ─────────────────────────────────────────────
//
// Deterministic mapping from tags → mode. Kept here (not in the
// pipeline file) so that callers who already have tags can derive the
// mode without re-running the classifier.
//
// Rules:
//   has_telemetry                            → "simulation"
//   has_historical_output OR has_baseline    → "observational"
//   has_spec only, or has_just_idea          → "structural"
//
// Precedence runs top-to-bottom, most-capable wins.

export function deriveTwinMode(tags: DataPresenceTags): TwinMode {
  if (tags.has_telemetry) return "simulation";
  if (tags.has_historical_output || tags.has_baseline) return "observational";
  return "structural";
}
