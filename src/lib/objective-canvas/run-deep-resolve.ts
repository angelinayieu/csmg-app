// ── runDeepResolve — bounded recursive "AI resolve" (the autonomous agent) ──
//
// The user's vision for "AI resolve": resolve an ambiguity, let the resulting
// work surface NEW sub-questions, and keep resolving those — mapping the branch's
// full landscape — instead of stopping after one pass. Implemented as a BOUNDED
// loop over the proven primitives:
//   runAiResolve (auto-resolve → persist → apply/re-frame, with the planner
//                 deciding whether to decompose)
//   + the sharpening-emergent route (the self-question: "what did this open up?")
//
// Convergence + safety: a hard round cap, a leverage gate (only chase
// high-leverage emergent questions), and slug dedup so it converges and can NEVER
// run away. Client-orchestrated + tldraw-free — the caller passes the board cards
// (for the board-aware emergent pass). Reuses everything; no new routes, no fork.
//
// NOTE: each round is ~2 LLM calls (resolve + emergent), so a 3-round run is up
// to ~6 calls — bounded by maxRounds. Behavior needs a live (authed) test.

import { runAiResolve, type ResolveConcept } from "./run-ai-resolve";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

interface EmergentAnn {
  phrase?: string;
  kind?: string;
  why?: string;
  candidate_readings?: string[];
  concept_slug?: string;
  leverage?: number;
  uncertainty?: number;
  emerged_at?: string;
}

export interface DeepResolveResult {
  sharpenedPrompt?: string;
  shouldDecompose: boolean;
  /** How many resolve rounds actually ran (1 = no recursion happened). */
  rounds: number;
}

export async function runDeepResolve(
  spaceId: string,
  seed: ResolveConcept[],
  boardCards: { id: string; text: string }[],
  opts?: { maxRounds?: number; leverageGate?: number },
): Promise<DeepResolveResult | null> {
  if (!spaceId || seed.length === 0) return null;
  const maxRounds = Math.max(1, Math.min(4, opts?.maxRounds ?? 3));
  const gate = opts?.leverageGate ?? 0.6;

  const seen = new Set(seed.map((c) => c.concept_slug || slugify(c.phrase)));
  let toResolve = seed;
  let sharpenedPrompt: string | undefined;
  let shouldDecompose = false;
  let rounds = 0;

  while (rounds < maxRounds && toResolve.length > 0) {
    const res = await runAiResolve(spaceId, toResolve);
    if (!res) break;
    if (res.sharpenedPrompt) sharpenedPrompt = res.sharpenedPrompt;
    shouldDecompose = shouldDecompose || res.shouldDecompose;
    rounds += 1;

    // Self-question: did resolving (+ decomposing) surface NEW ambiguities?
    let emergent: EmergentAnn[] = [];
    try {
      const r = await fetch(`/api/objective/${spaceId}/sharpening-emergent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards: boardCards }),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          salience?: { annotations?: EmergentAnn[] };
        };
        emergent = Array.isArray(j?.salience?.annotations)
          ? j.salience.annotations
          : [];
      }
    } catch {
      break; // can't self-question → stop cleanly
    }

    // Chase only NEW, high-leverage emergent questions (gate + dedup → converge).
    const fresh = emergent.filter((a) => {
      const s = a.concept_slug || slugify(a.phrase || "");
      if (!s || seen.has(s) || !a.emerged_at) return false;
      const lev = typeof a.leverage === "number" ? a.leverage : 0.5;
      return lev >= gate;
    });
    fresh.forEach((a) => seen.add(a.concept_slug || slugify(a.phrase || "")));
    toResolve = fresh
      .map((a) => ({
        phrase: a.phrase || "",
        kind: a.kind || "concept",
        why: a.why,
        leverage: a.leverage,
        uncertainty: a.uncertainty,
        candidate_readings: a.candidate_readings || [],
        concept_slug: a.concept_slug,
      }))
      .filter((c) => c.phrase.length > 0);
  }

  return { sharpenedPrompt, shouldDecompose, rounds };
}
