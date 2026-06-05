// ── room-categories (client-safe) ──────────────────────────────────
//
// The PURE types + normalizer for room category sets, split out of
// generate-categories.ts so CLIENT components can import the runtime
// normalizer WITHOUT dragging in the LLM call path. generate-categories.ts
// imports `llmJSON` → llm.ts → usage-meter → `node:async_hooks`, which webpack
// cannot bundle into a browser/client graph (UnhandledSchemeError). Keeping the
// pure, dependency-free pieces here lets sub-objective-room-view.tsx (a client
// component) use normalizeRoomCategories safely. generate-categories.ts
// re-exports these so existing server importers are unchanged.

export interface RoomCategorySet {
  slug: string;
  label: string;
  color: string;
}

export interface RoomCategories {
  friction: RoomCategorySet[];
  mechanism: RoomCategorySet[];
  result: RoomCategorySet[];
}

/** Color palette per lane — categories cycle through these in order.
 *  Each lane gets its own palette tuned so category chips don't
 *  visually collide with the layer's main color. */
export const CATEGORY_PALETTE: Record<keyof RoomCategories, string[]> = {
  friction: ["#DC2626", "#EA580C", "#D97706", "#B45309", "#92400E"],
  mechanism: ["#2563EB", "#7C3AED", "#1D4ED8", "#4338CA", "#0E7490"],
  result: ["#16A34A", "#059669", "#0D9488", "#15803D", "#84CC16"],
};

export function normalizeRoomCategories(raw: unknown): RoomCategories {
  if (!raw || typeof raw !== "object") {
    return { friction: [], mechanism: [], result: [] };
  }
  const r = raw as Record<string, unknown>;
  const lane = (key: keyof RoomCategories): RoomCategorySet[] => {
    const v = r[key];
    if (!Array.isArray(v)) return [];
    return (v as unknown[])
      .filter((it): it is Record<string, unknown> =>
        typeof it === "object" && it !== null,
      )
      .filter(
        (it) => typeof it.slug === "string" && typeof it.label === "string",
      )
      .map((it) => ({
        slug: it.slug as string,
        label: it.label as string,
        color:
          typeof it.color === "string"
            ? (it.color as string)
            : CATEGORY_PALETTE[key][0]!,
      }))
      .slice(0, 5);
  };
  return {
    friction: lane("friction"),
    mechanism: lane("mechanism"),
    result: lane("result"),
  };
}
