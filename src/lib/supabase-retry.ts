// ── Supabase retry wrapper ───────────────────────────────────────────
//
// Direct response to Vercel error anomaly 2026-04-28 16:40 UTC:
// "Intermittent Supabase API connectivity failures caused function
// timeouts on the /api/credits/balance route. Failures occurred on
// both Supabase authentication and profiles endpoints."
//
// The Supabase JS SDK has NO built-in retry for `.from().select()` /
// `.insert()` patterns or for `auth.getUser()`. A single network blip
// during a transient outage = full request failure = bootstrap chain
// returns 500 to the user before any LLM stage runs. Combined with
// our chain-of-`await fetch(${origin}/...)` design, one Supabase
// blip cascades into "whiteboard never generates" for the user.
//
// This module provides two retry primitives:
//
//   retrySupabase<T>(fn)
//     Retries any thrown promise. Use for SDK calls that throw on
//     network errors (auth.getUser, RPC calls).
//
//   retrySupabaseQuery<T>(fn)
//     Retries Supabase `{ data, error }` patterns where the SDK
//     returns an error object instead of throwing. Inspects
//     error.code + error.message for transient-network signatures.
//     Use for `.from().select() / .insert() / .update()`.
//
// Backoff: 3 attempts by default, 100ms / 400ms / 1200ms with ±50%
// jitter. Total worst-case wall time: ~1.7s. Median outage recovery
// in the 16:41-16:49 incident was ~30s, so most user-facing requests
// would have succeeded on retry within that window.
//
// What we DO NOT retry:
//   - 4xx auth/permission errors (intentional — RLS denials are real)
//   - Constraint violations (unique key, FK) — those are real bugs
//   - "row not found" empty results — that's a valid state, not an error
//   - PGRST116 (no rows from .single()) — ditto
//
// What we DO retry:
//   - TypeError "fetch failed" (Node.js fetch network failure)
//   - AbortError (only when not user-initiated — see opts.signal)
//   - HTTP 502 / 503 / 504 in the response
//   - Postgres connection errors (PGRST002, etc.)
//   - Generic "ECONNRESET" / "ETIMEDOUT" / "ENOTFOUND" in error message

// ── Tunables ─────────────────────────────────────────────────────────

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_MS = 100;
export const DEFAULT_BACKOFF_FACTOR = 4; // 100ms → 400ms → 1600ms
export const DEFAULT_JITTER_PCT = 0.5; // ±50%

// ── Circuit breaker tunables ────────────────────────────────────────
//
// When retry alone isn't enough — e.g. the Vercel alert 2026-04-28
// 16:41-16:49 UTC was an 8-min Supabase outage. Retries within a
// 2.1s budget absorb only the very edges of that window; the deep
// middle would still fail every retry. Worse, EVERY incoming request
// would have hammered the already-degraded Supabase pool with 3
// retries each, deepening the problem.
//
// The circuit breaker pattern fixes both: after N consecutive
// failures within W seconds, the breaker "opens" — every Supabase
// call short-circuits to a fast 503 for COOLDOWN seconds without
// hitting the network. On expiry, the next call goes through; if
// it succeeds, the breaker closes; if it fails, the breaker
// reopens.
//
// State is module-level (in-memory). Per-process scope is acceptable
// because all requests within a Lambda hit the same module instance,
// and during outages we WANT each Lambda to fail fast independently
// rather than coordinate.

export const CIRCUIT_FAILURE_THRESHOLD = 5; // 5 consecutive failures
export const CIRCUIT_FAILURE_WINDOW_MS = 60_000; // within 60s
export const CIRCUIT_COOLDOWN_MS = 30_000; // breaker stays open 30s

// ── Types ────────────────────────────────────────────────────────────

export interface RetryOpts {
  /** Total attempts INCLUDING the first (so 3 = original + 2 retries). */
  maxAttempts?: number;
  /** Base delay in ms. Each subsequent attempt multiplies by factor. */
  baseMs?: number;
  /** Multiplier for backoff: nextDelay = baseMs * factor^(attempt-1). */
  factor?: number;
  /** Jitter percentage [0,1]. Real delay = computed * (1 ± random*pct). */
  jitterPct?: number;
  /** Custom predicate. Defaults to isTransientNetworkError below. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Caller-provided AbortSignal — when aborted, we stop retrying
   *  immediately without waiting for the backoff. */
  signal?: AbortSignal;
  /** Optional callback fired before each retry. Useful for telemetry
   *  to count "supabase_retried" events without polluting call sites. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Supabase SDK error shape — `.from().select()` returns
 * `{ data, error }` where error is null on success or an object with
 * code/message/details on failure. We inspect the error object to
 * decide whether retrying makes sense.
 */
export interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export interface SupabaseQueryResult<T> {
  data: T | null;
  error: SupabaseErrorLike | null;
}

// ── Predicates ───────────────────────────────────────────────────────

/**
 * Default retryability check. Returns true for the kinds of errors
 * that are typically transient (network, infra) and false for
 * application-level errors that won't be cured by retrying.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;

  // Thrown native error patterns (Node.js fetch + undici)
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Node.js fetch wraps the actual cause in `cause` — check both.
    const causeMsg =
      err.cause instanceof Error ? err.cause.message.toLowerCase() : "";

    const combined = `${msg}|${causeMsg}`;

    // Network-layer signatures
    if (combined.includes("fetch failed")) return true;
    if (combined.includes("econnreset")) return true;
    if (combined.includes("etimedout")) return true;
    if (combined.includes("enotfound")) return true;
    if (combined.includes("econnrefused")) return true;
    if (combined.includes("socket hang up")) return true;
    if (combined.includes("network error")) return true;
    if (combined.includes("connect timeout")) return true;
    if (combined.includes("read econnreset")) return true;

    // HTTP-status-shaped errors thrown by the SDK
    if (combined.includes("502") && combined.includes("bad gateway")) return true;
    if (combined.includes("503") && combined.includes("unavailable")) return true;
    if (combined.includes("504") && combined.includes("gateway timeout")) return true;

    // We don't retry the AbortError unless the abort came from our
    // own backoff path; user-initiated aborts should propagate.
    return false;
  }

  // Object-shaped (Supabase `{ error }` pattern)
  const e = err as SupabaseErrorLike;
  if (typeof e !== "object") return false;

  const code = (e.code ?? "").toString();
  const message = (e.message ?? "").toLowerCase();

  // PostgREST connection / pool errors
  // PGRST001: connection error (server-side proxy failure)
  // PGRST002: schema cache reload failure
  // 08000-08999: postgres connection errors per ISO SQL standard
  if (code.startsWith("PGRST00")) return true;
  if (code.startsWith("08")) return true;

  // Auth-related transient patterns. Auth API tends to surface
  // generic 500/503 messages on degradation. We DO NOT retry
  // 401/403 (those are real auth failures).
  if (message.includes("internal server error")) return true;
  if (message.includes("service unavailable")) return true;
  if (message.includes("gateway timeout")) return true;
  if (message.includes("connection terminated")) return true;
  if (message.includes("timeout")) return true;
  if (message.includes("network error")) return true;
  if (message.includes("fetch failed")) return true;

  return false;
}

// ── Circuit breaker state machine ───────────────────────────────────

interface CircuitState {
  /** Timestamps (ms) of recent transient failures. Older than
   *  CIRCUIT_FAILURE_WINDOW_MS get pruned on each access. */
  recentFailures: number[];
  /** When the breaker is open, this is the time at which it auto-
   *  closes (half-open trial). null when closed. */
  openUntil: number | null;
}

const circuit: CircuitState = {
  recentFailures: [],
  openUntil: null,
};

/**
 * Custom error thrown when the circuit breaker is open. Callers can
 * catch this specifically to render a "service degraded" UI without
 * waiting for retries to exhaust.
 *
 * The HTTP layer (api-helpers.ts safeAuth, intake/bootstrap, etc.)
 * detects this and returns 503 with `isServiceDegradation: true` +
 * `Retry-After: 30` so the client can show a banner.
 */
export class CircuitOpenError extends Error {
  readonly isServiceDegradation = true;
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(
      `Supabase circuit breaker is open. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function isCircuitOpenError(err: unknown): err is CircuitOpenError {
  return err instanceof CircuitOpenError;
}

/**
 * Read-only view of the breaker — useful for diagnostics + status
 * endpoints (e.g. /api/health). Returns null when closed.
 */
export function getCircuitStatus(): {
  open: boolean;
  recentFailureCount: number;
  openUntilMs: number | null;
} {
  pruneOldFailures();
  return {
    open: isCircuitOpen(),
    recentFailureCount: circuit.recentFailures.length,
    openUntilMs: circuit.openUntil,
  };
}

/**
 * Force-reset the breaker (mainly for tests + for an admin "reset"
 * endpoint we may add later). Production code path should never call
 * this — let the breaker manage itself.
 */
export function resetCircuit(): void {
  circuit.recentFailures.length = 0;
  circuit.openUntil = null;
}

function pruneOldFailures(): void {
  const cutoff = Date.now() - CIRCUIT_FAILURE_WINDOW_MS;
  circuit.recentFailures = circuit.recentFailures.filter((t) => t >= cutoff);
}

function isCircuitOpen(): boolean {
  if (circuit.openUntil === null) return false;
  if (Date.now() >= circuit.openUntil) {
    // Cooldown expired — half-open. Clear the open flag so the next
    // call probes Supabase. Failure history is preserved so a
    // re-failure quickly re-opens the breaker (low-pass filter).
    circuit.openUntil = null;
    return false;
  }
  return true;
}

function recordFailure(err: unknown): void {
  if (!isTransientNetworkError(err)) return;
  pruneOldFailures();
  circuit.recentFailures.push(Date.now());
  if (circuit.recentFailures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn(
      `[supabase-retry] Circuit breaker OPENED — ${circuit.recentFailures.length} transient failures in <60s. Cooldown: ${CIRCUIT_COOLDOWN_MS}ms.`,
    );
  }
}

function recordSuccess(): void {
  // Successful call clears the failure window. Belt-and-suspenders:
  // if we were half-open, this is the signal to close fully.
  if (circuit.recentFailures.length > 0) {
    circuit.recentFailures.length = 0;
  }
  circuit.openUntil = null;
}

function checkCircuit(): void {
  if (isCircuitOpen()) {
    const retryAfterMs =
      (circuit.openUntil ?? Date.now()) - Date.now();
    throw new CircuitOpenError(Math.max(0, retryAfterMs));
  }
}

// ── Backoff ──────────────────────────────────────────────────────────

function computeDelayMs(attempt: number, opts: RetryOpts): number {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const factor = opts.factor ?? DEFAULT_BACKOFF_FACTOR;
  const jitterPct = opts.jitterPct ?? DEFAULT_JITTER_PCT;
  const ideal = base * Math.pow(factor, attempt - 1);
  // Symmetric jitter — multiply by [1 - jitterPct, 1 + jitterPct]
  const jitter = 1 + (Math.random() * 2 - 1) * jitterPct;
  return Math.max(0, Math.round(ideal * jitter));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── Public entry: retrySupabase (thrown errors) ──────────────────────

/**
 * Retry a function that returns a Promise and may throw on transient
 * network errors. Use for SDK calls that throw rather than return
 * `{ data, error }`, e.g. `supabase.auth.getUser()`.
 *
 * Throws the LAST error after maxAttempts is exhausted. Caller's
 * existing try/catch sees the original error type — the wrapper is
 * transparent on failure.
 */
export async function retrySupabase<T>(
  fn: () => PromiseLike<T>,
  opts: RetryOpts = {},
): Promise<T> {
  // Fast-fail short-circuit when the breaker is open — saves us from
  // hammering an already-degraded Supabase + gives the client a
  // ~3ms response instead of waiting through retries that all fail.
  checkCircuit();

  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const shouldRetry = opts.shouldRetry ?? isTransientNetworkError;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      lastErr = err;
      // Account this attempt's outcome for the breaker BEFORE
      // deciding whether to retry. Non-transient errors don't count
      // against the breaker (4xx auth, RLS, constraint violations
      // are user errors, not infrastructure).
      recordFailure(err);
      if (attempt >= max || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delayMs = computeDelayMs(attempt, opts);
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs, opts.signal);
    }
  }
  // Unreachable — the loop always throws or returns. Belt-and-suspenders:
  throw lastErr;
}

// ── Public entry: retrySupabaseQuery ({ data, error }) ───────────────

/**
 * Retry a Supabase query that returns `{ data, error }`. When the
 * error object indicates a transient failure (per
 * isTransientNetworkError), wait + retry. When the error is a real
 * application-level error (RLS denial, constraint violation, etc.),
 * return immediately.
 *
 * Returns the LAST `{ data, error }` after maxAttempts is exhausted —
 * caller's existing `if (error)` handling works unchanged.
 */
export async function retrySupabaseQuery<T>(
  fn: () => PromiseLike<SupabaseQueryResult<T>>,
  opts: RetryOpts = {},
): Promise<SupabaseQueryResult<T>> {
  checkCircuit();

  const max = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const shouldRetry = opts.shouldRetry ?? isTransientNetworkError;
  let lastResult: SupabaseQueryResult<T> | null = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const result = await fn();
      lastResult = result;
      // Success path — error is null OR error is non-transient.
      // Either way, the call landed cleanly — close the breaker.
      if (!result.error) {
        recordSuccess();
        return result;
      }
      if (!shouldRetry(result.error, attempt)) {
        // Non-transient error (e.g. RLS denial). Don't retry, but
        // ALSO don't count it against the breaker — this is the
        // user's request being rejected, not infrastructure failing.
        return result;
      }
      // Transient error path — count + maybe retry.
      recordFailure(result.error);
      if (attempt >= max) return result;
      const delayMs = computeDelayMs(attempt, opts);
      opts.onRetry?.(result.error, attempt, delayMs);
      await sleep(delayMs, opts.signal);
    } catch (err) {
      // The fn itself threw (network failure inside the SDK before
      // it could shape an error object). Same retry logic + breaker
      // accounting.
      recordFailure(err);
      if (attempt >= max || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delayMs = computeDelayMs(attempt, opts);
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs, opts.signal);
    }
  }
  // lastResult is non-null after at least one attempt; assert for TS.
  if (lastResult) return lastResult;
  // Defensive — should never reach here.
  throw new Error("retrySupabaseQuery: no result and no error captured");
}
