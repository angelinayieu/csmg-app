// ── Build Sibling Data Block ────────────────────────────────────────
//
// Cross-room data awareness for room generation. Today a room generates as
// an independent silo: it sees only its own sub-objective + the parent
// objective, never what sibling rooms in the same app are building or what
// data already flows between them. That's the root reason the same data
// unit doesn't flow across rooms and the data-flow map stays disconnected
// (verified: room/generate reads no sibling data; the data_unit_registry
// is never consulted at generation time).
//
// This builds a prose block — same shape + injection pattern as the
// existing RoomContext blocks (constraintsBlock / crossRoomFindingsBlock /
// learningsBlock) — fed into the feature stage prompt so a new room:
//   • knows the OTHER capabilities (sibling sub-objectives) being built
//     toward the same objective → coordinates instead of duplicating, and
//   • sees the data tokens already produced/consumed by sibling rooms →
//     REUSES the same tokens when its features touch shared data, which is
//     the prerequisite for a real cross-room data-flow graph (the shared
//     token becomes the cross-room join key).
//
// Tokens are read from sibling features' mechanism specs
// (entities.expanded_detail.mechanism_spec.runtime_flow[].produces|consumes).
// Early on these are sparse (specs run post-election / during Deepen → v2),
// so the data section grows over time while the sibling-objectives section
// is always present. Soft-fails to "" on any error — cross-room enrichment
// must never break generation.

const MAX_SIBLINGS = 8;
const MAX_TOKENS = 24;
const DESC_CHARS = 110;

interface SiblingDataArgs {
  spaceId: string;
  currentSubObjectiveId: string;
  /** The root objective goal these sub-objectives hang off. When null
   *  (legacy spaces where the sub WAS the root), we fall back to all
   *  non-root goals in the space. */
  parentGoalId: string | null;
}

interface FlowStep {
  produces: string[];
  consumes: string[];
}

/** Build the cross-room data-awareness prompt block. Returns "" when there
 *  are no siblings (first room in the space) or on any failure. */
export async function buildSiblingDataBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  { spaceId, currentSubObjectiveId, parentGoalId }: SiblingDataArgs,
): Promise<string> {
  try {
    // 1) Sibling sub-objectives — the other rooms toward the same objective.
    let query = db
      .from("improvement_goals")
      .select("id, title, description, room_layers_generated_at")
      .eq("space_id", spaceId)
      .neq("id", currentSubObjectiveId);
    query = parentGoalId
      ? query.eq("parent_goal_id", parentGoalId)
      : query.not("parent_goal_id", "is", null);
    const { data: sibsRaw } = await query;
    const siblings = (Array.isArray(sibsRaw) ? sibsRaw : []).slice(
      0,
      MAX_SIBLINGS,
    ) as Array<{
      id: string;
      title: string | null;
      description: string | null;
      room_layers_generated_at: string | null;
    }>;
    if (siblings.length === 0) return "";

    // 2) Data tokens already flowing in generated sibling rooms.
    const generatedIds = siblings
      .filter((s) => s.room_layers_generated_at)
      .map((s) => s.id);
    const titleById = new Map(
      siblings.map((s) => [s.id, (s.title ?? "a room").trim() || "a room"]),
    );
    const produced = new Map<string, Set<string>>(); // token → room titles
    const consumed = new Map<string, Set<string>>();
    if (generatedIds.length > 0) {
      const { data: ents } = await db
        .from("entities")
        .select("parent_sub_objective_id, expanded_detail, causal_chain")
        .in("parent_sub_objective_id", generatedIds);
      for (const e of (Array.isArray(ents) ? ents : []) as Array<{
        parent_sub_objective_id: string;
        expanded_detail: unknown;
        causal_chain: unknown;
      }>) {
        const room = titleById.get(e.parent_sub_objective_id) ?? "a room";
        // Feature-level data I/O (Foundation B — causal_chain.data_io, on
        // most features) + step-level tokens from the deep mechanism spec
        // (runtime_flow, only on spec'd features). Union of both.
        const io = extractDataIo(e.causal_chain);
        for (const t of io.produces) addToken(produced, t, room);
        for (const t of io.consumes) addToken(consumed, t, room);
        for (const step of extractRuntimeFlow(e.expanded_detail)) {
          for (const t of step.produces) addToken(produced, t, room);
          for (const t of step.consumes) addToken(consumed, t, room);
        }
      }
    }

    // 3) Compose the prompt block.
    const lines: string[] = [
      "── SIBLING ROOMS IN THIS APP (coordinate · don't duplicate · connect to shared data) ──",
      "",
      "Other capabilities being built toward the SAME objective:",
      ...siblings.map(
        (s) =>
          `  • ${(s.title ?? "untitled").trim() || "untitled"}${
            s.description
              ? ` — ${s.description.trim().slice(0, DESC_CHARS)}`
              : ""
          }`,
      ),
    ];

    const tokenLines = composeTokenLines(produced, consumed);
    if (tokenLines.length > 0) {
      lines.push(
        "",
        "Data already produced/consumed by sibling rooms — REUSE these exact token names when a",
        "feature here reads or writes the same data, so the whole app shares ONE data substrate:",
        ...tokenLines,
      );
    }

    lines.push(
      "",
      "When a feature in THIS room touches data a sibling room already handles, reuse the same",
      "token and account for that cross-room dependency instead of inventing a parallel data unit.",
      "── END SIBLING ROOMS ──",
      "",
    );
    return "\n" + lines.join("\n");
  } catch {
    return "";
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function extractRuntimeFlow(expandedDetail: unknown): FlowStep[] {
  if (!expandedDetail || typeof expandedDetail !== "object") return [];
  const spec = (expandedDetail as Record<string, unknown>).mechanism_spec;
  if (!spec || typeof spec !== "object") return [];
  const flow = (spec as Record<string, unknown>).runtime_flow;
  if (!Array.isArray(flow)) return [];
  return flow.map((s) => {
    const step = (s && typeof s === "object" ? s : {}) as Record<
      string,
      unknown
    >;
    return {
      produces: toStringArray(step.produces),
      consumes: toStringArray(step.consumes),
    };
  });
}

function extractDataIo(causalChain: unknown): {
  produces: string[];
  consumes: string[];
} {
  if (!causalChain || typeof causalChain !== "object") {
    return { produces: [], consumes: [] };
  }
  const io = (causalChain as Record<string, unknown>).data_io;
  if (!io || typeof io !== "object") return { produces: [], consumes: [] };
  const rec = io as Record<string, unknown>;
  return {
    produces: toStringArray(rec.produces),
    consumes: toStringArray(rec.consumes),
  };
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
}

function addToken(
  map: Map<string, Set<string>>,
  token: string,
  room: string,
): void {
  const key = token.toLowerCase();
  const set = map.get(key) ?? new Set<string>();
  set.add(room);
  map.set(key, set);
}

function composeTokenLines(
  produced: Map<string, Set<string>>,
  consumed: Map<string, Set<string>>,
): string[] {
  const all = new Set<string>([...produced.keys(), ...consumed.keys()]);
  const lines: string[] = [];
  for (const token of Array.from(all).sort().slice(0, MAX_TOKENS)) {
    const roles: string[] = [];
    const prod = produced.get(token);
    const cons = consumed.get(token);
    if (prod) roles.push(`produced by ${[...prod].slice(0, 2).join(", ")}`);
    if (cons) roles.push(`consumed by ${[...cons].slice(0, 2).join(", ")}`);
    lines.push(`  • ${token} (${roles.join(" · ")})`);
  }
  return lines;
}
