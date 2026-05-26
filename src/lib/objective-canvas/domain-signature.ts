// ── Domain Signature ──────────────────────────────────────────────
//
// Heuristic-only domain detector. Reads the objective text +
// clarifying answers and assigns the space to one of a handful of
// canonical domains. The signature drives expansion-catalog lookups
// so the L3 surfaces (Mechanism Story / Data Model / etc.) adapt to
// what kind of objective the user is running.
//
// Why heuristic, not LLM: cheap, deterministic, runs synchronously
// inside the expansion route. Mistakes are recoverable — the user
// will eventually be able to override the signature in settings.
//
// Default is "software" because that's the primary use case;
// fallback rule: when no rule matches, return "software" rather
// than "general" so the user always sees concrete depth content.

export type DomainSignature =
  | "software" // app / platform / SaaS / product
  | "journaling" // wellness / reflective practice
  | "book_analysis" // study / synthesis of text
  | "passion_chasing" // career / direction / open-ended search
  | "startup" // business + product + GTM combined
  | "research"; // academic / open-ended inquiry

interface DomainSignal {
  signature: DomainSignature;
  /** Keywords / phrases — case-insensitive substring match. */
  keywords: string[];
  /** Weight when a keyword matches. */
  weight: number;
}

/** Detection rules in priority order — most-specific first.
 *  Each match adds weight; the highest-scoring signature wins.
 *  Ties go to the earlier rule (so "startup" beats "software"
 *  when both fire because users mentioning "startup" mean it). */
const RULES: DomainSignal[] = [
  {
    signature: "startup",
    keywords: [
      "startup",
      "fundrais",
      "investor",
      "pre-seed",
      "seed round",
      "go to market",
      "gtm",
      "founders",
      "co-founder",
      "ycombinator",
      "y combinator",
      "vc-backed",
      "burn rate",
      "runway",
    ],
    weight: 3,
  },
  {
    signature: "journaling",
    keywords: [
      "journal",
      "journaling",
      "anxiety",
      "self-reflect",
      "self reflect",
      "mood",
      "ruminat",
      "therapy",
      "process my",
      "process this",
      "feelings about",
      "emotional",
      "mindfulness",
      "gratitude",
      "reflective practice",
    ],
    weight: 3,
  },
  {
    signature: "book_analysis",
    keywords: [
      "this book",
      "the book",
      "chapter",
      "author",
      "reading list",
      "internalize the",
      "synthesize the",
      "study group",
      "key concepts of",
      "framework from",
      "lecture series",
      "textbook",
    ],
    weight: 3,
  },
  {
    signature: "passion_chasing",
    keywords: [
      "career change",
      "what should i do",
      "find my passion",
      "next chapter",
      "figure out my",
      "passion project",
      "side quest",
      "explore a new",
      "i don't know what",
      "i dont know what",
      "where to direct",
      "what to do with my life",
    ],
    weight: 3,
  },
  {
    signature: "research",
    keywords: [
      "thesis",
      "literature review",
      "research question",
      "academic",
      "paper on",
      "investigate the",
      "open question",
      "hypothesis about",
      "phd",
      "publish",
    ],
    weight: 2,
  },
  {
    signature: "software",
    keywords: [
      "app",
      "application",
      "platform",
      "saas",
      "product",
      "feature",
      "user",
      "users",
      "ux",
      "ui",
      "build a",
      "ship",
      "release",
      "mvp",
      "backend",
      "frontend",
      "database",
      "api",
      "endpoint",
      "schema",
      "interface",
    ],
    weight: 1,
  },
];

interface DetectionInput {
  objectiveText: string;
  clarifyingAnswers?: Array<{ question: string; answer: string }>;
}

/** Run the heuristic. Combines objective + clarifying answers into
 *  one searchable blob (lowercased), scores each rule, returns the
 *  winner. Always returns SOMETHING — defaults to "software". */
export function detectDomainSignature(
  input: DetectionInput,
): DomainSignature {
  const blob = [
    input.objectiveText,
    ...(input.clarifyingAnswers ?? []).flatMap((a) => [a.question, a.answer]),
  ]
    .join(" ")
    .toLowerCase();

  if (blob.trim().length === 0) return "software";

  // Score each rule.
  const scored: Array<{ signature: DomainSignature; score: number }> = [];
  for (const rule of RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (blob.includes(kw.toLowerCase())) score += rule.weight;
    }
    if (score > 0) scored.push({ signature: rule.signature, score });
  }

  if (scored.length === 0) return "software";

  // Sort by score desc, stable on rule order via index.
  scored.sort((a, b) => b.score - a.score);
  return scored[0].signature;
}
