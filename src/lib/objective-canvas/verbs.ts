// ── The five verbs ───────────────────────────────────────────────────
//
// The double-diamond remodel (issue #17, DOUBLE_DIAMOND_REMODEL_SPEC.md)
// replaces the 12-row action rail + 61 disabled SpecForge actions with FIVE
// verbs. Four are thinking moves — they ARE the diamond. The fifth, Make, is
// the output move and is gated behind maturity.
//
// This registry is the single source of truth for what each verb is called,
// the question it asks the user, which half of the diamond it belongs to, and
// what it actually dispatches. The four thinking verbs resolve to existing
// `CanvasOperation`s (run by id via runIdeaOp — `hidden` does not block
// dispatch, so diverge/converge stay off the legacy scanner while the verb
// layer drives them directly). Make dispatches a composite flow handled by the
// rail, not a single op.

import { operationById, type CanvasOperation } from "./canvas-operations";

/** Which half of a diamond a move belongs to. `either` = usable in both. */
export type DiamondPhase = "diverge" | "converge" | "either";

export type VerbId = "widen" | "focus" | "deepen" | "test" | "make";

/** A verb dispatches either a single canvas op (the four thinking moves) or a
 *  composite flow owned by the rail (Make). Kept as a tagged union so the op
 *  targets can be validated against the catalog and the flow target can't be. */
export type VerbTarget =
  | { kind: "op"; op: string; alts: string[] }
  | { kind: "flow"; flow: string; alts: string[] };

export interface Verb {
  id: VerbId;
  label: string;
  /** The question the verb asks, in the user's words. This is the UI copy. */
  prompt: string;
  phase: DiamondPhase;
  target: VerbTarget;
  /** Make is disabled until the maturity bar crosses its threshold. The four
   *  thinking verbs are always available. */
  gated?: boolean;
}

export const VERBS: Verb[] = [
  {
    id: "widen",
    label: "Widen",
    prompt: "What else could this be?",
    phase: "diverge",
    // diverge = "open the space"; variations is the lighter alternate.
    target: { kind: "op", op: "diverge", alts: ["variations"] },
  },
  {
    id: "focus",
    label: "Focus",
    prompt: "Which of these actually matter?",
    phase: "converge",
    // converge = "close the space".
    target: { kind: "op", op: "converge", alts: [] },
  },
  {
    id: "deepen",
    label: "Deepen",
    prompt: "Why is that true?",
    phase: "either",
    // decompose (Unpack) is the everyday move; make_technical goes deeper.
    target: { kind: "op", op: "decompose", alts: ["make_technical"] },
  },
  {
    id: "test",
    label: "Test",
    prompt: "How would we know?",
    phase: "either",
    target: { kind: "op", op: "questions", alts: [] },
  },
  {
    id: "make",
    label: "Make",
    prompt: "Build something real from this",
    phase: "either",
    // Composite flow — the rail dispatches forge; make_plan/technical are the
    // lighter alternates. Gated behind maturity.
    target: { kind: "flow", flow: "forge", alts: ["make_plan", "make_technical"] },
    gated: true,
  },
];

const VERBS_BY_ID = new Map<VerbId, Verb>(VERBS.map((v) => [v.id, v]));

export function verbById(id: VerbId): Verb | undefined {
  return VERBS_BY_ID.get(id);
}

/** Resolve the primary op of an op-kind verb to its catalog entry. Returns
 *  undefined for flow-kind verbs (Make) — those are not single ops. */
export function primaryOpForVerb(verb: Verb): CanvasOperation | undefined {
  if (verb.target.kind !== "op") return undefined;
  return operationById(verb.target.op);
}

/** Every op id an op-kind verb references (primary + alternates), flattened.
 *  Used by the guard below and by tests to prove the registry stays honest. */
export function referencedOpIds(): string[] {
  const ids: string[] = [];
  for (const v of VERBS) {
    if (v.target.kind === "op") ids.push(v.target.op, ...v.target.alts);
  }
  return ids;
}

/** Throws if any op-kind verb references an op id that isn't in the catalog or
 *  isn't wired. Call once at module init in a dev assertion, or rely on the
 *  test. Kept as a function (not a top-level throw) so importing the registry
 *  never crashes the app in production. */
export function assertVerbsResolve(): void {
  for (const id of referencedOpIds()) {
    const op = operationById(id);
    if (!op) throw new Error(`verbs.ts references unknown op "${id}"`);
    if (!op.wired) throw new Error(`verbs.ts references un-wired op "${id}"`);
  }
}
