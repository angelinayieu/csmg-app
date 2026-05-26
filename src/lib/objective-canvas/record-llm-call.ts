// ── LLM telemetry recorder ─────────────────────────────────────────
//
// Thin wrapper around the llm_call_log table. Used by Objective
// Canvas LLM call sites (expandItemDetail, composeVariations,
// generatePrototypeBrief, recommend-next-move, etc.) to log:
//
//   • Which call site fired
//   • Which model handled the request
//   • Token usage (prompt / completion / total)
//   • Latency in ms
//   • Success / error status + error message
//   • Artifact reference (kind + id) so user feedback can later
//     attach back to specific artifacts via PATCH /api/llm/feedback
//
// Always fire-and-forget — telemetry must NEVER block the
// user-facing response. Failures log a console warning and swallow.

export interface RecordLLMCallArgs {
  /** Already-authed supabase client (server-side route). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  /** Owner of the call. Required for RLS — null only when called
   *  from an unauthenticated context (rare; most calls are inside
   *  authed routes). */
  userId: string | null;
  /** Space the call belongs to. Null for cross-space tools / auth
   *  flows. */
  spaceId: string | null;
  /** Logical name — function/feature, not file path. Stable string
   *  so analytics queries can group by site cleanly. Examples:
   *  'expand_item_detail', 'compose_variations',
   *  'generate_prototype_brief', 'recommend_next_move',
   *  'cluster_proposals', 'distill_concepts'. */
  callSite: string;
  /** Model that handled the call — e.g. 'gpt-4o', 'gpt-4o-mini',
   *  'claude-opus-4-20250514'. */
  model: string;
  /** Token usage as reported by the provider's response.usage.
   *  Optional — null when the response shape didn't carry it. */
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  /** Wall-clock latency in ms. Measured from the moment the caller
   *  invoked llmJSON to the moment it returned (including retries). */
  latencyMs: number;
  status: "success" | "error";
  /** When status='error', a sanitized message. Null on success. */
  errorMessage?: string | null;
  /** Optional artifact reference — what the call produced. The
   *  feedback endpoint uses (kind, id) to find the right log row
   *  when the user thumbs-rates the artifact. */
  artifactKind?: string | null;
  artifactId?: string | null;
  /** Free-shape — typically carries intent / batch / variation kind
   *  / lens-size / etc. for downstream analytics. */
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget insert into llm_call_log. Always returns a
 *  resolved promise — failures log to console and swallow so
 *  callers can `void recordLLMCall(...)` safely. */
export async function recordLLMCall(args: RecordLLMCallArgs): Promise<void> {
  try {
    const { db, ...payload } = args;
    const { error } = await db.from("llm_call_log").insert({
      user_id: payload.userId,
      space_id: payload.spaceId,
      call_site: payload.callSite,
      model: payload.model,
      prompt_tokens: payload.promptTokens ?? null,
      completion_tokens: payload.completionTokens ?? null,
      total_tokens: payload.totalTokens ?? null,
      latency_ms: Math.max(0, Math.floor(payload.latencyMs)),
      status: payload.status,
      error_message: payload.errorMessage ?? null,
      artifact_kind: payload.artifactKind ?? null,
      artifact_id: payload.artifactId ?? null,
      metadata: payload.metadata ?? {},
    });
    if (error) {
      console.warn("[llm-telemetry] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[llm-telemetry] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Small instrumented-call helper — wraps any async LLM-producing
 *  function with timing + status capture + telemetry insert. Use
 *  this at call sites that have all the context (db, userId,
 *  artifact ids) but want to avoid the boilerplate of manually
 *  timing + try/catching + logging.
 *
 *  Usage:
 *    const detail = await instrumentedLLMCall(
 *      { db, userId, spaceId, callSite: 'expand_item_detail',
 *        artifactKind: 'expanded_detail', artifactId: entity.id,
 *        modelHint: 'gpt-4o' },
 *      () => expandItemDetail(ctx),
 *    );
 *
 *  The wrapper:
 *    • measures latency from invocation to resolution
 *    • catches errors → records 'error' status + sanitized message,
 *      then re-throws so caller's existing error handling fires
 *    • does NOT capture token usage (the underlying llmJSON has it
 *      but doesn't surface it; for now we just log latency / status) */
export async function instrumentedLLMCall<T>(
  args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any;
    userId: string | null;
    spaceId: string | null;
    callSite: string;
    /** Best-known model name. The underlying llmJSON might pick a
     *  different one based on env config; we record the caller's
     *  intent here. Use MODEL_DEFAULTS[provider].reasoning as the
     *  default. */
    modelHint: string;
    artifactKind?: string | null;
    artifactId?: string | null;
    metadata?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    void recordLLMCall({
      db: args.db,
      userId: args.userId,
      spaceId: args.spaceId,
      callSite: args.callSite,
      model: args.modelHint,
      latencyMs: Date.now() - start,
      status: "success",
      artifactKind: args.artifactKind,
      artifactId: args.artifactId,
      metadata: args.metadata,
    });
    return result;
  } catch (err) {
    void recordLLMCall({
      db: args.db,
      userId: args.userId,
      spaceId: args.spaceId,
      callSite: args.callSite,
      model: args.modelHint,
      latencyMs: Date.now() - start,
      status: "error",
      errorMessage:
        err instanceof Error
          ? err.message.slice(0, 500)
          : String(err).slice(0, 500),
      artifactKind: args.artifactKind,
      artifactId: args.artifactId,
      metadata: args.metadata,
    });
    throw err;
  }
}
