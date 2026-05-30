// ── Analysis: distill macro problems (Tier 2 — LLM) ───────────────
//
// The bottom-up roll-up. Reads the PROBLEMS (pain entities) inside the
// rooms, groups them PER LAYER (using each room's layer_ordinals — the
// rooms→layers seam fixed in cross-room-state.ts), and asks the LLM to
// distill each layer's scattered room-problems into the 2-4 macro
// sub-problems that describe that layer's challenge as a whole.
//
// This is the missing coordination: today the macro layer stack is a
// top-down skeleton that never reflects what the rooms actually
// surfaced. Each finding here carries `body.layer_ordinal` so the
// layer-stack cards (Step 3) can render the rolled-up sub-problems
// beneath the layer they belong to.
//
// On-demand (Tier 2) so we don't spend LLM on every scan; the autopilot
// roll-up stage (Step 4) will fire it after room-fill completes.

import { llmJSON } from "@/lib/llm";
import { buildConstraintsBlock } from "../constraints";
import type {
  AnalysisFinding,
  AnalysisModule,
  CrossRoomState,
} from "./types";

const KEY = "macro_problems";

interface RawSubProblem {
  name?: unknown;
  description?: unknown;
  pain_item_ids?: unknown;
}
interface RawLayerGroup {
  layer_id?: unknown;
  sub_problems?: unknown;
}

export const distillMacroProblems: AnalysisModule = {
  key: KEY,
  label: "Macro problems",
  description:
    "Roll the problems inside each layer's rooms up into the few macro sub-problems that describe that layer's challenge as a whole.",
  // Reuses the existing "friction" facet (these are problems, one altitude
  // up). The layer-card render keys on analysis_key, not category.
  category: "friction",
  tier: 2,
  trigger: "on_demand",
  run: async (state: CrossRoomState): Promise<AnalysisFinding[]> => {
    const stack = state.layers;
    if (!stack || stack.layers.length === 0) return [];

    // Room → layer ordinals (the seam fixed in Step 1). Skip untagged rooms.
    const ordinalsByRoom = new Map<string, number[]>();
    for (const r of state.rooms) {
      if (Array.isArray(r.layer_ordinals) && r.layer_ordinals.length > 0) {
        ordinalsByRoom.set(r.id, r.layer_ordinals);
      }
    }
    if (ordinalsByRoom.size === 0) return [];

    // Collect pain entities per layer ordinal. A pain in a room tagged to
    // L2+L3 counts under both (the room operates at both altitudes).
    interface PainRef {
      id: string;
      name: string;
      room_id: string;
      negative_outcome: string | null;
    }
    const painsByLayer = new Map<number, PainRef[]>();
    const validPainIds = new Set<string>();
    for (const it of state.items) {
      if (it.layer !== "pain") continue;
      const ords = ordinalsByRoom.get(it.room_id);
      if (!ords) continue;
      validPainIds.add(it.id);
      const neg =
        typeof it.causal_chain?.negative_outcome === "string"
          ? (it.causal_chain.negative_outcome as string)
          : null;
      const ref: PainRef = {
        id: it.id,
        name: it.name,
        room_id: it.room_id,
        negative_outcome: neg,
      };
      for (const ord of ords) {
        const arr = painsByLayer.get(ord) ?? [];
        arr.push(ref);
        painsByLayer.set(ord, arr);
      }
    }
    if (validPainIds.size === 0) return [];

    // One prompt covering every layer that has pains. layer.id (e.g. "L2")
    // is the stable handle we map back to an ordinal after the call.
    const layerBlocks: string[] = [];
    for (const layer of stack.layers) {
      const pains = painsByLayer.get(layer.ordinal) ?? [];
      if (pains.length === 0) continue;
      layerBlocks.push(
        `${layer.id} · ${layer.name} (${layer.archetype}):\n` +
          pains
            .map(
              (p) =>
                `  - [${p.id}] ${p.name}${p.negative_outcome ? ` — ${p.negative_outcome.slice(0, 140)}` : ""}`,
            )
            .join("\n"),
      );
    }
    if (layerBlocks.length === 0) return [];

    const constraintsBlock = buildConstraintsBlock(state.constraints);

    const system = `You roll a system's room-level PROBLEMS up to the macro level. The objective decomposes into layers (a vertical stack); each layer holds rooms; each room surfaced several specific problems. Your job: for EACH layer, group its scattered room-problems into the 2-4 MACRO SUB-PROBLEMS that, together, describe that layer's challenge as a whole.

A MACRO SUB-PROBLEM is a category that SUMMARIZES several room-problems — chosen so the category maximally explains the layer's problems. ❌ BAD: restating one room-problem verbatim. ✅ GOOD: "Users can't tell intentional research from passive scrolling" — a grouping that 3 specific room-problems are all instances of.

For each layer, produce its sub-problems. For each sub-problem:
  • name — 4-9 words. Concrete, not abstract.
  • description — 1-2 sentences naming the shared root the grouped problems share.
  • pain_item_ids — the [ids] of the room-problems (from the input) this sub-problem groups. 2+ ideally; 1 only if a problem is genuinely standalone.

Group ONLY within a layer (don't merge across layers). Every pain_item_id MUST come from that layer's input list. Prefer 2-4 sub-problems per layer; fewer if the layer has few problems.

ALSO return "distilled_objective": ONE dense, plain sentence (≤ 45 words, no jargon, no archetype words like "substrate") that states the whole goal — the outcome, for whom, via what path. It should read like a crisp one-line executive summary of the objective.

Return strict JSON.`;

    const user = `CORE OBJECTIVE:\n"""\n${state.core_objective_text.slice(0, 800)}\n"""\n\nLAYERS AND THEIR ROOM-PROBLEMS:\n${layerBlocks.join("\n\n")}${constraintsBlock}\n\nRoll each layer's problems up into its macro sub-problems per the system instructions.`;

    const raw = await llmJSON<{
      layers?: RawLayerGroup[];
      distilled_objective?: unknown;
    }>({
      system,
      user,
      responseSchema: {
        name: "macro_problems",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            distilled_objective: { type: "string" },
            layers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  layer_id: { type: "string" },
                  sub_problems: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        pain_item_ids: {
                          type: "array",
                          items: { type: "string" },
                        },
                      },
                      required: ["name", "description", "pain_item_ids"],
                    },
                  },
                },
                required: ["layer_id", "sub_problems"],
              },
            },
          },
          required: ["layers", "distilled_objective"],
        },
      },
      temperature: 0.4,
      maxTokens: 2000,
    });

    const now = new Date().toISOString();
    const ordinalByLayerId = new Map(
      stack.layers.map((l) => [l.id, l.ordinal]),
    );
    const roomByPainId = new Map<string, string>();
    for (const it of state.items) {
      if (it.layer === "pain") roomByPainId.set(it.id, it.room_id);
    }

    const findings: AnalysisFinding[] = [];
    const rawLayers = Array.isArray(raw?.layers) ? raw.layers : [];
    for (const lg of rawLayers) {
      const layerId = typeof lg?.layer_id === "string" ? lg.layer_id : "";
      const ordinal = ordinalByLayerId.get(layerId);
      if (ordinal == null) continue;
      const subs = Array.isArray(lg?.sub_problems)
        ? (lg.sub_problems as RawSubProblem[])
        : [];
      subs.forEach((sp, idx) => {
        const name = typeof sp?.name === "string" ? sp.name.trim() : "";
        if (!name) return;
        const description =
          typeof sp?.description === "string" ? sp.description.trim() : "";
        const painIds = Array.isArray(sp?.pain_item_ids)
          ? (sp.pain_item_ids as unknown[])
              .filter((s): s is string => typeof s === "string")
              .filter((s) => validPainIds.has(s))
          : [];
        if (painIds.length === 0) return;
        const roomIds = Array.from(
          new Set(
            painIds
              .map((pid) => roomByPainId.get(pid))
              .filter((r): r is string => typeof r === "string"),
          ),
        );
        findings.push({
          id: `${KEY}__L${ordinal}__${idx}__${slugify(name)}`,
          analysis_key: KEY,
          category: "friction",
          severity: painIds.length >= 3 ? "high" : "medium",
          tier: 2,
          title: name.slice(0, 80),
          summary: description.slice(0, 200),
          body: {
            layer_ordinal: ordinal,
            layer_id: layerId,
            name,
            description,
            grouped_count: painIds.length,
          },
          references: { room_ids: roomIds, item_ids: painIds },
          disposition: "open",
          generated_at: now,
        });
      });
    }

    // Distilled objective — one dense sentence, emitted as a special
    // finding (no layer_ordinal, so the per-layer reader skips it). The
    // Goal card's Overview reads this; falls back to a first sentence if absent.
    const distilled =
      typeof raw?.distilled_objective === "string"
        ? raw.distilled_objective.trim()
        : "";
    if (distilled) {
      findings.push({
        id: `${KEY}__distilled_objective`,
        analysis_key: KEY,
        category: "structure",
        severity: "info",
        tier: 2,
        title: distilled.slice(0, 200),
        summary: distilled.slice(0, 200),
        body: { kind: "distilled_objective", text: distilled },
        references: { room_ids: [], item_ids: [] },
        disposition: "open",
        generated_at: now,
      });
    }

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
