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
