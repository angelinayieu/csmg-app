// ── Analysis: distill concepts (Tier 2 — LLM) ─────────────────────
//
// Reads the user's elected variations + composed designs + room
// titles across all rooms and asks the LLM: "what 3-5 ideas thread
// through these rooms?" Each concept points back to the rooms
// where it surfaces so the user can re-enter the canvas with the
// theme as a lens.
//
// On-demand only — the user clicks "Run" in the workbench. Cached
// against the state_hash so re-opening the workbench shows the
// last result without re-spending.
//
// Output: 3-5 findings, each a `theme` category. The user can then
// sub-branch from a theme — promote to a new sub-objective, spawn
// variations on it, or expand it in the L3 lab.

import { llmJSON } from "@/lib/llm";
import { buildConstraintsBlock } from "../constraints";
import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "distill_concepts";

interface RawTheme {
  name?: unknown;
  description?: unknown;
  why_it_recurs?: unknown;
  room_ids?: unknown;
  evidence?: unknown;
}

export const distillConcepts: AnalysisModule = {
  key: KEY,
  label: "Distill concepts",
  description:
    "What 3-5 ideas thread through every room? Surfaces the implicit themes the rooms share without saying out loud.",
  category: "theme",
  tier: 2,
  trigger: "on_demand",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    if (state.rooms.length < 2) return [];

    // ── Compact room summaries the LLM can reason over without
    //    inflating the prompt. Per room: title + composed design
    //    description (when present) + elected variation names. ──
    const roomBlocks: string[] = [];
    for (const room of state.rooms) {
      const items = state.items.filter((i) => i.room_id === room.id);
      const composedDescs: string[] = [];
      const electedNames: string[] = [];
      for (const it of items) {
        const cd = it.expanded_detail?.composed_design;
        if (cd?.description) composedDescs.push(cd.description);
        const variations = it.expanded_detail?.variations ?? [];
        for (const v of variations) {
          if (it.elected_variation_ids.includes(v.id)) {
            electedNames.push(v.name);
          }
        }
      }
      const block: string[] = [`  ${room.id} · ${room.title}`];
      if (room.top_negative_outcome) {
        block.push(`    counters: ${room.top_negative_outcome}`);
      }
      if (composedDescs.length > 0) {
        block.push(
          `    composed design(s):\n      ${composedDescs.slice(0, 3).map((d) => `- ${d.slice(0, 240)}`).join("\n      ")}`,
        );
      }
      if (electedNames.length > 0) {
        block.push(
          `    elected variations: ${electedNames.slice(0, 8).join(" | ")}`,
        );
      }
      roomBlocks.push(block.join("\n"));
    }

    // Annotation lens — light, top-5 only, so the LLM can ground
    // themes back to the parent objective.
    const ranked = [...state.parent_annotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 5);
    const lensBlock =
      ranked.length > 0
        ? `\nPARENT OBJECTIVE READINGS:\n${ranked
            .map(
              (a, i) =>
                `  [${i + 1}] "${a.phrase}"${a.reading ? ` — ${a.reading.slice(0, 100)}` : ""}`,
            )
            .join("\n")}`
        : "";

    const constraintsBlock = buildConstraintsBlock(state.constraints);

    const system = `You read across a user's strategy rooms and surface the implicit themes that thread through them — the 3-5 ideas the rooms are *all* operating on, even when the user hasn't named them.

A THEME is a recurring conceptual pattern, NOT a recurring word. ❌ BAD: "users" (it's everywhere, so what). ✅ GOOD: "trust earned through transparent friction" (a stance / commitment / lens that explains why 3 rooms made aligned choices).

For each theme:
  • name — 3-7 words. Specific. Not abstract.
  • description — 1-2 sentences. What the theme actually claims.
  • why_it_recurs — 1 sentence. The reason the theme keeps showing up across rooms.
  • room_ids — 2+ room ids from the input where this theme surfaces.
  • evidence — 1-3 short quotes from composed designs / elected variations that DEMONSTRATE the theme (not paraphrase — actual fragments).

Produce 3-5 themes. The themes must be DISTINCT — if two are close, merge them.

ANTI-PLATITUDE: every theme must be specific enough that someone reading it could predict NEW decisions consistent with it. Generic ("user-centric design", "data-driven") are forbidden.

Return strict JSON.`;

    const user = `PARENT OBJECTIVE:\n"""\n${state.core_objective_text.slice(0, 1000)}\n"""\n\nROOMS (${state.rooms.length}):\n${roomBlocks.join("\n\n")}${lensBlock}${constraintsBlock}\n\nDistill the recurring themes per the system instructions.`;

    const raw = await llmJSON<{
      themes?: RawTheme[];
    }>({
      system,
      user,
      responseSchema: {
        name: "distill_concepts",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            themes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  why_it_recurs: { type: "string" },
                  room_ids: { type: "array", items: { type: "string" } },
                  evidence: { type: "array", items: { type: "string" } },
                },
                required: [
                  "name",
                  "description",
                  "why_it_recurs",
                  "room_ids",
                  "evidence",
                ],
              },
            },
          },
          required: ["themes"],
        },
      },
      temperature: 0.55,
      maxTokens: 1800,
    });

    const now = new Date().toISOString();
    const validRoomIds = new Set(state.rooms.map((r) => r.id));
    const findings: AnalysisFinding[] = [];

    const rawThemes = Array.isArray(raw?.themes) ? raw.themes : [];
    rawThemes.forEach((t, idx) => {
      const name = typeof t?.name === "string" ? t.name.trim() : "";
      if (!name) return;
      const description =
        typeof t?.description === "string" ? t.description.trim() : "";
      const whyItRecurs =
        typeof t?.why_it_recurs === "string" ? t.why_it_recurs.trim() : "";
      const roomIds = Array.isArray(t?.room_ids)
        ? (t.room_ids as unknown[])
            .filter((s): s is string => typeof s === "string")
            .filter((s) => validRoomIds.has(s))
        : [];
      if (roomIds.length < 2) return; // a single-room "theme" isn't cross-room
      const evidence = Array.isArray(t?.evidence)
        ? (t.evidence as unknown[])
            .filter((s): s is string => typeof s === "string")
            .slice(0, 3)
        : [];

      findings.push({
        id: `${KEY}__${idx}__${slugify(name)}`,
        analysis_key: KEY,
        category: "theme",
        severity: roomIds.length >= 3 ? "high" : "medium",
        tier: 2,
        title: name.slice(0, 80),
        summary: description.slice(0, 200),
        body: {
          name,
          description,
          why_it_recurs: whyItRecurs,
          evidence,
          room_count: roomIds.length,
        },
        references: {
          room_ids: roomIds,
          item_ids: [],
        },
        disposition: "open",
        generated_at: now,
      });
    });

    return findings;
  },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
