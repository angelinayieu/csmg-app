// ── Crucible insight synthesis (anti-platitude) ──────────────────────
//
// The problem: asked "what's the highest-leverage move?", an LLM returns the
// highest-PROBABILITY answer — i.e. the consensus platitude ("use a good
// metaphor", "reduce friction"). Insight is the opposite of high-probability.
//
// The fix is a two-pass pipeline that engineers for NON-OBVIOUSNESS + DENSITY:
//   1. DIVERGE (hot)   — a principal strategist generates 6 candidate leverage
//                        THESES, forced to invert defaults + carry mechanism /
//                        contrarian / tradeoff / second-order / defensibility.
//                        Platitudes are banned.
//   2. SKEPTIC (cool)  — a ruthless adversary attacks each ("obvious? generic?
//                        already done? won't move the needle?"), KILLS the weak,
//                        scores survivors on the insight rubric, sharpens them,
//                        names the core TENSION, and recommends one with its
//                        honest tradeoff.
//
// SERVER-ONLY. Soft-fails to null. Isolated module — does NOT touch the shared
// Crucible synthesis files (coordinate before graduating this in).

import { llmJSON, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";

export interface InsightThesis {
  title: string;
  thesis: string;
  mechanism: string;
  contrarian: string;
  tradeoff: string;
  secondOrder: string;
  defensibility: string;
  scores: {
    nonObvious: number;
    specificity: number;
    contrarian: number;
    mechanism: number;
    tradeoff: number;
    secondOrder: number;
    defensibility: number;
  };
  total: number; // 0–100
  keptBecause: string;
}

export interface InsightResult {
  tension: string;
  theses: InsightThesis[];
  recommendedTitle: string;
  recommendation: string;
}

// ── Pass 1: diverge ──

interface DivergeRaw {
  candidates: Array<{
    title: string; thesis: string; mechanism: string; contrarian: string; tradeoff: string; second_order: string; defensibility: string;
  }>;
}

const DIVERGE_SCHEMA = {
  name: "leverage_theses",
  schema: {
    type: "object", additionalProperties: false, required: ["candidates"],
    properties: {
      candidates: {
        type: "array", minItems: 5, maxItems: 7,
        items: {
          type: "object", additionalProperties: false,
          required: ["title", "thesis", "mechanism", "contrarian", "tradeoff", "second_order", "defensibility"],
          properties: {
            title: { type: "string", description: "The move, ≤ 10 words. Specific, not a category." },
            thesis: { type: "string", description: "1–2 sentences: the sharp, non-obvious claim. Names the default it inverts." },
            mechanism: { type: "string", description: "HOW it creates leverage, causally — the chain of effect." },
            contrarian: { type: "string", description: "Where conventional wisdom / what incumbents do is WRONG here." },
            tradeoff: { type: "string", description: "What it costs / what breaks — honest." },
            second_order: { type: "string", description: "The non-obvious downstream consequence you wouldn't predict." },
            defensibility: { type: "string", description: "Why incumbents don't / can't copy it." },
          },
        },
      },
    },
  },
} as const;

function divergeSystem(): string {
  return [
    "You are a PRINCIPAL strategist (think top founder / partner-level) generating leverage THESES for a product objective. A leverage thesis is the NON-OBVIOUS move that reframes everything downstream.",
    "An adversarial skeptic will judge your candidates next and KILL any that are obvious, generic, or best-practice. So earn your place:",
    "  • BAN platitudes. Never emit 'be user-friendly', 'reduce friction', 'use a good metaphor', 'make it simple', 'improve UX', 'leverage AI'. If a smart practitioner would already assume it, DO NOT write it.",
    "  • Each thesis must INVERT or CHALLENGE a default everyone in this space holds. State the default, then break it.",
    "  • Be SPECIFIC, not categorical. 'Make the relationship the unit of navigation, not the node' beats 'use a metaphor'.",
    "  • Generate genuinely DIFFERENT bets — at least TWO must be contrarian/inverted (e.g. 'don't build the obvious thing at all').",
    "  • Each carries: a concrete MECHANISM (causal chain), the CONTRARIAN angle, the honest TRADEOFF (what breaks), the SECOND-ORDER effect, and DEFENSIBILITY (why incumbents can't copy).",
    "Generate 6 candidate theses. Density and surprise over coverage. Return the leverage_theses tool only.",
  ].join("\n");
}

// ── Pass 2: skeptic + rank ──

interface SkepticRaw {
  tension: string;
  theses: Array<{
    title: string; thesis: string; mechanism: string; contrarian: string; tradeoff: string; second_order: string; defensibility: string;
    scores: { non_obvious: number; specificity: number; contrarian: number; mechanism: number; tradeoff: number; second_order: number; defensibility: number };
    kept_because: string;
  }>;
  recommended_title: string;
  recommendation: string;
}

const SKEPTIC_SCHEMA = {
  name: "insight_verdict",
  schema: {
    type: "object", additionalProperties: false, required: ["tension", "theses", "recommended_title", "recommendation"],
    properties: {
      tension: { type: "string", description: "The core CONTRADICTION the objective turns on (1 sentence) — the thing the best thesis resolves." },
      theses: {
        type: "array", minItems: 1, maxItems: 3,
        description: "The SURVIVORS only — 2–3 sharpest theses. Kill the obvious/generic/already-done.",
        items: {
          type: "object", additionalProperties: false,
          required: ["title", "thesis", "mechanism", "contrarian", "tradeoff", "second_order", "defensibility", "scores", "kept_because"],
          properties: {
            title: { type: "string" }, thesis: { type: "string", description: "SHARPENED — denser + more specific than the input." },
            mechanism: { type: "string" }, contrarian: { type: "string" }, tradeoff: { type: "string" }, second_order: { type: "string" }, defensibility: { type: "string" },
            scores: {
              type: "object", additionalProperties: false,
              required: ["non_obvious", "specificity", "contrarian", "mechanism", "tradeoff", "second_order", "defensibility"],
              properties: {
                non_obvious: { type: "number", description: "0–5. 5 = an expert would say 'I hadn't thought of that'. 0 = best-practice." },
                specificity: { type: "number", description: "0–5. concrete mechanism vs vague category." },
                contrarian: { type: "number", description: "0–5. genuinely contradicts conventional wisdom." },
                mechanism: { type: "number", description: "0–5. strength of the causal chain." },
                tradeoff: { type: "number", description: "0–5. honest about what breaks." },
                second_order: { type: "number", description: "0–5. surprising downstream consequence." },
                defensibility: { type: "number", description: "0–5. hard for incumbents to copy." },
              },
            },
            kept_because: { type: "string", description: "≤ 18 words: why this survived the skeptic." },
          },
        },
      },
      recommended_title: { type: "string" },
      recommendation: { type: "string", description: "1–2 sentences: which bet to make + the honest tradeoff of choosing it." },
    },
  },
} as const;

function skepticSystem(): string {
  return [
    "You are a RUTHLESS adversarial skeptic + principal strategy partner. You're handed candidate leverage theses.",
    "For EACH, attack it hard: Is it obvious? Generic best-practice? Already done by incumbents? Would it actually move the needle, or just sound smart? Be harsh — most candidates are weaker than they look.",
    "KILL any that are obvious / generic / already-done. Keep ONLY the 2–3 sharpest survivors.",
    "For survivors: SHARPEN each thesis to be denser + more specific than you received it. Score it on the insight rubric (each 0–5): non_obvious · specificity · contrarian · mechanism · tradeoff · second_order · defensibility. Do not inflate — a 5 means an expert would genuinely be surprised.",
    "Then name the CORE TENSION the objective turns on — the contradiction the best thesis resolves (this is where leverage lives). Recommend ONE bet + its honest tradeoff.",
    "Reject anything that reads like a best-practices listicle. Return the insight_verdict tool only.",
  ].join("\n");
}

const WEIGHTS = { non_obvious: 3, specificity: 2, contrarian: 2, mechanism: 2, tradeoff: 1, second_order: 2, defensibility: 1 };
const MAX = 5 * (3 + 2 + 2 + 2 + 1 + 2 + 1); // 65
const clamp5 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0);

export async function synthesizeInsight(opts: {
  objective: string;
  context?: string;
}): Promise<InsightResult | null> {
  const objective = (opts.objective ?? "").trim();
  if (!objective) return null;
  const ctx = (opts.context ?? "").trim();

  // Pass 1 — diverge (hot, contrarian).
  let diverge: DivergeRaw;
  try {
    diverge = await llmJSON<DivergeRaw>({
      system: divergeSystem(),
      user: `OBJECTIVE\n${objective}${ctx ? `\n\nWHAT WE KNOW\n${ctx}` : ""}\n\nGenerate 6 non-obvious leverage theses. Ban platitudes; invert defaults; be specific.`,
      // Sonnet for divergence — it still honors high temperature (Opus deprecates it).
      provider: "anthropic", model: BEST_FAST_CLAUDE_MODEL, maxTokens: 2600, temperature: 0.9,
      responseSchema: DIVERGE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    console.warn("[crucible-insight] diverge failed:", err);
    return null;
  }
  const candidates = (diverge?.candidates ?? []).slice(0, 7);
  if (candidates.length === 0) return null;

  // Pass 2 — skeptic + rank.
  const candBlock = candidates.map((c, i) =>
    `#${i + 1} ${c.title}\n  thesis: ${c.thesis}\n  mechanism: ${c.mechanism}\n  contrarian: ${c.contrarian}\n  tradeoff: ${c.tradeoff}\n  second-order: ${c.second_order}\n  defensibility: ${c.defensibility}`,
  ).join("\n\n");
  let verdict: SkepticRaw;
  try {
    verdict = await llmJSON<SkepticRaw>({
      system: skepticSystem(),
      user: `OBJECTIVE\n${objective}\n\nCANDIDATE THESES\n${candBlock}\n\nAttack each, kill the obvious, keep + sharpen the 2–3 strongest, score them, name the core tension, recommend one.`,
      // Opus for judgment (temperature omitted — opus-4 rejects it).
      provider: "anthropic", model: BEST_CLAUDE_MODEL, maxTokens: 3200,
      responseSchema: SKEPTIC_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    console.warn("[crucible-insight] skeptic failed:", err);
    return null;
  }

  const theses: InsightThesis[] = (verdict?.theses ?? []).map((t) => {
    const s = t.scores ?? ({} as SkepticRaw["theses"][number]["scores"]);
    const sc = {
      nonObvious: clamp5(s.non_obvious), specificity: clamp5(s.specificity), contrarian: clamp5(s.contrarian),
      mechanism: clamp5(s.mechanism), tradeoff: clamp5(s.tradeoff), secondOrder: clamp5(s.second_order), defensibility: clamp5(s.defensibility),
    };
    const raw =
      sc.nonObvious * WEIGHTS.non_obvious + sc.specificity * WEIGHTS.specificity + sc.contrarian * WEIGHTS.contrarian +
      sc.mechanism * WEIGHTS.mechanism + sc.tradeoff * WEIGHTS.tradeoff + sc.secondOrder * WEIGHTS.second_order + sc.defensibility * WEIGHTS.defensibility;
    return {
      title: t.title, thesis: t.thesis, mechanism: t.mechanism, contrarian: t.contrarian, tradeoff: t.tradeoff,
      secondOrder: t.second_order, defensibility: t.defensibility, scores: sc, total: Math.round((raw / MAX) * 100),
      keptBecause: t.kept_because,
    };
  }).sort((a, b) => b.total - a.total);

  if (theses.length === 0) return null;
  return {
    tension: String(verdict?.tension ?? "").trim(),
    theses,
    recommendedTitle: String(verdict?.recommended_title ?? theses[0].title).trim(),
    recommendation: String(verdict?.recommendation ?? "").trim(),
  };
}
