import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll can be called from Server Components where cookies
            // are read-only. The middleware handles the actual cookie writes.
          }
        },
      },
    }
  );
}

/**
 * Get the current authenticated user — deduplicated per request.
 * Uses React cache() so that multiple Server Components calling this
 * in the same render tree only make ONE getUser() call to Supabase.
 *
 * This eliminates the triple-auth-call problem:
 *   layout.tsx + page.tsx + any server component = 1 call total.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
