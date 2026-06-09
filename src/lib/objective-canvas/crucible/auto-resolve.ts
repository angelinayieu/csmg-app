// ── Auto-resolve ─────────────────────────────────────────────────────
//
// The "build it for me" path. Instead of asking the founder every open
// question, the AI answers them ITSELF — but not with a single lazy best-guess
// (which produced the generic reasoning we tore out). For each open question it
// generates N genuinely-different candidate answers (distinct strategic bets,
// not rewordings), scores each on how well it advances the objective's decisive
// factors + how realistic it is, and picks the TOP one. Best-of-N → rank → pick.
//
// One LLM call per round (all open questions at once) keeps it cheap. The chosen
// answers feed the SAME analyze+advance path a human answer would. SERVER-ONLY.
// Soft-fails to a neutral first-draft answer so the loop never stalls.

import { llmJSON, BEST_CLAUDE_MODEL } from "@/lib/llm";
import type { FactorLite } from "./crucible-prompts";

export interface AutoResolveQuestion {
  id: string;
  text: string;
  intent?: string;
}

export interface AutoResolvedAnswer {
  questionId: string;
  text: string;
  /** How many candidate answers were weighed (for transparency on the card). */
  candidates: number;
  /** Why the winner won (1 line). */
  rationale?: string;
  /** The strongest answer NOT chosen — shows the road not taken. */
  runnerUp?: string;
}

interface AutoResolveParams {
  objective: string;
  preamble?: string;
  factors: FactorLite[];
  questions: AutoResolveQuestion[];
  landscape?: string[];
  solutions?: string[];
  constraints?: string[];
  variables?: { label?: string }[];
  summary?: string;
  /** Candidate answers to generate per question (best-of-N). */
  n?: number;
}

const SCHEMA = {
  name: "auto_resolved",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        description: "One entry per question, in the same order.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["questionId", "candidates", "chosenIndex"],
          properties: {
            questionId: { type: "string" },
            candidates: {
              type: "array",
              description: "N genuinely-different plausible answers — distinct strategic bets, NOT rewordings.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text", "score", "why"],
                properties: {
                  text: { type: "string", description: "A concrete, specific answer (a real decision, not a platitude). ≤ 40 words." },
                  score: { type: "number", description: "0–100: how well this advances the decisive factors AND how realistic it is. Generic = low." },
                  why: { type: "string", description: "≤ 14 words: why this score." },
                },
              },
            },
            chosenIndex: { type: "number", description: "Index into candidates of the single best answer." },
          },
        },
      },
    },
  },
} as const;

const lines = (label: string, xs: (string | undefined)[]) => {
  const v = xs.filter((s): s is string => !!s && s.trim().length > 0);
  return v.length ? `${label}\n${v.map((s) => `- ${s}`).join("\n")}` : "";
};

/** Auto-answer the open questions via best-of-N → rank → pick. Never throws. */
export async function autoResolveAnswers(p: AutoResolveParams): Promise<AutoResolvedAnswer[]> {
  if (p.questions.length === 0) return [];
  const n = Math.max(2, Math.min(4, p.n ?? 3));

  const system = [
    `You are auto-resolving a founder's open strategy questions to build a strong FIRST DRAFT without them.`,
    `For EACH question: generate ${n} genuinely DIFFERENT plausible answers (distinct strategic bets — not rewordings of one idea), score each 0–100 on (a) how well it advances the objective's DECISIVE factors and (b) how realistic it is, then pick the single best (chosenIndex).`,
    `Be concrete and specific — a real decision a founder could act on. Generic best-practice or hedging = low score.`,
    `Ground every answer in the objective + what's already known. Return the auto_resolved tool only.`,
  ].join("\n");

  const user = [
    `OBJECTIVE\n${p.objective || "(none)"}`,
    p.preamble ? `CONTEXT\n${p.preamble}` : "",
    p.factors.length ? `FACTORS THAT MATTER\n${p.factors.map((f) => `- ${f.label}${f.why ? ` — ${f.why}` : ""}`).join("\n")}` : "",
    lines("KNOWN (landscape)", p.landscape ?? []),
    lines("SOLUTION DIRECTIONS", p.solutions ?? []),
    lines("CONSTRAINTS", p.constraints ?? []),
    lines("VARIABLES", (p.variables ?? []).map((v) => v.label)),
    p.summary ? `SUMMARY SO FAR\n${p.summary}` : "",
    `OPEN QUESTIONS (answer every one):\n${p.questions.map((q) => `- [${q.id}] ${q.text}${q.intent ? ` (learning: ${q.intent})` : ""}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: { answers?: Array<{ questionId?: string; candidates?: Array<{ text?: string; score?: number; why?: string }>; chosenIndex?: number }> };
  try {
    raw = await llmJSON({
      system,
      user,
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 2600,
      temperature: 0.7, // higher → genuinely different candidates
      responseSchema: SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
  } catch (err) {
    console.warn("[auto-resolve] failed (soft → neutral draft):", err);
    return p.questions.map((q) => ({
      questionId: q.id,
      text: "Proceed with a sensible first-draft default; refine this in chat.",
      candidates: 1,
    }));
  }

  const byId = new Map(p.questions.map((q) => [q.id, q]));
  const out: AutoResolvedAnswer[] = [];
  for (const a of raw?.answers ?? []) {
    const qid = String(a?.questionId ?? "").trim();
    if (!qid || !byId.has(qid)) continue;
    const cands = (a?.candidates ?? [])
      .map((c) => ({ text: String(c?.text ?? "").trim(), score: Math.max(0, Math.min(100, Number(c?.score) || 0)), why: String(c?.why ?? "").trim() }))
      .filter((c) => c.text);
    if (cands.length === 0) continue;
    // Trust the model's pick if valid; else take the highest score.
    const ranked = [...cands].sort((x, y) => y.score - x.score);
    const idx = typeof a?.chosenIndex === "number" && a.chosenIndex >= 0 && a.chosenIndex < cands.length ? a.chosenIndex : -1;
    const chosen = idx >= 0 ? cands[idx] : ranked[0];
    const runnerUp = ranked.find((c) => c !== chosen);
    out.push({
      questionId: qid,
      text: chosen.text.slice(0, 2000),
      candidates: cands.length,
      rationale: chosen.why || undefined,
      runnerUp: runnerUp?.text,
    });
  }
  // Any question the model skipped → neutral default so the loop still closes.
  for (const q of p.questions) {
    if (!out.some((o) => o.questionId === q.id)) {
      out.push({ questionId: q.id, text: "Proceed with a sensible first-draft default; refine this in chat.", candidates: 1 });
    }
  }
  return out;
}
