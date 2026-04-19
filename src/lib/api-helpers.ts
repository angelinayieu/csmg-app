import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/**
 * Safe auth: creates Supabase client + gets user, wrapped in try-catch.
 * Returns JSON error responses instead of throwing raw exceptions.
 */
export async function safeAuth(): Promise<
  | { supabase: AnySupabase; user: { id: string; email?: string }; error: null }
  | { supabase: null; user: null; error: NextResponse }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        supabase: null,
        user: null,
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return { supabase: supabase as AnySupabase, user, error: null };
  } catch (err) {
    console.error("[safeAuth] Supabase connection failed:", err);
    return {
      supabase: null,
      user: null,
      error: NextResponse.json(
        { error: "Service temporarily unavailable. Please try again." },
        { status: 503 }
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
 */
export function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

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
