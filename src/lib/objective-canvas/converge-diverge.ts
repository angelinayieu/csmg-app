// ── Converge / Diverge — the two compressed canvas verbs ──
//
// The whole "AI power-ups" menu collapses into two moves the user makes on any
// node: diverge ( ‹ ) opens the space, converge ( › ) closes it. A top toggle
// picks WHICH engine those buttons fire so the two approaches can be compared
// side by side on the same board:
//
//   "pipeline" — the new three-move loop (questions → answers → distilled nodes)
//                via /api/canvas/converge-diverge.
//   "regroup"  — just re-aims the existing wired ops (decompose / make_plan),
//                i.e. the un-compressed power-ups, so the diff is legible.
//
// tldraw-free + dependency-free on purpose: importable from the card hover bar,
// the scanner panel, the top toggle, and the executor host alike.

export type Direction = "diverge" | "converge";
export type DirectionEngine = "pipeline" | "regroup";

/** localStorage key + change event for the active engine (read at click time
 *  by the run paths; the toggle writes it and broadcasts the event). */
export const DIRECTION_ENGINE_KEY = "oc:direction-engine";
export const DIRECTION_ENGINE_EVENT = "oc:direction-engine-changed";
export const DEFAULT_DIRECTION_ENGINE: DirectionEngine = "pipeline";

/** Which existing wired op each verb re-aims to in "regroup" mode. The most
 *  representative expand / narrow ops already in the registry. */
const REGROUP_OP: Record<Direction, string> = {
  diverge: "decompose",
  converge: "make_plan",
};

/** Resolve the canvas-operation id a verb should run under the active engine.
 *  pipeline → the verb's own op (diverge/converge); regroup → an existing op. */
export function opIdForDirection(
  direction: Direction,
  engine: DirectionEngine,
): string {
  return engine === "pipeline" ? direction : REGROUP_OP[direction];
}

/** Read the active engine (SSR-safe; defaults to the pipeline). */
export function getDirectionEngine(): DirectionEngine {
  if (typeof window === "undefined") return DEFAULT_DIRECTION_ENGINE;
  try {
    return window.localStorage.getItem(DIRECTION_ENGINE_KEY) === "regroup"
      ? "regroup"
      : "pipeline";
  } catch {
    return DEFAULT_DIRECTION_ENGINE;
  }
}

/** Persist the active engine + broadcast so open surfaces re-render. */
export function setDirectionEngine(engine: DirectionEngine): void {
  try {
    window.localStorage.setItem(DIRECTION_ENGINE_KEY, engine);
    window.dispatchEvent(
      new CustomEvent(DIRECTION_ENGINE_EVENT, { detail: engine }),
    );
  } catch {
    /* private mode — the in-memory toggle state still drives this session */
  }
}

// Temperature is shared with the scanner's slider so a verb fired from the
// card hover bar (which has no slider) still honors the strategist's setting.
const TEMP_KEY = "oc:analysis-temperature";
const DEFAULT_TEMPERATURE = 0.4;

/** The scanner-slider temperature (SSR-safe), for run paths without their own. */
export function getAnalysisTemperature(): number {
  if (typeof window === "undefined") return DEFAULT_TEMPERATURE;
  try {
    const saved = Number(window.localStorage.getItem(TEMP_KEY));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1
      ? saved
      : DEFAULT_TEMPERATURE;
  } catch {
    return DEFAULT_TEMPERATURE;
  }
}
