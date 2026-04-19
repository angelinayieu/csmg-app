import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS.
 * Use ONLY in server-side contexts like webhooks where there's no user session.
 *
 * Intentionally untyped (no Database generic) because the codebase's
 * existing consumers (self-improving-loop.ts, research-loop route) rely on
 * the loose return type and would break under strict typing. New callers
 * that want type safety should accept `SupabaseClient<Database> | any`
 * (see src/lib/twin/capture-baseline.ts for the pattern).
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
