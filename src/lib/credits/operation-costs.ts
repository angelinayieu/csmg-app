// ── Operation cost registry — flat credits per operation class ──────
//
// The locked charge model (2026-06-04) is FLAT per operation-class: users pay
// a fixed, predictable number of credits per operation, NOT a variable
// per-token amount. The token meter (src/lib/llm/usage-meter.ts) runs
// underneath purely as cost-truth — use the measured medians it produces to
// RE-TUNE these numbers over time; the user-facing price stays flat.
//
// One source of truth. Add a key here, reference it via costForOperation();
// withCharge() does the reserve→commit. Keep keys aligned with the metering
// callSite strings so llm_call_log + credit_ledger join cleanly on operation.
//
// 0 = free (no reservation, still metered). Unknown op → DEFAULT_OP_COST so a
// new operation can never accidentally be free.

export const OPERATION_COST = {
  // Intake — free so first-touch never gates the funnel.
  prompt_sharpen: 0,
  image_analyze: 0,

  // Canvas "simple analysis" power-ups (decompose / variations / questions /
  // make_plan / layers / data_flow / custom). One Sonnet/Opus call each.
  canvas_op: 1,

  // Compound canvas verbs — multi-pass (questions → answers → distil).
  converge_diverge: 2,

  // Objective-canvas heavy single ops.
  deep_synthesize: 3,

  // Pipeline runs (the classic decompose/research/synthesize lane).
  decompose: 3,
  synthesize: 4,
  research: 5,
  research_deep: 8,
} as const;

export type OperationKey = keyof typeof OPERATION_COST;

/** Default charge for any operation not in the registry. Never 0 — an
 *  unregistered op should cost something, not silently run free. */
export const DEFAULT_OP_COST = 1;

/** Flat credit cost for an operation. Accepts any string (callSite) so callers
 *  don't need the literal union; unknown ops fall back to DEFAULT_OP_COST. */
export function costForOperation(operation: string): number {
  const v = (OPERATION_COST as Record<string, number>)[operation];
  return typeof v === "number" ? v : DEFAULT_OP_COST;
}
