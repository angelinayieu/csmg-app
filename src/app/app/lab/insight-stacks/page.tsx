// ── Insight Lab · /app/lab/insight-stacks ─────────────────────────────
//
// Server route. Loads the user's spaces for the header dropdown and
// resolves the active space (from ?spaceId= or most-recently-updated).
// Hands off to the client shell which owns run state + SSE.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InsightLabPage } from "@/components/insight-lab/insight-lab-page";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

interface InsightStacksPageProps {
  searchParams: Promise<{ spaceId?: string }>;
}

export default async function InsightStacksPage({
  searchParams,
}: InsightStacksPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spacesRaw } = await db
    .from("spaces")
    .select("id, name, entity_count, edge_count, primary_goal, input_text")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(30);

  const spaces = (spacesRaw ?? []) as Array<
    Pick<
      Space,
      "id" | "name" | "entity_count" | "edge_count"
    > & {
      primary_goal: string | null;
      input_text: string | null;
    }
  >;

  if (spaces.length === 0) redirect("/app");

  const params = await searchParams;
  const requestedId = params.spaceId;
  const activeSpace =
    spaces.find((s) => s.id === requestedId) ?? spaces[0];

  return <InsightLabPage initialSpaces={spaces} initialSpaceId={activeSpace.id} />;
}
