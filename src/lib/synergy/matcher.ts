// ── Synergy matcher core ──
//
// Three-pass pipeline (per spec):
//   Pass 1 — Vector kNN via pgvector RPC `synergy_match_components`,
//            kind-filtered to compatible match shapes.
//   Pass 2 — LLM batch re-rank of complementarity + goal_alignment.
//   Pass 3 — Aggregate score → persist top-N with final_score > threshold.
//
// Uses service-role for the cross-user reads in Pass 1 (the RPC is
// `security definer`) and for the upsert into component_matches.
//
// Caller provides a service-role-capable Supabase client. The matcher
// itself never imports `createServiceClient` so it can be tested with
// any client implementation.

import { llmJSON } from "@/lib/llm";
import {
  KIND_COMPATIBILITY,
  MATCH_RERANK_SCHEMA,
  MATCH_RERANK_SYSTEM,
  aggregateFinalScore,
} from "./match-prompts";

export interface MatchSourceComponent {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
  objective_statement: string | null;
}

export interface MatchCandidate {
  id: string;
  owner_id: string;
  session_id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
  cosine_distance: number;
}

export interface ScoredMatch {
  candidate_id: string;
  owner_id: string;
  match_kind: "a_needs_b" | "b_needs_a" | "parallel";
  cosine_sim: number;
  complementarity_score: number;
  goal_alignment_score: number;
  final_score: number;
  rationale: string;
}

// Minimum final_score below which we don't persist. Keeps the
// discovery feed signal-dense rather than padded with weak matches.
export const MIN_PERSIST_SCORE = 50;
// How many matches to persist per source component. The discovery
// feed paginates beyond this anyway; 20 is well past what a single
// user can reasonably engage with per component.
export const MAX_MATCHES_PER_COMPONENT = 20;
// LLM batch size for Pass 2. Higher = cheaper per pair but slower to
// first-byte; 8 is a sweet spot for gpt-4o.
const RERANK_BATCH_SIZE = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function matchOneComponent(db: any, source: MatchSourceComponent): Promise<{
  candidates_considered: number;
  matches_persisted: number;
}> {
  // ── Pass 1: vector kNN with kind pre-filter ──
  const compatibleKinds = KIND_COMPATIBILITY[source.kind] ?? null;

  const { data: candRows, error: knnErr } = await db.rpc(
    "synergy_match_components",
    {
      source_component: source.id,
      match_limit: 50,
      stale_days: 180,
      kind_filter: compatibleKinds,
    },
  );
  if (knnErr) {
    console.error("[matcher] kNN error:", knnErr);
    throw new Error(knnErr.message);
  }
  const candidates = (candRows ?? []) as MatchCandidate[];
  if (candidates.length === 0) {
    return { candidates_considered: 0, matches_persisted: 0 };
  }

  // ── Pass 2: LLM batch re-rank ──
  //
  // Fetch each candidate owner's objective_statement so the LLM can
  // assess goal_alignment_score. Single round-trip via `in()`.
  const ownerIds = Array.from(new Set(candidates.map((c) => c.owner_id)));
  const { data: ownerSessions } = await db
    .from("brainstorm_sessions")
    .select("owner_id, session_id:id, objective_statement, updated_at")
    .in("owner_id", ownerIds)
    .order("updated_at", { ascending: false });
  const objectiveByOwner = new Map<string, string>();
  for (const row of (ownerSessions ?? []) as Array<{
    owner_id: string;
    objective_statement: string | null;
  }>) {
    if (!objectiveByOwner.has(row.owner_id) && row.objective_statement) {
      objectiveByOwner.set(row.owner_id, row.objective_statement);
    }
  }

  const scoredAll: ScoredMatch[] = [];
  for (let i = 0; i < candidates.length; i += RERANK_BATCH_SIZE) {
    const batch = candidates.slice(i, i + RERANK_BATCH_SIZE);
    const userMsg = buildRerankUserMessage(source, batch, objectiveByOwner);
    try {
      const parsed = await llmJSON<{
        pairs: Array<{
          pair_id: string;
          complementarity_score: number;
          goal_alignment_score: number;
          match_kind: "a_needs_b" | "b_needs_a" | "parallel";
          rationale: string;
        }>;
      }>({
        system: MATCH_RERANK_SYSTEM,
        user: userMsg,
        maxTokens: 2400,
        temperature: 0.2,
        responseSchema: MATCH_RERANK_SCHEMA as {
          name: string;
          schema: Record<string, unknown>;
        },
      });
      for (const p of parsed.pairs ?? []) {
        const cand = batch.find((c) => c.id === p.pair_id);
        if (!cand) continue;
        const cosineSim = 1 - cand.cosine_distance;
        const finalScore = aggregateFinalScore(
          cosineSim,
          p.complementarity_score,
          p.goal_alignment_score,
        );
        scoredAll.push({
          candidate_id: cand.id,
          owner_id: cand.owner_id,
          match_kind: p.match_kind,
          cosine_sim: cosineSim,
          complementarity_score: p.complementarity_score,
          goal_alignment_score: p.goal_alignment_score,
          final_score: finalScore,
          rationale: p.rationale.trim().slice(0, 400),
        });
      }
    } catch (err) {
      // Soft-fail on a single batch — log and continue. Don't kill
      // the whole match run for one LLM hiccup.
      console.error("[matcher] rerank batch failed:", err);
    }
  }

  // ── Pass 3: filter + persist ──
  const persistable = scoredAll
    .filter((s) => s.final_score >= MIN_PERSIST_SCORE)
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, MAX_MATCHES_PER_COMPONENT);

  // Persist with canonical ordering: component_a < component_b
  // alphabetically (uuid string compare). The API surface flips the
  // direction on read based on which side belongs to the caller.
  const rows = persistable.map((s) => {
    const aLessThanB = source.id < s.candidate_id;
    const componentA = aLessThanB ? source.id : s.candidate_id;
    const componentB = aLessThanB ? s.candidate_id : source.id;
    // match_kind is recorded from A's perspective. If we flipped,
    // flip a_needs_b <-> b_needs_a.
    let matchKind = s.match_kind;
    if (!aLessThanB) {
      if (matchKind === "a_needs_b") matchKind = "b_needs_a";
      else if (matchKind === "b_needs_a") matchKind = "a_needs_b";
    }
    return {
      component_a: componentA,
      component_b: componentB,
      match_kind: matchKind,
      cosine_sim: s.cosine_sim,
      complementarity_score: s.complementarity_score,
      goal_alignment_score: s.goal_alignment_score,
      final_score: s.final_score,
      rationale: s.rationale,
    };
  });

  if (rows.length === 0) {
    return {
      candidates_considered: candidates.length,
      matches_persisted: 0,
    };
  }

  const { error: upsertErr } = await db
    .from("component_matches")
    .upsert(rows, { onConflict: "component_a,component_b" });
  if (upsertErr) {
    console.error("[matcher] upsert error:", upsertErr);
    throw new Error(upsertErr.message);
  }

  // ── Fire-and-forget notify-on-match emails ──
  //
  // For each new persisted row with final_score ≥ 70, both sides'
  // owners are candidates for a match-surfaced email. The trigger
  // itself enforces the per-user `notify_on_match` preference + 24h
  // throttle, so we can fan out unconditionally here. We only
  // surface the SOURCE side's best match in the email (we know the
  // source's component label inline; the candidate side requires
  // another lookup the trigger handles).
  const highFit = rows.filter((r) => r.final_score >= 70);
  if (highFit.length > 0) {
    const bestScore = Math.max(...highFit.map((r) => r.final_score));
    // Source side: we have the source's owner + label directly.
    // Dynamically import to avoid pulling email infra into matcher's
    // serverless bundle for the cold-path case.
    import("@/lib/email/triggers")
      .then(({ sendMatchSurfacedEmail }) =>
        sendMatchSurfacedEmail({
          owner_user_id: source.owner_id,
          highlight_component_label: source.label_public,
          highlight_score: bestScore,
          new_match_count: highFit.length,
        }),
      )
      .catch((err) =>
        console.warn(
          "[matcher] notify-on-match (source) trigger errored:",
          err,
        ),
      );

    // Candidate side: notify each candidate-owner about THEIR side's
    // new match. We surface their component's label as the highlight.
    // De-duped by owner — one email per matched candidate-owner per
    // batch (their best score across rows where they were the
    // candidate).
    const byOwner = new Map<
      string,
      { label: string; score: number; count: number }
    >();
    for (const r of highFit) {
      const candIsB = r.component_b !== source.id;
      const candId = candIsB ? r.component_b : r.component_a;
      const cand = candidates.find((c) => c.id === candId);
      if (!cand) continue;
      const prev = byOwner.get(cand.owner_id);
      if (!prev || r.final_score > prev.score) {
        byOwner.set(cand.owner_id, {
          label: cand.label_public,
          score: r.final_score,
          count: (prev?.count ?? 0) + 1,
        });
      } else {
        prev.count += 1;
      }
    }
    for (const [ownerId, agg] of byOwner) {
      import("@/lib/email/triggers")
        .then(({ sendMatchSurfacedEmail }) =>
          sendMatchSurfacedEmail({
            owner_user_id: ownerId,
            highlight_component_label: agg.label,
            highlight_score: agg.score,
            new_match_count: agg.count,
          }),
        )
        .catch((err) =>
          console.warn(
            "[matcher] notify-on-match (candidate) trigger errored:",
            err,
          ),
        );
    }
  }

  return {
    candidates_considered: candidates.length,
    matches_persisted: rows.length,
  };
}

function buildRerankUserMessage(
  source: MatchSourceComponent,
  batch: MatchCandidate[],
  objectiveByOwner: Map<string, string>,
): string {
  const a = `COMPONENT_A (your reference):
  id: ${source.id}
  kind: ${source.kind}${source.subkind ? " / " + source.subkind : ""}
  label: ${source.label_public}
  description: ${source.description_public}
  user A's objective: ${source.objective_statement || "(not stated)"}`;

  const pairs = batch
    .map((c, i) => {
      const objB = objectiveByOwner.get(c.owner_id) || "(not stated)";
      return `─── PAIR ${i + 1} (pair_id: ${c.id}) ───
COMPONENT_B:
  kind: ${c.kind}${c.subkind ? " / " + c.subkind : ""}
  label: ${c.label_public}
  description: ${c.description_public}
  user B's objective: ${objB}
  cosine_sim: ${(1 - c.cosine_distance).toFixed(3)}`;
    })
    .join("\n\n");

  return `${a}\n\nEvaluate each of the ${batch.length} candidate pairs below. Return scores for ALL of them, indexed by their pair_id (exactly as given).\n\n${pairs}`;
}
