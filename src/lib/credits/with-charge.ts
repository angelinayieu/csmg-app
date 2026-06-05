// ── withCharge — the single charge+meter envelope for an operation ──
//
// Phase 2 of the credit work. Wrap any user-facing AI operation in withCharge
// and it will, in order:
//   1. Reserve the flat credit cost for the operation (OPERATION_COST).
//   2. Open a token-metering context (Phase 1 usage-meter) around the work, so
//      llm_call_log + pipeline_runs cost data is captured for the SAME op.
//   3. Run the work. On success → commit the reservation (debit). On throw →
//      cancel the reservation (no charge) and re-throw.
//
// Reuses the existing two-phase primitives (reserveCreditsAmount /
// commitReservation / cancelReservation) — it does NOT introduce a parallel
// credit path. Under BYPASS_CREDITS those primitives short-circuit, so
// withCharge is transparently a no-op charge in dev.
//
// Free operations (cost 0, e.g. prompt_sharpen) skip the reservation but are
// still metered — so the meter always sees every call, charged or not.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  reserveCreditsAmount,
  commitReservation,
  cancelReservation,
} from "../credits";
import { costForOperation } from "./operation-costs";
import { withMetering } from "../llm/usage-meter";

/** Thrown when the user can't afford an operation. Routes catch it and return
 *  a structured 402 (see creditErrorResponse). */
export class CreditError extends Error {
  readonly status = 402;
  readonly operation: string;
  readonly required: number;
  readonly balance: number;
  constructor(operation: string, required: number, balance: number) {
    super(
      `Insufficient credits for "${operation}": need ${required}, have ${balance}.`,
    );
    this.name = "CreditError";
    this.operation = operation;
    this.required = required;
    this.balance = balance;
  }
}

export interface ChargeContext {
  /** Already-authed server supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>;
  userId: string;
  /** Operation key — must match a metering callSite + (ideally) an
   *  OPERATION_COST key. Unknown keys charge DEFAULT_OP_COST. */
  operation: string;
  spaceId?: string | null;
  /** When this op IS a pipeline run, pass its id so the metered token/$
   *  aggregate also lands on pipeline_runs. */
  runId?: string | null;
}

/**
 * Charge + meter envelope. Returns whatever `fn` returns. Throws CreditError
 * when the user can't afford the operation (before running `fn`).
 */
export async function withCharge<T>(
  ctx: ChargeContext,
  fn: () => Promise<T>,
): Promise<T> {
  const cost = costForOperation(ctx.operation);
  const meterCtx = {
    db: ctx.db,
    userId: ctx.userId,
    spaceId: ctx.spaceId ?? null,
    callSite: ctx.operation,
    runId: ctx.runId ?? null,
  };

  // Free operation — meter + run, no reservation.
  if (cost <= 0) {
    return withMetering(meterCtx, fn);
  }

  const reservation = await reserveCreditsAmount(
    ctx.db,
    ctx.userId,
    cost,
    ctx.operation,
  );
  if (!reservation.success) {
    throw new CreditError(ctx.operation, cost, reservation.balance);
  }

  try {
    const result = await withMetering(meterCtx, fn);
    // Commit AFTER the work succeeds — a failed op never charges.
    await commitReservation(
      ctx.db,
      reservation.reservationId,
      ctx.spaceId ?? undefined,
    );
    return result;
  } catch (err) {
    await cancelReservation(ctx.db, reservation.reservationId);
    throw err;
  }
}

/** If `err` is a CreditError, return a structured 402 NextResponse; otherwise
 *  null (caller falls through to its normal error handling). Keeps the 402
 *  shape consistent across every route that adopts withCharge. */
export function creditErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof CreditError) {
    return NextResponse.json(
      {
        error: err.message,
        code: "insufficient_credits",
        operation: err.operation,
        required: err.required,
        balance: err.balance,
      },
      { status: 402 },
    );
  }
  return null;
}
