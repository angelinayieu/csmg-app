import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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
