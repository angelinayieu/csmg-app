// ── Canvas Operation Registry (object-flow / canvas-AI-scanner Phase 0) ──
//
// The single catalog of the AI "power-ups" the Objective Canvas can run on an
// idea (a sticky note or a board card). See CANVAS_AI_SCANNER_PLAN.md. This is
// the "organize + document the operations" layer: one descriptor per operation,
// keyed by its INPUT CONTRACT (text-only · needs-entity · needs-room) so a
// caller (card menu today, the scanner sidebar next) knows what it can run on a
// bare idea vs. what needs entity/room context.
//
// tldraw-FREE on purpose: the registry + the augment fetch/normalize live here
// so any surface can import them; the editor-side RENDER of results lives in
// canvas-interactions/operation-executor.ts (the only tldraw consumer).

import type {
  AugmentMode,
  DecomposeResult,
  QuestionsResult,
  VariationsResult,
  PlanResult,
} from "@/lib/synergy/types";

/** What an operation needs to run.
 *  - text   : runs on a bare string (any sticky note / card title)
 *  - entity : needs a feature/pain/outcome entity id
 *  - room   : needs space + room scaffold */
export type OperationContract = "text" | "entity" | "room";

/** The thing an operation runs against — built from a card action today, from
 *  a selected sticky note in Phase 2. shapeId tethers results near the source. */
export interface OperationTarget {
  text: string;
  shapeId?: string;
  entityId?: string;
  roomId?: string;
}

/** One normalized result row → becomes one result card on the board. */
export interface OperationResultItem {
  title: string;
  subtitle?: string;
}

/** Per-run knobs the scanner / top settings bar thread into the analysis routes.
 *  temperature applies to every op; depth/questionCount/webSearch are honored by
 *  the converge-diverge route (other routes ignore the extra fields). */
export interface OperationRunOptions {
  /** 0–1 sampling temperature (the scanner's slider). Omit → route default. */
  temperature?: number;
  /** 1–5 reasoning rigor (the top-bar "thinking depth" knob). */
  depth?: number;
  /** how many questions a diverge/converge pass generates ("complexity"). */
  questionCount?: number;
  /** ground a diverge/converge pass with live web search. */
  webSearch?: boolean;
}

export interface CanvasOperation {
  /** Stable id. The four card-menu actions reuse their CardAction ids
   *  (decompose/variations/questions/make_plan) so there's no mapping. */
  id: string;
  label: string;
  /** Plain-language one-liner — the copy the scanner shows. */
  intent: string;
  contract: OperationContract;
  /** When set, the executor runs this via POST /api/synergy/augment. */
  augmentMode?: AugmentMode;
  /** Native API route (documentation; not all are executor-wired yet). */
  route?: string;
  requiresLlm: boolean;
  /** False = cataloged for the registry/scanner, but the executor can't run it
   *  yet (native-route wiring lands in a later phase). Keeps the doc honest. */
  wired: boolean;
  /** How the executor lays out result cards (default grid). Ordered ops
   *  (e.g. layers) read better as a vertical column. */
  resultLayout?: "grid" | "column";
  /** Override endpoint for non-augment text ops (default /api/canvas/idea-op).
   *  e.g. make_technical → the full mechanism-spec generator. */
  endpoint?: string;
  /** Hidden from the scanner's recommendation list + the menu helper, but
   *  still runnable by id (executeCardOperation). The diverge/converge verbs
   *  use this — they're surfaced as the dedicated ‹ › buttons, not as rows. */
  hidden?: boolean;
}

/** THE CATALOG. Grounded in src/lib/objective-canvas/* + the routes that invoke
 *  them (see CANVAS_AI_SCANNER_PLAN.md §2 for the full lib-fn/output mapping). */
export const CANVAS_OPERATIONS: CanvasOperation[] = [
  // ── Wired now: text-only, via /api/synergy/augment ──
  {
    id: "decompose",
    label: "Decompose",
    intent: "Break this into principles, parts and up/down-stream pieces",
    contract: "text",
    augmentMode: "decompose",
    requiresLlm: true,
    wired: true,
  },
  {
    id: "variations",
    label: "Variations",
    intent: "Give me alternative angles on this idea",
    contract: "text",
    augmentMode: "variations",
    requiresLlm: true,
    wired: true,
  },
  {
    id: "questions",
    label: "Questions",
    intent: "What should I clarify before building this?",
    contract: "text",
    augmentMode: "questions",
    requiresLlm: true,
    wired: true,
  },
  {
    id: "make_plan",
    label: "Make plan",
    intent: "Turn this into an actionable plan",
    contract: "text",
    augmentMode: "plan",
    requiresLlm: true,
    wired: true,
  },
  {
    id: "make_technical",
    label: "Make it more technical",
    intent: "Generate the mechanism: data-flow, components, methods",
    contract: "text",
    requiresLlm: true,
    wired: true,
    endpoint: "/api/canvas/idea-mechanism",
  },
  {
    id: "layers",
    label: "What are the layers",
    intent: "Conceptual altitude stack (substrate → outcome)",
    contract: "text",
    requiresLlm: true,
    wired: true,
    resultLayout: "column",
  },
  {
    id: "data_flow",
    label: "Map the data flow",
    intent: "Practical upstream → downstream: what data moves where, at what scale",
    contract: "text",
    requiresLlm: true,
    wired: true,
    resultLayout: "column",
  },

  // ── The two compressed verbs — fired by the ‹ › buttons, not the row list
  //    (hidden). "pipeline" engine runs them; "regroup" re-aims to the ops
  //    above instead (see lib/objective-canvas/converge-diverge.ts). ──
  {
    id: "diverge",
    label: "Diverge",
    intent: "Open the space: meta questions → answers → distilled factor nodes",
    contract: "text",
    requiresLlm: true,
    wired: true,
    endpoint: "/api/canvas/converge-diverge",
    hidden: true,
  },
  {
    id: "converge",
    label: "Converge",
    intent: "Close the space: constraint questions → answers → distilled decisions",
    contract: "text",
    requiresLlm: true,
    wired: true,
    endpoint: "/api/canvas/converge-diverge",
    hidden: true,
  },

  // ── Cataloged; entity ops pending the Phase-3 scratch-entity scaffold ──
  {
    id: "sub_objectives",
    label: "Break into sub-objectives",
    intent: "Propose the rooms this objective splits into",
    contract: "text",
    route: "/api/brainstorm/sub-objectives/propose",
    requiresLlm: true,
    wired: false,
  },
  {
    id: "mechanism_spec",
    label: "Develop the mechanism spec",
    intent: "Full engineering spec: data-flow DAG, components, methods",
    contract: "entity",
    route: "/api/brainstorm/item/[entityId]/mechanism-spec",
    requiresLlm: true,
    wired: false,
  },
  {
    id: "sharpen",
    label: "Sharpen",
    intent: "Tighten this into a specific, measurable statement",
    contract: "entity",
    route: "/api/brainstorm/item/[entityId]/sharpen",
    requiresLlm: true,
    wired: false,
  },
  {
    id: "expand",
    label: "Deep-dive",
    intent: "Spawn a deeper exploration of one sub-part",
    contract: "entity",
    route: "/api/brainstorm/item/expansion/spawn",
    requiresLlm: true,
    wired: false,
  },
];

const BY_ID = new Map(CANVAS_OPERATIONS.map((o) => [o.id, o]));

export function operationById(id: string): CanvasOperation | undefined {
  return BY_ID.get(id);
}

/** The operations the per-card / per-sticky hover menu offers (wired text ops).
 *  Excludes hidden verbs (diverge/converge) — those ride the ‹ › buttons. */
export function menuOperations(): CanvasOperation[] {
  return CANVAS_OPERATIONS.filter(
    (o) => o.wired && o.contract === "text" && !o.hidden,
  );
}

/** Cap so one click can't flood the board. */
const MAX_RESULT_ITEMS = 8;

/** Run a wired augment-backed operation and return normalized result rows.
 *  Soft-fails to [] (network/credit/parse) so the caller never throws. */
export async function runAugmentOperation(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (!op.augmentMode || !target.text.trim()) return [];
  try {
    const res = await fetch("/api/synergy/augment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcript: target.text.slice(0, 8000),
        mode: op.augmentMode,
        precision: 3,
        // Run these on-canvas analyses with the best Claude model, at the
        // strategist's chosen temperature (undefined → the route default).
        provider: "anthropic",
        temperature: opts.temperature,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { mode?: string; result?: unknown };
    return normalizeAugment(op.augmentMode, json.result).slice(0, MAX_RESULT_ITEMS);
  } catch {
    return [];
  }
}

/** Map a mode-specific augment payload → flat result rows for the board. */
function normalizeAugment(
  mode: AugmentMode,
  result: unknown,
): OperationResultItem[] {
  if (!result || typeof result !== "object") return [];
  switch (mode) {
    case "questions": {
      const r = result as QuestionsResult;
      return (r.questions ?? []).map((q) => ({ title: q }));
    }
    case "variations": {
      const r = result as VariationsResult;
      return (r.variations ?? []).map((v) => ({
        title: v.label,
        subtitle: v.rationale,
      }));
    }
    case "plan": {
      const r = result as PlanResult;
      return (r.steps ?? []).map((s) => ({
        title: s.label,
        subtitle: s.rationale,
      }));
    }
    case "decompose": {
      const r = result as DecomposeResult;
      const out: OperationResultItem[] = [];
      for (const t of r.first_principles ?? [])
        out.push({ title: t, subtitle: "First principle" });
      for (const t of r.variations ?? [])
        out.push({ title: t, subtitle: "Variation" });
      for (const t of r.upstream ?? [])
        out.push({ title: t, subtitle: "Upstream" });
      for (const t of r.downstream ?? [])
        out.push({ title: t, subtitle: "Downstream" });
      return out;
    }
    default:
      return [];
  }
}

/** Dispatch: run any wired operation and return normalized result rows.
 *  augment-backed ops → /api/synergy/augment; the rest → /api/canvas/idea-op. */
export async function runOperation(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (op.augmentMode) return runAugmentOperation(op, target, opts);
  if (op.wired) return runIdeaOp(op, target, opts);
  return [];
}

/** Run a non-augment text op (layers / make_technical) via /api/canvas/idea-op.
 *  Soft-fails to [] so the caller never throws. */
async function runIdeaOp(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (!target.text.trim()) return [];
  try {
    const res = await fetch(op.endpoint ?? "/api/canvas/idea-op", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: target.text.slice(0, 4000),
        kind: op.id,
        temperature: opts.temperature,
        // Honored by /api/canvas/converge-diverge; ignored by idea-op.
        depth: opts.depth,
        questionCount: opts.questionCount,
        webSearch: opts.webSearch,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: Array<{ title?: string; subtitle?: string }>;
    };
    return (json.items ?? [])
      .filter(
        (it) => typeof it.title === "string" && it.title.trim().length > 0,
      )
      .map((it) => ({
        title: (it.title as string).trim(),
        subtitle: typeof it.subtitle === "string" ? it.subtitle : undefined,
      }))
      .slice(0, MAX_RESULT_ITEMS);
  } catch {
    return [];
  }
}
