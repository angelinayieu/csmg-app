// ── Idea engine ──────────────────────────────────────────────────────
//
// The generative layer the seed was missing. The reasoning pipeline only
// DECOMPOSES the input (levers/principles/variables) — it never produces a field
// of discrete concepts to choose among, so "find my best idea" had nothing to
// rank. This builds that field:
//
//   1. GENERATE (divergent, temp high) — 15–25 candidate concepts across FOUR
//      origins so it isn't just echoing the input:
//        • extracted     — discrete ideas already latent in the notes/objective
//        • recombination — cross the variable axes into new strategies
//        • analogical    — transfer a winning pattern from another domain
//        • constraint    — what the constraint set UNIQUELY permits vs incumbents
//   2. SCORE (convergent, temp low) — each candidate on the objective's value
//      axes (income / traction / virality / moat / why-now), grounded in the
//      levers + alternatives.
//   3. RANK — composite computed IN CODE from transparent weights (no opaque
//      "72 value"), then the model defends why #1 beat #2/#3.
//
// SERVER-ONLY. Two LLM calls. Soft-fails to a minimal field so the surface never
// blanks. Reuses the seed's own internal as the substrate.

import { llmJSON, BEST_CLAUDE_MODEL } from "@/lib/llm";
import type { IdeaOrigin, IdeaScores, SeedIdea, SeedIdeaField, SeedInternal } from "./seed-types";

/** Default value-axis weights — income/traction/virality lead (the user's ask),
 *  moat + why-now temper for venture durability. Sums to 1. */
const WEIGHTS: IdeaScores = { income: 0.3, traction: 0.25, virality: 0.25, moat: 0.1, whyNow: 0.1 };
const AXES = ["income", "traction", "virality", "moat", "whyNow"];
const ORIGINS: IdeaOrigin[] = ["extracted", "recombination", "analogical", "constraint"];

const GEN_SCHEMA = {
  name: "idea_field",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        description: "15–25 DISTINCT product/strategy concepts. Genuinely different bets — not rewordings. Spread across all four origins.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "summary", "origin"],
          properties: {
            title: { type: "string", description: "The concept, ≤ 12 words. Concrete + specific." },
            summary: { type: "string", description: "What it is + who it's for, ≤ 32 words." },
            origin: { type: "string", enum: ORIGINS, description: "extracted = from the notes; recombination = crossed variables; analogical = pattern from another domain; constraint = what the constraints uniquely allow." },
          },
        },
      },
    },
  },
} as const;

const SCORE_SCHEMA = {
  name: "idea_scores",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scored", "whyTopWon"],
    properties: {
      scored: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "income", "traction", "virality", "moat", "whyNow", "rationale"],
          properties: {
            index: { type: "number", description: "Index into the candidate list." },
            income: { type: "number", description: "0–100: revenue potential + willingness-to-pay." },
            traction: { type: "number", description: "0–100: speed to first real users / pull." },
            virality: { type: "number", description: "0–100: built-in spread / network effect." },
            moat: { type: "number", description: "0–100: defensibility once others copy." },
            whyNow: { type: "number", description: "0–100: why this wins NOW (tech/market shift)." },
            rationale: { type: "string", description: "≤ 1 sentence: the binding reason for these scores." },
          },
        },
      },
      whyTopWon: { type: "string", description: "Once scored, why the top concept beats the #2 and #3 — the defense of the pick. ≤ 2 sentences." },
    },
  },
} as const;

const block = (label: string, xs: string[]) => (xs.length ? `${label}\n${xs.map((x) => `- ${x}`).join("\n")}` : "");
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "idea";
const clamp100 = (n: unknown) => Math.max(0, Math.min(100, typeof n === "number" && isFinite(n) ? n : 0));

function composite(s: IdeaScores): number {
  return Math.round(
    s.income * WEIGHTS.income +
      s.traction * WEIGHTS.traction +
      s.virality * WEIGHTS.virality +
      s.moat * WEIGHTS.moat +
      s.whyNow * WEIGHTS.whyNow,
  );
}

interface Candidate { title: string; summary: string; origin: IdeaOrigin }

/** Generate + score + rank the idea field for an objective. Never throws. */
export async function generateAndRankIdeas(internal: SeedInternal): Promise<SeedIdeaField> {
  const nowIso = new Date().toISOString();
  const objective = (internal.sharpenedObjective || "").trim();

  // Substrate the generator draws on (the levers/variables/constraints/notes are
  // FILTERS + raw material, not the output).
  const substrate = [
    `OBJECTIVE\n${objective || "(none)"}`,
    block("VARIABLES (cross these into new strategies)", internal.canonicalVariables.map((v) => v.label)),
    block("CONSTRAINTS (what must hold — find what they uniquely permit)", internal.constraints.map((c) => `${c.label} (${c.kind})`)),
    block("LEVERAGE POINTS (high-leverage places to act)", internal.leveragePoints.map((l) => l.label)),
    block("FIRST PRINCIPLES", internal.firstPrinciples.map((p) => `${p.label}: ${p.statement}`)),
    block("NOTES / KNOWN", internal.landscape.map((l) => l.fact)),
    block("EXISTING ALTERNATIVES (do NOT re-propose these — beat them)", internal.alternatives.map((a) => `${a.name} — fails at: ${a.failure}`)),
  ]
    .filter(Boolean)
    .join("\n\n");

  // ── Phase 1: GENERATE a wide, genuinely-divergent field ──
  let candidates: Candidate[] = [];
  try {
    const gen = await llmJSON<{ candidates?: Array<{ title?: string; summary?: string; origin?: string }> }>({
      system: [
        "You are an idea engine for a founder choosing what to BUILD. GENERATE A WIDE FIELD of genuinely-different candidate concepts — do NOT just restate the inputs in fancier words.",
        "Produce 15–25 DISTINCT concepts spread across FOUR origins:",
        "• extracted — discrete ideas already implied by the notes/objective.",
        "• recombination — CROSS the variables into strategies that aren't in the notes (e.g. variable A × variable C → a new wedge).",
        "• analogical — transfer a winning pattern from another domain ('the Stripe-for-X', 'the Notion-model applied to Y').",
        "• constraint — what the constraint set UNIQUELY permits that incumbents can't do.",
        "Every concept must be concrete and buildable, not a theme. Different BETS, not rewordings. Return the idea_field tool only.",
      ].join("\n"),
      user: `${substrate}\n\nGenerate the candidate field now — maximize genuine spread across the four origins.`,
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 3200,
      temperature: 0.85,
      responseSchema: GEN_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
    candidates = (gen?.candidates ?? [])
      .map((c) => ({
        title: String(c?.title ?? "").trim().slice(0, 120),
        summary: String(c?.summary ?? "").trim().slice(0, 240),
        origin: (ORIGINS.includes(c?.origin as IdeaOrigin) ? c!.origin : "extracted") as IdeaOrigin,
      }))
      .filter((c) => c.title);
  } catch (err) {
    console.warn("[idea-engine] generate failed (soft):", err);
  }

  // Dedupe by title slug; cap at 25 to bound the scoring call.
  const seen = new Set<string>();
  candidates = candidates.filter((c) => {
    const k = slugify(c.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 25);

  if (candidates.length === 0) {
    return { axes: AXES, weights: WEIGHTS, ideas: [], topPick: "", whyTopWon: "Idea generation unavailable — try again, or add more context in chat.", generatedCount: 0, updatedAt: nowIso };
  }

  // ── Phase 2: SCORE each candidate on the value axes ──
  const generatedCount = candidates.length;
  let scoredRaw: { scored?: Array<{ index?: number; income?: number; traction?: number; virality?: number; moat?: number; whyNow?: number; rationale?: string }>; whyTopWon?: string } = {};
  try {
    scoredRaw = await llmJSON({
      system: [
        "You are scoring candidate concepts for a founder. Score each on five 0–100 axes: income (revenue + willingness-to-pay), traction (speed to first real users), virality (built-in spread / network effect), moat (defensibility), why-now (why it wins NOW).",
        "Be discriminating — spread the scores; do not cluster everything at 70. Ground each score in the objective + the existing alternatives (a concept that an incumbent already does well scores LOW on moat). Then state why the eventual top concept beats #2/#3.",
        "Return the idea_scores tool only.",
      ].join("\n"),
      user: [
        `OBJECTIVE\n${objective || "(none)"}`,
        block("EXISTING ALTERNATIVES (score moat against these)", internal.alternatives.map((a) => `${a.name} — ${a.failure}`)),
        "CANDIDATES (score every one by index):",
        candidates.map((c, i) => `[${i}] (${c.origin}) ${c.title} — ${c.summary}`).join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 3200,
      temperature: 0.3,
      responseSchema: SCORE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    console.warn("[idea-engine] scoring failed (soft → flat scores):", err);
  }

  const scoreByIndex = new Map<number, { scores: IdeaScores; rationale: string }>();
  for (const s of scoredRaw?.scored ?? []) {
    const idx = typeof s?.index === "number" ? s.index : -1;
    if (idx < 0 || idx >= candidates.length) continue;
    scoreByIndex.set(idx, {
      scores: { income: clamp100(s?.income), traction: clamp100(s?.traction), virality: clamp100(s?.virality), moat: clamp100(s?.moat), whyNow: clamp100(s?.whyNow) },
      rationale: String(s?.rationale ?? "").trim().slice(0, 200),
    });
  }

  const usedSlugs = new Set<string>();
  const ideas: SeedIdea[] = candidates.map((c, i) => {
    const sc = scoreByIndex.get(i)?.scores ?? { income: 50, traction: 50, virality: 50, moat: 50, whyNow: 50 };
    let slug = slugify(c.title);
    while (usedSlugs.has(slug)) slug = `${slug}-2`;
    usedSlugs.add(slug);
    return {
      slug,
      title: c.title,
      summary: c.summary,
      origin: c.origin,
      scores: sc,
      composite: composite(sc),
      rationale: scoreByIndex.get(i)?.rationale ?? "",
      rank: 0,
    };
  });

  ideas.sort((a, b) => b.composite - a.composite);
  ideas.forEach((idea, i) => { idea.rank = i + 1; });

  return {
    axes: AXES,
    weights: WEIGHTS,
    ideas,
    topPick: ideas[0]?.slug ?? "",
    whyTopWon: String(scoredRaw?.whyTopWon ?? "").trim().slice(0, 320) || (ideas[0] ? `${ideas[0].title} leads on the weighted axes.` : ""),
    generatedCount,
    updatedAt: nowIso,
  };
}
