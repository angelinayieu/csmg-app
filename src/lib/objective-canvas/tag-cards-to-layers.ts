// ── tag-cards-to-layers (Phase 11.A.4 — the re-sort pass) ─────────
//
// Given the ObjectiveStack + a set of confirmed cards (improvement_
// goals), assign each card to the 1-2 layers it most directly touches.
// This is the standalone version of the proposer's JOB-3 layer tagging,
// pulled OUT of generate-sub-objectives so it can run over cards that
// already exist — the ones that land in the canvas "Unplaced" shelf
// because they were either:
//   • confirmed before the stack was generated, or
//   • broad/structural (a surface, an engine, a container) that the
//     proposer's tagger left untagged because no single layer fit.
//
// Output ordinals are validated against the stack's real ordinals and
// capped at 2 (matching the Direct/Bridge/Span model). The human chip
// label is computed locally via computeLayerPositionLabel — the SAME
// helper the picker uses — so re-tagged cards render identically to
// freshly proposed ones. One LLM call covers every card.

import { llmJSON } from "@/lib/llm";
import {
  computeLayerPositionLabel,
  type ObjectiveStack,
} from "./layer-model";

export interface CardToTag {
  id: string;
  title: string;
  description?: string | null;
}

export interface CardLayerTag {
  id: string;
  layer_ordinals: number[];
  layer_position_label: string;
}

interface RawTag {
  id?: unknown;
  layer_ordinals?: unknown;
}

export async function tagCardsToLayers(input: {
  objective: string;
  stack: ObjectiveStack;
  cards: CardToTag[];
}): Promise<CardLayerTag[]> {
  const { objective, stack, cards } = input;
  if (cards.length === 0 || stack.layers.length === 0) return [];

  const validOrdinals = new Set(stack.layers.map((l) => l.ordinal));
  const byId = new Map(cards.map((c) => [c.id, c]));

  const layerBlock = [...stack.layers]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(
      (l) =>
        `  L${l.ordinal} · ${l.name} (${l.archetype}) — ${(l.description ?? "").slice(0, 120)}`,
    )
    .join("\n");

  const cardBlock = cards
    .map(
      (c) =>
        `  [${c.id}] ${c.title}${c.description ? ` — ${String(c.description).slice(0, 160)}` : ""}`,
    )
    .join("\n");

  const system = `You place each CARD (a proposed sub-objective / feature) onto the LAYER(S) of a system stack it most directly operates at.

The stack is a vertical causal ladder: lower layers (substrate / inputs) ENABLE higher ones (mechanisms → processes → outputs → outcomes).

For each card, choose the 1-2 layer ordinals it MOST DIRECTLY touches:
  • 1 ordinal — the card sits squarely at one layer. This is the common case.
  • 2 ordinals — ONLY when the card genuinely BRIDGES two layers (e.g. a feature that turns a mechanism into a social process). Prefer adjacent pairs.
Never assign 3+. If a card feels like it touches "everything" (a dashboard, an engine, a container), pick the 1-2 layers where its PRIMARY effect lands — not every layer it grazes.

Return strict JSON: { "tags": [ { "id": "<card id, verbatim>", "layer_ordinals": [<int>, ...] } ] }. Include EVERY card exactly once. Use ordinals from the stack only.`;

  const user = `CORE OBJECTIVE:\n"""\n${objective.slice(0, 600)}\n"""\n\nLAYER STACK:\n${layerBlock}\n\nCARDS TO PLACE:\n${cardBlock}\n\nAssign each card its 1-2 layer ordinals per the instructions.`;

  const raw = await llmJSON<{ tags?: RawTag[] }>({
    system,
    user,
    responseSchema: {
      name: "card_layer_tags",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          tags: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                layer_ordinals: {
                  type: "array",
                  items: { type: "number" },
                },
              },
              required: ["id", "layer_ordinals"],
            },
          },
        },
        required: ["tags"],
      },
    },
    temperature: 0.3,
    maxTokens: 1200,
  });

  const out: CardLayerTag[] = [];
  const seen = new Set<string>();
  for (const t of raw?.tags ?? []) {
    const id = typeof t?.id === "string" ? t.id : "";
    if (!id || !byId.has(id) || seen.has(id)) continue;
    const ords = Array.isArray(t?.layer_ordinals)
      ? Array.from(
          new Set(
            (t.layer_ordinals as unknown[])
              .filter(
                (n): n is number =>
                  typeof n === "number" && Number.isFinite(n),
              )
              .map((n) => Math.round(n))
              .filter((n) => validOrdinals.has(n)),
          ),
        )
          .sort((a, b) => a - b)
          .slice(0, 2)
      : [];
    if (ords.length === 0) continue;
    seen.add(id);
    out.push({
      id,
      layer_ordinals: ords,
      layer_position_label: computeLayerPositionLabel(ords),
    });
  }
  return out;
}
