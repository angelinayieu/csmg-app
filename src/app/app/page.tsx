import { createClient, getAuthUser } from "@/lib/supabase/server";
import { StudioShell } from "@/components/studio/studio-shell";
import type { Space } from "@/types";
import type { Reaction } from "@/types/reactions";

/**
 * /app — Studio landing.
 *
 * Post-auth home surface. Replaces the previous WelcomeHero/EcosystemSection/
 * GlobalQueryBox stack with the minimal Studio shell: a single "What are you
 * thinking about?" dropzone, a quiet row of model pulse tiles, a ⌘K command
 * palette, and the full model index below the fold.
 *
 * The server delivers the initial space list; the shell enriches it with
 * activity pulse via `/api/spaces/pulse` after hydration. This keeps first
 * paint fast while still giving returning users a lived-in feel.
 */
export default async function StudioPage() {
  const user = await getAuthUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Phase 42 — Continue row: fetch the N most-recent reactions across
  // every space the user can see. RLS enforces ownership so we don't
  // need an explicit filter beyond the order/limit. Join-less query
  // (we resolve space names client-side from the already-loaded spaces
  // list) to keep server work minimal.
  const [spacesRes, profileRes, recentReactionsRes] = await Promise.all([
    db
      .from("spaces")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(40),
    user
      ? db.from("profiles").select("display_name").eq("id", user.id).single()
      : null,
    db
      .from("reactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const spaces = (spacesRes.data ?? []) as Space[];
  const displayName: string | null = profileRes?.data?.display_name ?? null;
  const recentReactions = (recentReactionsRes.data ?? []) as Reaction[];

  // Greeting: display_name > email local-part > "there"
  const greetingName = displayName || user?.email?.split("@")[0] || "there";

  return (
    <StudioShell
      greetingName={greetingName}
      spaces={spaces}
      recentReactions={recentReactions}
    />
  );
}
