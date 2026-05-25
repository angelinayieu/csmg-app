// Deterministic causal_role classifier.
//
// Used as a fallback when the LLM omits the [ROLE: ...] tag during
// structuring (which currently happens ~100% of the time because no
// responseSchema forces it). Mirrored in SQL by the
// 20260824_causal_role_backfill migration so existing rows get the
// same treatment.
//
// Roles (matches sanitize.CAUSAL_ROLES exactly):
//   goal         — optimization target / north star
//   truth        — declarative claim or principle ("X causes Y")
//   evidence     — atomic fact, sub-component, or external data
//   deliverable  — process / action / method (what you DO)
//   application  — framework / system / protocol (applied form)
//   outcome      — measured result / metric / observable indicator
//
// Precedence (first match wins):
//   1. goal       — explicit goal/objective signals in name
//   2. evidence   — "Sub-component of …" boilerplate or knowledge_layer=external + atomic shape
//   3. application — applied-framework signals (NIST, ISO, protocol, ritual, …)
//   4. deliverable — process category + verb-noun name shape
//   5. outcome    — abstract category + metric/measurement signals
//   6. truth      — default for everything else

// Self-contained to keep sanitize.ts free of circular imports —
// sanitize.ts re-exports CAUSAL_ROLES and consumes this file.
export type CausalRole =
  | "truth"
  | "evidence"
  | "deliverable"
  | "application"
  | "outcome"
  | "goal";

interface InferInputs {
  name: string;
  description: string | null;
  entity_category: string | null;
  importance: string | null;
  knowledge_layer: string | null;
}

const GOAL_NAME_PATTERNS = [
  /\bnorth[- ]?star\b/i,
  /\boptimization (target|point|goal)\b/i,
  /\bprimary (goal|objective)\b/i,
  /\bproblem statement\b/i,
];

const APPLICATION_KEYWORDS = [
  "framework",
  "protocol",
  "ritual",
  "platform",
  "playbook",
  "checklist",
  "regimen",
  "standard",
];

const DELIVERABLE_PROCESS_KEYWORDS = [
  "analysis",
  "testing",
  "collection",
  "calibration",
  "modeling",
  "design",
  "training",
  "review",
  "evaluation",
  "validation",
  "implementation",
  "monitoring",
  "auditing",
  "tracking",
  "scoring",
  "logging",
  "scheduling",
];

const OUTCOME_METRIC_KEYWORDS = [
  "metric",
  "score",
  "rate",
  "ratio",
  "level",
  "percentage",
  "index",
  "indicator",
  "performance",
  "throughput",
  "latency",
  "yield",
  "conversion",
  "retention",
  "engagement",
];

function lc(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

export function inferCausalRole(input: InferInputs): CausalRole {
  const name = lc(input.name);
  const desc = lc(input.description);
  const cat = lc(input.entity_category);
  const imp = lc(input.importance);
  const kl = lc(input.knowledge_layer);

  // 1. Goal — explicit name signal OR fundamental + optimization-shaped.
  if (GOAL_NAME_PATTERNS.some((re) => re.test(input.name))) {
    return "goal";
  }
  if (
    imp === "fundamental" &&
    (name.includes("goal") ||
      name.includes("objective") ||
      desc.includes("optimization point") ||
      desc.includes("north star"))
  ) {
    return "goal";
  }

  // 2. Evidence — the structurer marks atomic units with this exact prefix.
  //    Also: knowledge_layer=external + short factual description.
  if (desc.startsWith("sub-component of") || desc.includes("fundamental unit of")) {
    return "evidence";
  }
  if (kl === "external" && (cat === "concrete" || cat === "epistemic")) {
    return "evidence";
  }

  // 3. Application — applied framework / system / protocol.
  if (APPLICATION_KEYWORDS.some((kw) => name.includes(kw))) {
    return "application";
  }
  if (APPLICATION_KEYWORDS.some((kw) => desc.includes(kw)) && cat === "abstract") {
    return "application";
  }

  // 4. Deliverable — entity_category=process + verb-noun shape.
  if (cat === "process") {
    return "deliverable";
  }
  if (DELIVERABLE_PROCESS_KEYWORDS.some((kw) => name.includes(kw))) {
    return "deliverable";
  }

  // 5. Outcome — measurable / metric-shaped.
  if (OUTCOME_METRIC_KEYWORDS.some((kw) => name.includes(kw) || desc.includes(kw))) {
    return "outcome";
  }
  if (cat === "relational" && (imp === "critical" || imp === "important")) {
    return "outcome";
  }

  // 6. Default — declarative claim / proposition.
  return "truth";
}
