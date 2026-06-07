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
import {
  UNPACK_STARTED_EVENT,
  UNPACK_RESULT_EVENT,
  UNPACK_FAILED_EVENT,
  type UnpackStartedDetail,
  type UnpackResultDetail,
  type UnpackFailedDetail,
  type UnpackResultPayload,
} from "./unpack-events";

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
  /** Source card "kind" (artifact-card `mechanism`, oc-card `feature`/`variable`,
   *  …). Lets the registry hide ops that don't fit the source — e.g. Variations
   *  doesn't apply to a make_technical step card. Optional + free-form on
   *  purpose so a sticky-note target (no kind) still runs everything. */
  sourceKind?: string;
}

/** One normalized result row → becomes one result card on the board. */
export interface OperationResultItem {
  title: string;
  subtitle?: string;
  /** Classification from the converge-diverge / custom ops: feature | variable
   *  | factor | decision | question. Drives whether the executor renders an
   *  oc-card (feature/variable) vs a generic node, and the library object_type. */
  type?: string;
  /** For mechanism-step rows (make_technical / data_flow): the data tokens this
   *  step takes IN. Already shown in the subtitle as text; lifted here as
   *  STRUCTURED data so downstream (library save → tech-spec) reads them as
   *  interface contracts instead of parsing strings. Empty/omitted for
   *  non-mechanism rows. */
  consumes?: string[];
  /** Tokens this step emits — pair to `consumes` (see above). */
  produces?: string[];
  /** Stable slug for the item — opaque to the deploy path EXCEPT as the
   *  resolution key for `parents` (which references slugs of other items
   *  in the same result set). Set by ops that emit causal structure
   *  (unpack); omitted by legacy flat ops. */
  slug?: string;
  /** Slugs of items in the SAME result set this row causally derives from.
   *  The deploy path reads these to draw flow-connectors between cards in
   *  the same cluster — turning the flat grid into a real causal map.
   *  Empty for ops without inter-row structure. */
  parents?: string[];
  /** Library_objects.id when the route pre-persisted this item (unpack
   *  does this so the cluster's edges land in `object_links` server-side
   *  and the on-board card opens its detail drawer on click). Omitted by
   *  legacy ops that don't persist before deploy. */
  objectId?: string;
  /** Optional grouping label so the deploy path can paint per-subsystem
   *  underlays around causally-related rows (e.g. variations cluster under
   *  the principle they were spawned from). */
  subsystem?: string;
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
  /** the user's own instruction (the "custom" op on a selection). */
  prompt?: string;
  /** when set, result cards auto-persist to this space's Library (library_objects). */
  spaceId?: string;
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
  /** Hide this op from a SOURCE card whose kind is in this list — used to
   *  prune nonsense recommendations (e.g. Variations on a mechanism step,
   *  Make-it-technical on a card that already IS a mechanism step). The op
   *  stays runnable by id; only the recommendation surfaces filter on it. */
  excludeForKinds?: string[];
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
    // A mechanism step ("1. Collect engagement data" with consumes/produces
    // tokens) is one rung in a runtime flow — "alternative angles" doesn't
    // apply; the user wants per-step ops (refine-interface / edge-cases /
    // estimate) instead. Hide rather than offer noise.
    excludeForKinds: ["mechanism"],
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
    endpoint: "/api/canvas/make-plan",
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
    // The card already IS a mechanism step; re-deriving the mechanism from
    // it just nests a smaller chain inside one rung. Hide; keep the op
    // available by id (a deliberate run still works).
    excludeForKinds: ["mechanism"],
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
  {
    id: "custom",
    label: "Custom",
    intent: "Run your own instruction over the selection",
    contract: "text",
    requiresLlm: true,
    wired: true,
    endpoint: "/api/canvas/custom-op",
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

/** Why a canvas op couldn't RUN — distinct from "ran and returned nothing".
 *  The trigger surfaces (the ‹ › verbs) used to render the same silent "Empty"
 *  whether the model genuinely found nothing OR the request failed (a hung dev
 *  server, a 5xx, a dropped connection, exhausted credits). That made a broken
 *  call look identical to an empty one — the core "diverge doesn't work, just
 *  goes empty" report. We now throw this so the UI can tell the truth + the
 *  user knows a retry is worthwhile. */
export type OperationErrorReason =
  | "network"
  | "server"
  | "credits" // the USER's app-credit balance is too low
  | "provider" // the LLM provider key is out of credits (NOT the user's fault)
  | "auth";

export class OperationTransportError extends Error {
  constructor(
    public reason: OperationErrorReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "OperationTransportError";
  }
}

/** POST JSON to a canvas-op endpoint with a hard timeout + one retry on a
 *  transient transport failure (network drop / abort / 5xx). A single retry
 *  self-heals the blips that were silently surfacing as "Empty"; a thrown
 *  OperationTransportError (instead of a swallowed []) lets the caller
 *  distinguish "couldn't run" from "no results". */
async function postOp(endpoint: string, body: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    // 75s > the routes' 60s maxDuration, so a real (slow) response is never
    // aborted — only a genuinely stuck request trips the timeout.
    const timer = setTimeout(() => ctrl.abort(), 75_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // A 5xx is worth exactly one retry (cold route / transient upstream); a
      // 4xx is the caller's problem and must not be retried.
      if (res.status >= 500 && attempt === 0) {
        lastErr = new Error(`server ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err; // network error or abort → retry once, then surface.
    }
  }
  throw new OperationTransportError(
    "network",
    lastErr instanceof Error ? lastErr.message : "network error",
  );
}

/** Map a non-OK response to a typed transport error (credits / provider / auth
 *  / server). For a 402 we read the body `code` to tell the USER's app-credit
 *  exhaustion (`insufficient_credits` → "credits") from the LLM PROVIDER key
 *  running dry (`credits_exhausted` → "provider") — the two must not share the
 *  misleading "Out of credits" message when the user has a full balance. */
async function transportErrorFor(res: Response): Promise<OperationTransportError> {
  if (res.status === 402) {
    let code: string | undefined;
    try {
      code = ((await res.json()) as { code?: string })?.code;
    } catch {
      /* no/empty body — default to the user-credit reading below */
    }
    return new OperationTransportError(
      code === "credits_exhausted" ? "provider" : "credits",
    );
  }
  if (res.status === 401 || res.status === 403)
    return new OperationTransportError("auth");
  return new OperationTransportError("server", `HTTP ${res.status}`);
}

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

/** True when `op` makes sense for a source card whose kind is `sourceKind`.
 *  Anything without a sourceKind (sticky note, lasso of stickies) keeps the
 *  full list — the exclusion only fires for cards that declared their kind. */
export function operationFitsKind(
  op: CanvasOperation,
  sourceKind: string | undefined,
): boolean {
  if (!sourceKind) return true;
  if (!op.excludeForKinds || op.excludeForKinds.length === 0) return true;
  return !op.excludeForKinds.includes(sourceKind);
}

/** Cap so one click can't flood the board. */
const MAX_RESULT_ITEMS = 8;

/** Run a wired augment-backed operation and return normalized result rows.
 *  Returns [] for a genuine empty result; THROWS OperationTransportError when
 *  the request itself failed (network / 5xx / credits / auth) so the caller can
 *  distinguish "no results" from "couldn't run" instead of showing a silent
 *  "Empty". A re-thrown OperationTransportError is left intact. */
export async function runAugmentOperation(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (!op.augmentMode || !target.text.trim()) return [];
  const res = await postOp(
    "/api/synergy/augment",
    JSON.stringify({
      transcript: target.text.slice(0, 8000),
      mode: op.augmentMode,
      precision: 3,
      // Run these on-canvas analyses with the best Claude model, at the
      // strategist's chosen temperature (undefined → the route default).
      provider: "anthropic",
      temperature: opts.temperature,
    }),
  );
  if (!res.ok) throw await transportErrorFor(res);
  let json: { mode?: string; result?: unknown };
  try {
    json = (await res.json()) as { mode?: string; result?: unknown };
  } catch {
    throw new OperationTransportError("server", "malformed response");
  }
  return normalizeAugment(op.augmentMode, json.result).slice(0, MAX_RESULT_ITEMS);
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
 *  - `decompose` ("Unpack") with a spaceId routes to the new context-aware
 *    /api/objective/[spaceId]/unpack — it loads micros + intake factors +
 *    parent links + sharpened objective server-side, so variations are
 *    optimized for the card's actual purpose. The structured output
 *    carries causal edges (variation→principle) so the deploy path can
 *    draw real connectors between the cards. Falls back to the legacy
 *    augment path when there's no spaceId (raw text, no project context).
 *  - All other augment-backed ops → /api/synergy/augment (legacy flat path).
 *  - Native ops → /api/canvas/idea-op or their explicit endpoint.
 *  Returns [] for a genuine empty result; throws OperationTransportError when
 *  the request failed (the executor catches it → surfaces a "couldn't run"
 *  state rather than a silent "Empty"). */
export async function runOperation(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (op.id === "decompose" && opts.spaceId) {
    return runUnpack(target, opts);
  }
  if (op.augmentMode) return runAugmentOperation(op, target, opts);
  if (op.wired) return runIdeaOp(op, target, opts);
  return [];
}

/** Unpack runner — calls /api/objective/[spaceId]/unpack and flattens its
 *  {cards, links} into OperationResultItem[]. Links become `parents` on
 *  each variation so the deploy path can wire flow-connectors between
 *  sibling cards in the cluster. Principles land first (so variations can
 *  reference them by slug) and variations get their `subsystem` set to
 *  their first principle's slug, so each principle visually groups its
 *  children in the deployed swimlane.
 *
 *  Also dispatches Unpack lifecycle events (STARTED / RESULT / FAILED) so
 *  the reasoning sidebar (UnpackReasoningPanel) can open immediately on
 *  click, render the agent's reasoning log + the full structured tree, and
 *  accept chat refinements that loop back into this same route. */
async function runUnpack(
  target: OperationTarget,
  opts: OperationRunOptions,
): Promise<OperationResultItem[]> {
  if (!target.text.trim() || !opts.spaceId) return [];
  const cardId = target.shapeId ?? "";
  const cardTitle = target.text.trim().split(/\n/)[0]?.slice(0, 120) ?? "";
  // Fire STARTED before the fetch so the sidebar opens IMMEDIATELY with a
  // "Reasoning…" state. Without this the user waits ~15s for the round-trip
  // before the sidebar acknowledges anything happened.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent<UnpackStartedDetail>(UNPACK_STARTED_EVENT, {
          detail: { cardId, cardTitle, sourceKind: target.sourceKind ?? "" },
        }),
      );
    } catch {
      /* defensive — never block the op on a dispatch error */
    }
  }
  let res: Response;
  try {
    res = await postOp(
      `/api/objective/${opts.spaceId}/unpack`,
      JSON.stringify({
        text: target.text.slice(0, 6000),
        cardId,
        sourceKind: target.sourceKind ?? "",
        temperature: opts.temperature,
      }),
    );
  } catch (err) {
    // Network / transport failure before the route responded.
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent<UnpackFailedDetail>(UNPACK_FAILED_EVENT, {
            detail: { cardId, reason: err instanceof Error ? err.message : "network error" },
          }),
        );
      } catch {
        /* defensive */
      }
    }
    throw err;
  }
  if (!res.ok) {
    const err = await transportErrorFor(res);
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent<UnpackFailedDetail>(UNPACK_FAILED_EVENT, {
            detail: { cardId, reason: err.message || `unpack failed (${res.status})` },
          }),
        );
      } catch {
        /* defensive */
      }
    }
    throw err;
  }
  let json: UnpackResultPayload;
  try {
    json = (await res.json()) as UnpackResultPayload;
  } catch {
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent<UnpackFailedDetail>(UNPACK_FAILED_EVENT, {
            detail: { cardId, reason: "malformed response" },
          }),
        );
      } catch {
        /* defensive */
      }
    }
    throw new OperationTransportError("server", "malformed response");
  }
  const cards = json.cards ?? [];
  const links = json.links ?? [];
  // Fire RESULT with the full structured payload so the sidebar can render
  // the reasoning log + principles tree + ranking without re-fetching.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent<UnpackResultDetail>(UNPACK_RESULT_EVENT, {
          detail: {
            cardId,
            goal_frame: json.goal_frame ?? { goal: "", evidence: "" },
            reasoning_log: json.reasoning_log ?? [],
            ranking: json.ranking ?? [],
            cards,
            links,
          },
        }),
      );
    } catch {
      /* defensive */
    }
  }
  // Build a fromSlug → parents[] map for variations. Principles have no
  // parents inside the cluster (their parent is the source card, drawn by
  // the existing frameForkedGroup tether, not by an inter-card connector).
  const parentsBySlug = new Map<string, string[]>();
  for (const l of links) {
    if (l.relation !== "derived_from") continue;
    const arr = parentsBySlug.get(l.fromSlug) ?? [];
    arr.push(l.toSlug);
    parentsBySlug.set(l.fromSlug, arr);
  }
  return cards
    .map((c): OperationResultItem | null => {
      if (!c.title) return null;
      return {
        title: c.title,
        // Honest label: shown directly on the card chrome (the user asked
        // for this — no more "Lab" eyebrow). The full rationale follows
        // on the next line as the body.
        subtitle: c.body,
        type: c.kind, // "first_principle" or "variation"
        slug: c.slug,
        parents: parentsBySlug.get(c.slug) ?? [],
        objectId: c.objectId ?? undefined,
        subsystem: c.subsystem,
      };
    })
    .filter((c): c is OperationResultItem => !!c)
    .slice(0, MAX_RESULT_ITEMS);
}

/** Run a non-augment text op (diverge / converge / layers / make_technical) via
 *  its endpoint. Returns [] for a genuine empty result; THROWS
 *  OperationTransportError when the request itself failed (network / 5xx /
 *  credits / auth) so the verb shows "couldn't run — retry" instead of the
 *  misleading silent "Empty" that masked every diverge failure. */
async function runIdeaOp(
  op: CanvasOperation,
  target: OperationTarget,
  opts: OperationRunOptions = {},
): Promise<OperationResultItem[]> {
  if (!target.text.trim()) return [];
  const res = await postOp(
    op.endpoint ?? "/api/canvas/idea-op",
    JSON.stringify({
      text: target.text.slice(0, 4000),
      kind: op.id,
      temperature: opts.temperature,
      // Honored by /api/canvas/converge-diverge; ignored by idea-op.
      depth: opts.depth,
      questionCount: opts.questionCount,
      webSearch: opts.webSearch,
      // Honored by /api/canvas/custom-op (the user's instruction).
      prompt: opts.prompt,
      // Honored by /api/canvas/make-plan. Other native op routes ignore it.
      spaceId: opts.spaceId,
      cardId: target.shapeId,
      sourceKind: target.sourceKind,
    }),
  );
  if (!res.ok) throw await transportErrorFor(res);
  type RawItem = {
    title?: string;
    subtitle?: string;
    type?: string;
    consumes?: unknown;
    produces?: unknown;
  };
  let json: { items?: RawItem[] };
  try {
    json = (await res.json()) as { items?: RawItem[] };
  } catch {
    throw new OperationTransportError("server", "malformed response");
  }
  const asStrings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : undefined;
  return (json.items ?? [])
    .filter((it) => typeof it.title === "string" && it.title.trim().length > 0)
    .map((it) => ({
      title: (it.title as string).trim(),
      subtitle: typeof it.subtitle === "string" ? it.subtitle : undefined,
      type: typeof it.type === "string" ? it.type : undefined,
      consumes: asStrings(it.consumes),
      produces: asStrings(it.produces),
    }))
    .slice(0, MAX_RESULT_ITEMS);
}
