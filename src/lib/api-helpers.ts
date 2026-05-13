import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  retrySupabase,
  isTransientNetworkError,
  isCircuitOpenError,
} from "@/lib/supabase-retry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/**
 * Safe auth: creates Supabase client + gets user, wrapped in try-catch.
 * Returns JSON error responses instead of throwing raw exceptions.
 *
 * Hardened against the Vercel error anomaly 2026-04-28 16:40 UTC
 * ("Failures occurred on both Supabase authentication and profiles
 * endpoints"). The auth.getUser() call is the single most-trafficked
 * Supabase endpoint in the app — every authenticated route calls it
 * via this function. Wrapping it in retrySupabase absorbs short
 * transient blips before they cascade into 401/503 responses across
 * every page mount + every credit chip + every bootstrap submission.
 *
 * Distinguishes:
 *   - 401 when auth.getUser() returns a real auth error or no user
 *     (intentional — actual unauthenticated request)
 *   - 503 when the call throws after retries exhausted (transient
 *     Supabase outage — caller should retry in 30s)
 */
export async function safeAuth(): Promise<
  | { supabase: AnySupabase; user: { id: string; email?: string }; error: null }
  | { supabase: null; user: null; error: NextResponse }
> {
  try {
    const supabase = await createClient();
    // Wrap auth.getUser in retrySupabase. The SDK throws on network
    // failures (handled here); 401-shaped responses come through as
    // `{ error: { message: "..." } }` and are NOT retried (the
    // isTransientNetworkError predicate rejects auth-shaped errors
    // by returning false on 4xx status codes).
    const result = await retrySupabase(
      () => supabase.auth.getUser(),
      {
        // Conservative: only 2 attempts total to keep the auth path
        // fast on the green path. Total worst-case ~500ms wall vs
        // 3-attempt's ~2s. Auth is on the hot path of every request.
        maxAttempts: 2,
        baseMs: 200,
        onRetry: (err, attempt, delayMs) =>
          console.warn(
            `[safeAuth] auth.getUser retry ${attempt} after ${delayMs}ms:`,
            err instanceof Error ? err.message : err,
          ),
      },
    );
    const { data: { user }, error } = result;

    if (error || !user) {
      return {
        supabase: null,
        user: null,
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { supabase: supabase as AnySupabase, user, error: null };
  } catch (err) {
    // Three distinguishable failure modes:
    //   1. CircuitOpenError — breaker tripped from upstream sustained
    //      outage. Fast-fail with a clean 503 + Retry-After. The
    //      breaker auto-recovers after CIRCUIT_COOLDOWN_MS so the
    //      client retrying after that window will succeed.
    //   2. Transient network error after retries exhausted — same 503
    //      with Retry-After: 30, but explicit "auth temporarily
    //      unavailable" copy.
    //   3. Other thrown error — generic 503.
    if (isCircuitOpenError(err)) {
      const retryAfterSec = Math.ceil(err.retryAfterMs / 1000);
      console.warn(
        `[safeAuth] Circuit breaker open — fast-fail 503 (retry in ${retryAfterSec}s)`,
      );
      return {
        supabase: null,
        user: null,
        error: NextResponse.json(
          {
            error: `Supabase service degraded. Auto-recovering in ${retryAfterSec}s.`,
            isServiceDegradation: true,
            circuitBreakerOpen: true,
            retryAfterSeconds: retryAfterSec,
          },
          {
            status: 503,
            headers: { "Retry-After": String(retryAfterSec) },
          },
        ),
      };
    }
    const isInfra = isTransientNetworkError(err);
    console.error(
      `[safeAuth] Supabase connection failed (infra=${isInfra}):`,
      err,
    );
    return {
      supabase: null,
      user: null,
      error: NextResponse.json(
        {
          error: isInfra
            ? "Supabase auth is temporarily unavailable. Please try again in a moment."
            : "Service temporarily unavailable. Please try again.",
          isServiceDegradation: isInfra,
        },
        {
          status: 503,
          headers: isInfra ? { "Retry-After": "30" } : {},
        },
      ),
    };
  }
}

/**
 * Safely parse request JSON body. Returns parsed data or a 400 error response.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeJsonParse<T = any>(
  request: Request
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  try {
    const data = (await request.json()) as T;
    return { data, error: null };
  } catch {
    return {
      data: null,
      error: NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      ),
    };
  }
}

/**
 * Sanitize error messages for API responses.
 * Strips internal details (org IDs, model names, TPM limits) that shouldn't be exposed to users.
 *
 * Coercion rules for unknown error shapes:
 *   • Error instance         → use .message
 *   • Plain object with .message (Supabase PostgrestError, etc.) → use .message
 *   • Plain object with .error_description / .error / .detail / .hint → use first non-empty
 *   • Plain object with neither → JSON-stringify (so the user gets readable detail,
 *     not "[object Object]")
 *   • Anything else           → String(err)
 *
 * Why this matters: Supabase JS client throws/returns plain objects with the
 * shape { message, details, hint, code } — they're NOT Error instances. Doing
 * `String(err)` on them yields the useless "[object Object]" that hides real
 * failures (e.g., "relation does not exist", "permission denied", FK violations).
 */
export function sanitizeErrorMessage(err: unknown): string {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === "object") {
    // Try common error-shape fields in priority order.
    const e = err as Record<string, unknown>;
    const candidates = [
      e.message,
      e.error_description,
      e.error,
      e.detail,
      e.details,
      e.hint,
    ];
    const found = candidates.find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (found) {
      msg = found;
    } else {
      // Last resort: JSON-stringify so the user sees the actual shape rather
      // than the useless "[object Object]" from String(obj).
      try {
        msg = JSON.stringify(err);
      } catch {
        msg = "(unrecognized error)";
      }
    }
  } else {
    msg = String(err);
  }

  // Rate limit — hide org/model details
  if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
    return "Rate limit reached. Please wait a moment and try again.";
  }
  // Quota exhausted — already handled by llm.ts but catch here as backup
  if (msg.includes("insufficient_quota") || msg.includes("billing")) {
    return "API quota exhausted. Please check your billing settings.";
  }
  // Timeout
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
    return "Request timed out. Please try again.";
  }
  // Generic — don't leak internal details
  if (msg.includes("org-") || msg.includes("openai") || msg.includes("gpt-")) {
    return "An external service error occurred. Please try again.";
  }
  return msg;
}

/**
 * Verify that the authenticated user owns the given space.
 * Returns true if the user owns the space, false otherwise.
 */
export async function verifySpaceOwnership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  spaceId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .single();

  return !error && !!data;
}

/**
 * Verify ownership of multiple spaces. Returns false if any space is not owned.
 */
export async function verifyMultiSpaceOwnership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  spaceIds: string[],
  userId: string
): Promise<boolean> {
  if (spaceIds.length === 0) return true;

  const { data, error } = await supabase
    .from("spaces")
    .select("id")
    .in("id", spaceIds)
    .eq("user_id", userId);

  if (error) return false;
  return (data?.length ?? 0) === spaceIds.length;
}

/**
 * Refresh the cached entity_count and edge_count on the spaces table.
 * Call this after any pipeline step that inserts/removes entities or edges.
 */
export async function refreshSpaceCounts(
  supabase: AnySupabase,
  spaceIds: string[]
): Promise<void> {
  for (const spaceId of spaceIds) {
    try {
      const [entRes, edgeRes] = await Promise.all([
        supabase
          .from("entities")
          .select("id", { count: "exact", head: true })
          .eq("space_id", spaceId),
        supabase
          .from("edges")
          .select("id", { count: "exact", head: true })
          .eq("space_id", spaceId),
      ]);

      const entityCount = entRes.count ?? 0;
      const edgeCount = edgeRes.count ?? 0;

      await supabase
        .from("spaces")
        .update({ entity_count: entityCount, edge_count: edgeCount })
        .eq("id", spaceId);
    } catch (err) {
      console.warn(`[refreshSpaceCounts] Failed for space ${spaceId}:`, err);
    }
  }
}
