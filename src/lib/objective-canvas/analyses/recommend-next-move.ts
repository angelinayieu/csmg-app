// ── Analysis: recommend next move (Tier 2 — LLM) ─────────────────
//
// Reads the user's current cross-room state — open findings,
// elected variations, composed designs, open conflicts, constraints —
// and proposes ONE specific action that has the highest leverage
// given everything visible.
//
// Output is a single finding (category=priority, severity=critical)
// with body carrying:
//   • recommended_action  — what to actually do (1-2 sentences)
//   • rationale           — why this beats other available moves
//   • affected_rooms      — room ids the move touches
//   • next_steps          — 2-3 concrete actions the user takes today
//   • estimated_effort    — time/cost gauge
//   • what_youll_learn    — the binary update this move produces
//
// Pairs naturally with distill_concepts: distill tells you what's
// TRUE across rooms; recommend tells you what to DO next. Together
// they're the analysis surface's "now what" — without them, findings
// are read-only.

import { llmJSON } from "@/lib/llm";
import { buildConstraintsBlock } from "../constraints";
import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "recommend_next_move";

interface RawRecommendation {
  recommended_action?: unknown;
  rationale?: unknown;
  affected_rooms?: unknown;
  next_steps?: unknown;
  estimated_effort?: unknown;
  what_youll_learn?: unknown;
}

export const recommendNextMove: AnalysisModule = {
  key: KEY,
  label: "Recommend next move",
  description:
    "What's the single highest-leverage action you could take given current state? One specific move, justified, with concrete next steps.",
  category: "priority",
  tier: 2,
  trigger: "on_demand",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.rooms.length === 0) return [];

    // ── Build the state summary the LLM reads ──
    // Rooms with their composed designs + elected variations + any
    // open conflicts surface so the recommendation can target them.
    // We also count items with prototype briefs so the recommendation
    // doesn't propose "prototype X" when X already has one in flight.
    const roomBlocks: string[] = [];
    let totalPrototypesInFlight = 0;
    const itemsWithOpenQuestionsNoPrototype: string[] = [];
    for (const room of state.rooms) {
      const items = state.items.filter((i) => i.room_id === room.id);
      const electedCount = items.reduce(
        (sum, it) => sum + it.elected_variation_ids.length,
        0,
      );
      const composedItems = items.filter(
        (it) => it.expanded_detail?.composed_design,
      );
      const openConflicts: string[] = [];
      for (const it of composedItems) {
        const cd = it.expanded_detail?.composed_design;
        if (cd?.conflicts_open?.length) {
          openConflicts.push(...cd.conflicts_open);
        }
      }
      // Count prototype briefs across the room's items so the
      // recommendation knows what's already under test.
      let roomPrototypeCount = 0;
      for (const it of items) {
        const briefs = it.expanded_detail?.prototype_briefs ?? [];
        roomPrototypeCount += briefs.length;
        // Open questions on elected variations that DON'T yet have a
        // prototype = highest-value targets for new briefs.
        const variations = it.expanded_detail?.variations ?? [];
        for (const v of variations) {
          if (v.disposition !== "elected") continue;
          const variationBriefs = briefs.filter(
            (b) => b.variation_id === v.id,
          );
          if (variationBriefs.length === 0 && Array.isArray(v.open_questions)) {
            for (const q of v.open_questions.slice(0, 1)) {
              itemsWithOpenQuestionsNoPrototype.push(
                `${room.id}:${it.name} · "${q.slice(0, 60)}"`,
              );
            }
          }
        }
      }
      totalPrototypesInFlight += roomPrototypeCount;
      const block: string[] = [
        `  ${room.id} · ${room.title}`,
        `    items: ${items.length} · elected: ${electedCount} · composed: ${composedItems.length} · prototypes: ${roomPrototypeCount}`,
      ];
      if (room.top_negative_outcome) {
        block.push(`    counters: ${room.top_negative_outcome.slice(0, 140)}`);
      }
      if (openConflicts.length > 0) {
        block.push(
          `    open conflicts: ${openConflicts.slice(0, 2).map((c) => `"${c.slice(0, 100)}"`).join(" | ")}`,
        );
      }
      roomBlocks.push(block.join("\n"));
    }

    // ── Orphan annotations — readings nothing in any room derives from ──
    // Same logic as the orphan-annotations Tier 1 analysis but
    // inlined so the recommendation can surface them as gap-fill
    // candidates without depending on a cached scan.
    const coveredIndices = new Set<number>();
    for (const it of state.items) {
      for (const idx of it.derived_from_annotation_indices) {
        coveredIndices.add(idx);
      }
    }
    const orphanAnnotations: Array<{ idx: number; phrase: string }> = [];
    state.parent_annotations.slice(0, 8).forEach((a, i) => {
      const lensIdx = i + 1;
      if (!coveredIndices.has(lensIdx)) {
        orphanAnnotations.push({ idx: lensIdx, phrase: a.phrase });
      }
    });

    // ── User intent preferences (decision-log signal) ──
    // When the user has revealed a clear pattern, surface their top
    // 1-2 intents to the LLM. This biases recommendations toward
    // moves they're likely to follow through on (per-user
    // personalization) without overriding objective criteria.
    const prefs = state.user_intent_preferences ?? [];
    const topUserIntents = prefs
      .filter((p) => p.intent !== "initial" && p.rate !== null)
      .slice(0, 2);
    const userPatternBlock =
      topUserIntents.length > 0
        ? `\n\nUSER PATTERN (revealed from prior variant-lab decisions — bias toward what they actually follow through on):\n${topUserIntents
            .map(
              (p) =>
                `  • ${p.intent} — elects ${Math.round((p.rate ?? 0) * 100)}% of the time (${p.elects}✓ ${p.rejects}✕)`,
            )
            .join("\n")}`
        : "";

    const orphanBlock =
      orphanAnnotations.length > 0
        ? `\n\nORPHAN ANNOTATIONS (parent-objective readings with NO derived items across any room — strong gap-fill candidates):\n${orphanAnnotations
            .slice(0, 5)
            .map((o) => `  • [${o.idx}] "${o.phrase}"`)
            .join("\n")}`
        : "";

    const prototypeBlock =
      itemsWithOpenQuestionsNoPrototype.length > 0
        ? `\n\nOPEN QUESTIONS ON ELECTED VARIATIONS (no prototype yet — direct test candidates):\n${itemsWithOpenQuestionsNoPrototype
            .slice(0, 5)
            .map((q) => `  • ${q}`)
            .join("\n")}`
        : totalPrototypesInFlight > 0
          ? `\n\nNote: ${totalPrototypesInFlight} prototype brief${totalPrototypesInFlight === 1 ? "" : "s"} already exist across rooms. Don't propose "prototype X" if X is in this set; pivot to NEW open questions or upstream design moves.`
          : "";

    const constraintsBlock = buildConstraintsBlock(state.constraints);

    const system = `You read across the user's strategy rooms and recommend the SINGLE highest-leverage action they should take next.

A high-leverage action is one that:
  • Resolves an open conflict the user is stuck on, OR
  • Generates the information that would unstick a key decision, OR
  • Eliminates redundant work before it compounds, OR
  • Tests the load-bearing assumption that, if wrong, makes the rest pointless.

A low-leverage action is one that:
  • Just adds more content without resolving anything (banned)
  • Polishes work already in good shape (banned)
  • Is generic "consider X" advice with no specific target (banned)

OUTPUT one recommendation. Be SPECIFIC. The user must be able to start it within 30 minutes of reading.

  • recommended_action — 1-2 sentences. The action itself. Verb-led, concrete.
  • rationale — 1-2 sentences. Why this beats the obvious alternatives. Reference the user's actual rooms/conflicts/elections.
  • affected_rooms — room ids (from the input) the action touches.
  • next_steps — 2-3 concrete steps the user takes today. Each is a single sentence, verb-led.
  • estimated_effort — short string: e.g. "30 min", "half day", "1-2 days". Must fit the user's constraints.
  • what_youll_learn — 1 sentence. The binary update this action produces — what you'll know after that you don't know now.

ANTI-PLATITUDE: "iterate on the design" or "talk to users" are banned. Be specific about WHAT iteration, WHICH users, WHAT question.

Return strict JSON.`;

    const user = `PARENT OBJECTIVE:\n"""\n${state.core_objective_text.slice(0, 800)}\n"""\n\nROOMS (${state.rooms.length}):\n${roomBlocks.join("\n\n")}${orphanBlock}${prototypeBlock}${userPatternBlock}${constraintsBlock}\n\nRecommend the single next move per the system instructions. When orphan annotations exist, gap-fill moves earn priority. When open questions exist without prototypes on elected variations, a prototype is often the right next move. The user-pattern signal is a TIEBREAKER — don't let it override objective criteria, just bias when two moves are roughly equal.`;

    const raw = await llmJSON<RawRecommendation>({
      system,
      user,
      responseSchema: {
        name: "recommend_next_move",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            recommended_action: { type: "string" },
            rationale: { type: "string" },
            affected_rooms: { type: "array", items: { type: "string" } },
            next_steps: { type: "array", items: { type: "string" } },
            estimated_effort: { type: "string" },
            what_youll_learn: { type: "string" },
          },
          required: [
            "recommended_action",
            "rationale",
            "affected_rooms",
            "next_steps",
            "estimated_effort",
            "what_youll_learn",
          ],
        },
      },
      temperature: 0.4,
      maxTokens: 800,
    });

    const action =
      typeof raw?.recommended_action === "string"
        ? raw.recommended_action.trim()
        : "";
    if (!action) return [];

    const rationale =
      typeof raw?.rationale === "string" ? raw.rationale.trim() : "";
    const validRoomIds = new Set(state.rooms.map((r) => r.id));
    const affectedRooms = Array.isArray(raw?.affected_rooms)
      ? (raw.affected_rooms as unknown[])
          .filter((s): s is string => typeof s === "string")
          .filter((s) => validRoomIds.has(s))
      : [];
    const nextSteps = Array.isArray(raw?.next_steps)
      ? (raw.next_steps as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [];
    const effort =
      typeof raw?.estimated_effort === "string"
        ? raw.estimated_effort.trim().slice(0, 80)
        : "";
    const youllLearn =
      typeof raw?.what_youll_learn === "string"
        ? raw.what_youll_learn.trim()
        : "";

    // Single finding — overwrites prior recommendations on rerun
    // (the route's mergeFindings handles same-key replacement).
    const now = new Date().toISOString();
    return [
      {
        id: `${KEY}__current`,
        analysis_key: KEY,
        category: "priority",
        severity: "critical",
        tier: 2,
        title: action.slice(0, 100),
        summary: rationale.slice(0, 220) || "Highest-leverage move given current state.",
        body: {
          recommended_action: action,
          rationale,
          next_steps: nextSteps,
          estimated_effort: effort,
          what_youll_learn: youllLearn,
          affected_room_count: affectedRooms.length,
        },
        references: {
          room_ids: affectedRooms,
          item_ids: [],
        },
        disposition: "open",
        generated_at: now,
      },
    ];
  },
};
