// ── group-cards-into-features (Phase 11.A.5 — the nesting pass) ───
//
// The SECOND axis, orthogonal to layer placement. Layer tagging asks
// "what altitude does this card operate at"; this asks "is this card a
// sub-feature that belongs INSIDE another card." It turns the flat card
// row into a 2-level tree: a few broad CONTAINER cards (a surface, an
// engine, an umbrella) each holding the specific feature cards that are
// instances of it.
//
// Output is a container_card_id per card (or null = top-level). One LLM
// call. Validated to a strict 2 levels: a card chosen as a container
// cannot itself be nested, no card nests under itself, and an unknown
// container id collapses to top-level. The writer (route) keeps the
// prior value so the grouping is reversible.

import { llmJSON } from "@/lib/llm";

export interface CardToGroup {
  id: string;
  title: string;
  description?: string | null;
  /** Layer ordinals (if tagged) — a hint: cards group most naturally
   *  within / adjacent to the same layer band. */
  layer_ordinals?: number[] | null;
}

export interface CardGrouping {
  id: string;
  /** The sibling card this one nests under, or null for top-level. */
  container_card_id: string | null;
  /** True when the model marked this card as a container (holds others). */
  is_container: boolean;
}

interface RawGroup {
  id?: unknown;
  container_id?: unknown;
  role?: unknown;
}

export async function groupCardsIntoFeatures(input: {
  objective: string;
  cards: CardToGroup[];
}): Promise<CardGrouping[]> {
  const { objective, cards } = input;
  // Need at least 3 cards for nesting to mean anything.
  if (cards.length < 3) {
    return cards.map((c) => ({
      id: c.id,
      container_card_id: null,
      is_container: false,
    }));
  }

  const byId = new Map(cards.map((c) => [c.id, c]));

  const cardBlock = cards
    .map((c) => {
      const lyr =
        Array.isArray(c.layer_ordinals) && c.layer_ordinals.length > 0
          ? ` {L${c.layer_ordinals.join(",L")}}`
          : "";
      return `  [${c.id}]${lyr} ${c.title}${c.description ? ` — ${String(c.description).slice(0, 150)}` : ""}`;
    })
    .join("\n");

  const system = `You organize a flat list of feature CARDS into a 2-LEVEL tree.

Most cards are specific FEATURES. A few are broader — a CONTAINER that several features are really instances of:
  • a SURFACE that renders others (a dashboard, a board),
  • an ENGINE others call (a reward/scoring system),
  • an UMBRELLA / category (a "social interaction layer" that holds the individual social features),
  • a FOUNDATION others build on (a goal-tracking system).

Your job, for each card, assign a role:
  • "container" — this card holds others. Pick only the few that genuinely act as a home for multiple features.
  • "child" — this card nests INSIDE one container. Give "container_id" = the [id] of that container.
  • "top" — a standalone card that is neither a container nor nested.

Hard rules:
  • Exactly 2 levels. A "child" never also has children. A "container" is never itself a "child".
  • A container should hold 2+ children; if only one card would fit, make it "top" instead, not a container.
  • Prefer grouping cards that share a layer band or an obvious theme. Don't force unrelated cards together.
  • A card nests under at most ONE container. Use container ids from the list only. Never nest a card under itself.

Return strict JSON: { "cards": [ { "id": "<verbatim>", "role": "container"|"child"|"top", "container_id": "<id or null>" } ] }. Include EVERY card exactly once.`;

  const user = `CORE OBJECTIVE:\n"""\n${objective.slice(0, 600)}\n"""\n\nCARDS (id, optional {layer band}, title — description):\n${cardBlock}\n\nAssign each card a role per the instructions.`;

  const raw = await llmJSON<{ cards?: RawGroup[] }>({
    system,
    user,
    responseSchema: {
      name: "card_grouping",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                role: { type: "string", enum: ["container", "child", "top"] },
                container_id: { type: ["string", "null"] },
              },
              required: ["id", "role", "container_id"],
            },
          },
        },
        required: ["cards"],
      },
    },
    temperature: 0.3,
    maxTokens: 1500,
  });

  const rows = Array.isArray(raw?.cards) ? raw.cards : [];

  // Pass 1 — resolve declared roles, keep only ones we recognize.
  const role = new Map<string, "container" | "child" | "top">();
  const declaredContainer = new Map<string, string>();
  for (const r of rows) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!id || !byId.has(id) || role.has(id)) continue;
    const roleRaw = r?.role;
    const rRole: "container" | "child" | "top" =
      roleRaw === "container" || roleRaw === "child" || roleRaw === "top"
        ? roleRaw
        : "top";
    role.set(id, rRole);
    const contRaw = r?.container_id;
    if (rRole === "child" && typeof contRaw === "string") {
      declaredContainer.set(id, contRaw);
    }
  }
  // Any card the model omitted → top-level.
  for (const c of cards) if (!role.has(c.id)) role.set(c.id, "top");

  // Pass 2 — a valid container is one that (a) was role "container" AND
  // (b) at least one child legitimately points at it. Collapse the rest.
  const containerIds = new Set(
    [...role.entries()].filter(([, v]) => v === "container").map(([k]) => k),
  );

  const out: CardGrouping[] = [];
  // First compute which containers actually receive ≥1 valid child.
  const childCountByContainer = new Map<string, number>();
  for (const [childId, contId] of declaredContainer) {
    if (
      role.get(childId) === "child" &&
      containerIds.has(contId) &&
      contId !== childId
    ) {
      childCountByContainer.set(
        contId,
        (childCountByContainer.get(contId) ?? 0) + 1,
      );
    }
  }

  for (const c of cards) {
    const r = role.get(c.id) ?? "top";
    if (r === "container") {
      const holdsChildren = (childCountByContainer.get(c.id) ?? 0) > 0;
      out.push({
        id: c.id,
        container_card_id: null,
        is_container: holdsChildren,
      });
      continue;
    }
    if (r === "child") {
      const contId = declaredContainer.get(c.id);
      const valid =
        contId &&
        containerIds.has(contId) &&
        contId !== c.id &&
        (childCountByContainer.get(contId) ?? 0) > 0;
      out.push({
        id: c.id,
        container_card_id: valid ? contId! : null,
        is_container: false,
      });
      continue;
    }
    out.push({ id: c.id, container_card_id: null, is_container: false });
  }

  return out;
}
